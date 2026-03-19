package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type projectRunbook struct {
	ID        int       `json:"id"`
	ProjectID int       `json:"project_id"`
	Service   string    `json:"service"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	LinkURL   string    `json:"link_url"`
	CreatedBy *int      `json:"created_by,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type requestIncident struct {
	ID              int       `json:"id"`
	RequestID       int       `json:"request_id"`
	ProjectID       *int      `json:"project_id,omitempty"`
	ProjectName     string    `json:"project_name,omitempty"`
	ProjectCode     string    `json:"project_code,omitempty"`
	RequestTeam     string    `json:"request_team,omitempty"`
	RequestEnv      string    `json:"request_env,omitempty"`
	RequestService  string    `json:"request_service,omitempty"`
	RequestCloud    string    `json:"request_cloud,omitempty"`
	RequestStatus   string    `json:"request_status,omitempty"`
	Severity        string    `json:"severity"`
	Status          string    `json:"status"`
	EscalationLevel string    `json:"escalation_level"`
	OwnerUserID     *int      `json:"owner_user_id,omitempty"`
	OwnerUsername   string    `json:"owner_username,omitempty"`
	Summary         string    `json:"summary"`
	Notes           string    `json:"notes"`
	CreatedBy       *int      `json:"created_by,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type projectAccessOverride struct {
	ID           int        `json:"id"`
	ProjectID    int        `json:"project_id"`
	ProjectName  string     `json:"project_name"`
	ProjectCode  string     `json:"project_code"`
	UserID       int        `json:"user_id"`
	Username     string     `json:"username"`
	Environments []string   `json:"environments"`
	Permission   string     `json:"permission"`
	Reason       string     `json:"reason"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	RevokedBy    *int       `json:"revoked_by,omitempty"`
	CreatedBy    *int       `json:"created_by,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type promotionCenterItem struct {
	RequestID            int                    `json:"request_id"`
	ProjectID            *int                   `json:"project_id,omitempty"`
	ProjectName          string                 `json:"project_name,omitempty"`
	ProjectCode          string                 `json:"project_code,omitempty"`
	Team                 string                 `json:"team"`
	Environment          string                 `json:"environment"`
	NextEnvironment      string                 `json:"next_environment"`
	Cloud                string                 `json:"cloud"`
	Service              string                 `json:"service"`
	Status               string                 `json:"status"`
	ClientName           string                 `json:"client_name"`
	UpdatedAt            time.Time              `json:"updated_at"`
	LatestPromotedID     *int                   `json:"latest_promoted_id,omitempty"`
	LatestPromotedEnv    string                 `json:"latest_promoted_env,omitempty"`
	LatestPromotedStatus string                 `json:"latest_promoted_status,omitempty"`
	Gate                 *promotionGateDecision `json:"gate,omitempty"`
}

type opsDeliveryFailure struct {
	ID           int        `json:"id"`
	JobType      string     `json:"job_type"`
	Target       string     `json:"target"`
	Payload      string     `json:"payload"`
	ErrorMessage string     `json:"error_message"`
	Status       string     `json:"status"`
	RetryCount   int        `json:"retry_count"`
	LastRetryAt  *time.Time `json:"last_retry_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type simpleUserOption struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

func normalizeLowerList(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
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

func splitCSVList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	return normalizeLowerList(strings.Split(value, ","))
}

func joinCSVList(values []string) string {
	return strings.Join(normalizeLowerList(values), ",")
}

func listPortalUsers() ([]simpleUserOption, error) {
	rows, cancel, err := queryRowsWithTimeout(`SELECT id, username FROM users WHERE COALESCE(user_type, 'portal_user') = 'portal_user' ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []simpleUserOption{}
	for rows.Next() {
		var user simpleUserOption
		if err := rows.Scan(&user.ID, &user.Username); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, nil
}

func listProjectRunbooks(projectID int) ([]projectRunbook, error) {
	query := `
		SELECT id, project_id, COALESCE(service,''), title, COALESCE(content,''), COALESCE(link_url,''), created_by, created_at, updated_at
		FROM project_runbooks
	`
	args := []any{}
	if projectID > 0 {
		query += ` WHERE project_id = $1`
		args = append(args, projectID)
	}
	query += ` ORDER BY project_id, service, title`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []projectRunbook{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []projectRunbook{}
	for rows.Next() {
		var item projectRunbook
		var createdBy sql.NullInt64
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Service, &item.Title, &item.Content, &item.LinkURL, &createdBy, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			item.CreatedBy = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func createProjectRunbook(projectID int, service, title, content, linkURL string, createdBy *int) (*projectRunbook, error) {
	service = strings.ToLower(strings.TrimSpace(service))
	title = strings.TrimSpace(title)
	if projectID <= 0 || title == "" {
		return nil, fmt.Errorf("project and title are required")
	}
	var item projectRunbook
	var createdByInt any
	if createdBy != nil && *createdBy > 0 {
		createdByInt = *createdBy
	}
	var createdByValue sql.NullInt64
	err := queryRowContext(`
		INSERT INTO project_runbooks (project_id, service, title, content, link_url, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, project_id, service, title, content, link_url, created_by, created_at, updated_at
	`, projectID, service, title, strings.TrimSpace(content), strings.TrimSpace(linkURL), createdByInt).Scan(
		&item.ID, &item.ProjectID, &item.Service, &item.Title, &item.Content, &item.LinkURL, &createdByValue, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if createdByValue.Valid {
		value := int(createdByValue.Int64)
		item.CreatedBy = &value
	}
	return &item, nil
}

func updateProjectRunbook(id int, service, title, content, linkURL string) (*projectRunbook, error) {
	service = strings.ToLower(strings.TrimSpace(service))
	title = strings.TrimSpace(title)
	if id <= 0 || title == "" {
		return nil, fmt.Errorf("runbook id and title are required")
	}
	var item projectRunbook
	var createdBy sql.NullInt64
	err := queryRowContext(`
		UPDATE project_runbooks
		SET service = $1, title = $2, content = $3, link_url = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $5
		RETURNING id, project_id, service, title, content, link_url, created_by, created_at, updated_at
	`, service, title, strings.TrimSpace(content), strings.TrimSpace(linkURL), id).Scan(
		&item.ID, &item.ProjectID, &item.Service, &item.Title, &item.Content, &item.LinkURL, &createdBy, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		item.CreatedBy = &value
	}
	return &item, nil
}

func deleteProjectRunbook(id int) error {
	_, err := execContext(`DELETE FROM project_runbooks WHERE id = $1`, id)
	return err
}

func listRequestIncidents(statusFilter string) ([]requestIncident, error) {
	query := `
		SELECT i.id, i.request_id, i.project_id, COALESCE(p.name,''), COALESCE(p.code,''),
		       COALESCE(r.team,''), COALESCE(r.env,''), COALESCE(r.service,''), COALESCE(r.cloud,''), COALESCE(r.status,''),
		       i.severity, i.status, i.escalation_level, i.owner_user_id, COALESCE(u.username,''), COALESCE(i.summary,''), COALESCE(i.notes,''),
		       i.created_by, i.created_at, i.updated_at
		FROM request_incidents i
		LEFT JOIN pr_requests r ON r.id = i.request_id
		LEFT JOIN projects p ON p.id = i.project_id
		LEFT JOIN users u ON u.id = i.owner_user_id
	`
	args := []any{}
	if strings.TrimSpace(statusFilter) != "" {
		query += ` WHERE i.status = $1`
		args = append(args, strings.TrimSpace(statusFilter))
	}
	query += ` ORDER BY i.updated_at DESC, i.created_at DESC`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []requestIncident{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []requestIncident{}
	for rows.Next() {
		var item requestIncident
		var projectID, ownerUserID, createdBy sql.NullInt64
		if err := rows.Scan(
			&item.ID, &item.RequestID, &projectID, &item.ProjectName, &item.ProjectCode,
			&item.RequestTeam, &item.RequestEnv, &item.RequestService, &item.RequestCloud, &item.RequestStatus,
			&item.Severity, &item.Status, &item.EscalationLevel, &ownerUserID, &item.OwnerUsername, &item.Summary, &item.Notes,
			&createdBy, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if projectID.Valid {
			value := int(projectID.Int64)
			item.ProjectID = &value
		}
		if ownerUserID.Valid {
			value := int(ownerUserID.Int64)
			item.OwnerUserID = &value
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			item.CreatedBy = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func createOrUpdateRequestIncident(requestID int, severity, status, escalationLevel string, ownerUserID *int, summary, notes string, createdBy *int) (*requestIncident, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, fmt.Errorf("request not found")
	}
	severity = strings.ToLower(strings.TrimSpace(severity))
	if severity == "" {
		severity = "medium"
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		status = "open"
	}
	escalationLevel = strings.ToLower(strings.TrimSpace(escalationLevel))
	if escalationLevel == "" {
		escalationLevel = "monitoring"
	}
	var ownerAny any
	if ownerUserID != nil && *ownerUserID > 0 {
		ownerAny = *ownerUserID
	}
	var createdAny any
	if createdBy != nil && *createdBy > 0 {
		createdAny = *createdBy
	}
	_, err = execContext(`
		INSERT INTO request_incidents (request_id, project_id, severity, status, escalation_level, owner_user_id, summary, notes, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (request_id)
		DO UPDATE SET
			project_id = EXCLUDED.project_id,
			severity = EXCLUDED.severity,
			status = EXCLUDED.status,
			escalation_level = EXCLUDED.escalation_level,
			owner_user_id = EXCLUDED.owner_user_id,
			summary = EXCLUDED.summary,
			notes = EXCLUDED.notes,
			updated_at = CURRENT_TIMESTAMP
	`, requestID, req.ProjectID, severity, status, escalationLevel, ownerAny, strings.TrimSpace(summary), strings.TrimSpace(notes), createdAny)
	if err != nil {
		return nil, err
	}
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.RequestID == requestID {
			return &item, nil
		}
	}
	return nil, fmt.Errorf("incident not found after save")
}

func activeProjectAccessOverridesForUser(userID int) ([]projectAccessOverride, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT o.id, o.project_id, COALESCE(p.name,''), COALESCE(p.code,''), o.user_id, COALESCE(u.username,''),
		       COALESCE(o.environments,''), COALESCE(o.permission,'write'), COALESCE(o.reason,''), o.expires_at,
		       o.revoked_at, o.revoked_by, o.created_by, o.created_at, o.updated_at
		FROM project_access_overrides o
		LEFT JOIN projects p ON p.id = o.project_id
		LEFT JOIN users u ON u.id = o.user_id
		WHERE o.user_id = $1
		  AND o.revoked_at IS NULL
		  AND o.expires_at > CURRENT_TIMESTAMP
		ORDER BY o.expires_at ASC
	`, userID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []projectAccessOverride{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	return scanProjectAccessOverrides(rows)
}

func scanProjectAccessOverrides(rows *sql.Rows) ([]projectAccessOverride, error) {
	out := []projectAccessOverride{}
	for rows.Next() {
		var item projectAccessOverride
		var revokedAt sql.NullTime
		var revokedBy, createdBy sql.NullInt64
		var envCSV string
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.ProjectName, &item.ProjectCode, &item.UserID, &item.Username,
			&envCSV, &item.Permission, &item.Reason, &item.ExpiresAt, &revokedAt, &revokedBy, &createdBy, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.Environments = splitCSVList(envCSV)
		if revokedAt.Valid {
			item.RevokedAt = &revokedAt.Time
		}
		if revokedBy.Valid {
			value := int(revokedBy.Int64)
			item.RevokedBy = &value
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			item.CreatedBy = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func listProjectAccessOverrides(activeOnly bool) ([]projectAccessOverride, error) {
	query := `
		SELECT o.id, o.project_id, COALESCE(p.name,''), COALESCE(p.code,''), o.user_id, COALESCE(u.username,''),
		       COALESCE(o.environments,''), COALESCE(o.permission,'write'), COALESCE(o.reason,''), o.expires_at,
		       o.revoked_at, o.revoked_by, o.created_by, o.created_at, o.updated_at
		FROM project_access_overrides o
		LEFT JOIN projects p ON p.id = o.project_id
		LEFT JOIN users u ON u.id = o.user_id
	`
	if activeOnly {
		query += ` WHERE o.revoked_at IS NULL AND o.expires_at > CURRENT_TIMESTAMP`
	}
	query += ` ORDER BY o.expires_at ASC, o.created_at DESC`
	rows, cancel, err := queryRowsWithTimeout(query)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []projectAccessOverride{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	return scanProjectAccessOverrides(rows)
}

func userHasActiveProjectOverride(userID, projectID int, environment string) (bool, error) {
	items, err := activeProjectAccessOverridesForUser(userID)
	if err != nil {
		return false, err
	}
	environment = strings.ToLower(strings.TrimSpace(environment))
	for _, item := range items {
		if item.ProjectID != projectID {
			continue
		}
		for _, allowedEnv := range item.Environments {
			if allowedEnv == environment || allowedEnv == "*" || allowedEnv == "all" {
				return true, nil
			}
		}
	}
	return false, nil
}

func createProjectAccessOverride(projectID, userID int, environments []string, permission, reason string, expiresAt time.Time, createdBy *int) (*projectAccessOverride, error) {
	if projectID <= 0 || userID <= 0 || expiresAt.IsZero() {
		return nil, fmt.Errorf("project, user, and expiry are required")
	}
	var createdAny any
	if createdBy != nil && *createdBy > 0 {
		createdAny = *createdBy
	}
	_, err := execContext(`
		INSERT INTO project_access_overrides (project_id, user_id, environments, permission, reason, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, projectID, userID, joinCSVList(environments), strings.TrimSpace(permission), strings.TrimSpace(reason), expiresAt, createdAny)
	if err != nil {
		return nil, err
	}
	items, err := listProjectAccessOverrides(false)
	if err != nil {
		return nil, err
	}
	for index := len(items) - 1; index >= 0; index-- {
		if items[index].ProjectID == projectID && items[index].UserID == userID && items[index].ExpiresAt.Equal(expiresAt) {
			return &items[index], nil
		}
	}
	return nil, fmt.Errorf("override not found after create")
}

func revokeProjectAccessOverride(id int, revokedBy *int) error {
	var revokedAny any
	if revokedBy != nil && *revokedBy > 0 {
		revokedAny = *revokedBy
	}
	_, err := execContext(`UPDATE project_access_overrides SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, revokedAny)
	return err
}

func listPromotionCenterItems() ([]promotionCenterItem, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT r.id, r.project_id, COALESCE(p.name,''), COALESCE(p.code,''), COALESCE(r.team,''), COALESCE(r.env,''), COALESCE(r.cloud,''),
		       COALESCE(r.service,''), COALESCE(r.status,''), COALESCE(r.client_name,''), r.updated_at
		FROM pr_requests r
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE COALESCE(r.status,'') IN ('completed', 'in_progress')
		  AND LOWER(COALESCE(r.env,'')) NOT IN ('prod', 'production')
		ORDER BY r.updated_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []promotionCenterItem{}
	for rows.Next() {
		var item promotionCenterItem
		var projectID sql.NullInt64
		if err := rows.Scan(&item.RequestID, &projectID, &item.ProjectName, &item.ProjectCode, &item.Team, &item.Environment, &item.Cloud, &item.Service, &item.Status, &item.ClientName, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if projectID.Valid {
			value := int(projectID.Int64)
			item.ProjectID = &value
		}
		item.NextEnvironment = nextEnv(item.Environment)
		var promotedID sql.NullInt64
		err := queryRowContext(`
			SELECT id, COALESCE(env,''), COALESCE(status,'')
			FROM pr_requests
			WHERE linked_request_id = $1
			ORDER BY created_at DESC
			LIMIT 1
		`, item.RequestID).Scan(&promotedID, &item.LatestPromotedEnv, &item.LatestPromotedStatus)
		if err == nil && promotedID.Valid {
			value := int(promotedID.Int64)
			item.LatestPromotedID = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func enrichPromotionItemsWithDeploymentGates(items []promotionCenterItem) error {
	projectGateCache := make(map[int]*projectReleaseDashboard)
	projectExistsCache := make(map[int]bool)

	for index := range items {
		targetEnvironment := items[index].NextEnvironment
		if strings.TrimSpace(targetEnvironment) == "" {
			items[index].Gate = buildPromotionGateDecision(
				targetEnvironment,
				nil,
				"This request is already in the highest configured environment and cannot be promoted further.",
				true,
			)
			continue
		}

		if items[index].ProjectID == nil || *items[index].ProjectID <= 0 {
			items[index].Gate = buildPromotionGateDecision(
				targetEnvironment,
				nil,
				"This request is not linked to a project catalog entry. Review it manually before promotion.",
				false,
			)
			continue
		}

		projectID := *items[index].ProjectID
		dashboard, cached := projectGateCache[projectID]
		projectExists, hasExistsValue := projectExistsCache[projectID]
		if !cached {
			project, err := getProjectCatalogByID(projectID)
			if err != nil {
				return err
			}
			projectExists = project != nil
			projectExistsCache[projectID] = projectExists
			if projectExists {
				builtDashboard, err := buildProjectReleaseDashboard(*project)
				if err != nil {
					return err
				}
				dashboard = builtDashboard
			}
			projectGateCache[projectID] = dashboard
			hasExistsValue = true
		}

		if hasExistsValue && !projectExists {
			items[index].Gate = buildPromotionGateDecision(
				targetEnvironment,
				nil,
				"This request references a project that is no longer available in the catalog. Review it manually before promotion.",
				false,
			)
			continue
		}

		gate := findDeploymentGateEnvironment(dashboard.DeploymentGates, targetEnvironment)
		if gate == nil {
			items[index].Gate = buildPromotionGateDecision(
				targetEnvironment,
				nil,
				fmt.Sprintf("%s is not configured as a deployment gate target for this project.", strings.ToUpper(strings.TrimSpace(targetEnvironment))),
				true,
			)
			continue
		}
		items[index].Gate = buildPromotionGateDecision(targetEnvironment, gate, "", false)
	}

	return nil
}

func evaluatePromotionGateForRequest(req *PRRequest) (*promotionGateDecision, error) {
	if req == nil {
		return buildPromotionGateDecision("", nil, "The source request could not be loaded for gate evaluation.", true), nil
	}

	targetEnvironment := nextEnv(req.Env)
	if strings.TrimSpace(targetEnvironment) == "" {
		return buildPromotionGateDecision(
			req.Env,
			nil,
			"This request is already in the highest configured environment and cannot be promoted further.",
			true,
		), nil
	}

	if req.ProjectID == nil || *req.ProjectID <= 0 {
		return buildPromotionGateDecision(
			targetEnvironment,
			nil,
			"This request is not linked to a project catalog entry. Review it manually before promotion.",
			false,
		), nil
	}

	project, err := getProjectCatalogByID(*req.ProjectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return buildPromotionGateDecision(
			targetEnvironment,
			nil,
			"This request references a project that is no longer available in the catalog. Review it manually before promotion.",
			false,
		), nil
	}

	dashboard, err := buildProjectReleaseDashboard(*project)
	if err != nil {
		return nil, err
	}
	gate := findDeploymentGateEnvironment(dashboard.DeploymentGates, targetEnvironment)
	if gate == nil {
		return buildPromotionGateDecision(
			targetEnvironment,
			nil,
			fmt.Sprintf("%s is not configured as a deployment gate target for this project.", strings.ToUpper(strings.TrimSpace(targetEnvironment))),
			true,
		), nil
	}
	return buildPromotionGateDecision(targetEnvironment, gate, "", false), nil
}

func promoteRequestAsDevops(requestID int, userID int, acknowledgeAttention bool) (*PRRequest, *promotionGateDecision, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, nil, err
	}
	if req == nil {
		return nil, nil, fmt.Errorf("request not found")
	}
	if req.Status != "completed" && req.Status != "in_progress" {
		return nil, nil, fmt.Errorf("only completed or in-progress requests can be promoted")
	}
	nextEnvironment := nextEnv(req.Env)
	if nextEnvironment == "" {
		return nil, nil, fmt.Errorf("request is already at the highest environment")
	}

	gate, err := evaluatePromotionGateForRequest(req)
	if err != nil {
		return nil, nil, err
	}
	if gate != nil {
		if gate.Status == "blocked" {
			return nil, gate, fmt.Errorf("promotion blocked by deployment gate policy")
		}
		if gate.RequiresAcknowledgement && !acknowledgeAttention {
			return nil, gate, fmt.Errorf("promotion requires deployment gate acknowledgement")
		}
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		return nil, nil, err
	}
	filePath, branchName := BuildRequestGitArtifacts(req.Team, nextEnvironment, appID)
	createdBy := req.CreatedBy
	if createdBy == nil && userID > 0 {
		createdBy = &userID
	}
	newReq := &PRRequest{
		ProjectID:     req.ProjectID,
		Team:          req.Team,
		Env:           nextEnvironment,
		Cloud:         req.Cloud,
		Service:       req.Service,
		ClientName:    req.ClientName + " (promoted from " + req.Env + ")",
		ApplicationID: appID,
		Priority:      req.Priority,
		DueDate:       req.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        req.Config,
		CreatedBy:     createdBy,
	}
	if err := SavePRRequest(newReq); err != nil {
		return nil, gate, err
	}
	_, _ = execContext(`UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2`, requestID, newReq.ID)
	auditDetails := fmt.Sprintf("devops:%d->%s", requestID, nextEnvironment)
	if gate != nil && gate.RequiresAcknowledgement {
		auditDetails += ":acknowledged"
	}
	AppendAuditLog(&userID, "request_promote", "pr_request", strconv.Itoa(newReq.ID), auditDetails)
	return newReq, gate, nil
}

func listOpsDeliveryFailures(statusFilter string) ([]opsDeliveryFailure, error) {
	query := `
		SELECT id, job_type, target, payload, error_message, status, retry_count, last_retry_at, created_at, updated_at
		FROM ops_delivery_failures
	`
	args := []any{}
	if strings.TrimSpace(statusFilter) != "" {
		query += ` WHERE status = $1`
		args = append(args, strings.TrimSpace(statusFilter))
	}
	query += ` ORDER BY updated_at DESC, created_at DESC`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []opsDeliveryFailure{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []opsDeliveryFailure{}
	for rows.Next() {
		var item opsDeliveryFailure
		var lastRetryAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.JobType, &item.Target, &item.Payload, &item.ErrorMessage, &item.Status, &item.RetryCount, &lastRetryAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if lastRetryAt.Valid {
			item.LastRetryAt = &lastRetryAt.Time
		}
		out = append(out, item)
	}
	return out, nil
}

func recordOpsDeliveryFailure(jobType, target string, payload any, execErr error) {
	if DB == nil || execErr == nil {
		return
	}
	body, _ := json.Marshal(payload)
	_, _ = execContext(`
		INSERT INTO ops_delivery_failures (job_type, target, payload, error_message, status)
		VALUES ($1, $2, $3, $4, 'open')
	`, strings.TrimSpace(jobType), strings.TrimSpace(target), string(body), execErr.Error())
}

func retryOpsDeliveryFailure(id int) (*opsDeliveryFailure, error) {
	var failure opsDeliveryFailure
	var lastRetryAt sql.NullTime
	err := queryRowContext(`
		SELECT id, job_type, target, payload, error_message, status, retry_count, last_retry_at, created_at, updated_at
		FROM ops_delivery_failures
		WHERE id = $1
	`, id).Scan(&failure.ID, &failure.JobType, &failure.Target, &failure.Payload, &failure.ErrorMessage, &failure.Status, &failure.RetryCount, &lastRetryAt, &failure.CreatedAt, &failure.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if lastRetryAt.Valid {
		failure.LastRetryAt = &lastRetryAt.Time
	}
	var retryErr error
	switch failure.JobType {
	case "webhook":
		var job WebhookJob
		if err := json.Unmarshal([]byte(failure.Payload), &job); err != nil {
			retryErr = err
			break
		}
		retryErr = executeWebhookJob(job)
	case "notification_email":
		var job NotificationEmailJob
		if err := json.Unmarshal([]byte(failure.Payload), &job); err != nil {
			retryErr = err
			break
		}
		user, err := GetUserByID(job.UserID)
		if err != nil || user == nil || user.Email == "" {
			retryErr = fmt.Errorf("email recipient not available")
			break
		}
		retryErr = SendEmail(user.Email, job.Subject, job.Body)
	default:
		retryErr = fmt.Errorf("unsupported retry type %s", failure.JobType)
	}
	if retryErr != nil {
		_, _ = execContext(`
			UPDATE ops_delivery_failures
			SET status = 'failed', retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP, error_message = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, id, retryErr.Error())
		failure.Status = "failed"
		failure.RetryCount++
		failure.ErrorMessage = retryErr.Error()
		now := time.Now()
		failure.LastRetryAt = &now
		failure.UpdatedAt = now
		return &failure, retryErr
	}
	_, _ = execContext(`
		UPDATE ops_delivery_failures
		SET status = 'resolved', retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id)
	failure.Status = "resolved"
	failure.RetryCount++
	now := time.Now()
	failure.LastRetryAt = &now
	failure.UpdatedAt = now
	return &failure, nil
}

func devopsRunbooksHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
		runbooks, err := listProjectRunbooks(projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list runbooks", err)
			return
		}
		projects, _ := listProjectCatalogs()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"runbooks": runbooks, "projects": projects, "status": "ok"})
	case "POST":
		var body struct {
			ProjectID int    `json:"project_id"`
			Service   string `json:"service"`
			Title     string `json:"title"`
			Content   string `json:"content"`
			LinkURL   string `json:"link_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		runbook, err := createProjectRunbook(body.ProjectID, body.Service, body.Title, body.Content, body.LinkURL, &managerID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&managerID, "project_runbook_create", "project_runbook", strconv.Itoa(runbook.ID), runbook.Title)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"runbook": runbook, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsRunbookDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/runbooks/"), "/")
	id, err := strconv.Atoi(path)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid runbook id", err)
		return
	}
	switch r.Method {
	case "PATCH":
		var body struct {
			Service string `json:"service"`
			Title   string `json:"title"`
			Content string `json:"content"`
			LinkURL string `json:"link_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		runbook, err := updateProjectRunbook(id, body.Service, body.Title, body.Content, body.LinkURL)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&managerID, "project_runbook_update", "project_runbook", strconv.Itoa(id), runbook.Title)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"runbook": runbook, "status": "ok"})
	case "DELETE":
		if err := deleteProjectRunbook(id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to delete runbook", err)
			return
		}
		AppendAuditLog(&managerID, "project_runbook_delete", "project_runbook", strconv.Itoa(id), "")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsIncidentsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		items, err := listRequestIncidents(strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list incidents", err)
			return
		}
		devopsUsers, _ := GetDevopsUsers()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"incidents": items, "owners": devopsUsers, "status": "ok"})
	case "POST":
		var body struct {
			RequestID       int    `json:"request_id"`
			Severity        string `json:"severity"`
			Status          string `json:"status"`
			EscalationLevel string `json:"escalation_level"`
			OwnerUserID     *int   `json:"owner_user_id"`
			Summary         string `json:"summary"`
			Notes           string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		item, err := createOrUpdateRequestIncident(body.RequestID, body.Severity, body.Status, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes, &managerID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&managerID, "request_incident_upsert", "pr_request", strconv.Itoa(body.RequestID), item.Severity+":"+item.Status)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"incident": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsIncidentDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/incidents/"), "/")
	id, err := strconv.Atoi(path)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid incident id", err)
		return
	}
	if r.Method != "PATCH" {
		writeMethodNotAllowed(w, r)
		return
	}
	var requestID int
	err = queryRowContext(`SELECT request_id FROM request_incidents WHERE id = $1`, id).Scan(&requestID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
		return
	}
	var body struct {
		Severity        string `json:"severity"`
		Status          string `json:"status"`
		EscalationLevel string `json:"escalation_level"`
		OwnerUserID     *int   `json:"owner_user_id"`
		Summary         string `json:"summary"`
		Notes           string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	item, err := createOrUpdateRequestIncident(requestID, body.Severity, body.Status, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes, &managerID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	AppendAuditLog(&managerID, "request_incident_update", "pr_request", strconv.Itoa(requestID), item.Severity+":"+item.Status)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"incident": item, "status": "ok"})
}

func devopsAccessOverridesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		overrides, err := listProjectAccessOverrides(r.URL.Query().Get("active") != "false")
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list access overrides", err)
			return
		}
		projects, _ := listProjectCatalogs()
		users, _ := listPortalUsers()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"overrides": overrides, "projects": projects, "users": users, "status": "ok"})
	case "POST":
		var body struct {
			ProjectID    int      `json:"project_id"`
			UserID       int      `json:"user_id"`
			Environments []string `json:"environments"`
			Permission   string   `json:"permission"`
			Reason       string   `json:"reason"`
			ExpiresAt    string   `json:"expires_at"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(body.ExpiresAt))
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "expires_at must be an RFC3339 datetime", err)
			return
		}
		item, err := createProjectAccessOverride(body.ProjectID, body.UserID, body.Environments, body.Permission, body.Reason, expiresAt, &managerID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&managerID, "project_access_override_create", "project", strconv.Itoa(body.ProjectID), fmt.Sprintf("user_id=%d", body.UserID))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"override": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsAccessOverrideDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if r.Method != "DELETE" {
		writeMethodNotAllowed(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/access-overrides/"), "/")
	id, err := strconv.Atoi(path)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid override id", err)
		return
	}
	if err := revokeProjectAccessOverride(id, &managerID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to revoke access override", err)
		return
	}
	AppendAuditLog(&managerID, "project_access_override_revoke", "project_access_override", strconv.Itoa(id), "")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
}

func devopsPromotionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		items, err := listPromotionCenterItems()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list promotions", err)
			return
		}
		if err := enrichPromotionItemsWithDeploymentGates(items); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to evaluate promotion gates", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"promotions": items, "status": "ok"})
	case "POST":
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/promotions/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) != 2 || parts[1] != "promote" {
			http.NotFound(w, r)
			return
		}
		requestID, err := strconv.Atoi(parts[0])
		if err != nil || requestID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid request id", err)
			return
		}
		var body struct {
			AcknowledgeAttention bool `json:"acknowledge_attention"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
				writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
				return
			}
		}
		item, gate, err := promoteRequestAsDevops(requestID, managerID, body.AcknowledgeAttention)
		if err != nil {
			if gate != nil && (gate.Status == "blocked" || gate.RequiresAcknowledgement) {
				status := http.StatusConflict
				message := "promotion blocked by deployment gate policy"
				if gate.RequiresAcknowledgement {
					message = "deployment gate acknowledgement is required before promotion"
				}
				if writeErr := writeJSONResponse(w, status, map[string]any{
					"status": "error",
					"error":  message,
					"gate":   gate,
				}); writeErr != nil {
					writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion gate response", writeErr)
				}
				return
			}
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"request": item, "gate": gate, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsRetryCenterHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	_, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := listOpsDeliveryFailures(strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list retry-center failures", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"failures": items, "status": "ok"})
}

func devopsRetryCenterDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/retry-center/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "retry" {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid failure id", err)
		return
	}
	item, retryErr := retryOpsDeliveryFailure(id)
	if item != nil {
		AppendAuditLog(&managerID, "ops_delivery_retry", "ops_delivery_failure", strconv.Itoa(id), item.JobType+":"+item.Status)
	}
	if retryErr != nil {
		w.WriteHeader(http.StatusBadRequest)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"failure": item, "error": errorString(retryErr), "status": "ok"})
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
