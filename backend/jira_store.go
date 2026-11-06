package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func jiraScanTime(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time.UTC()
	return &t
}

func insertJiraConnection(name string, ownerUserID int) (jiraConnection, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Jira connection"
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO jira_connections (name, owner_user_id, state, auth_health, sync_health, provider)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, name, ownerUserID, jiraStateDraft, jiraHealthNotConfigured, jiraHealthNotConfigured, jiraProviderCloud).Scan(&id)
	if err != nil {
		return jiraConnection{}, err
	}
	return getJiraConnection(id)
}

func getJiraConnection(id int) (jiraConnection, error) {
	row := DB.QueryRow(`
		SELECT c.id, c.tenant_key, c.name, c.provider, c.cloud_id, c.site_url, c.site_name,
		       COALESCE(c.owner_user_id, 0), COALESCE(u.username, ''), c.scopes, c.state,
		       c.auth_health, c.sync_health, c.enabled, c.last_success_at, c.last_error,
		       c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM jira_spaces s WHERE s.connection_id = c.id)
		FROM jira_connections c
		LEFT JOIN users u ON u.id = c.owner_user_id
		WHERE c.id = $1
	`, id)
	return scanJiraConnection(row)
}

func listJiraConnections() ([]jiraConnection, error) {
	rows, err := DB.Query(`
		SELECT c.id, c.tenant_key, c.name, c.provider, c.cloud_id, c.site_url, c.site_name,
		       COALESCE(c.owner_user_id, 0), COALESCE(u.username, ''), c.scopes, c.state,
		       c.auth_health, c.sync_health, c.enabled, c.last_success_at, c.last_error,
		       c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM jira_spaces s WHERE s.connection_id = c.id)
		FROM jira_connections c
		LEFT JOIN users u ON u.id = c.owner_user_id
		ORDER BY c.updated_at DESC, c.id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraConnection{}
	for rows.Next() {
		conn, err := scanJiraConnection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, conn)
	}
	return out, rows.Err()
}

type jiraScanner interface {
	Scan(dest ...any) error
}

func scanJiraConnection(row jiraScanner) (jiraConnection, error) {
	var c jiraConnection
	var last sql.NullTime
	if err := row.Scan(
		&c.ID, &c.TenantKey, &c.Name, &c.Provider, &c.CloudID, &c.SiteURL, &c.SiteName,
		&c.OwnerUserID, &c.OwnerUsername, &c.Scopes, &c.State, &c.AuthHealth, &c.SyncHealth,
		&c.Enabled, &last, &c.LastError, &c.CreatedAt, &c.UpdatedAt, &c.SpaceCount,
	); err != nil {
		return jiraConnection{}, err
	}
	c.LastSuccessAt = jiraScanTime(last)
	c.OAuthReady = jiraOAuthConfigured()
	if !c.OAuthReady && (c.AuthHealth == jiraHealthNotConfigured || c.AuthHealth == "") {
		c.AuthHealth = jiraHealthConfigNeeded
	}
	return c, nil
}

func updateJiraConnectionSite(id int, cloudID, siteURL, siteName string) error {
	_, err := DB.Exec(`
		UPDATE jira_connections
		SET cloud_id = $2, site_url = $3, site_name = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, strings.TrimSpace(cloudID), strings.TrimSpace(siteURL), strings.TrimSpace(siteName))
	return err
}

func updateJiraConnectionState(id int, state, authHealth, syncHealth string, enabled bool, lastErr string) error {
	_, err := DB.Exec(`
		UPDATE jira_connections
		SET state = $2, auth_health = $3, sync_health = $4, enabled = $5, last_error = $6, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, state, authHealth, syncHealth, enabled, strings.TrimSpace(lastErr))
	return err
}

func markJiraConnectionSuccess(id int) error {
	_, err := DB.Exec(`
		UPDATE jira_connections
		SET last_success_at = CURRENT_TIMESTAMP, last_error = '', auth_health = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, jiraHealthConnected)
	return err
}

func upsertJiraConnectionSecrets(connectionID int, access, refresh, tokenType string, expiry time.Time) error {
	accessEnc, err := encryptJiraSecret(access)
	if err != nil {
		return err
	}
	refreshEnc, err := encryptJiraSecret(refresh)
	if err != nil {
		return err
	}
	var expiryArg any
	if !expiry.IsZero() {
		expiryArg = expiry.UTC()
	}
	_, err = DB.Exec(`
		INSERT INTO jira_connection_secrets (connection_id, access_token_enc, refresh_token_enc, token_type, token_expiry, updated_at)
		VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
		ON CONFLICT (connection_id) DO UPDATE SET
			access_token_enc = EXCLUDED.access_token_enc,
			refresh_token_enc = CASE WHEN EXCLUDED.refresh_token_enc = '' THEN jira_connection_secrets.refresh_token_enc ELSE EXCLUDED.refresh_token_enc END,
			token_type = EXCLUDED.token_type,
			token_expiry = EXCLUDED.token_expiry,
			updated_at = CURRENT_TIMESTAMP
	`, connectionID, accessEnc, refreshEnc, tokenType, expiryArg)
	return err
}

func clearJiraConnectionSecrets(connectionID int) error {
	_, err := DB.Exec(`DELETE FROM jira_connection_secrets WHERE connection_id = $1`, connectionID)
	return err
}

type jiraTokenSet struct {
	Access  string
	Refresh string
	Type    string
	Expiry  time.Time
}

func loadJiraConnectionTokens(connectionID int) (jiraTokenSet, error) {
	var accessEnc, refreshEnc, tokenType string
	var expiry sql.NullTime
	err := DB.QueryRow(`
		SELECT access_token_enc, refresh_token_enc, token_type, token_expiry
		FROM jira_connection_secrets WHERE connection_id = $1
	`, connectionID).Scan(&accessEnc, &refreshEnc, &tokenType, &expiry)
	if err != nil {
		return jiraTokenSet{}, err
	}
	access, err := decryptJiraSecret(accessEnc)
	if err != nil {
		return jiraTokenSet{}, err
	}
	refresh, err := decryptJiraSecret(refreshEnc)
	if err != nil {
		return jiraTokenSet{}, err
	}
	out := jiraTokenSet{Access: access, Refresh: refresh, Type: tokenType}
	if expiry.Valid {
		out.Expiry = expiry.Time.UTC()
	}
	return out, nil
}

func saveJiraOAuthState(state string, connectionID, userID int, expires time.Time) error {
	_, err := DB.Exec(`
		INSERT INTO jira_oauth_states (state, connection_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4)
	`, state, connectionID, userID, expires.UTC())
	return err
}

func consumeJiraOAuthState(state string) (connectionID, userID int, err error) {
	err = DB.QueryRow(`
		DELETE FROM jira_oauth_states
		WHERE state = $1 AND expires_at > CURRENT_TIMESTAMP
		RETURNING connection_id, user_id
	`, strings.TrimSpace(state)).Scan(&connectionID, &userID)
	return
}

func upsertJiraSpace(connectionID int, remote jiraRemoteSpace) (jiraSpace, error) {
	var id int
	err := DB.QueryRow(`
		INSERT INTO jira_spaces (connection_id, jira_project_id, jira_project_key, name, style, enabled, sync_health)
		VALUES ($1, $2, $3, $4, $5, TRUE, $6)
		ON CONFLICT (connection_id, jira_project_id) DO UPDATE SET
			jira_project_key = EXCLUDED.jira_project_key,
			name = EXCLUDED.name,
			style = EXCLUDED.style,
			enabled = TRUE,
			updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, connectionID, remote.ID, remote.Key, remote.Name, remote.Style, jiraHealthNotConfigured).Scan(&id)
	if err != nil {
		return jiraSpace{}, err
	}
	return getJiraSpace(id)
}

func getJiraSpace(id int) (jiraSpace, error) {
	row := DB.QueryRow(`
		SELECT s.id, s.connection_id, c.name, c.site_name, c.cloud_id, s.jira_project_id, s.jira_project_key,
		       s.name, s.style, s.enabled, s.sync_health, s.last_success_at, s.last_error
		FROM jira_spaces s
		JOIN jira_connections c ON c.id = s.connection_id
		WHERE s.id = $1
	`, id)
	return scanJiraSpace(row)
}

func listJiraSpaces(connectionID int) ([]jiraSpace, error) {
	query := `
		SELECT s.id, s.connection_id, c.name, c.site_name, c.cloud_id, s.jira_project_id, s.jira_project_key,
		       s.name, s.style, s.enabled, s.sync_health, s.last_success_at, s.last_error
		FROM jira_spaces s
		JOIN jira_connections c ON c.id = s.connection_id
	`
	args := []any{}
	if connectionID > 0 {
		query += ` WHERE s.connection_id = $1`
		args = append(args, connectionID)
	}
	query += ` ORDER BY c.name, s.name`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraSpace{}
	for rows.Next() {
		space, err := scanJiraSpace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, space)
	}
	return out, rows.Err()
}

func scanJiraSpace(row jiraScanner) (jiraSpace, error) {
	var s jiraSpace
	var last sql.NullTime
	if err := row.Scan(
		&s.ID, &s.ConnectionID, &s.ConnectionName, &s.SiteName, &s.CloudID,
		&s.JiraProjectID, &s.JiraProjectKey, &s.Name, &s.Style, &s.Enabled,
		&s.SyncHealth, &last, &s.LastError,
	); err != nil {
		return jiraSpace{}, err
	}
	s.LastSuccessAt = jiraScanTime(last)
	s.MappedProjects = listJiraMappingProjectNames(s.ID)
	s.PermittedTeams = listJiraSpaceTeamNames(s.ID)
	return s, nil
}

func setJiraSpaceEnabled(id int, enabled bool) error {
	_, err := DB.Exec(`UPDATE jira_spaces SET enabled = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, enabled)
	return err
}

func replaceJiraSpaceAccess(spaceID int, grants []jiraSpaceAccess) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM jira_space_access WHERE space_id = $1`, spaceID); err != nil {
		return err
	}
	for _, grant := range grants {
		if grant.TeamID <= 0 {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO jira_space_access (space_id, team_id, can_view, can_link, can_create, can_administer)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, spaceID, grant.TeamID, grant.CanView, grant.CanLink, grant.CanCreate, grant.CanAdminister); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func listJiraSpaceAccess(spaceID int) ([]jiraSpaceAccess, error) {
	rows, err := DB.Query(`
		SELECT a.team_id, t.name, t.slug, a.can_view, a.can_link, a.can_create, a.can_administer
		FROM jira_space_access a
		JOIN teams t ON t.id = a.team_id
		WHERE a.space_id = $1
		ORDER BY t.name
	`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraSpaceAccess{}
	for rows.Next() {
		var g jiraSpaceAccess
		if err := rows.Scan(&g.TeamID, &g.TeamName, &g.TeamSlug, &g.CanView, &g.CanLink, &g.CanCreate, &g.CanAdminister); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func listJiraSpaceTeamNames(spaceID int) []string {
	rows, err := DB.Query(`
		SELECT t.name FROM jira_space_access a JOIN teams t ON t.id = a.team_id
		WHERE a.space_id = $1 ORDER BY t.name
	`, spaceID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return names
		}
		names = append(names, name)
	}
	return names
}

func insertJiraMapping(m jiraMapping) (jiraMapping, error) {
	if m.DefaultRelationship == "" {
		m.DefaultRelationship = jiraRelRelated
	}
	if m.FieldDefaultsJSON == "" {
		m.FieldDefaultsJSON = "{}"
	}
	err := DB.QueryRow(`
		INSERT INTO jira_mappings (space_id, portal_project_id, portal_service, issue_type_id, issue_type_name, default_relationship, field_defaults_json, version)
		VALUES ($1, NULLIF($2, 0), $3, $4, $5, $6, $7, 1)
		RETURNING id
	`, m.SpaceID, m.PortalProjectID, strings.TrimSpace(m.PortalService), m.IssueTypeID, m.IssueTypeName, m.DefaultRelationship, m.FieldDefaultsJSON).Scan(&m.ID)
	if err != nil {
		return jiraMapping{}, err
	}
	m.Version = 1
	return m, nil
}

func listJiraMappings(spaceID int) ([]jiraMapping, error) {
	rows, err := DB.Query(`
		SELECT m.id, m.space_id, COALESCE(m.portal_project_id, 0), COALESCE(p.name, ''), m.portal_service,
		       m.issue_type_id, m.issue_type_name, m.default_relationship, m.field_defaults_json, m.version
		FROM jira_mappings m
		LEFT JOIN projects p ON p.id = m.portal_project_id
		WHERE m.space_id = $1
		ORDER BY m.id
	`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraMapping{}
	for rows.Next() {
		var m jiraMapping
		if err := rows.Scan(&m.ID, &m.SpaceID, &m.PortalProjectID, &m.PortalProjectName, &m.PortalService, &m.IssueTypeID, &m.IssueTypeName, &m.DefaultRelationship, &m.FieldDefaultsJSON, &m.Version); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func deleteJiraMapping(id int) error {
	_, err := DB.Exec(`DELETE FROM jira_mappings WHERE id = $1`, id)
	return err
}

func listJiraMappingProjectNames(spaceID int) []string {
	rows, err := DB.Query(`
		SELECT COALESCE(p.name, m.portal_service)
		FROM jira_mappings m
		LEFT JOIN projects p ON p.id = m.portal_project_id
		WHERE m.space_id = $1
	`, spaceID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return names
		}
		if strings.TrimSpace(name) != "" {
			names = append(names, name)
		}
	}
	return names
}

func upsertJiraIssue(view jiraIssueView, spaceID int, connectionID int) error {
	_, err := DB.Exec(`
		INSERT INTO jira_issues (
			connection_id, cloud_id, issue_id, issue_key, space_id, summary, status, status_category,
			priority, assignee_account_id, assignee_display, issue_type, security_level, browse_url,
			restricted, last_success_at, remote_updated_at, updated_at
		) VALUES ($1,$2,$3,$4,NULLIF($5,0),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP,$16,CURRENT_TIMESTAMP)
		ON CONFLICT (cloud_id, issue_id) DO UPDATE SET
			issue_key = EXCLUDED.issue_key,
			space_id = COALESCE(EXCLUDED.space_id, jira_issues.space_id),
			summary = EXCLUDED.summary,
			status = EXCLUDED.status,
			status_category = EXCLUDED.status_category,
			priority = EXCLUDED.priority,
			assignee_account_id = EXCLUDED.assignee_account_id,
			assignee_display = EXCLUDED.assignee_display,
			issue_type = EXCLUDED.issue_type,
			security_level = EXCLUDED.security_level,
			browse_url = EXCLUDED.browse_url,
			restricted = EXCLUDED.restricted,
			last_success_at = CURRENT_TIMESTAMP,
			remote_updated_at = COALESCE(EXCLUDED.remote_updated_at, jira_issues.remote_updated_at),
			updated_at = CURRENT_TIMESTAMP
	`, connectionID, view.CloudID, view.IssueID, view.IssueKey, spaceID, view.Summary, view.Status, view.StatusCategory,
		view.Priority, view.AssigneeAccountID, view.AssigneeDisplay, view.IssueType, "", view.BrowseURL, view.Restricted, jiraNullTime(view.RemoteUpdatedAt))
	return err
}

func getJiraIssue(cloudID, issueID string) (jiraIssueView, error) {
	row := DB.QueryRow(`
		SELECT i.cloud_id, i.issue_id, i.issue_key, i.summary, i.status, i.status_category, i.priority,
		       i.assignee_account_id, i.assignee_display, i.issue_type, i.restricted, i.browse_url,
		       COALESCE(c.site_name, ''), COALESCE(s.name, ''), COALESCE(s.jira_project_key, ''), i.last_success_at
		FROM jira_issues i
		LEFT JOIN jira_connections c ON c.id = i.connection_id
		LEFT JOIN jira_spaces s ON s.id = i.space_id
		WHERE i.cloud_id = $1 AND i.issue_id = $2
	`, cloudID, issueID)
	return scanJiraIssueView(row)
}

func scanJiraIssueView(row jiraScanner) (jiraIssueView, error) {
	var v jiraIssueView
	var last sql.NullTime
	if err := row.Scan(
		&v.CloudID, &v.IssueID, &v.IssueKey, &v.Summary, &v.Status, &v.StatusCategory, &v.Priority,
		&v.AssigneeAccountID, &v.AssigneeDisplay, &v.IssueType, &v.Restricted, &v.BrowseURL,
		&v.SiteName, &v.SpaceName, &v.SpaceKey, &last,
	); err != nil {
		return jiraIssueView{}, err
	}
	v.LastSuccessAt = jiraScanTime(last)
	v.Freshness, v.Stale = jiraFreshness(v.LastSuccessAt)
	return v, nil
}

func jiraFreshness(last *time.Time) (string, bool) {
	if last == nil {
		return "unknown", true
	}
	age := time.Since(*last)
	switch {
	case age < 15*time.Minute:
		return "current", false
	case age < 2*time.Hour:
		return "delayed", true
	default:
		return "stale", true
	}
}

func insertJiraIssueLink(sourceType string, sourceID int, sourceKey, cloudID, issueID, relationship string, actor int) (int, error) {
	if relationship == "" {
		relationship = jiraRelRelated
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO jira_issue_links (source_type, source_id, source_key, cloud_id, issue_id, relationship, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, 0))
		ON CONFLICT (source_type, source_id, source_key, cloud_id, issue_id) DO UPDATE SET relationship = EXCLUDED.relationship
		RETURNING id
	`, sourceType, sourceID, sourceKey, cloudID, issueID, relationship, actor).Scan(&id)
	return id, err
}

func deleteJiraIssueLink(id int) error {
	_, err := DB.Exec(`DELETE FROM jira_issue_links WHERE id = $1`, id)
	return err
}

func getJiraIssueLink(id int) (sourceType, cloudID, issueID string, sourceID int, err error) {
	err = DB.QueryRow(`SELECT source_type, source_id, cloud_id, issue_id FROM jira_issue_links WHERE id = $1`, id).Scan(&sourceType, &sourceID, &cloudID, &issueID)
	return
}

func listJiraIssueLinks(sourceType string, sourceID int, sourceKey string) ([]jiraIssueLinkView, error) {
	rows, err := DB.Query(`
		SELECT l.id, l.source_type, l.source_id, l.source_key, l.relationship,
		       i.cloud_id, i.issue_id, i.issue_key, i.summary, i.status, i.status_category, i.priority,
		       i.assignee_account_id, i.assignee_display, i.issue_type, i.restricted, i.browse_url,
		       COALESCE(c.site_name, ''), COALESCE(s.name, ''), COALESCE(s.jira_project_key, ''), i.last_success_at
		FROM jira_issue_links l
		JOIN jira_issues i ON i.cloud_id = l.cloud_id AND i.issue_id = l.issue_id
		LEFT JOIN jira_connections c ON c.id = i.connection_id
		LEFT JOIN jira_spaces s ON s.id = i.space_id
		WHERE l.source_type = $1 AND l.source_id = $2 AND ($3 = '' OR l.source_key = $3)
		ORDER BY l.created_at DESC
	`, sourceType, sourceID, sourceKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraIssueLinkView{}
	for rows.Next() {
		var link jiraIssueLinkView
		var last sql.NullTime
		if err := rows.Scan(
			&link.ID, &link.SourceType, &link.SourceID, &link.SourceKey, &link.Relationship,
			&link.Issue.CloudID, &link.Issue.IssueID, &link.Issue.IssueKey, &link.Issue.Summary, &link.Issue.Status,
			&link.Issue.StatusCategory, &link.Issue.Priority, &link.Issue.AssigneeAccountID, &link.Issue.AssigneeDisplay,
			&link.Issue.IssueType, &link.Issue.Restricted, &link.Issue.BrowseURL, &link.Issue.SiteName, &link.Issue.SpaceName,
			&link.Issue.SpaceKey, &last,
		); err != nil {
			return nil, err
		}
		link.Issue.LastSuccessAt = jiraScanTime(last)
		link.Issue.Freshness, link.Issue.Stale = jiraFreshness(link.Issue.LastSuccessAt)
		out = append(out, link)
	}
	return out, rows.Err()
}

func listAllJiraIssueLinks(limit int) ([]jiraIssueLinkView, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := DB.Query(`
		SELECT l.id, l.source_type, l.source_id, l.source_key, l.relationship,
		       i.cloud_id, i.issue_id, i.issue_key, i.summary, i.status, i.status_category, i.priority,
		       i.assignee_account_id, i.assignee_display, i.issue_type, i.restricted, i.browse_url,
		       COALESCE(c.site_name, ''), COALESCE(s.name, ''), COALESCE(s.jira_project_key, ''), i.last_success_at
		FROM jira_issue_links l
		JOIN jira_issues i ON i.cloud_id = l.cloud_id AND i.issue_id = l.issue_id
		LEFT JOIN jira_connections c ON c.id = i.connection_id
		LEFT JOIN jira_spaces s ON s.id = i.space_id
		ORDER BY l.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraIssueLinkView{}
	for rows.Next() {
		var link jiraIssueLinkView
		var last sql.NullTime
		if err := rows.Scan(
			&link.ID, &link.SourceType, &link.SourceID, &link.SourceKey, &link.Relationship,
			&link.Issue.CloudID, &link.Issue.IssueID, &link.Issue.IssueKey, &link.Issue.Summary, &link.Issue.Status,
			&link.Issue.StatusCategory, &link.Issue.Priority, &link.Issue.AssigneeAccountID, &link.Issue.AssigneeDisplay,
			&link.Issue.IssueType, &link.Issue.Restricted, &link.Issue.BrowseURL, &link.Issue.SiteName, &link.Issue.SpaceName,
			&link.Issue.SpaceKey, &last,
		); err != nil {
			return nil, err
		}
		link.Issue.LastSuccessAt = jiraScanTime(last)
		link.Issue.Freshness, link.Issue.Stale = jiraFreshness(link.Issue.LastSuccessAt)
		out = append(out, link)
	}
	return out, rows.Err()
}

func insertJiraOperation(op jiraOperationView, payload any, connectionID int, actor int) (jiraOperationView, error) {
	if op.OperationID == "" {
		op.OperationID = newJiraOperationID()
	}
	body, _ := json.Marshal(payload)
	if op.State == "" {
		op.State = jiraOpQueued
	}
	err := DB.QueryRow(`
		INSERT INTO jira_sync_operations (
			operation_id, connection_id, kind, source_type, source_id, source_key, cloud_id, issue_id,
			payload_json, state, attempts, next_attempt_at, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,CURRENT_TIMESTAMP,NULLIF($11,0))
		RETURNING id, created_at, updated_at
	`, op.OperationID, jiraNullIfZero(connectionID), op.Kind, op.SourceType, op.SourceID, op.SourceKey, op.CloudID, op.IssueID, string(body), op.State, actor).Scan(&op.ID, &op.CreatedAt, &op.UpdatedAt)
	return op, err
}

func jiraNullIfZero(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

func jiraNullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC()
}

func jiraIssueRemoteUpdated(cloudID, issueID string) time.Time {
	if DB == nil {
		return time.Time{}
	}
	var last sql.NullTime
	_ = DB.QueryRow(`SELECT remote_updated_at FROM jira_issues WHERE cloud_id = $1 AND issue_id = $2`, cloudID, issueID).Scan(&last)
	if !last.Valid {
		return time.Time{}
	}
	return last.Time.UTC()
}

func saveJiraOwnerAccountID(connectionID int, accountID string) {
	accountID = strings.TrimSpace(accountID)
	if DB == nil || connectionID <= 0 || accountID == "" {
		return
	}
	_, _ = DB.Exec(`UPDATE jira_connections SET owner_account_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, connectionID, accountID)
}

func jiraAccountIDsForUser(userID int) []string {
	if DB == nil || userID <= 0 {
		return nil
	}
	rows, err := DB.Query(`SELECT DISTINCT owner_account_id FROM jira_connections WHERE owner_user_id = $1 AND owner_account_id <> ''`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil || id == "" {
			continue
		}
		out = append(out, id)
	}
	return out
}

func filterJiraLinksByAssigneeAccounts(links []jiraIssueLinkView, accounts []string) []jiraIssueLinkView {
	if len(accounts) == 0 {
		return links
	}
	allowed := map[string]struct{}{}
	for _, id := range accounts {
		allowed[id] = struct{}{}
	}
	out := []jiraIssueLinkView{}
	for _, link := range links {
		if _, ok := allowed[link.Issue.AssigneeAccountID]; ok {
			out = append(out, link)
		}
	}
	return out
}

func getJiraOperationByID(operationID string) (jiraOperationView, string, int, error) {
	var payload string
	var connectionID sql.NullInt64
	var next sql.NullTime
	var op jiraOperationView
	err := DB.QueryRow(`
		SELECT id, operation_id, COALESCE(connection_id, 0), kind, source_type, source_id, source_key, cloud_id, issue_id,
		       payload_json, state, attempts, last_error, next_attempt_at, created_at, updated_at
		FROM jira_sync_operations WHERE operation_id = $1
	`, operationID).Scan(
		&op.ID, &op.OperationID, &connectionID, &op.Kind, &op.SourceType, &op.SourceID, &op.SourceKey, &op.CloudID, &op.IssueID,
		&payload, &op.State, &op.Attempts, &op.LastError, &next, &op.CreatedAt, &op.UpdatedAt,
	)
	if err != nil {
		return op, "", 0, err
	}
	op.NextAttempt = jiraScanTime(next)
	op.Retryable = op.State == jiraOpFailed || op.State == jiraOpRetrying
	return op, payload, int(connectionID.Int64), nil
}

func listJiraOperations(limit int) ([]jiraOperationView, error) {
	if limit <= 0 {
		limit = 80
	}
	rows, err := DB.Query(`
		SELECT o.id, o.operation_id, o.kind, o.source_type, o.source_id, o.source_key, o.cloud_id, o.issue_id,
		       COALESCE(i.issue_key, ''), o.state, o.attempts, o.last_error, o.next_attempt_at, o.created_at, o.updated_at
		FROM jira_sync_operations o
		LEFT JOIN jira_issues i ON i.cloud_id = o.cloud_id AND i.issue_id = o.issue_id
		ORDER BY o.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraOperationView{}
	for rows.Next() {
		var op jiraOperationView
		var next sql.NullTime
		if err := rows.Scan(&op.ID, &op.OperationID, &op.Kind, &op.SourceType, &op.SourceID, &op.SourceKey, &op.CloudID, &op.IssueID, &op.IssueKey, &op.State, &op.Attempts, &op.LastError, &next, &op.CreatedAt, &op.UpdatedAt); err != nil {
			return nil, err
		}
		op.NextAttempt = jiraScanTime(next)
		op.Retryable = op.State == jiraOpFailed || op.State == jiraOpRetrying
		out = append(out, op)
	}
	return out, rows.Err()
}

func pendingJiraRefreshOperation(cloudID, issueID string) (jiraOperationView, bool) {
	var op jiraOperationView
	if DB == nil || strings.TrimSpace(cloudID) == "" || strings.TrimSpace(issueID) == "" {
		return op, false
	}
	err := DB.QueryRow(`
		SELECT operation_id, state FROM jira_sync_operations
		WHERE kind = 'refresh_issue' AND cloud_id = $1 AND issue_id = $2
		  AND state IN ($3, $4, $5, $6)
		ORDER BY id DESC
		LIMIT 1
	`, cloudID, issueID, jiraOpQueued, jiraOpRunning, jiraOpRetrying, jiraOpReconcile).Scan(&op.OperationID, &op.State)
	return op, err == nil && op.OperationID != ""
}

func reclaimStaleJiraOperations() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		UPDATE jira_sync_operations
		SET state = $1, last_error = 'Interrupted job resumed', next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE state = $2 AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
	`, jiraOpQueued, jiraOpRunning)
}

func firstJiraMappingsBySpace() map[int]jiraMapping {
	out := map[int]jiraMapping{}
	if DB == nil {
		return out
	}
	rows, err := DB.Query(`
		SELECT space_id, issue_type_id, issue_type_name, default_relationship, COALESCE(field_defaults_json, '')
		FROM jira_mappings
		ORDER BY id
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var m jiraMapping
		if err := rows.Scan(&m.SpaceID, &m.IssueTypeID, &m.IssueTypeName, &m.DefaultRelationship, &m.FieldDefaultsJSON); err != nil {
			continue
		}
		if _, exists := out[m.SpaceID]; exists {
			continue
		}
		out[m.SpaceID] = m
	}
	return out
}

func withJiraSpaceMappings(spaces []jiraSpace) []jiraSpace {
	defaults := firstJiraMappingsBySpace()
	for i := range spaces {
		m, ok := defaults[spaces[i].ID]
		if !ok {
			continue
		}
		spaces[i].DefaultIssueTypeID = m.IssueTypeID
		spaces[i].DefaultIssueTypeName = m.IssueTypeName
		spaces[i].DefaultRelationship = m.DefaultRelationship
		spaces[i].FieldDefaultsJSON = m.FieldDefaultsJSON
	}
	return spaces
}

func listDueJiraOperations(limit int) ([]string, error) {
	rows, err := DB.Query(`
		SELECT operation_id FROM jira_sync_operations
		WHERE state IN ($1, $2, $3) AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
		ORDER BY created_at
		LIMIT $4
	`, jiraOpQueued, jiraOpRetrying, jiraOpReconcile, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func updateJiraOperation(operationID, state, lastErr, issueID, cloudID string, attempts int, next *time.Time) error {
	var nextArg any
	if next != nil {
		nextArg = next.UTC()
	}
	_, err := DB.Exec(`
		UPDATE jira_sync_operations
		SET state = $2, last_error = $3, issue_id = CASE WHEN $4 = '' THEN issue_id ELSE $4 END,
		    cloud_id = CASE WHEN $5 = '' THEN cloud_id ELSE $5 END, attempts = $6, next_attempt_at = $7, updated_at = CURRENT_TIMESTAMP
		WHERE operation_id = $1
	`, operationID, state, lastErr, issueID, cloudID, attempts, nextArg)
	return err
}

func insertJiraAudit(connectionID, actor int, action, sourceType string, sourceID int, cloudID, issueID, result, detail string) {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO jira_audit_events (connection_id, actor_user_id, action, source_type, source_id, cloud_id, issue_id, result, detail)
		VALUES (NULLIF($1,0), NULLIF($2,0), $3, $4, $5, $6, $7, $8, $9)
	`, connectionID, actor, action, sourceType, sourceID, cloudID, issueID, result, clipJiraDetail(detail))
}

func clipJiraDetail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 400 {
		return s[:400]
	}
	return s
}

func listJiraAudit(limit int) ([]jiraAuditView, error) {
	if limit <= 0 {
		limit = 80
	}
	rows, err := DB.Query(`
		SELECT a.id, a.action, a.result, a.detail, a.source_type, COALESCE(i.issue_key, ''), COALESCE(u.username, ''), a.created_at
		FROM jira_audit_events a
		LEFT JOIN users u ON u.id = a.actor_user_id
		LEFT JOIN jira_issues i ON i.cloud_id = a.cloud_id AND i.issue_id = a.issue_id
		ORDER BY a.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraAuditView{}
	for rows.Next() {
		var e jiraAuditView
		if err := rows.Scan(&e.ID, &e.Action, &e.Result, &e.Detail, &e.SourceType, &e.IssueKey, &e.Actor, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func listEnabledJiraConnections() ([]jiraConnection, error) {
	rows, err := DB.Query(`
		SELECT c.id, c.tenant_key, c.name, c.provider, c.cloud_id, c.site_url, c.site_name,
		       COALESCE(c.owner_user_id, 0), COALESCE(u.username, ''), c.scopes, c.state,
		       c.auth_health, c.sync_health, c.enabled, c.last_success_at, c.last_error,
		       c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM jira_spaces s WHERE s.connection_id = c.id)
		FROM jira_connections c
		LEFT JOIN users u ON u.id = c.owner_user_id
		WHERE c.enabled = TRUE AND c.state = $1
		ORDER BY c.id
	`, jiraStateConnected)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraConnection{}
	for rows.Next() {
		conn, err := scanJiraConnection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, conn)
	}
	return out, rows.Err()
}

func listLinkedJiraIssueIDs(connectionID int) ([]jiraIssueView, error) {
	rows, err := DB.Query(`
		SELECT DISTINCT i.cloud_id, i.issue_id
		FROM jira_issues i
		WHERE i.connection_id = $1
	`, connectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []jiraIssueView
	for rows.Next() {
		var v jiraIssueView
		if err := rows.Scan(&v.CloudID, &v.IssueID); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func findJiraSpaceByProject(connectionID int, projectID, projectKey string) (jiraSpace, error) {
	row := DB.QueryRow(`
		SELECT s.id, s.connection_id, c.name, c.site_name, c.cloud_id, s.jira_project_id, s.jira_project_key,
		       s.name, s.style, s.enabled, s.sync_health, s.last_success_at, s.last_error
		FROM jira_spaces s
		JOIN jira_connections c ON c.id = s.connection_id
		WHERE s.connection_id = $1 AND (s.jira_project_id = $2 OR s.jira_project_key = $3)
		LIMIT 1
	`, connectionID, projectID, projectKey)
	return scanJiraSpace(row)
}

func findJiraConnectionByCloud(cloudID string) (jiraConnection, error) {
	row := DB.QueryRow(`
		SELECT c.id, c.tenant_key, c.name, c.provider, c.cloud_id, c.site_url, c.site_name,
		       COALESCE(c.owner_user_id, 0), COALESCE(u.username, ''), c.scopes, c.state,
		       c.auth_health, c.sync_health, c.enabled, c.last_success_at, c.last_error,
		       c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM jira_spaces s WHERE s.connection_id = c.id)
		FROM jira_connections c
		LEFT JOIN users u ON u.id = c.owner_user_id
		WHERE c.cloud_id = $1
		ORDER BY c.enabled DESC, c.id DESC
		LIMIT 1
	`, cloudID)
	return scanJiraConnection(row)
}

func disconnectJiraConnection(id int) error {
	if err := clearJiraConnectionSecrets(id); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM jira_oauth_states WHERE connection_id = $1`, id); err != nil {
		return err
	}
	return updateJiraConnectionState(id, jiraStatePaused, jiraHealthPaused, jiraHealthPaused, false, "Disconnected. Synchronization stopped. Linked records were kept.")
}

func newJiraOperationID() string {
	return fmt.Sprintf("jiraop-%d-%s", time.Now().UTC().UnixNano(), randomHex(8))
}
