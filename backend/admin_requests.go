package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func encodeAdminJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("admin response encode failed: %v", err)
	}
}

// adminDashboardStatsHandler GET /api/admin/dashboard-stats - quick counts for admin dashboard
func adminDashboardStatsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"total_users": 0, "total_teams": 0, "unverified_users": 0,
			"requests_this_week": 0, "pending_approval": 0, "status": "ok",
		}); err != nil {
			log.Printf("admin dashboard stats encode failed: %v", err)
		}
		return
	}
	stats, _ := GetDashboardStats()
	atRisk, _ := GetAtRiskCount()
	baseResp := map[string]interface{}{
		"total_users":        stats.TotalUsers,
		"total_teams":        stats.TotalTeams,
		"unverified_users":   stats.UnverifiedUsers,
		"requests_this_week": stats.RequestsThisWeek,
		"pending_approval":   stats.PendingApproval,
		"at_risk_count":      atRisk,
		"status":             "ok",
	}

	// Date-wise filter: ?from=YYYY-MM-DD&to=YYYY-MM-DD or ?period=today|week|month
	var fromDate, toDate time.Time
	filterPeriod := ""
	filterFrom := ""
	filterTo := ""
	now := time.Now()
	if period := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("period"))); period != "" {
		switch period {
		case "today":
			filterPeriod = period
			fromDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			toDate = fromDate
		case "week":
			filterPeriod = period
			fromDate = now.AddDate(0, 0, -6)
			fromDate = time.Date(fromDate.Year(), fromDate.Month(), fromDate.Day(), 0, 0, 0, 0, fromDate.Location())
			toDate = now
		case "month":
			filterPeriod = period
			fromDate = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			toDate = now
		}
	}
	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			filterFrom = t.Format("2006-01-02")
			fromDate = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			filterTo = t.Format("2006-01-02")
			toDate = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
		}
	}
	if !fromDate.IsZero() || !toDate.IsZero() {
		if fromDate.IsZero() {
			fromDate = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		}
		if toDate.IsZero() {
			toDate = now
		}
		if fromDate.After(toDate) {
			fromDate, toDate = toDate, fromDate
		}
	}
	filterKey := []string{
		filterPeriod,
		filterFrom,
		filterTo,
	}
	resp, err := cacheJSON[map[string]interface{}](cacheNamespaceAdmin, 90*time.Second, filterKey, func() (map[string]interface{}, error) {
		cachedResp := map[string]interface{}{
			"total_users":        stats.TotalUsers,
			"total_teams":        stats.TotalTeams,
			"unverified_users":   stats.UnverifiedUsers,
			"requests_this_week": stats.RequestsThisWeek,
			"pending_approval":   stats.PendingApproval,
			"at_risk_count":      atRisk,
			"status":             "ok",
		}
		if !fromDate.IsZero() || !toDate.IsZero() {
			dateStats, err := GetRequestsByStatusInDateRange(fromDate, toDate)
			if err == nil {
				cachedResp["date_filter"] = map[string]interface{}{
					"from":      dateStats.From,
					"to":        dateStats.To,
					"total":     dateStats.Total,
					"by_status": dateStats.ByStatus,
				}
			}
		}
		fromParam, toParam := "", ""
		if !fromDate.IsZero() {
			fromParam = fromDate.Format("2006-01-02")
		}
		if !toDate.IsZero() {
			toParam = toDate.Format("2006-01-02") + " 23:59:59"
		}
		if avgHours, cnt, err := GetSLAMetrics("", fromParam, toParam); err == nil && cnt > 0 {
			cachedResp["sla"] = map[string]interface{}{"avg_hours": avgHours, "completed_count": cnt}
		}
		if teamComp, err := GetTeamComparison(fromParam, toParam); err == nil {
			cachedResp["team_comparison"] = teamComp
		}
		if trend, err := GetRequestsTrend(14, ""); err == nil {
			cachedResp["trend"] = trend
		}
		return cachedResp, nil
	})
	if err != nil || resp == nil {
		resp = baseResp
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("admin dashboard stats encode failed: %v", err)
	}
}

// adminAuditLogHandler GET /api/admin/audit-log - list admin audit log entries
func adminAuditLogHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"entries": []interface{}{}, "status": "ok"}); err != nil {
			log.Printf("admin audit log empty response encode failed: %v", err)
		}
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	actionFilter := r.URL.Query().Get("action")
	fromDate := strings.TrimSpace(r.URL.Query().Get("from"))
	toDate := strings.TrimSpace(r.URL.Query().Get("to"))
	projectID := 0
	if rawProjectID := strings.TrimSpace(r.URL.Query().Get("project_id")); rawProjectID != "" {
		if parsed, err := strconv.Atoi(rawProjectID); err == nil && parsed > 0 {
			projectID = parsed
		}
	}
	entries, err := GetAuditLogs(limit, offset, actionFilter, fromDate, toDate, projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch audit log", err)
		return
	}
	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=audit-log.csv")
		csvLine := func(ss ...string) string {
			for i, s := range ss {
				if strings.Contains(s, ",") || strings.Contains(s, "\"") || strings.Contains(s, "\n") {
					ss[i] = "\"" + strings.ReplaceAll(strings.ReplaceAll(s, "\"", "\"\""), "\n", " ") + "\""
				}
			}
			return strings.Join(ss, ",")
		}
		if _, err := w.Write([]byte(csvLine("id", "created_at", "admin_username", "action", "resource_type", "resource_id", "project_name", "project_code", "details") + "\n")); err != nil {
			return
		}
		all, _ := GetAuditLogs(10000, 0, actionFilter, fromDate, toDate, projectID)
		for _, e := range all {
			if _, err := w.Write([]byte(csvLine(
				strconv.Itoa(e.ID),
				e.CreatedAt.Format("2006-01-02 15:04:05"),
				e.AdminUsername,
				e.Action,
				e.ResourceType,
				e.ResourceID,
				e.ProjectName,
				e.ProjectCode,
				e.Details,
			) + "\n")); err != nil {
				return
			}
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"entries": entries, "status": "ok"}); err != nil {
		log.Printf("admin audit log response encode failed: %v", err)
	}
}

// adminAnalyticsHandler GET /api/admin/analytics/requests - extended analytics (trend, by team/env/cloud, SLA)
func adminAnalyticsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"trend": []interface{}{}, "by_team": []interface{}{}, "by_env": []interface{}{}, "by_cloud": []interface{}{}, "sla": nil, "status": "ok"}); err != nil {
			log.Printf("admin analytics empty response encode failed: %v", err)
		}
		return
	}
	days := 14
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 90 {
			days = n
		}
	}
	teamFilter := strings.TrimSpace(r.URL.Query().Get("team"))
	trend, _ := GetRequestsTrend(days, teamFilter)
	teamComp, _ := GetTeamComparison("", "")
	avgHours, slaCnt, _ := GetSLAMetrics(teamFilter, "", "")
	slaResp := map[string]interface{}{"avg_hours": avgHours, "completed_count": slaCnt}
	if slaCnt == 0 {
		slaResp = nil
	}
	stats, _ := GetStats(0)
	byEnv := []map[string]interface{}{}
	byCloud := []map[string]interface{}{}
	if stats != nil {
		for k, v := range stats.ByEnv {
			byEnv = append(byEnv, map[string]interface{}{"name": k, "count": v})
		}
		for k, v := range stats.ByCloud {
			byCloud = append(byCloud, map[string]interface{}{"name": k, "count": v})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"trend":    trend,
		"by_team":  teamComp,
		"by_env":   byEnv,
		"by_cloud": byCloud,
		"sla":      slaResp,
		"status":   "ok",
	}); err != nil {
		log.Printf("admin analytics response encode failed: %v", err)
	}
}

// adminSLABreachCheckHandler GET /api/admin/sla-breach-check - find at-risk requests, send notifications, mark notified.
// Call from cron (e.g. every hour) to send SLA breach alerts. Requires admin auth.
func adminSLABreachCheckHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"notified": 0, "status": "ok"}); err != nil {
			log.Printf("admin sla breach empty response encode failed: %v", err)
		}
		return
	}
	reqs, err := GetAtRiskRequestsForSLABreach(50)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch at-risk requests", err)
		return
	}
	notified := 0
	for _, req := range reqs {
		NotifySLABreach(&req)
		_ = UpdateSLABreachNotified(req.ID)
		notified++
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"notified": notified, "status": "ok"}); err != nil {
		log.Printf("admin sla breach response encode failed: %v", err)
	}
}

// adminRequestsHandler GET /api/admin/requests - list all PR requests (admin only, no user filter)
func adminRequestsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	team := r.URL.Query().Get("team")
	env := r.URL.Query().Get("env")
	cloud := r.URL.Query().Get("cloud")
	statusFilter := r.URL.Query().Get("status")
	priorityFilter := r.URL.Query().Get("priority")
	projectID := 0
	if rawProjectID := strings.TrimSpace(r.URL.Query().Get("project_id")); rawProjectID != "" {
		if parsed, err := strconv.Atoi(rawProjectID); err == nil && parsed > 0 {
			projectID = parsed
		}
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	prIDStr := r.URL.Query().Get("id")
	prID := 0
	if prIDStr != "" {
		if parsed, err := strconv.Atoi(prIDStr); err == nil && parsed > 0 {
			prID = parsed
		}
	}
	sortBy := strings.TrimSpace(r.URL.Query().Get("sort_by"))
	if sortBy != "created_at" && sortBy != "updated_at" && sortBy != "priority" && sortBy != "due_date" {
		sortBy = "created_at"
	}
	sortOrder := strings.TrimSpace(r.URL.Query().Get("sort_order"))
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	atRiskOnly := r.URL.Query().Get("at_risk") == "1" || strings.ToLower(r.URL.Query().Get("at_risk")) == "true"
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
	requests, err := GetPRRequests(team, env, cloud, projectID, statusFilter, priorityFilter, search, prID, 0, nil, limit, offset, sortBy, sortOrder, atRiskOnly, "", "")
	if err != nil {
		log.Printf("Admin requests: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch requests", err)
		return
	}
	totalCount, _ := GetTotalCount(team, env, cloud, projectID, statusFilter, priorityFilter, search, prID, 0, nil, atRiskOnly, "", "")

	// Enrich with due_status and created_by_username for UI
	userIDs := make([]int, 0)
	for _, req := range requests {
		if req.CreatedBy != nil && *req.CreatedBy > 0 {
			userIDs = append(userIDs, *req.CreatedBy)
		}
	}
	usernames, _ := GetUsernamesByUserIDs(userIDs)
	enriched := make([]map[string]interface{}, 0, len(requests))
	for _, req := range requests {
		ds := ""
		if req.DueDate != nil {
			now := time.Now()
			if req.DueDate.Before(now) {
				ds = "overdue"
			} else if req.DueDate.Before(now.Add(24 * time.Hour)) {
				ds = "due_soon"
			}
		}
		obj := map[string]interface{}{
			"id": req.ID, "team": req.Team, "env": req.Env, "cloud": req.Cloud, "service": req.Service,
			"client_name": req.ClientName, "application_id": req.ApplicationID, "priority": req.Priority,
			"due_date": req.DueDate, "due_status": ds, "pr_url": req.PRURL, "branch": req.Branch, "status": req.Status,
			"created_by": req.CreatedBy, "assigned_to": req.AssignedTo, "created_at": req.CreatedAt, "updated_at": req.UpdatedAt,
			"project_id": req.ProjectID, "project_name": req.ProjectName, "project_code": req.ProjectCode,
		}
		if req.CreatedBy != nil && usernames != nil {
			obj["created_by_username"] = usernames[*req.CreatedBy]
		}
		enriched = append(enriched, obj)
	}

	format := r.URL.Query().Get("format")
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=requests.csv")
		// Export all matching (use higher limit for CSV)
		all, _ := GetPRRequests(team, env, cloud, projectID, statusFilter, priorityFilter, search, prID, 0, nil, 10000, 0, sortBy, sortOrder, atRiskOnly, "", "")
		csvLine := func(ss ...string) string {
			for i, s := range ss {
				if strings.Contains(s, ",") || strings.Contains(s, "\"") || strings.Contains(s, "\n") {
					ss[i] = "\"" + strings.ReplaceAll(strings.ReplaceAll(s, "\"", "\"\""), "\n", " ") + "\""
				}
			}
			return strings.Join(ss, ",")
		}
		if _, err := w.Write([]byte(csvLine("id", "project", "team", "env", "cloud", "service", "priority", "status", "pr_url", "created_at", "updated_at") + "\n")); err != nil {
			return
		}
		for _, rq := range all {
			prURL := rq.PRURL
			if prURL == "" {
				prURL = ""
			}
			if _, err := w.Write([]byte(csvLine(
				strconv.Itoa(rq.ID), rq.ProjectName, rq.Team, rq.Env, rq.Cloud, rq.Service,
				rq.Priority, rq.Status, prURL,
				rq.CreatedAt.Format("2006-01-02 15:04:05"),
				rq.UpdatedAt.Format("2006-01-02 15:04:05"),
			) + "\n")); err != nil {
				return
			}
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "success",
		"requests":    enriched,
		"count":       len(enriched),
		"total_count": totalCount,
		"limit":       limit,
		"offset":      offset,
	}); err != nil {
		log.Printf("admin requests response encode failed: %v", err)
	}
}

// adminStatsHandler GET /api/admin/stats - dashboard stats for all PR requests (admin only)
func adminStatsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	stats, err := GetStats(0)
	if err != nil {
		log.Printf("Admin stats: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch stats", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "stats": stats}); err != nil {
		log.Printf("admin stats response encode failed: %v", err)
	}
}

// adminNotificationsHandler GET /api/admin/notifications - admin inbox summary and project-aware notification items.
func adminNotificationsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"new_requests": 0, "items": []interface{}{}, "total_count": 0, "counts_by_kind": map[string]int{"all": 0, "pending_request": 0, "project_event": 0}, "status": "ok"}); err != nil {
			log.Printf("admin notifications empty response encode failed: %v", err)
		}
		return
	}
	limit, offset, projectID, kind := parseOpsNotificationFilters(
		r.URL.Query().Get("limit"),
		r.URL.Query().Get("offset"),
		r.URL.Query().Get("project_id"),
		r.URL.Query().Get("kind"),
	)
	payload, err := buildAdminNotifications(limit, offset, projectID, kind)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch notifications", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("admin notifications response encode failed: %v", err)
	}
}

// adminBulkApproveHandler POST /api/admin/requests/bulk-approve with body {"ids": [1,2,3]}
func adminBulkApproveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "ids array required", err)
		return
	}
	var approved, failed []int
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil {
			failed = append(failed, id)
			continue
		}
		if req.Status == "pending_user_manager_approval" {
			if err := UpdatePRRequestStatus(id, "pending_devops_approval"); err != nil {
				failed = append(failed, id)
				continue
			}
			approved = append(approved, id)
			continue
		}
		if req.Status != "pending_approval" && req.Status != "pending_devops_approval" {
			failed = append(failed, id)
			continue
		}
		prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config), req.ApplicationID)
		if err != nil {
			log.Printf("Bulk approve id %d: %v", id, err)
			failed = append(failed, id)
			continue
		}
		if err := UpdatePRRequestWithPR(id, prURL); err != nil {
			failed = append(failed, id)
			continue
		}
		_ = AssignRequestByPriority(id)
		approved = append(approved, id)
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{
		"status":   "ok",
		"approved": approved,
		"failed":   failed,
	})
}

// adminBulkRejectHandler POST /api/admin/requests/bulk-reject with body {"ids": [1,2,3], "reason": "optional"}
func adminBulkRejectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		IDs    []int  `json:"ids"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "ids array required", err)
		return
	}
	reason := strings.TrimSpace(body.Reason)
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	var rejected, failed []int
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil {
			failed = append(failed, id)
			continue
		}
		if req.Status != "pending_approval" && req.Status != "pending_devops_approval" && req.Status != "pending_user_manager_approval" {
			failed = append(failed, id)
			continue
		}
		if err := UpdatePRRequestReject(id, reason); err != nil {
			failed = append(failed, id)
			continue
		}
		AppendAuditLog(adminIDPtr, "request_reject", "pr_request", strconv.Itoa(id), reason)
		rejected = append(rejected, id)
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{
		"status":   "ok",
		"rejected": rejected,
		"failed":   failed,
	})
}

// adminBulkStatusHandler POST /api/admin/requests/bulk-status with body {"ids": [1,2,3], "status": "completed"}
func adminBulkStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		IDs    []int  `json:"ids"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "ids array and status required", err)
		return
	}
	if body.Status != "in_progress" && body.Status != "completed" && body.Status != "rejected" {
		writeAPIError(w, r, http.StatusBadRequest, "status must be in_progress, completed, or rejected", nil)
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	var updated, failed []int
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		if err := UpdatePRRequestStatus(id, body.Status); err != nil {
			failed = append(failed, id)
			continue
		}
		AppendAuditLog(adminIDPtr, "request_status", "pr_request", strconv.Itoa(id), "bulk:"+body.Status)
		updated = append(updated, id)
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{
		"status":  "ok",
		"updated": updated,
		"failed":  failed,
	})
}

// maskConfigForAdmin redacts common secret-like keys in JSON config (recursive). Keys matched case-insensitive (password, secret, token, key, api_key, etc).
func maskConfigForAdmin(raw string) string {
	if raw == "" {
		return ""
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return raw
	}
	maskMap(m)
	b, _ := json.MarshalIndent(m, "", "  ")
	return string(b)
}

func maskMap(m map[string]interface{}) {
	const mask = "***MASKED***"
	secretKeys := map[string]bool{
		"password": true, "secret": true, "token": true, "api_key": true, "apikey": true,
		"access_key": true, "secret_key": true, "private_key": true, "authorization": true,
	}
	for k, v := range m {
		lower := strings.ToLower(k)
		if secretKeys[lower] || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "api_key") {
			m[k] = mask
			continue
		}
		if nested, ok := v.(map[string]interface{}); ok {
			maskMap(nested)
		}
	}
}

// adminRequestDetailHandler GET /api/admin/requests/:id - full request detail for admin (config masked)
func adminRequestDetailHandler(w http.ResponseWriter, r *http.Request, id int) {
	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", err)
		return
	}
	createdByUsername := ""
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		names, _ := GetUsernamesByUserIDs([]int{*req.CreatedBy})
		if names != nil {
			createdByUsername = names[*req.CreatedBy]
		}
	}
	configMasked := maskConfigForAdmin(req.Config)
	ds := ""
	if req.DueDate != nil {
		now := time.Now()
		if req.DueDate.Before(now) {
			ds = "overdue"
		} else if req.DueDate.Before(now.Add(24 * time.Hour)) {
			ds = "due_soon"
		}
	}
	resp := map[string]interface{}{
		"id": req.ID, "team": req.Team, "env": req.Env, "cloud": req.Cloud, "service": req.Service,
		"client_name": req.ClientName, "application_id": req.ApplicationID, "priority": req.Priority,
		"due_date": req.DueDate, "due_status": ds, "pr_url": req.PRURL, "branch": req.Branch, "file_path": req.FilePath,
		"status": req.Status, "reject_reason": req.RejectReason,
		"created_at": req.CreatedAt, "updated_at": req.UpdatedAt,
		"created_by": req.CreatedBy, "created_by_username": createdByUsername,
		"assigned_to":           req.AssignedTo,
		"config":                configMasked,
		"terraform_plan_output": req.TerraformPlanOutput,
		"jira_ticket_id":        req.JiraTicketID,
		"cost_risk_preview":     BuildCostRiskPreview(req),
		"approval_context":      BuildRequestApprovalContext(req),
	}
	dependsOn, _ := GetRequestDependencies(id)
	blockedBy, _ := GetRequestsThatDependOn(id)
	blockedByWithStatus, _ := GetBlockedByWithStatus(id)
	resp["depends_on"] = dependsOn
	resp["blocked_by"] = blockedBy
	resp["blocked_by_with_status"] = blockedByWithStatus
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{"request": resp, "status": "ok"})
}

// adminDevopsUsersHandler GET /api/admin/devops-users - list devops users for reassign dropdown (admin only)
func adminDevopsUsersHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"users": []interface{}{}, "status": "ok"})
		return
	}
	users, err := GetDevopsUsers()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list devops users", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{"users": users, "status": "ok"})
}

// adminRequestActionHandler handles /api/admin/requests/:id (GET detail) and /api/admin/requests/:id/approve, /reject, /status, /reassign (admin only)
func adminRequestActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
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
	if len(parts) >= 1 && parts[0] == "bulk-status" {
		adminBulkStatusHandler(w, r)
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == "GET" {
		id, err := strconv.Atoi(parts[0])
		if err == nil && id > 0 {
			adminRequestDetailHandler(w, r, id)
			return
		}
	}
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	idStr, action := parts[0], parts[1]
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid request id", err)
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", err)
		return
	}

	switch action {
	case "approve":
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		if req.Status != "pending_approval" && req.Status != "pending_devops_approval" && req.Status != "pending_user_manager_approval" {
			writeAPIError(w, r, http.StatusBadRequest, "only pending requests can be approved", nil)
			return
		}
		// Admin full control: if pending_user_manager_approval, just move to pending_devops_approval; else create PR and assign
		if req.Status == "pending_user_manager_approval" {
			if err := UpdatePRRequestStatus(id, "pending_devops_approval"); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to move request to pending_devops_approval", err)
				return
			}
			NotifyRequestApproved(req, "Request #"+strconv.Itoa(id)+" was approved by your manager and is now pending DevOps approval.")
			FireOutboundWebhooks("approved", RequestPayloadForWebhook(req))
			AppendAuditLog(adminIDPtr, "request_approve", "pr_request", strconv.Itoa(id), "admin_step_to_devops_approval")
			w.Header().Set("Content-Type", "application/json")
			encodeAdminJSON(w, map[string]interface{}{"status": "ok", "message": "Request moved to pending DevOps approval"})
			return
		}
		// pending_approval or pending_devops_approval: create PR and assign
		prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config), req.ApplicationID)
		if err != nil {
			log.Printf("Admin approve: create PR failed: %v", err)
			writeAPIError(w, r, http.StatusInternalServerError, "failed to create PR", err)
			return
		}
		if err := UpdatePRRequestWithPR(id, prURL); err != nil {
			log.Printf("Admin approve: update request failed: %v", err)
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update request with PR link", err)
			return
		}
		_ = AssignRequestByPriority(id)
		updated, _ := GetPRRequestByID(id)
		if updated != nil {
			NotifyPRCreated(updated, prURL)
			p := RequestPayloadForWebhook(updated)
			p["pr_url"] = prURL
			FireOutboundWebhooks("pr_created", p)
			if updated.AssignedTo != nil && *updated.AssignedTo > 0 {
				NotifyTicketAssigned(updated, *updated.AssignedTo)
				FireOutboundWebhooks("assigned", RequestPayloadForWebhook(updated))
			}
		}
		AppendAuditLog(adminIDPtr, "request_approve", "pr_request", strconv.Itoa(id), prURL)
		LogCredentialAuditFromConfig(id, req.Team, req.Env, req.Cloud, req.Config, req.CreatedBy, adminIDPtr)
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "pr_url": prURL, "message": "PR created and request set to in_progress"})
		return

	case "reject":
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		if req.Status != "pending_approval" && req.Status != "pending_devops_approval" && req.Status != "pending_user_manager_approval" {
			writeAPIError(w, r, http.StatusBadRequest, "only pending requests can be rejected", nil)
			return
		}
		reason := ""
		var bodyReject struct {
			Reason string `json:"reason"`
		}
		if json.NewDecoder(r.Body).Decode(&bodyReject) == nil && bodyReject.Reason != "" {
			reason = strings.TrimSpace(bodyReject.Reason)
		}
		if err := UpdatePRRequestReject(id, reason); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to reject request", err)
			return
		}
		NotifyRequestRejected(req, reason)
		p := RequestPayloadForWebhook(req)
		p["reject_reason"] = reason
		FireOutboundWebhooks("rejected", p)
		AppendAuditLog(adminIDPtr, "request_reject", "pr_request", strconv.Itoa(id), reason)
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "message": "Request rejected"})
		return

	case "status":
		if r.Method != "PATCH" && r.Method != "PUT" {
			writeMethodNotAllowed(w, r)
			return
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		switch body.Status {
		case "in_progress", "completed", "rejected":
			// allow admin to set completed (e.g. when PR merged) or revert
			break
		default:
			writeAPIError(w, r, http.StatusBadRequest, "status must be in_progress, completed, or rejected", nil)
			return
		}
		if err := UpdatePRRequestStatus(id, body.Status); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update request status", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "request_status": body.Status})
		return

	case "plan-output":
		if r.Method != "PATCH" && r.Method != "PUT" && r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		var body struct {
			Output string `json:"output"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if err := UpdatePRRequestTerraformPlanOutput(id, body.Output); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update terraform output", err)
			return
		}
		AppendAuditLog(adminIDPtr, "request_plan_output", "pr_request", strconv.Itoa(id), "terraform plan/output updated")
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "message": "Terraform output updated"})
		return

	case "reassign":
		if r.Method != "POST" && r.Method != "PATCH" && r.Method != "PUT" {
			writeMethodNotAllowed(w, r)
			return
		}
		var body struct {
			AssignedTo *int `json:"assigned_to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		// Allow clearing assignment with assigned_to: null or 0
		if body.AssignedTo != nil && *body.AssignedTo <= 0 {
			body.AssignedTo = nil
		}
		if body.AssignedTo != nil {
			u, _ := GetUserByID(*body.AssignedTo)
			if u == nil || u.UserType != "devops_user" {
				writeAPIError(w, r, http.StatusBadRequest, "assigned_to must be a devops user id", nil)
				return
			}
		}
		if body.AssignedTo != nil {
			if err := UpdatePRRequestAssignedTo(id, *body.AssignedTo); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to assign request", err)
				return
			}
		} else {
			if _, err := DB.Exec("UPDATE pr_requests SET assigned_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", id); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to clear request assignment", err)
				return
			}
		}
		if body.AssignedTo != nil && *body.AssignedTo > 0 {
			updated, _ := GetPRRequestByID(id)
			if updated != nil {
				NotifyTicketAssigned(updated, *body.AssignedTo)
				FireOutboundWebhooks("assigned", RequestPayloadForWebhook(updated))
			}
		}
		AppendAuditLog(adminIDPtr, "request_reassign", "pr_request", strconv.Itoa(id), "")
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "assigned_to": body.AssignedTo})
		return

	case "jira":
		if r.Method != "PATCH" && r.Method != "PUT" && r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		var body struct {
			JiraTicketID string `json:"jira_ticket_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		ticketID := strings.TrimSpace(body.JiraTicketID)
		if _, err := DB.Exec("UPDATE pr_requests SET jira_ticket_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", ticketID, id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update jira ticket", err)
			return
		}
		AppendAuditLog(adminIDPtr, "request_jira", "pr_request", strconv.Itoa(id), ticketID)
		w.Header().Set("Content-Type", "application/json")
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "jira_ticket_id": ticketID})
		return

	default:
		http.NotFound(w, r)
		return
	}
}
