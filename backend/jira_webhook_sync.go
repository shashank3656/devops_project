package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

func jiraWebhookCallbackURL() string {
	return strings.TrimRight(oidcPublicAPIBase(), "/") + "/api/webhooks/jira"
}

func ensureJiraWebhooks(connectionID int) {
	conn, err := getJiraConnection(connectionID)
	if err != nil || strings.TrimSpace(conn.CloudID) == "" {
		return
	}
	spaces, _ := listJiraSpaces(connectionID)
	keys := []string{}
	for _, space := range spaces {
		if space.Enabled && strings.TrimSpace(space.JiraProjectKey) != "" {
			keys = append(keys, `"`+escapeJQL(space.JiraProjectKey)+`"`)
		}
	}
	if len(keys) == 0 {
		_ = upsertJiraWebhookRegistration(connectionID, "", time.Time{}, "missing", "Select spaces before registering webhooks.")
		return
	}
	token, err := jiraValidAccessToken(connectionID)
	if err != nil {
		_ = upsertJiraWebhookRegistration(connectionID, "", time.Time{}, "failed", err.Error())
		return
	}
	current, _ := getJiraWebhookRegistration(connectionID)
	if current.ProviderIDs != "" {
		_ = jiraAPI.DeleteWebhooks(token, conn.CloudID, strings.Split(current.ProviderIDs, ","))
	}
	jql := "project in (" + strings.Join(keys, ",") + ")"
	ids, err := jiraAPI.RegisterWebhooks(token, conn.CloudID, jiraWebhookCallbackURL(), jql, []string{"jira:issue_updated", "jira:issue_created"})
	if err != nil {
		status := "failed"
		if strings.Contains(strings.ToLower(err.Error()), "scope") || strings.Contains(strings.ToLower(err.Error()), "forbidden") {
			status = "scope_missing"
		}
		_ = upsertJiraWebhookRegistration(connectionID, "", time.Time{}, status, err.Error())
		return
	}
	exp := time.Now().Add(30 * 24 * time.Hour)
	if listed, listErr := jiraAPI.ListWebhooks(token, conn.CloudID); listErr == nil {
		for _, hook := range listed {
			if !hook.Expiration.IsZero() {
				exp = hook.Expiration
				break
			}
		}
	}
	_ = upsertJiraWebhookRegistration(connectionID, strings.Join(ids, ","), exp, "registered", "")
}

func deleteJiraWebhooks(connectionID int) {
	conn, err := getJiraConnection(connectionID)
	if err != nil {
		return
	}
	current, _ := getJiraWebhookRegistration(connectionID)
	if current.ProviderIDs == "" || strings.TrimSpace(conn.CloudID) == "" {
		_ = upsertJiraWebhookRegistration(connectionID, "", time.Time{}, "paused", "")
		return
	}
	token, err := jiraValidAccessToken(connectionID)
	if err == nil {
		_ = jiraAPI.DeleteWebhooks(token, conn.CloudID, strings.Split(current.ProviderIDs, ","))
	}
	_ = upsertJiraWebhookRegistration(connectionID, "", time.Time{}, "paused", "")
}

func runJiraWebhookRenewal() {
	if DB == nil {
		return
	}
	conns, err := listEnabledJiraConnections()
	if err != nil {
		return
	}
	for _, conn := range conns {
		reg, err := getJiraWebhookRegistration(conn.ID)
		if err != nil || reg.ProviderIDs == "" {
			ensureJiraWebhooks(conn.ID)
			continue
		}
		if reg.Expiration != nil && time.Until(*reg.Expiration) > 7*24*time.Hour {
			continue
		}
		token, err := jiraValidAccessToken(conn.ID)
		if err != nil {
			_ = upsertJiraWebhookRegistration(conn.ID, reg.ProviderIDs, time.Time{}, "failed", err.Error())
			continue
		}
		if err := jiraAPI.RefreshWebhooks(token, conn.CloudID, strings.Split(reg.ProviderIDs, ",")); err != nil {
			ensureJiraWebhooks(conn.ID)
			continue
		}
		exp := time.Now().Add(30 * 24 * time.Hour)
		_ = upsertJiraWebhookRegistration(conn.ID, reg.ProviderIDs, exp, "renewed", "")
	}
}

func getJiraWebhookRegistration(connectionID int) (jiraWebhookStatus, error) {
	var status jiraWebhookStatus
	var exp sql.NullTime
	err := DB.QueryRow(`
		SELECT provider_id, COALESCE(renewal_status, ''), COALESCE(last_error, ''), expiration
		FROM jira_webhook_registrations WHERE connection_id = $1
		ORDER BY id DESC LIMIT 1
	`, connectionID).Scan(&status.ProviderIDs, &status.RenewalStatus, &status.LastError, &exp)
	if err != nil {
		return jiraWebhookStatus{RenewalStatus: "missing"}, err
	}
	if exp.Valid {
		t := exp.Time.UTC()
		status.Expiration = &t
	}
	return status, nil
}

func upsertJiraWebhookRegistration(connectionID int, providerIDs string, exp time.Time, status, lastError string) error {
	var id int
	err := DB.QueryRow(`SELECT id FROM jira_webhook_registrations WHERE connection_id = $1 ORDER BY id DESC LIMIT 1`, connectionID).Scan(&id)
	if err != nil {
		_, err = DB.Exec(`
			INSERT INTO jira_webhook_registrations (connection_id, provider_id, expiration, renewal_status, last_error)
			VALUES ($1, $2, $3, $4, $5)
		`, connectionID, providerIDs, nullableTime(exp), status, lastError)
		return err
	}
	_, err = DB.Exec(`
		UPDATE jira_webhook_registrations
		SET provider_id = $2, expiration = $3, renewal_status = $4, last_error = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, providerIDs, nullableTime(exp), status, lastError)
	return err
}

func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func jiraIssueIsLinked(cloudID, issueID string) bool {
	if DB == nil || strings.TrimSpace(issueID) == "" {
		return false
	}
	var n int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM jira_issue_links WHERE cloud_id = $1 AND issue_id = $2`, cloudID, issueID).Scan(&n)
	return n > 0
}

func jiraWebhookStatusCheck(conn jiraConnection) string {
	reg, err := getJiraWebhookRegistration(conn.ID)
	if err != nil {
		return ""
	}
	switch reg.RenewalStatus {
	case "scope_missing":
		return "Webhook registration needs the manage:jira-webhook scope. Reauthorize this connection. Linked issues still refresh on a schedule."
	case "failed":
		return fmt.Sprintf("Webhook registration failed. Linked issues still refresh on a schedule. %s", reg.LastError)
	case "missing", "":
		if conn.Enabled {
			return "Jira webhooks are not registered yet. Linked issues still refresh on a schedule."
		}
	}
	if reg.Expiration != nil && time.Until(*reg.Expiration) < 7*24*time.Hour && time.Until(*reg.Expiration) > 0 {
		return "Jira webhooks expire within 7 days and will be renewed automatically."
	}
	return ""
}
