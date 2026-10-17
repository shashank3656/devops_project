package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const webhookInboxMaxBytes = 64 * 1024

var (
	errInboxHidden     = errors.New("webhook connection not found")
	errInboxDisabled   = errors.New("webhook connection is disabled")
	errInboxSignature  = errors.New("webhook signature is invalid")
	errInboxScope      = errors.New("webhook payload is outside the connection scope")
	errInboxTooLarge   = errors.New("webhook body is too large")
	errInboxRate       = errors.New("too many webhook receipts")
	errInboxStored     = errors.New("webhook inbox was not stored")
	inboxRateLimit     = 30
	inboxRateWindow    = time.Minute
	inboxHits          = map[int][]time.Time{}
	inboxHitsMu        sync.Mutex
	resolveInboxSecret = func(connectionContract) (string, error) {
		return "", errInboxStored
	}
	saveInboxReceipt   = saveInboxReceiptToDB
	notifyInboxApplied = func(inboxReceipt) error { return nil }
)

type inboxEventInput struct {
	EventID      string `json:"event_id"`
	ExternalID   string `json:"external_id"`
	Revision     int    `json:"revision"`
	ProjectID    int    `json:"project_id"`
	Environment  string `json:"environment"`
	EventType    string `json:"event_type"`
	ServiceAlias string `json:"service_alias"`
}

type inboxAcceptView struct {
	InboxID     int    `json:"inbox_id"`
	RecordID    int    `json:"record_id"`
	ProjectID   int    `json:"project_id"`
	EventID     string `json:"event_id"`
	ExternalID  string `json:"external_id"`
	Revision    int    `json:"revision"`
	Attempts    int    `json:"attempts"`
	Duplicate   bool   `json:"duplicate"`
	Stale       bool   `json:"stale"`
	Quarantined bool   `json:"quarantined"`
	Accepted    bool   `json:"accepted"`
}

type inboxReceipt struct {
	ProjectID      int
	OrganizationID int
	ConnectionID   int
	Environment    string
	EventID        string
	ExternalID     string
	EventType      string
	Revision       int
	ServiceAlias   string
	Body           string
}

func inboxRevisionApplies(exists bool, current, incoming int) bool {
	if incoming < 1 {
		return false
	}
	if !exists {
		return true
	}
	return incoming > current
}

func acceptWebhookInbox(connectionID int, body []byte, signature string, now time.Time) (inboxAcceptView, error) {
	if connectionID <= 0 {
		return inboxAcceptView{}, errInboxHidden
	}
	if len(body) > webhookInboxMaxBytes {
		return inboxAcceptView{}, errInboxTooLarge
	}
	current, err := loadConnectionByID(connectionID)
	if err != nil || current.ID <= 0 || current.ProjectID <= 0 {
		return inboxAcceptView{}, errInboxHidden
	}
	if current.Disabled {
		return inboxAcceptView{}, errInboxDisabled
	}
	if inboxRateLimited(connectionID, now) {
		return inboxAcceptView{}, errInboxRate
	}
	secret, err := resolveInboxSecret(current)
	if err != nil || strings.TrimSpace(secret) == "" {
		return inboxAcceptView{}, errInboxStored
	}
	if !verifyInboundHMAC(secret, body, signature) {
		return inboxAcceptView{}, errInboxSignature
	}
	var input inboxEventInput
	if err := json.Unmarshal(body, &input); err != nil {
		return inboxAcceptView{}, errors.New("webhook body is invalid")
	}
	receipt, err := normalizeInboxReceipt(current, input, body)
	if err != nil {
		return inboxAcceptView{}, err
	}
	view, err := saveInboxReceipt(receipt)
	if err != nil {
		return inboxAcceptView{}, errInboxStored
	}
	view.Accepted = true
	return view, nil
}

func normalizeInboxReceipt(current connectionContract, input inboxEventInput, body []byte) (inboxReceipt, error) {
	environment := strings.ToLower(strings.TrimSpace(current.Environment))
	if environment == "" {
		environment = "*"
	}
	claimedProject := input.ProjectID
	if claimedProject > 0 && claimedProject != current.ProjectID {
		return inboxReceipt{}, errInboxScope
	}
	claimedEnv := strings.ToLower(strings.TrimSpace(input.Environment))
	if claimedEnv != "" && environment != "*" && claimedEnv != environment {
		return inboxReceipt{}, errInboxScope
	}
	eventID := strings.TrimSpace(input.EventID)
	externalID := strings.TrimSpace(input.ExternalID)
	eventType := strings.ToLower(strings.TrimSpace(input.EventType))
	if !outboxKeyPattern.MatchString(eventID) || !outboxKeyPattern.MatchString(externalID) || !outboxTypePattern.MatchString(eventType) {
		return inboxReceipt{}, errors.New("webhook identity is invalid")
	}
	if input.Revision < 1 {
		return inboxReceipt{}, errors.New("webhook revision is invalid")
	}
	alias := strings.ToLower(strings.TrimSpace(input.ServiceAlias))
	if alias != "" && !outboxTypePattern.MatchString(alias) {
		return inboxReceipt{}, errors.New("service alias is invalid")
	}
	return inboxReceipt{
		ProjectID:      current.ProjectID,
		OrganizationID: pilotOrganizationID,
		ConnectionID:   current.ID,
		Environment:    environment,
		EventID:        eventID,
		ExternalID:     externalID,
		EventType:      eventType,
		Revision:       input.Revision,
		ServiceAlias:   alias,
		Body:           string(body),
	}, nil
}

func inboxRateLimited(connectionID int, now time.Time) bool {
	if inboxRateLimit <= 0 || inboxRateWindow <= 0 {
		return false
	}
	inboxHitsMu.Lock()
	defer inboxHitsMu.Unlock()
	cutoff := now.Add(-inboxRateWindow)
	prev := inboxHits[connectionID]
	recent := make([]time.Time, 0, len(prev)+1)
	for _, hit := range prev {
		if hit.After(cutoff) {
			recent = append(recent, hit)
		}
	}
	if len(recent) >= inboxRateLimit {
		inboxHits[connectionID] = recent
		return true
	}
	inboxHits[connectionID] = append(recent, now)
	return false
}

func webhookInboxHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/webhooks/inbox/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 2 && parts[1] == "replay" {
		inboxID, err := strconv.Atoi(parts[0])
		if err != nil || inboxID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid webhook event", nil)
			return
		}
		replayWebhookHandler(w, r, inboxID)
		return
	}
	connectionID, ok := parseInboxPath(r.URL.Path)
	if !ok || connectionID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid webhook connection", nil)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, webhookInboxMaxBytes+1))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "webhook body is invalid", nil)
		return
	}
	view, err := acceptWebhookInbox(connectionID, body, r.Header.Get("X-Webhook-Signature"), time.Now().UTC())
	if err != nil {
		writeInboxError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"receipt": view, "status": "ok"})
}

func parseInboxPath(path string) (int, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/webhooks/inbox/"), "/")
	if trimmed == "" || strings.Contains(trimmed, "/") {
		return 0, false
	}
	id, err := strconv.Atoi(trimmed)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func writeInboxError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errInboxHidden):
		writeAPIError(w, r, http.StatusNotFound, errInboxHidden.Error(), nil)
	case errors.Is(err, errInboxSignature):
		writeAPIError(w, r, http.StatusUnauthorized, errInboxSignature.Error(), nil)
	case errors.Is(err, errInboxScope):
		writeAPIError(w, r, http.StatusForbidden, errInboxScope.Error(), nil)
	case errors.Is(err, errInboxDisabled):
		writeAPIError(w, r, http.StatusConflict, errInboxDisabled.Error(), nil)
	case errors.Is(err, errInboxTooLarge):
		writeAPIError(w, r, http.StatusRequestEntityTooLarge, errInboxTooLarge.Error(), nil)
	case errors.Is(err, errInboxRate):
		writeAPIError(w, r, http.StatusTooManyRequests, errInboxRate.Error(), nil)
	case errors.Is(err, errInboxStored):
		writeAPIError(w, r, http.StatusServiceUnavailable, errInboxStored.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}

func migrateWebhookInboxSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_inbox (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			organization_id INTEGER NOT NULL,
			connection_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			event_id VARCHAR(128) NOT NULL,
			external_id VARCHAR(128) NOT NULL,
			event_type VARCHAR(120) NOT NULL,
			source_revision INTEGER NOT NULL,
			payload TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 1,
			received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, event_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_records (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			external_id VARCHAR(128) NOT NULL,
			revision INTEGER NOT NULL,
			event_type VARCHAR(120) NOT NULL,
			inbox_id INTEGER NOT NULL REFERENCES webhook_inbox(id) ON DELETE CASCADE,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, external_id)
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE webhook_inbox ADD COLUMN IF NOT EXISTS service_alias VARCHAR(200) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE webhook_inbox ADD COLUMN IF NOT EXISTS processing_state VARCHAR(32) NOT NULL DEFAULT 'accepted'`)
	_, _ = DB.Exec(`ALTER TABLE webhook_records ADD COLUMN IF NOT EXISTS service_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE webhook_records ADD COLUMN IF NOT EXISTS mapping_version INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE webhook_records ADD COLUMN IF NOT EXISTS approval_state VARCHAR(32) NOT NULL DEFAULT 'pending'`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_mappings (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			alias VARCHAR(200) NOT NULL,
			service_id INTEGER NOT NULL,
			version INTEGER NOT NULL,
			active BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, alias, version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_quarantine (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			inbox_id INTEGER NOT NULL,
			alias VARCHAR(200) NOT NULL,
			reason VARCHAR(120) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_replays (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			inbox_id INTEGER NOT NULL,
			event_id VARCHAR(128) NOT NULL,
			actor_id INTEGER NOT NULL,
			reason VARCHAR(200) NOT NULL,
			mapping_version INTEGER NOT NULL,
			result VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveInboxReceiptToDB(receipt inboxReceipt) (inboxAcceptView, error) {
	if DB == nil {
		return inboxAcceptView{}, errInboxStored
	}
	tx, err := DB.Begin()
	if err != nil {
		return inboxAcceptView{}, err
	}
	defer tx.Rollback()
	var inboxID int
	err = tx.QueryRow(`
		INSERT INTO webhook_inbox (
			project_id, organization_id, connection_id, environment, event_id, external_id, event_type, source_revision, payload
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (project_id, event_id) DO NOTHING
		RETURNING id
	`, receipt.ProjectID, receipt.OrganizationID, receipt.ConnectionID, receipt.Environment, receipt.EventID, receipt.ExternalID, receipt.EventType, receipt.Revision, receipt.Body).Scan(&inboxID)
	if errors.Is(err, sql.ErrNoRows) {
		var attempts int
		err = tx.QueryRow(`
			UPDATE webhook_inbox SET attempts = attempts + 1
			WHERE project_id = $1 AND event_id = $2
			RETURNING id, attempts
		`, receipt.ProjectID, receipt.EventID).Scan(&inboxID, &attempts)
		if err != nil {
			return inboxAcceptView{}, err
		}
		var recordID, revision int
		err = tx.QueryRow(`SELECT id, revision FROM webhook_records WHERE project_id = $1 AND external_id = $2`, receipt.ProjectID, receipt.ExternalID).Scan(&recordID, &revision)
		if errors.Is(err, sql.ErrNoRows) {
			if err := tx.Commit(); err != nil {
				return inboxAcceptView{}, err
			}
			return inboxAcceptView{
				InboxID: inboxID, ProjectID: receipt.ProjectID, EventID: receipt.EventID,
				ExternalID: receipt.ExternalID, Attempts: attempts, Duplicate: true, Quarantined: true,
			}, nil
		}
		if err != nil {
			return inboxAcceptView{}, err
		}
		if err := tx.Commit(); err != nil {
			return inboxAcceptView{}, err
		}
		return inboxAcceptView{
			InboxID: inboxID, RecordID: recordID, ProjectID: receipt.ProjectID, EventID: receipt.EventID,
			ExternalID: receipt.ExternalID, Revision: revision, Attempts: attempts, Duplicate: true,
		}, nil
	}
	if err != nil {
		return inboxAcceptView{}, err
	}
	mapping, mapped := webhookMapping{}, false
	if receipt.ServiceAlias != "" {
		mapping, mapped = activeWebhookMapping(receipt.ProjectID, receipt.ServiceAlias)
		if !mapped {
			if _, err = tx.Exec(`UPDATE webhook_inbox SET service_alias = $2, processing_state = 'quarantined' WHERE id = $1`, inboxID, receipt.ServiceAlias); err != nil {
				return inboxAcceptView{}, err
			}
			if _, err = tx.Exec(`
				INSERT INTO webhook_quarantine (project_id, inbox_id, alias, reason)
				VALUES ($1, $2, $3, 'unresolved alias')
			`, receipt.ProjectID, inboxID, receipt.ServiceAlias); err != nil {
				return inboxAcceptView{}, err
			}
			if err := tx.Commit(); err != nil {
				return inboxAcceptView{}, err
			}
			return inboxAcceptView{
				InboxID: inboxID, ProjectID: receipt.ProjectID, EventID: receipt.EventID,
				ExternalID: receipt.ExternalID, Revision: receipt.Revision, Attempts: 1, Quarantined: true,
			}, nil
		}
		if _, err = tx.Exec(`UPDATE webhook_inbox SET service_alias = $2 WHERE id = $1`, inboxID, receipt.ServiceAlias); err != nil {
			return inboxAcceptView{}, err
		}
	}
	var recordID, currentRevision int
	err = tx.QueryRow(`SELECT id, revision FROM webhook_records WHERE project_id = $1 AND external_id = $2 FOR UPDATE`, receipt.ProjectID, receipt.ExternalID).Scan(&recordID, &currentRevision)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return inboxAcceptView{}, err
	}
	apply := inboxRevisionApplies(exists, currentRevision, receipt.Revision)
	view := inboxAcceptView{
		InboxID: inboxID, ProjectID: receipt.ProjectID, EventID: receipt.EventID,
		ExternalID: receipt.ExternalID, Attempts: 1,
	}
	if apply {
		if !exists {
			if mapped {
				err = tx.QueryRow(`
					INSERT INTO webhook_records (project_id, external_id, revision, event_type, inbox_id, service_id, mapping_version, approval_state)
					VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
					RETURNING id
				`, receipt.ProjectID, receipt.ExternalID, receipt.Revision, receipt.EventType, inboxID, mapping.ServiceID, mapping.Version).Scan(&recordID)
			} else {
				err = tx.QueryRow(`
					INSERT INTO webhook_records (project_id, external_id, revision, event_type, inbox_id)
					VALUES ($1, $2, $3, $4, $5)
					RETURNING id
				`, receipt.ProjectID, receipt.ExternalID, receipt.Revision, receipt.EventType, inboxID).Scan(&recordID)
			}
		} else if mapped {
			err = tx.QueryRow(`
				UPDATE webhook_records
				SET revision = $3, event_type = $4, inbox_id = $5, service_id = $6, mapping_version = $7, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 AND project_id = $2
				RETURNING id
			`, recordID, receipt.ProjectID, receipt.Revision, receipt.EventType, inboxID, mapping.ServiceID, mapping.Version).Scan(&recordID)
		} else {
			err = tx.QueryRow(`
				UPDATE webhook_records
				SET revision = $3, event_type = $4, inbox_id = $5, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 AND project_id = $2
				RETURNING id
			`, recordID, receipt.ProjectID, receipt.Revision, receipt.EventType, inboxID).Scan(&recordID)
		}
		if err != nil {
			return inboxAcceptView{}, err
		}
		if _, err = tx.Exec(`
			INSERT INTO webhook_revision_audit (project_id, external_id, event_id, incoming_revision, current_revision, result)
			VALUES ($1, $2, $3, $4, $5, 'applied')
		`, receipt.ProjectID, receipt.ExternalID, receipt.EventID, receipt.Revision, currentRevision); err != nil {
			return inboxAcceptView{}, err
		}
		view.RecordID = recordID
		view.Revision = receipt.Revision
		if mapped {
			if _, err = tx.Exec(`UPDATE webhook_inbox SET processing_state = 'mapped' WHERE id = $1`, inboxID); err != nil {
				return inboxAcceptView{}, err
			}
		}
		if err := notifyInboxApplied(receipt); err != nil {
			return inboxAcceptView{}, err
		}
	} else {
		if _, err = tx.Exec(`
			INSERT INTO webhook_revision_audit (project_id, external_id, event_id, incoming_revision, current_revision, result)
			VALUES ($1, $2, $3, $4, $5, 'stale')
		`, receipt.ProjectID, receipt.ExternalID, receipt.EventID, receipt.Revision, currentRevision); err != nil {
			return inboxAcceptView{}, err
		}
		if mapped {
			if _, err = tx.Exec(`UPDATE webhook_inbox SET processing_state = 'stale' WHERE id = $1`, inboxID); err != nil {
				return inboxAcceptView{}, err
			}
		}
		view.RecordID = recordID
		view.Revision = currentRevision
		view.Stale = true
	}
	if err := tx.Commit(); err != nil {
		return inboxAcceptView{}, err
	}
	return view, nil
}
