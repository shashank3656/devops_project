package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

func historyHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "database not available",
			"status": "error",
		})
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// Get query parameters
	team := r.URL.Query().Get("team")
	env := r.URL.Query().Get("env")
	userID := r.URL.Query().Get("user_id")

	// Get limit and offset
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

	// Get user ID from token if available
	if userID == "" {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token := authHeader[7:]
			if id, err := validateToken(token); err == nil {
				userID = strconv.Itoa(id)
			}
		}
	}

	// Fetch PR requests
	requests, err := GetPRRequests(team, env, userID, limit, offset)
	if err != nil {
		log.Printf("Error fetching PR requests: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to fetch history",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":   "success",
		"requests": requests,
		"count":    len(requests),
	}

	json.NewEncoder(w).Encode(response)
}
