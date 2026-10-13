package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errRemediationHidden  = errors.New("remediation not found")
	errRemediationDenied  = errors.New("remediation is not permitted")
	errRemediationInvalid = errors.New("remediation is invalid")
)

type remediationLink struct {
	ID               int               `json:"id"`
	ProjectID        int               `json:"project_id"`
	FindingKey       string            `json:"finding_key"`
	AssignmentID     int               `json:"assignment_id"`
	PullRequest      string            `json:"pull_request"`
	PullRequestState string            `json:"pull_request_state"`
	ChangeID         string            `json:"change_id"`
	AttemptID        int               `json:"attempt_id"`
	ImageDigest      string            `json:"image_digest"`
	Environment      string            `json:"environment"`
	DeploymentState  string            `json:"deployment_state"`
	State            string            `json:"state"`
	Resolved         bool              `json:"resolved"`
	Runs             []verificationRun `json:"runs"`
}

type verificationRun struct {
	ID          int    `json:"id"`
	LinkID      int    `json:"link_id"`
	ImageDigest string `json:"image_digest"`
	Result      string `json:"result"`
	Scope       string `json:"scope"`
}

type remediationInput struct {
	ProjectID        int
	FindingKey       string
	PullRequest      string
	PullRequestState string
	ChangeID         string
	ImageDigest      string
	Environment      string
}

var (
	saveRemediationLink       = saveRemediationLinkToDB
	findRemediationLink       = findRemediationLinkFromDB
	loadRemediationLink       = loadRemediationLinkFromDB
	updateRemediationLink     = updateRemediationLinkInDB
	insertVerificationRun     = insertVerificationRunToDB
	findVerificationRun       = findVerificationRunFromDB
	listVerificationRuns      = listVerificationRunsFromDB
	loadRemediationAssignment = findFindingAssignment
	loadRemediationAttempt    = loadDeploymentAttemptFromDB
)

func linkRemediation(actor authzSubject, input remediationInput) (remediationLink, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return remediationLink{}, errRemediationHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return remediationLink{}, errRemediationDenied
	}
	normalized, err := normalizeRemediationInput(input)
	if err != nil {
		return remediationLink{}, err
	}
	assignment, err := loadRemediationAssignment(normalized.ProjectID, normalized.FindingKey)
	if err != nil {
		return remediationLink{}, err
	}
	if assignment.ID <= 0 || assignment.ProjectID != normalized.ProjectID {
		return remediationLink{}, errRemediationInvalid
	}
	existing, err := findRemediationLink(normalized.ProjectID, normalized.FindingKey, normalized.PullRequest)
	if err != nil {
		return remediationLink{}, err
	}
	if existing.ID > 0 {
		return presentRemediationLink(existing)
	}
	saved, err := saveRemediationLink(remediationLink{
		ProjectID: normalized.ProjectID, FindingKey: normalized.FindingKey, AssignmentID: assignment.ID,
		PullRequest: normalized.PullRequest, PullRequestState: normalized.PullRequestState, ChangeID: normalized.ChangeID,
		ImageDigest: normalized.ImageDigest, Environment: normalized.Environment,
		DeploymentState: "missing", State: "open", Resolved: false,
	})
	if err != nil {
		return remediationLink{}, err
	}
	return presentRemediationLink(saved)
}

func normalizeRemediationInput(input remediationInput) (remediationLink, error) {
	item := remediationLink{
		ProjectID:        input.ProjectID,
		FindingKey:       strings.TrimSpace(input.FindingKey),
		PullRequest:      strings.TrimSpace(input.PullRequest),
		PullRequestState: strings.ToLower(strings.TrimSpace(input.PullRequestState)),
		ChangeID:         strings.TrimSpace(input.ChangeID),
		ImageDigest:      strings.TrimSpace(input.ImageDigest),
		Environment:      strings.ToLower(strings.TrimSpace(input.Environment)),
	}
	if item.FindingKey == "" || strings.Contains(item.FindingKey, " ") || strings.Contains(item.FindingKey, "\n") || len(item.FindingKey) > 128 {
		return remediationLink{}, errRemediationInvalid
	}
	if item.PullRequest == "" || strings.Contains(item.PullRequest, "\n") || len(item.PullRequest) > 200 {
		return remediationLink{}, errRemediationInvalid
	}
	if item.PullRequestState != "open" && item.PullRequestState != "merged" {
		return remediationLink{}, errRemediationInvalid
	}
	if item.ChangeID == "" || strings.Contains(item.ChangeID, "\n") || len(item.ChangeID) > 120 || item.Environment == "" || strings.Contains(item.Environment, "\n") {
		return remediationLink{}, errRemediationInvalid
	}
	if !artifactDigestPattern.MatchString(item.ImageDigest) {
		return remediationLink{}, errRemediationInvalid
	}
	return item, nil
}

func recordRemediationDelivery(actor authzSubject, linkID, attemptID int) (remediationLink, error) {
	current, err := loadRemediationLink(linkID)
	if err != nil || current.ID <= 0 {
		return remediationLink{}, errRemediationHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return remediationLink{}, errRemediationHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return remediationLink{}, errRemediationDenied
	}
	attempt, err := loadRemediationAttempt(attemptID)
	if err != nil || attempt.ID <= 0 {
		return remediationLink{}, errRemediationHidden
	}
	if attempt.ProjectID != current.ProjectID || attempt.Environment != current.Environment || attempt.ImageDigest != current.ImageDigest {
		return remediationLink{}, errRemediationInvalid
	}
	if current.DeploymentState == "success" && attempt.State == "success" && current.AttemptID == attempt.ID {
		return presentRemediationLink(current)
	}
	current.AttemptID = attempt.ID
	if attempt.State == "success" {
		current.DeploymentState = "success"
		if current.State != "resolved" {
			current.State = "awaiting_verification"
			current.Resolved = false
		}
	} else {
		current.DeploymentState = "failed"
		current.State = "open"
		current.Resolved = false
	}
	if _, err := updateRemediationLink(current); err != nil {
		return remediationLink{}, err
	}
	current.Runs = nil
	return presentRemediationLink(current)
}

func recordRemediationVerification(actor authzSubject, linkID int, digest, result string) (remediationLink, error) {
	current, err := loadRemediationLink(linkID)
	if err != nil || current.ID <= 0 {
		return remediationLink{}, errRemediationHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return remediationLink{}, errRemediationHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return remediationLink{}, errRemediationDenied
	}
	digest = strings.TrimSpace(digest)
	result = strings.ToLower(strings.TrimSpace(result))
	if !artifactDigestPattern.MatchString(digest) || (result != "pass" && result != "fail" && result != "unknown") {
		return remediationLink{}, errRemediationInvalid
	}
	existing, err := findVerificationRun(current.ID, digest, result)
	if err != nil {
		return remediationLink{}, err
	}
	if existing.ID == 0 {
		if _, err := insertVerificationRun(verificationRun{LinkID: current.ID, ImageDigest: digest, Result: result, Scope: "targeted"}); err != nil {
			return remediationLink{}, err
		}
	}
	if result == "fail" {
		current.State = "open"
		current.Resolved = false
	} else if result == "pass" && current.DeploymentState == "success" && digest == current.ImageDigest {
		current.State = "resolved"
		current.Resolved = true
	}
	if _, err := updateRemediationLink(current); err != nil {
		return remediationLink{}, err
	}
	current.Runs = nil
	return presentRemediationLink(current)
}

func presentRemediationLink(item remediationLink) (remediationLink, error) {
	if item.Runs == nil {
		runs, err := listVerificationRuns(item.ID)
		if err != nil {
			return remediationLink{}, err
		}
		item.Runs = runs
	}
	if item.State == "" {
		item.State = "open"
	}
	item.Resolved = item.State == "resolved"
	return item, nil
}

func migrateRemediationSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS remediation_links (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			finding_key VARCHAR(128) NOT NULL,
			assignment_id INTEGER NOT NULL,
			pull_request VARCHAR(200) NOT NULL,
			pull_request_state VARCHAR(32) NOT NULL,
			change_id VARCHAR(120) NOT NULL,
			attempt_id INTEGER NOT NULL DEFAULT 0,
			image_digest VARCHAR(80) NOT NULL,
			environment VARCHAR(64) NOT NULL,
			deployment_state VARCHAR(32) NOT NULL,
			state VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, finding_key, pull_request)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS verification_runs (
			id SERIAL PRIMARY KEY,
			link_id INTEGER NOT NULL,
			image_digest VARCHAR(80) NOT NULL,
			result VARCHAR(16) NOT NULL,
			scope VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (link_id, image_digest, result)
		)
	`)
}

func saveRemediationLinkToDB(item remediationLink) (remediationLink, error) {
	if DB == nil {
		return remediationLink{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO remediation_links (
			project_id, finding_key, assignment_id, pull_request, pull_request_state, change_id,
			attempt_id, image_digest, environment, deployment_state, state
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
	`, item.ProjectID, item.FindingKey, item.AssignmentID, item.PullRequest, item.PullRequestState, item.ChangeID,
		item.AttemptID, item.ImageDigest, item.Environment, item.DeploymentState, item.State).Scan(&item.ID)
	return item, err
}

func scanRemediationLink(query string, args ...interface{}) (remediationLink, error) {
	var item remediationLink
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.FindingKey, &item.AssignmentID, &item.PullRequest, &item.PullRequestState,
		&item.ChangeID, &item.AttemptID, &item.ImageDigest, &item.Environment, &item.DeploymentState, &item.State,
	)
	return item, err
}

func findRemediationLinkFromDB(projectID int, findingKey, pullRequest string) (remediationLink, error) {
	if DB == nil {
		return remediationLink{}, nil
	}
	item, err := scanRemediationLink(`
		SELECT id, project_id, finding_key, assignment_id, pull_request, pull_request_state, change_id, attempt_id, image_digest, environment, deployment_state, state
		FROM remediation_links WHERE project_id = $1 AND finding_key = $2 AND pull_request = $3
	`, projectID, findingKey, pullRequest)
	if err != nil {
		return remediationLink{}, nil
	}
	return item, nil
}

func loadRemediationLinkFromDB(id int) (remediationLink, error) {
	if DB == nil || id <= 0 {
		return remediationLink{}, errRemediationHidden
	}
	item, err := scanRemediationLink(`
		SELECT id, project_id, finding_key, assignment_id, pull_request, pull_request_state, change_id, attempt_id, image_digest, environment, deployment_state, state
		FROM remediation_links WHERE id = $1
	`, id)
	if err != nil || item.ID <= 0 {
		return remediationLink{}, errRemediationHidden
	}
	return item, nil
}

func updateRemediationLinkInDB(item remediationLink) (remediationLink, error) {
	if DB == nil {
		return remediationLink{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE remediation_links SET attempt_id = $2, deployment_state = $3, state = $4 WHERE id = $1
	`, item.ID, item.AttemptID, item.DeploymentState, item.State)
	return item, err
}

func insertVerificationRunToDB(item verificationRun) (verificationRun, error) {
	if DB == nil {
		return verificationRun{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO verification_runs (link_id, image_digest, result, scope) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.LinkID, item.ImageDigest, item.Result, item.Scope).Scan(&item.ID)
	return item, err
}

func findVerificationRunFromDB(linkID int, digest, result string) (verificationRun, error) {
	if DB == nil {
		return verificationRun{}, nil
	}
	var item verificationRun
	err := DB.QueryRow(`
		SELECT id, link_id, image_digest, result, scope FROM verification_runs
		WHERE link_id = $1 AND image_digest = $2 AND result = $3
	`, linkID, digest, result).Scan(&item.ID, &item.LinkID, &item.ImageDigest, &item.Result, &item.Scope)
	if err != nil {
		return verificationRun{}, nil
	}
	return item, nil
}

func listVerificationRunsFromDB(linkID int) ([]verificationRun, error) {
	if DB == nil || linkID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, link_id, image_digest, result, scope FROM verification_runs WHERE link_id = $1 ORDER BY id
	`, linkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []verificationRun
	for rows.Next() {
		var item verificationRun
		if err := rows.Scan(&item.ID, &item.LinkID, &item.ImageDigest, &item.Result, &item.Scope); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func remediationLinkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		actor, err := catalogSubjectFromRequest(r)
		if err != nil {
			writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
			return
		}
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
			writeRemediationError(w, r, errRemediationHidden)
			return
		}
		saved, err := findRemediationLink(projectID, r.URL.Query().Get("finding_key"), r.URL.Query().Get("pull_request"))
		if err != nil || saved.ID <= 0 {
			writeRemediationError(w, r, errRemediationHidden)
			return
		}
		presented, err := presentRemediationLink(saved)
		if err != nil {
			writeRemediationError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, presented)
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
	var body struct {
		ProjectID        int    `json:"project_id"`
		FindingKey       string `json:"finding_key"`
		PullRequest      string `json:"pull_request"`
		PullRequestState string `json:"pull_request_state"`
		ChangeID         string `json:"change_id"`
		ImageDigest      string `json:"image_digest"`
		Environment      string `json:"environment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeRemediationError(w, r, errRemediationInvalid)
		return
	}
	saved, err := linkRemediation(actor, remediationInput{
		ProjectID: body.ProjectID, FindingKey: body.FindingKey, PullRequest: body.PullRequest,
		PullRequestState: body.PullRequestState, ChangeID: body.ChangeID, ImageDigest: body.ImageDigest, Environment: body.Environment,
	})
	if err != nil {
		writeRemediationError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func remediationDeliveryHandler(w http.ResponseWriter, r *http.Request) {
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
		LinkID    int `json:"link_id"`
		AttemptID int `json:"attempt_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeRemediationError(w, r, errRemediationInvalid)
		return
	}
	saved, err := recordRemediationDelivery(actor, body.LinkID, body.AttemptID)
	if err != nil {
		writeRemediationError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func remediationVerificationHandler(w http.ResponseWriter, r *http.Request) {
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
		LinkID      int    `json:"link_id"`
		ImageDigest string `json:"image_digest"`
		Result      string `json:"result"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeRemediationError(w, r, errRemediationInvalid)
		return
	}
	saved, err := recordRemediationVerification(actor, body.LinkID, body.ImageDigest, body.Result)
	if err != nil {
		writeRemediationError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func writeRemediationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errRemediationHidden):
		writeAPIError(w, r, http.StatusNotFound, errRemediationHidden.Error(), nil)
	case errors.Is(err, errRemediationDenied):
		writeAPIError(w, r, http.StatusForbidden, errRemediationDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errRemediationInvalid.Error(), nil)
	}
}
