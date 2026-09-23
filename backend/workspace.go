package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type workspaceQueueItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Meta  string `json:"meta"`
	Href  string `json:"href"`
	Tone  string `json:"tone,omitempty"`
}

type workspacePipelineStage struct {
	Env     string `json:"env"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
	Active  bool   `json:"active,omitempty"`
	Blocked bool   `json:"blocked,omitempty"`
}

type workspacePayload struct {
	Title    string               `json:"title"`
	Subtitle string               `json:"subtitle"`
	NeedsYou []workspaceQueueItem `json:"needs_you"`
	Pipeline struct {
		ProjectName string                   `json:"project_name,omitempty"`
		Stages      []workspacePipelineStage `json:"stages"`
	} `json:"pipeline"`
}

func meWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	writeWorkspace(w, r, "user")
}

func adminWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	writeWorkspace(w, r, "admin")
}

func devopsWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	writeWorkspace(w, r, "devops")
}

func writeWorkspace(w http.ResponseWriter, r *http.Request, portal string) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	if portal == "user" {
		if _, _, ok := requireSignedIn(w, r); !ok {
			return
		}
	}
	payload := buildWorkspacePayload(portal, r.URL.Query().Get("project_id"))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "workspace": payload})
}

func buildWorkspacePayload(portal, projectID string) workspacePayload {
	payload := workspacePayload{
		Title:    "What needs attention",
		Subtitle: "Approvals, risky merges, and the environment path for the selected project.",
	}
	payload.NeedsYou = workspaceNeedsYou(portal)
	payload.Pipeline.ProjectName, payload.Pipeline.Stages = workspacePipeline(portal, projectID)
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

func workspaceNeedsYou(portal string) []workspaceQueueItem {
	items := make([]workspaceQueueItem, 0, 12)
	if DB == nil {
		return items
	}

	if rows, err := DB.Query(`
		SELECT id, team, env, cloud, service, status, COALESCE(priority, 'medium')
		FROM pr_requests
		WHERE status IN ('pending_approval', 'pending_user_manager_approval', 'pending_devops_approval')
		ORDER BY updated_at DESC
		LIMIT 6
	`); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id int
			var team, env, cloud, service, status, priority string
			if err := rows.Scan(&id, &team, &env, &cloud, &service, &status, &priority); err != nil {
				continue
			}
			href := "/history?id=" + strconv.Itoa(id)
			if portal == "admin" {
				href = "/approval-center"
			}
			if portal == "devops" {
				href = "/approval-center"
			}
			items = append(items, workspaceQueueItem{
				ID:    fmt.Sprintf("approval-%d", id),
				Title: fmt.Sprintf("%s %s waiting", cloud, service),
				Meta:  strings.Join([]string{team, env, strings.ReplaceAll(status, "_", " ")}, " · "),
				Href:  href,
				Tone:  toneFromPriority(priority),
			})
		}
	}

	if rows, err := DB.Query(`
		SELECT id, COALESCE(incident_number, ''), COALESCE(summary, ''), COALESCE(severity, 'medium'), COALESCE(status, 'open')
		FROM request_incidents
		WHERE LOWER(COALESCE(status, 'open')) NOT IN ('closed', 'resolved')
		ORDER BY updated_at DESC
		LIMIT 4
	`); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id int
			var number, summary, severity, status string
			if err := rows.Scan(&id, &number, &summary, &severity, &status); err != nil {
				continue
			}
			label := number
			if label == "" {
				label = formatIncidentNumber(id)
			}
			href := "/incidents"
			if portal == "devops" {
				href = "/incidents"
			}
			items = append(items, workspaceQueueItem{
				ID:    fmt.Sprintf("incident-%d", id),
				Title: strings.TrimSpace(label + " " + summary),
				Meta:  severity + " · " + status,
				Href:  href,
				Tone:  "high",
			})
		}
	}

	if rows, err := DB.Query(`
		SELECT request_id, pr_number, score, risk_level, COALESCE(deploy_status, '')
		FROM pr_request_impact
		WHERE LOWER(risk_level) IN ('high', 'medium')
		ORDER BY score DESC, updated_at DESC
		LIMIT 4
	`); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var requestID, prNumber, score int
			var risk, deploy string
			if err := rows.Scan(&requestID, &prNumber, &score, &risk, &deploy); err != nil {
				continue
			}
			href := "/history?id=" + strconv.Itoa(requestID)
			if portal == "devops" {
				href = "/tickets?id=" + strconv.Itoa(requestID)
			}
			items = append(items, workspaceQueueItem{
				ID:    fmt.Sprintf("pr-%d", requestID),
				Title: fmt.Sprintf("PR #%d production impact", prNumber),
				Meta:  fmt.Sprintf("%s risk · %d/100 · %s", risk, score, deploy),
				Href:  href,
				Tone:  risk,
			})
		}
	}

	if activeFreezeReason() != "" {
		items = append([]workspaceQueueItem{{
			ID:    "freeze-active",
			Title: "Production freeze is active",
			Meta:  activeFreezeReason(),
			Href:  portalFreezeHref(portal),
			Tone:  "danger",
		}}, items...)
	}

	if len(items) > 12 {
		return items[:12]
	}
	return items
}

func workspacePipeline(portal, projectID string) (string, []workspacePipelineStage) {
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
		_ = DB.QueryRow("SELECT id, name FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").Scan(&id, &projectName)
	}
	if id == 0 {
		return projectName, defaultPipelineStages(portal)
	}
	rows, err := DB.Query(`
		SELECT environment FROM project_environments WHERE project_id = $1 ORDER BY environment
	`, id)
	if err != nil {
		return projectName, defaultPipelineStages(portal)
	}
	defer func() { _ = rows.Close() }()
	envs := make([]string, 0, 4)
	for rows.Next() {
		var env string
		if err := rows.Scan(&env); err == nil && env != "" {
			envs = append(envs, env)
		}
	}
	if len(envs) == 0 {
		envs = []string{"dev", "uat", "prod"}
	}
	for _, env := range envs {
		var latestStatus, service string
		var requestID int
		_ = DB.QueryRow(`
			SELECT id, status, service FROM pr_requests
			WHERE project_id = $1 AND LOWER(env) = LOWER($2)
			ORDER BY updated_at DESC LIMIT 1
		`, id, env).Scan(&requestID, &latestStatus, &service)
		if latestStatus == "" {
			latestStatus = "idle"
		}
		href := ""
		if requestID > 0 {
			href = "/history?id=" + strconv.Itoa(requestID)
			if portal == "devops" {
				href = "/tickets?id=" + strconv.Itoa(requestID)
			}
			if portal == "admin" {
				href = "/requests?id=" + strconv.Itoa(requestID)
			}
		}
		summary := "No recent change"
		if service != "" {
			summary = service + " · " + strings.ReplaceAll(latestStatus, "_", " ")
		}
		blocked := strings.Contains(strings.ToLower(latestStatus), "reject") || envEqualsProd(env) && activeFreezeReason() != ""
		stages = append(stages, workspacePipelineStage{
			Env:     env,
			Status:  strings.ReplaceAll(latestStatus, "_", " "),
			Summary: summary,
			Href:    href,
			Active:  latestStatus == "in_progress" || latestStatus == "pending_devops_approval",
			Blocked: blocked,
		})
	}
	return projectName, stages
}

func defaultPipelineStages(portal string) []workspacePipelineStage {
	_ = portal
	return []workspacePipelineStage{
		{Env: "dev", Status: "idle", Summary: "No recent change"},
		{Env: "uat", Status: "idle", Summary: "Waiting on a promotion"},
		{Env: "prod", Status: "idle", Summary: "Production is quiet"},
	}
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
	if DB == nil {
		return ""
	}
	var reason string
	err := DB.QueryRow(`
		SELECT reason FROM deployment_freezes
		WHERE starts_at <= NOW() AND ends_at >= NOW()
		ORDER BY starts_at DESC
		LIMIT 1
	`).Scan(&reason)
	if err != nil {
		return ""
	}
	return reason
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
