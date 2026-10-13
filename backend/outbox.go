package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const eventEnvelopeVersion = 1

var (
	errOutboxHidden   = errors.New("outbox event not found")
	errOutboxDenied   = errors.New("outbox scope denied")
	outboxKeyPattern  = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	outboxTypePattern = regexp.MustCompile(`^[a-z0-9._-]{1,120}$`)
)

type outboxInput struct {
	ProjectID      int             `json:"project_id"`
	Environment    string          `json:"environment"`
	Name           string          `json:"name"`
	EventType      string          `json:"event_type"`
	IdempotencyKey string          `json:"idempotency_key"`
	CorrelationID  string          `json:"correlation_id"`
	Payload        json.RawMessage `json:"payload"`
	Version        int             `json:"version"`
}

type outboxRecord struct {
	ID             int       `json:"id"`
	ProjectID      int       `json:"project_id"`
	OrganizationID int       `json:"organization_id"`
	Environment    string    `json:"environment"`
	IdempotencyKey string    `json:"idempotency_key"`
	Name           string    `json:"name"`
	EnvelopeID     string    `json:"envelope_id"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
}

type eventEnvelope struct {
	ID             string    `json:"id"`
	Version        int       `json:"version"`
	Type           string    `json:"type"`
	OrganizationID int       `json:"organization_id"`
	ProjectID      int       `json:"project_id"`
	Environment    string    `json:"environment"`
	CorrelationID  string    `json:"correlation_id"`
	IdempotencyKey string    `json:"idempotency_key"`
	RecordID       int       `json:"record_id"`
	Payload        string    `json:"payload"`
	OccurredAt     time.Time `json:"occurred_at"`
}

type outboxPair struct {
	Record outboxRecord
	Event  eventEnvelope
	Job    durableJob
}

type outboxAcceptView struct {
	Record    outboxRecord  `json:"record"`
	Event     eventEnvelope `json:"event"`
	Job       durableJob    `json:"-"`
	Duplicate bool          `json:"duplicate"`
}

var saveOutboxPair = saveOutboxPairToDB
var newEnvelopeID = randomEnvelopeID

func acceptOutboxEvent(subject authzSubject, input outboxInput, now time.Time) (outboxAcceptView, error) {
	environment := strings.ToLower(strings.TrimSpace(input.Environment))
	if environment == "" {
		environment = "*"
	}
	if input.ProjectID <= 0 || !catalogEnvironmentsAllowed(subject, input.ProjectID, []string{environment}, authzRead) {
		return outboxAcceptView{}, errOutboxHidden
	}
	if !catalogEnvironmentsAllowed(subject, input.ProjectID, []string{environment}, authzWrite) {
		return outboxAcceptView{}, errOutboxDenied
	}
	pair, err := normalizeOutboxInput(subject, input, environment, now)
	if err != nil {
		return outboxAcceptView{}, err
	}
	saved, duplicate, err := saveOutboxPair(pair)
	if err != nil {
		return outboxAcceptView{}, err
	}
	if saved.Job.ID > 0 {
		noteJobDispatch(saved.Job.ID)
	}
	return outboxAcceptView{Record: saved.Record, Event: saved.Event, Job: saved.Job, Duplicate: duplicate}, nil
}

func normalizeOutboxInput(subject authzSubject, input outboxInput, environment string, now time.Time) (outboxPair, error) {
	name := strings.TrimSpace(input.Name)
	eventType := strings.ToLower(strings.TrimSpace(input.EventType))
	key := strings.TrimSpace(input.IdempotencyKey)
	correlation := strings.TrimSpace(input.CorrelationID)
	if subject.OrganizationID <= 0 {
		return outboxPair{}, errors.New("organization is required")
	}
	if name == "" || len(name) > 200 {
		return outboxPair{}, errors.New("name is required")
	}
	if !outboxTypePattern.MatchString(eventType) {
		return outboxPair{}, errors.New("event type is invalid")
	}
	if !outboxKeyPattern.MatchString(key) {
		return outboxPair{}, errors.New("idempotency key is invalid")
	}
	if !outboxKeyPattern.MatchString(correlation) {
		return outboxPair{}, errors.New("correlation id is invalid")
	}
	if input.Version != 0 && input.Version != eventEnvelopeVersion {
		return outboxPair{}, errors.New("event version is not supported")
	}
	payload, err := normalizeOutboxPayload(input.Payload)
	if err != nil {
		return outboxPair{}, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	envelopeID, err := newEnvelopeID()
	if err != nil {
		return outboxPair{}, err
	}
	return outboxPair{
		Record: outboxRecord{
			ProjectID:      input.ProjectID,
			OrganizationID: subject.OrganizationID,
			Environment:    environment,
			IdempotencyKey: key,
			Name:           name,
			EnvelopeID:     envelopeID,
		},
		Event: eventEnvelope{
			ID:             envelopeID,
			Version:        eventEnvelopeVersion,
			Type:           eventType,
			OrganizationID: subject.OrganizationID,
			ProjectID:      input.ProjectID,
			Environment:    environment,
			CorrelationID:  correlation,
			IdempotencyKey: key,
			Payload:        payload,
			OccurredAt:     now.UTC(),
		},
	}, nil
}

func normalizeOutboxPayload(raw json.RawMessage) (string, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "{}", nil
	}
	if len(trimmed) > 8192 || !json.Valid([]byte(trimmed)) || trimmed[0] != '{' {
		return "", errors.New("payload must be a JSON object")
	}
	return trimmed, nil
}

func randomEnvelopeID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "evt_" + hex.EncodeToString(buf), nil
}

func outboxEventsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16384))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid outbox event", nil)
		return
	}
	var input outboxInput
	if err := json.Unmarshal(body, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid outbox event", nil)
		return
	}
	view, err := acceptOutboxEvent(subject, input, time.Now().UTC())
	if err != nil {
		writeOutboxError(w, r, err)
		return
	}
	status := http.StatusCreated
	if view.Duplicate {
		status = http.StatusOK
	}
	payload := map[string]any{
		"record":    view.Record,
		"event":     view.Event,
		"duplicate": view.Duplicate,
		"status":    "ok",
	}
	if view.Job.ID > 0 {
		payload["job"] = view.Job.Public(false)
	}
	_ = writeJSONResponse(w, status, payload)
}

func writeOutboxError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errOutboxHidden):
		writeAPIError(w, r, http.StatusNotFound, errOutboxHidden.Error(), nil)
	case errors.Is(err, errOutboxDenied):
		writeAPIError(w, r, http.StatusForbidden, errOutboxDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}

func migrateOutboxSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS outbox_records (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			organization_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL DEFAULT '*',
			idempotency_key VARCHAR(128) NOT NULL,
			name VARCHAR(200) NOT NULL,
			envelope_id VARCHAR(40) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, idempotency_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS event_outbox (
			id VARCHAR(40) PRIMARY KEY,
			version INTEGER NOT NULL,
			event_type VARCHAR(120) NOT NULL,
			organization_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			environment VARCHAR(64) NOT NULL,
			correlation_id VARCHAR(128) NOT NULL,
			idempotency_key VARCHAR(128) NOT NULL,
			record_id INTEGER NOT NULL REFERENCES outbox_records(id) ON DELETE CASCADE,
			payload TEXT NOT NULL DEFAULT '{}',
			occurred_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, idempotency_key)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_event_outbox_project ON event_outbox(project_id, idempotency_key)`)
}

func saveOutboxPairToDB(pair outboxPair) (outboxPair, bool, error) {
	if DB == nil {
		return outboxPair{}, false, errors.New("database not available")
	}
	tx, err := DB.Begin()
	if err != nil {
		return outboxPair{}, false, err
	}
	defer tx.Rollback()
	saved, duplicate, err := persistOutboxPair(tx, pair, false)
	if err != nil {
		return outboxPair{}, false, err
	}
	if duplicate {
		return saved, true, nil
	}
	if err := tx.Commit(); err != nil {
		return outboxPair{}, false, err
	}
	return saved, false, nil
}

func persistOutboxPair(tx *sql.Tx, pair outboxPair, failEnvelope bool) (outboxPair, bool, error) {
	var id int
	err := tx.QueryRow(`
		INSERT INTO outbox_records (project_id, organization_id, environment, idempotency_key, name, envelope_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (project_id, idempotency_key) DO NOTHING
		RETURNING id
	`, pair.Record.ProjectID, pair.Record.OrganizationID, pair.Record.Environment, pair.Record.IdempotencyKey, pair.Record.Name, pair.Record.EnvelopeID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return loadOutboxPairTx(tx, pair.Record.ProjectID, pair.Record.IdempotencyKey)
	}
	if err != nil {
		return outboxPair{}, false, err
	}
	if failEnvelope {
		return outboxPair{}, false, errors.New("outbox envelope was not written")
	}
	pair.Record.ID = id
	pair.Event.RecordID = id
	_, err = tx.Exec(`
		INSERT INTO event_outbox (
			id, version, event_type, organization_id, project_id, environment,
			correlation_id, idempotency_key, record_id, payload, occurred_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, pair.Event.ID, pair.Event.Version, pair.Event.Type, pair.Event.OrganizationID, pair.Event.ProjectID, pair.Event.Environment, pair.Event.CorrelationID, pair.Event.IdempotencyKey, pair.Event.RecordID, pair.Event.Payload, pair.Event.OccurredAt.UTC())
	if err != nil {
		return outboxPair{}, false, err
	}
	job, err := insertDurableJobTx(tx, pair.Record)
	if err != nil {
		return outboxPair{}, false, err
	}
	pair.Job = job
	return pair, false, nil
}

func loadOutboxPairTx(tx *sql.Tx, projectID int, key string) (outboxPair, bool, error) {
	var pair outboxPair
	err := tx.QueryRow(`
		SELECT r.id, r.project_id, r.organization_id, r.environment, r.idempotency_key, r.name, r.envelope_id,
			e.id, e.version, e.event_type, e.organization_id, e.project_id, e.environment,
			e.correlation_id, e.idempotency_key, e.record_id, e.payload, e.occurred_at
		FROM outbox_records r
		JOIN event_outbox e ON e.record_id = r.id
		WHERE r.project_id = $1 AND r.idempotency_key = $2
	`, projectID, key).Scan(
		&pair.Record.ID, &pair.Record.ProjectID, &pair.Record.OrganizationID, &pair.Record.Environment, &pair.Record.IdempotencyKey, &pair.Record.Name, &pair.Record.EnvelopeID,
		&pair.Event.ID, &pair.Event.Version, &pair.Event.Type, &pair.Event.OrganizationID, &pair.Event.ProjectID, &pair.Event.Environment,
		&pair.Event.CorrelationID, &pair.Event.IdempotencyKey, &pair.Event.RecordID, &pair.Event.Payload, &pair.Event.OccurredAt,
	)
	if err != nil {
		return outboxPair{}, false, err
	}
	pair.Event.OccurredAt = pair.Event.OccurredAt.UTC()
	job, err := loadJobByRecordTx(tx, pair.Record.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return outboxPair{}, false, err
	}
	pair.Job = job
	return pair, true, nil
}
