package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type jiraCreateRequest struct {
	SpaceID      int            `json:"space_id"`
	IssueTypeID  string         `json:"issue_type_id"`
	Summary      string         `json:"summary"`
	Description  string         `json:"description"`
	Relationship string         `json:"relationship"`
	SourceType   string         `json:"source_type"`
	SourceID     int            `json:"source_id"`
	SourceKey    string         `json:"source_key"`
	Fields       map[string]any `json:"fields"`
	RuleID       int            `json:"rule_id,omitempty"`
}

func jiraSanitizeCreateText(s string) string {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	blocked := []string{"-----begin ", "aws_secret", "authorization: bearer", "password=", "token="}
	for _, needle := range blocked {
		if strings.Contains(lower, needle) {
			return ""
		}
	}
	if len(s) > 4000 {
		s = s[:4000]
	}
	return s
}

func enqueueJiraCreate(userID int, req jiraCreateRequest) (jiraOperationView, error) {
	space, err := getJiraSpace(req.SpaceID)
	if err != nil {
		return jiraOperationView{}, fmt.Errorf("Jira space was not found")
	}
	if !space.Enabled {
		return jiraOperationView{}, fmt.Errorf("this Jira space is paused")
	}
	if err := jiraWriteAllowed(space.ConnectionID, "create"); err != nil {
		return jiraOperationView{}, err
	}
	access, err := jiraAccessForSpace(userID, space.ID)
	if err != nil || !access.CanCreate {
		return jiraOperationView{}, fmt.Errorf("you cannot create Jira work in this space")
	}
	summary := jiraSanitizeCreateText(req.Summary)
	if summary == "" {
		return jiraOperationView{}, fmt.Errorf("a summary is required")
	}
	req.Summary = summary
	req.Description = jiraSanitizeCreateText(req.Description)
	if req.Relationship == "" {
		req.Relationship = jiraRelRelated
	}
	op, err := insertJiraOperation(jiraOperationView{
		Kind:       "create_issue",
		SourceType: req.SourceType,
		SourceID:   req.SourceID,
		SourceKey:  req.SourceKey,
		CloudID:    space.CloudID,
		State:      jiraOpQueued,
	}, req, space.ConnectionID, userID)
	if err != nil {
		return op, err
	}
	insertJiraAudit(space.ConnectionID, userID, "create_queued", req.SourceType, req.SourceID, space.CloudID, "", "queued", op.OperationID)
	return op, nil
}

func enqueueJiraLink(userID int, spaceID int, issueRef, relationship, sourceType, sourceKey string, sourceID int) (jiraOperationView, error) {
	space, err := getJiraSpace(spaceID)
	if err != nil {
		return jiraOperationView{}, fmt.Errorf("Jira space was not found")
	}
	if err := jiraWriteAllowed(space.ConnectionID, "link"); err != nil {
		return jiraOperationView{}, err
	}
	access, err := jiraAccessForSpace(userID, space.ID)
	if err != nil || !access.CanLink {
		return jiraOperationView{}, fmt.Errorf("you cannot link Jira work in this space")
	}
	if relationship == "" {
		relationship = jiraRelRelated
	}
	payload := map[string]any{
		"space_id":     space.ID,
		"issue_ref":    strings.TrimSpace(issueRef),
		"relationship": relationship,
		"source_type":  sourceType,
		"source_id":    sourceID,
		"source_key":   sourceKey,
	}
	op, err := insertJiraOperation(jiraOperationView{
		Kind:       "link_issue",
		SourceType: sourceType,
		SourceID:   sourceID,
		SourceKey:  sourceKey,
		CloudID:    space.CloudID,
		State:      jiraOpQueued,
	}, payload, space.ConnectionID, userID)
	if err != nil {
		return op, err
	}
	insertJiraAudit(space.ConnectionID, userID, "link_queued", sourceType, sourceID, space.CloudID, "", "queued", op.OperationID)
	return op, nil
}

func processJiraOperation(operationID string) {
	op, payload, connectionID, err := getJiraOperationByID(operationID)
	if err != nil {
		return
	}
	if op.State == jiraOpSucceeded {
		return
	}
	attempts := op.Attempts + 1
	_ = updateJiraOperation(operationID, jiraOpRunning, "", op.IssueID, op.CloudID, attempts, nil)
	token, err := jiraValidAccessToken(connectionID)
	if err != nil {
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	switch op.Kind {
	case "create_issue", "remediate_create":
		processJiraCreate(op, payload, connectionID, token, attempts)
	case "link_issue":
		processJiraLink(op, payload, connectionID, token, attempts)
	case "refresh_issue":
		processJiraRefresh(op, connectionID, token, attempts)
	case "add_comment":
		processJiraComment(op, payload, connectionID, token, attempts)
	case "transition_issue":
		processJiraTransition(op, payload, connectionID, token, attempts)
	default:
		_ = updateJiraOperation(operationID, jiraOpFailed, "Unknown operation", op.IssueID, op.CloudID, attempts, nil)
	}
}

func processJiraCreate(op jiraOperationView, payload string, connectionID int, token string, attempts int) {
	var req jiraCreateRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "Stored create payload was invalid", "", op.CloudID, attempts, nil)
		return
	}
	space, err := getJiraSpace(req.SpaceID)
	if err != nil {
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	if found, ok := reconcileJiraCreate(token, space, op.OperationID); ok {
		finishJiraCreate(op, connectionID, space, found, req, attempts)
		return
	}
	fields := map[string]any{
		"project":     map[string]any{"id": space.JiraProjectID},
		"issuetype":   map[string]any{"id": req.IssueTypeID},
		"summary":     req.Summary,
		"description": jiraADFFromText(fmt.Sprintf("%s\n\nOpsTrellis-Operation: %s", req.Description, op.OperationID)),
		"labels":      []string{"opstrellis", jiraOperationLabel(op.OperationID)},
	}
	for key, value := range req.Fields {
		if key == "summary" || key == "description" || key == "project" || key == "issuetype" {
			continue
		}
		fields[key] = value
	}
	created, err := jiraAPI.CreateIssue(token, space.CloudID, map[string]any{"fields": fields})
	if err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpReconcile, err.Error(), "", space.CloudID, attempts, jiraRetryAt(attempts, err))
			_ = updateJiraConnectionState(connectionID, jiraStateConnected, jiraHealthConnected, jiraHealthDelayed, true, err.Error())
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	finishJiraCreate(op, connectionID, space, created, req, attempts)
}

func reconcileJiraCreate(token string, space jiraSpace, operationID string) (*jiraRemoteIssue, bool) {
	jql := fmt.Sprintf(`project = "%s" AND text ~ "OpsTrellis-Operation: %s"`, strings.ReplaceAll(space.JiraProjectKey, `"`, ""), operationID)
	found, err := jiraAPI.SearchIssues(token, space.CloudID, jql, 5)
	if err != nil || len(found) == 0 {
		return nil, false
	}
	return &found[0], true
}

func finishJiraCreate(op jiraOperationView, connectionID int, space jiraSpace, issue *jiraRemoteIssue, req jiraCreateRequest, attempts int) {
	view := remoteIssueView(issue, space)
	_ = upsertJiraIssue(view, space.ID, connectionID)
	if req.SourceType != "" {
		_, _ = insertJiraIssueLink(req.SourceType, req.SourceID, req.SourceKey, space.CloudID, issue.ID, req.Relationship, 0)
	}
	_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", issue.ID, space.CloudID, attempts, nil)
	_ = markJiraConnectionSuccess(connectionID)
	insertJiraAudit(connectionID, 0, "create_issue", req.SourceType, req.SourceID, space.CloudID, issue.ID, "succeeded", issue.Key)
}

func processJiraLink(op jiraOperationView, payload string, connectionID int, token string, attempts int) {
	var req struct {
		SpaceID      int    `json:"space_id"`
		IssueRef     string `json:"issue_ref"`
		Relationship string `json:"relationship"`
		SourceType   string `json:"source_type"`
		SourceID     int    `json:"source_id"`
		SourceKey    string `json:"source_key"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "Stored link payload was invalid", "", op.CloudID, attempts, nil)
		return
	}
	space, err := getJiraSpace(req.SpaceID)
	if err != nil {
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	issue, err := jiraAPI.GetIssue(token, space.CloudID, req.IssueRef)
	if err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpRetrying, err.Error(), "", space.CloudID, attempts, jiraRetryAt(attempts, err))
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	if issue.ProjectID != space.JiraProjectID && !strings.EqualFold(issue.ProjectKey, space.JiraProjectKey) {
		_ = updateJiraOperation(op.OperationID, jiraOpFailed, "That issue is outside the selected Jira space.", "", space.CloudID, attempts, nil)
		return
	}
	view := remoteIssueView(issue, space)
	_ = upsertJiraIssue(view, space.ID, connectionID)
	_, _ = insertJiraIssueLink(req.SourceType, req.SourceID, req.SourceKey, space.CloudID, issue.ID, req.Relationship, 0)
	_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", issue.ID, space.CloudID, attempts, nil)
	_ = markJiraConnectionSuccess(connectionID)
	insertJiraAudit(connectionID, 0, "link_issue", req.SourceType, req.SourceID, space.CloudID, issue.ID, "succeeded", issue.Key)
}

func processJiraRefresh(op jiraOperationView, connectionID int, token string, attempts int) {
	issue, err := jiraAPI.GetIssue(token, op.CloudID, op.IssueID)
	if err != nil {
		if jiraIsTemporary(err) && attempts < 8 {
			_ = updateJiraOperation(op.OperationID, jiraOpRetrying, err.Error(), op.IssueID, op.CloudID, attempts, jiraRetryAt(attempts, err))
			return
		}
		jiraFailOperation(op, connectionID, attempts, err)
		return
	}
	space, _ := findJiraSpaceByProject(connectionID, issue.ProjectID, issue.ProjectKey)
	view := remoteIssueView(issue, space)
	_ = upsertJiraIssue(view, space.ID, connectionID)
	_ = updateJiraOperation(op.OperationID, jiraOpSucceeded, "", issue.ID, op.CloudID, attempts, nil)
	_ = markJiraConnectionSuccess(connectionID)
}

func remoteIssueView(issue *jiraRemoteIssue, space jiraSpace) jiraIssueView {
	restricted := strings.TrimSpace(issue.SecurityLevel) != ""
	return jiraIssueView{
		CloudID:           space.CloudID,
		IssueID:           issue.ID,
		IssueKey:          issue.Key,
		Summary:           issue.Summary,
		Status:            issue.Status,
		StatusCategory:    issue.StatusCategory,
		Priority:          issue.Priority,
		AssigneeAccountID: issue.AssigneeAccountID,
		AssigneeDisplay:   issue.AssigneeDisplay,
		IssueType:         issue.IssueType,
		Restricted:        restricted,
		BrowseURL:         issue.BrowseURL,
		SiteName:          space.SiteName,
		SpaceName:         space.Name,
		SpaceKey:          space.JiraProjectKey,
		RemoteUpdatedAt:   issue.Updated,
	}
}

func jiraFailOperation(op jiraOperationView, connectionID, attempts int, err error) {
	msg := "Jira operation failed"
	if err != nil {
		msg = err.Error()
	}
	state := jiraOpFailed
	var next *time.Time
	if jiraIsTemporary(err) && attempts < 8 {
		state = jiraOpRetrying
		next = jiraRetryAt(attempts, err)
	}
	_ = updateJiraOperation(op.OperationID, state, msg, op.IssueID, op.CloudID, attempts, next)
	if jiraNeedsReauth(err) {
		_ = updateJiraConnectionState(connectionID, jiraStateFailed, jiraHealthReauth, jiraHealthFailed, false, msg)
	} else if state == jiraOpFailed {
		_ = updateJiraConnectionState(connectionID, jiraStateConnected, jiraHealthConnected, jiraHealthFailed, true, msg)
	}
	insertJiraAudit(connectionID, 0, op.Kind, op.SourceType, op.SourceID, op.CloudID, op.IssueID, state, msg)
}

func jiraBackoff(attempts int) *time.Time {
	wait := time.Duration(attempts*attempts) * 20 * time.Second
	if wait > 15*time.Minute {
		wait = 15 * time.Minute
	}
	t := time.Now().Add(wait)
	return &t
}

func jiraRetryAt(attempts int, err error) *time.Time {
	if api, ok := err.(jiraAPIError); ok && api.RetryAfter > 0 {
		t := time.Now().Add(api.RetryAfter + time.Second)
		return &t
	}
	return jiraBackoff(attempts)
}

func enqueueJiraIssueRefresh(connectionID, actor int, cloudID, issueID, origin string) (jiraOperationView, error) {
	if existing, ok := pendingJiraRefreshOperation(cloudID, issueID); ok {
		return existing, nil
	}
	return insertJiraOperation(jiraOperationView{
		Kind:    "refresh_issue",
		CloudID: cloudID,
		IssueID: issueID,
		State:   jiraOpQueued,
	}, map[string]any{"origin": origin}, connectionID, actor)
}

func jiraOperationLabel(operationID string) string {
	label := strings.ToLower(strings.ReplaceAll(operationID, "jiraop-", "ot-"))
	label = strings.ReplaceAll(label, "_", "-")
	if len(label) > 20 {
		label = label[:20]
	}
	if label == "" {
		return "ot-opstrellis"
	}
	return label
}

func jiraDoneDoesNotClosePortal(statusCategory string) bool {
	return strings.EqualFold(strings.TrimSpace(statusCategory), "done")
}

func retryJiraOperation(operationID string) error {
	op, _, _, err := getJiraOperationByID(operationID)
	if err != nil {
		return err
	}
	if op.State != jiraOpFailed && op.State != jiraOpRetrying {
		return fmt.Errorf("this operation cannot be retried")
	}
	now := time.Now()
	return updateJiraOperation(operationID, jiraOpQueued, "", op.IssueID, op.CloudID, op.Attempts, &now)
}
