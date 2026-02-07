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

	// Sub-path: submit, resubmit, comments
	if len(parts) >= 2 {
		switch parts[1] {
		case "submit":
			handleRequestSubmit(w, r, id, req, userID)
			return
		case "resubmit":
			handleRequestResubmit(w, r, id, req, userID)
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
	// Clone as new draft (same config, clear reject_reason, status=draft)
	newReq := &PRRequest{
		Team:       req.Team,
		Env:        req.Env,
		Cloud:      req.Cloud,
		Service:    req.Service,
		ClientName: req.ClientName,
		Priority:   req.Priority,
		DueDate:    req.DueDate,
		PRURL:      "",
		Branch:     req.Branch,
		FilePath:   req.FilePath,
		Status:     "draft",
		Config:     req.Config,
		CreatedBy:  req.CreatedBy,
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
	if err := UpdatePRRequestStatus(id, "pending_approval"); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(req.CreatedBy, "request_submit", "pr_request", strconv.Itoa(id), "draft submitted")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Draft submitted for approval"})
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
	if priority != "low" && priority != "medium" && priority != "high" && priority != "urgent" {
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
