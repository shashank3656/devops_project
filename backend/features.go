package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// AppendUserActivity logs a user action (create, submit, comment, etc.)
func AppendUserActivity(userID *int, action, resourceType, resourceID, details string) {
	if DB == nil {
		return
	}
	_, err := DB.Exec(
		"INSERT INTO user_activity (user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)",
		userID, action, resourceType, resourceID, details,
	)
	if err != nil {
		log.Printf("[user_activity] INSERT failed: action=%q resource=%s/%s err=%v", action, resourceType, resourceID, err)
	}
}

// GetRequestTags returns tags for a request
func GetRequestTags(requestID int) ([]string, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query("SELECT tag FROM request_tags WHERE request_id = $1 ORDER BY tag", requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, nil
}

// SetRequestTags replaces tags for a request
func SetRequestTags(requestID int, tags []string) error {
	if DB == nil {
		return nil
	}
	_, _ = DB.Exec("DELETE FROM request_tags WHERE request_id = $1", requestID)
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len(tag) > 100 {
			tag = tag[:100]
		}
		_, _ = DB.Exec("INSERT INTO request_tags (request_id, tag) VALUES ($1, $2) ON CONFLICT (request_id, tag) DO NOTHING", requestID, tag)
	}
	return nil
}

// AddRequestTag adds a single tag
func AddRequestTag(requestID int, tag string) error {
	tag = strings.TrimSpace(tag)
	if tag == "" || len(tag) > 100 {
		return nil
	}
	_, err := DB.Exec("INSERT INTO request_tags (request_id, tag) VALUES ($1, $2) ON CONFLICT (request_id, tag) DO NOTHING", requestID, tag)
	return err
}

// RemoveRequestTag removes a tag
func RemoveRequestTag(requestID int, tag string) error {
	_, err := DB.Exec("DELETE FROM request_tags WHERE request_id = $1 AND tag = $2", requestID, tag)
	return err
}

// handleRequestTags GET/POST/DELETE /api/request/:id/tags
func handleRequestTags(w http.ResponseWriter, r *http.Request, requestID int, req *PRRequest, userID int) {
	canAccess := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canAccess {
		if _, ok := requireAdmin(w, r); !ok {
			return
		}
	}
	switch r.Method {
	case "GET":
		tags, err := GetRequestTags(requestID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"tags": tags, "status": "ok"})
	case "POST":
		var body struct {
			Tags []string `json:"tags"`
			Tag  string   `json:"tag"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(body.Tags) > 0 {
			_ = SetRequestTags(requestID, body.Tags)
		} else if body.Tag != "" {
			_ = AddRequestTag(requestID, body.Tag)
		}
		tags, _ := GetRequestTags(requestID)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"tags": tags, "status": "ok"})
	case "DELETE":
		tag := r.URL.Query().Get("tag")
		if tag != "" {
			_ = RemoveRequestTag(requestID, tag)
		}
		tags, _ := GetRequestTags(requestID)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"tags": tags, "status": "ok"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// requestDiffHandler GET /api/request/:id/diff?compare_with=:id - compare two requests
func requestDiffHandler(w http.ResponseWriter, r *http.Request, baseID int, userID int) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	compareIDStr := r.URL.Query().Get("compare_with")
	if compareIDStr == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeJSON(w, map[string]interface{}{"error": "compare_with query param required", "status": "error"})
		return
	}
	compareID, err := strconv.Atoi(compareIDStr)
	if err != nil || compareID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeJSON(w, map[string]interface{}{"error": "invalid compare_with id", "status": "error"})
		return
	}
	base, _ := GetPRRequestByID(baseID)
	compare, _ := GetPRRequestByID(compareID)
	if base == nil || compare == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeJSON(w, map[string]interface{}{"error": "request not found", "status": "error"})
		return
	}
	// Build field-level diff
	diff := map[string]interface{}{
		"base":    map[string]interface{}{"id": base.ID, "team": base.Team, "env": base.Env, "cloud": base.Cloud, "service": base.Service, "branch": base.Branch, "config": base.Config},
		"compare": map[string]interface{}{"id": compare.ID, "team": compare.Team, "env": compare.Env, "cloud": compare.Cloud, "service": compare.Service, "branch": compare.Branch, "config": compare.Config},
		"changes": []map[string]interface{}{},
	}
	fields := []struct {
		name string
		a, b string
	}{
		{"team", base.Team, compare.Team},
		{"env", base.Env, compare.Env},
		{"cloud", base.Cloud, compare.Cloud},
		{"service", base.Service, compare.Service},
		{"branch", base.Branch, compare.Branch},
		{"config", base.Config, compare.Config},
	}
	for _, f := range fields {
		if f.a != f.b {
			diff["changes"] = append(diff["changes"].([]map[string]interface{}), map[string]interface{}{
				"field": f.name, "base_value": f.a, "compare_value": f.b,
			})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "diff": diff})
	_ = userID
}

// GetSLAMetrics returns avg time (hours) from created to completed for completed requests
func GetSLAMetrics(team, from, to string) (avgHours float64, count int, err error) {
	if DB == nil {
		return 0, 0, nil
	}
	query := `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600)::numeric, COUNT(*)
		FROM pr_requests WHERE status = 'completed'`
	args := []interface{}{}
	pos := 1
	if team != "" {
		query += " AND team ILIKE $1"
		args = append(args, "%"+team+"%")
		pos++
	}
	if from != "" {
		query += " AND created_at >= $" + strconv.Itoa(pos)
		args = append(args, from)
		pos++
	}
	if to != "" {
		query += " AND updated_at <= $" + strconv.Itoa(pos)
		args = append(args, to)
	}
	var avg *float64
	if len(args) > 0 {
		err = queryRowContext(query, args...).Scan(&avg, &count)
	} else {
		err = queryRowContext(query).Scan(&avg, &count)
	}
	if err != nil {
		return 0, 0, err
	}
	if avg != nil {
		avgHours = *avg
	}
	return avgHours, count, nil
}

// GetTeamComparison returns request counts and completion rates by team
func GetTeamComparison(from, to string) ([]map[string]interface{}, error) {
	if DB == nil {
		return nil, nil
	}
	query := `SELECT team,
		COUNT(*) AS total,
		COUNT(*) FILTER (WHERE status = 'completed') AS completed,
		COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
		COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending
		FROM pr_requests WHERE 1=1`
	args := []interface{}{}
	pos := 1
	if from != "" {
		query += " AND created_at >= $" + strconv.Itoa(pos)
		args = append(args, from)
		pos++
	}
	if to != "" {
		query += " AND created_at <= $" + strconv.Itoa(pos)
		args = append(args, to)
	}
	query += " GROUP BY team ORDER BY total DESC"
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var team string
		var total, completed, rejected, pending int
		if err := rows.Scan(&team, &total, &completed, &rejected, &pending); err != nil {
			return nil, err
		}
		rate := 0.0
		if total > 0 {
			rate = float64(completed) / float64(total) * 100
		}
		out = append(out, map[string]interface{}{
			"team":      team,
			"total":     total,
			"completed": completed,
			"rejected":  rejected,
			"pending":   pending,
			"rate":      rate,
		})
	}
	return out, nil
}

// GetUserActivity returns user activity entries (admin only)
func GetUserActivity(limit, offset int, userIDFilter int, projectIDFilter int) ([]map[string]interface{}, error) {
	if DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT ua.id, ua.user_id, u.username, ua.action, ua.resource_type, COALESCE(ua.resource_id,''), COALESCE(ua.details,''), ua.created_at,
		       request_project.id, COALESCE(request_project.name,''), COALESCE(request_project.code,'')
		FROM user_activity ua
		LEFT JOIN users u ON u.id = ua.user_id
		LEFT JOIN pr_requests request_ref
		  ON ua.resource_type = 'pr_request'
		 AND ua.resource_id ~ '^[0-9]+$'
		 AND request_ref.id = ua.resource_id::int
		LEFT JOIN projects request_project ON request_project.id = request_ref.project_id
		WHERE 1=1`
	args := []interface{}{}
	argPos := 1
	if userIDFilter > 0 {
		query += fmt.Sprintf(" AND ua.user_id = $%d", argPos)
		args = append(args, userIDFilter)
		argPos++
	}
	if projectIDFilter > 0 {
		query += fmt.Sprintf(" AND request_project.id = $%d", argPos)
		args = append(args, projectIDFilter)
		argPos++
	}
	query += " ORDER BY ua.created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argPos, argPos+1)
	args = append(args, limit, offset)
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var id int
		var uid *int
		var projectID sql.NullInt64
		var username, action, resourceType, resourceID, details string
		var projectName, projectCode string
		var createdAt time.Time
		if err := rows.Scan(&id, &uid, &username, &action, &resourceType, &resourceID, &details, &createdAt, &projectID, &projectName, &projectCode); err != nil {
			return nil, err
		}
		entry := map[string]interface{}{
			"id": id, "user_id": uid, "username": username, "action": action,
			"resource_type": resourceType, "resource_id": resourceID, "details": details,
			"created_at":   createdAt.Format(time.RFC3339),
			"project_name": projectName, "project_code": projectCode,
		}
		if projectID.Valid {
			entry["project_id"] = int(projectID.Int64)
		}
		out = append(out, entry)
	}
	return out, nil
}

// adminUserActivityHandler GET /api/admin/user-activity
func adminUserActivityHandler(w http.ResponseWriter, r *http.Request) {
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
		encodeJSON(w, map[string]interface{}{"entries": []interface{}{}, "status": "ok"})
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
	userID := 0
	if u := r.URL.Query().Get("user_id"); u != "" {
		if n, err := strconv.Atoi(u); err == nil {
			userID = n
		}
	}
	projectID := 0
	if p := strings.TrimSpace(r.URL.Query().Get("project_id")); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			projectID = n
		}
	}
	entries, err := GetUserActivity(limit, offset, userID, projectID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"entries": entries, "status": "ok"})
}

// GetRequestsTrend returns daily request counts for charting
func GetRequestsTrend(days int, team string) ([]map[string]interface{}, error) {
	if DB == nil || days <= 0 {
		return nil, nil
	}
	if days > 90 {
		days = 90
	}
	query := `SELECT DATE(created_at) AS day, COUNT(*) AS count
		FROM pr_requests
		WHERE created_at >= CURRENT_DATE - $1::int`
	args := []interface{}{days}
	if team != "" {
		query += " AND team ILIKE $2"
		args = append(args, "%"+team+"%")
	}
	query += " GROUP BY DATE(created_at) ORDER BY day"
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var day time.Time
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{"date": day.Format("2006-01-02"), "count": count})
	}
	return out, nil
}
