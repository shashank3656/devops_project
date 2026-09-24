package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func applyGitHubRepoToCatalogProject(project *GitOpsCatalogProject, owner, repo string) error {
	if project == nil {
		return fmt.Errorf("project is required")
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	if owner == "" && repo == "" {
		return nil
	}
	if owner == "" || repo == "" {
		return fmt.Errorf("github_owner and github_repo must both be set")
	}
	if err := setGitOpsProjectGitHubRepo(project.ID, owner, repo); err != nil {
		return err
	}
	project.GitHubOwner = owner
	project.GitHubRepo = repo
	maybeOnboardDeployIntelForProjectRepo(*project)
	return nil
}

type GitOpsAssignableUser struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	IsManager bool   `json:"is_manager"`
	Level     string `json:"level"`
}

func getGitOpsAssignableUsers() ([]GitOpsAssignableUser, error) {
	rows, err := DB.Query(`
		SELECT u.id, u.username, COALESCE(u.email, ''), COALESCE(d.is_manager, false), COALESCE(d.level, 'L1')
		FROM users u
		LEFT JOIN devops_profiles d ON d.user_id = u.id
		WHERE COALESCE(u.user_type, 'portal_user') = 'devops_user'
		ORDER BY u.username
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []GitOpsAssignableUser
	for rows.Next() {
		var user GitOpsAssignableUser
		if err := rows.Scan(&user.ID, &user.Username, &user.Email, &user.IsManager, &user.Level); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, nil
}

func findManagedGitOpsProject(userID, projectID int) (*GitOpsCatalogProject, error) {
	projects, err := listManageableGitOpsProjectsForUser(userID)
	if err != nil {
		return nil, err
	}
	for _, project := range projects {
		if project.ID == projectID {
			projectCopy := project
			return &projectCopy, nil
		}
	}
	return nil, nil
}

func findVisibleGitOpsProject(userID, projectID int) (*GitOpsCatalogProject, error) {
	project, _, err := GetGitOpsProjectVisibleToUser(userID, projectID)
	return project, err
}

func ensureGitOpsBootstrapTeam(userID int, defaultCloud string) (*Team, error) {
	if !CanUserBootstrapGitOpsProjects(userID) {
		return nil, fmt.Errorf("GitOps admin access is required to create the first project")
	}

	existing, err := GetTeamByNameOrSlug("devops-platform")
	if err == nil && existing != nil && existing.TeamType == "devops" {
		if _, memberErr := AddTeamMember(existing.ID, userID, "lead"); memberErr != nil && !strings.Contains(strings.ToLower(memberErr.Error()), "duplicate") {
			return nil, memberErr
		}
		return existing, nil
	}

	createdBy := &userID
	team, err := CreateTeam("DevOps Platform", "devops-platform", "devops", createdBy, "dev", defaultCloud)
	if err != nil {
		return nil, err
	}
	if _, err := AddTeamMember(team.ID, userID, "lead"); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return nil, err
	}
	return team, nil
}

func resolveGitOpsCreateTeamID(userID, requestedTeamID int, defaultCloud string) (int, error) {
	if requestedTeamID > 0 {
		return requestedTeamID, nil
	}

	teams, err := listCreatableGitOpsTeamsForUser(userID)
	if err != nil {
		return 0, err
	}
	if len(teams) == 1 {
		return teams[0].ID, nil
	}
	if len(teams) > 1 {
		return 0, fmt.Errorf("select a devops team")
	}

	team, err := ensureGitOpsBootstrapTeam(userID, defaultCloud)
	if err != nil {
		return 0, err
	}
	return team.ID, nil
}

func devopsGitOpsManagementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	teams, err := listCreatableGitOpsTeamsForUser(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	users, err := getGitOpsAssignableUsers()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	projects, err := listVisibleGitOpsProjectsForUser(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":              "ok",
		"can_create_projects": len(teams) > 0 || CanUserBootstrapGitOpsProjects(userID),
		"teams":               teams,
		"users":               users,
		"projects":            projects,
	})
}

func devopsGitOpsProjectCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	var body struct {
		TeamID       int      `json:"team_id"`
		Name         string   `json:"name"`
		Slug         string   `json:"slug"`
		DefaultCloud string   `json:"default_cloud"`
		GitHubOwner  string   `json:"github_owner"`
		GitHubRepo   string   `json:"github_repo"`
		Environments []string `json:"environments"`
		Components   []string `json:"components"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", nil)
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "name is required", nil)
		return
	}
	resolvedTeamID, err := resolveGitOpsCreateTeamID(userID, body.TeamID, body.DefaultCloud)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}
	if !CanUserCreateGitOpsProjectInTeam(userID, resolvedTeamID) {
		writeAPIError(w, r, http.StatusForbidden, "GitOps admin access is required to create a project in this team", nil)
		return
	}

	project, err := CreateGitOpsCatalogProject(resolvedTeamID, body.Name, body.Slug, body.Environments, body.Components, body.DefaultCloud, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}
	if err := applyGitHubRepoToCatalogProject(project, body.GitHubOwner, body.GitHubRepo); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "failed to save GitHub repository", err)
		return
	}

	syncResult := syncGitOpsProjectStructureToGit(*project, project.Components, "create")

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "project": project, "sync": syncResult})
}

func devopsGitOpsProjectUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(strings.Trim(r.URL.Path, "/"), "/tree") {
		devopsGitOpsProjectTreeHandler(w, r)
		return
	}
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "PUT" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	projectID, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/devops/gitops/manage/projects/")))
	if projectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project id is required", nil)
		return
	}

	project, err := findManagedGitOpsProject(userID, projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, projectID) {
		writeAPIError(w, r, http.StatusForbidden, "GitOps admin access is required for this project", nil)
		return
	}

	var body struct {
		TeamID       int      `json:"team_id"`
		Name         string   `json:"name"`
		Slug         string   `json:"slug"`
		DefaultCloud string   `json:"default_cloud"`
		GitHubOwner  string   `json:"github_owner"`
		GitHubRepo   string   `json:"github_repo"`
		Environments []string `json:"environments"`
		Components   []string `json:"components"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", nil)
		return
	}
	if body.TeamID <= 0 || strings.TrimSpace(body.Name) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "team_id and name are required", nil)
		return
	}
	if !CanUserCreateGitOpsProjectInTeam(userID, body.TeamID) {
		writeAPIError(w, r, http.StatusForbidden, "GitOps admin access is required to update a project in this team", nil)
		return
	}

	updatedProject, err := UpdateGitOpsCatalogProject(projectID, body.TeamID, body.Name, body.Slug, body.Environments, body.Components, body.DefaultCloud)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}
	if err := applyGitHubRepoToCatalogProject(updatedProject, body.GitHubOwner, body.GitHubRepo); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "failed to save GitHub repository", err)
		return
	}

	syncResult := syncGitOpsProjectStructureToGit(*updatedProject, updatedProject.Components, "update")

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "project": updatedProject, "sync": syncResult})
}

func devopsGitOpsAccessCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	var body struct {
		ProjectID    int      `json:"project_id"`
		UserID       int      `json:"user_id"`
		Permission   string   `json:"permission"`
		Environments []string `json:"environments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", nil)
		return
	}
	if body.ProjectID <= 0 || body.UserID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project_id and user_id are required", nil)
		return
	}

	project, err := findManagedGitOpsProject(userID, body.ProjectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, body.ProjectID) {
		writeAPIError(w, r, http.StatusForbidden, "GitOps admin access is required for this project", nil)
		return
	}

	if err := SetGitOpsProjectAccess(project.ID, body.UserID, userID, body.Environments, body.Permission); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok"})
}

func devopsGitOpsAccessDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "DELETE" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	accessID, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/devops/gitops/manage/access/")))
	if accessID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "access id is required", nil)
		return
	}

	access, err := GetGitOpsProjectAccessByID(accessID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if access == nil {
		writeAPIError(w, r, http.StatusNotFound, "access rule not found", nil)
		return
	}

	project, err := findManagedGitOpsProject(userID, access.ProjectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, access.ProjectID) {
		writeAPIError(w, r, http.StatusForbidden, "GitOps admin access is required for this project", nil)
		return
	}

	if err := DeleteGitOpsProjectAccess(accessID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok"})
}

func devopsGitOpsProjectTreeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}

	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	projectPath := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/devops/gitops/manage/projects/"))
	projectPath = strings.TrimSuffix(projectPath, "/tree")
	projectPath = strings.Trim(projectPath, "/")
	projectID, _ := strconv.Atoi(projectPath)
	if projectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project id is required", nil)
		return
	}

	project, err := findVisibleGitOpsProject(userID, projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil {
		writeAPIError(w, r, http.StatusForbidden, "GitOps project access is required", nil)
		return
	}

	nodes, warning, err := loadGitOpsRepoTree(*project)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":  "ok",
		"project": project,
		"nodes":   nodes,
		"warning": warning,
	})
}

func devopsGitOpsProjectFileCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}

	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case "GET":
		projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
		environment := strings.TrimSpace(r.URL.Query().Get("environment"))
		component := strings.TrimSpace(r.URL.Query().Get("component"))
		if projectID <= 0 || environment == "" || component == "" {
			writeAPIError(w, r, http.StatusBadRequest, "project_id, environment, and component are required", nil)
			return
		}

		project, err := findVisibleGitOpsProject(userID, projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		if project == nil {
			writeAPIError(w, r, http.StatusForbidden, "GitOps project access is required", nil)
			return
		}

		document, err := loadGitOpsRepoFile(*project, environment, component)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "document": document})
		return

	case "POST":
		var body struct {
			ProjectID int    `json:"project_id"`
			Component string `json:"component"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", nil)
			return
		}
		if body.ProjectID <= 0 || strings.TrimSpace(body.Component) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "project_id and component are required", nil)
			return
		}

		project, err := findVisibleGitOpsProject(userID, body.ProjectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		if project == nil || !CanUserWriteGitOpsProject(userID, body.ProjectID) {
			writeAPIError(w, r, http.StatusForbidden, "write access is required for this project", nil)
			return
		}

		component := normalizeGitOpsComponentName(body.Component)
		nextComponents := append([]string{}, project.Components...)
		exists := false
		for _, current := range nextComponents {
			if current == component {
				exists = true
				break
			}
		}
		if !exists {
			nextComponents = append(nextComponents, component)
		}

		updatedProject, err := UpdateGitOpsCatalogProject(project.ID, project.TeamID, project.Name, project.Slug, project.Environments, nextComponents, project.DefaultCloud)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}

		syncResult := syncGitOpsProjectStructureToGit(*updatedProject, []string{component}, "add-json")

		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status":    "ok",
			"project":   updatedProject,
			"component": component,
			"sync":      syncResult,
		})
		return

	case "PUT":
		var body struct {
			ProjectID   int    `json:"project_id"`
			Environment string `json:"environment"`
			Component   string `json:"component"`
			Content     string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", nil)
			return
		}
		if body.ProjectID <= 0 || strings.TrimSpace(body.Environment) == "" || strings.TrimSpace(body.Component) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "project_id, environment, and component are required", nil)
			return
		}
		if !json.Valid([]byte(body.Content)) {
			writeAPIError(w, r, http.StatusBadRequest, "file content must be valid json", nil)
			return
		}

		project, err := findVisibleGitOpsProject(userID, body.ProjectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		if project == nil || !CanUserWriteGitOpsProject(userID, body.ProjectID) {
			writeAPIError(w, r, http.StatusForbidden, "write access is required for this project", nil)
			return
		}

		environment := normalizeGitOpsComponentName(body.Environment)
		component := normalizeGitOpsComponentName(body.Component)
		path := BuildGitOpsManagedManifestPath(project.RepoRoot, environment, component)
		branchName, err := buildGitOpsSyncBranch(*project, fmt.Sprintf("edit-%s-%s", environment, component))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}

		title := fmt.Sprintf("Project-Infra: update %s/%s/%s.json", project.Name, environment, component)
		bodyText := fmt.Sprintf(
			"Auto-generated Project-Infra file update from DevOps Portal\n\n**Project:** %s\n**Environment:** %s\n**File:** %s",
			project.Name,
			environment,
			path,
		)
		prURL, err := CreateGitHubPRWithFiles(branchName, map[string][]byte{path: []byte(body.Content)}, title, bodyText)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status": "ok",
			"sync": GitOpsSyncResult{
				OK:     true,
				PRURL:  prURL,
				Branch: branchName,
				Files:  []string{path},
			},
		})
		return
	default:
		writeMethodNotAllowed(w, r)
	}
}
