package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func historyHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	// Get query parameters
	team := r.URL.Query().Get("team")
	env := requestQueryEnv(r)
	cloud := r.URL.Query().Get("cloud")
	projectID := 0
	if rawProjectID := strings.TrimSpace(r.URL.Query().Get("project_id")); rawProjectID != "" {
		if parsed, err := strconv.Atoi(rawProjectID); err == nil && parsed > 0 {
			projectID = parsed
		}
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	prIDStr := r.URL.Query().Get("id") // PR number filter
	userID := r.URL.Query().Get("user_id")
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))
	fromDate := strings.TrimSpace(r.URL.Query().Get("from"))
	toDate := strings.TrimSpace(r.URL.Query().Get("to"))
	applicationID := strings.TrimSpace(r.URL.Query().Get("application_id"))

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

	// Get user ID from token or API key if available
	userIDInt := 0
	if userID != "" {
		if id, err := strconv.Atoi(userID); err == nil {
			userIDInt = id
		}
	} else {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token := strings.TrimSpace(authHeader[7:])
			id, scopes, err := validateTokenOrAPIKey(token)
			if err == nil {
				if scopes != "" && !hasScope(scopes, "history:read") {
					writeAPIError(w, r, http.StatusForbidden, "api key does not have history:read scope", nil)
					return
				}
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
	// Fetch PR requests (status, date range, application_id for user history)
	requests, err := GetPRRequestsForHistory(team, env, cloud, projectID, statusFilter, search, prID, applicationID, fromDate, toDate, userIDInt, createdByIn, limit, offset)
	if err != nil {
		log.Printf("Error fetching PR requests: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch history", err)
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
	totalCount, _ := GetTotalCountForHistory(team, env, cloud, projectID, statusFilter, search, prID, applicationID, fromDate, toDate, userIDInt, createdByIn)

	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=history.csv")
		all, _ := GetPRRequestsForHistory(team, env, cloud, projectID, statusFilter, search, prID, applicationID, fromDate, toDate, userIDInt, createdByIn, 10000, 0)
		csvLine := func(ss ...string) string {
			for i, s := range ss {
				if strings.Contains(s, ",") || strings.Contains(s, "\"") || strings.Contains(s, "\n") {
					ss[i] = "\"" + strings.ReplaceAll(strings.ReplaceAll(s, "\"", "\"\""), "\n", " ") + "\""
				}
			}
			return strings.Join(ss, ",")
		}
		if _, err := w.Write([]byte(csvLine("id", "project", "team", "env", "cloud", "service", "status", "created_at", "updated_at") + "\n")); err != nil {
			log.Printf("history csv header write failed: %v", err)
			return
		}
		for _, rq := range all {
			if _, err := w.Write([]byte(csvLine(
				strconv.Itoa(rq.ID), rq.ProjectName, rq.Team, rq.Env, rq.Cloud, rq.Service, rq.Status,
				rq.CreatedAt.Format(time.RFC3339), rq.UpdatedAt.Format(time.RFC3339),
			) + "\n")); err != nil {
				log.Printf("history csv row write failed: %v", err)
				return
			}
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if requests == nil {
		requests = []PRRequest{}
	}
	response := map[string]interface{}{
		"status":      "success",
		"requests":    requests,
		"count":       len(requests),
		"total_count": totalCount,
		"limit":       limit,
		"offset":      offset,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("history response encode failed: %v", err)
	}
}
