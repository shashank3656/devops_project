package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type GitOpsCatalogProject struct {
	ID           int                      `json:"id"`
	TeamID       int                      `json:"team_id"`
	TeamName     string                   `json:"team_name"`
	TeamSlug     string                   `json:"team_slug"`
	GroupID      string                   `json:"group_id"`
	Name         string                   `json:"name"`
	Slug         string                   `json:"slug"`
	RepoRoot     string                   `json:"repo_root"`
	BaseBranch   string                   `json:"base_branch"`
	DefaultCloud string                   `json:"default_cloud"`
	Environments []string                 `json:"environments"`
	Components   []string                 `json:"components"`
	CreatedAt    time.Time                `json:"created_at"`
	CreatedBy    *int                     `json:"created_by"`
	Access       []GitOpsProjectAccessRow `json:"access,omitempty"`
}

type GitOpsProjectAccessRow struct {
	ID          int       `json:"id"`
	ProjectID   int       `json:"project_id"`
	UserID      int       `json:"user_id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	Environment string    `json:"environment"`
	CreatedAt   time.Time `json:"created_at"`
}

func normalizeGitOpsProjectSlug(value string) string {
	value = normalizeGitOpsComponentName(value)
	if value == "" || value == "infrastructure" {
		return "project"
	}
	return value
}

func normalizeGitOpsEnvironmentList(values []string) []string {
	if len(values) == 0 {
		values = []string{"dev", "qa", "prod"}
	}
	seen := make(map[string]bool)
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := normalizeGitOpsComponentName(value)
		if normalized == "" || normalized == "infrastructure" {
			continue
		}
		if !seen[normalized] {
			seen[normalized] = true
			out = append(out, normalized)
		}
	}
	if len(out) == 0 {
		out = []string{"dev", "qa", "prod"}
	}
	sort.Slice(out, func(i, j int) bool {
		leftOrder := gitOpsEnvironmentOrder(out[i])
		rightOrder := gitOpsEnvironmentOrder(out[j])
		if leftOrder == rightOrder {
			return out[i] < out[j]
		}
		return leftOrder < rightOrder
	})
	return out
}

func normalizeGitOpsComponentList(values []string) []string {
	if len(values) == 0 {
		values = []string{"networking", "eks", "rds"}
	}
	seen := make(map[string]bool)
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := normalizeGitOpsComponentName(value)
		if normalized == "" {
			continue
		}
		if !seen[normalized] {
			seen[normalized] = true
			out = append(out, normalized)
		}
	}
	if len(out) == 0 {
		out = []string{"networking", "eks", "rds"}
	}
	sort.Strings(out)
	return out
}

func BuildGitOpsManagedProjectRoot(teamNameOrSlug, projectSlug string) string {
	return fmt.Sprintf("projects/%s/%s", ResolveTeamPathKey(teamNameOrSlug), normalizeGitOpsProjectSlug(projectSlug))
}

func BuildGitOpsManagedEnvironmentFolder(projectRoot, env string) string {
	return fmt.Sprintf("%s/%s", projectRoot, normalizeGitOpsComponentName(env))
}

func BuildGitOpsManagedManifestPath(projectRoot, env, component string) string {
	return fmt.Sprintf("%s/%s.json", BuildGitOpsManagedEnvironmentFolder(projectRoot, env), normalizeGitOpsComponentName(component))
}

func marshalStringSliceJSON(values []string) string {
	normalized := make([]string, len(values))
	copy(normalized, values)
	bytes, err := json.Marshal(normalized)
	if err != nil {
		return "[]"
	}
	return string(bytes)
}

func unmarshalStringSliceJSON(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}

func queryAllGitOpsCatalogProjects() ([]GitOpsCatalogProject, error) {
	rows, err := DB.Query(`
		SELECT p.id, p.team_id, t.name, t.slug, COALESCE(t.application_id,''), p.name, p.slug, p.repo_root,
		       COALESCE(p.base_branch, ''), COALESCE(p.default_cloud, ''), p.environments, p.components,
		       p.created_at, p.created_by
		FROM gitops_projects p
		INNER JOIN teams t ON t.id = p.team_id
		WHERE COALESCE(t.team_type, 'portal') = 'devops'
		ORDER BY t.name, p.name
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []GitOpsCatalogProject{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	out := []GitOpsCatalogProject{}
	for rows.Next() {
		var project GitOpsCatalogProject
		var environmentsRaw []byte
		var componentsRaw []byte
		var createdBy sql.NullInt64
		if err := rows.Scan(
			&project.ID,
			&project.TeamID,
			&project.TeamName,
			&project.TeamSlug,
			&project.GroupID,
			&project.Name,
			&project.Slug,
			&project.RepoRoot,
			&project.BaseBranch,
			&project.DefaultCloud,
			&environmentsRaw,
			&componentsRaw,
			&project.CreatedAt,
			&createdBy,
		); err != nil {
			return nil, err
		}
		project.Environments = normalizeGitOpsEnvironmentList(unmarshalStringSliceJSON(environmentsRaw))
		project.Components = normalizeGitOpsComponentList(unmarshalStringSliceJSON(componentsRaw))
		if createdBy.Valid && createdBy.Int64 > 0 {
			value := int(createdBy.Int64)
			project.CreatedBy = &value
		}
		out = append(out, project)
	}
	return out, nil
}

func loadGitOpsProjectAccess(projectIDs map[int]bool) (map[int][]GitOpsProjectAccessRow, error) {
	rows, err := DB.Query(`
		SELECT a.id, a.project_id, a.user_id, COALESCE(u.username, ''), COALESCE(u.email, ''), a.environment, a.created_at
		FROM gitops_project_access a
		INNER JOIN users u ON u.id = a.user_id
		ORDER BY a.created_at DESC
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return map[int][]GitOpsProjectAccessRow{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	out := make(map[int][]GitOpsProjectAccessRow)
	for rows.Next() {
		var access GitOpsProjectAccessRow
		if err := rows.Scan(&access.ID, &access.ProjectID, &access.UserID, &access.Username, &access.Email, &access.Environment, &access.CreatedAt); err != nil {
			return nil, err
		}
		if len(projectIDs) > 0 && !projectIDs[access.ProjectID] {
			continue
		}
		access.Environment = normalizeGitOpsComponentName(access.Environment)
		out[access.ProjectID] = append(out[access.ProjectID], access)
	}
	return out, nil
}

func listManagerGitOpsProjects(userID int) ([]GitOpsCatalogProject, error) {
	teams, err := GetDevopsTeamsForUser(userID)
	if err != nil {
		return nil, err
	}
	allowedTeams := make(map[int]bool, len(teams))
	for _, team := range teams {
		allowedTeams[team.ID] = true
	}
	allProjects, err := queryAllGitOpsCatalogProjects()
	if err != nil {
		return nil, err
	}
	filtered := make([]GitOpsCatalogProject, 0, len(allProjects))
	projectIDs := make(map[int]bool)
	for _, project := range allProjects {
		if allowedTeams[project.TeamID] {
			filtered = append(filtered, project)
			projectIDs[project.ID] = true
		}
	}
	accessMap, err := loadGitOpsProjectAccess(projectIDs)
	if err != nil {
		return nil, err
	}
	for index := range filtered {
		filtered[index].Access = accessMap[filtered[index].ID]
	}
	return filtered, nil
}

func listVisibleGitOpsProjectsForUser(userID int) ([]GitOpsCatalogProject, error) {
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return nil, err
	}
	if user.Role == "admin" {
		return listAllGitOpsProjects(), nil
	}
	profile, _ := GetDevopsProfile(userID)
	if profile != nil && profile.IsManager {
		return listManagerGitOpsProjects(userID)
	}

	allProjects, err := queryAllGitOpsCatalogProjects()
	if err != nil {
		return nil, err
	}
	projectIDs := make(map[int]bool, len(allProjects))
	for _, project := range allProjects {
		projectIDs[project.ID] = true
	}
	accessMap, err := loadGitOpsProjectAccess(projectIDs)
	if err != nil {
		return nil, err
	}

	filtered := make([]GitOpsCatalogProject, 0, len(allProjects))
	for _, project := range allProjects {
		projectAccess := accessMap[project.ID]
		envAllowed := make(map[string]bool)
		filteredAccess := make([]GitOpsProjectAccessRow, 0)
		for _, access := range projectAccess {
			if access.UserID != userID {
				continue
			}
			envAllowed[access.Environment] = true
			filteredAccess = append(filteredAccess, access)
		}
		if len(envAllowed) == 0 {
			continue
		}
		visibleEnvironments := make([]string, 0, len(project.Environments))
		for _, environment := range project.Environments {
			if envAllowed[environment] {
				visibleEnvironments = append(visibleEnvironments, environment)
			}
		}
		if len(visibleEnvironments) == 0 {
			continue
		}
		project.Environments = visibleEnvironments
		project.Access = filteredAccess
		filtered = append(filtered, project)
	}
	return filtered, nil
}

func listAllGitOpsProjects() []GitOpsCatalogProject {
	allProjects, err := queryAllGitOpsCatalogProjects()
	if err != nil {
		return []GitOpsCatalogProject{}
	}
	projectIDs := make(map[int]bool, len(allProjects))
	for _, project := range allProjects {
		projectIDs[project.ID] = true
	}
	accessMap, err := loadGitOpsProjectAccess(projectIDs)
	if err != nil {
		return allProjects
	}
	for index := range allProjects {
		allProjects[index].Access = accessMap[allProjects[index].ID]
	}
	return allProjects
}

func GetGitOpsProjectVisibleToUser(userID, projectID int) (*GitOpsCatalogProject, bool, error) {
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return nil, false, err
	}
	isManager := false
	if user.Role == "admin" {
		isManager = true
	} else if profile, _ := GetDevopsProfile(userID); profile != nil && profile.IsManager {
		isManager = true
	}
	projects, err := listVisibleGitOpsProjectsForUser(userID)
	if err != nil {
		return nil, false, err
	}
	for _, project := range projects {
		if project.ID == projectID {
			projectCopy := project
			return &projectCopy, isManager, nil
		}
	}
	return nil, isManager, nil
}

func CreateGitOpsCatalogProject(teamID int, name, slug string, environments, components []string, defaultCloud string, createdBy int) (*GitOpsCatalogProject, error) {
	team, err := GetTeamByID(teamID)
	if err != nil {
		return nil, err
	}
	if team == nil || team.TeamType != "devops" {
		return nil, fmt.Errorf("invalid devops team")
	}
	projectSlug := normalizeGitOpsProjectSlug(slug)
	if strings.TrimSpace(slug) == "" {
		projectSlug = normalizeGitOpsProjectSlug(name)
	}
	normalizedEnvironments := normalizeGitOpsEnvironmentList(environments)
	normalizedComponents := normalizeGitOpsComponentList(components)
	repoRoot := BuildGitOpsManagedProjectRoot(team.Name, projectSlug)

	var project GitOpsCatalogProject
	var environmentsRaw []byte
	var componentsRaw []byte
	var createdByValue sql.NullInt64
	err = DB.QueryRow(`
		INSERT INTO gitops_projects (team_id, name, slug, repo_root, base_branch, default_cloud, environments, components, created_by)
		VALUES ($1, $2, $3, $4, $5, NULLIF(TRIM($6), ''), $7::jsonb, $8::jsonb, $9)
		RETURNING id, team_id, name, slug, repo_root, base_branch, COALESCE(default_cloud, ''), environments, components, created_at, created_by
	`,
		teamID,
		strings.TrimSpace(name),
		projectSlug,
		repoRoot,
		BaseBranch,
		defaultCloud,
		marshalStringSliceJSON(normalizedEnvironments),
		marshalStringSliceJSON(normalizedComponents),
		createdBy,
	).Scan(
		&project.ID,
		&project.TeamID,
		&project.Name,
		&project.Slug,
		&project.RepoRoot,
		&project.BaseBranch,
		&project.DefaultCloud,
		&environmentsRaw,
		&componentsRaw,
		&project.CreatedAt,
		&createdByValue,
	)
	if err != nil {
		return nil, err
	}
	project.Environments = normalizeGitOpsEnvironmentList(unmarshalStringSliceJSON(environmentsRaw))
	project.Components = normalizeGitOpsComponentList(unmarshalStringSliceJSON(componentsRaw))
	project.TeamName = team.Name
	project.TeamSlug = team.Slug
	project.GroupID = team.ApplicationID
	if createdByValue.Valid && createdByValue.Int64 > 0 {
		value := int(createdByValue.Int64)
		project.CreatedBy = &value
	}
	return &project, nil
}

func GrantGitOpsProjectAccess(projectID, targetUserID, createdBy int, environments []string) error {
	normalizedEnvironments := normalizeGitOpsEnvironmentList(environments)
	for _, environment := range normalizedEnvironments {
		if _, err := DB.Exec(`
			INSERT INTO gitops_project_access (project_id, user_id, environment, created_by)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (project_id, user_id, environment) DO NOTHING
		`, projectID, targetUserID, environment, createdBy); err != nil {
			return err
		}
	}
	return nil
}

func DeleteGitOpsProjectAccess(accessID int) error {
	_, err := DB.Exec(`DELETE FROM gitops_project_access WHERE id = $1`, accessID)
	return err
}

func GetGitOpsProjectAccessByID(accessID int) (*GitOpsProjectAccessRow, error) {
	var access GitOpsProjectAccessRow
	err := DB.QueryRow(`
		SELECT a.id, a.project_id, a.user_id, COALESCE(u.username, ''), COALESCE(u.email, ''), a.environment, a.created_at
		FROM gitops_project_access a
		INNER JOIN users u ON u.id = a.user_id
		WHERE a.id = $1
	`, accessID).Scan(&access.ID, &access.ProjectID, &access.UserID, &access.Username, &access.Email, &access.Environment, &access.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	access.Environment = normalizeGitOpsComponentName(access.Environment)
	return &access, nil
}
