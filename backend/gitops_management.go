package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

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

func devopsGitOpsManagementHandler(w http.ResponseWriter, r *http.Request) {
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

	teams, err := listCreatableGitOpsTeamsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	users, err := getGitOpsAssignableUsers()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	projects, err := listManageableGitOpsProjectsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if len(teams) == 0 && len(projects) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access required", "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":              "ok",
		"can_create_projects": len(teams) > 0,
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		Environments []string `json:"environments"`
		Components   []string `json:"components"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json payload", "status": "error"})
		return
	}
	if body.TeamID <= 0 || strings.TrimSpace(body.Name) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team_id and name are required", "status": "error"})
		return
	}
	if !CanUserCreateGitOpsProjectInTeam(userID, body.TeamID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access is required to create a project in this team", "status": "error"})
		return
	}

	project, err := CreateGitOpsCatalogProject(body.TeamID, body.Name, body.Slug, body.Environments, body.Components, body.DefaultCloud, userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": project})
}

func devopsGitOpsProjectUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "PUT" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	projectID, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/devops/gitops/manage/projects/")))
	if projectID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "project id is required", "status": "error"})
		return
	}

	project, err := findManagedGitOpsProject(userID, projectID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, projectID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access is required for this project", "status": "error"})
		return
	}

	var body struct {
		TeamID       int      `json:"team_id"`
		Name         string   `json:"name"`
		Slug         string   `json:"slug"`
		DefaultCloud string   `json:"default_cloud"`
		Environments []string `json:"environments"`
		Components   []string `json:"components"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json payload", "status": "error"})
		return
	}
	if body.TeamID <= 0 || strings.TrimSpace(body.Name) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team_id and name are required", "status": "error"})
		return
	}
	if !CanUserCreateGitOpsProjectInTeam(userID, body.TeamID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access is required to update a project in this team", "status": "error"})
		return
	}

	updatedProject, err := UpdateGitOpsCatalogProject(projectID, body.TeamID, body.Name, body.Slug, body.Environments, body.Components, body.DefaultCloud)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": updatedProject})
}

func devopsGitOpsAccessCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json payload", "status": "error"})
		return
	}
	if body.ProjectID <= 0 || body.UserID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "project_id and user_id are required", "status": "error"})
		return
	}

	project, err := findManagedGitOpsProject(userID, body.ProjectID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, body.ProjectID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access is required for this project", "status": "error"})
		return
	}

	if err := GrantGitOpsProjectAccess(project.ID, body.UserID, userID, body.Environments, body.Permission); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func devopsGitOpsAccessDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "DELETE" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	accessID, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/devops/gitops/manage/access/")))
	if accessID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access id is required", "status": "error"})
		return
	}

	access, err := GetGitOpsProjectAccessByID(accessID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if access == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access rule not found", "status": "error"})
		return
	}

	project, err := findManagedGitOpsProject(userID, access.ProjectID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if project == nil || !CanUserManageGitOpsProject(userID, access.ProjectID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "GitOps admin access is required for this project", "status": "error"})
		return
	}

	if err := DeleteGitOpsProjectAccess(accessID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}
