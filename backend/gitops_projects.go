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
	ProjectID              int                        `json:"project_id"`
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
	CurrentPermission      string                     `json:"current_permission"`
	CanWrite               bool                       `json:"can_write"`
	CanManage              bool                       `json:"can_manage"`
	RequestCount           int                        `json:"request_count"`
	PendingCount           int                        `json:"pending_count"`
	InFlightCount          int                        `json:"in_flight_count"`
	Environments           []GitOpsEnvironmentSummary `json:"environments"`
	RecentChanges          []GitOpsRecentChange       `json:"recent_changes"`
	FolderTree             []string                   `json:"folder_tree"`
	DeliveryMode           string                     `json:"delivery_mode"`
}

type GitOpsPreview struct {
	ProjectID         int                    `json:"project_id"`
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

func loadGitOpsRequestsForProject(project GitOpsCatalogProject) ([]PRRequest, error) {
	searchTerms := []string{project.TeamName}
	if project.TeamSlug != "" && !strings.EqualFold(project.TeamSlug, project.TeamName) {
		searchTerms = append(searchTerms, project.TeamSlug)
	}
	seen := make(map[int]PRRequest)
	for _, term := range searchTerms {
		requests, err := GetPRRequests(term, "", "", 0, "", "", "", 0, 0, nil, 250, 0, "updated_at", "desc", false, "", "")
		if err != nil {
			return nil, err
		}
		for _, request := range requests {
			reqTeam := strings.TrimSpace(strings.ToLower(request.Team))
			if reqTeam == "" {
				continue
			}
			if reqTeam != strings.ToLower(project.TeamName) && reqTeam != strings.ToLower(project.TeamSlug) {
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

func buildGitOpsFolderTree(project GitOpsCatalogProject) []string {
	lines := []string{project.RepoRoot + "/"}
	for _, env := range project.Environments {
		lines = append(lines, "  "+env+"/")
		for _, component := range project.Components {
			lines = append(lines, "    "+component+".json")
		}
	}
	return lines
}

func buildGitOpsPreview(project GitOpsCatalogProject, env, component string) GitOpsPreview {
	normalizedEnv := normalizeGitOpsComponentName(env)
	if normalizedEnv == "" || normalizedEnv == "infrastructure" {
		if len(project.Environments) > 0 {
			normalizedEnv = project.Environments[0]
		} else {
			normalizedEnv = "dev"
		}
	}
	normalizedComponent := normalizeGitOpsComponentName(component)
	if normalizedComponent == "" || normalizedComponent == "infrastructure" {
		if len(project.Components) > 0 {
			normalizedComponent = project.Components[0]
		} else {
			normalizedComponent = "networking"
		}
	}
	projectKey := fmt.Sprintf("%s/%s", ResolveTeamPathKey(project.TeamName), project.Slug)
	return GitOpsPreview{
		ProjectID:         project.ID,
		TeamID:            project.TeamID,
		ProjectName:       project.Name,
		GroupID:           project.GroupID,
		Environment:       normalizedEnv,
		Component:         normalizedComponent,
		RepoRoot:          project.RepoRoot,
		EnvironmentFolder: BuildGitOpsManagedEnvironmentFolder(project.RepoRoot, normalizedEnv),
		ManifestPath:      BuildGitOpsManagedManifestPath(project.RepoRoot, normalizedEnv, normalizedComponent),
		LiveRequestPath:   fmt.Sprintf("%s/envs/%s/request.json", ResolveTeamPathKey(project.TeamName), normalizedEnv),
		BranchExample:     fmt.Sprintf("%s/%s/%s", projectKey, normalizedEnv, "{request-id}"),
		PullRequestTitle:  fmt.Sprintf("GitOps change: %s %s %s", project.Name, normalizedEnv, normalizedComponent),
		BaseBranch:        project.BaseBranch,
		SampleManifest: map[string]interface{}{
			"project":      project.Name,
			"project_slug": project.Slug,
			"group_id":     project.GroupID,
			"environment":  normalizedEnv,
			"component":    normalizedComponent,
			"delivery": map[string]interface{}{
				"mode":        "gitops",
				"base_branch": project.BaseBranch,
				"workflow":    []string{"branch", "pull_request", "ci_validate_plan", "merge", "cd_apply"},
			},
			"resource_spec": map[string]interface{}{
				"name":            normalizedComponent,
				"cloud":           strings.TrimSpace(project.DefaultCloud),
				"change_strategy": "incremental",
			},
		},
	}
}

func buildGitOpsProjectSummary(project GitOpsCatalogProject, requests []PRRequest) GitOpsProjectSummary {
	requestsByEnv := make(map[string][]PRRequest)
	for _, request := range requests {
		envKey := normalizeGitOpsComponentName(request.Env)
		requestsByEnv[envKey] = append(requestsByEnv[envKey], request)
	}

	environments := make([]GitOpsEnvironmentSummary, 0, len(project.Environments))
	totalPending := 0
	totalInFlight := 0
	totalRequests := 0

	for _, env := range project.Environments {
		envRequests := requestsByEnv[env]
		components := make([]GitOpsComponentSummary, 0, len(project.Components))
		for _, component := range project.Components {
			componentSummary := GitOpsComponentSummary{
				Name:         component,
				Key:          component,
				ManifestPath: BuildGitOpsManagedManifestPath(project.RepoRoot, env, component),
			}
			for _, request := range envRequests {
				requestComponent := normalizeGitOpsComponentName(request.Service)
				if requestComponent == "infrastructure" {
					requestComponent = normalizeGitOpsComponentName(request.Cloud)
				}
				if requestComponent == component {
					componentSummary.RequestCount++
					if componentSummary.LastUpdated == nil || request.UpdatedAt.After(*componentSummary.LastUpdated) {
						updated := request.UpdatedAt
						componentSummary.LastUpdated = &updated
					}
				}
			}
			components = append(components, componentSummary)
		}

		envSummary := GitOpsEnvironmentSummary{
			Name:       env,
			FolderPath: BuildGitOpsManagedEnvironmentFolder(project.RepoRoot, env),
			Components: components,
		}
		for _, request := range envRequests {
			envSummary.RequestCount++
			totalRequests++
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
	allowedEnvironments := make(map[string]bool, len(project.Environments))
	for _, env := range project.Environments {
		allowedEnvironments[env] = true
	}
	for _, request := range requests {
		if !allowedEnvironments[normalizeGitOpsComponentName(request.Env)] {
			continue
		}
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

	defaultEnv := "dev"
	if len(project.Environments) > 0 {
		defaultEnv = project.Environments[0]
	}
	defaultCloud := strings.TrimSpace(project.DefaultCloud)
	if defaultCloud == "" {
		defaultCloud = "aws"
	}
	projectKey := fmt.Sprintf("%s/%s", ResolveTeamPathKey(project.TeamName), project.Slug)

	return GitOpsProjectSummary{
		ProjectID:              project.ID,
		TeamID:                 project.TeamID,
		ProjectName:            project.Name,
		ProjectSlug:            project.Slug,
		GroupID:                project.GroupID,
		ProjectKey:             projectKey,
		RepoRoot:               project.RepoRoot,
		LiveRequestPathPattern: fmt.Sprintf("%s/envs/<env>/request.json", ResolveTeamPathKey(project.TeamName)),
		ManifestPathPattern:    fmt.Sprintf("%s/<env>/<component>.json", project.RepoRoot),
		BranchPattern:          fmt.Sprintf("%s/<env>/<request-id>", projectKey),
		DefaultEnvironment:     defaultEnv,
		DefaultCloud:           defaultCloud,
		CurrentPermission:      project.CurrentPermission,
		CanWrite:               project.CanWrite,
		CanManage:              project.CanManage,
		RequestCount:           totalRequests,
		PendingCount:           totalPending,
		InFlightCount:          totalInFlight,
		Environments:           environments,
		RecentChanges:          recentChanges,
		FolderTree:             buildGitOpsFolderTree(project),
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

	catalogProjects, err := listVisibleGitOpsProjectsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	projects := make([]GitOpsProjectSummary, 0, len(catalogProjects))
	totalRequests := 0
	totalPending := 0
	for _, catalogProject := range catalogProjects {
		requests, err := loadGitOpsRequestsForProject(catalogProject)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		project := buildGitOpsProjectSummary(catalogProject, requests)
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
			{"step": "Create Structure", "detail": "DevOps manager defines project folders, environments, and component files in the portal."},
			{"step": "Grant Access", "detail": "Project visibility is assigned per DevOps user and per environment from the portal."},
			{"step": "Pull Request", "detail": "Changes continue through branch and PR review before merge."},
			{"step": "Merge + Apply", "detail": "Approved changes merge to the base branch and CD applies only the delta."},
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

	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	if projectID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "project_id is required", "status": "error"})
		return
	}

	selectedProject, _, err := GetGitOpsProjectVisibleToUser(userID, projectID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if selectedProject == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "project not available in this DevOps scope", "status": "error"})
		return
	}

	env := strings.TrimSpace(r.URL.Query().Get("env"))
	if env == "" && len(selectedProject.Environments) > 0 {
		env = selectedProject.Environments[0]
	}
	component := strings.TrimSpace(r.URL.Query().Get("component"))
	if component == "" && len(selectedProject.Components) > 0 {
		component = selectedProject.Components[0]
	}
	if component == "" {
		component = "networking"
	}

	preview := buildGitOpsPreview(*selectedProject, env, component)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "preview": preview})
}
