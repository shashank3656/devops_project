package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func jiraAddCommentHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req struct {
		CloudID    string `json:"cloud_id"`
		IssueID    string `json:"issue_id"`
		Body       string `json:"body"`
		SourceType string `json:"source_type"`
		SourceID   int    `json:"source_id"`
		SourceKey  string `json:"source_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	body := jiraSanitizeCreateText(req.Body)
	if body == "" {
		writeAPIError(w, r, http.StatusBadRequest, "enter the comment that should be published. AI summaries are not sent automatically.", nil)
		return
	}
	space, err := findJiraSpaceForIssue(req.CloudID, req.IssueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "linked issue not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanLink && !access.CanCreate {
		writeAPIError(w, r, http.StatusForbidden, "you cannot publish comments to this Jira issue", nil)
		return
	}
	if err := jiraWriteAllowed(space.ConnectionID, "comment"); err != nil {
		writeAPIError(w, r, http.StatusForbidden, err.Error(), err)
		return
	}
	payload := map[string]any{
		"cloud_id":    space.CloudID,
		"issue_id":    req.IssueID,
		"body":        body,
		"source_type": req.SourceType,
		"source_id":   req.SourceID,
		"source_key":  req.SourceKey,
		"origin":      "opstrellis",
	}
	op, err := insertJiraOperation(jiraOperationView{
		Kind:       "add_comment",
		SourceType: req.SourceType,
		SourceID:   req.SourceID,
		SourceKey:  req.SourceKey,
		CloudID:    space.CloudID,
		IssueID:    req.IssueID,
		State:      jiraOpQueued,
	}, payload, space.ConnectionID, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "comment could not be queued", err)
		return
	}
	insertJiraAudit(space.ConnectionID, userID, "comment_queued", req.SourceType, req.SourceID, space.CloudID, req.IssueID, "queued", op.OperationID)
	go processJiraOperation(op.OperationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"status":    "ok",
		"operation": op,
		"preview": map[string]any{
			"site_name": space.SiteName,
			"space_key": space.JiraProjectKey,
			"issue_id":  req.IssueID,
			"body":      body,
			"note":      "This comment is published only because you confirmed it. It is not mirrored back into OpsTrellis.",
		},
	})
}

func processJiraComment(op jiraOperationView, payload string, connectionID int, token string, attempts int) {
	if existing := jiraCommentPostID(op.OperationID); existing != "" {
		_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", op.IssueID, op.CloudID, attempts, nil)
		return
	}
	var req struct {
		CloudID string `json:"cloud_id"`
		IssueID string `json:"issue_id"`
		Body    string `json:"body"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil || req.IssueID == "" {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "Stored comment payload was invalid", op.IssueID, op.CloudID, attempts, nil)
		return
	}
	text := strings.TrimSpace(req.Body)
	if !strings.Contains(text, "OpsTrellis-Operation:") {
		text = fmt.Sprintf("%s\n\nOpsTrellis-Operation: %s\nOrigin: opstrellis", text, op.OperationID)
	}
	commentID, err := jiraAPI.AddComment(token, req.CloudID, req.IssueID, text)
	if err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpRetrying, err.Error(), req.IssueID, req.CloudID, attempts, jiraRetryAt(attempts, err))
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	_ = saveJiraCommentPost(op.OperationID, req.CloudID, req.IssueID, commentID)
	_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", req.IssueID, req.CloudID, attempts, nil)
	_ = markJiraConnectionSuccess(connectionID)
	insertJiraAudit(connectionID, 0, "add_comment", op.SourceType, op.SourceID, req.CloudID, req.IssueID, "succeeded", commentID)
}

func jiraCommentPostID(operationID string) string {
	if DB == nil || strings.TrimSpace(operationID) == "" {
		return ""
	}
	var id string
	_ = DB.QueryRow(`SELECT jira_comment_id FROM jira_comment_posts WHERE operation_id = $1`, operationID).Scan(&id)
	return id
}

func saveJiraCommentPost(operationID, cloudID, issueID, commentID string) error {
	_, err := DB.Exec(`
		INSERT INTO jira_comment_posts (operation_id, cloud_id, issue_id, jira_comment_id, origin)
		VALUES ($1, $2, $3, $4, 'opstrellis')
		ON CONFLICT (operation_id) DO NOTHING
	`, operationID, cloudID, issueID, commentID)
	return err
}

func jiraCommentHasOrigin(text string) bool {
	return strings.Contains(strings.ToLower(text), "origin: opstrellis")
}
