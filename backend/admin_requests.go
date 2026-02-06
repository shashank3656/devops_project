package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// adminRequestsHandler GET /api/admin/requests - list all PR requests (admin only, no user filter)
func adminRequestsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	team := r.URL.Query().Get("team")
	env := r.URL.Query().Get("env")
	cloud := r.URL.Query().Get("cloud")
	statusFilter := r.URL.Query().Get("status")
	priorityFilter := r.URL.Query().Get("priority")
	prIDStr := r.URL.Query().Get("id")
	prID := 0
	if prIDStr != "" {
		if parsed, err := strconv.Atoi(prIDStr); err == nil && parsed > 0 {
			prID = parsed
		}
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// userID 0 = all requests
	requests, err := GetPRRequests(team, env, cloud, statusFilter, priorityFilter, prID, 0, limit, offset)
	if err != nil {
		log.Printf("Admin requests: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch requests", "status": "error"})
		return
	}
	totalCount, _ := GetTotalCount(team, env, cloud, statusFilter, priorityFilter, prID, 0)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":       "success",
		"requests":     requests,
		"count":        len(requests),
		"total_count":  totalCount,
		"limit":        limit,
		"offset":       offset,
	})
}

// adminStatsHandler GET /api/admin/stats - dashboard stats for all PR requests (admin only)
func adminStatsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	stats, err := GetStats(0)
	if err != nil {
		log.Printf("Admin stats: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch stats", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "stats": stats})
}

// adminNotificationsHandler GET /api/admin/notifications - count of new (pending_approval) requests for badge
func adminNotificationsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"new_requests": 0, "status": "ok"})
		return
	}
	count, _ := GetPendingApprovalCount()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"new_requests": count, "status": "ok"})
}

// adminBulkApproveHandler POST /api/admin/requests/bulk-approve with body {"ids": [1,2,3]}
func adminBulkApproveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "ids array required", "status": "error"})
		return
	}
	var approved, failed []int
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil || req.Status != "pending_approval" {
			failed = append(failed, id)
			continue
		}
		prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config))
		if err != nil {
			log.Printf("Bulk approve id %d: %v", id, err)
			failed = append(failed, id)
			continue
		}
		if err := UpdatePRRequestWithPR(id, prURL); err != nil {
			failed = append(failed, id)
			continue
		}
		approved = append(approved, id)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"approved": approved,
		"failed":   failed,
	})
}

// adminBulkRejectHandler POST /api/admin/requests/bulk-reject with body {"ids": [1,2,3]}
func adminBulkRejectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "ids array required", "status": "error"})
		return
	}
	var rejected, failed []int
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil || req.Status != "pending_approval" {
			failed = append(failed, id)
			continue
		}
		if err := UpdatePRRequestStatus(id, "rejected"); err != nil {
			failed = append(failed, id)
			continue
		}
		rejected = append(rejected, id)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"rejected": rejected,
		"failed":   failed,
	})
}

// adminRequestActionHandler handles /api/admin/requests/:id/approve, /reject, /status (admin only)
func adminRequestActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/admin/requests/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) >= 1 && parts[0] == "bulk-approve" {
		adminBulkApproveHandler(w, r)
		return
	}
	if len(parts) >= 1 && parts[0] == "bulk-reject" {
		adminBulkRejectHandler(w, r)
		return
	}
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	idStr, action := parts[0], parts[1]
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request id", "status": "error"})
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request not found", "status": "error"})
		return
	}

	switch action {
	case "approve":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if req.Status != "pending_approval" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "only pending_approval requests can be approved", "status": "error"})
			return
		}
		prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config))
		if err != nil {
			log.Printf("Admin approve: create PR failed: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": fmt.Sprintf("failed to create PR: %v", err), "status": "error"})
			return
		}
		if err := UpdatePRRequestWithPR(id, prURL); err != nil {
			log.Printf("Admin approve: update request failed: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "pr_url": prURL, "message": "PR created and request set to in_progress"})
		return

	case "reject":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if req.Status != "pending_approval" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "only pending_approval requests can be rejected", "status": "error"})
			return
		}
		if err := UpdatePRRequestStatus(id, "rejected"); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Request rejected"})
		return

	case "status":
		if r.Method != "PATCH" && r.Method != "PUT" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		switch body.Status {
		case "in_progress", "completed", "rejected":
			// allow admin to set completed (e.g. when PR merged) or revert
			break
		default:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "status must be in_progress, completed, or rejected", "status": "error"})
			return
		}
		if err := UpdatePRRequestStatus(id, body.Status); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "request_status": body.Status})
		return

	default:
		http.NotFound(w, r)
		return
	}
}
