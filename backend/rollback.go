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
		writeMethodNotAllowed(w, r)
		return
	}
	canRollback := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canRollback {
		_, isAdmin := requireAdmin(w, r)
		canRollback = isAdmin
	}
	if !canRollback {
		writeAPIError(w, r, http.StatusForbidden, "only creator or admin can rollback", nil)
		return
	}
	// Only draft or in_progress can be rolled back
	if req.Status != "draft" && req.Status != "in_progress" {
		writeAPIError(w, r, http.StatusBadRequest, "only draft or in_progress requests can be rolled back", nil)
		return
	}
	var body struct {
		HistoryID int    `json:"history_id"`
		Config    string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
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
			writeAPIError(w, r, http.StatusNotFound, "history snapshot not found", nil)
			return
		}
	} else if strings.TrimSpace(body.Config) != "" {
		configToRestore = body.Config
	} else {
		writeAPIError(w, r, http.StatusBadRequest, "history_id or config required", nil)
		return
	}
	// Update request config
	if err := UpdatePRRequestConfig(id, configToRestore); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	_ = SaveRequestConfigHistory(id, configToRestore, "rollback")
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "message": "Config rolled back"})
}

// handleRequestConfigHistory GET /api/request/:id/config-history - list config snapshots for rollback
func handleRequestConfigHistory(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	canView := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canView {
		_, canView = requireAdmin(w, r)
	}
	if !canView {
		writeAPIError(w, r, http.StatusForbidden, "access denied", nil)
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
	encodeJSON(w, map[string]interface{}{"history": out, "status": "ok"})
}
