package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
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
	requests, err := GetPRRequests(team, env, cloud, prID, 0, limit, offset)
	if err != nil {
		log.Printf("Admin requests: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch requests", "status": "error"})
		return
	}
	totalCount, _ := GetTotalCount(team, env, cloud, prID, 0)

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
