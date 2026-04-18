package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
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

type ProjectReadinessCheck struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Complete bool   `json:"complete"`
	Detail   string `json:"detail"`
}

type ProjectLifecycleAction struct {
	Action      string `json:"action"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

type ProjectTeamAccess struct {
	TeamID       int      `json:"team_id"`
	TeamName     string   `json:"team_name,omitempty"`
	TeamSlug     string   `json:"team_slug,omitempty"`
	Environments []string `json:"environments"`
}

type ProjectCatalog struct {
	ID                    int                      `json:"id"`
	Name                  string                   `json:"name"`
	Code                  string                   `json:"code"`
	Description           string                   `json:"description"`
	Status                string                   `json:"status"`
	OnboardingStage       string                   `json:"onboarding_stage"`
	ReadyForRequests      bool                     `json:"ready_for_requests"`
	ServiceCount          int                      `json:"service_count"`
	TeamCount             int                      `json:"team_count"`
	RequestCount          int                      `json:"request_count"`
	PendingRequestCount   int                      `json:"pending_request_count"`
	CompletedRequestCount int                      `json:"completed_request_count"`
	NextAction            string                   `json:"next_action"`
	ReadinessChecks       []ProjectReadinessCheck  `json:"readiness_checks"`
	LifecycleActions      []ProjectLifecycleAction `json:"lifecycle_actions"`
	OwnerTeamID           *int                     `json:"owner_team_id,omitempty"`
	OwnerTeam             string                   `json:"owner_team,omitempty"`
	CreatedBy             *int                     `json:"created_by,omitempty"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
	Environments          []string                 `json:"environments"`
	Clouds                []string                 `json:"clouds"`
	Services              []ProjectServiceOption   `json:"services"`
	TeamAccess            []ProjectTeamAccess      `json:"team_access"`
	ApprovalRules         []ProjectApprovalRule    `json:"approval_rules"`
	CostRiskSummary       *ProjectCostRiskSummary  `json:"cost_risk_summary,omitempty"`
}

type ProjectBulkCreateResult struct {
	Index   int             `json:"index"`
	Project *ProjectCatalog `json:"project,omitempty"`
	Error   string          `json:"error,omitempty"`
}

type ProjectAnalyticsDistributionItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type ProjectAnalyticsLeadTime struct {
	AverageHours      float64 `json:"average_hours"`
	CompletedRequests int     `json:"completed_requests"`
}

type ProjectAnalyticsProjectItem struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	Status    string `json:"status"`
	Stage     string `json:"stage"`
	Requests  int    `json:"requests"`
	Pending   int    `json:"pending"`
	Completed int    `json:"completed"`
	Services  int    `json:"services"`
	Teams     int    `json:"teams"`
}

type ProjectAnalyticsSummary struct {
	ProjectCount          int `json:"project_count"`
	ReadyCount            int `json:"ready_count"`
	NeedsSetupCount       int `json:"needs_setup_count"`
	ArchivedCount         int `json:"archived_count"`
	TotalRequestCount     int `json:"total_request_count"`
	PendingRequestCount   int `json:"pending_request_count"`
	CompletedRequestCount int `json:"completed_request_count"`
	ActiveUserCount       int `json:"active_user_count"`
	MappedTeamCount       int `json:"mapped_team_count"`
}

type ProjectAnalytics struct {
	Summary                        ProjectAnalyticsSummary            `json:"summary"`
	StageDistribution              []ProjectAnalyticsDistributionItem `json:"stage_distribution"`
	StatusDistribution             []ProjectAnalyticsDistributionItem `json:"status_distribution"`
	EnvironmentRequestDistribution []ProjectAnalyticsDistributionItem `json:"environment_request_distribution"`
	CloudRequestDistribution       []ProjectAnalyticsDistributionItem `json:"cloud_request_distribution"`
	ServiceRequestDistribution     []ProjectAnalyticsDistributionItem `json:"service_request_distribution"`
	LeadTime                       ProjectAnalyticsLeadTime           `json:"lead_time"`
	RiskDistribution               []ProjectAnalyticsDistributionItem `json:"risk_distribution"`
	TopProjectsByRequests          []ProjectAnalyticsProjectItem      `json:"top_projects_by_requests"`
	ApprovalBottlenecks            []ProjectAnalyticsProjectItem      `json:"approval_bottlenecks"`
	TopRiskProjects                []ProjectAnalyticsProjectItem      `json:"top_risk_projects"`
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

func projectAccessMap(project *ProjectCatalog) (map[int][]string, error) {
	result := make(map[int][]string)
	if project == nil {
		return result, nil
	}
	for _, access := range project.TeamAccess {
		members, err := GetTeamMembers(access.TeamID)
		if err != nil {
			return nil, err
		}
		for _, member := range members {
			current := result[member.UserID]
			seen := make(map[string]struct{}, len(current))
			for _, env := range current {
				seen[env] = struct{}{}
			}
			for _, env := range access.Environments {
				if _, ok := seen[env]; ok {
					continue
				}
				current = append(current, env)
				seen[env] = struct{}{}
			}
			sort.Strings(current)
			result[member.UserID] = current
		}
	}
	return result, nil
}

func intPointerEqual(left, right *int) bool {
	if left == nil && right == nil {
		return true
	}
	if left == nil || right == nil {
		return false
	}
	return *left == *right
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func serviceSlicesEqual(left, right []ProjectServiceOption) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func approvalRuleSlicesEqual(left, right []ProjectApprovalRule) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func projectCatalogDefinitionChanged(previous, current *ProjectCatalog) bool {
	if previous == nil || current == nil {
		return false
	}
	if previous.Name != current.Name || previous.Code != current.Code || previous.Description != current.Description || previous.Status != current.Status {
		return true
	}
	if !intPointerEqual(previous.OwnerTeamID, current.OwnerTeamID) {
		return true
	}
	if !stringSlicesEqual(previous.Environments, current.Environments) || !stringSlicesEqual(previous.Clouds, current.Clouds) {
		return true
	}
	if !serviceSlicesEqual(previous.Services, current.Services) {
		return true
	}
	if !approvalRuleSlicesEqual(previous.ApprovalRules, current.ApprovalRules) {
		return true
	}
	return false
}

func notifyProjectAudienceChanges(previous, current *ProjectCatalog) {
	if current == nil {
		return
	}
	currentAccess, err := projectAccessMap(current)
	if err != nil {
		return
	}
	if previous == nil {
		for userID, environments := range currentAccess {
			NotifyProjectAssigned(userID, current, environments)
		}
		return
	}

	previousAccess, err := projectAccessMap(previous)
	if err != nil {
		return
	}

	for userID, environments := range currentAccess {
		if previousEnvironments, ok := previousAccess[userID]; !ok {
			NotifyProjectAssigned(userID, current, environments)
		} else if !stringSlicesEqual(previousEnvironments, environments) {
			NotifyProjectAccessUpdated(userID, current, environments)
		}
	}
	for userID, environments := range previousAccess {
		if _, ok := currentAccess[userID]; !ok {
			NotifyProjectAccessRemoved(userID, previous, environments)
		}
	}
	if projectCatalogDefinitionChanged(previous, current) {
		for userID := range currentAccess {
			NotifyProjectCatalogUpdated(userID, current)
		}
	}
}

func deriveProjectOnboarding(project *ProjectCatalog) {
	if project == nil {
		return
	}
	project.ServiceCount = len(project.Services)
	project.TeamCount = len(project.TeamAccess)
	project.ReadinessChecks = []ProjectReadinessCheck{
		{
			Key:      "environments",
			Label:    "Environment layout",
			Complete: len(project.Environments) > 0,
			Detail:   "Define at least one environment such as dev, uat, or prod.",
		},
		{
			Key:      "clouds",
			Label:    "Cloud coverage",
			Complete: len(project.Clouds) > 0,
			Detail:   "Choose which clouds this project can request against.",
		},
		{
			Key:      "services",
			Label:    "Service catalog",
			Complete: len(project.Services) > 0,
			Detail:   "Map the cloud-service combinations users are allowed to request.",
		},
		{
			Key:      "team_access",
			Label:    "Team access",
			Complete: len(project.TeamAccess) > 0,
			Detail:   "Grant at least one portal team access before requests can start.",
		},
		{
			Key:      "owner_team",
			Label:    "Owner team",
			Complete: project.OwnerTeamID != nil && *project.OwnerTeamID > 0,
			Detail:   "Assign an owner team so governance and escalation stay clear.",
		},
	}

	switch strings.ToLower(strings.TrimSpace(project.Status)) {
	case "archived":
		project.OnboardingStage = "archived"
		project.ReadyForRequests = false
		project.NextAction = "Archived projects are read-only. Reactivate only if the catalog should accept requests again."
		project.LifecycleActions = []ProjectLifecycleAction{
			{Action: "activate", Label: "Reactivate", Description: "Return this archived project to active request status.", Enabled: true},
			{Action: "deactivate", Label: "Mark inactive", Description: "Keep the project unavailable without reopening requests.", Enabled: false},
			{Action: "archive", Label: "Archive", Description: "Archive is already applied.", Enabled: false},
		}
		return
	case "inactive":
		project.OnboardingStage = "inactive"
		project.ReadyForRequests = false
		project.NextAction = "Reactivate after the team, service, and approval mappings are ready for request traffic."
		project.LifecycleActions = []ProjectLifecycleAction{
			{Action: "activate", Label: "Activate", Description: "Open the project for new requests once setup is complete.", Enabled: true},
			{Action: "deactivate", Label: "Mark inactive", Description: "Inactive is already applied.", Enabled: false},
			{Action: "archive", Label: "Archive", Description: "Archive this project if it should remain visible only for history.", Enabled: true},
		}
		return
	}

	if len(project.Environments) == 0 || len(project.Clouds) == 0 || len(project.Services) == 0 {
		project.OnboardingStage = "created"
		project.ReadyForRequests = false
		project.NextAction = "Complete the environment, cloud, and service catalog before opening this project to requesters."
		project.LifecycleActions = []ProjectLifecycleAction{
			{Action: "activate", Label: "Activate", Description: "Active is already applied.", Enabled: false},
			{Action: "deactivate", Label: "Mark inactive", Description: "Pause new requests while the project catalog is being configured.", Enabled: true},
			{Action: "archive", Label: "Archive", Description: "Archive this project if setup should stop permanently.", Enabled: true},
		}
		return
	}
	if project.OwnerTeamID == nil || *project.OwnerTeamID <= 0 {
		project.OnboardingStage = "configured"
		project.ReadyForRequests = false
		project.NextAction = "Assign an owner team before opening this project so approvals and support have a clear accountable team."
		project.LifecycleActions = []ProjectLifecycleAction{
			{Action: "activate", Label: "Activate", Description: "Active is already applied.", Enabled: false},
			{Action: "deactivate", Label: "Mark inactive", Description: "Pause new requests while ownership is being assigned.", Enabled: true},
			{Action: "archive", Label: "Archive", Description: "Archive this project if onboarding should stop.", Enabled: true},
		}
		return
	}
	if len(project.TeamAccess) == 0 {
		project.OnboardingStage = "configured"
		project.ReadyForRequests = false
		project.NextAction = "Map at least one portal team so users can see this project and request services."
		project.LifecycleActions = []ProjectLifecycleAction{
			{Action: "activate", Label: "Activate", Description: "Active is already applied.", Enabled: false},
			{Action: "deactivate", Label: "Mark inactive", Description: "Pause new requests until team mappings are finished.", Enabled: true},
			{Action: "archive", Label: "Archive", Description: "Archive this project if it should not proceed.", Enabled: true},
		}
		return
	}
	project.OnboardingStage = "ready"
	project.ReadyForRequests = true
	project.NextAction = "Project is ready for requests. Use inactive or archive when you need to stop new traffic."
	project.LifecycleActions = []ProjectLifecycleAction{
		{Action: "activate", Label: "Activate", Description: "Active is already applied.", Enabled: false},
		{Action: "deactivate", Label: "Mark inactive", Description: "Temporarily stop new requests while preserving visibility.", Enabled: true},
		{Action: "archive", Label: "Archive", Description: "Retire the project from new requests and keep history only.", Enabled: true},
	}
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
	var err error
	input, err = sanitizeProjectInput(input)
	if err != nil {
		return nil, err
	}
	ctx, cancel := dbTransactionTimeoutContext()
	defer cancel()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

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
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, err
	}
	AppendAuditLog(createdBy, "project_create", "project", strconv.Itoa(projectID), fmt.Sprintf("%s (%s)", input.Name, input.Code))
	notifyProjectAudienceChanges(nil, project)
	return project, nil
}

func updateProjectCatalog(projectID int, input ProjectCatalogInput, updatedBy *int) (*ProjectCatalog, error) {
	previousProject, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, err
	}
	input, err = sanitizeProjectInput(input)
	if err != nil {
		return nil, err
	}
	ctx, cancel := dbTransactionTimeoutContext()
	defer cancel()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

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
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, err
	}
	AppendAuditLog(updatedBy, "project_update", "project", strconv.Itoa(projectID), fmt.Sprintf("%s (%s)", input.Name, input.Code))
	notifyProjectAudienceChanges(previousProject, project)
	return project, nil
}

func performProjectLifecycleAction(projectID int, action string, updatedBy *int) (*ProjectCatalog, error) {
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf("project not found")
	}

	action = strings.TrimSpace(strings.ToLower(action))
	var nextStatus string
	switch action {
	case "activate":
		nextStatus = "active"
	case "deactivate":
		nextStatus = "inactive"
	case "archive":
		nextStatus = "archived"
	default:
		return nil, fmt.Errorf("unsupported lifecycle action")
	}

	if nextStatus == project.Status {
		return project, nil
	}

	input := ProjectCatalogInput{
		Name:          project.Name,
		Code:          project.Code,
		Description:   project.Description,
		Status:        nextStatus,
		OwnerTeamID:   project.OwnerTeamID,
		Environments:  append([]string(nil), project.Environments...),
		Clouds:        append([]string(nil), project.Clouds...),
		Services:      append([]ProjectServiceOption(nil), project.Services...),
		TeamAccess:    make([]ProjectTeamAccess, len(project.TeamAccess)),
		ApprovalRules: append([]ProjectApprovalRule(nil), project.ApprovalRules...),
	}
	for index, access := range project.TeamAccess {
		input.TeamAccess[index] = ProjectTeamAccess{
			TeamID:       access.TeamID,
			Environments: append([]string(nil), access.Environments...),
		}
	}
	updatedProject, err := updateProjectCatalog(projectID, input, updatedBy)
	if err != nil {
		return nil, err
	}
	AppendAuditLog(updatedBy, "project_lifecycle", "project", strconv.Itoa(projectID), fmt.Sprintf("%s -> %s", project.Status, nextStatus))
	return updatedProject, nil
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

func mergeUniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func buildProjectCatalogCSV(projects []ProjectCatalog) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write([]string{
		"project_id", "name", "code", "status", "onboarding_stage", "ready_for_requests",
		"owner_team", "environments", "clouds", "services", "team_access", "request_count",
		"pending_request_count", "completed_request_count",
	}); err != nil {
		return nil, err
	}
	for _, project := range projects {
		serviceNames := make([]string, 0, len(project.Services))
		for _, service := range project.Services {
			serviceNames = append(serviceNames, fmt.Sprintf("%s:%s", service.Cloud, service.Service))
		}
		teamAccess := make([]string, 0, len(project.TeamAccess))
		for _, access := range project.TeamAccess {
			label := access.TeamName
			if label == "" {
				label = access.TeamSlug
			}
			teamAccess = append(teamAccess, fmt.Sprintf("%s[%s]", label, strings.Join(access.Environments, "/")))
		}
		if err := writer.Write([]string{
			strconv.Itoa(project.ID),
			project.Name,
			project.Code,
			project.Status,
			project.OnboardingStage,
			strconv.FormatBool(project.ReadyForRequests),
			project.OwnerTeam,
			strings.Join(project.Environments, ", "),
			strings.Join(project.Clouds, ", "),
			strings.Join(serviceNames, ", "),
			strings.Join(teamAccess, ", "),
			strconv.Itoa(project.RequestCount),
			strconv.Itoa(project.PendingRequestCount),
			strconv.Itoa(project.CompletedRequestCount),
		}); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func buildDistributionItems(values map[string]int) []ProjectAnalyticsDistributionItem {
	items := make([]ProjectAnalyticsDistributionItem, 0, len(values))
	for key, count := range values {
		if count <= 0 {
			continue
		}
		label := key
		if label == "" {
			label = "unassigned"
		}
		items = append(items, ProjectAnalyticsDistributionItem{
			Key:   key,
			Label: strings.ReplaceAll(label, "_", " "),
			Count: count,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Count == items[j].Count {
			return items[i].Label < items[j].Label
		}
		return items[i].Count > items[j].Count
	})
	return items
}

func buildProjectAnalytics(projects []ProjectCatalog) (*ProjectAnalytics, error) {
	analytics := &ProjectAnalytics{
		Summary: ProjectAnalyticsSummary{
			ProjectCount: len(projects),
		},
		StageDistribution:              []ProjectAnalyticsDistributionItem{},
		StatusDistribution:             []ProjectAnalyticsDistributionItem{},
		EnvironmentRequestDistribution: []ProjectAnalyticsDistributionItem{},
		CloudRequestDistribution:       []ProjectAnalyticsDistributionItem{},
		ServiceRequestDistribution:     []ProjectAnalyticsDistributionItem{},
		RiskDistribution:               []ProjectAnalyticsDistributionItem{},
		TopProjectsByRequests:          []ProjectAnalyticsProjectItem{},
		ApprovalBottlenecks:            []ProjectAnalyticsProjectItem{},
		TopRiskProjects:                []ProjectAnalyticsProjectItem{},
	}
	if len(projects) == 0 {
		return analytics, nil
	}

	stageCounts := make(map[string]int)
	statusCounts := make(map[string]int)
	riskCounts := make(map[string]int)
	teamIDs := make(map[int]struct{})
	userIDs := make(map[int]struct{})

	topProjects := make([]ProjectAnalyticsProjectItem, 0, len(projects))
	bottlenecks := make([]ProjectAnalyticsProjectItem, 0, len(projects))
	topRiskProjects := make([]ProjectAnalyticsProjectItem, 0, len(projects))
	projectIDs := make([]int, 0, len(projects))
	for _, project := range projects {
		projectIDs = append(projectIDs, project.ID)
		stage := strings.TrimSpace(project.OnboardingStage)
		if stage == "" {
			stage = "configured"
		}
		stageCounts[stage]++
		status := strings.TrimSpace(project.Status)
		if status == "" {
			status = "active"
		}
		statusCounts[status]++
		if project.ReadyForRequests {
			analytics.Summary.ReadyCount++
		}
		if !project.ReadyForRequests && status == "active" {
			analytics.Summary.NeedsSetupCount++
		}
		if status == "archived" {
			analytics.Summary.ArchivedCount++
		}
		analytics.Summary.TotalRequestCount += project.RequestCount
		analytics.Summary.PendingRequestCount += project.PendingRequestCount
		analytics.Summary.CompletedRequestCount += project.CompletedRequestCount

		item := ProjectAnalyticsProjectItem{
			ID:        project.ID,
			Name:      project.Name,
			Code:      project.Code,
			Status:    status,
			Stage:     stage,
			Requests:  project.RequestCount,
			Pending:   project.PendingRequestCount,
			Completed: project.CompletedRequestCount,
			Services:  project.ServiceCount,
			Teams:     project.TeamCount,
		}
		topProjects = append(topProjects, item)
		bottlenecks = append(bottlenecks, item)
		if project.CostRiskSummary != nil {
			riskLevel := strings.TrimSpace(strings.ToLower(project.CostRiskSummary.OverallRisk))
			if riskLevel == "" {
				riskLevel = "low"
			}
			riskCounts[riskLevel]++
			riskItem := item
			topRiskProjects = append(topRiskProjects, riskItem)
		}

		for _, access := range project.TeamAccess {
			teamIDs[access.TeamID] = struct{}{}
			members, err := GetTeamMembers(access.TeamID)
			if err != nil {
				return nil, err
			}
			for _, member := range members {
				userIDs[member.UserID] = struct{}{}
			}
		}
	}
	analytics.Summary.MappedTeamCount = len(teamIDs)
	analytics.Summary.ActiveUserCount = len(userIDs)

	sort.Slice(topProjects, func(i, j int) bool {
		if topProjects[i].Requests == topProjects[j].Requests {
			return topProjects[i].Name < topProjects[j].Name
		}
		return topProjects[i].Requests > topProjects[j].Requests
	})
	if len(topProjects) > 6 {
		topProjects = topProjects[:6]
	}
	sort.Slice(bottlenecks, func(i, j int) bool {
		if bottlenecks[i].Pending == bottlenecks[j].Pending {
			return bottlenecks[i].Requests > bottlenecks[j].Requests
		}
		return bottlenecks[i].Pending > bottlenecks[j].Pending
	})
	if len(bottlenecks) > 6 {
		bottlenecks = bottlenecks[:6]
	}
	sort.Slice(topRiskProjects, func(i, j int) bool {
		leftRisk := ""
		rightRisk := ""
		for _, project := range projects {
			if project.ID == topRiskProjects[i].ID && project.CostRiskSummary != nil {
				leftRisk = project.CostRiskSummary.OverallRisk
			}
			if project.ID == topRiskProjects[j].ID && project.CostRiskSummary != nil {
				rightRisk = project.CostRiskSummary.OverallRisk
			}
		}
		riskRank := func(value string) int {
			switch strings.TrimSpace(strings.ToLower(value)) {
			case "high":
				return 3
			case "medium":
				return 2
			default:
				return 1
			}
		}
		if riskRank(leftRisk) == riskRank(rightRisk) {
			return topRiskProjects[i].Pending > topRiskProjects[j].Pending
		}
		return riskRank(leftRisk) > riskRank(rightRisk)
	})
	if len(topRiskProjects) > 6 {
		topRiskProjects = topRiskProjects[:6]
	}
	analytics.TopProjectsByRequests = topProjects
	analytics.ApprovalBottlenecks = bottlenecks
	analytics.TopRiskProjects = topRiskProjects
	analytics.StageDistribution = buildDistributionItems(stageCounts)
	analytics.StatusDistribution = buildDistributionItems(statusCounts)
	analytics.RiskDistribution = buildDistributionItems(riskCounts)

	placeholders := make([]string, len(projectIDs))
	queryArgs := make([]interface{}, 0, len(projectIDs))
	for index, id := range projectIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		queryArgs = append(queryArgs, id)
	}
	inClause := strings.Join(placeholders, ",")
	rows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT COALESCE(env,''), COALESCE(cloud,''), COALESCE(service,''), COALESCE(status,''), created_at, updated_at
			FROM pr_requests
			WHERE project_id IN (%s)
		`, inClause),
		queryArgs...,
	)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return analytics, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	envCounts := make(map[string]int)
	cloudCounts := make(map[string]int)
	serviceCounts := make(map[string]int)
	var completedLeadHours float64
	var completedCount int
	for rows.Next() {
		var env string
		var cloud string
		var service string
		var status string
		var createdAt time.Time
		var updatedAt time.Time
		if err := rows.Scan(&env, &cloud, &service, &status, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		envCounts[env]++
		cloudCounts[cloud]++
		serviceCounts[fmt.Sprintf("%s:%s", cloud, service)]++
		if status == "completed" && !createdAt.IsZero() && !updatedAt.IsZero() && updatedAt.After(createdAt) {
			completedLeadHours += updatedAt.Sub(createdAt).Hours()
			completedCount++
		}
	}
	analytics.EnvironmentRequestDistribution = buildDistributionItems(envCounts)
	analytics.CloudRequestDistribution = buildDistributionItems(cloudCounts)
	analytics.ServiceRequestDistribution = buildDistributionItems(serviceCounts)
	if completedCount > 0 {
		analytics.LeadTime = ProjectAnalyticsLeadTime{
			AverageHours:      completedLeadHours / float64(completedCount),
			CompletedRequests: completedCount,
		}
	}
	return analytics, nil
}

func applyBulkProjectTeamAccess(projectIDs []int, teamIDs []int, environments []string, action string, updatedBy *int) ([]ProjectCatalog, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	projectIDs = normalizeTeamIDs(projectIDs)
	teamIDs = normalizeTeamIDs(teamIDs)
	environments = mergeUniqueStrings(environments)
	if len(projectIDs) == 0 {
		return nil, fmt.Errorf("at least one project is required")
	}
	if len(teamIDs) == 0 {
		return nil, fmt.Errorf("at least one portal team is required")
	}
	action = strings.TrimSpace(strings.ToLower(action))
	if action != "grant" && action != "replace" && action != "revoke" {
		return nil, fmt.Errorf("unsupported bulk access action")
	}
	if action != "revoke" && len(environments) == 0 {
		return nil, fmt.Errorf("at least one environment is required")
	}
	for _, teamID := range teamIDs {
		team, err := GetTeamByID(teamID)
		if err != nil {
			return nil, err
		}
		if team == nil {
			return nil, fmt.Errorf("team %d not found", teamID)
		}
		if strings.TrimSpace(strings.ToLower(team.TeamType)) != "" && strings.TrimSpace(strings.ToLower(team.TeamType)) != "portal" {
			return nil, fmt.Errorf("team %s is not a portal team", team.Name)
		}
	}

	updatedProjects := make([]ProjectCatalog, 0, len(projectIDs))
	for _, projectID := range projectIDs {
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			return nil, err
		}
		if project == nil {
			return nil, fmt.Errorf("project %d not found", projectID)
		}
		input := ProjectCatalogInput{
			Name:          project.Name,
			Code:          project.Code,
			Description:   project.Description,
			Status:        project.Status,
			OwnerTeamID:   project.OwnerTeamID,
			Environments:  append([]string(nil), project.Environments...),
			Clouds:        append([]string(nil), project.Clouds...),
			Services:      append([]ProjectServiceOption(nil), project.Services...),
			ApprovalRules: append([]ProjectApprovalRule(nil), project.ApprovalRules...),
			TeamAccess:    make([]ProjectTeamAccess, 0, len(project.TeamAccess)),
		}
		accessByTeam := make(map[int]ProjectTeamAccess, len(project.TeamAccess))
		for _, access := range project.TeamAccess {
			accessByTeam[access.TeamID] = ProjectTeamAccess{
				TeamID:       access.TeamID,
				Environments: append([]string(nil), access.Environments...),
			}
		}
		for _, teamID := range teamIDs {
			current, exists := accessByTeam[teamID]
			switch action {
			case "grant":
				if exists {
					current.Environments = mergeUniqueStrings(append(current.Environments, environments...))
					accessByTeam[teamID] = current
				} else {
					accessByTeam[teamID] = ProjectTeamAccess{TeamID: teamID, Environments: append([]string(nil), environments...)}
				}
			case "replace":
				accessByTeam[teamID] = ProjectTeamAccess{TeamID: teamID, Environments: append([]string(nil), environments...)}
			case "revoke":
				delete(accessByTeam, teamID)
			}
		}
		for _, access := range accessByTeam {
			if len(access.Environments) == 0 {
				continue
			}
			input.TeamAccess = append(input.TeamAccess, access)
		}
		sort.Slice(input.TeamAccess, func(i, j int) bool { return input.TeamAccess[i].TeamID < input.TeamAccess[j].TeamID })
		updatedProject, err := updateProjectCatalog(projectID, input, updatedBy)
		if err != nil {
			return nil, err
		}
		updatedProjects = append(updatedProjects, *updatedProject)
	}
	AppendAuditLog(updatedBy, "project_bulk_team_access", "project", strconv.Itoa(len(updatedProjects)), fmt.Sprintf("%s %d project(s)", action, len(updatedProjects)))
	return updatedProjects, nil
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

	requestRows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT project_id,
			       COUNT(*) AS total_count,
			       COUNT(*) FILTER (WHERE status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')) AS pending_count,
			       COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
			FROM pr_requests
			WHERE project_id IN (%s)
			GROUP BY project_id
		`, inClause),
		queryArgs...,
	)
	if err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return nil, err
		}
	} else {
		defer cancel()
		defer requestRows.Close()
		for requestRows.Next() {
			var projectID int
			var totalCount int
			var pendingCount int
			var completedCount int
			if err := requestRows.Scan(&projectID, &totalCount, &pendingCount, &completedCount); err != nil {
				return nil, err
			}
			if project := projectsByID[projectID]; project != nil {
				project.RequestCount = totalCount
				project.PendingRequestCount = pendingCount
				project.CompletedRequestCount = completedCount
			}
		}
	}

	projectRequests := make(map[int][]PRRequest, len(projectIDs))
	requestPreviewRows, cancel, err := queryRowsWithTimeout(
		fmt.Sprintf(`
			SELECT id, project_id, COALESCE(team,''), COALESCE(env,''), COALESCE(cloud,''), COALESCE(service,''),
			       COALESCE(priority,''), due_date, COALESCE(status,''), COALESCE(config,''), COALESCE(terraform_plan_output,'')
			FROM pr_requests
			WHERE project_id IN (%s)
			ORDER BY created_at DESC
		`, inClause),
		queryArgs...,
	)
	if err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return nil, err
		}
	} else {
		defer cancel()
		defer requestPreviewRows.Close()
		for requestPreviewRows.Next() {
			var req PRRequest
			var projectID int
			var dueDate sql.NullTime
			if err := requestPreviewRows.Scan(
				&req.ID,
				&projectID,
				&req.Team,
				&req.Env,
				&req.Cloud,
				&req.Service,
				&req.Priority,
				&dueDate,
				&req.Status,
				&req.Config,
				&req.TerraformPlanOutput,
			); err != nil {
				return nil, err
			}
			req.ProjectID = intPointerIfPositive(projectID)
			if dueDate.Valid {
				dueDateValue := dueDate.Time
				req.DueDate = &dueDateValue
			}
			projectRequests[projectID] = append(projectRequests[projectID], req)
		}
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
		project := projectsByID[id]
		deriveProjectOnboarding(project)
		project.CostRiskSummary = BuildProjectCostRiskSummary(project, projectRequests[id])
		out = append(out, *project)
	}
	return out, nil
}

func getVisibleProjectsForUser(userID int) ([]ProjectCatalog, error) {
	userTeams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return nil, err
	}
	var teamIDs []int
	teamSet := map[int]struct{}{}
	for _, team := range userTeams {
		teamType := strings.TrimSpace(strings.ToLower(team.TeamType))
		if teamType != "" && teamType != "portal" {
			continue
		}
		teamIDs = append(teamIDs, team.ID)
		teamSet[team.ID] = struct{}{}
	}
	projectIDSet := map[int]struct{}{}
	if len(teamIDs) > 0 {
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
			if !strings.Contains(err.Error(), "does not exist") {
				return nil, err
			}
		} else {
			defer cancel()
			defer rows.Close()
			for rows.Next() {
				var projectID int
				var noop1 string
				var noop2 string
				if err := rows.Scan(&projectID, &noop1, &noop2); err != nil {
					return nil, err
				}
				projectIDSet[projectID] = struct{}{}
			}
		}
	}
	overrides, err := activeProjectAccessOverridesForUser(userID)
	if err != nil {
		return nil, err
	}
	for _, override := range overrides {
		projectIDSet[override.ProjectID] = struct{}{}
	}
	if len(projectIDSet) == 0 {
		return []ProjectCatalog{}, nil
	}
	projectIDs := make([]int, 0, len(projectIDSet))
	for projectID := range projectIDSet {
		projectIDs = append(projectIDs, projectID)
	}
	sort.Ints(projectIDs)
	placeholders := make([]string, len(projectIDs))
	args := make([]interface{}, 0, len(projectIDs))
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
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "csv") {
		content, err := buildProjectCatalogCSV(projects)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", `attachment; filename="projects-governance.csv"`)
		_, _ = w.Write(content)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "projects": projects})
}

func adminProjectAnalyticsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	analytics, err := buildProjectAnalytics(projects)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "analytics": analytics})
}

func adminProjectDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/projects/")
	projectID, err := strconv.Atoi(strings.TrimSpace(path))
	if err != nil || projectID <= 0 {
		http.NotFound(w, r)
		return
	}
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil {
		writeAPIError(w, r, http.StatusNotFound, "project not found", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "project": project})
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
	overrideAllowed, err := userHasActiveProjectOverride(userID, projectID, environment)
	if err != nil {
		return nil, err
	}
	if !accessAllowed {
		if !overrideAllowed {
			return nil, fmt.Errorf("selected team does not have access to this project")
		}
	}
	if !envAllowed {
		if !overrideAllowed {
			return nil, fmt.Errorf("selected environment is not enabled for this project/team combination")
		}
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
	requestedServiceKey := normalizeRequestServiceKey(cloud, service)
	for _, allowedService := range project.Services {
		allowedCloudKey := strings.ToLower(strings.TrimSpace(allowedService.Cloud))
		allowedServiceKey := normalizeRequestServiceKey(allowedService.Cloud, allowedService.Service)
		if allowedCloudKey == strings.ToLower(strings.TrimSpace(cloud)) && allowedServiceKey == requestedServiceKey {
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
		writeMethodNotAllowed(w, r)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "request failed", err)
		return
	}
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "projects": projects})
}

func meProjectDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "request failed", err)
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
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	for _, project := range projects {
		if project.ID == projectID {
			w.Header().Set("Content-Type", "application/json")
			encodeJSON(w, map[string]interface{}{"status": "ok", "project": project})
			return
		}
	}
	writeAPIError(w, r, http.StatusNotFound, "project not found", nil)
}

func devopsProjectOptionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	portalTeams, err := getPortalTeams()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	ownerTeams, err := GetTeams()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":       "ok",
		"portal_teams": portalTeams,
		"owner_teams":  ownerTeams,
	})
}

func devopsProjectAnalyticsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	analytics, err := buildProjectAnalytics(projects)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "analytics": analytics})
}

func devopsProjectsBulkHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	var payload struct {
		Projects []ProjectCatalogInput `json:"projects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	if len(payload.Projects) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "at least one project is required", nil)
		return
	}
	results := make([]ProjectBulkCreateResult, 0, len(payload.Projects))
	createdCount := 0
	for index, input := range payload.Projects {
		project, err := createProjectCatalog(input, &managerID)
		result := ProjectBulkCreateResult{Index: index}
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Project = project
			createdCount++
		}
		results = append(results, result)
	}
	w.Header().Set("Content-Type", "application/json")
	statusCode := http.StatusOK
	if createdCount == 0 {
		statusCode = http.StatusBadRequest
	}
	w.WriteHeader(statusCode)
	encodeJSON(w, map[string]interface{}{
		"status":        "ok",
		"created_count": createdCount,
		"error_count":   len(payload.Projects) - createdCount,
		"results":       results,
	})
}

func devopsProjectsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method == "GET" {
		userID, ok := requireDevopsUser(w, r)
		if !ok {
			return
		}
		profile, _ := GetDevopsProfile(userID)
		if profile == nil || !profile.IsManager {
			writeAPIError(w, r, http.StatusForbidden, "DevOps manager access required", nil)
			return
		}
		projects, err := listProjectCatalogs()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "csv") {
			content, err := buildProjectCatalogCSV(projects)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
				return
			}
			w.Header().Set("Content-Type", "text/csv")
			w.Header().Set("Content-Disposition", `attachment; filename="devops-projects.csv"`)
			_, _ = w.Write(content)
			return
		}
		portalTeams, err := getPortalTeams()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		ownerTeams, err := GetTeams()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status":       "ok",
			"projects":     projects,
			"portal_teams": portalTeams,
			"owner_teams":  ownerTeams,
		})
		return
	}
	if r.Method == "POST" {
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		var input ProjectCatalogInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		createdBy := &userID
		project, err := retryDBOnceIfConnError("createProjectCatalog", func() (*ProjectCatalog, error) {
			return createProjectCatalog(input, createdBy)
		})
		if err != nil {
			if isTransientDBConnError(err) {
				writeAPIError(w, r, http.StatusServiceUnavailable, "Database temporarily unavailable. Please retry in a moment.", err)
				return
			}
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		encodeJSON(w, map[string]interface{}{"status": "ok", "project": project})
		return
	}
	writeMethodNotAllowed(w, r)
}

func devopsProjectBulkTeamAccessHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	var payload struct {
		ProjectIDs   []int    `json:"project_ids"`
		TeamIDs      []int    `json:"team_ids"`
		Environments []string `json:"environments"`
		Action       string   `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	projects, err := applyBulkProjectTeamAccess(payload.ProjectIDs, payload.TeamIDs, payload.Environments, payload.Action, &userID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "projects": projects})
}

func devopsProjectDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/projects/")
	pathParts := strings.Split(strings.Trim(strings.TrimSpace(path), "/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		http.NotFound(w, r)
		return
	}
	projectID, err := strconv.Atoi(strings.TrimSpace(pathParts[0]))
	if err != nil || projectID <= 0 {
		http.NotFound(w, r)
		return
	}
	if len(pathParts) > 1 && pathParts[1] == "lifecycle" {
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		var payload struct {
			Action string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		project, err := performProjectLifecycleAction(projectID, payload.Action, &userID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "project": project})
		return
	}
	if r.Method == "GET" {
		if _, ok := requireDevopsUser(w, r); !ok {
			return
		}
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		if project == nil {
			writeAPIError(w, r, http.StatusNotFound, "project not found", nil)
			return
		}
		releaseDashboard, err := buildProjectReleaseDashboard(*project)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "project": project, "release_dashboard": releaseDashboard})
		return
	}
	if r.Method == "PUT" {
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		var input ProjectCatalogInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		project, err := retryDBOnceIfConnError("updateProjectCatalog", func() (*ProjectCatalog, error) {
			return updateProjectCatalog(projectID, input, &userID)
		})
		if err != nil {
			if isTransientDBConnError(err) {
				writeAPIError(w, r, http.StatusServiceUnavailable, "Database temporarily unavailable. Please retry in a moment.", err)
				return
			}
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "project": project})
		return
	}
	writeMethodNotAllowed(w, r)
}
