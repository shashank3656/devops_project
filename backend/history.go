package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
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
	cloud := r.URL.Query().Get("cloud")
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	prIDStr := r.URL.Query().Get("id") // PR number filter
	userID := r.URL.Query().Get("user_id")

	// Parse PR ID
	prID := 0
	if prIDStr != "" {
		if parsed, err := strconv.Atoi(prIDStr); err == nil && parsed > 0 {
			prID = parsed
		}
	}

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
	userIDInt := 0
	if userID != "" {
		if id, err := strconv.Atoi(userID); err == nil {
			userIDInt = id
		}
	} else {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token := authHeader[7:]
			if id, err := validateToken(token); err == nil {
				userIDInt = id
			}
		}
	}

	// view=team: if user is manager (portal team manager or has reportees via manager_id), show all tickets from team + reportees; else same as normal (own tickets)
	createdByIn := ([]int)(nil)
	if r.URL.Query().Get("view") == "team" && userIDInt > 0 {
		if memberIDs, err := GetTeamMemberUserIDsForManager(userIDInt); err == nil && len(memberIDs) > 0 {
			createdByIn = memberIDs
		}
	}
	// Fetch PR requests (no status/priority filter for user history; include drafts for owner)
	requests, err := GetPRRequests(team, env, cloud, "", "", search, prID, userIDInt, createdByIn, limit, offset)
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

	// Attach creator usernames for "who raised" (especially for group/manager view)
	var creatorIDs []int
	for i := range requests {
		if requests[i].CreatedBy != nil {
			creatorIDs = append(creatorIDs, *requests[i].CreatedBy)
		}
	}
	if len(creatorIDs) > 0 {
		usernames, _ := GetUsernamesByUserIDs(creatorIDs)
		for i := range requests {
			if requests[i].CreatedBy != nil && usernames != nil {
				if name := usernames[*requests[i].CreatedBy]; name != "" {
					requests[i].CreatedByUsername = name
				}
			}
		}
	}

	// Get total count for pagination
	totalCount, _ := GetTotalCount(team, env, cloud, "", "", search, prID, userIDInt, createdByIn)

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":       "success",
		"requests":     requests,
		"count":        len(requests),
		"total_count":  totalCount,
		"limit":        limit,
		"offset":       offset,
	}

	json.NewEncoder(w).Encode(response)
}
