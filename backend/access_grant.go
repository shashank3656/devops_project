package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const accessMaxSessionMinutes = 60

var (
	errEntitlementHidden  = errors.New("entitlement hidden")
	errEntitlementDenied  = errors.New("entitlement denied")
	errEntitlementInvalid = errors.New("entitlement invalid")
)

type accessGrant struct {
	ID                int    `json:"id"`
	ProjectID         int    `json:"project_id"`
	Environment       string `json:"environment"`
	Target            string `json:"target"`
	Reason            string `json:"reason"`
	Provider          string `json:"provider"`
	Executor          string `json:"executor"`
	DurationMinutes   int    `json:"duration_minutes"`
	MaxSessionMinutes int    `json:"max_session_minutes"`
	ApproverID        int    `json:"approver_id"`
	ReviewerID        int    `json:"reviewer_id"`
	State             string `json:"state"`
	Entitled          bool   `json:"entitled"`
	ResidualSession   bool   `json:"residual_session"`
	Observed          string `json:"observed"`
	Applied           bool   `json:"applied"`
}

var (
	findAccessGrant   = findAccessGrantFromDB
	saveAccessGrant   = saveAccessGrantToDB
	loadAccessGrant   = loadAccessGrantFromDB
	updateAccessGrant = updateAccessGrantToDB
	listAccessGrants  = listAccessGrantsFromDB
	saveAccessAudit   = saveAccessAuditToDB
)

func approveAccessGrant(actor authzSubject, projectID int, environment, target, reason, provider, executor, decision string, duration, approverID int) (accessGrant, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	target = strings.TrimSpace(target)
	reason = strings.TrimSpace(reason)
	provider = strings.ToLower(strings.TrimSpace(provider))
	executor = strings.TrimSpace(executor)
	decision = strings.ToLower(strings.TrimSpace(decision))
	if err := entitlementAccess(actor, projectID, environment, true); err != nil {
		return accessGrant{}, err
	}
	if decision != "approved" || !entitlementInput(target, reason, executor, provider, duration, approverID, actor.UserID) {
		return accessGrant{}, errEntitlementInvalid
	}
	current, err := findAccessGrant(projectID, environment, target)
	if err != nil {
		return accessGrant{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	item := accessGrant{
		ProjectID: projectID, Environment: environment, Target: target, Reason: reason, Provider: provider,
		Executor: executor, DurationMinutes: duration, MaxSessionMinutes: accessMaxSessionMinutes, ApproverID: approverID,
		State: "approved", Entitled: true, ResidualSession: true, Observed: "unknown", Applied: true,
	}
	saved, err := saveAccessGrant(item)
	if err != nil {
		return accessGrant{}, err
	}
	_ = saveAccessAudit(projectID, target, actor.UserID, "access grant approved")
	return saved, nil
}

func expireAccessGrant(actor authzSubject, grantID int) (accessGrant, error) {
	item, err := loadAccessGrant(grantID)
	if err != nil || item.ID == 0 {
		return accessGrant{}, errEntitlementHidden
	}
	if err := entitlementAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return accessGrant{}, err
	}
	if item.State == "revocation_failed" {
		return accessGrant{}, errEntitlementInvalid
	}
	if item.State == "expired" || item.State == "revoked" {
		item.Applied = false
		return item, nil
	}
	if item.State != "approved" {
		return accessGrant{}, errEntitlementInvalid
	}
	item.State = "expired"
	item.Entitled = false
	item.ResidualSession = true
	item.Observed = "unknown"
	item.Applied = true
	saved, err := updateAccessGrant(item)
	if err != nil {
		return accessGrant{}, err
	}
	_ = saveAccessAudit(item.ProjectID, item.Target, actor.UserID, "access grant expired")
	return saved, nil
}

func failAccessRevocation(actor authzSubject, grantID int) (accessGrant, error) {
	item, err := loadAccessGrant(grantID)
	if err != nil || item.ID == 0 {
		return accessGrant{}, errEntitlementHidden
	}
	if err := entitlementAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return accessGrant{}, err
	}
	if item.State == "revocation_failed" {
		item.Applied = false
		return item, nil
	}
	if item.State != "approved" {
		return accessGrant{}, errEntitlementInvalid
	}
	item.State = "revocation_failed"
	item.Entitled = true
	item.ResidualSession = true
	item.Observed = "unknown"
	item.Applied = true
	return updateAccessGrant(item)
}

func verifyAccessRevocation(actor authzSubject, grantID, reviewerID int) (accessGrant, error) {
	item, err := loadAccessGrant(grantID)
	if err != nil || item.ID == 0 {
		return accessGrant{}, errEntitlementHidden
	}
	if err := entitlementAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return accessGrant{}, err
	}
	if item.State != "revocation_failed" || reviewerID <= 0 || reviewerID == actor.UserID {
		return accessGrant{}, errEntitlementInvalid
	}
	item.State = "revoked"
	item.Entitled = false
	item.ResidualSession = true
	item.ReviewerID = reviewerID
	item.Observed = "unknown"
	item.Applied = true
	saved, err := updateAccessGrant(item)
	if err != nil {
		return accessGrant{}, err
	}
	_ = saveAccessAudit(item.ProjectID, item.Target, actor.UserID, "access revocation verified")
	return saved, nil
}

func readAccessGrants(actor authzSubject, projectID int, environment string) ([]accessGrant, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := entitlementAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listAccessGrants(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []accessGrant{}
	}
	return items, nil
}

func entitlementInput(target, reason, executor, provider string, duration, approverID, actorID int) bool {
	if !incidentToken(target) || !incidentToken(executor) || provider != "sandbox" {
		return false
	}
	if reason == "" || len(reason) > 500 || pilotSensitive(reason) || pilotSensitive(target) || pilotSensitive(executor) {
		return false
	}
	if duration <= 0 || duration > accessMaxSessionMinutes {
		return false
	}
	return approverID > 0 && approverID != actorID
}

func entitlementAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errEntitlementInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errEntitlementHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errEntitlementDenied
	}
	return nil
}

func migrateAccessGrantSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS access_grants (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			target_key TEXT NOT NULL,
			reason TEXT NOT NULL,
			provider TEXT NOT NULL,
			executor_name TEXT NOT NULL,
			duration_minutes INTEGER NOT NULL,
			max_session_minutes INTEGER NOT NULL,
			approver_id INTEGER NOT NULL,
			reviewer_id INTEGER NOT NULL DEFAULT 0,
			state TEXT NOT NULL,
			entitled BOOLEAN NOT NULL,
			residual_session BOOLEAN NOT NULL,
			observed TEXT NOT NULL,
			UNIQUE (project_id, environment, target_key)
		)
	`)
}

func findAccessGrantFromDB(projectID int, environment, target string) (accessGrant, error) {
	if DB == nil {
		return accessGrant{}, errInboxStored
	}
	item, err := scanAccessGrant(`SELECT id, project_id, environment, target_key, reason, provider, executor_name, duration_minutes, max_session_minutes, approver_id, reviewer_id, state, entitled, residual_session, observed FROM access_grants WHERE project_id = $1 AND environment = $2 AND target_key = $3`, projectID, environment, target)
	if err != nil {
		return accessGrant{}, nil
	}
	return item, nil
}

func saveAccessGrantToDB(item accessGrant) (accessGrant, error) {
	if DB == nil {
		return accessGrant{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO access_grants (project_id, environment, target_key, reason, provider, executor_name, duration_minutes, max_session_minutes, approver_id, reviewer_id, state, entitled, residual_session, observed)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id
	`, item.ProjectID, item.Environment, item.Target, item.Reason, item.Provider, item.Executor, item.DurationMinutes, item.MaxSessionMinutes, item.ApproverID, item.ReviewerID, item.State, item.Entitled, item.ResidualSession, item.Observed).Scan(&item.ID)
	return item, err
}

func loadAccessGrantFromDB(id int) (accessGrant, error) {
	if DB == nil {
		return accessGrant{}, errInboxStored
	}
	item, err := scanAccessGrant(`SELECT id, project_id, environment, target_key, reason, provider, executor_name, duration_minutes, max_session_minutes, approver_id, reviewer_id, state, entitled, residual_session, observed FROM access_grants WHERE id = $1`, id)
	if err != nil {
		return accessGrant{}, nil
	}
	return item, nil
}

func updateAccessGrantToDB(item accessGrant) (accessGrant, error) {
	if DB == nil {
		return accessGrant{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE access_grants SET state = $2, entitled = $3, residual_session = $4, reviewer_id = $5, observed = $6 WHERE id = $1`, item.ID, item.State, item.Entitled, item.ResidualSession, item.ReviewerID, item.Observed)
	return item, err
}

func listAccessGrantsFromDB(projectID int, environment string) ([]accessGrant, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, target_key, reason, provider, executor_name, duration_minutes, max_session_minutes, approver_id, reviewer_id, state, entitled, residual_session, observed FROM access_grants WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []accessGrant
	for rows.Next() {
		var item accessGrant
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Target, &item.Reason, &item.Provider, &item.Executor, &item.DurationMinutes, &item.MaxSessionMinutes, &item.ApproverID, &item.ReviewerID, &item.State, &item.Entitled, &item.ResidualSession, &item.Observed); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanAccessGrant(query string, args ...any) (accessGrant, error) {
	var item accessGrant
	err := DB.QueryRow(query, args...).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Target, &item.Reason, &item.Provider, &item.Executor, &item.DurationMinutes, &item.MaxSessionMinutes, &item.ApproverID, &item.ReviewerID, &item.State, &item.Entitled, &item.ResidualSession, &item.Observed)
	return item, err
}

func saveAccessAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "access_grant",
		ResourceID: resourceID, Action: "access_grant", Result: "success", Summary: summary,
	})
	return nil
}

func accessGrantHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeEntitlementError(w, errEntitlementHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeEntitlementError(w, errEntitlementInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readAccessGrants(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeEntitlementError(w, err)
			return
		}
		writeEntitlementJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Target      string `json:"target"`
		Reason      string `json:"reason"`
		Provider    string `json:"provider"`
		Executor    string `json:"executor"`
		Decision    string `json:"decision"`
		Duration    int    `json:"duration_minutes"`
		ApproverID  int    `json:"approver_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	item, err := approveAccessGrant(actor, body.ProjectID, body.Environment, body.Target, body.Reason, body.Provider, body.Executor, body.Decision, body.Duration, body.ApproverID)
	if err != nil {
		writeEntitlementError(w, err)
		return
	}
	writeEntitlementJSON(w, item)
}

func accessExpireHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeEntitlementError(w, errEntitlementHidden)
		return
	}
	var body struct {
		GrantID int `json:"grant_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	item, err := expireAccessGrant(actor, body.GrantID)
	if err != nil {
		writeEntitlementError(w, err)
		return
	}
	writeEntitlementJSON(w, item)
}

func accessRevokeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeEntitlementError(w, errEntitlementHidden)
		return
	}
	var body struct {
		GrantID int `json:"grant_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	item, err := failAccessRevocation(actor, body.GrantID)
	if err != nil {
		writeEntitlementError(w, err)
		return
	}
	writeEntitlementJSON(w, item)
}

func accessVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeEntitlementError(w, errEntitlementHidden)
		return
	}
	var body struct {
		GrantID    int `json:"grant_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeEntitlementError(w, errEntitlementInvalid)
		return
	}
	item, err := verifyAccessRevocation(actor, body.GrantID, body.ReviewerID)
	if err != nil {
		writeEntitlementError(w, err)
		return
	}
	writeEntitlementJSON(w, item)
}

func writeEntitlementJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeEntitlementError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errEntitlementHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errEntitlementDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "entitlement request failed"})
}
