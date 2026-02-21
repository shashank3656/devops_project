package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// requestRollbackHandler POST /api/request/:id/rollback - restore config from history (creator or admin)
// Body: { "history_id": 123 } or { "config": "..." } to restore specific snapshot
func requestRollbackHandler(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	canRollback := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canRollback {
		_, isAdmin := requireAdmin(w, r)
		canRollback = isAdmin
	}
	if !canRollback {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only creator or admin can rollback", "status": "error"})
		return
	}
	// Only draft or in_progress can be rolled back
	if req.Status != "draft" && req.Status != "in_progress" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only draft or in_progress requests can be rolled back", "status": "error"})
		return
	}
	var body struct {
		HistoryID int    `json:"history_id"`
		Config    string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	var configToRestore string
	if body.HistoryID > 0 {
		history, err := GetRequestConfigHistory(id, 50)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		for _, h := range history {
			if h.ID == body.HistoryID {
				configToRestore = h.Config
				break
			}
		}
		if configToRestore == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "history snapshot not found", "status": "error"})
			return
		}
	} else if strings.TrimSpace(body.Config) != "" {
		configToRestore = body.Config
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "history_id or config required", "status": "error"})
		return
	}
	// Update request config
	if err := UpdatePRRequestConfig(id, configToRestore); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	_ = SaveRequestConfigHistory(id, configToRestore, "rollback")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Config rolled back"})
}

// handleRequestConfigHistory GET /api/request/:id/config-history - list config snapshots for rollback
func handleRequestConfigHistory(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	canView := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canView {
		_, canView = requireAdmin(w, r)
	}
	if !canView {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access denied", "status": "error"})
		return
	}
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}
	history, err := GetRequestConfigHistory(id, limit)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	out := make([]map[string]interface{}, 0, len(history))
	for _, h := range history {
		out = append(out, map[string]interface{}{
			"id":         h.ID,
			"config":     h.Config,
			"created_at": h.CreatedAt,
			"note":       h.Note,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"history": out, "status": "ok"})
}
