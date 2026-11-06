package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func jiraBulkHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req struct {
		Action string `json:"action"`
		Items  []struct {
			SpaceID      int            `json:"space_id"`
			IssueRef     string         `json:"issue_ref"`
			CloudID      string         `json:"cloud_id"`
			IssueID      string         `json:"issue_id"`
			TransitionID string         `json:"transition_id"`
			IssueTypeID  string         `json:"issue_type_id"`
			Summary      string         `json:"summary"`
			Description  string         `json:"description"`
			Relationship string         `json:"relationship"`
			SourceType   string         `json:"source_type"`
			SourceID     int            `json:"source_id"`
			SourceKey    string         `json:"source_key"`
			Fields       map[string]any `json:"fields"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if len(req.Items) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "select at least one item", nil)
		return
	}
	if len(req.Items) > 25 {
		writeAPIError(w, r, http.StatusBadRequest, "bulk actions are limited to 25 items", nil)
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	results := make([]jiraBulkResult, 0, len(req.Items))
	for i, item := range req.Items {
		result := jiraBulkResult{Index: i}
		var op jiraOperationView
		var err error
		switch action {
		case "link":
			op, err = enqueueJiraLink(userID, item.SpaceID, item.IssueRef, item.Relationship, item.SourceType, item.SourceKey, item.SourceID)
		case "create":
			op, err = enqueueJiraCreate(userID, jiraCreateRequest{
				SpaceID:      item.SpaceID,
				IssueTypeID:  item.IssueTypeID,
				Summary:      item.Summary,
				Description:  item.Description,
				Relationship: item.Relationship,
				SourceType:   item.SourceType,
				SourceID:     item.SourceID,
				SourceKey:    item.SourceKey,
				Fields:       item.Fields,
			})
		case "transition":
			op, err = enqueueJiraTransition(userID, item.CloudID, item.IssueID, item.TransitionID, item.SourceType, item.SourceKey, item.SourceID)
		case "refresh":
			op, err = enqueueJiraRefresh(userID, item.CloudID, item.IssueID)
		default:
			err = errJiraBulkUnknown
		}
		if err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}
		result.OK = true
		result.OperationID = op.OperationID
		result.IssueKey = item.IssueRef
		results = append(results, result)
		go processJiraOperation(op.OperationID)
	}
	writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"status":  "ok",
		"results": results,
		"note":    "Each item is processed separately. One failure does not roll back the others.",
	})
}

var errJiraBulkUnknown = errString("unknown bulk action")

type errString string

func (e errString) Error() string { return string(e) }

func enqueueJiraRefresh(userID int, cloudID, issueID string) (jiraOperationView, error) {
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		return jiraOperationView{}, err
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanView {
		return jiraOperationView{}, errString("you cannot refresh this Jira issue")
	}
	return enqueueJiraIssueRefresh(space.ConnectionID, userID, cloudID, issueID, "bulk_refresh")
}
