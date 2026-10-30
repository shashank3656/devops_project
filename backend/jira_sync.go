package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type jiraSyncPolicy struct {
	Configured       bool `json:"configured"`
	CreateIssues     bool `json:"create_issues"`
	LinkIssues       bool `json:"link_issues"`
	ReadStatus       bool `json:"read_status"`
	ReadAssignee     bool `json:"read_assignee"`
	ReadPriority     bool `json:"read_priority"`
	PublishComments  bool `json:"publish_comments"`
	ApplyTransitions bool `json:"apply_transitions"`
	SendAttachments  bool `json:"send_attachments"`
}

func jiraDefaultSyncPolicy() jiraSyncPolicy {
	return jiraSyncPolicy{
		CreateIssues:     true,
		LinkIssues:       true,
		ReadStatus:       true,
		ReadAssignee:     true,
		ReadPriority:     true,
		PublishComments:  true,
		ApplyTransitions: true,
		SendAttachments:  true,
	}
}

func jiraFieldOwnership() []map[string]string {
	return []map[string]string{
		{"field": "Title, status, assignee, priority", "owner": "Jira after creation", "direction": "Read from Jira"},
		{"field": "Incident impact and resolution", "owner": "OpsTrellis", "direction": "Not written to Jira"},
		{"field": "Change approval and deployment", "owner": "OpsTrellis", "direction": "Not written to Jira"},
		{"field": "Vulnerability verification", "owner": "OpsTrellis scan evidence", "direction": "Not written to Jira"},
		{"field": "Cost savings verification", "owner": "OpsTrellis billing analysis", "direction": "Not written to Jira"},
		{"field": "Record relationship", "owner": "OpsTrellis", "direction": "Stored here"},
		{"field": "Published comments", "owner": "Original system", "direction": "Publish once; do not mirror"},
	}
}

func loadJiraSyncPolicy(connectionID int) jiraSyncPolicy {
	policy := jiraDefaultSyncPolicy()
	if DB == nil || connectionID <= 0 {
		return policy
	}
	var raw string
	if err := DB.QueryRow(`SELECT COALESCE(sync_policy_json, '') FROM jira_connections WHERE id = $1`, connectionID).Scan(&raw); err != nil || strings.TrimSpace(raw) == "" {
		return policy
	}
	_ = json.Unmarshal([]byte(raw), &policy)
	return policy
}

func jiraSyncPolicyConfigured(connectionID int) bool {
	if DB == nil || connectionID <= 0 {
		return true
	}
	var raw string
	if err := DB.QueryRow(`SELECT COALESCE(sync_policy_json, '') FROM jira_connections WHERE id = $1`, connectionID).Scan(&raw); err != nil {
		return true
	}
	if strings.TrimSpace(raw) == "" {
		return false
	}
	var policy jiraSyncPolicy
	if err := json.Unmarshal([]byte(raw), &policy); err != nil {
		return false
	}
	return policy.Configured
}

func saveJiraSyncPolicy(connectionID int, policy jiraSyncPolicy) error {
	policy.Configured = true
	body, _ := json.Marshal(policy)
	_, err := DB.Exec(`UPDATE jira_connections SET sync_policy_json = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, connectionID, string(body))
	return err
}

func jiraWriteAllowed(connectionID int, kind string) error {
	policy := loadJiraSyncPolicy(connectionID)
	switch kind {
	case "create":
		if !policy.CreateIssues {
			return fmt.Errorf("creating Jira issues is turned off in sync rules")
		}
	case "link":
		if !policy.LinkIssues {
			return fmt.Errorf("linking Jira issues is turned off in sync rules")
		}
	case "comment":
		if !policy.PublishComments {
			return fmt.Errorf("publishing Jira comments is turned off in sync rules")
		}
	case "transition":
		if !policy.ApplyTransitions {
			return fmt.Errorf("Jira transitions are turned off in sync rules")
		}
	case "attach":
		if !policy.SendAttachments {
			return fmt.Errorf("Jira attachments are turned off in sync rules")
		}
	}
	return nil
}

func jiraConnectionSyncPolicyHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	conn, ok := jiraMustManage(w, r, userID, id)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":     "ok",
			"policy":     loadJiraSyncPolicy(id),
			"ownership":  jiraFieldOwnership(),
			"configured": jiraSyncPolicyConfigured(id),
		})
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	policy := loadJiraSyncPolicy(id)
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&policy); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if err := saveJiraSyncPolicy(id, policy); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "sync rules could not be saved", err)
		return
	}
	insertJiraAudit(id, userID, "sync_policy", "", 0, conn.CloudID, "", "ok", "Field ownership saved")
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"policy":    loadJiraSyncPolicy(id),
		"ownership": jiraFieldOwnership(),
		"note":      "OpsTrellis still does not edit Jira title, status, assignee, or priority as fields. Status changes use transitions.",
	})
}
