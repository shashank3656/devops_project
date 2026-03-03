package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ProjectServiceOption struct {
	Cloud   string `json:"cloud"`
	Service string `json:"service"`
}

type ProjectSummary struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Code   string `json:"code"`
	Status string `json:"status,omitempty"`
}

type ProjectApprovalRule struct {
	Environment            string `json:"environment"`
	RequireManagerApproval bool   `json:"require_manager_approval"`
	RequireDevopsApproval  bool   `json:"require_devops_approval"`
}

type ProjectTeamAccess struct {
	TeamID       int      `json:"team_id"`
	TeamName     string   `json:"team_name,omitempty"`
	TeamSlug     string   `json:"team_slug,omitempty"`
	Environments []string `json:"environments"`
}

type ProjectCatalog struct {
	ID            int                    `json:"id"`
	Name          string                 `json:"name"`
	Code          string                 `json:"code"`
	Description   string                 `json:"description"`
	Status        string                 `json:"status"`
	OwnerTeamID   *int                   `json:"owner_team_id,omitempty"`
	OwnerTeam     string                 `json:"owner_team,omitempty"`
	CreatedBy     *int                   `json:"created_by,omitempty"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	Environments  []string               `json:"environments"`
	Clouds        []string               `json:"clouds"`
	Services      []ProjectServiceOption `json:"services"`
	TeamAccess    []ProjectTeamAccess    `json:"team_access"`
	ApprovalRules []ProjectApprovalRule  `json:"approval_rules"`
}

type ProjectCatalogInput struct {
	Name          string                 `json:"name"`
	Code          string                 `json:"code"`
	Description   string                 `json:"description"`
	Status        string                 `json:"status"`
	OwnerTeamID   *int                   `json:"owner_team_id"`
	Environments  []string               `json:"environments"`
	Clouds        []string               `json:"clouds"`
	Services      []ProjectServiceOption `json:"services"`
	TeamAccess    []ProjectTeamAccess    `json:"team_access"`
	ApprovalRules []ProjectApprovalRule  `json:"approval_rules"`
}

type ProjectRequestValidation struct {
	Project ProjectCatalog
	Team    Team
}

func normalizeProjectCode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteRune('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "project"
	}
	return out
}

func uniqueSortedStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	var out []string
	for _, item := range items {
		trimmed := strings.TrimSpace(strings.ToLower(item))
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	sort.Strings(out)
	return out
}

func uniqueSortedServices(items []ProjectServiceOption) []ProjectServiceOption {
	seen := map[string]struct{}{}
	var out []ProjectServiceOption
	for _, item := range items {
		cloud := strings.TrimSpace(strings.ToLower(item.Cloud))
		service := strings.TrimSpace(strings.ToLower(item.Service))
		if cloud == "" || service == "" {
			continue
		}
		key := cloud + "::" + service
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, ProjectServiceOption{Cloud: cloud, Service: service})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Cloud == out[j].Cloud {
			return out[i].Service < out[j].Service
		}
		return out[i].Cloud < out[j].Cloud
	})
	return out
}

func defaultProjectApprovalRule(environment string) ProjectApprovalRule {
	environment = strings.TrimSpace(strings.ToLower(environment))
	return ProjectApprovalRule{
		Environment:            environment,
		RequireManagerApproval: environment != "dev",
		RequireDevopsApproval:  true,
	}
}

func normalizeProjectApprovalRules(environments []string, rules []ProjectApprovalRule) ([]ProjectApprovalRule, error) {
	allowed := make(map[string]struct{}, len(environments))
	for _, env := range environments {
		allowed[env] = struct{}{}
	}

	normalizedByEnv := make(map[string]ProjectApprovalRule, len(environments))
	for _, rule := range rules {
		env := strings.TrimSpace(strings.ToLower(rule.Environment))
		if env == "" {
			continue
		}
		if _, ok := allowed[env]; !ok {
			return nil, fmt.Errorf("approval rule includes unsupported environment %s", env)
		}
		normalizedByEnv[env] = ProjectApprovalRule{
			Environment:            env,
			RequireManagerApproval: rule.RequireManagerApproval,
			RequireDevopsApproval:  rule.RequireDevopsApproval,
		}
	}

	out := make([]ProjectApprovalRule, 0, len(environments))
	for _, env := range environments {
		rule, ok := normalizedByEnv[env]
		if !ok {
			rule = defaultProjectApprovalRule(env)
		}
		out = append(out, rule)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Environment < out[j].Environment
	})
	return out, nil
}

func sanitizeProjectInput(input ProjectCatalogInput) (ProjectCatalogInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Code = normalizeProjectCode(input.Code)
	if input.Code == "" {
		input.Code = normalizeProjectCode(input.Name)
	}
	input.Description = strings.TrimSpace(input.Description)
	input.Status = strings.ToLower(strings.TrimSpace(input.Status))
	if input.Status == "" {
		input.Status = "active"
	}
	if input.Status != "active" && input.Status != "archived" && input.Status != "inactive" {
		return input, fmt.Errorf("status must be active, inactive, or archived")
	}
	input.Environments = uniqueSortedStrings(input.Environments)
	input.Clouds = uniqueSortedStrings(input.Clouds)
	input.Services = uniqueSortedServices(input.Services)
	if input.Name == "" {
		return input, fmt.Errorf("project name is required")
	}
	if input.Code == "" {
		return input, fmt.Errorf("project code is required")
	}
	if len(input.Environments) == 0 {
		return input, fmt.Errorf("at least one environment is required")
	}
	if len(input.Clouds) == 0 {
		return input, fmt.Errorf("at least one cloud is required")
	}
	if len(input.Services) == 0 {
		return input, fmt.Errorf("at least one project service is required")
	}
	if len(input.TeamAccess) == 0 {
		return input, fmt.Errorf("at least one team access mapping is required")
	}
	approvalRules, err := normalizeProjectApprovalRules(input.Environments, input.ApprovalRules)
	if err != nil {
		return input, err
	}
	input.ApprovalRules = approvalRules

	allowedEnvs := make(map[string]struct{}, len(input.Environments))
	for _, env := range input.Environments {
		allowedEnvs[env] = struct{}{}
	}
	allowedClouds := make(map[string]struct{}, len(input.Clouds))
	for _, cloud := range input.Clouds {
		allowedClouds[cloud] = struct{}{}
	}
	for _, service := range input.Services {
		if _, ok := allowedClouds[service.Cloud]; !ok {
			return input, fmt.Errorf("service %s uses unsupported cloud %s", service.Service, service.Cloud)
		}
	}

	seenTeams := make(map[int]struct{}, len(input.TeamAccess))
	for index := range input.TeamAccess {
		access := &input.TeamAccess[index]
		if access.TeamID <= 0 {
			return input, fmt.Errorf("team access requires a valid team")
		}
		if _, exists := seenTeams[access.TeamID]; exists {
			return input, fmt.Errorf("duplicate team access mapping for team %d", access.TeamID)
		}
		seenTeams[access.TeamID] = struct{}{}
		envs := uniqueSortedStrings(access.Environments)
		if len(envs) == 0 {
			envs = append(envs, input.Environments...)
		}
		for _, env := range envs {
			if _, ok := allowedEnvs[env]; !ok {
				return input, fmt.Errorf("team access includes unsupported environment %s", env)
			}
		}
		access.Environments = envs
	}

	return input, nil
}

func parseProjectIDFromPayload(payload InfraRequest) int {
	raw, ok := payload["project_id"]
	if !ok || raw == nil {
		return 0
	}
	switch value := raw.(type) {
	case float64:
		return int(value)
	case int:
		return value
	case string:
		id, _ := strconv.Atoi(strings.TrimSpace(value))
		return id
	default:
		return 0
	}
}

func intPointerIfPositive(value int) *int {
	if value > 0 {
		result := value
		return &result
	}
	return nil
}

func getPortalTeams() ([]Team, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, name, slug, COALESCE(application_id,''), COALESCE(team_type,'portal'), COALESCE(default_env,''), COALESCE(default_cloud,''), created_at, created_by
		FROM teams
		WHERE COALESCE(team_type, 'portal') = 'portal'
		ORDER BY name
	`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	var out []Team
	for rows.Next() {
		var team Team
		if err := rows.Scan(&team.ID, &team.Name, &team.Slug, &team.ApplicationID, &team.TeamType, &team.DefaultEnv, &team.DefaultCloud, &team.CreatedAt, &team.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, team)
	}
	return out, nil
}

func createProjectCatalog(input ProjectCatalogInput, createdBy *int) (*ProjectCatalog, error) {
	input, err := sanitizeProjectInput(input)
	if err != nil {
		return nil, err
	}
	ctx, cancel := dbTimeoutContext()
	defer cancel()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var projectID int
	if err := tx.QueryRowContext(
		ctx,
		`INSERT INTO projects (name, code, description, status, owner_team_id, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		input.Name, input.Code, input.Description, input.Status, input.OwnerTeamID, createdBy,
	).Scan(&projectID); err != nil {
		return nil, err
	}
	if err := syncProjectCatalogTx(ctx, tx, projectID, input); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	return getProjectCatalogByID(projectID)
}

func updateProjectCatalog(projectID int, input ProjectCatalogInput) (*ProjectCatalog, error) {
	input, err := sanitizeProjectInput(input)
	if err != nil {
		return nil, err
	}
	ctx, cancel := dbTimeoutContext()
	defer cancel()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(
		ctx,
		`UPDATE projects
		 SET name = $1, code = $2, description = $3, status = $4, owner_team_id = $5, updated_at = CURRENT_TIMESTAMP
		 WHERE id = $6`,
		input.Name, input.Code, input.Description, input.Status, input.OwnerTeamID, projectID,
	)
	if err != nil {
		return nil, err
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return nil, fmt.Errorf("project not found")
	}
	if err := syncProjectCatalogTx(ctx, tx, projectID, input); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	return getProjectCatalogByID(projectID)
}

func syncProjectCatalogTx(ctx context.Context, tx *sql.Tx, projectID int, input ProjectCatalogInput) error {
	deleteStatements := []string{
		`DELETE FROM project_approval_rules WHERE project_id = $1`,
		`DELETE FROM project_team_environment_access WHERE project_id = $1`,
		`DELETE FROM project_team_access WHERE project_id = $1`,
		`DELETE FROM project_services WHERE project_id = $1`,
		`DELETE FROM project_clouds WHERE project_id = $1`,
		`DELETE FROM project_environments WHERE project_id = $1`,
	}
	for _, statement := range deleteStatements {
		if _, err := tx.ExecContext(ctx, statement, projectID); err != nil {
			return err
		}
	}
	for _, env := range input.Environments {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_environments (project_id, environment) VALUES ($1, $2)`, projectID, env); err != nil {
			return err
		}
	}
	for _, cloud := range input.Clouds {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_clouds (project_id, cloud) VALUES ($1, $2)`, projectID, cloud); err != nil {
			return err
		}
	}
	for _, service := range input.Services {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_services (project_id, cloud, service) VALUES ($1, $2, $3)`, projectID, service.Cloud, service.Service); err != nil {
			return err
		}
	}
	for _, rule := range input.ApprovalRules {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO project_approval_rules (project_id, environment, require_manager_approval, require_devops_approval)
			 VALUES ($1, $2, $3, $4)`,
			projectID,
			rule.Environment,
			rule.RequireManagerApproval,
			rule.RequireDevopsApproval,
		); err != nil {
			return err
		}
	}
	for _, access := range input.TeamAccess {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_team_access (project_id, team_id) VALUES ($1, $2)`, projectID, access.TeamID); err != nil {
			return err
		}
		for _, env := range access.Environments {
			if _, err := tx.ExecContext(ctx, `INSERT INTO project_team_environment_access (project_id, team_id, environment) VALUES ($1, $2, $3)`, projectID, access.TeamID, env); err != nil {
				return err
			}
		}
	}
	return nil
}

func getProjectCatalogByID(projectID int) (*ProjectCatalog, error) {
	projects, err := getProjectCatalogsByFilter("WHERE p.id = $1", projectID)
	if err != nil {
		return nil, err
	}
	if len(projects) == 0 {
		return nil, nil
	}
	return &projects[0], nil
}

func listProjectCatalogs() ([]ProjectCatalog, error) {
	return getProjectCatalogsByFilter("")
}

func getProjectCatalogsByFilter(whereClause string, args ...interface{}) ([]ProjectCatalog, error) {
	query := `
		SELECT p.id, p.name, p.code, COALESCE(p.description,''), COALESCE(p.status,'active'),
		       p.owner_team_id, COALESCE(owner_team.name,''), p.created_by, p.created_at, p.updated_at
		FROM projects p
		LEFT JOIN teams owner_team ON owner_team.id = p.owner_team_id
	`
	if whereClause != "" {
		query += " " + whereClause
	}
	query += " ORDER BY p.name"

	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []ProjectCatalog{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	projectsByID := map[int]*ProjectCatalog{}
	var projectIDs []int
	for rows.Next() {
		var project ProjectCatalog
		var ownerTeamID sql.NullInt64
		var createdBy sql.NullInt64
		if err := rows.Scan(
			&project.ID, &project.Name, &project.Code, &project.Description, &project.Status,
			&ownerTeamID, &project.OwnerTeam, &createdBy, &project.CreatedAt, &project.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if ownerTeamID.Valid {
			value := int(ownerTeamID.Int64)
			project.OwnerTeamID = &value
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			project.CreatedBy = &value
		}
		project.Environments = []string{}
		project.Clouds = []string{}
		project.Services = []ProjectServiceOption{}
		project.TeamAccess = []ProjectTeamAccess{}
		project.ApprovalRules = []ProjectApprovalRule{}
		projectsByID[project.ID] = &project
		projectIDs = append(projectIDs, project.ID)
	}
	if len(projectIDs) == 0 {
		return []ProjectCatalog{}, nil
	}

	placeholders := make([]string, len(projectIDs))
	queryArgs := make([]interface{}, 0, len(projectIDs))
	for index, id := range projectIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		queryArgs = append(queryArgs, id)
	}
	inClause := strings.Join(placeholders, ",")

	loadSimpleRows := func(query string, apply func(projectID int, value1 string, value2 string)) error {
		rows, cancel, err := queryRowsWithTimeout(query, queryArgs...)
		if err != nil {
			return err
		}
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var projectID int
			var value1 string
			var value2 string
			if err := rows.Scan(&projectID, &value1, &value2); err != nil {
				return err
			}
			apply(projectID, value1, value2)
		}
		return nil
	}

	if err := loadSimpleRows(
		fmt.Sprintf(`SELECT project_id, environment, '' FROM project_environments WHERE project_id IN (%s) ORDER BY environment`, inClause),
		func(projectID int, value1 string, _ string) {
			if project := projectsByID[projectID]; project != nil {
				project.Environments = append(project.Environments, value1)
			}
		},
	); err != nil && !strings.Contains(err.Error(), "does not exist") {
		return nil, err
	}

	if err := loadSimpleRows(
		fmt.Sprintf(`SELECT project_id, cloud, '' FROM project_clouds WHERE project_id IN (%s) ORDER BY cloud`, inClause),
		func(projectID int, value1 string, _ string) {
			if project := projectsByID[projectID]; project != nil {
				project.Clouds = append(project.Clouds, value1)
			}
		},
	); err != nil && !strings.Contains(err.Error(), "does not exist") {
		return nil, err
	}

	if err := loadSimpleRows(
		fmt.Sprintf(`SELECT project_id, cloud, service FROM project_services WHERE project_id IN (%s) ORDER BY cloud, service`, inClause),
		func(projectID int, value1 string, value2 string) {
			if project := projectsByID[projectID]; project != nil {
				project.Services = append(project.Services, ProjectServiceOption{Cloud: value1, Service: value2})
			}
		},
	); err != nil && !strings.Contains(err.Error(), "does not exist") {
		return nil, err
	}

	if err := loadSimpleRows(
		fmt.Sprintf(`
			SELECT project_id, environment,
			       CASE WHEN require_manager_approval THEN 'true' ELSE 'false' END || '|' ||
			       CASE WHEN require_devops_approval THEN 'true' ELSE 'false' END
			FROM project_approval_rules
			WHERE project_id IN (%s)
			ORDER BY environment
		`, inClause),
		func(projectID int, value1 string, value2 string) {
			if project := projectsByID[projectID]; project != nil {
				flags := strings.SplitN(value2, "|", 2)
				rule := ProjectApprovalRule{
					Environment:            value1,
					RequireManagerApproval: len(flags) > 0 && flags[0] == "true",
					RequireDevopsApproval:  len(flags) > 1 && flags[1] == "true",
				}
				project.ApprovalRules = append(project.ApprovalRules, rule)
			}
		},
	); err != nil && !strings.Contains(err.Error(), "does not exist") {
		return nil, err
	}

	accessRows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT a.project_id, a.team_id, COALESCE(t.name,''), COALESCE(t.slug,'')
			FROM project_team_access a
			INNER JOIN teams t ON t.id = a.team_id
			WHERE a.project_id IN (%s)
			ORDER BY t.name
		`, inClause),
		queryArgs...,
	)
	if err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return nil, err
		}
	} else {
		defer cancel()
		defer accessRows.Close()
		for accessRows.Next() {
			var projectID int
			var access ProjectTeamAccess
			if err := accessRows.Scan(&projectID, &access.TeamID, &access.TeamName, &access.TeamSlug); err != nil {
				return nil, err
			}
			access.Environments = []string{}
			if project := projectsByID[projectID]; project != nil {
				project.TeamAccess = append(project.TeamAccess, access)
			}
		}
	}

	accessEnvRows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT project_id, team_id, environment
			FROM project_team_environment_access
			WHERE project_id IN (%s)
			ORDER BY team_id, environment
		`, inClause),
		queryArgs...,
	)
	if err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return nil, err
		}
	} else {
		defer cancel()
		defer accessEnvRows.Close()
		for accessEnvRows.Next() {
			var projectID int
			var teamID int
			var environment string
			if err := accessEnvRows.Scan(&projectID, &teamID, &environment); err != nil {
				return nil, err
			}
			if project := projectsByID[projectID]; project != nil {
				for index := range project.TeamAccess {
					if project.TeamAccess[index].TeamID == teamID {
						project.TeamAccess[index].Environments = append(project.TeamAccess[index].Environments, environment)
						break
					}
				}
			}
		}
	}

	var out []ProjectCatalog
	for _, id := range projectIDs {
		out = append(out, *projectsByID[id])
	}
	return out, nil
}

func getVisibleProjectsForUser(userID int) ([]ProjectCatalog, error) {
	userTeams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return nil, err
	}
	if len(userTeams) == 0 {
		return []ProjectCatalog{}, nil
	}
	var teamIDs []int
	teamSet := map[int]struct{}{}
	for _, team := range userTeams {
		if team.TeamType != "portal" {
			continue
		}
		teamIDs = append(teamIDs, team.ID)
		teamSet[team.ID] = struct{}{}
	}
	if len(teamIDs) == 0 {
		return []ProjectCatalog{}, nil
	}
	placeholders := make([]string, len(teamIDs))
	args := make([]interface{}, 0, len(teamIDs))
	for index, teamID := range teamIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		args = append(args, teamID)
	}
	rows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT DISTINCT p.id, '', ''
			FROM projects p
			INNER JOIN project_team_access a ON a.project_id = p.id
			WHERE COALESCE(p.status, 'active') = 'active'
			  AND a.team_id IN (%s)
			ORDER BY p.id
		`, strings.Join(placeholders, ",")),
		args...,
	)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []ProjectCatalog{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	var projectIDs []int
	for rows.Next() {
		var projectID int
		var noop1 string
		var noop2 string
		if err := rows.Scan(&projectID, &noop1, &noop2); err != nil {
			return nil, err
		}
		projectIDs = append(projectIDs, projectID)
	}
	if len(projectIDs) == 0 {
		return []ProjectCatalog{}, nil
	}

	placeholders = make([]string, len(projectIDs))
	args = make([]interface{}, 0, len(projectIDs))
	for index, projectID := range projectIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		args = append(args, projectID)
	}
	projects, err := getProjectCatalogsByFilter(fmt.Sprintf("WHERE p.id IN (%s)", strings.Join(placeholders, ",")), args...)
	if err != nil {
		return nil, err
	}
	for projectIndex := range projects {
		filteredAccess := make([]ProjectTeamAccess, 0, len(projects[projectIndex].TeamAccess))
		for _, access := range projects[projectIndex].TeamAccess {
			if _, ok := teamSet[access.TeamID]; ok {
				filteredAccess = append(filteredAccess, access)
			}
		}
		projects[projectIndex].TeamAccess = filteredAccess
	}
	return projects, nil
}

func getVisibleProjectIDSetForUser(userID int) (map[int]bool, error) {
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		return nil, err
	}
	out := make(map[int]bool, len(projects))
	for _, project := range projects {
		out[project.ID] = true
	}
	return out, nil
}

func findProjectApprovalRule(project *ProjectCatalog, environment string) *ProjectApprovalRule {
	if project == nil {
		return nil
	}
	environment = strings.TrimSpace(strings.ToLower(environment))
	for index := range project.ApprovalRules {
		if project.ApprovalRules[index].Environment == environment {
			return &project.ApprovalRules[index]
		}
	}
	return nil
}

func creatorHasManagerApprovalPath(creatorID int, teamNameOrSlug string) bool {
	if creatorID <= 0 {
		return false
	}
	groupManagerID := GetGroupManagerForUserInTeam(creatorID, teamNameOrSlug)
	if groupManagerID == 0 {
		groupManagerID = GetGroupManagerForUser(creatorID)
	}
	if groupManagerID != 0 {
		return true
	}
	creator, _ := GetUserByID(creatorID)
	return creator != nil && creator.ManagerID != nil && *creator.ManagerID > 0
}

func determineApprovalStatusForRequest(projectID *int, creatorID int, teamNameOrSlug, environment string) string {
	if projectID != nil && *projectID > 0 {
		project, err := getProjectCatalogByID(*projectID)
		if err == nil && project != nil {
			rule := findProjectApprovalRule(project, environment)
			if rule != nil {
				if rule.RequireManagerApproval && creatorHasManagerApprovalPath(creatorID, teamNameOrSlug) {
					return "pending_user_manager_approval"
				}
				if rule.RequireDevopsApproval {
					return "pending_devops_approval"
				}
				return "pending_approval"
			}
		}
	}
	if creatorHasManagerApprovalPath(creatorID, teamNameOrSlug) {
		return "pending_user_manager_approval"
	}
	return "pending_devops_approval"
}

func determinePostManagerApprovalStatus(projectID *int, environment string) string {
	if projectID != nil && *projectID > 0 {
		project, err := getProjectCatalogByID(*projectID)
		if err == nil && project != nil {
			rule := findProjectApprovalRule(project, environment)
			if rule != nil {
				if rule.RequireDevopsApproval {
					return "pending_devops_approval"
				}
				return "pending_approval"
			}
		}
	}
	return "pending_devops_approval"
}

func adminProjectsHandler(w http.ResponseWriter, r *http.Request) {
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "projects": projects})
}

func validateProjectRequestForUser(userID, projectID int, teamNameOrSlug, environment, cloud, service string) (*ProjectRequestValidation, error) {
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil || project.Status != "active" {
		return nil, fmt.Errorf("selected project is not available")
	}

	userTeams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return nil, err
	}
	var selectedTeam *Team
	for index := range userTeams {
		team := userTeams[index]
		if team.TeamType != "portal" {
			continue
		}
		if team.Name == teamNameOrSlug || team.Slug == teamNameOrSlug {
			selectedTeam = &team
			break
		}
	}
	if selectedTeam == nil {
		return nil, fmt.Errorf("you can only request infrastructure for an assigned portal team")
	}

	accessAllowed := false
	envAllowed := false
	for _, access := range project.TeamAccess {
		if access.TeamID != selectedTeam.ID {
			continue
		}
		accessAllowed = true
		for _, allowedEnv := range access.Environments {
			if allowedEnv == strings.ToLower(strings.TrimSpace(environment)) {
				envAllowed = true
				break
			}
		}
		break
	}
	if !accessAllowed {
		return nil, fmt.Errorf("selected team does not have access to this project")
	}
	if !envAllowed {
		return nil, fmt.Errorf("selected environment is not enabled for this project/team combination")
	}

	cloudAllowed := false
	for _, allowedCloud := range project.Clouds {
		if allowedCloud == strings.ToLower(strings.TrimSpace(cloud)) {
			cloudAllowed = true
			break
		}
	}
	if !cloudAllowed {
		return nil, fmt.Errorf("selected cloud is not enabled for this project")
	}

	serviceAllowed := false
	for _, allowedService := range project.Services {
		if allowedService.Cloud == strings.ToLower(strings.TrimSpace(cloud)) && allowedService.Service == strings.ToLower(strings.TrimSpace(service)) {
			serviceAllowed = true
			break
		}
	}
	if !serviceAllowed {
		return nil, fmt.Errorf("selected service is not enabled for this project")
	}

	return &ProjectRequestValidation{Project: *project, Team: *selectedTeam}, nil
}

func meProjectsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "projects": projects})
}

func meProjectDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/projects/")
	projectID, err := strconv.Atoi(strings.TrimSpace(path))
	if err != nil || projectID <= 0 {
		http.NotFound(w, r)
		return
	}
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	for _, project := range projects {
		if project.ID == projectID {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": project})
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	json.NewEncoder(w).Encode(map[string]interface{}{"error": "project not found", "status": "error"})
}

func devopsProjectsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		userID, ok := requireDevopsUser(w, r)
		if !ok {
			return
		}
		profile, _ := GetDevopsProfile(userID)
		if profile == nil || !profile.IsManager {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "DevOps manager access required", "status": "error"})
			return
		}
		projects, err := listProjectCatalogs()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		portalTeams, err := getPortalTeams()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "projects": projects, "portal_teams": portalTeams})
		return
	}
	if r.Method == "POST" {
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		var input ProjectCatalogInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		createdBy := &userID
		project, err := createProjectCatalog(input, createdBy)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": project})
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func devopsProjectDetailHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/projects/")
	projectID, err := strconv.Atoi(strings.TrimSpace(path))
	if err != nil || projectID <= 0 {
		http.NotFound(w, r)
		return
	}
	if r.Method == "GET" {
		if _, ok := requireDevopsUser(w, r); !ok {
			return
		}
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		if project == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "project not found", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": project})
		return
	}
	if r.Method == "PUT" {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var input ProjectCatalogInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		project, err := updateProjectCatalog(projectID, input)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "project": project})
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}
