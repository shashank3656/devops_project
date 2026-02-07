package main

import (
	"encoding/json"
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request id", "status": "error"})
		return
	}

	userID, canCreate := checkCanCreatePR(r)
	if !canCreate {
		// Allow admin for comments
		adminID, isAdmin := requireAdmin(w, r)
		if !isAdmin {
			return
		}
		userID = adminID
	}

	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request not found", "status": "error"})
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

	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

// handleRequestResubmit clones a rejected (or any) request as a new draft - POST /api/request/:id/resubmit
func handleRequestResubmit(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator can resubmit this request", "status": "error"})
		return
	}
	// Clone as new draft (same config, new application_id/branch)
	appID, err := GenerateApplicationID()
	if err != nil {
		log.Printf("Resubmit GenerateApplicationID: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	branchName := req.Team + "/" + req.Env + "/" + appID
	newReq := &PRRequest{
		Team:          req.Team,
		Env:           req.Env,
		Cloud:         req.Cloud,
		Service:       req.Service,
		ClientName:    req.ClientName,
		ApplicationID: appID,
		Priority:      req.Priority,
		DueDate:       req.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      req.FilePath,
		Status:        "draft",
		Config:        req.Config,
		CreatedBy:     req.CreatedBy,
	}
	if err := SavePRRequest(newReq); err != nil {
		log.Printf("Resubmit: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_resubmit", "pr_request", strconv.Itoa(newReq.ID), "cloned from #"+strconv.Itoa(id))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"id":      newReq.ID,
		"message": "Request cloned as draft. Edit and submit from History.",
	})
}

func handleRequestSubmit(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.Status != "draft" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only drafts can be submitted", "status": "error"})
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator can submit this draft", "status": "error"})
		return
	}
	// Two-step approval: if creator has a group manager (portal team manager) or creator's manager_id, first status is pending_user_manager_approval; else pending_devops_approval
	initialStatus := "pending_devops_approval"
	if req.CreatedBy != nil {
		creatorID := *req.CreatedBy
		// Prefer manager from the request's team (same team the request is filed under)
		groupManagerID := GetGroupManagerForUserInTeam(creatorID, req.Team)
		if groupManagerID == 0 {
			groupManagerID = GetGroupManagerForUser(creatorID)
		}
		if groupManagerID != 0 {
			initialStatus = "pending_user_manager_approval"
			log.Printf("[submit] request id=%d creator=%d team=%q -> pending_user_manager_approval (group_manager=%d)", id, creatorID, req.Team, groupManagerID)
		} else {
			creator, _ := GetUserByID(creatorID)
			if creator != nil && creator.ManagerID != nil && *creator.ManagerID > 0 {
				initialStatus = "pending_user_manager_approval"
				log.Printf("[submit] request id=%d creator=%d team=%q -> pending_user_manager_approval (creator.manager_id=%d)", id, creatorID, req.Team, *creator.ManagerID)
			} else {
				log.Printf("[submit] request id=%d creator=%d team=%q -> pending_devops_approval (no group manager in team and no creator.manager_id; ensure portal team has a member with role=manager)", id, creatorID, req.Team)
			}
		}
	}
	if err := UpdatePRRequestStatus(id, initialStatus); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_submit", "pr_request", strconv.Itoa(id), "draft submitted")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Draft submitted for approval"})
}

// handleRequestApproveByManager lets the creator's manager move request from pending_user_manager_approval to pending_devops_approval
func handleRequestApproveByManager(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.Status != "pending_user_manager_approval" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only requests pending user manager approval can be approved", "status": "error"})
		return
	}
	if req.CreatedBy == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	creatorID := *req.CreatedBy
	groupManagerID := GetGroupManagerForUserInTeam(creatorID, req.Team)
	if groupManagerID == 0 {
		groupManagerID = GetGroupManagerForUser(creatorID)
	}
	// Allow if current user is the group manager (portal team manager) or the creator's manager_id
	allowed := groupManagerID == userID
	if !allowed {
		if creator, err := GetUserByID(creatorID); err == nil && creator != nil && creator.ManagerID != nil && *creator.ManagerID == userID {
			allowed = true
		}
	}
	if !allowed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator's group manager or assigned manager can approve this step", "status": "error"})
		return
	}
	if err := UpdatePRRequestStatus(id, "pending_devops_approval"); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_approved_by_manager", "pr_request", strconv.Itoa(id), "Pending DevOps approval")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Approved; request is now pending DevOps approval"})
}

func handleRequestUpdateDraft(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if req.Status != "draft" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only drafts can be updated", "status": "error"})
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator can update this draft", "status": "error"})
		return
	}
	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	config := req.Config
	if c, ok := payload["config"].(string); ok && c != "" {
		config = c
	} else if len(payload) > 0 {
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Draft updated"})
}

func handleRequestDeleteDraft(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if req.Status != "draft" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only drafts can be deleted", "status": "error"})
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator can delete this draft", "status": "error"})
		return
	}
	if _, err := DB.Exec("DELETE FROM pr_requests WHERE id = $1", id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Draft deleted"})
}

// handleRequestCancel lets the creator cancel their request (draft or any pending approval state, before PR is created).
func handleRequestCancel(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.CreatedBy == nil || *req.CreatedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only the creator can cancel this request", "status": "error"})
		return
	}
	cancellable := req.Status == "draft" || req.Status == "pending_user_manager_approval" ||
		req.Status == "pending_devops_approval" || req.Status == "pending_approval"
	if !cancellable {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only draft or pending requests can be cancelled", "status": "error"})
		return
	}
	if err := UpdatePRRequestReject(id, "Cancelled by creator"); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_cancel", "pr_request", strconv.Itoa(id), "cancelled by creator")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Request cancelled"})
}

func handleRequestComments(w http.ResponseWriter, r *http.Request, requestID int, req *PRRequest, userID int) {
	// Allow creator or admin to see/post comments (userID already set from token or admin)
	canAccess := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canAccess {
		_, canAccess = requireAdmin(w, r)
	}
	if !canAccess {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "you do not have access to this request", "status": "error"})
		return
	}

	switch r.Method {
	case "GET":
		comments, err := GetRequestComments(requestID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "comments": comments})
		return
	case "POST":
		if userID <= 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "use Bearer token to post comments", "status": "error"})
			return
		}
		var body struct {
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Body) == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "body is required", "status": "error"})
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
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Comment added"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
