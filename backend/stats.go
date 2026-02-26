package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func statsHandler(w http.ResponseWriter, r *http.Request) {
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

	userIDInt := 0
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		token := authHeader[7:]
		if id, err := validateToken(token); err == nil {
			userIDInt = id
		}
	}

	stats, err := GetStats(userIDInt)
	if err != nil {
		log.Printf("Error fetching stats: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to fetch stats",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"stats":  stats,
	})
}

func historyDetailHandler(w http.ResponseWriter, r *http.Request) {
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

	// Extract ID from path: /api/history/123
	path := strings.TrimPrefix(r.URL.Path, "/api/history/")
	idStr := strings.Split(path, "/")[0]
	if idStr == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "missing request ID",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid request ID",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil {
		log.Printf("Error fetching PR request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to fetch request",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if req == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "request not found",
			"status": "error",
		})
		w.WriteHeader(http.StatusNotFound)
		return
	}

	userID := 0
	if authHeader := r.Header.Get("Authorization"); authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		if id, err := validateToken(strings.TrimSpace(authHeader[7:])); err == nil {
			userID = id
		}
	}
	canApproveByManager := CanApproveByManager(req, userID)
	dependsOn, _ := GetRequestDependencies(id)
	blockedBy, _ := GetRequestsThatDependOn(id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                 "success",
		"request":                req,
		"can_approve_by_manager": canApproveByManager,
		"depends_on":             dependsOn,
		"blocked_by":             blockedBy,
	})
}
