package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errRiskHidden  = errors.New("risk exception not found")
	errRiskDenied  = errors.New("risk exception is not permitted")
	errRiskInvalid = errors.New("risk exception is invalid")
)

type riskException struct {
	ID                  int                  `json:"id"`
	ProjectID           int                  `json:"project_id"`
	FindingKey          string               `json:"finding_key"`
	AssignmentID        int                  `json:"assignment_id"`
	Environment         string               `json:"environment"`
	Reason              string               `json:"reason"`
	CompensatingControl string               `json:"compensating_control"`
	Evidence            string               `json:"evidence"`
	ApproverUserID      int                  `json:"approver_user_id"`
	RequesterUserID     int                  `json:"requester_user_id"`
	ExpiresAt           time.Time            `json:"expires_at"`
	State               string               `json:"state"`
	RemediationState    string               `json:"remediation_state"`
	Verified            bool                 `json:"verified"`
	AccessGranted       bool                 `json:"access_granted"`
	History             []riskExceptionEvent `json:"history"`
}

type riskExceptionEvent struct {
	ID             int       `json:"id"`
	ExceptionID    int       `json:"exception_id"`
	Action         string    `json:"action"`
	PreviousExpiry time.Time `json:"previous_expiry"`
	NextExpiry     time.Time `json:"next_expiry"`
	ActorUserID    int       `json:"actor_user_id"`
}

type riskExceptionInput struct {
	ProjectID           int
	FindingKey          string
	Environment         string
	Reason              string
	CompensatingControl string
	Evidence            string
	ApproverUserID      int
	ExpiresAt           time.Time
}

var (
	saveRiskException   = saveRiskExceptionToDB
	findRiskException   = findRiskExceptionFromDB
	loadRiskException   = loadRiskExceptionFromDB
	updateRiskException = updateRiskExceptionInDB
	insertRiskEvent     = insertRiskEventToDB
	listRiskEvents      = listRiskEventsFromDB
	listRiskExceptions  = listRiskExceptionsFromDB
	loadRiskAssignment  = findFindingAssignment
	saveRiskAudit       = saveRiskAuditToDB
	exceptionClock      = time.Now
)

func recordRiskException(actor authzSubject, input riskExceptionInput) (riskException, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return riskException{}, errRiskHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return riskException{}, errRiskDenied
	}
	normalized, err := normalizeRiskInput(actor, input)
	if err != nil {
		return riskException{}, err
	}
	assignment, err := loadRiskAssignment(normalized.ProjectID, normalized.FindingKey)
	if err != nil {
		return riskException{}, err
	}
	if assignment.ID <= 0 || assignment.ProjectID != normalized.ProjectID {
		return riskException{}, errRiskInvalid
	}
	existing, err := findRiskException(normalized.ProjectID, normalized.FindingKey, normalized.Environment)
	if err != nil {
		return riskException{}, err
	}
	if existing.ID > 0 {
		return presentRiskException(existing)
	}
	saved, err := saveRiskException(riskException{
		ProjectID: normalized.ProjectID, FindingKey: normalized.FindingKey, AssignmentID: assignment.ID,
		Environment: normalized.Environment, Reason: normalized.Reason, CompensatingControl: normalized.CompensatingControl,
		Evidence: normalized.Evidence, ApproverUserID: normalized.ApproverUserID, RequesterUserID: actor.UserID,
		ExpiresAt: normalized.ExpiresAt.UTC(), State: "active",
	})
	if err != nil {
		return riskException{}, err
	}
	_ = saveRiskAudit(riskAuditRecord{ProjectID: saved.ProjectID, FindingKey: saved.FindingKey, ActorUserID: actor.UserID, Summary: "risk acceptance recorded"})
	return presentRiskException(saved)
}

func normalizeRiskInput(actor authzSubject, input riskExceptionInput) (riskException, error) {
	item := riskException{
		ProjectID: input.ProjectID, FindingKey: strings.TrimSpace(input.FindingKey),
		Environment: strings.ToLower(strings.TrimSpace(input.Environment)),
		Reason:      strings.TrimSpace(input.Reason), CompensatingControl: strings.TrimSpace(input.CompensatingControl),
		Evidence: strings.TrimSpace(input.Evidence), ApproverUserID: input.ApproverUserID, ExpiresAt: input.ExpiresAt.UTC(),
	}
	if item.FindingKey == "" || strings.Contains(item.FindingKey, " ") || strings.Contains(item.FindingKey, "\n") || len(item.FindingKey) > 128 {
		return riskException{}, errRiskInvalid
	}
	if !singleEnvironment(item.Environment) || item.Reason == "" || strings.EqualFold(item.Reason, "healthy") || len(item.Reason) > 2000 {
		return riskException{}, errRiskInvalid
	}
	if item.CompensatingControl == "" || len(item.CompensatingControl) > 2000 || item.Evidence == "" || len(item.Evidence) > 4000 {
		return riskException{}, errRiskInvalid
	}
	if item.ApproverUserID <= 0 || item.ApproverUserID == actor.UserID || !item.ExpiresAt.After(exceptionClock()) {
		return riskException{}, errRiskInvalid
	}
	return item, nil
}

func singleEnvironment(environment string) bool {
	if environment == "" || environment == "*" || environment == "all" || strings.ContainsAny(environment, " \n,") || len(environment) > 64 {
		return false
	}
	return true
}

func renewRiskException(actor authzSubject, exceptionID, approverUserID int, expiresAt time.Time) (riskException, error) {
	current, err := loadRiskException(exceptionID)
	if err != nil || current.ID <= 0 {
		return riskException{}, errRiskHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return riskException{}, errRiskHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return riskException{}, errRiskDenied
	}
	expiresAt = expiresAt.UTC()
	if approverUserID <= 0 || approverUserID == actor.UserID || !expiresAt.After(exceptionClock()) {
		return riskException{}, errRiskInvalid
	}
	if expiresAt.Unix() == current.ExpiresAt.UTC().Unix() {
		return presentRiskException(current)
	}
	if _, err := insertRiskEvent(riskExceptionEvent{
		ExceptionID: current.ID, Action: "renew", PreviousExpiry: current.ExpiresAt.UTC(), NextExpiry: expiresAt, ActorUserID: actor.UserID,
	}); err != nil {
		return riskException{}, err
	}
	current.ExpiresAt = expiresAt
	current.ApproverUserID = approverUserID
	current.State = "active"
	if _, err := updateRiskException(current); err != nil {
		return riskException{}, err
	}
	_ = saveRiskAudit(riskAuditRecord{ProjectID: current.ProjectID, FindingKey: current.FindingKey, ActorUserID: actor.UserID, Summary: "risk acceptance renewed"})
	current.History = nil
	return presentRiskException(current)
}

func reviewRiskExceptions(actor authzSubject, projectID int, findingKey string) ([]riskException, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return nil, errRiskHidden
	}
	findingKey = strings.TrimSpace(findingKey)
	items, err := listRiskExceptions(projectID, findingKey)
	if err != nil {
		return nil, err
	}
	reviewed := make([]riskException, 0, len(items))
	for _, item := range items {
		if item.ProjectID != projectID {
			continue
		}
		next, err := evaluateRiskExpiry(item)
		if err != nil {
			return nil, err
		}
		presented, err := presentRiskException(next)
		if err != nil {
			return nil, err
		}
		reviewed = append(reviewed, presented)
	}
	return reviewed, nil
}

func evaluateRiskExpiry(item riskException) (riskException, error) {
	if item.ExpiresAt.After(exceptionClock()) {
		return item, nil
	}
	if item.State == "review" {
		return item, nil
	}
	item.State = "review"
	return updateRiskException(item)
}

func presentRiskException(item riskException) (riskException, error) {
	next, err := evaluateRiskExpiry(item)
	if err != nil {
		return riskException{}, err
	}
	item = next
	if item.History == nil {
		history, err := listRiskEvents(item.ID)
		if err != nil {
			return riskException{}, err
		}
		item.History = history
	}
	item.RemediationState = ""
	item.Verified = false
	item.AccessGranted = false
	if item.State != "active" && item.State != "review" {
		item.State = "review"
	}
	return item, nil
}

type riskAuditRecord struct {
	ProjectID   int
	FindingKey  string
	ActorUserID int
	Summary     string
}

func migrateRiskExceptionSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS risk_exceptions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			finding_key VARCHAR(128) NOT NULL,
			assignment_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			reason TEXT NOT NULL,
			compensating_control TEXT NOT NULL,
			evidence TEXT NOT NULL,
			approver_user_id INTEGER NOT NULL,
			requester_user_id INTEGER NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			state VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, finding_key, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS risk_exception_events (
			id SERIAL PRIMARY KEY,
			exception_id INTEGER NOT NULL,
			action VARCHAR(32) NOT NULL,
			previous_expiry TIMESTAMP NOT NULL,
			next_expiry TIMESTAMP NOT NULL,
			actor_user_id INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveRiskExceptionToDB(item riskException) (riskException, error) {
	if DB == nil {
		return riskException{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO risk_exceptions (
			project_id, finding_key, assignment_id, environment, reason, compensating_control, evidence,
			approver_user_id, requester_user_id, expires_at, state
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
	`, item.ProjectID, item.FindingKey, item.AssignmentID, item.Environment, item.Reason, item.CompensatingControl, item.Evidence,
		item.ApproverUserID, item.RequesterUserID, item.ExpiresAt.UTC(), item.State).Scan(&item.ID)
	return item, err
}

func scanRiskException(query string, args ...interface{}) (riskException, error) {
	var item riskException
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.FindingKey, &item.AssignmentID, &item.Environment, &item.Reason,
		&item.CompensatingControl, &item.Evidence, &item.ApproverUserID, &item.RequesterUserID, &item.ExpiresAt, &item.State,
	)
	if err != nil {
		return riskException{}, err
	}
	item.ExpiresAt = item.ExpiresAt.UTC()
	return item, nil
}

func findRiskExceptionFromDB(projectID int, findingKey, environment string) (riskException, error) {
	if DB == nil {
		return riskException{}, nil
	}
	item, err := scanRiskException(`
		SELECT id, project_id, finding_key, assignment_id, environment, reason, compensating_control, evidence, approver_user_id, requester_user_id, expires_at, state
		FROM risk_exceptions WHERE project_id = $1 AND finding_key = $2 AND environment = $3
	`, projectID, findingKey, environment)
	if err != nil {
		return riskException{}, nil
	}
	return item, nil
}

func loadRiskExceptionFromDB(id int) (riskException, error) {
	if DB == nil || id <= 0 {
		return riskException{}, errRiskHidden
	}
	item, err := scanRiskException(`
		SELECT id, project_id, finding_key, assignment_id, environment, reason, compensating_control, evidence, approver_user_id, requester_user_id, expires_at, state
		FROM risk_exceptions WHERE id = $1
	`, id)
	if err != nil || item.ID <= 0 {
		return riskException{}, errRiskHidden
	}
	return item, nil
}

func updateRiskExceptionInDB(item riskException) (riskException, error) {
	if DB == nil {
		return riskException{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE risk_exceptions SET expires_at = $2, state = $3, approver_user_id = $4 WHERE id = $1
	`, item.ID, item.ExpiresAt.UTC(), item.State, item.ApproverUserID)
	return item, err
}

func insertRiskEventToDB(item riskExceptionEvent) (riskExceptionEvent, error) {
	if DB == nil {
		return riskExceptionEvent{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO risk_exception_events (exception_id, action, previous_expiry, next_expiry, actor_user_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, item.ExceptionID, item.Action, item.PreviousExpiry.UTC(), item.NextExpiry.UTC(), item.ActorUserID).Scan(&item.ID)
	return item, err
}

func listRiskEventsFromDB(exceptionID int) ([]riskExceptionEvent, error) {
	if DB == nil || exceptionID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, exception_id, action, previous_expiry, next_expiry, actor_user_id
		FROM risk_exception_events WHERE exception_id = $1 ORDER BY id
	`, exceptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []riskExceptionEvent
	for rows.Next() {
		var item riskExceptionEvent
		if err := rows.Scan(&item.ID, &item.ExceptionID, &item.Action, &item.PreviousExpiry, &item.NextExpiry, &item.ActorUserID); err != nil {
			return nil, err
		}
		item.PreviousExpiry = item.PreviousExpiry.UTC()
		item.NextExpiry = item.NextExpiry.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func listRiskExceptionsFromDB(projectID int, findingKey string) ([]riskException, error) {
	if DB == nil || projectID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, finding_key, assignment_id, environment, reason, compensating_control, evidence, approver_user_id, requester_user_id, expires_at, state
		FROM risk_exceptions WHERE project_id = $1 AND finding_key = $2 ORDER BY id
	`, projectID, findingKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []riskException
	for rows.Next() {
		var item riskException
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.FindingKey, &item.AssignmentID, &item.Environment, &item.Reason, &item.CompensatingControl, &item.Evidence, &item.ApproverUserID, &item.RequesterUserID, &item.ExpiresAt, &item.State); err != nil {
			return nil, err
		}
		item.ExpiresAt = item.ExpiresAt.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveRiskAuditToDB(item riskAuditRecord) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "risk_exception",
		ResourceID: item.FindingKey, Action: "risk_exception", Result: "success", Summary: item.Summary,
	})
	return nil
}

func riskExceptionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ProjectID           int       `json:"project_id"`
		FindingKey          string    `json:"finding_key"`
		Environment         string    `json:"environment"`
		Reason              string    `json:"reason"`
		CompensatingControl string    `json:"compensating_control"`
		Evidence            string    `json:"evidence"`
		ApproverUserID      int       `json:"approver_user_id"`
		ExpiresAt           time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeRiskError(w, r, errRiskInvalid)
		return
	}
	saved, err := recordRiskException(actor, riskExceptionInput{
		ProjectID: body.ProjectID, FindingKey: body.FindingKey, Environment: body.Environment, Reason: body.Reason,
		CompensatingControl: body.CompensatingControl, Evidence: body.Evidence, ApproverUserID: body.ApproverUserID, ExpiresAt: body.ExpiresAt,
	})
	if err != nil {
		writeRiskError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func riskExceptionRenewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ExceptionID    int       `json:"exception_id"`
		ApproverUserID int       `json:"approver_user_id"`
		ExpiresAt      time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeRiskError(w, r, errRiskInvalid)
		return
	}
	saved, err := renewRiskException(actor, body.ExceptionID, body.ApproverUserID, body.ExpiresAt)
	if err != nil {
		writeRiskError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func riskExceptionReviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	items, err := reviewRiskExceptions(actor, projectID, r.URL.Query().Get("finding_key"))
	if err != nil {
		writeRiskError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, items)
}

func writeRiskError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errRiskHidden):
		writeAPIError(w, r, http.StatusNotFound, errRiskHidden.Error(), nil)
	case errors.Is(err, errRiskDenied):
		writeAPIError(w, r, http.StatusForbidden, errRiskDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errRiskInvalid.Error(), nil)
	}
}
