package main

import (
	"net/http"
	"strconv"
	"strings"
)

func enableCORSLogs(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

// logsCloudHandler returns recent PR/activity logs grouped by cloud (GET /api/logs/cloud)
func logsCloudHandler(w http.ResponseWriter, r *http.Request) {
	enableCORSLogs(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	requests, err := GetPRRequests("", "", "", 0, "", "", "", 0, 0, nil, limit, 0, "", "", false, "", "")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeJSON(w, map[string]interface{}{"error": "failed to fetch logs", "status": "error"})
		return
	}

	// Group by cloud: cloud name -> list of log entries
	type cloudLogEntry struct {
		ID        int    `json:"id"`
		Message   string `json:"message"`
		Team      string `json:"team"`
		Env       string `json:"env"`
		Service   string `json:"service"`
		PRURL     string `json:"pr_url"`
		CreatedAt string `json:"created_at"`
	}
	byCloud := make(map[string][]cloudLogEntry)
	for _, req := range requests {
		cloud := strings.TrimSpace(req.Cloud)
		if cloud == "" {
			cloud = "Other"
		}
		msg := "Request: " + req.Team + "/" + req.Env + " - " + req.Service
		byCloud[cloud] = append(byCloud[cloud], cloudLogEntry{
			ID:        req.ID,
			Message:   msg,
			Team:      req.Team,
			Env:       req.Env,
			Service:   req.Service,
			PRURL:     req.PRURL,
			CreatedAt: req.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"clouds": byCloud,
		"status": "ok",
	})
}

// logsGitHubHandler returns recent GitHub activity logs (GET /api/logs/github)
func logsGitHubHandler(w http.ResponseWriter, r *http.Request) {
	enableCORSLogs(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	entries, err := GetGitHubLogs(limit)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeJSON(w, map[string]interface{}{"error": "failed to fetch logs", "status": "error"})
		return
	}

	// Format for frontend
	type logRow struct {
		ID        int    `json:"id"`
		EventType string `json:"event_type"`
		Message   string `json:"message"`
		Details   string `json:"details"`
		CreatedAt string `json:"created_at"`
	}
	out := make([]logRow, len(entries))
	for i, e := range entries {
		out[i] = logRow{
			ID:        e.ID,
			EventType: e.EventType,
			Message:   e.Message,
			Details:   e.Details,
			CreatedAt: e.CreatedAt.Format("2006-01-02 15:04:05"),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"logs":   out,
		"status": "ok",
	})
}
