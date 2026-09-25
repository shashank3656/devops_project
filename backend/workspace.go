package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type workspaceQueueItem struct {
	ID     string `json:"id"`
	Kind   string `json:"kind,omitempty"`
	Title  string `json:"title"`
	Meta   string `json:"meta"`
	Ref    string `json:"ref,omitempty"`
	Href   string `json:"href"`
	Action string `json:"action,omitempty"`
	Tone   string `json:"tone,omitempty"`
	At     string `json:"at,omitempty"`
}

type workspacePipelineStage struct {
	Env       string `json:"env"`
	Status    string `json:"status"`
	Summary   string `json:"summary"`
	Href      string `json:"href,omitempty"`
	Active    bool   `json:"active,omitempty"`
	Blocked   bool   `json:"blocked,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type workspaceActivity struct {
	ID      string `json:"id"`
	Actor   string `json:"actor,omitempty"`
	Summary string `json:"summary"`
	Detail  string `json:"detail,omitempty"`
	Href    string `json:"href,omitempty"`
	Tone    string `json:"tone,omitempty"`
	At      string `json:"at,omitempty"`

	sortAt time.Time
}

type workspacePayload struct {
	Title    string               `json:"title"`
	Subtitle string               `json:"subtitle"`
	Viewer   string               `json:"viewer,omitempty"`
	NeedsYou []workspaceQueueItem `json:"needs_you"`
	Pipeline struct {
		ProjectName string                   `json:"project_name,omitempty"`
		Stages      []workspacePipelineStage `json:"stages"`
	} `json:"pipeline"`
	Activity []workspaceActivity `json:"activity"`
}

func meWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	writeWorkspace(w, r, "user", userID)
}

func adminWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	writeWorkspace(w, r, "admin", userID)
}

func devopsWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	writeWorkspace(w, r, "devops", userID)
}

func writeWorkspace(w http.ResponseWriter, r *http.Request, portal string, viewerID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	payload := buildWorkspacePayload(portal, r.URL.Query().Get("project_id"), viewerID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "workspace": payload})
}

func buildWorkspacePayload(portal, projectID string, viewerID int) workspacePayload {
	payload := workspacePayload{
		Title:    "What needs attention",
		Subtitle: "Your requests, reviews, and the environment path for your latest project.",
	}
	if viewerID > 0 && DB != nil {
		if user, err := GetUserByID(viewerID); err == nil && user != nil {
			payload.Viewer = user.Username
		}
	}
	payload.NeedsYou = workspaceNeedsYou(portal, viewerID)
	payload.Pipeline.ProjectName, payload.Pipeline.Stages = workspacePipeline(portal, projectID, viewerID)
	payload.Activity = workspaceRecentActivity(portal, viewerID)
	switch portal {
	case "admin":
		payload.Title = "Governance queue"
		payload.Subtitle = "Pending requests, access reviews, and the current release path."
	case "devops":
		payload.Title = "Operations queue"
		payload.Subtitle = "Promotions, incidents, and production-impacting PRs in one place."
	}
	return payload
}

func workspaceNeedsYou(portal string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 12)
	if DB == nil {
		return items
	}

	if portal == "user" {
		items = append(items, workspaceUserQueue(viewerID)...)
	} else {
		items = append(items, workspaceApprovalQueue(portal)...)
	}
	items = append(items, workspaceIncidentQueue(portal, viewerID)...)
	items = append(items, workspaceChangeQueue(portal, viewerID)...)
	if portal != "user" {
		items = append(items, workspaceRiskyPRQueue(portal)...)
	}

	if reason := activeFreezeReason(); reason != "" {
		items = append([]workspaceQueueItem{{
			ID:     "freeze-active",
			Kind:   "freeze",
			Title:  "Production freeze is active",
			Meta:   reason,
			Href:   portalFreezeHref(portal),
			Action: "View",
			Tone:   "danger",
		}}, items...)
	}

	if len(items) > 12 {
		return items[:12]
	}
	return items
}

func workspaceApprovalQueue(portal string) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 6)
	rows, err := DB.Query(`
		SELECT id, team, env, cloud, service, status, COALESCE(priority, 'medium'), updated_at
		FROM pr_requests
		WHERE status IN ('pending_approval', 'pending_user_manager_approval', 'pending_devops_approval')
		ORDER BY updated_at DESC
		LIMIT 6
	`)
	if err != nil {
		return items
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id int
		var team, env, cloud, service, status, priority string
		var updated sql.NullTime
		if err := rows.Scan(&id, &team, &env, &cloud, &service, &status, &priority, &updated); err != nil {
			continue
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("approval-%d", id),
			Kind:   "approval",
			Title:  fmt.Sprintf("%s · %s (%s)", service, strings.ToUpper(cloud), env),
			Meta:   strings.Join([]string{team, workspaceStatusPhrase(status)}, " · "),
			Ref:    workspaceRequestRef(id),
			Href:   workspaceRequestHref(portal, id, true),
			Action: "Review",
			Tone:   toneFromPriority(priority),
			At:     workspaceTime(updated),
		})
	}
	return items
}

func workspaceUserQueue(viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 10)
	if viewerID <= 0 {
		return items
	}

	if rows, err := DB.Query(`
		SELECT DISTINCT r.id, r.team, r.env, r.service, COALESCE(u.username, ''), r.updated_at
		FROM pr_requests r
		LEFT JOIN users u ON u.id = r.created_by
		WHERE r.status = 'pending_user_manager_approval'
		AND r.created_by IS NOT NULL
		AND r.created_by <> $1
		AND (
			EXISTS (SELECT 1 FROM users mu WHERE mu.id = r.created_by AND mu.manager_id = $1)
			OR EXISTS (
				SELECT 1 FROM team_members m1
				INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal' AND (t.name = r.team OR t.slug = r.team)
				INNER JOIN team_members m2 ON m2.team_id = t.id AND m2.role = 'manager' AND m2.user_id = $1
				WHERE m1.user_id = r.created_by
			)
		)
		ORDER BY r.updated_at DESC
		LIMIT 6
	`, viewerID); err == nil {
		for rows.Next() {
			var id int
			var team, env, service, requester string
			var updated sql.NullTime
			if err := rows.Scan(&id, &team, &env, &service, &requester, &updated); err != nil {
				continue
			}
			meta := team + " · needs your approval"
			if requester != "" {
				meta = requester + " · " + meta
			}
			items = append(items, workspaceQueueItem{
				ID:     fmt.Sprintf("manager-%d", id),
				Kind:   "approval",
				Title:  fmt.Sprintf("%s (%s)", service, env),
				Meta:   meta,
				Ref:    workspaceRequestRef(id),
				Href:   workspaceRequestHref("user", id, false),
				Action: "Review",
				Tone:   "medium",
				At:     workspaceTime(updated),
			})
		}
		_ = rows.Close()
	}

	if rows, err := DB.Query(`
		SELECT id, env, service, status, COALESCE(reject_reason, ''), updated_at
		FROM pr_requests
		WHERE created_by = $1
		AND (
			status IN ('draft', 'pending_approval', 'pending_user_manager_approval', 'pending_devops_approval', 'in_progress')
			OR (status = 'rejected' AND updated_at >= NOW() - INTERVAL '14 days')
		)
		ORDER BY CASE WHEN status = 'rejected' THEN 0 WHEN status = 'draft' THEN 1 ELSE 2 END, updated_at DESC
		LIMIT 6
	`, viewerID); err == nil {
		for rows.Next() {
			var id int
			var env, service, status, rejectReason string
			var updated sql.NullTime
			if err := rows.Scan(&id, &env, &service, &status, &rejectReason, &updated); err != nil {
				continue
			}
			item := workspaceQueueItem{
				ID:     fmt.Sprintf("mine-%d", id),
				Kind:   "waiting",
				Title:  fmt.Sprintf("%s (%s)", service, env),
				Meta:   workspaceStatusPhrase(status),
				Ref:    workspaceRequestRef(id),
				Href:   workspaceRequestHref("user", id, false),
				Action: "View",
				Tone:   "info",
				At:     workspaceTime(updated),
			}
			switch status {
			case "rejected":
				item.Kind = "rejected"
				item.Action = "Fix"
				item.Tone = "danger"
				if reason := strings.TrimSpace(rejectReason); reason != "" {
					item.Meta = "Rejected · " + truncateWorkspaceText(reason, 80)
				}
			case "draft":
				item.Kind = "draft"
				item.Action = "Continue"
				item.Tone = "medium"
			}
			items = append(items, item)
		}
		_ = rows.Close()
	}
	return items
}

func workspaceIncidentQueue(portal string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 4)
	listed, err := listRequestIncidentsFiltered("", nil, false)
	if err != nil {
		return items
	}
	allowed := map[int]struct{}{}
	if portal == "user" {
		if viewerID <= 0 {
			return items
		}
		allowed = projectIDSet(visibleProjectIDsForUser(viewerID))
	}
	for _, item := range listed {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status == "closed" || status == "resolved" || status == "draft" {
			continue
		}
		if portal == "user" && !incidentVisibleToUser(item, viewerID, allowed) {
			continue
		}
		title := strings.TrimSpace(item.Summary)
		if title == "" {
			title = "Open incident"
		}
		href := "/incidents"
		if item.ID > 0 {
			href = fmt.Sprintf("/incidents/%d", item.ID)
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("incident-%d", item.ID),
			Kind:   "incident",
			Title:  truncateWorkspaceText(title, 90),
			Meta:   item.Severity + " severity · " + strings.ReplaceAll(item.Status, "_", " "),
			Ref:    firstNonEmpty(item.IncidentNumber, formatIncidentNumber(item.ID)),
			Href:   href,
			Action: "Open",
			Tone:   "high",
			At:     item.UpdatedAt.UTC().Format(time.RFC3339),
		})
		if len(items) >= 4 {
			break
		}
	}
	return items
}

func workspaceChangeQueue(portal string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 3)
	listed, err := listChangeRequests(0, "", "", "")
	if err != nil {
		return items
	}
	allowed := map[int]struct{}{}
	if portal == "user" {
		if viewerID <= 0 {
			return items
		}
		allowed = projectIDSet(visibleProjectIDsForUser(viewerID))
	}
	for _, item := range listed {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status != "failed" && status != "monitoring" && status != "new" && status != "implementing" {
			continue
		}
		if portal == "user" && !changeVisibleToUser(item, allowed) {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = item.Repo
		}
		if title == "" {
			title = "Change request"
		}
		href := "/changes"
		if item.ID > 0 {
			href = fmt.Sprintf("/changes/%d", item.ID)
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("change-%d", item.ID),
			Kind:   "change",
			Title:  truncateWorkspaceText(title, 90),
			Meta:   strings.Join([]string{item.Environment, item.Status, item.ChangeType}, " · "),
			Ref:    firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)),
			Href:   href,
			Action: "Open",
			Tone:   workspaceChangeTone(status),
			At:     item.UpdatedAt.UTC().Format(time.RFC3339),
		})
		if len(items) >= 3 {
			break
		}
	}
	return items
}

func workspaceChangeTone(status string) string {
	if status == "failed" {
		return "danger"
	}
	if status == "monitoring" {
		return "medium"
	}
	return "info"
}

func workspaceRiskyPRQueue(portal string) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 4)
	rows, err := DB.Query(`
		SELECT request_id, COALESCE(pr_number, 0), score, risk_level, COALESCE(deploy_status, ''), updated_at
		FROM pr_request_impact
		WHERE LOWER(risk_level) IN ('high', 'medium')
		ORDER BY score DESC, updated_at DESC
		LIMIT 4
	`)
	if err != nil {
		return items
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var requestID, prNumber, score int
		var risk, deploy string
		var updated sql.NullTime
		if err := rows.Scan(&requestID, &prNumber, &score, &risk, &deploy, &updated); err != nil {
			continue
		}
		meta := fmt.Sprintf("%s risk · %d/100", risk, score)
		if deploy != "" {
			meta += " · " + strings.ReplaceAll(deploy, "_", " ")
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("pr-%d", requestID),
			Kind:   "pr_risk",
			Title:  fmt.Sprintf("PR #%d production impact", prNumber),
			Meta:   meta,
			Ref:    workspaceRequestRef(requestID),
			Href:   workspaceRequestHref(portal, requestID, false),
			Action: "Inspect",
			Tone:   strings.ToLower(risk),
			At:     workspaceTime(updated),
		})
	}
	return items
}

func workspacePipeline(portal, projectID string, viewerID int) (string, []workspacePipelineStage) {
	stages := make([]workspacePipelineStage, 0, 4)
	if DB == nil {
		return "", stages
	}
	var projectName string
	var id int
	if n, err := strconv.Atoi(strings.TrimSpace(projectID)); err == nil && n > 0 {
		id = n
		_ = DB.QueryRow("SELECT name FROM projects WHERE id = $1", n).Scan(&projectName)
	} else {
		if portal == "user" && viewerID > 0 {
			_ = DB.QueryRow(`
				SELECT p.id, p.name FROM pr_requests r
				INNER JOIN projects p ON p.id = r.project_id
				WHERE r.created_by = $1
				ORDER BY r.updated_at DESC LIMIT 1
			`, viewerID).Scan(&id, &projectName)
		}
		if id == 0 {
			_ = DB.QueryRow("SELECT id, name FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").Scan(&id, &projectName)
		}
	}
	if id == 0 {
		return projectName, defaultPipelineStages(portal)
	}
	rows, err := DB.Query(`
		SELECT environment FROM project_environments WHERE project_id = $1
	`, id)
	if err != nil {
		return projectName, defaultPipelineStages(portal)
	}
	envs := make([]string, 0, 4)
	for rows.Next() {
		var env string
		if err := rows.Scan(&env); err == nil && env != "" {
			envs = append(envs, env)
		}
	}
	_ = rows.Close()
	if len(envs) == 0 {
		envs = []string{"dev", "uat", "prod"}
	}
	envs = sortEnvironments(envs)
	freezeActive := activeFreezeReason() != ""
	for _, env := range envs {
		var latestStatus, service string
		var requestID int
		var updated sql.NullTime
		_ = DB.QueryRow(`
			SELECT id, status, service, updated_at FROM pr_requests
			WHERE project_id = $1 AND LOWER(env) = LOWER($2)
			ORDER BY updated_at DESC LIMIT 1
		`, id, env).Scan(&requestID, &latestStatus, &service, &updated)
		if latestStatus == "" {
			latestStatus = "idle"
		}
		href := ""
		if requestID > 0 {
			href = workspaceRequestHref(portal, requestID, false)
		}
		summary := "No recent change"
		if service != "" {
			summary = service + " · " + strings.ReplaceAll(latestStatus, "_", " ")
		}
		blocked := strings.Contains(strings.ToLower(latestStatus), "reject") || (envEqualsProd(env) && freezeActive)
		stages = append(stages, workspacePipelineStage{
			Env:       env,
			Status:    strings.ReplaceAll(latestStatus, "_", " "),
			Summary:   summary,
			Href:      href,
			Active:    latestStatus == "in_progress" || latestStatus == "pending_devops_approval",
			Blocked:   blocked,
			UpdatedAt: workspaceTime(updated),
		})
	}
	return projectName, stages
}

func workspaceRecentActivity(portal string, viewerID int) []workspaceActivity {
	events := make([]workspaceActivity, 0, 12)
	if DB == nil {
		return events
	}
	if portal == "user" && viewerID <= 0 {
		return events
	}

	requestQuery := `
		SELECT r.id, r.service, r.env, COALESCE(r.status, ''), COALESCE(u.username, ''), r.updated_at
		FROM pr_requests r
		LEFT JOIN users u ON u.id = r.created_by
		ORDER BY r.updated_at DESC
		LIMIT 8
	`
	incidentQuery := `
		SELECT i.id, COALESCE(i.summary, ''), COALESCE(i.status, 'open'), i.updated_at
		FROM request_incidents i
		ORDER BY i.updated_at DESC
		LIMIT 4
	`
	args := []interface{}{}
	if portal == "user" {
		requestQuery = `
			SELECT r.id, r.service, r.env, COALESCE(r.status, ''), COALESCE(u.username, ''), r.updated_at
			FROM pr_requests r
			LEFT JOIN users u ON u.id = r.created_by
			WHERE r.created_by = $1
			ORDER BY r.updated_at DESC
			LIMIT 8
		`
		incidentQuery = `
			SELECT i.id, COALESCE(i.summary, ''), COALESCE(i.status, 'open'), i.updated_at
			FROM request_incidents i
			INNER JOIN pr_requests r ON r.id = i.request_id
			WHERE r.created_by = $1
			ORDER BY i.updated_at DESC
			LIMIT 4
		`
		args = append(args, viewerID)
	}

	if rows, err := DB.Query(requestQuery, args...); err == nil {
		for rows.Next() {
			var id int
			var service, env, status, actor string
			var updated sql.NullTime
			if err := rows.Scan(&id, &service, &env, &status, &actor, &updated); err != nil {
				continue
			}
			events = append(events, workspaceActivity{
				ID:      fmt.Sprintf("request-%d", id),
				Actor:   actor,
				Summary: workspaceRequestRef(id) + " " + workspaceStatusPhrase(status),
				Detail:  strings.Join(nonEmptyStrings(service, env, workspaceByline(actor)), " · "),
				Href:    workspaceRequestHref(portal, id, false),
				Tone:    workspaceStatusTone(status),
				At:      workspaceTime(updated),
				sortAt:  updated.Time,
			})
		}
		_ = rows.Close()
	}

	if rows, err := DB.Query(incidentQuery, args...); err == nil {
		for rows.Next() {
			var id int
			var summary, status string
			var updated sql.NullTime
			if err := rows.Scan(&id, &summary, &status, &updated); err != nil {
				continue
			}
			tone := "high"
			if s := strings.ToLower(status); s == "resolved" || s == "closed" {
				tone = "ok"
			}
			events = append(events, workspaceActivity{
				ID:      fmt.Sprintf("incident-%d", id),
				Summary: "Incident " + formatIncidentNumber(id) + " " + strings.ReplaceAll(strings.ToLower(status), "_", " "),
				Detail:  truncateWorkspaceText(summary, 80),
				Href:    "/incidents",
				Tone:    tone,
				At:      workspaceTime(updated),
				sortAt:  updated.Time,
			})
		}
		_ = rows.Close()
	}

	return sortWorkspaceActivity(events, 8)
}

func sortWorkspaceActivity(events []workspaceActivity, limit int) []workspaceActivity {
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].sortAt.After(events[j].sortAt)
	})
	if limit > 0 && len(events) > limit {
		return events[:limit]
	}
	return events
}

func defaultPipelineStages(portal string) []workspacePipelineStage {
	_ = portal
	return []workspacePipelineStage{
		{Env: "dev", Status: "idle", Summary: "No recent change"},
		{Env: "uat", Status: "idle", Summary: "Waiting on a promotion"},
		{Env: "prod", Status: "idle", Summary: "Production is quiet"},
	}
}

func workspaceRequestRef(id int) string {
	return fmt.Sprintf("REQ-%d", id)
}

func workspaceRequestHref(portal string, id int, approval bool) string {
	switch portal {
	case "admin":
		if approval {
			return "/approval-center"
		}
		return "/requests?id=" + strconv.Itoa(id)
	case "devops":
		if approval {
			return "/approval-center"
		}
		return "/tickets?id=" + strconv.Itoa(id)
	default:
		return "/history?id=" + strconv.Itoa(id)
	}
}

func workspaceStatusPhrase(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "draft":
		return "saved as draft"
	case "pending_user_manager_approval":
		return "waiting on manager"
	case "pending_devops_approval", "pending_approval":
		return "waiting on DevOps"
	case "in_progress":
		return "being provisioned"
	case "completed":
		return "completed"
	case "rejected":
		return "rejected"
	case "cancelled", "canceled":
		return "cancelled"
	case "":
		return "updated"
	default:
		return strings.ReplaceAll(strings.ToLower(status), "_", " ")
	}
}

func workspaceStatusTone(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed":
		return "ok"
	case "rejected", "failed":
		return "danger"
	case "pending_user_manager_approval", "pending_devops_approval", "pending_approval":
		return "medium"
	default:
		return "info"
	}
}

func workspaceByline(actor string) string {
	if strings.TrimSpace(actor) == "" {
		return ""
	}
	return "by " + actor
}

func workspaceTime(t sql.NullTime) string {
	if !t.Valid || t.Time.IsZero() {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func truncateWorkspaceText(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if max <= 0 || len(runes) <= max {
		return value
	}
	return strings.TrimSpace(string(runes[:max-1])) + "…"
}

func toneFromPriority(priority string) string {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "critical", "high":
		return "high"
	case "low":
		return "low"
	default:
		return "medium"
	}
}

func envEqualsProd(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "prod", "production":
		return true
	default:
		return false
	}
}

func portalFreezeHref(portal string) string {
	if portal == "admin" {
		return "/requests"
	}
	if portal == "user" {
		return "/history"
	}
	return "/promotions"
}

func activeFreezeReason() string {
	if reason := storedActiveFreezeReason(); reason != "" {
		return reason
	}
	return sloBudgetFreezeReason("")
}

func nextEnvironment(env string) string {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "dev", "development":
		return "uat"
	case "uat", "stage", "staging":
		return "prod"
	default:
		return ""
	}
}
