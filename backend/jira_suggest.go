package main

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var jiraIssueKeyPattern = regexp.MustCompile(`\b[A-Z][A-Z0-9]{1,9}-\d+\b`)

func jiraExtractIssueKeys(parts ...string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, part := range parts {
		for _, match := range jiraIssueKeyPattern.FindAllString(part, -1) {
			if _, ok := seen[match]; ok {
				continue
			}
			seen[match] = struct{}{}
			out = append(out, match)
		}
	}
	return out
}

func jiraKeyMatchReason(key, title, branch, body string) string {
	switch {
	case strings.Contains(title, key):
		return "title"
	case strings.Contains(branch, key):
		return "branch"
	case strings.Contains(body, key):
		return "description"
	default:
		return "matched"
	}
}

func jiraSuggestionsHandler(w http.ResponseWriter, r *http.Request, userID int) {
	q := r.URL.Query()
	sourceType := strings.TrimSpace(q.Get("source_type"))
	sourceID := atoiSafe(q.Get("source_id"))
	sourceKey := strings.TrimSpace(q.Get("source_key"))
	title := q.Get("title")
	branch := q.Get("branch")
	body := q.Get("body")
	keys := jiraExtractIssueKeys(title, branch, body)
	if len(keys) == 0 {
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":      "ok",
			"suggestions": []jiraSuggestion{},
			"note":        "A matching issue key is a suggestion until someone confirms the link.",
		})
		return
	}
	existing, _ := listJiraIssueLinks(sourceType, sourceID, sourceKey)
	linked := map[string]struct{}{}
	for _, link := range existing {
		linked[jiraIssueIdentity(link.Issue.CloudID, link.Issue.IssueID)] = struct{}{}
		linked[strings.ToUpper(link.Issue.IssueKey)] = struct{}{}
	}
	spaces, _ := listJiraSpaces(0)
	out := []jiraSuggestion{}
	seen := map[string]struct{}{}
	for _, space := range spaces {
		if !space.Enabled {
			continue
		}
		access, err := jiraAccessForSpace(userID, space.ID)
		if err != nil || !access.CanLink {
			continue
		}
		token, err := jiraValidAccessToken(space.ConnectionID)
		if err != nil {
			continue
		}
		for _, key := range keys {
			issue, err := jiraAPI.GetIssue(token, space.CloudID, key)
			if err != nil || issue == nil {
				continue
			}
			if issue.ProjectID != space.JiraProjectID && !strings.EqualFold(issue.ProjectKey, space.JiraProjectKey) {
				continue
			}
			view := remoteIssueView(issue, space)
			if view.Restricted && !access.IsOwner && !access.CanAdminister {
				continue
			}
			ident := jiraIssueIdentity(space.CloudID, issue.ID)
			if _, ok := linked[ident]; ok {
				continue
			}
			if _, ok := seen[ident]; ok {
				continue
			}
			if jiraSuggestionDismissed(sourceType, sourceID, sourceKey, space.CloudID, issue.ID) {
				continue
			}
			seen[ident] = struct{}{}
			rel := jiraRelRelated
			if sourceType == jiraSourcePR || sourceType == jiraSourceChange {
				rel = jiraRelImplements
			}
			out = append(out, jiraSuggestion{
				Key:          issue.Key,
				Reason:       jiraKeyMatchReason(key, title, branch, body),
				Validated:    true,
				SpaceID:      space.ID,
				Relationship: rel,
				Issue:        view,
				Note:         "Suggested from the pull request text. It is not linked until you confirm.",
			})
		}
	}
	validatedKeys := map[string]struct{}{}
	for _, item := range out {
		validatedKeys[strings.ToUpper(item.Key)] = struct{}{}
	}
	for _, key := range keys {
		if _, ok := linked[strings.ToUpper(key)]; ok {
			continue
		}
		if _, ok := validatedKeys[strings.ToUpper(key)]; ok {
			continue
		}
		rel := jiraRelRelated
		if sourceType == jiraSourcePR || sourceType == jiraSourceChange {
			rel = jiraRelImplements
		}
		out = append(out, jiraSuggestion{
			Key:          key,
			Reason:       jiraKeyMatchReason(key, title, branch, body),
			Validated:    false,
			Relationship: rel,
			Issue:        jiraIssueView{IssueKey: key, Summary: "Not validated yet"},
			Note:         "Matched in the pull request text. Search a permitted space to confirm before linking.",
		})
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"suggestions": out,
		"note":        "A matching issue key is a suggestion until someone confirms the link.",
	})
}

func jiraDismissSuggestionHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req struct {
		SourceType string `json:"source_type"`
		SourceID   int    `json:"source_id"`
		SourceKey  string `json:"source_key"`
		CloudID    string `json:"cloud_id"`
		IssueID    string `json:"issue_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if strings.TrimSpace(req.CloudID) == "" || strings.TrimSpace(req.IssueID) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "cloud_id and issue_id are required", nil)
		return
	}
	_ = userID
	if err := dismissJiraSuggestion(req.SourceType, req.SourceID, req.SourceKey, req.CloudID, req.IssueID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "suggestion could not be dismissed", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func jiraSuggestionDismissed(sourceType string, sourceID int, sourceKey, cloudID, issueID string) bool {
	if DB == nil {
		return false
	}
	var n int
	_ = DB.QueryRow(`
		SELECT COUNT(*) FROM jira_suggestion_dismissals
		WHERE source_type = $1 AND source_id = $2 AND source_key = $3 AND cloud_id = $4 AND issue_id = $5
	`, sourceType, sourceID, sourceKey, cloudID, issueID).Scan(&n)
	return n > 0
}

func dismissJiraSuggestion(sourceType string, sourceID int, sourceKey, cloudID, issueID string) error {
	_, err := DB.Exec(`
		INSERT INTO jira_suggestion_dismissals (source_type, source_id, source_key, cloud_id, issue_id)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (source_type, source_id, source_key, cloud_id, issue_id) DO NOTHING
	`, sourceType, sourceID, sourceKey, cloudID, issueID)
	return err
}
