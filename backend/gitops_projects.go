package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type GitOpsComponentSummary struct {
	Name         string     `json:"name"`
	Key          string     `json:"key"`
	ManifestPath string     `json:"manifest_path"`
	RequestCount int        `json:"request_count"`
	LastUpdated  *time.Time `json:"last_updated,omitempty"`
}

type GitOpsEnvironmentSummary struct {
	Name           string                   `json:"name"`
	FolderPath     string                   `json:"folder_path"`
	RequestCount   int                      `json:"request_count"`
	PendingCount   int                      `json:"pending_count"`
	InFlightCount  int                      `json:"in_flight_count"`
	CompletedCount int                      `json:"completed_count"`
	LastUpdated    *time.Time               `json:"last_updated,omitempty"`
	Components     []GitOpsComponentSummary `json:"components"`
}

type GitOpsRecentChange struct {
	RequestID     int       `json:"request_id"`
	ApplicationID string    `json:"application_id"`
	Service       string    `json:"service"`
	Cloud         string    `json:"cloud"`
	Environment   string    `json:"environment"`
	Status        string    `json:"status"`
	Branch        string    `json:"branch"`
	FilePath      string    `json:"file_path"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type GitOpsProjectSummary struct {
	TeamID                 int                        `json:"team_id"`
	ProjectName            string                     `json:"project_name"`
	ProjectSlug            string                     `json:"project_slug"`
	GroupID                string                     `json:"group_id"`
	ProjectKey             string                     `json:"project_key"`
	RepoRoot               string                     `json:"repo_root"`
	LiveRequestPathPattern string                     `json:"live_request_path_pattern"`
	ManifestPathPattern    string                     `json:"manifest_path_pattern"`
	BranchPattern          string                     `json:"branch_pattern"`
	DefaultEnvironment     string                     `json:"default_environment"`
	DefaultCloud           string                     `json:"default_cloud"`
	RequestCount           int                        `json:"request_count"`
	PendingCount           int                        `json:"pending_count"`
	InFlightCount          int                        `json:"in_flight_count"`
	Environments           []GitOpsEnvironmentSummary `json:"environments"`
	RecentChanges          []GitOpsRecentChange       `json:"recent_changes"`
	FolderTree             []string                   `json:"folder_tree"`
	DeliveryMode           string                     `json:"delivery_mode"`
}

type GitOpsPreview struct {
	TeamID            int                    `json:"team_id"`
	ProjectName       string                 `json:"project_name"`
	GroupID           string                 `json:"group_id"`
	Environment       string                 `json:"environment"`
	Component         string                 `json:"component"`
	RepoRoot          string                 `json:"repo_root"`
	EnvironmentFolder string                 `json:"environment_folder"`
	ManifestPath      string                 `json:"manifest_path"`
	LiveRequestPath   string                 `json:"live_request_path"`
	BranchExample     string                 `json:"branch_example"`
	PullRequestTitle  string                 `json:"pull_request_title"`
	BaseBranch        string                 `json:"base_branch"`
	SampleManifest    map[string]interface{} `json:"sample_manifest"`
}

func normalizeGitOpsComponentName(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "infrastructure"
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	normalized := strings.Trim(b.String(), "-")
	if normalized == "" {
		return "infrastructure"
	}
	return normalized
}

func BuildGitOpsProjectRoot(teamNameOrSlug string) string {
	return fmt.Sprintf("projects/%s", ResolveTeamPathKey(teamNameOrSlug))
}

func BuildGitOpsEnvironmentFolder(teamNameOrSlug, env string) string {
	return fmt.Sprintf("%s/%s", BuildGitOpsProjectRoot(teamNameOrSlug), normalizeGitOpsComponentName(env))
}

func BuildGitOpsManifestPath(teamNameOrSlug, env, component string) string {
	return fmt.Sprintf("%s/%s.json", BuildGitOpsEnvironmentFolder(teamNameOrSlug, env), normalizeGitOpsComponentName(component))
}

func gitOpsEnvironmentOrder(env string) int {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "dev":
		return 0
	case "qa":
		return 1
	case "staging":
		return 2
	case "uat":
		return 3
	case "prod":
		return 4
	default:
		return 10
	}
}

func teamMatchesRequest(team Team, requestTeam string) bool {
	reqTeam := strings.TrimSpace(strings.ToLower(requestTeam))
	return reqTeam != "" && (reqTeam == strings.ToLower(team.Name) || reqTeam == strings.ToLower(team.Slug))
}

func getVisibleGitOpsTeams(userID int) ([]Team, error) {
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return nil, err
	}
	if user.Role == "admin" {
		teams, err := GetTeams()
		if err != nil {
			return nil, err
		}
		filtered := make([]Team, 0, len(teams))
		for _, team := range teams {
			if team.TeamType == "devops" {
				filtered = append(filtered, team)
			}
		}
		return filtered, nil
	}
	return GetDevopsTeamsForUser(userID)
}

func loadGitOpsRequestsForTeam(team Team) ([]PRRequest, error) {
	searchTerms := []string{team.Name}
	if team.Slug != "" && !strings.EqualFold(team.Slug, team.Name) {
		searchTerms = append(searchTerms, team.Slug)
	}
	seen := make(map[int]PRRequest)
	for _, term := range searchTerms {
		requests, err := GetPRRequests(term, "", "", "", "", "", 0, 0, nil, 250, 0, "updated_at", "desc", false, "", "")
		if err != nil {
			return nil, err
		}
		for _, request := range requests {
			if !teamMatchesRequest(team, request.Team) {
				continue
			}
			seen[request.ID] = request
		}
	}
	out := make([]PRRequest, 0, len(seen))
	for _, request := range seen {
		out = append(out, request)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

func buildGitOpsFolderTree(team Team, environments []GitOpsEnvironmentSummary) []string {
	lines := []string{BuildGitOpsProjectRoot(team.Name) + "/"}
	for _, env := range environments {
		lines = append(lines, "  "+env.Name+"/")
		if len(env.Components) == 0 {
			lines = append(lines, "    component.json")
			continue
		}
		for _, component := range env.Components {
			lines = append(lines, "    "+component.Key+".json")
		}
	}
	return lines
}

func buildGitOpsPreview(team Team, env, component string) GitOpsPreview {
	normalizedEnv := normalizeGitOpsComponentName(env)
	if normalizedEnv == "" || normalizedEnv == "infrastructure" {
		normalizedEnv = "dev"
	}
	normalizedComponent := normalizeGitOpsComponentName(component)
	if normalizedComponent == "" {
		normalizedComponent = "networking"
	}
	projectKey := ResolveTeamPathKey(team.Name)
	return GitOpsPreview{
		TeamID:            team.ID,
		ProjectName:       team.Name,
		GroupID:           team.ApplicationID,
		Environment:       normalizedEnv,
		Component:         normalizedComponent,
		RepoRoot:          BuildGitOpsProjectRoot(team.Name),
		EnvironmentFolder: BuildGitOpsEnvironmentFolder(team.Name, normalizedEnv),
		ManifestPath:      BuildGitOpsManifestPath(team.Name, normalizedEnv, normalizedComponent),
		LiveRequestPath:   fmt.Sprintf("%s/envs/%s/request.json", projectKey, normalizedEnv),
		BranchExample:     fmt.Sprintf("%s/%s/%s", projectKey, normalizedEnv, "{request-id}"),
		PullRequestTitle:  fmt.Sprintf("GitOps change: %s %s %s", team.Name, normalizedEnv, normalizedComponent),
		BaseBranch:        BaseBranch,
		SampleManifest: map[string]interface{}{
			"project":     team.Name,
			"group_id":    team.ApplicationID,
			"environment": normalizedEnv,
			"component":   normalizedComponent,
			"delivery": map[string]interface{}{
				"mode":        "gitops",
				"base_branch": BaseBranch,
				"workflow":    []string{"branch", "pull_request", "ci_validate_plan", "merge", "cd_apply"},
			},
			"resource_spec": map[string]interface{}{
				"name":            normalizedComponent,
				"cloud":           strings.TrimSpace(team.DefaultCloud),
				"change_strategy": "incremental",
			},
		},
	}
}

func buildGitOpsProjectSummary(team Team, requests []PRRequest) GitOpsProjectSummary {
	envSet := map[string]bool{"dev": true, "qa": true, "prod": true}
	if team.DefaultEnv != "" {
		envSet[normalizeGitOpsComponentName(team.DefaultEnv)] = true
	}
	for _, request := range requests {
		envSet[normalizeGitOpsComponentName(request.Env)] = true
	}

	envNames := make([]string, 0, len(envSet))
	for env := range envSet {
		envNames = append(envNames, env)
	}
	sort.Slice(envNames, func(i, j int) bool {
		leftOrder := gitOpsEnvironmentOrder(envNames[i])
		rightOrder := gitOpsEnvironmentOrder(envNames[j])
		if leftOrder == rightOrder {
			return envNames[i] < envNames[j]
		}
		return leftOrder < rightOrder
	})

	environments := make([]GitOpsEnvironmentSummary, 0, len(envNames))
	totalPending := 0
	totalInFlight := 0
	for _, env := range envNames {
		componentMap := make(map[string]*GitOpsComponentSummary)
		var envRequests []PRRequest
		for _, request := range requests {
			if normalizeGitOpsComponentName(request.Env) != env {
				continue
			}
			envRequests = append(envRequests, request)
			componentLabel := strings.TrimSpace(request.Service)
			if componentLabel == "" {
				componentLabel = strings.TrimSpace(request.Cloud)
			}
			if componentLabel == "" {
				componentLabel = "Infrastructure"
			}
			componentKey := normalizeGitOpsComponentName(componentLabel)
			entry, ok := componentMap[componentKey]
			if !ok {
				entry = &GitOpsComponentSummary{
					Name:         componentLabel,
					Key:          componentKey,
					ManifestPath: BuildGitOpsManifestPath(team.Name, env, componentKey),
				}
				componentMap[componentKey] = entry
			}
			entry.RequestCount++
			if entry.LastUpdated == nil || request.UpdatedAt.After(*entry.LastUpdated) {
				updated := request.UpdatedAt
				entry.LastUpdated = &updated
			}
		}

		components := make([]GitOpsComponentSummary, 0, len(componentMap))
		for _, component := range componentMap {
			components = append(components, *component)
		}
		sort.Slice(components, func(i, j int) bool {
			if components[i].RequestCount == components[j].RequestCount {
				return components[i].Key < components[j].Key
			}
			return components[i].RequestCount > components[j].RequestCount
		})

		envSummary := GitOpsEnvironmentSummary{
			Name:       env,
			FolderPath: BuildGitOpsEnvironmentFolder(team.Name, env),
			Components: components,
		}
		for _, request := range envRequests {
			envSummary.RequestCount++
			switch request.Status {
			case "completed":
				envSummary.CompletedCount++
			case "in_progress":
				envSummary.InFlightCount++
			case "pending_devops_approval", "pending_user_manager_approval", "pending_approval":
				envSummary.PendingCount++
			}
			if envSummary.LastUpdated == nil || request.UpdatedAt.After(*envSummary.LastUpdated) {
				updated := request.UpdatedAt
				envSummary.LastUpdated = &updated
			}
		}
		totalPending += envSummary.PendingCount
		totalInFlight += envSummary.InFlightCount
		environments = append(environments, envSummary)
	}

	recentChanges := make([]GitOpsRecentChange, 0, minInt(len(requests), 5))
	for _, request := range requests {
		recentChanges = append(recentChanges, GitOpsRecentChange{
			RequestID:     request.ID,
			ApplicationID: request.ApplicationID,
			Service:       request.Service,
			Cloud:         request.Cloud,
			Environment:   request.Env,
			Status:        request.Status,
			Branch:        request.Branch,
			FilePath:      request.FilePath,
			UpdatedAt:     request.UpdatedAt,
		})
		if len(recentChanges) == 5 {
			break
		}
	}

	defaultEnv := strings.TrimSpace(team.DefaultEnv)
	if defaultEnv == "" {
		defaultEnv = "dev"
	}
	defaultCloud := strings.TrimSpace(team.DefaultCloud)
	if defaultCloud == "" {
		defaultCloud = "aws"
	}
	projectKey := ResolveTeamPathKey(team.Name)
	return GitOpsProjectSummary{
		TeamID:                 team.ID,
		ProjectName:            team.Name,
		ProjectSlug:            team.Slug,
		GroupID:                team.ApplicationID,
		ProjectKey:             projectKey,
		RepoRoot:               BuildGitOpsProjectRoot(team.Name),
		LiveRequestPathPattern: fmt.Sprintf("%s/envs/<env>/request.json", projectKey),
		ManifestPathPattern:    fmt.Sprintf("%s/<env>/<component>.json", BuildGitOpsProjectRoot(team.Name)),
		BranchPattern:          fmt.Sprintf("%s/<env>/<request-id>", projectKey),
		DefaultEnvironment:     defaultEnv,
		DefaultCloud:           defaultCloud,
		RequestCount:           len(requests),
		PendingCount:           totalPending,
		InFlightCount:          totalInFlight,
		Environments:           environments,
		RecentChanges:          recentChanges,
		FolderTree:             buildGitOpsFolderTree(team, environments),
		DeliveryMode:           "Branch -> Pull Request -> CI validate + plan -> merge -> CD apply",
	}
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func devopsGitOpsProjectsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	teams, err := getVisibleGitOpsTeams(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	projects := make([]GitOpsProjectSummary, 0, len(teams))
	totalRequests := 0
	totalPending := 0
	for _, team := range teams {
		requests, err := loadGitOpsRequestsForTeam(team)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		project := buildGitOpsProjectSummary(team, requests)
		totalRequests += project.RequestCount
		totalPending += project.PendingCount
		projects = append(projects, project)
	}
	sort.Slice(projects, func(i, j int) bool {
		return strings.ToLower(projects[i].ProjectName) < strings.ToLower(projects[j].ProjectName)
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"repo": map[string]interface{}{
			"owner":       GitHubOwner,
			"repository":  GitHubRepo,
			"base_branch": BaseBranch,
		},
		"overview": map[string]interface{}{
			"project_count": len(projects),
			"request_count": totalRequests,
			"pending_count": totalPending,
		},
		"projects": projects,
		"workflow": []map[string]string{
			{"step": "Branch", "detail": "Create a change branch from the project baseline."},
			{"step": "Pull Request", "detail": "Open a PR with folder-scoped JSON changes for review."},
			{"step": "CI Validate + Plan", "detail": "Validate schema and run plan output before approval."},
			{"step": "Merge + Apply", "detail": "Merge to main and let CD apply only the delta."},
		},
	})
}

func devopsGitOpsPreviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	teams, err := getVisibleGitOpsTeams(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	teamID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("team_id")))
	if teamID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team_id is required", "status": "error"})
		return
	}
	var selectedTeam *Team
	for _, team := range teams {
		if team.ID == teamID {
			teamCopy := team
			selectedTeam = &teamCopy
			break
		}
	}
	if selectedTeam == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team not available in this DevOps scope", "status": "error"})
		return
	}
	env := strings.TrimSpace(r.URL.Query().Get("env"))
	if env == "" {
		env = selectedTeam.DefaultEnv
	}
	if env == "" {
		env = "dev"
	}
	component := strings.TrimSpace(r.URL.Query().Get("component"))
	if component == "" {
		component = r.URL.Query().Get("service")
	}
	if component == "" {
		component = "networking"
	}
	preview := buildGitOpsPreview(*selectedTeam, env, component)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "preview": preview})
}
