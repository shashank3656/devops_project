package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type AccessReviewProjectScope struct {
	ProjectID     int      `json:"project_id"`
	ProjectName   string   `json:"project_name"`
	ProjectCode   string   `json:"project_code"`
	ProjectStatus string   `json:"project_status"`
	Environments  []string `json:"environments"`
}

type AccessReviewMembership struct {
	TeamID        int                        `json:"team_id"`
	TeamName      string                     `json:"team_name"`
	TeamSlug      string                     `json:"team_slug"`
	ApplicationID string                     `json:"application_id"`
	TeamType      string                     `json:"team_type"`
	Role          string                     `json:"role"`
	ProjectScopes []AccessReviewProjectScope `json:"project_scopes"`
}

type AccessReviewUser struct {
	ID              int                      `json:"id"`
	Username        string                   `json:"username"`
	Email           string                   `json:"email"`
	Role            string                   `json:"role"`
	Verified        bool                     `json:"verified"`
	UserType        string                   `json:"user_type"`
	IsPortalManager bool                     `json:"is_portal_manager"`
	DevopsProfile   *DevopsProfile           `json:"devops_profile,omitempty"`
	Memberships     []AccessReviewMembership `json:"memberships"`
}

func loadAccessReviewProjectScopes(teamIDs []int) (map[int][]AccessReviewProjectScope, []ProjectSummary, error) {
	result := make(map[int][]AccessReviewProjectScope)
	if len(teamIDs) == 0 {
		return result, []ProjectSummary{}, nil
	}

	placeholders := make([]string, len(teamIDs))
	args := make([]interface{}, 0, len(teamIDs))
	for index, teamID := range teamIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		args = append(args, teamID)
	}
	inClause := strings.Join(placeholders, ",")

	rows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT a.team_id, p.id, COALESCE(p.name, ''), COALESCE(p.code, ''), COALESCE(p.status, 'active')
			FROM project_team_access a
			INNER JOIN projects p ON p.id = a.project_id
			WHERE a.team_id IN (%s)
			ORDER BY p.name
		`, inClause),
		args...,
	)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return result, []ProjectSummary{}, nil
		}
		return nil, nil, err
	}
	defer cancel()
	defer rows.Close()

	scopeIndex := make(map[string]int)
	projectMap := make(map[int]ProjectSummary)
	for rows.Next() {
		var scope AccessReviewProjectScope
		var teamID int
		if err := rows.Scan(&teamID, &scope.ProjectID, &scope.ProjectName, &scope.ProjectCode, &scope.ProjectStatus); err != nil {
			return nil, nil, err
		}
		scope.Environments = []string{}
		result[teamID] = append(result[teamID], scope)
		scopeIndex[fmt.Sprintf("%d:%d", teamID, scope.ProjectID)] = len(result[teamID]) - 1
		projectMap[scope.ProjectID] = ProjectSummary{
			ID:     scope.ProjectID,
			Name:   scope.ProjectName,
			Code:   scope.ProjectCode,
			Status: scope.ProjectStatus,
		}
	}

	envRows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT project_id, team_id, environment
			FROM project_team_environment_access
			WHERE team_id IN (%s)
			ORDER BY project_id, team_id, environment
		`, inClause),
		args...,
	)
	if err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return nil, nil, err
		}
	} else {
		defer cancel()
		defer envRows.Close()
		for envRows.Next() {
			var projectID int
			var teamID int
			var environment string
			if err := envRows.Scan(&projectID, &teamID, &environment); err != nil {
				return nil, nil, err
			}
			key := fmt.Sprintf("%d:%d", teamID, projectID)
			index, ok := scopeIndex[key]
			if !ok {
				continue
			}
			result[teamID][index].Environments = append(result[teamID][index].Environments, environment)
		}
	}

	projects := make([]ProjectSummary, 0, len(projectMap))
	for _, project := range projectMap {
		projects = append(projects, project)
	}
	return result, projects, nil
}

func listAccessReviewUsers() ([]AccessReviewUser, error) {
	if DB == nil {
		return []AccessReviewUser{}, nil
	}
	rows, err := DB.Query(`
		SELECT
			u.id,
			u.username,
			u.email,
			COALESCE(u.role, 'viewer'),
			COALESCE(u.verified, false),
			COALESCE(u.user_type, 'portal_user'),
			COALESCE(u.is_portal_manager, false),
			t.id,
			COALESCE(t.name, ''),
			COALESCE(t.slug, ''),
			COALESCE(t.application_id, ''),
			COALESCE(t.team_type, 'portal'),
			COALESCE(m.role, '')
		FROM users u
		LEFT JOIN team_members m ON m.user_id = u.id
		LEFT JOIN teams t ON t.id = m.team_id
		WHERE u.role != 'admin' OR u.role IS NULL
		ORDER BY u.username, t.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	userIndex := make(map[int]int)
	users := make([]AccessReviewUser, 0)
	teamIDs := make(map[int]struct{})
	for rows.Next() {
		var (
			userID          int
			username        string
			email           string
			role            string
			verified        bool
			userType        string
			isPortalManager bool
			teamID          sql.NullInt64
			teamName        string
			teamSlug        string
			applicationID   string
			teamType        string
			memberRole      string
		)
		if err := rows.Scan(
			&userID,
			&username,
			&email,
			&role,
			&verified,
			&userType,
			&isPortalManager,
			&teamID,
			&teamName,
			&teamSlug,
			&applicationID,
			&teamType,
			&memberRole,
		); err != nil {
			return nil, err
		}
		idx, exists := userIndex[userID]
		if !exists {
			user := AccessReviewUser{
				ID:              userID,
				Username:        username,
				Email:           email,
				Role:            role,
				Verified:        verified,
				UserType:        userType,
				IsPortalManager: isPortalManager,
				Memberships:     []AccessReviewMembership{},
			}
			if userType == "devops_user" {
				if profile, err := GetDevopsProfile(userID); err == nil && profile != nil {
					user.DevopsProfile = profile
				}
			}
			users = append(users, user)
			idx = len(users) - 1
			userIndex[userID] = idx
		}
		if teamID.Valid && teamID.Int64 > 0 {
			users[idx].Memberships = append(users[idx].Memberships, AccessReviewMembership{
				TeamID:        int(teamID.Int64),
				TeamName:      teamName,
				TeamSlug:      teamSlug,
				ApplicationID: applicationID,
				TeamType:      teamType,
				Role:          memberRole,
				ProjectScopes: []AccessReviewProjectScope{},
			})
			teamIDs[int(teamID.Int64)] = struct{}{}
		}
	}
	uniqueTeamIDs := make([]int, 0, len(teamIDs))
	for teamID := range teamIDs {
		uniqueTeamIDs = append(uniqueTeamIDs, teamID)
	}
	projectScopesByTeam, _, err := loadAccessReviewProjectScopes(uniqueTeamIDs)
	if err != nil {
		return nil, err
	}
	for userIndex := range users {
		for membershipIndex := range users[userIndex].Memberships {
			teamID := users[userIndex].Memberships[membershipIndex].TeamID
			scopes := projectScopesByTeam[teamID]
			users[userIndex].Memberships[membershipIndex].ProjectScopes = append([]AccessReviewProjectScope(nil), scopes...)
		}
	}
	return users, nil
}

func adminAccessReviewHandler(w http.ResponseWriter, r *http.Request) {
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
		w.WriteHeader(http.StatusServiceUnavailable)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"}); err != nil {
			log.Printf("access review response encode failed: %v", err)
		}
		return
	}
	users, err := listAccessReviewUsers()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"}); err != nil {
			log.Printf("access review response encode failed: %v", err)
		}
		return
	}

	totalMemberships := 0
	totalProjectScopes := 0
	usersWithoutTeams := 0
	portalManagers := 0
	devopsManagers := 0
	teamIDs := make(map[int]struct{})
	for _, user := range users {
		totalMemberships += len(user.Memberships)
		if len(user.Memberships) == 0 {
			usersWithoutTeams++
		}
		for _, membership := range user.Memberships {
			teamIDs[membership.TeamID] = struct{}{}
			totalProjectScopes += len(membership.ProjectScopes)
		}
		if user.IsPortalManager {
			portalManagers++
		}
		if user.DevopsProfile != nil && user.DevopsProfile.IsManager {
			devopsManagers++
		}
	}
	uniqueTeamIDs := make([]int, 0, len(teamIDs))
	for teamID := range teamIDs {
		uniqueTeamIDs = append(uniqueTeamIDs, teamID)
	}
	_, projects, err := loadAccessReviewProjectScopes(uniqueTeamIDs)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"}); err != nil {
			log.Printf("access review response encode failed: %v", err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"users":    users,
		"projects": projects,
		"summary": map[string]int{
			"total_users":          len(users),
			"total_memberships":    totalMemberships,
			"total_project_scopes": totalProjectScopes,
			"users_without_teams":  usersWithoutTeams,
			"portal_managers":      portalManagers,
			"devops_managers":      devopsManagers,
		},
	}); err != nil {
		log.Printf("access review response encode failed: %v", err)
	}
}
