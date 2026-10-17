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
	errAttemptHidden   = errors.New("deployment attempt not found")
	errAttemptDenied   = errors.New("deployment attempt is not permitted")
	errAttemptInvalid  = errors.New("deployment attempt is invalid")
	errAttemptBackward = errors.New("late running event cannot overwrite success")
)

type deploymentAttempt struct {
	ID              int    `json:"id"`
	ProjectID       int    `json:"project_id"`
	ApprovalID      int    `json:"approval_id"`
	Environment     string `json:"environment"`
	CommitSHA       string `json:"commit_sha"`
	ImageDigest     string `json:"image_digest"`
	State           string `json:"state"`
	CallbackState   string `json:"callback_state"`
	CallbackEventID string `json:"callback_event_id,omitempty"`
	ObservedAt      string `json:"observed_at,omitempty"`
	WatchStarted    bool   `json:"watch_started"`
}

type deploymentArtifact struct {
	AttemptID   int    `json:"attempt_id"`
	CommitSHA   string `json:"commit_sha"`
	ImageDigest string `json:"image_digest"`
	ObservedAt  string `json:"observed_at"`
}

type deploymentRuntime struct {
	ProjectID    int                 `json:"project_id"`
	Environment  string              `json:"environment"`
	State        string              `json:"state"`
	Running      *deploymentArtifact `json:"running"`
	History      []deploymentAttempt `json:"history"`
	WatchStarted bool                `json:"watch_started"`
}

var (
	saveDeploymentAttempt   = saveDeploymentAttemptToDB
	loadDeploymentAttempt   = loadDeploymentAttemptFromDB
	updateDeploymentAttempt = updateDeploymentAttemptInDB
	listDeploymentAttempts  = listDeploymentAttemptsFromDB
)

func startDeploymentAttempt(actor authzSubject, item deploymentAttempt) (deploymentAttempt, error) {
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	item.CommitSHA = strings.TrimSpace(item.CommitSHA)
	item.ImageDigest = strings.TrimSpace(item.ImageDigest)
	if item.ProjectID <= 0 || item.ApprovalID <= 0 || item.Environment == "" || item.CommitSHA == "" || item.ImageDigest == "" {
		return deploymentAttempt{}, errAttemptInvalid
	}
	if item.CommitSHA == item.ImageDigest {
		return deploymentAttempt{}, errAttemptInvalid
	}
	if !mappingAllowed(actor, item.ProjectID, authzRead) {
		return deploymentAttempt{}, errAttemptHidden
	}
	if !mappingAllowed(actor, item.ProjectID, authzWrite) {
		return deploymentAttempt{}, errAttemptDenied
	}
	approval, err := loadApprovalSubject(item.ApprovalID)
	if err != nil || approval.ID <= 0 || approval.ProjectID != item.ProjectID {
		return deploymentAttempt{}, errAttemptHidden
	}
	if approval.State != "approved" || approval.CommitHash != item.CommitSHA || approval.Environment != item.Environment {
		return deploymentAttempt{}, errAttemptInvalid
	}
	item.State = "queued"
	item.CallbackState = "missing"
	item.CallbackEventID = ""
	item.ObservedAt = ""
	item.WatchStarted = false
	return saveDeploymentAttempt(item)
}

func applyDeploymentCallback(actor authzSubject, attemptID int, eventID, state, digest, sha, observedAt string) (deploymentAttempt, error) {
	saved, err := loadDeploymentAttempt(attemptID)
	if err != nil || saved.ID <= 0 {
		return deploymentAttempt{}, errAttemptHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return deploymentAttempt{}, errAttemptHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return deploymentAttempt{}, errAttemptDenied
	}
	eventID = strings.TrimSpace(eventID)
	state = strings.ToLower(strings.TrimSpace(state))
	digest = strings.TrimSpace(digest)
	sha = strings.TrimSpace(sha)
	observedAt = strings.TrimSpace(observedAt)
	if eventID == "" || observedAt == "" || (state != "running" && state != "success" && state != "failed") {
		return deploymentAttempt{}, errAttemptInvalid
	}
	if _, err := time.Parse(time.RFC3339, observedAt); err != nil {
		return deploymentAttempt{}, errAttemptInvalid
	}
	if (digest != "" && digest != saved.ImageDigest) || (sha != "" && sha != saved.CommitSHA) {
		return saved, errAttemptInvalid
	}
	if saved.CallbackEventID == eventID {
		return saved, nil
	}
	if !attemptTransitionAllowed(saved.State, state) {
		return saved, errAttemptBackward
	}
	saved.State = state
	saved.CallbackState = "received"
	saved.CallbackEventID = eventID
	saved.ObservedAt = observedAt
	saved.WatchStarted = state == "success" && saved.ImageDigest != "" && saved.CommitSHA != ""
	return updateDeploymentAttempt(saved)
}

func attemptTransitionAllowed(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "queued":
		return to == "running" || to == "success" || to == "failed"
	case "running":
		return to == "success" || to == "failed"
	default:
		return false
	}
}

func deploymentRuntimeView(actor authzSubject, projectID int, environment string) (deploymentRuntime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if projectID <= 0 || environment == "" || !mappingAllowed(actor, projectID, authzRead) {
		return deploymentRuntime{}, errAttemptHidden
	}
	history, err := listDeploymentAttempts(projectID, environment)
	if err != nil {
		return deploymentRuntime{}, err
	}
	if history == nil {
		history = []deploymentAttempt{}
	}
	view := deploymentRuntime{
		ProjectID: projectID, Environment: environment, State: "unknown",
		History: history, WatchStarted: false,
	}
	var latest *deploymentAttempt
	for index := range history {
		item := history[index]
		if item.State == "success" && item.CallbackState == "received" && item.ImageDigest != "" && item.WatchStarted {
			if latest == nil || item.ID > latest.ID {
				copy := item
				latest = &copy
			}
		}
	}
	if latest == nil {
		return view, nil
	}
	view.State = "verified"
	view.WatchStarted = true
	view.Running = &deploymentArtifact{
		AttemptID: latest.ID, CommitSHA: latest.CommitSHA,
		ImageDigest: latest.ImageDigest, ObservedAt: latest.ObservedAt,
	}
	return view, nil
}

func migrateDeploymentSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS deployment_attempts (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			approval_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			commit_sha VARCHAR(128) NOT NULL,
			image_digest VARCHAR(256) NOT NULL,
			state VARCHAR(32) NOT NULL,
			callback_state VARCHAR(32) NOT NULL,
			callback_event_id VARCHAR(128) NOT NULL DEFAULT '',
			observed_at VARCHAR(64) NOT NULL DEFAULT '',
			watch_started BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveDeploymentAttemptToDB(item deploymentAttempt) (deploymentAttempt, error) {
	if DB == nil {
		return deploymentAttempt{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO deployment_attempts (
			project_id, approval_id, environment, commit_sha, image_digest, state, callback_state, callback_event_id, observed_at, watch_started
		) VALUES ($1,$2,$3,$4,$5,'queued','missing','','',FALSE) RETURNING id
	`, item.ProjectID, item.ApprovalID, item.Environment, item.CommitSHA, item.ImageDigest).Scan(&item.ID)
	if err != nil {
		return deploymentAttempt{}, err
	}
	item.State = "queued"
	item.CallbackState = "missing"
	item.WatchStarted = false
	return item, nil
}

func loadDeploymentAttemptFromDB(id int) (deploymentAttempt, error) {
	if DB == nil || id <= 0 {
		return deploymentAttempt{}, errAttemptHidden
	}
	var item deploymentAttempt
	err := DB.QueryRow(`
		SELECT id, project_id, approval_id, environment, commit_sha, image_digest, state, callback_state, callback_event_id, observed_at, watch_started
		FROM deployment_attempts WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.ApprovalID, &item.Environment, &item.CommitSHA, &item.ImageDigest, &item.State, &item.CallbackState, &item.CallbackEventID, &item.ObservedAt, &item.WatchStarted)
	if err != nil {
		return deploymentAttempt{}, errAttemptHidden
	}
	return item, nil
}

func updateDeploymentAttemptInDB(item deploymentAttempt) (deploymentAttempt, error) {
	if DB == nil {
		return deploymentAttempt{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE deployment_attempts
		SET state = $2, callback_state = $3, callback_event_id = $4, observed_at = $5, watch_started = $6
		WHERE id = $1
	`, item.ID, item.State, item.CallbackState, item.CallbackEventID, item.ObservedAt, item.WatchStarted)
	return item, err
}

func listDeploymentAttemptsFromDB(projectID int, environment string) ([]deploymentAttempt, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, approval_id, environment, commit_sha, image_digest, state, callback_state, callback_event_id, observed_at, watch_started
		FROM deployment_attempts WHERE project_id = $1 AND environment = $2 ORDER BY id
	`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []deploymentAttempt
	for rows.Next() {
		var item deploymentAttempt
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.ApprovalID, &item.Environment, &item.CommitSHA, &item.ImageDigest, &item.State, &item.CallbackState, &item.CallbackEventID, &item.ObservedAt, &item.WatchStarted); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func deploymentAttemptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var item deploymentAttempt
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeAttemptError(w, r, errAttemptInvalid)
		return
	}
	saved, err := startDeploymentAttempt(actor, item)
	if err != nil {
		writeAttemptError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func deploymentCallbackHandler(w http.ResponseWriter, r *http.Request) {
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
		AttemptID   int    `json:"attempt_id"`
		EventID     string `json:"event_id"`
		State       string `json:"state"`
		ImageDigest string `json:"image_digest"`
		CommitSHA   string `json:"commit_sha"`
		ObservedAt  string `json:"observed_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAttemptError(w, r, errAttemptInvalid)
		return
	}
	saved, err := applyDeploymentCallback(actor, body.AttemptID, body.EventID, body.State, body.ImageDigest, body.CommitSHA, body.ObservedAt)
	if err != nil {
		writeAttemptError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func deploymentRuntimeHandler(w http.ResponseWriter, r *http.Request) {
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
	view, err := deploymentRuntimeView(actor, projectID, r.URL.Query().Get("environment"))
	if err != nil {
		writeAttemptError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, view)
}

func writeAttemptError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errAttemptHidden):
		writeAPIError(w, r, http.StatusNotFound, errAttemptHidden.Error(), nil)
	case errors.Is(err, errAttemptDenied):
		writeAPIError(w, r, http.StatusForbidden, errAttemptDenied.Error(), nil)
	case errors.Is(err, errAttemptBackward):
		writeAPIError(w, r, http.StatusConflict, errAttemptBackward.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
