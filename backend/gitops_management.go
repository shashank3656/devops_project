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
	projects, err := listManagerGitOpsProjects(userID)
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
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	teams, err := GetDevopsTeamsForUser(userID)
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
	projects, err := listManagerGitOpsProjects(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"teams":    teams,
		"users":    users,
		"projects": projects,
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
	userID, ok := requireDevopsManager(w, r)
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
	if !CanUserManageDevopsTeam(userID, body.TeamID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "you can only create project structures inside your managed DevOps teams", "status": "error"})
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
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	var body struct {
		ProjectID    int      `json:"project_id"`
		UserID       int      `json:"user_id"`
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
	if project == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "project not available in your manager scope", "status": "error"})
		return
	}

	if err := GrantGitOpsProjectAccess(project.ID, body.UserID, userID, body.Environments); err != nil {
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
	userID, ok := requireDevopsManager(w, r)
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
	if project == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access rule is outside your manager scope", "status": "error"})
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
