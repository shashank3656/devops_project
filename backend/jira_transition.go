package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func jiraListTransitionsHandler(w http.ResponseWriter, r *http.Request, userID int) {
	cloudID := strings.TrimSpace(r.URL.Query().Get("cloud_id"))
	issueID := strings.TrimSpace(r.URL.Query().Get("issue_id"))
	if cloudID == "" || issueID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "cloud_id and issue_id are required", nil)
		return
	}
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "linked issue not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanCreate && !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change Jira status for this issue", nil)
		return
	}
	token, err := jiraValidAccessToken(space.ConnectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	transitions, err := jiraAPI.GetTransitions(token, cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"transitions": transitions,
		"note":        "Status changes use Jira transitions. Done in Jira does not close the portal record.",
	})
}

func jiraTransitionHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req struct {
		CloudID      string `json:"cloud_id"`
		IssueID      string `json:"issue_id"`
		TransitionID string `json:"transition_id"`
		SourceType   string `json:"source_type"`
		SourceID     int    `json:"source_id"`
		SourceKey    string `json:"source_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	op, err := enqueueJiraTransition(userID, req.CloudID, req.IssueID, req.TransitionID, req.SourceType, req.SourceKey, req.SourceID)
	if err != nil {
		writeAPIError(w, r, http.StatusForbidden, err.Error(), err)
		return
	}
	go processJiraOperation(op.OperationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "ok", "operation": op})
}

func enqueueJiraTransition(userID int, cloudID, issueID, transitionID, sourceType, sourceKey string, sourceID int) (jiraOperationView, error) {
	if strings.TrimSpace(transitionID) == "" {
		return jiraOperationView{}, fmt.Errorf("transition_id is required")
	}
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		return jiraOperationView{}, fmt.Errorf("linked issue not found")
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanCreate && !access.CanAdminister {
		return jiraOperationView{}, fmt.Errorf("you cannot change Jira status for this issue")
	}
	if err := jiraWriteAllowed(space.ConnectionID, "transition"); err != nil {
		return jiraOperationView{}, err
	}
	payload := map[string]any{
		"cloud_id":      space.CloudID,
		"issue_id":      issueID,
		"transition_id": strings.TrimSpace(transitionID),
		"source_type":   sourceType,
		"source_id":     sourceID,
		"source_key":    sourceKey,
	}
	op, err := insertJiraOperation(jiraOperationView{
		Kind:       "transition_issue",
		SourceType: sourceType,
		SourceID:   sourceID,
		SourceKey:  sourceKey,
		CloudID:    space.CloudID,
		IssueID:    issueID,
		State:      jiraOpQueued,
	}, payload, space.ConnectionID, userID)
	if err != nil {
		return op, err
	}
	insertJiraAudit(space.ConnectionID, userID, "transition_queued", sourceType, sourceID, space.CloudID, issueID, "queued", transitionID)
	return op, nil
}

func processJiraTransition(op jiraOperationView, payload string, connectionID int, token string, attempts int) {
	var req struct {
		CloudID      string `json:"cloud_id"`
		IssueID      string `json:"issue_id"`
		TransitionID string `json:"transition_id"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil || req.IssueID == "" || req.TransitionID == "" {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "Stored transition payload was invalid", op.IssueID, op.CloudID, attempts, nil)
		return
	}
	available, err := jiraAPI.GetTransitions(token, req.CloudID, req.IssueID)
	if err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpRetrying, err.Error(), req.IssueID, req.CloudID, attempts, jiraRetryAt(attempts, err))
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	allowed := false
	for _, item := range available {
		if item.ID == req.TransitionID {
			allowed = true
			break
		}
	}
	if !allowed {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "Jira no longer allows that transition. The issue status may have changed. Refresh and choose again.", req.IssueID, req.CloudID, attempts, nil)
		return
	}
	if err := jiraAPI.TransitionIssue(token, req.CloudID, req.IssueID, req.TransitionID); err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpRetrying, err.Error(), req.IssueID, req.CloudID, attempts, jiraRetryAt(attempts, err))
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	issue, err := jiraAPI.GetIssue(token, req.CloudID, req.IssueID)
	if err == nil && issue != nil {
		space, _ := findJiraSpaceForIssue(req.CloudID, req.IssueID)
		view := remoteIssueView(issue, space)
		_ = upsertJiraIssue(view, space.ID, connectionID)
	}
	_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", req.IssueID, req.CloudID, attempts, nil)
	_ = markJiraConnectionSuccess(connectionID)
	insertJiraAudit(connectionID, 0, "transition_issue", op.SourceType, op.SourceID, req.CloudID, req.IssueID, "succeeded", req.TransitionID)
}
