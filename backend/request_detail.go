package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// requestDetailHandler handles /api/request/<id>, /api/request/<id>/submit, /api/request/<id>/comments
func requestDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/request/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	idStr := parts[0]
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid request id", nil)
		return
	}

	userID, portalOK := checkPortalUser(r)
	if !portalOK {
		adminID, isAdmin := requireAdmin(w, r)
		if !isAdmin {
			return
		}
		userID = adminID
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", nil)
		return
	}

	// Sub-path: submit, resubmit, approve-by-manager, comments
	if len(parts) >= 2 {
		switch parts[1] {
		case "submit":
			handleRequestSubmit(w, r, id, req, userID)
			return
		case "resubmit":
			handleRequestResubmit(w, r, id, req, userID)
			return
		case "approve-by-manager":
			handleRequestApproveByManager(w, r, id, req, userID)
			return
		case "comments":
			handleRequestComments(w, r, id, req, userID)
			return
		case "diff":
			requestDiffHandler(w, r, id, userID)
			return
		case "tags":
			handleRequestTags(w, r, id, req, userID)
			return
		case "cancel":
			handleRequestCancel(w, r, id, req, userID)
			return
		case "clone":
			handleRequestClone(w, r, id, req, userID)
			return
		case "rollback":
			requestRollbackHandler(w, r, id, req, userID)
			return
		case "config-history":
			handleRequestConfigHistory(w, r, id, req, userID)
			return
		case "promote":
			handleRequestPromote(w, r, id, req, userID)
			return
		case "pr-impact":
			requestPRImpactHandler(w, r, id, userID)
			return
		case "timeline":
			handleRequestTimeline(w, r, id, userID)
			return
		case "dependencies":
			handleRequestDependencies(w, r, id, req, userID)
			return
		case "lifetime":
			handleRequestLifetime(w, r, id, req, userID)
			return
		case "day2":
			handleRequestDay2(w, r, id, req, userID)
			return
		}
	}

	// PATCH /api/request/:id - update draft
	if r.Method == "PATCH" || r.Method == "PUT" {
		handleRequestUpdateDraft(w, r, id, req, userID)
		return
	}

	// DELETE /api/request/:id - delete draft (only owner, only draft)
	if r.Method == "DELETE" {
		handleRequestDeleteDraft(w, r, id, req, userID)
		return
	}

	writeMethodNotAllowed(w, r)
}

// handleRequestClone clones any request as a new draft - POST /api/request/:id/clone (creator or admin)
func handleRequestClone(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	// Creator can clone; admin can clone any
	canClone := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canClone {
		_, isAdmin := requireAdmin(w, r)
		canClone = isAdmin
	}
	if !canClone {
		writeAPIError(w, r, http.StatusForbidden, "only the creator or admin can clone this request", nil)
		return
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		log.Printf("Clone GenerateApplicationID: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	primaryCloud, primaryService := primaryRequestService(req)
	filePath, branchName := BuildRequestGitArtifacts(req.ProjectID, req.Team, primaryCloud, req.Env, primaryService, appID)
	createdBy := req.CreatedBy
	if createdBy == nil && userID > 0 {
		createdBy = &userID
	}
	newReq := &PRRequest{
		ProjectID:     req.ProjectID,
		Team:          req.Team,
		Env:           req.Env,
		Cloud:         primaryCloud,
		Service:       primaryService,
		ClientName:    req.ClientName,
		ApplicationID: appID,
		Priority:      req.Priority,
		DueDate:       req.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(req.Config, appID),
		CreatedBy:     createdBy,
	}
	applyRequestBundleEntries(newReq, req.ServiceBundle)
	if err := SavePRRequest(newReq); err != nil {
		log.Printf("Clone: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(createdBy, "request_clone", "pr_request", strconv.Itoa(newReq.ID), "cloned from #"+strconv.Itoa(id))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	encodeJSON(w, map[string]interface{}{
		"status":  "ok",
		"id":      newReq.ID,
		"message": "Request cloned as draft. Edit and submit from History.",
	})
}

// handleRequestResubmit clones a rejected (or any) request as a new draft - POST /api/request/:id/resubmit
func handleRequestResubmit(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		writeAPIError(w, r, http.StatusForbidden, "only the creator can resubmit this request", nil)
		return
	}
	// Clone as new draft (same config, new application_id/branch)
	appID, err := GenerateApplicationID()
	if err != nil {
		log.Printf("Resubmit GenerateApplicationID: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	primaryCloud, primaryService := primaryRequestService(req)
	filePath, branchName := BuildRequestGitArtifacts(req.ProjectID, req.Team, primaryCloud, req.Env, primaryService, appID)
	newReq := &PRRequest{
		ProjectID:     req.ProjectID,
		Team:          req.Team,
		Env:           req.Env,
		Cloud:         primaryCloud,
		Service:       primaryService,
		ClientName:    req.ClientName,
		ApplicationID: appID,
		Priority:      req.Priority,
		DueDate:       req.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(req.Config, appID),
		CreatedBy:     req.CreatedBy,
	}
	applyRequestBundleEntries(newReq, req.ServiceBundle)
	if err := SavePRRequest(newReq); err != nil {
		log.Printf("Resubmit: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_resubmit", "pr_request", strconv.Itoa(newReq.ID), "cloned from #"+strconv.Itoa(id))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	encodeJSON(w, map[string]interface{}{
		"status":  "ok",
		"id":      newReq.ID,
		"message": "Request cloned as draft. Edit and submit from History.",
	})
}

func handleRequestSubmit(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if req.Status != "draft" {
		writeAPIError(w, r, http.StatusBadRequest, "only drafts can be submitted", nil)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		writeAPIError(w, r, http.StatusForbidden, "only the creator can submit this draft", nil)
		return
	}
	initialStatus := determineApprovalStatusForRequest(req.ProjectID, userID, req.Team, req.Env)
	if err := UpdatePRRequestStatus(id, initialStatus); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	applyProjectDefaultLifetimeIfEligible(id, req.ProjectID, req.Env)
	AppendUserActivity(req.CreatedBy, "request_submit", "pr_request", strconv.Itoa(id), "draft submitted")
	req.Status = initialStatus
	NotifyRequestRaised(req)
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Draft submitted for approval"})
}

// CanApproveByManager returns true if the given user can approve this request (status must be pending_user_manager_approval; user must be group manager for request's team or creator's manager_id). Used by history detail to show/hide Approve button.
func CanApproveByManager(req *PRRequest, userID int) bool {
	if req.Status != "pending_user_manager_approval" || req.CreatedBy == nil || userID <= 0 {
		return false
	}
	creatorID := *req.CreatedBy
	if creatorID == userID {
		return false
	}
	groupManagerID := GetGroupManagerForUserInTeam(creatorID, req.Team)
	if groupManagerID == 0 {
		groupManagerID = GetGroupManagerForUser(creatorID)
	}
	if groupManagerID == userID {
		return true
	}
	creator, err := GetUserByID(creatorID)
	if err == nil && creator != nil && creator.ManagerID != nil && *creator.ManagerID == userID {
		return true
	}
	return portalManagerCanApproveRequest(userID, creatorID, req.Team)
}

func portalManagerCanApproveRequest(approverID, creatorID int, requestTeam string) bool {
	if approverID <= 0 || creatorID <= 0 || approverID == creatorID || DB == nil {
		return false
	}
	approver, err := GetUserByID(approverID)
	if err != nil || approver == nil || !approver.IsPortalManager {
		return false
	}
	team := strings.TrimSpace(requestTeam)
	if team != "" {
		var ok bool
		err := DB.QueryRow(`
			SELECT EXISTS (
				SELECT 1 FROM team_members mgr
				INNER JOIN teams t ON t.id = mgr.team_id AND COALESCE(t.team_type,'portal') = 'portal'
				  AND (LOWER(t.name) = LOWER($3) OR LOWER(t.slug) = LOWER($3))
				INNER JOIN team_members creator ON creator.team_id = t.id AND creator.user_id = $2
				WHERE mgr.user_id = $1
			)`, approverID, creatorID, team).Scan(&ok)
		return err == nil && ok
	}
	var ok bool
	err = DB.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM team_members mgr
			INNER JOIN team_members creator ON creator.team_id = mgr.team_id
			INNER JOIN teams t ON t.id = mgr.team_id AND COALESCE(t.team_type,'portal') = 'portal'
			WHERE mgr.user_id = $1 AND creator.user_id = $2
		)`, approverID, creatorID).Scan(&ok)
	return err == nil && ok
}

// handleRequestApproveByManager lets the creator's manager move request from pending_user_manager_approval to pending_devops_approval
func handleRequestApproveByManager(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if req.Status != "pending_user_manager_approval" {
		writeAPIError(w, r, http.StatusBadRequest, "only requests pending user manager approval can be approved", nil)
		return
	}
	if req.CreatedBy == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !CanApproveByManager(req, userID) {
		writeAPIError(w, r, http.StatusForbidden, "only the creator's group manager or assigned manager can approve this step", nil)
		return
	}
	nextStatus := determinePostManagerApprovalStatus(req.ProjectID, req.Env)
	if err := UpdatePRRequestStatus(id, nextStatus); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_approved_by_manager", "pr_request", strconv.Itoa(id), strings.ReplaceAll(nextStatus, "_", " "))
	NotifyRequestApproved(req, fmt.Sprintf("Request #%d was approved and is now %s.", id, strings.ReplaceAll(nextStatus, "_", " ")))
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": fmt.Sprintf("Approved; request is now %s", strings.ReplaceAll(nextStatus, "_", " "))})
}

func handleRequestUpdateDraft(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if req.Status != "draft" {
		writeAPIError(w, r, http.StatusBadRequest, "only drafts can be updated", nil)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		writeAPIError(w, r, http.StatusForbidden, "only the creator can update this draft", nil)
		return
	}
	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	config := req.Config
	if c, ok := payload["config"].(string); ok && c != "" {
		config = c
	} else if len(payload) > 0 {
		if _, err := canonicalizeRequestBundlePayload(payload); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}
		ensureRequestPayloadApplicationID(payload, req.ApplicationID)
		content, err := json.MarshalIndent(payload, "", "  ")
		if err == nil {
			config = string(content)
		}
	}
	priority, _ := payload["priority"].(string)
	if priority == "" {
		priority = req.Priority
	}
	if priority != "low" && priority != "medium" && priority != "high" && priority != "critical" {
		priority = "medium"
	}
	var dueDate *time.Time
	if d, ok := payload["due_date"].(string); ok && d != "" {
		if t, err := time.Parse("2006-01-02", d); err == nil {
			dueDate = &t
		}
	} else if req.DueDate != nil {
		dueDate = req.DueDate
	}
	if err := UpdatePRRequestFull(id, config, priority, dueDate, "draft"); err != nil {
		log.Printf("Update draft: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	updatedReq := &PRRequest{
		ID:      id,
		Cloud:   req.Cloud,
		Service: req.Service,
		Config:  config,
	}
	if err := replaceRequestServiceItems(id, updatedReq); err != nil {
		log.Printf("Update draft service items: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Draft updated"})
}

func handleRequestDeleteDraft(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if req.Status != "draft" {
		writeAPIError(w, r, http.StatusBadRequest, "only drafts can be deleted", nil)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		writeAPIError(w, r, http.StatusForbidden, "only the creator can delete this draft", nil)
		return
	}
	if _, err := DB.Exec("DELETE FROM pr_requests WHERE id = $1", id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Draft deleted"})
}

// handleRequestCancel lets the creator cancel their request (draft or any pending approval state, before PR is created).
func handleRequestCancel(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		writeAPIError(w, r, http.StatusForbidden, "only the creator can cancel this request", nil)
		return
	}
	cancellable := req.Status == "draft" || req.Status == "pending_user_manager_approval" ||
		req.Status == "pending_devops_approval" || req.Status == "pending_approval"
	if !cancellable {
		writeAPIError(w, r, http.StatusBadRequest, "only draft or pending requests can be cancelled", nil)
		return
	}
	if err := UpdatePRRequestReject(id, "Cancelled by creator"); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_cancel", "pr_request", strconv.Itoa(id), "cancelled by creator")
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Request cancelled"})
}

func handleRequestComments(w http.ResponseWriter, r *http.Request, requestID int, req *PRRequest, userID int) {
	// Allow creator or admin to see/post comments (userID already set from token or admin)
	canAccess := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canAccess {
		_, canAccess = requireAdmin(w, r)
		if !canAccess {
			return // requireAdmin already wrote 401/403; do not write again
		}
	}

	switch r.Method {
	case "GET":
		comments, err := GetRequestComments(requestID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "success", "comments": comments})
		return
	case "POST":
		if userID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "use Bearer token to post comments", nil)
			return
		}
		var body struct {
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Body) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "body is required", nil)
			return
		}
		if err := AddRequestComment(requestID, userID, strings.TrimSpace(body.Body)); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		uid := userID
		AppendUserActivity(&uid, "request_comment", "pr_request", strconv.Itoa(requestID), "")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Comment added"})
		return
	default:
		writeMethodNotAllowed(w, r)
	}
}

// handleRequestTimeline GET /api/request/:id/timeline - audit trail for a request
func handleRequestTimeline(w http.ResponseWriter, r *http.Request, id int, userID int) {
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	timeline, err := GetRequestTimeline(id)
	if err != nil {
		log.Printf("GetRequestTimeline: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch timeline", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "timeline": timeline})
}

// handleRequestDependencies GET /api/request/:id/dependencies, POST (add), DELETE /api/request/:id/dependencies/:depId
func handleRequestDependencies(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	path := strings.TrimPrefix(r.URL.Path, "/api/request/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	// parts: [id, "dependencies"] or [id, "dependencies", depId]
	if len(parts) < 2 || parts[1] != "dependencies" {
		http.NotFound(w, r)
		return
	}
	canAccess := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canAccess {
		if _, isAdmin := requireAdmin(w, r); isAdmin {
			canAccess = true
		}
	}
	if !canAccess {
		writeAPIError(w, r, http.StatusForbidden, "only creator or admin can manage dependencies", nil)
		return
	}
	switch r.Method {
	case "GET":
		deps, err := GetRequestDependencies(id)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		blockedBy, _ := GetRequestsThatDependOn(id)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status":     "ok",
			"depends_on": deps,
			"blocked_by": blockedBy,
		})
		return
	case "POST":
		var body struct {
			DependsOnRequestID int `json:"depends_on_request_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.DependsOnRequestID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "depends_on_request_id required", nil)
			return
		}
		if err := AddRequestDependency(id, body.DependsOnRequestID); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Dependency added"})
		return
	case "DELETE":
		if len(parts) < 3 {
			writeAPIError(w, r, http.StatusBadRequest, "depends_on_request_id required in path", nil)
			return
		}
		depID, _ := strconv.Atoi(parts[2])
		if depID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid dependency id", nil)
			return
		}
		if err := RemoveRequestDependency(id, depID); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Dependency removed"})
		return
	default:
		writeMethodNotAllowed(w, r)
	}
}
