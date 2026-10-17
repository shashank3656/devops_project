package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errChangeHidden  = errors.New("change request not found")
	errChangeDenied  = errors.New("change request is not permitted")
	errChangeInvalid = errors.New("change request is invalid")
	errChangeStale   = errors.New("change source revision is stale")
	errChangeRelease = errors.New("external approved status cannot release a deployment")
	errChangeClosure = errors.New("closure requires outcome and review evidence")
)

type changeRequest struct {
	ID                 int    `json:"id"`
	ProjectID          int    `json:"project_id"`
	Environment        string `json:"environment"`
	ChangeType         string `json:"change_type"`
	ExternalID         string `json:"external_id,omitempty"`
	SourceRevision     int    `json:"source_revision"`
	SourceStatus       string `json:"source_status"`
	LocalState         string `json:"local_state"`
	Source             string `json:"source"`
	CreatorUserID      int    `json:"creator_user_id,omitempty"`
	ConnectionID       int    `json:"connection_id,omitempty"`
	EventID            string `json:"event_id,omitempty"`
	IdempotencyKey     string `json:"idempotency_key,omitempty"`
	CommitSHA          string `json:"commit_sha"`
	ImageDigest        string `json:"image_digest"`
	Owner              string `json:"owner"`
	Impact             string `json:"impact"`
	Risk               string `json:"risk"`
	Window             string `json:"window"`
	ImplementationPlan string `json:"implementation_plan"`
	ValidationPlan     string `json:"validation_plan"`
	RollbackPlan       string `json:"rollback_plan"`
	ApprovalID         int    `json:"approval_id,omitempty"`
	ApprovalState      string `json:"approval_state"`
	AttemptID          int    `json:"attempt_id,omitempty"`
	ProblemID          int    `json:"problem_id,omitempty"`
	ClosureOutcome     string `json:"closure_outcome,omitempty"`
	ClosureReview      string `json:"closure_review,omitempty"`
}

type changeSubmission struct {
	Change     changeRequest `json:"change"`
	Values     changeRequest `json:"values"`
	Errors     []string      `json:"errors"`
	FirstError string        `json:"first_error,omitempty"`
	Duplicate  bool          `json:"duplicate"`
	Execution  bool          `json:"execution_requested"`
}

var (
	saveChangeRequest    = saveChangeRequestToDB
	loadChangeRequest    = loadChangeRequestFromDB
	listLifecycleChanges = listLifecycleChangesFromDB
)

func submitChange(actor authzSubject, item changeRequest) (changeSubmission, error) {
	item = normalizeChange(item)
	result := changeSubmission{Values: item, Execution: false}
	if !mappingAllowed(actor, item.ProjectID, authzRead) {
		return result, errChangeHidden
	}
	if !mappingAllowed(actor, item.ProjectID, authzWrite) {
		return result, errChangeDenied
	}
	if errs := changeFieldErrors(item); len(errs) > 0 {
		result.Errors = errs
		result.FirstError = errs[0]
		return result, errChangeInvalid
	}
	existing, found, err := findChange(item)
	if err != nil {
		return result, err
	}
	if found && sameChangeDelivery(existing, item) {
		result.Change = existing
		result.Duplicate = true
		return result, nil
	}
	if found && item.SourceRevision > 0 && item.SourceRevision < existing.SourceRevision {
		result.Change = existing
		return result, errChangeStale
	}
	if found {
		item.ID = existing.ID
		item.LocalState = existing.LocalState
		item.ApprovalID = existing.ApprovalID
		item.ApprovalState = existing.ApprovalState
		item.AttemptID = existing.AttemptID
		item.ProblemID = keepPositive(item.ProblemID, existing.ProblemID)
		item.ClosureOutcome = existing.ClosureOutcome
		item.ClosureReview = existing.ClosureReview
		if item.Source == "" {
			item.Source = existing.Source
		}
		if found && artifactChanged(existing, item) && existing.ApprovalState == "approved" {
			item.ApprovalState = "invalidated"
			item.LocalState = "assessing"
		}
		if item.SourceStatus == "" {
			item.SourceStatus = existing.SourceStatus
		}
		saved, err := saveChangeRequest(item)
		if err != nil {
			return result, err
		}
		result.Change = saved
		result.Values = saved
		return result, nil
	}
	item.LocalState = "assessing"
	item.ApprovalState = "none"
	if item.SourceStatus == "" {
		item.SourceStatus = "unknown"
	}
	saved, err := saveChangeRequest(item)
	if err != nil {
		return result, err
	}
	result.Change = saved
	result.Values = saved
	return result, nil
}

func normalizeChange(item changeRequest) changeRequest {
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	item.ChangeType = strings.ToLower(strings.TrimSpace(item.ChangeType))
	item.Source = strings.ToLower(strings.TrimSpace(item.Source))
	item.SourceStatus = strings.ToLower(strings.TrimSpace(item.SourceStatus))
	item.ExternalID = strings.TrimSpace(item.ExternalID)
	item.EventID = strings.TrimSpace(item.EventID)
	item.IdempotencyKey = strings.TrimSpace(item.IdempotencyKey)
	item.CommitSHA = strings.TrimSpace(item.CommitSHA)
	item.ImageDigest = strings.TrimSpace(item.ImageDigest)
	item.Owner = strings.TrimSpace(item.Owner)
	item.Impact = strings.TrimSpace(item.Impact)
	item.Risk = strings.TrimSpace(item.Risk)
	item.Window = strings.TrimSpace(item.Window)
	item.ImplementationPlan = strings.TrimSpace(item.ImplementationPlan)
	item.ValidationPlan = strings.TrimSpace(item.ValidationPlan)
	item.RollbackPlan = strings.TrimSpace(item.RollbackPlan)
	return item
}

func changeFieldErrors(item changeRequest) []string {
	var errs []string
	if item.ProjectID <= 0 {
		errs = append(errs, "project_id")
	}
	if item.Environment == "" {
		errs = append(errs, "environment")
	}
	if item.ChangeType != "normal" && item.ChangeType != "standard" && item.ChangeType != "emergency" {
		errs = append(errs, "change_type")
	}
	if item.Owner == "" {
		errs = append(errs, "owner")
	}
	if item.Impact == "" {
		errs = append(errs, "impact")
	}
	if item.Risk == "" {
		errs = append(errs, "risk")
	}
	if item.Window == "" {
		errs = append(errs, "window")
	}
	if item.ImplementationPlan == "" {
		errs = append(errs, "implementation_plan")
	}
	if item.ValidationPlan == "" {
		errs = append(errs, "validation_plan")
	}
	if item.RollbackPlan == "" {
		errs = append(errs, "rollback_plan")
	}
	if item.CommitSHA == "" {
		errs = append(errs, "commit_sha")
	}
	if item.ImageDigest == "" || item.ImageDigest == item.CommitSHA {
		errs = append(errs, "image_digest")
	}
	if item.Source == "webhook" {
		if item.ConnectionID <= 0 {
			errs = append(errs, "connection_id")
		}
		if item.EventID == "" {
			errs = append(errs, "event_id")
		}
		if item.ExternalID == "" {
			errs = append(errs, "external_id")
		}
	} else if item.Source == "ui" {
		if item.IdempotencyKey == "" {
			errs = append(errs, "idempotency_key")
		}
		if item.CreatorUserID <= 0 {
			errs = append(errs, "creator_user_id")
		}
	} else {
		errs = append(errs, "source")
	}
	return errs
}

func findChange(item changeRequest) (changeRequest, bool, error) {
	rows, err := listLifecycleChanges(item.ProjectID)
	if err != nil {
		return changeRequest{}, false, err
	}
	for _, row := range rows {
		if sameChangeDelivery(row, item) {
			return row, true, nil
		}
	}
	for _, row := range rows {
		if item.ExternalID != "" && row.ExternalID == item.ExternalID {
			return row, true, nil
		}
	}
	return changeRequest{}, false, nil
}

func sameChangeDelivery(existing, item changeRequest) bool {
	if item.Source == "ui" && item.IdempotencyKey != "" && existing.IdempotencyKey == item.IdempotencyKey && existing.CreatorUserID == item.CreatorUserID {
		return true
	}
	return item.Source == "webhook" && item.EventID != "" && existing.ConnectionID == item.ConnectionID && existing.EventID == item.EventID
}

func artifactChanged(existing, item changeRequest) bool {
	return existing.CommitSHA != item.CommitSHA || existing.ImageDigest != item.ImageDigest || existing.Environment != item.Environment
}

func keepPositive(next, previous int) int {
	if next > 0 {
		return next
	}
	return previous
}

func approveChange(actor authzSubject, changeID, approvalID int) (changeRequest, error) {
	saved, err := loadChangeRequest(changeID)
	if err != nil || saved.ID <= 0 {
		return changeRequest{}, errChangeHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return changeRequest{}, errChangeHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return changeRequest{}, errChangeDenied
	}
	approval, err := loadApprovalSubject(approvalID)
	if err != nil || approval.ID <= 0 || approval.ProjectID != saved.ProjectID {
		return changeRequest{}, errChangeHidden
	}
	if approval.State != "approved" || approval.CommitHash != saved.CommitSHA || approval.Environment != saved.Environment {
		return changeRequest{}, errChangeInvalid
	}
	saved.ApprovalID = approval.ID
	saved.ApprovalState = "approved"
	saved.LocalState = "approved"
	return saveChangeRequest(saved)
}

func releaseChange(actor authzSubject, changeID int) (changeSubmission, error) {
	saved, err := loadChangeRequest(changeID)
	if err != nil || saved.ID <= 0 {
		return changeSubmission{}, errChangeHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return changeSubmission{}, errChangeHidden
	}
	result := changeSubmission{Change: saved, Values: saved, Execution: false}
	return result, errChangeRelease
}

func closeChange(actor authzSubject, changeID int, outcome, review string) (changeRequest, error) {
	saved, err := loadChangeRequest(changeID)
	if err != nil || saved.ID <= 0 {
		return changeRequest{}, errChangeHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return changeRequest{}, errChangeHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return changeRequest{}, errChangeDenied
	}
	outcome = strings.TrimSpace(outcome)
	review = strings.TrimSpace(review)
	if outcome == "" || review == "" {
		return saved, errChangeClosure
	}
	saved.ClosureOutcome = outcome
	saved.ClosureReview = review
	saved.LocalState = "closed"
	return saveChangeRequest(saved)
}

func changeQueue(actor authzSubject, projectID int) ([]changeRequest, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return nil, errChangeHidden
	}
	rows, err := listLifecycleChanges(projectID)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []changeRequest{}
	}
	return rows, nil
}

func migrateChangeSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS lifecycle_changes (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			change_type VARCHAR(32) NOT NULL,
			external_id VARCHAR(128) NOT NULL DEFAULT '',
			source_revision INTEGER NOT NULL DEFAULT 0,
			source_status VARCHAR(64) NOT NULL,
			local_state VARCHAR(32) NOT NULL,
			source VARCHAR(16) NOT NULL,
			creator_user_id INTEGER NOT NULL DEFAULT 0,
			connection_id INTEGER NOT NULL DEFAULT 0,
			event_id VARCHAR(128) NOT NULL DEFAULT '',
			idempotency_key VARCHAR(128) NOT NULL DEFAULT '',
			commit_sha VARCHAR(128) NOT NULL,
			image_digest VARCHAR(256) NOT NULL,
			owner VARCHAR(120) NOT NULL,
			impact TEXT NOT NULL,
			risk TEXT NOT NULL,
			change_window TEXT NOT NULL,
			implementation_plan TEXT NOT NULL,
			validation_plan TEXT NOT NULL,
			rollback_plan TEXT NOT NULL,
			approval_id INTEGER NOT NULL DEFAULT 0,
			approval_state VARCHAR(32) NOT NULL,
			attempt_id INTEGER NOT NULL DEFAULT 0,
			problem_id INTEGER NOT NULL DEFAULT 0,
			closure_outcome TEXT NOT NULL DEFAULT '',
			closure_review TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveChangeRequestToDB(item changeRequest) (changeRequest, error) {
	if DB == nil {
		return changeRequest{}, errInboxStored
	}
	if item.ID > 0 {
		_, err := DB.Exec(`
			UPDATE lifecycle_changes SET
				environment=$2, change_type=$3, external_id=$4, source_revision=$5, source_status=$6, local_state=$7,
				source=$8, creator_user_id=$9, connection_id=$10, event_id=$11, idempotency_key=$12, commit_sha=$13,
				image_digest=$14, owner=$15, impact=$16, risk=$17, change_window=$18, implementation_plan=$19,
				validation_plan=$20, rollback_plan=$21, approval_id=$22, approval_state=$23, attempt_id=$24,
				problem_id=$25, closure_outcome=$26, closure_review=$27
			WHERE id=$1
		`, item.ID, item.Environment, item.ChangeType, item.ExternalID, item.SourceRevision, item.SourceStatus, item.LocalState,
			item.Source, item.CreatorUserID, item.ConnectionID, item.EventID, item.IdempotencyKey, item.CommitSHA,
			item.ImageDigest, item.Owner, item.Impact, item.Risk, item.Window, item.ImplementationPlan,
			item.ValidationPlan, item.RollbackPlan, item.ApprovalID, item.ApprovalState, item.AttemptID,
			item.ProblemID, item.ClosureOutcome, item.ClosureReview)
		return item, err
	}
	err := DB.QueryRow(`
		INSERT INTO lifecycle_changes (
			project_id, environment, change_type, external_id, source_revision, source_status, local_state, source,
			creator_user_id, connection_id, event_id, idempotency_key, commit_sha, image_digest, owner, impact, risk,
			change_window, implementation_plan, validation_plan, rollback_plan, approval_id, approval_state, attempt_id,
			problem_id, closure_outcome, closure_review
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
		RETURNING id
	`, item.ProjectID, item.Environment, item.ChangeType, item.ExternalID, item.SourceRevision, item.SourceStatus, item.LocalState,
		item.Source, item.CreatorUserID, item.ConnectionID, item.EventID, item.IdempotencyKey, item.CommitSHA,
		item.ImageDigest, item.Owner, item.Impact, item.Risk, item.Window, item.ImplementationPlan,
		item.ValidationPlan, item.RollbackPlan, item.ApprovalID, item.ApprovalState, item.AttemptID,
		item.ProblemID, item.ClosureOutcome, item.ClosureReview).Scan(&item.ID)
	return item, err
}

func loadChangeRequestFromDB(id int) (changeRequest, error) {
	if DB == nil || id <= 0 {
		return changeRequest{}, errChangeHidden
	}
	rows, err := DB.Query(`SELECT `+changeColumns+` FROM lifecycle_changes WHERE id = $1`, id)
	if err != nil {
		return changeRequest{}, errChangeHidden
	}
	defer rows.Close()
	if !rows.Next() {
		return changeRequest{}, errChangeHidden
	}
	return scanChange(rows)
}

func listLifecycleChangesFromDB(projectID int) ([]changeRequest, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`SELECT `+changeColumns+` FROM lifecycle_changes WHERE project_id = $1 ORDER BY id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []changeRequest
	for rows.Next() {
		item, err := scanChange(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const changeColumns = `id, project_id, environment, change_type, external_id, source_revision, source_status, local_state, source, creator_user_id, connection_id, event_id, idempotency_key, commit_sha, image_digest, owner, impact, risk, change_window, implementation_plan, validation_plan, rollback_plan, approval_id, approval_state, attempt_id, problem_id, closure_outcome, closure_review`

type changeScanner interface {
	Scan(dest ...interface{}) error
}

func scanChange(row changeScanner) (changeRequest, error) {
	var item changeRequest
	err := row.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.ChangeType, &item.ExternalID, &item.SourceRevision, &item.SourceStatus, &item.LocalState, &item.Source, &item.CreatorUserID, &item.ConnectionID, &item.EventID, &item.IdempotencyKey, &item.CommitSHA, &item.ImageDigest, &item.Owner, &item.Impact, &item.Risk, &item.Window, &item.ImplementationPlan, &item.ValidationPlan, &item.RollbackPlan, &item.ApprovalID, &item.ApprovalState, &item.AttemptID, &item.ProblemID, &item.ClosureOutcome, &item.ClosureReview)
	return item, err
}

func changeSubmitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		changeQueueHandler(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var item changeRequest
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeChangeError(w, r, errChangeInvalid)
		return
	}
	if strings.TrimSpace(item.Source) == "" {
		item.Source = "ui"
	}
	if item.CreatorUserID == 0 {
		item.CreatorUserID = actor.UserID
	}
	saved, err := submitChange(actor, item)
	if err != nil {
		writeChangeError(w, r, err)
		return
	}
	status := http.StatusCreated
	if saved.Duplicate {
		status = http.StatusOK
	}
	_ = writeJSONResponse(w, status, saved)
}

func lifecycleChangeWebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var item changeRequest
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeChangeError(w, r, errChangeInvalid)
		return
	}
	item.Source = "webhook"
	saved, err := submitChange(actor, item)
	if err != nil {
		writeChangeError(w, r, err)
		return
	}
	status := http.StatusCreated
	if saved.Duplicate {
		status = http.StatusOK
	}
	_ = writeJSONResponse(w, status, saved)
}

func changeApprovalHandler(w http.ResponseWriter, r *http.Request) {
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
		ChangeID   int `json:"change_id"`
		ApprovalID int `json:"approval_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeChangeError(w, r, errChangeInvalid)
		return
	}
	saved, err := approveChange(actor, body.ChangeID, body.ApprovalID)
	if err != nil {
		writeChangeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func changeCloseHandler(w http.ResponseWriter, r *http.Request) {
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
		ChangeID int    `json:"change_id"`
		Outcome  string `json:"outcome"`
		Review   string `json:"review"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeChangeError(w, r, errChangeInvalid)
		return
	}
	saved, err := closeChange(actor, body.ChangeID, body.Outcome, body.Review)
	if err != nil {
		writeChangeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func changeReleaseHandler(w http.ResponseWriter, r *http.Request) {
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
		ChangeID int `json:"change_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeChangeError(w, r, errChangeInvalid)
		return
	}
	_, err = releaseChange(actor, body.ChangeID)
	writeChangeError(w, r, err)
}

func changeQueueHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	rows, err := changeQueue(actor, projectID)
	if err != nil {
		writeChangeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, rows)
}

func writeChangeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errChangeHidden):
		writeAPIError(w, r, http.StatusNotFound, errChangeHidden.Error(), nil)
	case errors.Is(err, errChangeDenied):
		writeAPIError(w, r, http.StatusForbidden, errChangeDenied.Error(), nil)
	case errors.Is(err, errChangeStale), errors.Is(err, errChangeRelease), errors.Is(err, errChangeClosure):
		writeAPIError(w, r, http.StatusConflict, err.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
