package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

type iamRequest struct {
	ID             string          `json:"id"`
	RequesterID    int             `json:"requesterId"`
	RequesterName  string          `json:"requesterName,omitempty"`
	Status         string          `json:"status"`
	Evaluation     iamEvaluation   `json:"evaluation"`
	VersionHash    string          `json:"versionHash"`
	AccessNumber   string          `json:"accessNumber,omitempty"`
	ProvisionFile  string          `json:"provisionFile,omitempty"`
	ProvisionURL   string          `json:"provisionUrl,omitempty"`
	IncidentID     int             `json:"incidentId,omitempty"`
	IncidentNumber string          `json:"incidentNumber,omitempty"`
	IdempotencyKey string          `json:"-"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	Timeline       []iamAuditEvent `json:"timeline"`
}

type iamAuditEvent struct {
	ID        string    `json:"id"`
	At        time.Time `json:"at"`
	ActorID   int       `json:"actorId"`
	Action    string    `json:"action"`
	RequestID string    `json:"requestId,omitempty"`
	Detail    string    `json:"detail"`
}

type iamGrant struct {
	ID             string    `json:"id"`
	RequestID      string    `json:"requestId"`
	RequesterID    int       `json:"requesterId"`
	PrincipalID    string    `json:"principalId"`
	RoleName       string    `json:"roleName"`
	RoleID         string    `json:"roleId"`
	Scope          string    `json:"scope"`
	Status         string    `json:"status"`
	AccessNumber   string    `json:"accessNumber,omitempty"`
	IncidentNumber string    `json:"incidentNumber,omitempty"`
	GrantedAt      time.Time `json:"grantedAt"`
}

type iamStore struct {
	mu     sync.Mutex
	evals  map[string]iamEvaluation
	byID   map[string]*iamRequest
	byKey  map[string]string
	grants []iamGrant
	audit  []iamAuditEvent
}

var cloudAccess = &iamStore{
	evals: map[string]iamEvaluation{},
	byID:  map[string]*iamRequest{},
	byKey: map[string]string{},
}

func newIAMID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buf)
}

func (s *iamStore) addAudit(actor int, action, requestID, detail string) iamAuditEvent {
	event := iamAuditEvent{ID: newIAMID(), At: time.Now().UTC(), ActorID: actor, Action: action, RequestID: requestID, Detail: detail}
	s.audit = append(s.audit, event)
	return event
}

func iamHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/iam"), "/")
	parts := []string{}
	if path != "" {
		parts = strings.Split(path, "/")
	}
	switch {
	case path == "" || path == "summary":
		iamSummary(w, userID)
	case path == "teams":
		writeIAM(w, http.StatusOK, map[string]any{"teams": iamCatalogTeams()})
	case path == "principals":
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		items := []iamPrincipal{}
		for _, item := range iamCatalogPrincipals() {
			if q == "" || strings.Contains(strings.ToLower(item.Name+" "+item.ID), q) {
				items = append(items, item)
			}
		}
		writeIAM(w, http.StatusOK, map[string]any{"principals": items})
	case path == "cloud-accounts":
		writeIAM(w, http.StatusOK, map[string]any{"accounts": iamCatalogAccounts()})
	case path == "resources":
		team := strings.TrimSpace(r.URL.Query().Get("teamId"))
		items := []iamResource{}
		for _, item := range iamCatalogResources() {
			if team == "" || item.TeamID == team {
				items = append(items, item)
			}
		}
		writeIAM(w, http.StatusOK, map[string]any{"resources": items})
	case path == "policy":
		writeIAM(w, http.StatusOK, map[string]any{"policyVersion": iamPolicyVersion, "matrix": iamPolicyMatrix()})
	case path == "access-grants":
		cloudAccess.mu.Lock()
		grants := []iamGrant{}
		for _, grant := range cloudAccess.grants {
			if grant.RequesterID == userID {
				grants = append(grants, grant)
			}
		}
		cloudAccess.mu.Unlock()
		writeIAM(w, http.StatusOK, map[string]any{"grants": grants})
	case path == "audit-events":
		cloudAccess.mu.Lock()
		events := append([]iamAuditEvent(nil), cloudAccess.audit...)
		cloudAccess.mu.Unlock()
		writeIAM(w, http.StatusOK, map[string]any{"events": events})
	case len(parts) == 2 && parts[0] == "access-requests" && parts[1] == "evaluate" && r.Method == http.MethodPost:
		iamEvaluate(w, r, userID)
	case len(parts) == 1 && parts[0] == "access-requests" && r.Method == http.MethodPost:
		iamCreate(w, r, userID)
	case len(parts) == 1 && parts[0] == "access-requests" && r.Method == http.MethodGet:
		iamList(w, r, userID)
	case len(parts) == 2 && parts[0] == "access-requests" && r.Method == http.MethodGet:
		iamGet(w, parts[1], userID)
	case len(parts) == 3 && parts[0] == "access-requests" && parts[2] == "cancel" && r.Method == http.MethodPost:
		iamCancel(w, parts[1], userID)
	case path == "approvals" && r.Method == http.MethodGet:
		iamApprovals(w, userID)
	case len(parts) == 3 && parts[0] == "approvals" && parts[2] == "decision" && r.Method == http.MethodPost:
		iamDecide(w, r, parts[1], userID)
	case len(parts) == 3 && parts[0] == "access-grants" && parts[2] == "revoke":
		writeAPIError(w, r, http.StatusConflict, "no provider-confirmed grant can be revoked", nil)
	default:
		http.NotFound(w, r)
	}
}

func iamPolicyMatrix() []map[string]string {
	return []map[string]string{
		{"risk": "Low", "condition": "Development monitoring read, narrow scope", "approval": "Resource owner", "max": "24 hours"},
		{"risk": "Medium", "condition": "Production monitoring or non-production privileged action", "approval": "Resource owner, conditional security review", "max": "8 hours"},
		{"risk": "High", "condition": "Production secret value read on one vault", "approval": "DevOps team, then the backend records the grant", "max": "4 hours"},
		{"risk": "Critical", "condition": "Broad secret scope, owner, or unknown owner", "approval": "Blocked in self-service", "max": "Not offered"},
	}
}

func iamSummary(w http.ResponseWriter, userID int) {
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	pending, approvals := 0, 0
	for _, item := range cloudAccess.byID {
		if strings.HasPrefix(item.Status, "PENDING") || item.Status == "PROVISIONING" || item.Status == "AWAITING_PIM_ACTIVATION" {
			pending++
		}
		if item.RequesterID != userID && item.Status == "PENDING_DEVOPS_APPROVAL" {
			approvals++
		}
	}
	active := 0
	for _, grant := range cloudAccess.grants {
		if grant.Status == "active" {
			active++
		}
	}
	writeIAM(w, http.StatusOK, map[string]any{
		"active": active, "pending": pending, "expiring": 0, "approvals": approvals,
		"note": "A request opens an access request. After the DevOps team approves, the access file workflow runs. The grant is recorded when that file is applied.",
	})
}

func iamEvaluate(w http.ResponseWriter, r *http.Request, userID int) {
	var in iamEvaluateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	result := evaluateIAMAccess(in, time.Now().UTC(), false)
	cloudAccess.mu.Lock()
	cloudAccess.evals[result.EvaluationID] = result
	cloudAccess.addAudit(userID, "evaluated", "", result.Decision+" "+result.Reason)
	cloudAccess.mu.Unlock()
	writeIAM(w, http.StatusOK, result)
}

func iamCreate(w http.ResponseWriter, r *http.Request, userID int) {
	var body struct {
		EvaluationID string `json:"evaluationId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	item, status, msg := saveIAMRequest(userID, body.EvaluationID, key)
	if msg != "" {
		writeAPIError(w, r, status, msg, nil)
		return
	}
	writeIAM(w, status, item)
}

func saveIAMRequest(userID int, evalID, key string) (*iamRequest, int, string) {
	key = strings.TrimSpace(key)
	if key == "" || strings.TrimSpace(evalID) == "" {
		return nil, http.StatusBadRequest, "evaluationId and Idempotency-Key are required"
	}
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	if existingID := cloudAccess.byKey[key]; existingID != "" {
		return cloudAccess.byID[existingID], http.StatusOK, ""
	}
	eval, ok := cloudAccess.evals[evalID]
	if !ok || time.Now().UTC().After(eval.ExpiresAt) {
		return nil, http.StatusConflict, "evaluation is missing or stale"
	}
	if eval.Decision != "ALLOW_WITH_APPROVAL" && eval.Decision != "REQUIRE_ELIGIBILITY" {
		return nil, http.StatusConflict, "this evaluation cannot be submitted"
	}
	statusName := "PENDING_DEVOPS_APPROVAL"
	now := time.Now().UTC()
	requesterName := ""
	if DB != nil {
		if user, userErr := GetUserByID(userID); userErr == nil && user != nil {
			requesterName = user.Username
		}
	}
	item := &iamRequest{
		ID: newIAMID(), RequesterID: userID, RequesterName: requesterName, Status: statusName, Evaluation: eval,
		VersionHash:    iamVersionHash(eval.Input.PrincipalID, eval.NormalizedScope, eval.RoleID, eval.Input.DurationMinutes, eval.Input.Justification),
		IdempotencyKey: key, CreatedAt: now, UpdatedAt: now,
	}
	item.AccessNumber = strings.TrimSpace(eval.Input.TicketRef)
	if !strings.HasPrefix(item.AccessNumber, "AR-") {
		item.AccessNumber = "AR-" + item.ID
	}
	event := cloudAccess.addAudit(userID, "access_request_opened", item.ID, item.AccessNumber)
	item.Timeline = []iamAuditEvent{event}
	cloudAccess.byID[item.ID] = item
	cloudAccess.byKey[key] = item.ID
	return item, http.StatusCreated, ""
}

func iamList(w http.ResponseWriter, r *http.Request, userID int) {
	scope := ""
	if r != nil {
		scope = r.URL.Query().Get("scope")
	}
	all := scope == "desk" && iamDevopsApprover(userID)
	visible := map[int]bool{userID: true}
	if !all && scope == "team" && DB != nil {
		if memberIDs, err := GetTeamMemberUserIDsForManager(userID); err == nil {
			for _, id := range memberIDs {
				visible[id] = true
			}
		}
	}
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	items := []*iamRequest{}
	for _, item := range cloudAccess.byID {
		if all || visible[item.RequesterID] {
			items = append(items, item)
		}
	}
	writeIAM(w, http.StatusOK, map[string]any{"requests": items})
}

func iamGet(w http.ResponseWriter, id string, userID int) {
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	item := cloudAccess.byID[id]
	if item == nil || item.RequesterID != userID {
		writeAPIError(w, nil, http.StatusNotFound, "request not found", nil)
		return
	}
	writeIAM(w, http.StatusOK, item)
}

func iamCancel(w http.ResponseWriter, id string, userID int) {
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	item := cloudAccess.byID[id]
	if item == nil || item.RequesterID != userID {
		writeAPIError(w, nil, http.StatusNotFound, "request not found", nil)
		return
	}
	if item.Status == "ACTIVE" || item.Status == "PROVISIONING" || item.Status == "AWAITING_PIM_ACTIVATION" {
		writeAPIError(w, nil, http.StatusConflict, "activation has started; cancel is no longer available", nil)
		return
	}
	item.Status = "CANCELED"
	item.UpdatedAt = time.Now().UTC()
	item.Timeline = append(item.Timeline, cloudAccess.addAudit(userID, "canceled", item.ID, "canceled before activation"))
	writeIAM(w, http.StatusOK, item)
}

func iamApprovals(w http.ResponseWriter, userID int) {
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	items := []*iamRequest{}
	for _, item := range cloudAccess.byID {
		if item.RequesterID == userID {
			continue
		}
		if item.Status == "PENDING_DEVOPS_APPROVAL" {
			items = append(items, item)
		}
	}
	writeIAM(w, http.StatusOK, map[string]any{"approvals": items})
}

func iamDecide(w http.ResponseWriter, r *http.Request, id string, userID int) {
	var body struct {
		Decision    string `json:"decision"`
		VersionHash string `json:"versionHash"`
		Comment     string `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if iamContainsSecretPaste(body.Comment) {
		writeAPIError(w, r, http.StatusBadRequest, "comment must not include a secret value", nil)
		return
	}
	cloudAccess.mu.Lock()
	item := cloudAccess.byID[id]
	if item == nil {
		cloudAccess.mu.Unlock()
		writeAPIError(w, r, http.StatusNotFound, "request not found", nil)
		return
	}
	if msg, code := applyIAMDecision(item, userID, body.Decision, body.VersionHash); msg != "" {
		cloudAccess.mu.Unlock()
		writeAPIError(w, r, code, msg, nil)
		return
	}
	item.UpdatedAt = time.Now().UTC()
	if item.Status == "PROVISIONING" {
		dispatches, prepErr := buildIAMAccessDispatches(item)
		if prepErr != nil {
			item.Status = "PENDING_DEVOPS_APPROVAL"
			cloudAccess.mu.Unlock()
			writeAPIError(w, r, http.StatusBadRequest, prepErr.Error(), nil)
			return
		}
		cloudAccess.mu.Unlock()
		if err := dispatchIAMAccessWorkflows(dispatches); err != nil {
			cloudAccess.mu.Lock()
			item.Status = "PENDING_DEVOPS_APPROVAL"
			cloudAccess.mu.Unlock()
			writeAPIError(w, r, http.StatusBadGateway, "the access file workflow could not be started", nil)
			return
		}
		cloudAccess.mu.Lock()
		item.ProvisionFile = dispatches[0].File
		item.ProvisionURL = dispatches[0].URL
		item.Timeline = append(item.Timeline, cloudAccess.addAudit(userID, "access_file_requested", item.ID, item.ProvisionFile))
		cloudAccess.mu.Unlock()
		writeIAM(w, http.StatusOK, item)
		return
	}
	if item.Status == "ACTIVE" {
		grant := iamGrant{
			ID: newIAMID(), RequestID: item.ID, RequesterID: item.RequesterID,
			PrincipalID: item.Evaluation.Input.PrincipalID, RoleName: item.Evaluation.RoleName, RoleID: item.Evaluation.RoleID,
			Scope: item.Evaluation.NormalizedScope, Status: "active", AccessNumber: item.AccessNumber, GrantedAt: item.UpdatedAt,
		}
		cloudAccess.grants = append(cloudAccess.grants, grant)
		item.Timeline = append(item.Timeline, cloudAccess.addAudit(userID, "provisioned", item.ID, item.Evaluation.RoleName))
		item.Timeline = append(item.Timeline, cloudAccess.addAudit(userID, "access_request_closed", item.ID, item.AccessNumber))
	} else if item.Status == "REJECTED" {
		item.Timeline = append(item.Timeline, cloudAccess.addAudit(userID, "rejected", item.ID, item.AccessNumber))
	}
	cloudAccess.mu.Unlock()
	writeIAM(w, http.StatusOK, item)
}

func closeIAMIncident(id int, status, note string) {
	if DB == nil || id <= 0 {
		return
	}
	_, _ = execContext(`
		UPDATE request_incidents
		SET status = $2,
		    notes = CASE WHEN COALESCE(notes, '') = '' THEN $3 ELSE notes || E'\n' || $3 END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, normalizeIncidentStatus(status), note)
}

func iamDevopsApprover(userID int) bool {
	if DB == nil {
		return true
	}
	user, err := GetUserByID(userID)
	return err == nil && user != nil && (user.Role == "admin" || user.UserType == "devops_user")
}

func applyIAMDecision(item *iamRequest, actor int, decision, version string) (string, int) {
	if item.RequesterID == actor {
		return "you cannot approve a request you submitted", http.StatusForbidden
	}
	if !iamDevopsApprover(actor) {
		return "only the DevOps team can approve this access", http.StatusForbidden
	}
	if strings.TrimSpace(version) == "" || version != item.VersionHash {
		return "approval does not match the evaluated request", http.StatusConflict
	}
	if item.Status != "PENDING_DEVOPS_APPROVAL" {
		return "this request is not waiting for the DevOps team", http.StatusConflict
	}
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "rejected":
		item.Status = "REJECTED"
	case "approved":
		item.Status = "PROVISIONING"
	default:
		return "decision must be approved or rejected", http.StatusBadRequest
	}
	return "", 0
}

func writeIAM(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
