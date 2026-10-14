package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// E19 contract. The adapter records an ordered retirement case. It does not
// call a cloud executor and it does not delete a resource. E03 backup evidence
// and E08 consumer mapping are not assumed complete. Missing or stale evidence
// stays unknown. An unknown consumer or a missing retention decision blocks
// approval.
//
// Read and preview need a grant. Approve and run are writes, and a viewer is
// denied. Another project is hidden. Archived history stays readable for the
// same project. A new request to an archived service is denied.
//
// Steps run in order: traffic removal, resource teardown, credential
// retirement. A failure stops the case. A later run does not repeat a verified
// step. A retained resource stays retained. Body text is limited to 200
// characters. List reads stay on the existing API timeout. No latency target
// is set because there is no baseline.

const (
	retirementFreshFor  = 7 * 24 * time.Hour
	retirementNoteLimit = 200
	retirementRecovery  = "Stop. Do not repeat a verified step. A retained resource stays retained."
)

var (
	errRetirementHidden  = errors.New("retirement hidden")
	errRetirementDenied  = errors.New("retirement denied")
	errRetirementInvalid = errors.New("retirement invalid")
)

type retirementResource struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Retained bool   `json:"retained"`
	State    string `json:"state"`
}

type retirementStep struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	State    string `json:"state"`
	Attempts int    `json:"attempts"`
	Recovery string `json:"recovery,omitempty"`
}

type retirementCase struct {
	ID                  string               `json:"id"`
	ProjectID           int                  `json:"project_id"`
	Service             string               `json:"service"`
	ConsumersKnown      bool                 `json:"consumers_known"`
	RetentionDecision   string               `json:"retention_decision"`
	BackupKnown         bool                 `json:"backup_known"`
	EvidenceAt          time.Time            `json:"evidence_at"`
	Resources           []retirementResource `json:"resources"`
	ApprovedFingerprint string               `json:"-"`
	Approved            bool                 `json:"approved"`
	NeedsPreview        bool                 `json:"needs_preview"`
	State               string               `json:"state"`
	Blockers            []string             `json:"blockers"`
	Steps               []retirementStep     `json:"steps"`
	HistoryReadable     bool                 `json:"history_readable"`
	ProvisioningDenied  bool                 `json:"provisioning_denied"`
}

func retirementPublicText(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	if lower == "" || strings.Contains(value, "@") {
		return false
	}
	return !strings.Contains(lower, "password") && !strings.Contains(lower, "secret") && !strings.Contains(lower, "token") && !strings.Contains(lower, "deleted")
}

func retirementFingerprint(item retirementCase) string {
	ids := make([]string, 0, len(item.Resources))
	for _, resource := range item.Resources {
		ids = append(ids, strings.TrimSpace(resource.ID))
	}
	sort.Strings(ids)
	return strings.Join(append([]string{strings.TrimSpace(item.Service), strings.TrimSpace(item.RetentionDecision)}, ids...), "|")
}

func retirementSteps() []retirementStep {
	return []retirementStep{
		{Key: "traffic-removal", Name: "Traffic removal", State: "pending"},
		{Key: "resource-teardown", Name: "Resource teardown", State: "pending"},
		{Key: "credential-retirement", Name: "Credential retirement", State: "pending"},
	}
}

func reviewRetirement(item *retirementCase, at time.Time) error {
	if !retirementPublicText(item.Service) || len(item.Service) > retirementNoteLimit {
		return errRetirementInvalid
	}
	for _, resource := range item.Resources {
		if !retirementPublicText(resource.ID) {
			return errRetirementInvalid
		}
	}
	blockers := make([]string, 0, 4)
	state := "review"
	if item.EvidenceAt.IsZero() {
		blockers = append(blockers, "evidence missing")
		state = "unknown"
	} else if item.EvidenceAt.Before(at.Add(-retirementFreshFor)) {
		blockers = append(blockers, "evidence stale")
		state = "unknown"
	}
	if !item.BackupKnown {
		blockers = append(blockers, "backup evidence missing")
		state = "unknown"
	}
	if !item.ConsumersKnown {
		blockers = append(blockers, "consumer unknown")
		if state != "unknown" {
			state = "blocked"
		}
	}
	if strings.TrimSpace(item.RetentionDecision) == "" {
		blockers = append(blockers, "retention decision missing")
		if state != "unknown" {
			state = "blocked"
		}
	}
	if retirementFingerprint(*item) != item.ApprovedFingerprint {
		item.Approved = false
		item.ApprovedFingerprint = ""
	}
	item.Blockers = blockers
	item.State = state
	item.NeedsPreview = false
	if len(item.Steps) == 0 {
		item.Steps = retirementSteps()
	}
	for i := range item.Resources {
		if item.Resources[i].Retained {
			item.Resources[i].State = "retained"
		} else if item.Resources[i].State == "" || item.Resources[i].State == "deleted" {
			item.Resources[i].State = "present"
		}
	}
	return nil
}

func approveRetirement(item *retirementCase, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errRetirementHidden
	}
	if !memberAllowed {
		return errRetirementDenied
	}
	if item.NeedsPreview || item.State == "unknown" || item.State == "blocked" || item.State == "" {
		return errRetirementInvalid
	}
	item.ApprovedFingerprint = retirementFingerprint(*item)
	item.Approved = true
	item.State = "approved"
	item.NeedsPreview = false
	return nil
}

func changeRetirementScope(item *retirementCase, resources []retirementResource) {
	item.Resources = resources
	if retirementFingerprint(*item) != item.ApprovedFingerprint {
		item.Approved = false
		item.ApprovedFingerprint = ""
		item.NeedsPreview = true
		if item.State == "approved" || item.State == "archived" {
			item.State = "review"
		}
	}
}

func runRetirement(item *retirementCase, failKey string) {
	for i := range item.Steps {
		step := &item.Steps[i]
		if step.State == "verified" {
			continue
		}
		if step.Attempts == 0 {
			step.Attempts = 1
		}
		if step.Key == failKey {
			step.State = "failed"
			step.Recovery = retirementRecovery
			item.State = "incomplete"
			return
		}
		step.State = "verified"
		step.Recovery = ""
	}
	if item.State == "incomplete" {
		item.State = "approved"
	}
}

func archiveRetirement(item *retirementCase, projectAllowed bool) error {
	if !projectAllowed {
		return errRetirementHidden
	}
	if !item.Approved || item.State == "unknown" || item.State == "blocked" || item.State == "incomplete" {
		return errRetirementInvalid
	}
	for _, step := range item.Steps {
		if step.State != "verified" {
			return errRetirementInvalid
		}
	}
	for i := range item.Resources {
		if item.Resources[i].Retained || item.Resources[i].State == "retained" {
			item.Resources[i].State = "retained"
			continue
		}
		if item.Resources[i].State == "deleted" {
			item.Resources[i].State = "present"
		}
	}
	item.State = "archived"
	item.HistoryReadable = true
	item.ProvisioningDenied = true
	return nil
}

func provisionRetired(item *retirementCase, projectAllowed bool) error {
	if !projectAllowed {
		return errRetirementHidden
	}
	if item.ProvisioningDenied || item.State == "archived" {
		return errRetirementDenied
	}
	return nil
}

func readRetirement(item *retirementCase, projectAllowed bool) (*retirementCase, error) {
	if item == nil || !projectAllowed {
		return nil, errRetirementHidden
	}
	copy := *item
	return &copy, nil
}

type retirementStore struct {
	mu    sync.Mutex
	cases map[string]retirementCase
}

var retirementCases = &retirementStore{cases: map[string]retirementCase{}}

func retirementCaseHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	subject := authzSubjectForUser(userID)
	projectID, environment, action, item, err := readRetirementRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
		return
	}
	write := action == "approve" || action == "run" || action == "archive"
	decision := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Environment:    environment,
			Kind:           "retirement",
			ResourceID:     item.ID,
		},
		Action: map[bool]authzAction{true: authzWrite, false: authzRead}[write],
	})
	if !decision.Allowed {
		status := http.StatusNotFound
		if write && decision.Reason == "role cannot perform this action" {
			status = http.StatusForbidden
		}
		writeAPIError(w, r, status, "Retirement is not available for this scope.", nil)
		return
	}
	item.ProjectID = projectID
	switch action {
	case "", "read":
		retirementCases.mu.Lock()
		stored, found := retirementCases.cases[item.ID]
		retirementCases.mu.Unlock()
		if !found {
			writeJSON(w, http.StatusOK, map[string]interface{}{"state": "empty", "case": retirementCase{State: "unknown", Blockers: []string{"No retirement case is active for this project."}}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"state": stored.State, "case": stored})
	case "preview":
		if err := reviewRetirement(&item, time.Now().UTC()); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "preview", "approved": false, "case": item})
	case "approve":
		if err := reviewRetirement(&item, time.Now().UTC()); err != nil || approveRetirement(&item, true, true) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		retirementCases.mu.Lock()
		retirementCases.cases[item.ID] = item
		retirementCases.mu.Unlock()
		persistRetirementCase(projectID, environment, item)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "approved", "approved": true, "deleted": false, "case": item})
	case "run":
		retirementCases.mu.Lock()
		stored, found := retirementCases.cases[item.ID]
		if !found {
			stored = item
		}
		runRetirement(&stored, "")
		retirementCases.cases[item.ID] = stored
		retirementCases.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": stored.State, "deleted": false, "case": stored})
	default:
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
	}
}

func readRetirementRequest(r *http.Request) (int, string, string, retirementCase, error) {
	var body struct {
		ProjectID   int            `json:"project_id"`
		Environment string         `json:"environment"`
		Action      string         `json:"action"`
		Case        retirementCase `json:"case"`
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, part := range []byte(r.URL.Query().Get("project_id")) {
			if part < '0' || part > '9' {
				return 0, "", "", retirementCase{}, errRetirementInvalid
			}
			projectID = projectID*10 + int(part-'0')
		}
		environment := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("environment")))
		id := strings.TrimSpace(r.URL.Query().Get("case_id"))
		if projectID <= 0 || !singleEnvironment(environment) || id == "" {
			return 0, "", "", retirementCase{}, errRetirementInvalid
		}
		return projectID, environment, "read", retirementCase{ID: id, ProjectID: projectID}, nil
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return 0, "", "", retirementCase{}, errRetirementInvalid
	}
	environment := strings.ToLower(strings.TrimSpace(body.Environment))
	if body.ProjectID <= 0 || !singleEnvironment(environment) || strings.TrimSpace(body.Case.ID) == "" {
		return 0, "", "", retirementCase{}, errRetirementInvalid
	}
	return body.ProjectID, environment, strings.ToLower(strings.TrimSpace(body.Action)), body.Case, nil
}

func persistRetirementCase(projectID int, environment string, item retirementCase) {
	if DB == nil {
		return
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO retirement_cases (project_id, environment, case_id, state, payload)
		VALUES ($1, $2, $3, $4, $5)
	`, projectID, environment, item.ID, item.State, string(raw))
}

func migrateRetirementCaseSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS retirement_cases (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(80) NOT NULL,
			case_id VARCHAR(120) NOT NULL,
			state VARCHAR(20) NOT NULL,
			payload TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
}
