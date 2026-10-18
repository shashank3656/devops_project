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
	Failed   []workspaceQueueItem `json:"failed"`
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
	payload.NeedsYou = workspaceNeedsYou(portal, projectID, viewerID)
	payload.Failed = workspaceFailedDeliveries(portal, projectID, viewerID)
	if gap := workspaceCoverageGap(projectID); gap.ID != "" {
		payload.NeedsYou = append([]workspaceQueueItem{gap}, payload.NeedsYou...)
	}
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

func workspaceProjectID(projectID string) int {
	id, err := strconv.Atoi(strings.TrimSpace(projectID))
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func workspaceMatchesProject(projectID string, id *int) bool {
	want := workspaceProjectID(projectID)
	if want <= 0 {
		return true
	}
	return id != nil && *id == want
}

func workspaceCoverageGap(projectID string) workspaceQueueItem {
	id := workspaceProjectID(projectID)
	if id <= 0 || DB == nil {
		return workspaceQueueItem{}
	}
	rows, err := DB.Query(`SELECT days FROM oncall_schedules WHERE project_id = $1`, id)
	if err != nil {
		return workspaceQueueItem{}
	}
	defer func() { _ = rows.Close() }()
	gaps := 0
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var days map[string]int
		if json.Unmarshal([]byte(raw), &days) != nil {
			continue
		}
		for _, userID := range days {
			if userID <= 0 {
				gaps++
				break
			}
		}
	}
	if gaps == 0 {
		return workspaceQueueItem{}
	}
	label := "schedules still have an uncovered day"
	if gaps == 1 {
		label = "schedule still has an uncovered day"
	}
	return workspaceQueueItem{
		ID:     fmt.Sprintf("coverage-%d", id),
		Kind:   "coverage",
		Title:  "On-call coverage gap",
		Meta:   fmt.Sprintf("%d %s", gaps, label),
		Href:   fmt.Sprintf("/on-call?project_id=%d", id),
		Action: "Assign people",
		Tone:   "medium",
	}
}

func workspaceNeedsYou(portal, projectID string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 12)
	if DB == nil {
		return items
	}

	if portal == "user" {
		items = append(items, workspaceUserQueue(viewerID)...)
	} else {
		items = append(items, workspaceApprovalQueue(portal, projectID)...)
	}
	items = append(items, workspaceIncidentQueue(portal, projectID, viewerID)...)
	items = append(items, workspaceChangeQueue(portal, projectID, viewerID, false)...)
	if portal != "user" {
		items = append(items, workspaceRiskyPRQueue(portal, false)...)
	}

	if envFreezes := workspaceEnvironmentFreezeQueue(portal, viewerID); len(envFreezes) > 0 {
		items = append(envFreezes, items...)
	} else if reason := activeFreezeReason(); reason != "" {
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

	return capWorkspaceQueue(items, 12)
}

func workspaceFailedDeliveries(portal, projectID string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 8)
	if DB == nil {
		return items
	}
	items = append(items, workspaceChangeQueue(portal, projectID, viewerID, true)...)
	items = append(items, workspaceFailedTicketQueue(portal, projectID, viewerID)...)
	seen := map[string]struct{}{}
	for _, item := range items {
		if item.Ref != "" {
			seen[item.Ref] = struct{}{}
		}
		seen[item.ID] = struct{}{}
	}
	if portal != "user" {
		for _, item := range workspaceRiskyPRQueue(portal, true) {
			if _, ok := seen[item.Ref]; ok {
				continue
			}
			if _, ok := seen[item.ID]; ok {
				continue
			}
			items = append(items, item)
		}
	}
	return capWorkspaceQueue(items, 8)
}

func workspaceApprovalQueue(portal, projectID string) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 6)
	query := `
		SELECT id, team, env, cloud, service, status, COALESCE(priority, 'medium'), updated_at, project_id
		FROM pr_requests
		WHERE status IN ('pending_approval', 'pending_user_manager_approval', 'pending_devops_approval')
	`
	args := []interface{}{}
	if id := workspaceProjectID(projectID); id > 0 {
		query += ` AND project_id = $1`
		args = append(args, id)
	}
	query += ` ORDER BY updated_at DESC LIMIT 6`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return items
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id int
		var team, env, cloud, service, status, priority string
		var updated sql.NullTime
		var rowProject sql.NullInt64
		if err := rows.Scan(&id, &team, &env, &cloud, &service, &status, &priority, &updated, &rowProject); err != nil {
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
		SELECT id, env, service, status, updated_at
		FROM pr_requests
		WHERE created_by = $1
		AND status IN ('draft', 'pending_approval', 'pending_user_manager_approval', 'pending_devops_approval', 'in_progress')
		ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, updated_at DESC
		LIMIT 6
	`, viewerID); err == nil {
		for rows.Next() {
			var id int
			var env, service, status string
			var updated sql.NullTime
			if err := rows.Scan(&id, &env, &service, &status, &updated); err != nil {
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
			if status == "draft" {
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

func workspaceIncidentQueue(portal, projectID string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 4)
	listed, err := listRequestIncidentsFiltered("", nil, false)
	if err != nil {
		return items
	}
	if viewerID <= 0 {
		return items
	}
	subject := authzSubjectForUser(viewerID)
	for _, item := range listed {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status == "closed" || status == "resolved" || status == "draft" {
			continue
		}
		if !incidentInScope(subject, item, authzRead) {
			continue
		}
		if !incidentNeedsViewerAction(item, portal, viewerID) || !workspaceMatchesProject(projectID, item.ProjectID) {
			continue
		}
		title := strings.TrimSpace(item.Summary)
		if title == "" {
			title = "Open incident"
		}
		href := workspaceIncidentHref(item.ID)
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

func workspaceChangeQueue(portal, projectID string, viewerID int, failedOnly bool) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 3)
	listed, err := listChangeRequests(workspaceProjectID(projectID), "", "", "")
	if err != nil {
		return items
	}
	if viewerID <= 0 {
		return items
	}
	subject := authzSubjectForUser(viewerID)
	for _, item := range listed {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if failedOnly {
			if !workspaceChangeIsFailed(status) {
				continue
			}
		} else if !workspaceChangeNeedsAction(status) {
			continue
		}
		if !changeInScope(subject, item, authzRead) {
			continue
		}
		if !failedOnly && !changeNeedsViewerAction(item, portal, viewerID) {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = item.Repo
		}
		if title == "" {
			title = "Change request"
		}
		href := "/changes?status=new&mine=1"
		if failedOnly {
			href = "/changes?status=failed"
		}
		kind := "change"
		action := "Open"
		if failedOnly {
			kind = "failed"
			action = "Inspect"
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("change-%d", item.ID),
			Kind:   kind,
			Title:  truncateWorkspaceText(title, 90),
			Meta:   strings.Join(nonEmptyStrings(item.Environment, item.Status, item.ChangeType), " · "),
			Ref:    firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)),
			Href:   href,
			Action: action,
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

func workspaceRiskyPRQueue(portal string, failedOnly bool) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 4)
	rows, err := DB.Query(`
		SELECT request_id, COALESCE(pr_number, 0), score, risk_level, COALESCE(deploy_status, ''), updated_at
		FROM pr_request_impact
		WHERE LOWER(risk_level) IN ('high', 'medium')
		ORDER BY score DESC, updated_at DESC
		LIMIT 8
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
		failed := workspaceDeliveryIsFailed(deploy)
		if failedOnly != failed {
			continue
		}
		meta := fmt.Sprintf("%s risk · %d/100", risk, score)
		if deploy != "" {
			meta += " · " + strings.ReplaceAll(deploy, "_", " ")
		}
		kind := "pr_risk"
		action := "Inspect"
		tone := strings.ToLower(risk)
		if failedOnly {
			kind = "failed"
			tone = "danger"
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("pr-%d", requestID),
			Kind:   kind,
			Title:  fmt.Sprintf("PR #%d production impact", prNumber),
			Meta:   meta,
			Ref:    workspaceRequestRef(requestID),
			Href:   workspaceRequestHref(portal, requestID, false),
			Action: action,
			Tone:   tone,
			At:     workspaceTime(updated),
		})
		if len(items) >= 4 {
			break
		}
	}
	return items
}

func workspaceFailedTicketQueue(portal, projectID string, viewerID int) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 4)
	query := `
		SELECT id, env, service, status, COALESCE(reject_reason, ''), updated_at, created_by
		FROM pr_requests
		WHERE (
		  LOWER(COALESCE(status, '')) IN ('failed', 'apply_failed', 'plan_failed', 'deploy_failed', 'blocked', 'rejected')
		  OR LOWER(COALESCE(status, '')) LIKE '%fail%'
		  OR LOWER(COALESCE(status, '')) LIKE '%block%'
		)
	`
	args := []interface{}{}
	if id := workspaceProjectID(projectID); id > 0 {
		query += ` AND project_id = $1`
		args = append(args, id)
	}
	query += ` ORDER BY updated_at DESC LIMIT 12`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return items
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id int
		var env, service, status, rejectReason string
		var updated sql.NullTime
		var createdBy sql.NullInt64
		if err := rows.Scan(&id, &env, &service, &status, &rejectReason, &updated, &createdBy); err != nil {
			continue
		}
		if portal == "user" && (viewerID <= 0 || !createdBy.Valid || int(createdBy.Int64) != viewerID) {
			continue
		}
		kind := "failed"
		action := "Inspect"
		meta := workspaceStatusPhrase(status)
		if strings.EqualFold(status, "rejected") {
			kind = "rejected"
			action = "Fix"
			if reason := strings.TrimSpace(rejectReason); reason != "" {
				meta = "Rejected · " + truncateWorkspaceText(reason, 80)
			}
		} else if workspaceDeliveryIsBlocked(status) {
			kind = "blocked"
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("ticket-%d", id),
			Kind:   kind,
			Title:  fmt.Sprintf("%s (%s)", service, env),
			Meta:   meta,
			Ref:    workspaceRequestRef(id),
			Href:   workspaceRequestHref(portal, id, false),
			Action: action,
			Tone:   "danger",
			At:     workspaceTime(updated),
		})
		if len(items) >= 4 {
			break
		}
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
		return projectName, stages
	}
	rows, err := DB.Query(`
		SELECT environment FROM project_environments WHERE project_id = $1
	`, id)
	if err != nil {
		return projectName, stages
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
		blocked := strings.Contains(strings.ToLower(latestStatus), "reject")
		if frozen, freezeReason, _ := activeDeploymentFreeze(&id, env); frozen {
			blocked = true
			if freezeReason != "" {
				summary = "Frozen · " + freezeReason
			} else {
				summary = "Frozen"
			}
		} else if envEqualsProd(env) && activeFreezeReason() != "" {
			blocked = true
			summary = "Frozen · " + activeFreezeReason()
		}
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
				Href:    workspaceIncidentHref(id),
				Tone:    tone,
				At:      workspaceTime(updated),
				sortAt:  updated.Time,
			})
		}
		_ = rows.Close()
	}

	if portal == "devops" && viewerID > 0 {
		if opRows, err := listOperatorAuditForDevops(viewerID, 16, 0, 0, "", "", ""); err == nil {
			for _, op := range opRows {
				events = append(events, operatorAuditToWorkspaceActivity(op, portal))
			}
		}
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

func capWorkspaceQueue(items []workspaceQueueItem, limit int) []workspaceQueueItem {
	if limit > 0 && len(items) > limit {
		return items[:limit]
	}
	return items
}

func workspaceIncidentHref(id int) string {
	if id <= 0 {
		return "/incidents"
	}
	return "/incidents?mine=1"
}

func workspaceChangeNeedsAction(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "monitoring", "new", "implementing":
		return true
	default:
		return false
	}
}

func workspaceChangeIsFailed(status string) bool {
	return strings.ToLower(strings.TrimSpace(status)) == "failed"
}

func workspaceDeliveryIsFailed(status string) bool {
	value := strings.ToLower(strings.TrimSpace(status))
	switch value {
	case "failed", "apply_failed", "plan_failed", "deploy_failed", "error":
		return true
	default:
		return strings.Contains(value, "fail")
	}
}

func workspaceDeliveryIsBlocked(status string) bool {
	value := strings.ToLower(strings.TrimSpace(status))
	return value == "blocked" || strings.Contains(value, "block")
}

func incidentNeedsViewerAction(item requestIncident, portal string, viewerID int) bool {
	if viewerID > 0 && item.OwnerUserID != nil && *item.OwnerUserID == viewerID {
		return true
	}
	if portal == "user" {
		return false
	}
	return item.OwnerUserID == nil
}

func changeNeedsViewerAction(item changeRequestRecord, portal string, viewerID int) bool {
	if portal == "user" {
		return true
	}
	if item.AssigneeUserID == nil {
		return true
	}
	return viewerID > 0 && *item.AssigneeUserID == viewerID
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
			return "/tickets?status=pending_devops_approval&id=" + strconv.Itoa(id)
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
	if portal == "devops" {
		return "/environments"
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
