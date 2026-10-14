package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const outboundSyncMaxAttempts = 3

var (
	errSyncHidden  = errors.New("sync hidden")
	errSyncDenied  = errors.New("sync denied")
	errSyncInvalid = errors.New("sync invalid")
)

type outboundSyncAttempt struct {
	ID             int    `json:"id"`
	ProjectID      int    `json:"project_id"`
	Environment    string `json:"environment"`
	MutationID     string `json:"mutation_id"`
	OriginID       string `json:"origin_id"`
	State          string `json:"state"`
	Attempts       int    `json:"attempts"`
	LocalRevision  int    `json:"local_revision"`
	RemoteRevision int    `json:"remote_revision"`
	Applied        bool   `json:"applied"`
	Reason         string `json:"reason"`
}

type outboundSyncAudit struct {
	ProjectID   int
	ResourceID  string
	ActorUserID int
	Summary     string
}

var (
	loadOutboundSyncGate  = loadOutboundSyncGateFromDB
	saveOutboundSyncGate  = saveOutboundSyncGateToDB
	findOutboundSync      = findOutboundSyncFromDB
	saveOutboundSync      = saveOutboundSyncToDB
	updateOutboundSync    = updateOutboundSyncToDB
	saveOutboundSyncAudit = saveOutboundSyncAuditToDB
)

func setOutboundSync(actor authzSubject, projectID int, environment string, enabled bool) error {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := syncAccess(actor, projectID, environment, true); err != nil {
		return err
	}
	if err := saveOutboundSyncGate(projectID, environment, enabled); err != nil {
		return err
	}
	_ = saveOutboundSyncAudit(outboundSyncAudit{
		ProjectID: projectID, ResourceID: "gate-" + environment, ActorUserID: actor.UserID, Summary: "outbound sync gate saved",
	})
	return nil
}

func deliverOutbound(actor authzSubject, projectID int, environment, mutationID string, revision int) (outboundSyncAttempt, error) {
	return reconcileOutbound(actor, projectID, environment, "", mutationID, revision, revision, "delivered")
}

func reconcileOutbound(actor authzSubject, projectID int, environment, originID, mutationID string, localRevision, remoteRevision int, outcome string) (outboundSyncAttempt, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	originID = strings.TrimSpace(originID)
	mutationID = strings.TrimSpace(mutationID)
	outcome = strings.ToLower(strings.TrimSpace(outcome))
	if err := syncAccess(actor, projectID, environment, true); err != nil || !incidentToken(mutationID) || localRevision < 0 || remoteRevision < 0 {
		if err == nil {
			err = errSyncInvalid
		}
		return outboundSyncAttempt{}, err
	}
	if originID != "" && !incidentToken(originID) {
		return outboundSyncAttempt{}, errSyncInvalid
	}
	enabled, err := loadOutboundSyncGate(projectID, environment)
	if err != nil || !enabled {
		return outboundSyncAttempt{}, errSyncInvalid
	}
	if originID != "" {
		echo, err := findOutboundSync(projectID, environment, originID)
		if err != nil {
			return outboundSyncAttempt{}, err
		}
		if echo.ID > 0 {
			echo.Applied = false
			echo.Reason = "echo suppressed"
			return echo, nil
		}
	}
	current, err := findOutboundSync(projectID, environment, mutationID)
	if err != nil {
		return outboundSyncAttempt{}, err
	}
	if current.ID > 0 {
		return retryOutbound(current, outcome, localRevision, remoteRevision)
	}
	item := outboundSyncAttempt{
		ProjectID: projectID, Environment: environment, MutationID: mutationID, OriginID: originID,
		Attempts: 1, LocalRevision: localRevision, RemoteRevision: remoteRevision,
	}
	switch {
	case remoteRevision != localRevision:
		item.State = "conflict"
		item.Reason = "revision conflict"
	case outcome == "failed" || outcome == "unavailable":
		item.State = "failed"
		item.Reason = "sync failure"
	case outcome == "delivered":
		item.State = "delivered"
		item.Applied = true
	default:
		return outboundSyncAttempt{}, errSyncInvalid
	}
	return saveOutboundSync(item)
}

func retryOutbound(current outboundSyncAttempt, outcome string, localRevision, remoteRevision int) (outboundSyncAttempt, error) {
	current.Applied = false
	switch current.State {
	case "conflict":
		current.Reason = "revision conflict"
		return current, nil
	case "delivered":
		current.Reason = "duplicate delivery"
		return current, nil
	case "echo":
		current.Reason = "echo suppressed"
		return current, nil
	case "failed":
		if current.Attempts >= outboundSyncMaxAttempts || remoteRevision != localRevision {
			if remoteRevision != localRevision {
				current.Reason = "revision conflict"
				return current, nil
			}
			current.Reason = "retry bound reached"
			return current, nil
		}
		if outcome != "failed" && outcome != "unavailable" && outcome != "delivered" {
			return outboundSyncAttempt{}, errSyncInvalid
		}
		current.Attempts++
		if outcome == "delivered" {
			current.State = "delivered"
			current.Applied = true
			current.Reason = ""
		} else {
			current.State = "failed"
			current.Reason = "sync failure"
		}
		return updateOutboundSync(current)
	default:
		return outboundSyncAttempt{}, errSyncInvalid
	}
}

func syncAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errSyncInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errSyncHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errSyncDenied
	}
	return nil
}

func migrateOutboundSyncSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS outbound_sync_gates (
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			enabled BOOLEAN NOT NULL,
			PRIMARY KEY (project_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS outbound_sync_attempts (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			mutation_id TEXT NOT NULL,
			origin_id TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			local_revision INTEGER NOT NULL,
			remote_revision INTEGER NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, environment, mutation_id)
		)
	`)
}

func loadOutboundSyncGateFromDB(projectID int, environment string) (bool, error) {
	if DB == nil {
		return false, errInboxStored
	}
	var enabled bool
	err := DB.QueryRow(`SELECT enabled FROM outbound_sync_gates WHERE project_id = $1 AND environment = $2`, projectID, environment).Scan(&enabled)
	if err != nil {
		return false, nil
	}
	return enabled, nil
}

func saveOutboundSyncGateToDB(projectID int, environment string, enabled bool) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO outbound_sync_gates (project_id, environment, enabled) VALUES ($1,$2,$3)
		ON CONFLICT (project_id, environment) DO UPDATE SET enabled = EXCLUDED.enabled
	`, projectID, environment, enabled)
	return err
}

func findOutboundSyncFromDB(projectID int, environment, mutationID string) (outboundSyncAttempt, error) {
	if DB == nil {
		return outboundSyncAttempt{}, errInboxStored
	}
	var item outboundSyncAttempt
	err := DB.QueryRow(`
		SELECT id, project_id, environment, mutation_id, origin_id, state, attempts, local_revision, remote_revision, reason
		FROM outbound_sync_attempts WHERE project_id = $1 AND environment = $2 AND mutation_id = $3
	`, projectID, environment, mutationID).Scan(
		&item.ID, &item.ProjectID, &item.Environment, &item.MutationID, &item.OriginID, &item.State, &item.Attempts, &item.LocalRevision, &item.RemoteRevision, &item.Reason,
	)
	if err != nil {
		return outboundSyncAttempt{}, nil
	}
	return item, nil
}

func saveOutboundSyncToDB(item outboundSyncAttempt) (outboundSyncAttempt, error) {
	if DB == nil {
		return outboundSyncAttempt{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO outbound_sync_attempts (project_id, environment, mutation_id, origin_id, state, attempts, local_revision, remote_revision, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, item.ProjectID, item.Environment, item.MutationID, item.OriginID, item.State, item.Attempts, item.LocalRevision, item.RemoteRevision, item.Reason).Scan(&item.ID)
	return item, err
}

func updateOutboundSyncToDB(item outboundSyncAttempt) (outboundSyncAttempt, error) {
	if DB == nil {
		return outboundSyncAttempt{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE outbound_sync_attempts SET state = $2, attempts = $3, reason = $4 WHERE id = $1`, item.ID, item.State, item.Attempts, item.Reason)
	return item, err
}

func saveOutboundSyncAuditToDB(item outboundSyncAudit) error {
	if DB == nil {
		return nil
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "outbound_sync",
		ResourceID: item.ResourceID, Action: "outbound_sync", Result: "success", Summary: item.Summary,
	})
	return nil
}

func outboundSyncGateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeSyncError(w, errSyncInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeSyncError(w, errSyncHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Enabled     bool   `json:"enabled"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeSyncError(w, errSyncInvalid)
		return
	}
	if err := setOutboundSync(actor, body.ProjectID, body.Environment, body.Enabled); err != nil {
		writeSyncError(w, err)
		return
	}
	writeSyncJSON(w, map[string]bool{"enabled": body.Enabled})
}

func outboundSyncDeliverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeSyncError(w, errSyncInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeSyncError(w, errSyncHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		MutationID  string `json:"mutation_id"`
		Revision    int    `json:"revision"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeSyncError(w, errSyncInvalid)
		return
	}
	item, err := deliverOutbound(actor, body.ProjectID, body.Environment, body.MutationID, body.Revision)
	if err != nil {
		writeSyncError(w, err)
		return
	}
	writeSyncJSON(w, item)
}

func outboundSyncReconcileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeSyncError(w, errSyncInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeSyncError(w, errSyncHidden)
		return
	}
	var body struct {
		ProjectID      int    `json:"project_id"`
		Environment    string `json:"environment"`
		OriginID       string `json:"origin_id"`
		MutationID     string `json:"mutation_id"`
		LocalRevision  int    `json:"local_revision"`
		RemoteRevision int    `json:"remote_revision"`
		Outcome        string `json:"outcome"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeSyncError(w, errSyncInvalid)
		return
	}
	item, err := reconcileOutbound(actor, body.ProjectID, body.Environment, body.OriginID, body.MutationID, body.LocalRevision, body.RemoteRevision, body.Outcome)
	if err != nil {
		writeSyncError(w, err)
		return
	}
	writeSyncJSON(w, item)
}

func writeSyncJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeSyncError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errSyncHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errSyncDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "sync request failed"})
}
