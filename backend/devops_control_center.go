package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	ID                    int                 `json:"id"`
	IncidentNumber        string              `json:"incident_number"`
	RequestID             int                 `json:"request_id"`
	ProjectID             *int                `json:"project_id,omitempty"`
	ProjectName           string              `json:"project_name,omitempty"`
	ProjectCode           string              `json:"project_code,omitempty"`
	RequestTeam           string              `json:"request_team,omitempty"`
	RequestEnv            string              `json:"request_env,omitempty"`
	RequestService        string              `json:"request_service,omitempty"`
	RequestCloud          string              `json:"request_cloud,omitempty"`
	RequestStatus         string              `json:"request_status,omitempty"`
	TeamID                *int                `json:"team_id,omitempty"`
	TeamName              string              `json:"team_name,omitempty"`
	Severity              string              `json:"severity"`
	Status                string              `json:"status"`
	EscalationLevel       string              `json:"escalation_level"`
	OwnerUserID           *int                `json:"owner_user_id,omitempty"`
	OwnerUsername         string              `json:"owner_username,omitempty"`
	Summary               string              `json:"summary"`
	Notes                 string              `json:"notes"`
	Source                string              `json:"source,omitempty"`
	Fingerprint           string              `json:"fingerprint,omitempty"`
	AlertSource           string              `json:"alert_source,omitempty"`
	DashboardURL          string              `json:"dashboard_url,omitempty"`
	SuspectedChangeID     *int                `json:"suspected_change_id,omitempty"`
	SuspectedChangeNumber string              `json:"suspected_change_number,omitempty"`
	Service               string              `json:"service,omitempty"`
	Environment           string              `json:"environment,omitempty"`
	OccurrenceCount       int                 `json:"occurrence_count,omitempty"`
	LastSeenAt            *time.Time          `json:"last_seen_at,omitempty"`
	RollbackHint          string              `json:"rollback_hint,omitempty"`
	RollbackPlan          *changeRollbackPlan `json:"rollback_plan,omitempty"`
	Major                 bool                `json:"major,omitempty"`
	StatusNote            string              `json:"status_note,omitempty"`
	SlackThread           string              `json:"slack_thread,omitempty"`
	ProblemID             *int                `json:"problem_id,omitempty"`
	SilencedUntil         *time.Time          `json:"silenced_until,omitempty"`
	CausedBy              string              `json:"caused_by,omitempty"`
	CreatedBy             *int                `json:"created_by,omitempty"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
	ExternalProvider      string              `json:"external_provider,omitempty"`
	ExternalID            string              `json:"external_id,omitempty"`
	CallerUserID          *int                `json:"caller_user_id,omitempty"`
	CallerUsername        string              `json:"caller_username,omitempty"`
	Category              string              `json:"category,omitempty"`
	Subcategory           string              `json:"subcategory,omitempty"`
	ParentIncidentID      *int                `json:"parent_incident_id,omitempty"`
	ParentIncidentNumber  string              `json:"parent_incident_number,omitempty"`
	ChildIncidents        []incidentChildRef  `json:"child_incidents,omitempty"`
	ConferenceURL         string              `json:"conference_url,omitempty"`
	ConferenceNotes       string              `json:"conference_notes,omitempty"`
	SLA                   *incidentSLA        `json:"sla,omitempty"`
}

func formatIncidentNumber(id int) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("INC%07d", id)
}

func nextRequestIncidentNumber() (string, error) {
	var nextNumber int
	err := queryRowContext(`
		SELECT COALESCE(MAX(CAST(SUBSTRING(incident_number FROM 4) AS INTEGER)), 0) + 1
		FROM request_incidents
		WHERE COALESCE(incident_number, '') <> ''
	`).Scan(&nextNumber)
	if err != nil {
		return "", err
	}
	if nextNumber <= 0 {
		nextNumber = 1
	}
	return formatIncidentNumber(nextNumber), nil
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
	Email    string `json:"email,omitempty"`
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
	rows, cancel, err := queryRowsWithTimeout(`SELECT id, username, COALESCE(email,'') FROM users WHERE COALESCE(user_type, 'portal_user') = 'portal_user' ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []simpleUserOption{}
	for rows.Next() {
		var user simpleUserOption
		if err := rows.Scan(&user.ID, &user.Username, &user.Email); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, nil
}

func listProjectRunbooks(projectID int) ([]projectRunbook, error) {
	if DB == nil {
		return []projectRunbook{}, nil
	}
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
	return listRequestIncidentsFiltered(statusFilter, nil, true)
}

func listAssignedRequestIncidents(userID int, statusFilter string) ([]requestIncident, error) {
	return listRequestIncidentsFiltered(statusFilter, &userID, false)
}

func listRequestIncidentsFiltered(statusFilter string, ownerUserID *int, includeDraft bool) ([]requestIncident, error) {
	if DB == nil {
		return []requestIncident{}, nil
	}
	query := `
		SELECT i.id, COALESCE(i.incident_number,''), i.request_id, i.project_id, COALESCE(p.name,''), COALESCE(p.code,''),
		       COALESCE(r.team,''), COALESCE(NULLIF(i.environment,''), r.env, ''), COALESCE(NULLIF(i.service,''), r.service, ''), COALESCE(r.cloud,''), COALESCE(r.status,''),
		       i.team_id, COALESCE(t.name,''),
		       i.severity, i.status, i.escalation_level, i.owner_user_id, COALESCE(u.username,''), COALESCE(i.summary,''), COALESCE(i.notes,''),
		       COALESCE(i.source,'ticket'), COALESCE(i.fingerprint,''), COALESCE(i.alert_source,''), COALESCE(i.dashboard_url,''),
		       i.suspected_change_id, COALESCE(chg.change_number,''), COALESCE(i.service,''), COALESCE(i.environment,''), COALESCE(i.occurrence_count,1), i.last_seen_at,
		       i.created_by, i.created_at, i.updated_at,
		       COALESCE(i.major, false), COALESCE(i.status_note,''), COALESCE(i.slack_thread,''), i.problem_id, i.silenced_until,
		       COALESCE(i.external_provider,''), COALESCE(i.external_id,'')
		FROM request_incidents i
		LEFT JOIN pr_requests r ON r.id = i.request_id
		LEFT JOIN projects p ON p.id = i.project_id
		LEFT JOIN teams t ON t.id = i.team_id
		LEFT JOIN users u ON u.id = i.owner_user_id
		LEFT JOIN change_requests chg ON chg.id = i.suspected_change_id
	`
	args := []any{}
	whereParts := []string{}
	if trimmedStatus := strings.TrimSpace(statusFilter); trimmedStatus != "" {
		args = append(args, trimmedStatus)
		whereParts = append(whereParts, fmt.Sprintf("i.status = $%d", len(args)))
	}
	if ownerUserID != nil && *ownerUserID > 0 {
		args = append(args, *ownerUserID)
		whereParts = append(whereParts, fmt.Sprintf("i.owner_user_id = $%d", len(args)))
	}
	if !includeDraft {
		whereParts = append(whereParts, "COALESCE(i.status, '') <> 'draft'")
	}
	if len(whereParts) > 0 {
		query += ` WHERE ` + strings.Join(whereParts, " AND ")
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
		var requestID, projectID, incidentTeamID, incidentOwnerUserID, createdBy, suspectedChangeID, problemID sql.NullInt64
		var lastSeen, silencedUntil sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.IncidentNumber, &requestID, &projectID, &item.ProjectName, &item.ProjectCode,
			&item.RequestTeam, &item.RequestEnv, &item.RequestService, &item.RequestCloud, &item.RequestStatus,
			&incidentTeamID, &item.TeamName,
			&item.Severity, &item.Status, &item.EscalationLevel, &incidentOwnerUserID, &item.OwnerUsername, &item.Summary, &item.Notes,
			&item.Source, &item.Fingerprint, &item.AlertSource, &item.DashboardURL,
			&suspectedChangeID, &item.SuspectedChangeNumber, &item.Service, &item.Environment, &item.OccurrenceCount, &lastSeen,
			&createdBy, &item.CreatedAt, &item.UpdatedAt,
			&item.Major, &item.StatusNote, &item.SlackThread, &problemID, &silencedUntil,
			&item.ExternalProvider, &item.ExternalID,
		); err != nil {
			return nil, err
		}
		if requestID.Valid {
			item.RequestID = int(requestID.Int64)
		}
		if suspectedChangeID.Valid {
			value := int(suspectedChangeID.Int64)
			item.SuspectedChangeID = &value
		}
		if lastSeen.Valid {
			item.LastSeenAt = &lastSeen.Time
		}
		if projectID.Valid {
			value := int(projectID.Int64)
			item.ProjectID = &value
		}
		if incidentTeamID.Valid {
			value := int(incidentTeamID.Int64)
			item.TeamID = &value
		}
		if incidentOwnerUserID.Valid {
			value := int(incidentOwnerUserID.Int64)
			item.OwnerUserID = &value
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			item.CreatedBy = &value
		}
		if problemID.Valid {
			value := int(problemID.Int64)
			item.ProblemID = &value
		}
		if silencedUntil.Valid {
			item.SilencedUntil = &silencedUntil.Time
		}
		if strings.TrimSpace(item.IncidentNumber) == "" {
			item.IncidentNumber = formatIncidentNumber(item.ID)
		}
		out = append(out, item)
	}
	return hydrateIncidentsITSM(out), nil
}

func getRequestIncidentByRequestID(requestID int) (*requestIncident, error) {
	if requestID <= 0 {
		return nil, fmt.Errorf("request id is required")
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
	return nil, fmt.Errorf("incident not found")
}

func listPortalIncidentTeams() ([]Team, error) {
	teams, err := GetTeams()
	if err != nil {
		return nil, err
	}
	filtered := make([]Team, 0, len(teams))
	for _, team := range teams {
		if strings.ToLower(strings.TrimSpace(team.TeamType)) == "devops" {
			continue
		}
		filtered = append(filtered, team)
	}
	return filtered, nil
}

func listPortalIncidentTeamMembersByTeam() (map[string]any, error) {
	teams, err := listPortalIncidentTeams()
	if err != nil {
		return nil, err
	}
	membersByTeam := make(map[string]any, len(teams))
	for _, team := range teams {
		members, err := GetTeamMembers(team.ID)
		if err != nil {
			return nil, err
		}
		membersByTeam[strconv.Itoa(team.ID)] = members
	}
	return membersByTeam, nil
}

func createStandaloneIncident(teamID *int, severity, status, escalationLevel string, ownerUserID *int, summary, notes string, createdBy *int, projectID int, service, environment string) (*requestIncident, error) {
	severity = itsmPriorityToSeverity(severity)
	status = normalizeIncidentStatus(status)
	if status == "" {
		status = "open"
	}
	escalationLevel = strings.ToLower(strings.TrimSpace(escalationLevel))
	if escalationLevel == "" {
		escalationLevel = "monitoring"
	}
	var teamAny any
	if teamID != nil && *teamID > 0 {
		teamAny = *teamID
	}
	var ownerAny any
	if ownerUserID != nil && *ownerUserID > 0 {
		ownerAny = *ownerUserID
	}
	var createdAny any
	if createdBy != nil && *createdBy > 0 {
		createdAny = *createdBy
	}
	var projectAny any
	if projectID > 0 {
		projectAny = projectID
	}
	var incidentID int
	err := queryRowContext(`
		INSERT INTO request_incidents (request_id, project_id, team_id, severity, status, escalation_level, owner_user_id, summary, notes, created_by, source, service, environment)
		VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11)
		RETURNING id
	`, projectAny, teamAny, severity, status, escalationLevel, ownerAny, strings.TrimSpace(summary), strings.TrimSpace(notes), createdAny, strings.TrimSpace(service), strings.TrimSpace(environment)).Scan(&incidentID)
	if err != nil {
		return nil, err
	}
	if _, err := execContext(`
		UPDATE request_incidents
		SET incident_number = $2
		WHERE id = $1 AND COALESCE(incident_number, '') = ''
	`, incidentID, formatIncidentNumber(incidentID)); err != nil {
		return nil, err
	}
	return getRequestIncidentByID(incidentID)
}

func createOrUpdateRequestIncident(requestID int, teamID *int, severity, status, escalationLevel string, ownerUserID *int, summary, notes string, createdBy *int) (*requestIncident, error) {
	if requestID <= 0 {
		return createStandaloneIncident(teamID, severity, status, escalationLevel, ownerUserID, summary, notes, createdBy, 0, "", "")
	}
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, fmt.Errorf("request not found")
	}
	severity = itsmPriorityToSeverity(severity)
	status = normalizeIncidentStatus(status)
	if status == "" {
		status = "open"
	}
	escalationLevel = strings.ToLower(strings.TrimSpace(escalationLevel))
	if escalationLevel == "" {
		escalationLevel = "monitoring"
	}
	var normalizedTeamID *int
	if teamID != nil && *teamID > 0 {
		team, err := GetTeamByID(*teamID)
		if err != nil {
			return nil, err
		}
		if team == nil || strings.ToLower(strings.TrimSpace(team.TeamType)) == "devops" {
			return nil, fmt.Errorf("a valid portal team is required")
		}
		value := team.ID
		normalizedTeamID = &value
	} else if team, err := GetTeamByNameOrSlug(strings.TrimSpace(req.Team)); err == nil && team != nil && strings.ToLower(strings.TrimSpace(team.TeamType)) != "devops" {
		value := team.ID
		normalizedTeamID = &value
	}
	var ownerAny any
	if ownerUserID != nil && *ownerUserID > 0 {
		if normalizedTeamID == nil || *normalizedTeamID <= 0 {
			return nil, fmt.Errorf("team is required when assigning an incident owner")
		}
		members, err := GetTeamMembers(*normalizedTeamID)
		if err != nil {
			return nil, err
		}
		ownerAllowed := false
		for _, member := range members {
			if member.UserID == *ownerUserID {
				ownerAllowed = true
				break
			}
		}
		if !ownerAllowed {
			return nil, fmt.Errorf("assigned owner must belong to the selected team")
		}
		ownerAny = *ownerUserID
	}
	var teamAny any
	if normalizedTeamID != nil && *normalizedTeamID > 0 {
		teamAny = *normalizedTeamID
	}
	var createdAny any
	if createdBy != nil && *createdBy > 0 {
		createdAny = *createdBy
	}
	var incidentID int
	err = queryRowContext(`
		INSERT INTO request_incidents (request_id, project_id, team_id, severity, status, escalation_level, owner_user_id, summary, notes, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (request_id)
		DO UPDATE SET
			project_id = EXCLUDED.project_id,
			team_id = EXCLUDED.team_id,
			severity = EXCLUDED.severity,
			status = EXCLUDED.status,
			escalation_level = EXCLUDED.escalation_level,
			owner_user_id = EXCLUDED.owner_user_id,
			summary = EXCLUDED.summary,
			notes = EXCLUDED.notes,
			updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, requestID, req.ProjectID, teamAny, severity, status, escalationLevel, ownerAny, strings.TrimSpace(summary), strings.TrimSpace(notes), createdAny).Scan(&incidentID)
	if err != nil {
		return nil, err
	}
	if incidentID > 0 {
		if _, err := execContext(`
			UPDATE request_incidents
			SET incident_number = $2
			WHERE id = $1
			  AND COALESCE(incident_number, '') = ''
		`, incidentID, formatIncidentNumber(incidentID)); err != nil {
			return nil, err
		}
	}
	item, err := getRequestIncidentByRequestID(requestID)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func getRequestIncidentByID(id int) (*requestIncident, error) {
	if id <= 0 {
		return nil, fmt.Errorf("incident not found")
	}
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ID == id {
			return &item, nil
		}
	}
	return nil, fmt.Errorf("incident not found")
}

func findOpenAlertIncident(source, fingerprint string) (*requestIncident, error) {
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	needleSource := strings.ToLower(strings.TrimSpace(source))
	needlePrint := strings.TrimSpace(fingerprint)
	for i := range items {
		item := items[i]
		if strings.TrimSpace(item.Fingerprint) != needlePrint {
			continue
		}
		if strings.ToLower(strings.TrimSpace(item.AlertSource)) != needleSource && strings.ToLower(strings.TrimSpace(item.Source)) != needleSource {
			continue
		}
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status == "resolved" || status == "closed" {
			continue
		}
		return &item, nil
	}
	return nil, nil
}

func upsertAlertIncident(event parsedAlertEvent) (*requestIncident, string, error) {
	if DB == nil {
		return nil, "", fmt.Errorf("database not available")
	}
	existing, err := findOpenAlertIncident(event.Source, event.Fingerprint)
	if err != nil {
		return nil, "", err
	}
	if existing != nil && existing.SilencedUntil != nil && time.Now().Before(*existing.SilencedUntil) {
		_, err := execContext(`
			UPDATE request_incidents
			SET last_seen_at = CURRENT_TIMESTAMP, occurrence_count = occurrence_count + 1, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existing.ID)
		if err != nil {
			return nil, "", err
		}
		item, getErr := getRequestIncidentByID(existing.ID)
		return item, "silenced", getErr
	}
	if existing != nil && shouldAutoResolveAlert(existing.Severity, event.Status) {
		_, err := execContext(`
			UPDATE request_incidents
			SET status = 'monitoring', last_seen_at = CURRENT_TIMESTAMP, occurrence_count = occurrence_count + 1, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existing.ID)
		if err != nil {
			return nil, "", err
		}
		item, getErr := getRequestIncidentByID(existing.ID)
		return item, "resolved", getErr
	}
	if existing != nil && (event.Status == "resolved" || event.Status == "ok" || event.Status == "normal") && isSEV1Severity(existing.Severity) {
		_, err := execContext(`
			UPDATE request_incidents
			SET last_seen_at = CURRENT_TIMESTAMP, occurrence_count = occurrence_count + 1, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existing.ID)
		if err != nil {
			return nil, "", err
		}
		item, getErr := getRequestIncidentByID(existing.ID)
		return item, "resolve_skipped", getErr
	}
	if existing != nil {
		var suspectedAny any
		if existing.SuspectedChangeID == nil {
			if suspected := findSuspectedChange(event.Service, event.Environment, existing.ProjectID); suspected != nil {
				suspectedAny = suspected.ID
			}
		}
		_, err := execContext(`
			UPDATE request_incidents
			SET last_seen_at = CURRENT_TIMESTAMP,
			    occurrence_count = occurrence_count + 1,
			    summary = CASE WHEN COALESCE($2,'') = '' THEN summary ELSE $2 END,
			    notes = CASE WHEN COALESCE($3,'') = '' THEN notes ELSE $3 END,
			    dashboard_url = CASE WHEN COALESCE($4,'') = '' THEN dashboard_url ELSE $4 END,
			    suspected_change_id = COALESCE(suspected_change_id, $5),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existing.ID, event.Title, event.Message, event.DashboardURL, suspectedAny)
		if err == nil {
			go FireOutboundWebhooks("incident.updated", map[string]interface{}{
				"id": existing.ID, "fingerprint": event.Fingerprint, "severity": existing.Severity,
			})
		}
		if err != nil {
			return nil, "", err
		}
		item, getErr := getRequestIncidentByID(existing.ID)
		if getErr == nil && item != nil {
			_, _ = upsertProblemFromIncident(*item)
		}
		return item, "updated", getErr
	}
	var projectID *int
	if event.BoundProject > 0 {
		value := event.BoundProject
		projectID = &value
	} else {
		projectID = lookupProjectID(event.ProjectID, event.ProjectCode)
	}
	if projectID == nil && event.BoundProject <= 0 {
		if mapped := lookupServiceMap(event.Service, "", event.Environment); mapped != nil {
			projectID = mapped.ProjectID
			if event.Service == "" {
				event.Service = mapped.Service
			}
			if event.DashboardURL == "" {
				event.DashboardURL = mapped.DashboardURL
			}
		}
	}
	var projectAny any
	if projectID != nil {
		projectAny = *projectID
	}
	var suspectedAny any
	if suspected := findSuspectedChange(event.Service, event.Environment, projectID); suspected != nil {
		suspectedAny = suspected.ID
	}
	var ownerAny any
	if ownerID := activeOncallUserID(); ownerID != nil && (event.Severity == "high" || event.Severity == "critical") {
		ownerAny = *ownerID
	}
	notes := event.Message
	if guides := matchRunbooksForService(projectID, event.Service); len(guides) > 0 {
		guide := guides[0]
		prefix := "Guide: " + guide.Title
		if strings.TrimSpace(guide.LinkURL) != "" {
			prefix += " — " + strings.TrimSpace(guide.LinkURL)
		}
		if notes == "" {
			notes = prefix
		} else {
			notes = prefix + "\n\n" + notes
		}
	}
	var incidentID int
	err = queryRowContext(`
		INSERT INTO request_incidents (
			request_id, project_id, severity, status, escalation_level, owner_user_id, summary, notes,
			source, fingerprint, alert_source, dashboard_url, suspected_change_id, service, environment, occurrence_count, last_seen_at
		) VALUES (
			NULL, $1, $2, 'open', 'monitoring', $3, $4, $5,
			'alert', $6, $7, $8, $9, $10, $11, 1, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, projectAny, event.Severity, ownerAny, event.Title, notes, event.Fingerprint, event.Source, event.DashboardURL, suspectedAny, event.Service, event.Environment).Scan(&incidentID)
	if err != nil {
		return nil, "", err
	}
	if _, err := execContext(`
		UPDATE request_incidents
		SET incident_number = $2
		WHERE id = $1 AND COALESCE(incident_number, '') = ''
	`, incidentID, formatIncidentNumber(incidentID)); err != nil {
		return nil, "", err
	}
	item, getErr := getRequestIncidentByID(incidentID)
	if getErr == nil && item != nil {
		_ = upsertIncidentITSM(item.ID, 0, 0, "", "", "", "", severityToITSMPriority(item.Severity), item.CreatedAt, item.Status)
		if problem, err := upsertProblemFromIncident(*item); err == nil && problem != nil {
			item.ProblemID = &problem.ID
		}
		item = hydrateOneIncidentITSM(item)
	}
	return item, "created", getErr
}

func activeOncallUserID() *int {
	for _, rotation := range listOncallRotations() {
		if rotation.Active && rotation.UserID > 0 {
			value := rotation.UserID
			return &value
		}
	}
	return nil
}

func matchRunbooksForService(projectID *int, service string) []projectRunbook {
	if projectID == nil || *projectID <= 0 {
		return nil
	}
	items, err := listProjectRunbooks(*projectID)
	if err != nil {
		return nil
	}
	needle := strings.ToLower(strings.TrimSpace(service))
	out := []projectRunbook{}
	for _, item := range items {
		if runbookMatchesService(item.Service, needle) {
			out = append(out, item)
		}
	}
	return out
}

func runbookMatchesService(runbookService, service string) bool {
	guide := strings.ToLower(strings.TrimSpace(runbookService))
	target := strings.ToLower(strings.TrimSpace(service))
	if guide == "" {
		return target != ""
	}
	if target == "" {
		return false
	}
	return guide == target || strings.Contains(target, guide) || strings.Contains(guide, target)
}

func normalizeIncidentStatus(status string) string {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(status), " ", "_")) {
	case "draft":
		return "draft"
	case "open", "new":
		return "open"
	case "acknowledged", "ack", "acked":
		return "acknowledged"
	case "investigating", "in_progress":
		return "investigating"
	case "on_hold", "hold", "waiting":
		return "on_hold"
	case "mitigating":
		return "mitigating"
	case "resolved", "success", "ok":
		return "resolved"
	case "closed", "complete", "completed":
		return "closed"
	case "cancelled", "canceled":
		return "cancelled"
	default:
		if status == "" {
			return "open"
		}
		return strings.ToLower(strings.TrimSpace(status))
	}
}

func incidentFinishStatus(action string) (status string, note string, ok bool) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "close":
		return "closed", "Closed.", true
	case "cancel":
		return "cancelled", "Cancelled.", true
	default:
		return "", "", false
	}
}

func incidentIsActive(status string) bool {
	switch normalizeIncidentStatus(status) {
	case "open", "acknowledged", "investigating", "mitigating", "on_hold":
		return true
	default:
		return false
	}
}

func incidentBlocksPromotion(item requestIncident) bool {
	if !incidentIsActive(item.Status) {
		return false
	}
	source := strings.ToLower(strings.TrimSpace(item.Source))
	if source == "alert" || source == "change_regression" {
		severity := strings.ToLower(strings.TrimSpace(item.Severity))
		return severity == "high" || severity == "critical"
	}
	return true
}

func incidentEnvironmentKey(item requestIncident) string {
	if env := strings.ToLower(strings.TrimSpace(item.Environment)); env != "" {
		return env
	}
	return strings.ToLower(strings.TrimSpace(item.RequestEnv))
}

func updateAlertIncidentByID(id int, teamID *int, severity, status, escalationLevel string, ownerUserID *int, summary, notes string) (*requestIncident, error) {
	severity = itsmPriorityToSeverity(severity)
	status = normalizeIncidentStatus(status)
	if status == "" {
		status = "open"
	}
	escalationLevel = strings.ToLower(strings.TrimSpace(escalationLevel))
	if escalationLevel == "" {
		escalationLevel = "monitoring"
	}
	var teamAny any
	if teamID != nil && *teamID > 0 {
		teamAny = *teamID
	}
	var ownerAny any
	if ownerUserID != nil && *ownerUserID > 0 {
		ownerAny = *ownerUserID
	}
	_, err := execContext(`
		UPDATE request_incidents
		SET team_id = $2, severity = $3, status = $4, escalation_level = $5, owner_user_id = $6,
		    summary = $7, notes = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, teamAny, severity, status, escalationLevel, ownerAny, strings.TrimSpace(summary), strings.TrimSpace(notes))
	if err != nil {
		return nil, err
	}
	return getRequestIncidentByID(id)
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
				nil,
				"This request references a project that is no longer available in the catalog. Review it manually before promotion.",
				false,
			)
			continue
		}

		gate := findDeploymentGateEnvironment(dashboard.DeploymentGates, targetEnvironment)
		if gate == nil {
			items[index].Gate = buildUngatedPromotionDecision(targetEnvironment)
			applyHighRiskMergePromotionCheck(items[index].Gate, items[index].RequestID, targetEnvironment)
			continue
		}
		approval, err := getActiveDeploymentGateApproval(items[index].RequestID, targetEnvironment, items[index].UpdatedAt)
		if err != nil {
			return err
		}
		history, err := listDeploymentGateApprovals(items[index].RequestID, targetEnvironment, items[index].UpdatedAt)
		if err != nil {
			return err
		}
		items[index].Gate = buildPromotionGateDecision(targetEnvironment, gate, approval, "", false)
		items[index].Gate.ApprovalHistory = history
		applyHighRiskMergePromotionCheck(items[index].Gate, items[index].RequestID, targetEnvironment)
	}

	return nil
}

func evaluatePromotionGateForRequest(req *PRRequest) (*promotionGateDecision, error) {
	if req == nil {
		return buildPromotionGateDecision("", nil, nil, "The source request could not be loaded for gate evaluation.", true), nil
	}

	targetEnvironment := nextEnv(req.Env)
	if strings.TrimSpace(targetEnvironment) == "" {
		return buildPromotionGateDecision(
			req.Env,
			nil,
			nil,
			"This request is already in the highest configured environment and cannot be promoted further.",
			true,
		), nil
	}

	if req.ProjectID == nil || *req.ProjectID <= 0 {
		return buildPromotionGateDecision(
			targetEnvironment,
			nil,
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
		decision := buildUngatedPromotionDecision(targetEnvironment)
		applyHighRiskMergePromotionCheck(decision, req.ID, targetEnvironment)
		return decision, nil
	}
	approval, err := getActiveDeploymentGateApproval(req.ID, targetEnvironment, req.UpdatedAt)
	if err != nil {
		return nil, err
	}
	history, err := listDeploymentGateApprovals(req.ID, targetEnvironment, req.UpdatedAt)
	if err != nil {
		return nil, err
	}
	decision := buildPromotionGateDecision(targetEnvironment, gate, approval, "", false)
	decision.ApprovalHistory = history
	applyHighRiskMergePromotionCheck(decision, req.ID, targetEnvironment)
	return decision, nil
}

func approvePromotionGateAsDevops(requestID int, userID int, note string, expiresInHours int) (*deploymentGateApprovalRecord, *promotionGateDecision, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, nil, err
	}
	if req == nil {
		return nil, nil, fmt.Errorf("request not found")
	}
	if req.Status != "completed" && req.Status != "in_progress" {
		return nil, nil, fmt.Errorf("only completed or in-progress requests can be reviewed for promotion")
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
		if gate.Approved && gate.Approval != nil {
			return gate.Approval, gate, nil
		}
		if !gate.RequiresAcknowledgement {
			return nil, gate, fmt.Errorf("deployment gate approval is not required for this promotion")
		}
	}
	trimmedNote := strings.TrimSpace(note)
	if gate != nil && gate.CommentRequired && trimmedNote == "" {
		return nil, gate, fmt.Errorf("a justification note is required before approving production promotions")
	}
	if expiresInHours <= 0 {
		expiresInHours = 24
	}
	if expiresInHours > 168 {
		return nil, gate, fmt.Errorf("approval expiry cannot exceed 168 hours")
	}
	expiresAt := time.Now().Add(time.Duration(expiresInHours) * time.Hour)
	approval, err := createDeploymentGateApproval(req, gate, userID, note, &expiresAt)
	if err != nil {
		return nil, gate, err
	}
	updatedGate, err := evaluatePromotionGateForRequest(req)
	if err != nil {
		return approval, nil, err
	}
	details := fmt.Sprintf("gate:%d:%s->%s", requestID, strings.ToLower(strings.TrimSpace(req.Env)), nextEnvironment)
	if trimmedNote := strings.TrimSpace(approval.Note); trimmedNote != "" {
		details += ":" + trimmedNote
	}
	AppendAuditLog(&userID, "deployment_gate_approve", "pr_request", strconv.Itoa(requestID), details)
	return approval, updatedGate, nil
}

func revokePromotionGateAsDevops(requestID int, userID int, note string) (*deploymentGateApprovalRecord, *promotionGateDecision, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, nil, err
	}
	if req == nil {
		return nil, nil, fmt.Errorf("request not found")
	}
	nextEnvironment := nextEnv(req.Env)
	if nextEnvironment == "" {
		return nil, nil, fmt.Errorf("request is already at the highest environment")
	}
	record, err := revokeDeploymentGateApproval(req.ID, nextEnvironment, req.UpdatedAt, userID, note)
	if err != nil {
		return nil, nil, err
	}
	updatedGate, err := evaluatePromotionGateForRequest(req)
	if err != nil {
		return record, nil, err
	}
	details := fmt.Sprintf("gate:%d:%s->%s", requestID, strings.ToLower(strings.TrimSpace(req.Env)), nextEnvironment)
	if trimmedNote := strings.TrimSpace(note); trimmedNote != "" {
		details += ":" + trimmedNote
	}
	AppendAuditLog(&userID, "deployment_gate_revoke", "pr_request", strconv.Itoa(requestID), details)
	return record, updatedGate, nil
}

func promoteRequestAsDevops(requestID int, userID int) (*PRRequest, *promotionGateDecision, *changeRequestRecord, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil {
		return nil, nil, nil, err
	}
	if req == nil {
		return nil, nil, nil, fmt.Errorf("request not found")
	}
	if req.Status != "completed" && req.Status != "in_progress" {
		return nil, nil, nil, fmt.Errorf("only completed or in-progress requests can be promoted")
	}
	nextEnvironment := nextEnv(req.Env)
	if nextEnvironment == "" {
		return nil, nil, nil, fmt.Errorf("request is already at the highest environment")
	}
	if strings.EqualFold(nextEnvironment, "prod") {
		if reason := activeFreezeReason(); reason != "" && !emergencyBypassesFreeze(req.Service, nextEnvironment) {
			return nil, nil, nil, fmt.Errorf("production freeze is active: %s", reason)
		}
		brief := loadOrBuildPRImpact(req)
		if strings.EqualFold(brief.RiskLevel, "high") && !brief.Acknowledged {
			return nil, nil, nil, fmt.Errorf("high-risk PR impact brief must be acknowledged before promoting to prod")
		}
	}

	gate, err := evaluatePromotionGateForRequest(req)
	if err != nil {
		return nil, nil, nil, err
	}
	if gate != nil {
		if gate.Status == "blocked" {
			return nil, gate, nil, fmt.Errorf("promotion blocked by deployment gate policy")
		}
		if gate.RequiresAcknowledgement {
			return nil, gate, nil, fmt.Errorf("promotion requires deployment gate approval")
		}
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		return nil, nil, nil, err
	}
	filePath, branchName := BuildRequestGitArtifacts(req.ProjectID, req.Team, req.Cloud, nextEnvironment, req.Service, appID)
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
		Config:        ensureRequestConfigApplicationID(req.Config, appID),
		CreatedBy:     createdBy,
	}
	if err := SavePRRequest(newReq); err != nil {
		return nil, gate, nil, err
	}
	_, _ = execContext(`UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2`, requestID, newReq.ID)
	auditDetails := fmt.Sprintf("devops:%d->%s", requestID, nextEnvironment)
	if gate != nil && gate.Approved {
		auditDetails += ":gate-approved"
	}
	AppendAuditLog(&userID, "request_promote", "pr_request", strconv.Itoa(newReq.ID), auditDetails)
	return newReq, gate, recordPromotionChange(req, newReq), nil
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
	managerID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != "GET" {
		if _, ok = requireDevopsManager(w, r); !ok {
			return
		}
	}
	switch r.Method {
	case "GET":
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("mode")), "preview") {
			number, err := nextRequestIncidentNumber()
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to prepare incident number", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"incident_number": number,
				"status":          "ok",
			})
			return
		}
		items, err := listRequestIncidents(strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list incidents", err)
			return
		}
		items = filterIncidentsInScope(filterIncidentsForPortal(
			items,
			parsePositiveQueryID(r, "project_id"),
			requestQueryEnv(r),
			r.URL.Query().Get("source"),
			r.URL.Query().Get("q"),
		), authzSubjectForUser(managerID))
		teams, err := listPortalIncidentTeams()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list incident teams", err)
			return
		}
		membersByTeam, err := listPortalIncidentTeamMembersByTeam()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list incident assignees", err)
			return
		}
		callers, _ := listITSMCallers()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"incidents":            items,
			"teams":                teams,
			"team_members_by_team": membersByTeam,
			"callers":              callers,
			"categories":           itsmCategoryCatalog(),
			"sla":                  []itsmSLAPolicy{slaPolicyForPriority("p1"), slaPolicyForPriority("p2"), slaPolicyForPriority("p3"), slaPolicyForPriority("p4")},
			"status":               "ok",
		})
	case "POST":
		capture, finish, handled := beginIdempotentPost(w, r, managerID, "incident")
		if handled {
			return
		}
		defer finish()
		w = capture
		var body struct {
			RequestID        int    `json:"request_id"`
			TeamID           *int   `json:"team_id"`
			Severity         string `json:"severity"`
			Priority         string `json:"priority"`
			Impact           string `json:"impact"`
			Urgency          string `json:"urgency"`
			Status           string `json:"status"`
			EscalationLevel  string `json:"escalation_level"`
			OwnerUserID      *int   `json:"owner_user_id"`
			Summary          string `json:"summary"`
			Notes            string `json:"notes"`
			Comment          string `json:"comment"`
			ProjectID        int    `json:"project_id"`
			Service          string `json:"service"`
			Environment      string `json:"environment"`
			CallerUserID     int    `json:"caller_user_id"`
			Category         string `json:"category"`
			Subcategory      string `json:"subcategory"`
			ParentIncidentID int    `json:"parent_incident_id"`
			ConferenceURL    string `json:"conference_url"`
			ConferenceNotes  string `json:"conference_notes"`
			Major            *bool  `json:"major"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		normalizedStatus := normalizeIncidentStatus(body.Status)
		severity := strings.TrimSpace(body.Priority)
		if severity == "" && strings.TrimSpace(body.Impact) != "" && strings.TrimSpace(body.Urgency) != "" {
			severity = itsmPriorityFromImpactUrgency(body.Impact, body.Urgency)
		}
		if severity == "" {
			severity = body.Severity
		}
		if normalizedStatus != "draft" && strings.TrimSpace(body.Summary) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "short description is required before submitting an incident", nil)
			return
		}
		if body.ProjectID > 0 && !ensureProjectVisible(w, r, managerID, body.ProjectID) {
			return
		}
		var item *requestIncident
		var err error
		if body.RequestID <= 0 {
			item, err = createStandaloneIncident(body.TeamID, severity, normalizedStatus, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes, &managerID, body.ProjectID, body.Service, body.Environment)
		} else {
			item, err = createOrUpdateRequestIncident(body.RequestID, body.TeamID, severity, normalizedStatus, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes, &managerID)
		}
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		if item != nil {
			item = applyCreatedIncidentITSM(item, body.CallerUserID, body.ParentIncidentID, body.Category, body.Subcategory, body.ConferenceURL, body.ConferenceNotes, body.Notes, body.Comment, managerID)
			if body.Major != nil && *body.Major {
				if updated, err := applyMajorIncidentMode(item, true, firstNonEmpty(body.ConferenceNotes, item.StatusNote), body.ConferenceURL); err == nil && updated != nil {
					item = updated
				}
			}
		}
		AppendAuditLog(&managerID, "request_incident_upsert", "pr_request", strconv.Itoa(body.RequestID), item.Severity+":"+item.Status)
		if item != nil {
			pageIncidentOwners(*item)
		}
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
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid incident id", err)
		return
	}
	current, lookupErr := getRequestIncidentByID(id)
	subject := authzSubjectForUser(managerID)
	if lookupErr != nil || current == nil || !incidentInScope(subject, *current, authzRead) {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", lookupErr)
		return
	}
	if r.Method != http.MethodGet && !incidentInScope(subject, *current, authzWrite) {
		writeAPIError(w, r, http.StatusForbidden, "not authorized for this project", nil)
		return
	}
	if len(parts) == 2 && strings.EqualFold(parts[1], "journal") {
		handleITSMJournal(w, r, "incident", id, managerID)
		return
	}
	if len(parts) == 2 && strings.EqualFold(parts[1], "review") {
		handleIncidentReviewRoute(w, r, managerID, id)
		return
	}
	if len(parts) == 2 {
		nextStatus, note, finish := incidentFinishStatus(parts[1])
		if finish {
			if r.Method != http.MethodPost {
				writeMethodNotAllowed(w, r)
				return
			}
			var body struct {
				Note string `json:"note"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if strings.TrimSpace(body.Note) != "" {
				note = strings.TrimSpace(body.Note)
			}
			if _, err := execContext(`
				UPDATE request_incidents
				SET status = $2, status_note = $3, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1
			`, id, nextStatus, note); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "could not update the incident", nil)
				return
			}
			item, err := getRequestIncidentByID(id)
			if err != nil || item == nil {
				writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
				return
			}
			applyIncidentSLATransition(item.ID, item.Status)
			item = hydrateOneIncidentITSM(item)
			AppendAuditLog(&managerID, "request_incident_"+parts[1], "request_incident", strconv.Itoa(id), item.Status)
			go pushIncidentToExternalIRM(*item)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"incident": item, "status": "ok"})
			return
		}
	}
	if len(parts) == 2 && strings.EqualFold(parts[1], "rollback") {
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		item, plan, err := executeChangeSHARollback(managerID, id, 0)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "rollback": plan, "status": "ok"})
		return
	}
	if r.Method == "GET" && len(parts) == 1 {
		item, err := getRequestIncidentByID(id)
		if err != nil || item == nil {
			writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
			return
		}
		attachRollbackPlan(item)
		review, postmortem := incidentReviewPayload(item)
		journal, _ := listITSMJournal("incident", id)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"incident": item, "rollback": item.RollbackPlan, "review": review, "postmortem": postmortem, "journal": journal, "status": "ok"})
		return
	}
	if r.Method != "PATCH" {
		writeMethodNotAllowed(w, r)
		return
	}
	previous, _ := getRequestIncidentByID(id)
	var requestID sql.NullInt64
	err = queryRowContext(`SELECT request_id FROM request_incidents WHERE id = $1`, id).Scan(&requestID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
		return
	}
	var body struct {
		TeamID           *int   `json:"team_id"`
		Severity         string `json:"severity"`
		Status           string `json:"status"`
		EscalationLevel  string `json:"escalation_level"`
		OwnerUserID      *int   `json:"owner_user_id"`
		Summary          string `json:"summary"`
		Notes            string `json:"notes"`
		Major            *bool  `json:"major"`
		StatusNote       string `json:"status_note"`
		SilenceMinutes   int    `json:"silence_minutes"`
		CallerUserID     int    `json:"caller_user_id"`
		Category         string `json:"category"`
		Subcategory      string `json:"subcategory"`
		ParentIncidentID int    `json:"parent_incident_id"`
		ConferenceURL    string `json:"conference_url"`
		ConferenceNotes  string `json:"conference_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	normalizedStatus := normalizeIncidentStatus(body.Status)
	if normalizedStatus != "draft" && strings.TrimSpace(body.Summary) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "short description is required before submitting an incident", nil)
		return
	}
	var item *requestIncident
	if requestID.Valid && requestID.Int64 > 0 {
		item, err = createOrUpdateRequestIncident(int(requestID.Int64), body.TeamID, body.Severity, normalizedStatus, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes, &managerID)
	} else {
		item, err = updateAlertIncidentByID(id, body.TeamID, body.Severity, normalizedStatus, body.EscalationLevel, body.OwnerUserID, body.Summary, body.Notes)
	}
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	auditRef := strconv.Itoa(id)
	if requestID.Valid && requestID.Int64 > 0 {
		auditRef = strconv.Itoa(int(requestID.Int64))
	}
	if body.SilenceMinutes > 0 {
		until := time.Now().Add(time.Duration(body.SilenceMinutes) * time.Minute)
		_, _ = execContext(`UPDATE request_incidents SET silenced_until = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, until)
		if refreshed, err := getRequestIncidentByID(id); err == nil && refreshed != nil {
			item = refreshed
		}
	}
	if body.Major != nil || strings.TrimSpace(body.StatusNote) != "" {
		major := item.Major
		if body.Major != nil {
			major = *body.Major
		}
		if updated, err := applyMajorIncidentMode(item, major, firstNonEmpty(body.StatusNote, item.StatusNote), body.ConferenceURL); err == nil && updated != nil {
			item = updated
		}
	}
	if item != nil {
		_ = upsertIncidentITSM(item.ID, body.CallerUserID, body.ParentIncidentID, body.Category, body.Subcategory, body.ConferenceURL, body.ConferenceNotes, severityToITSMPriority(item.Severity), item.CreatedAt, item.Status)
		applyIncidentSLATransition(item.ID, item.Status)
		item = hydrateOneIncidentITSM(item)
	}
	AppendAuditLog(&managerID, "request_incident_update", "pr_request", auditRef, item.Severity+":"+item.Status)
	if item != nil {
		pageIncidentOwnersIfNewlyOpen(previous, *item)
		go pushIncidentToExternalIRM(*item)
	}
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
		if err := notifyPromotionCenterWatchers(items); err != nil {
			log.Printf("promotion center notifications failed: %v", err)
		}
		if err := writeJSONResponse(w, http.StatusOK, map[string]any{"promotions": items, "status": "ok"}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotions response", err)
		}
	case "POST":
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/promotions/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) != 2 || (parts[1] != "promote" && parts[1] != "approve-gate" && parts[1] != "revoke-gate") {
			http.NotFound(w, r)
			return
		}
		requestID, err := strconv.Atoi(parts[0])
		if err != nil || requestID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid request id", err)
			return
		}
		var body struct {
			Note           string   `json:"note"`
			ExpiresInHours int      `json:"expires_in_hours"`
			AckReasons     []string `json:"ack_reasons"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
				writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
				return
			}
		}
		if parts[1] == "approve-gate" {
			approval, gate, err := approvePromotionGateAsDevops(requestID, managerID, body.Note, body.ExpiresInHours)
			if err != nil {
				if gate != nil && gate.Status == "blocked" {
					recordPromotionOperatorFailure(managerID, requestID, "deployment_gate_approve", gate, err)
					if writeErr := writeJSONResponse(w, http.StatusConflict, map[string]any{
						"status": "error",
						"error":  "promotion blocked by deployment gate policy",
						"gate":   gate,
					}); writeErr != nil {
						writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion gate approval response", writeErr)
					}
					return
				}
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			if req, reqErr := GetPRRequestByID(requestID); reqErr == nil && req != nil {
				reasons := append([]string{}, body.AckReasons...)
				if note := strings.TrimSpace(body.Note); note != "" {
					reasons = append(reasons, note)
				}
				persistAckForRequest(req, managerID, reasons)
			}
			if err := writeJSONResponse(w, http.StatusOK, map[string]any{"approval": approval, "gate": gate, "status": "ok"}); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion gate approval response", err)
			}
			return
		}
		if parts[1] == "revoke-gate" {
			approval, gate, err := revokePromotionGateAsDevops(requestID, managerID, body.Note)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			if err := writeJSONResponse(w, http.StatusOK, map[string]any{"approval": approval, "gate": gate, "status": "ok"}); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion gate revoke response", err)
			}
			return
		}
		item, gate, change, err := promoteRequestAsDevops(requestID, managerID)
		if err != nil {
			recordPromotionOperatorFailure(managerID, requestID, "request_promote", gate, err)
			if gate != nil && (gate.Status == "blocked" || gate.RequiresAcknowledgement) {
				if req, reqErr := GetPRRequestByID(requestID); reqErr == nil && req != nil && gate.Status == "blocked" {
					if notifyErr := notifyBlockedPromotion(req, gate); notifyErr != nil {
						log.Printf("blocked promotion notification failed request_id=%d: %v", requestID, notifyErr)
					}
				}
				status := http.StatusConflict
				message := "promotion blocked by deployment gate policy"
				payload := map[string]any{
					"status": "error",
					"error":  message,
					"gate":   gate,
				}
				if gate.RequiresAcknowledgement {
					status = http.StatusPreconditionRequired
					message = "deployment gate approval is required before promotion"
					payload["error"] = message
					payload["high_risk_merge_required"] = true
					if brief := changeBriefFromPromotionGate(gate); brief != nil {
						payload["change_brief"] = brief
					}
				}
				if writeErr := writeJSONResponse(w, status, payload); writeErr != nil {
					writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion gate response", writeErr)
				}
				return
			}
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		if err := writeJSONResponse(w, http.StatusOK, map[string]any{"request": item, "gate": gate, "change": change, "status": "ok"}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write promotion response", err)
		}
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
