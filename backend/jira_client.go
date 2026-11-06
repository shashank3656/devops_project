package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type jiraCloudAPI interface {
	AccessibleResources(accessToken string) ([]jiraRemoteSite, error)
	ListProjects(accessToken, cloudID, query string) ([]jiraRemoteSpace, error)
	GetIssue(accessToken, cloudID, issueIDOrKey string) (*jiraRemoteIssue, error)
	SearchIssues(accessToken, cloudID, jql string, max int) ([]jiraRemoteIssue, error)
	CreateIssue(accessToken, cloudID string, payload map[string]any) (*jiraRemoteIssue, error)
	AddComment(accessToken, cloudID, issueID, body string) (string, error)
	GetTransitions(accessToken, cloudID, issueID string) ([]jiraTransition, error)
	TransitionIssue(accessToken, cloudID, issueID, transitionID string) error
	AddAttachment(accessToken, cloudID, issueID, filename string, data []byte) (string, error)
	RegisterWebhooks(accessToken, cloudID, callbackURL string, jql string, events []string) ([]string, error)
	ListWebhooks(accessToken, cloudID string) ([]jiraRemoteWebhook, error)
	RefreshWebhooks(accessToken, cloudID string, ids []string) error
	DeleteWebhooks(accessToken, cloudID string, ids []string) error
	GetIssueTypes(accessToken, cloudID, projectID string) ([]jiraIssueType, error)
	GetCreateMeta(accessToken, cloudID, projectID, issueTypeID string) ([]jiraFieldMeta, error)
	RefreshToken(refreshToken string) (jiraTokenSet, error)
	GetMyself(accessToken, cloudID string) (jiraMyself, error)
}

type jiraMyself struct {
	AccountID string `json:"account_id"`
}

type jiraRemoteWebhook struct {
	ID         string
	Expiration time.Time
	JQL        string
	Events     []string
}

type liveJiraCloudAPI struct {
	httpClient *http.Client
}

var jiraAPI jiraCloudAPI = liveJiraCloudAPI{httpClient: &http.Client{Timeout: 25 * time.Second}}

func (a liveJiraCloudAPI) AccessibleResources(accessToken string) ([]jiraRemoteSite, error) {
	body, err := a.get("https://api.atlassian.com/oauth/token/accessible-resources", accessToken)
	if err != nil {
		return nil, err
	}
	var sites []jiraRemoteSite
	if err := json.Unmarshal(body, &sites); err != nil {
		return nil, fmt.Errorf("jira sites response was invalid")
	}
	return sites, nil
}

func (a liveJiraCloudAPI) ListProjects(accessToken, cloudID, query string) ([]jiraRemoteSpace, error) {
	out := []jiraRemoteSpace{}
	start := 0
	for start < 200 {
		u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/project/search?maxResults=50&startAt=%d", url.PathEscape(cloudID), start)
		if strings.TrimSpace(query) != "" {
			u += "&query=" + url.QueryEscape(query)
		}
		body, err := a.get(u, accessToken)
		if err != nil {
			return out, err
		}
		var parsed struct {
			IsLast     bool `json:"isLast"`
			MaxResults int  `json:"maxResults"`
			Values     []struct {
				ID    string `json:"id"`
				Key   string `json:"key"`
				Name  string `json:"name"`
				Style string `json:"style"`
			} `json:"values"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("jira project search response was invalid")
		}
		for _, v := range parsed.Values {
			out = append(out, jiraRemoteSpace{ID: v.ID, Key: v.Key, Name: v.Name, Style: v.Style})
		}
		if parsed.IsLast || len(parsed.Values) == 0 {
			break
		}
		page := parsed.MaxResults
		if page <= 0 {
			page = len(parsed.Values)
		}
		start += page
	}
	return out, nil
}

func (a liveJiraCloudAPI) GetIssue(accessToken, cloudID, issueIDOrKey string) (*jiraRemoteIssue, error) {
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/%s?fields=summary,status,priority,assignee,issuetype,project,security,updated", url.PathEscape(cloudID), url.PathEscape(issueIDOrKey))
	body, err := a.get(u, accessToken)
	if err != nil {
		return nil, err
	}
	return parseJiraRemoteIssue(body, cloudID)
}

func (a liveJiraCloudAPI) SearchIssues(accessToken, cloudID, jql string, max int) ([]jiraRemoteIssue, error) {
	if max <= 0 {
		max = 15
	}
	if max > 50 {
		max = 50
	}
	out := make([]jiraRemoteIssue, 0, max)
	start := 0
	for len(out) < max {
		page := max - len(out)
		if page > 50 {
			page = 50
		}
		payload, _ := json.Marshal(map[string]any{
			"jql":        jql,
			"startAt":    start,
			"maxResults": page,
			"fields":     []string{"summary", "status", "priority", "assignee", "issuetype", "project", "security", "updated"},
		})
		u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/search", url.PathEscape(cloudID))
		body, err := a.post(u, accessToken, payload)
		if err != nil {
			if len(out) > 0 {
				return out, nil
			}
			return nil, err
		}
		var parsed struct {
			Total  int               `json:"total"`
			Issues []json.RawMessage `json:"issues"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("jira search response was invalid")
		}
		if len(parsed.Issues) == 0 {
			break
		}
		for _, raw := range parsed.Issues {
			issue, err := parseJiraRemoteIssue(raw, cloudID)
			if err != nil {
				continue
			}
			out = append(out, *issue)
			if len(out) >= max {
				break
			}
		}
		start += len(parsed.Issues)
		if parsed.Total > 0 && start >= parsed.Total {
			break
		}
	}
	return out, nil
}

func (a liveJiraCloudAPI) CreateIssue(accessToken, cloudID string, payload map[string]any) (*jiraRemoteIssue, error) {
	body, _ := json.Marshal(payload)
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue", url.PathEscape(cloudID))
	resp, err := a.post(u, accessToken, body)
	if err != nil {
		return nil, err
	}
	var created struct {
		ID  string `json:"id"`
		Key string `json:"key"`
	}
	if err := json.Unmarshal(resp, &created); err != nil || created.ID == "" {
		return nil, fmt.Errorf("jira create response was invalid")
	}
	return a.GetIssue(accessToken, cloudID, created.ID)
}

func (a liveJiraCloudAPI) AddComment(accessToken, cloudID, issueID, body string) (string, error) {
	payload, _ := json.Marshal(map[string]any{
		"body": jiraADFFromText(body),
	})
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/%s/comment", url.PathEscape(cloudID), url.PathEscape(issueID))
	resp, err := a.post(u, accessToken, payload)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(resp, &created); err != nil || created.ID == "" {
		return "", fmt.Errorf("jira comment response was invalid")
	}
	return created.ID, nil
}

func (a liveJiraCloudAPI) GetTransitions(accessToken, cloudID, issueID string) ([]jiraTransition, error) {
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/%s/transitions", url.PathEscape(cloudID), url.PathEscape(issueID))
	body, err := a.get(u, accessToken)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Transitions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			To   struct {
				Name string `json:"name"`
			} `json:"to"`
		} `json:"transitions"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("jira transitions response was invalid")
	}
	out := make([]jiraTransition, 0, len(parsed.Transitions))
	for _, item := range parsed.Transitions {
		out = append(out, jiraTransition{ID: item.ID, Name: item.Name, To: item.To.Name})
	}
	return out, nil
}

func (a liveJiraCloudAPI) TransitionIssue(accessToken, cloudID, issueID, transitionID string) error {
	payload, _ := json.Marshal(map[string]any{
		"transition": map[string]any{"id": transitionID},
	})
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/%s/transitions", url.PathEscape(cloudID), url.PathEscape(issueID))
	_, err := a.post(u, accessToken, payload)
	return err
}

func (a liveJiraCloudAPI) AddAttachment(accessToken, cloudID, issueID, filename string, data []byte) (string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/%s/attachments", url.PathEscape(cloudID), url.PathEscape(issueID))
	req, err := http.NewRequest(http.MethodPost, u, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Atlassian-Token", "no-check")
	req.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", jiraAPIError{Status: 0, Message: "Jira could not be reached", Temporary: true}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", jiraAPIError{Status: resp.StatusCode, Message: jiraSafeAPIMessage(body), Temporary: resp.StatusCode >= 500}
	}
	var created []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &created); err != nil || len(created) == 0 || created[0].ID == "" {
		return "", fmt.Errorf("jira attachment response was invalid")
	}
	return created[0].ID, nil
}

func (a liveJiraCloudAPI) RegisterWebhooks(accessToken, cloudID, callbackURL, jql string, events []string) ([]string, error) {
	payload, _ := json.Marshal(map[string]any{
		"url": callbackURL,
		"webhooks": []map[string]any{{
			"jqlFilter": jql,
			"events":    events,
		}},
	})
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/webhook", url.PathEscape(cloudID))
	body, err := a.post(u, accessToken, payload)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		WebhookRegistrationResult []struct {
			CreatedWebhookID int      `json:"createdWebhookId"`
			Errors           []string `json:"errors"`
		} `json:"webhookRegistrationResult"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("jira webhook registration was invalid")
	}
	ids := []string{}
	for _, item := range parsed.WebhookRegistrationResult {
		if item.CreatedWebhookID > 0 {
			ids = append(ids, strconv.Itoa(item.CreatedWebhookID))
		}
		if len(item.Errors) > 0 && item.CreatedWebhookID == 0 {
			return nil, fmt.Errorf("%s", item.Errors[0])
		}
	}
	return ids, nil
}

func (a liveJiraCloudAPI) ListWebhooks(accessToken, cloudID string) ([]jiraRemoteWebhook, error) {
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/webhook?maxResults=100", url.PathEscape(cloudID))
	body, err := a.get(u, accessToken)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Values []struct {
			ID             int      `json:"id"`
			JqlFilter      string   `json:"jqlFilter"`
			Events         []string `json:"events"`
			ExpirationDate int64    `json:"expirationDate"`
		} `json:"values"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("jira webhook list was invalid")
	}
	out := []jiraRemoteWebhook{}
	for _, item := range parsed.Values {
		hook := jiraRemoteWebhook{ID: strconv.Itoa(item.ID), JQL: item.JqlFilter, Events: item.Events}
		if item.ExpirationDate > 0 {
			hook.Expiration = time.UnixMilli(item.ExpirationDate)
		}
		out = append(out, hook)
	}
	return out, nil
}

func (a liveJiraCloudAPI) RefreshWebhooks(accessToken, cloudID string, ids []string) error {
	nums := make([]int, 0, len(ids))
	for _, id := range ids {
		n, _ := strconv.Atoi(id)
		if n > 0 {
			nums = append(nums, n)
		}
	}
	payload, _ := json.Marshal(map[string]any{"webhookIds": nums})
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/webhook/refresh", url.PathEscape(cloudID))
	_, err := a.put(u, accessToken, payload)
	return err
}

func (a liveJiraCloudAPI) DeleteWebhooks(accessToken, cloudID string, ids []string) error {
	nums := make([]int, 0, len(ids))
	for _, id := range ids {
		n, _ := strconv.Atoi(id)
		if n > 0 {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"webhookIds": nums})
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/webhook", url.PathEscape(cloudID))
	_, err := a.delete(u, accessToken, payload)
	return err
}

func (a liveJiraCloudAPI) GetIssueTypes(accessToken, cloudID, projectID string) ([]jiraIssueType, error) {
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/createmeta/%s/issuetypes", url.PathEscape(cloudID), url.PathEscape(projectID))
	body, err := a.get(u, accessToken)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Values []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"values"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("jira issue types response was invalid")
	}
	out := make([]jiraIssueType, 0, len(parsed.Values))
	for _, v := range parsed.Values {
		out = append(out, jiraIssueType{ID: v.ID, Name: v.Name})
	}
	return out, nil
}

func (a liveJiraCloudAPI) GetCreateMeta(accessToken, cloudID, projectID, issueTypeID string) ([]jiraFieldMeta, error) {
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/issue/createmeta/%s/issuetypes/%s", url.PathEscape(cloudID), url.PathEscape(projectID), url.PathEscape(issueTypeID))
	body, err := a.get(u, accessToken)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Values []struct {
			FieldID  string `json:"fieldId"`
			Name     string `json:"name"`
			Required bool   `json:"required"`
			Schema   struct {
				Type string `json:"type"`
			} `json:"schema"`
		} `json:"values"`
		Fields []struct {
			FieldID  string `json:"fieldId"`
			Name     string `json:"name"`
			Required bool   `json:"required"`
			Schema   struct {
				Type string `json:"type"`
			} `json:"schema"`
		} `json:"fields"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("jira create metadata was invalid")
	}
	src := parsed.Values
	if len(src) == 0 {
		src = parsed.Fields
	}
	out := make([]jiraFieldMeta, 0, len(src))
	for _, f := range src {
		id := f.FieldID
		if id == "" {
			continue
		}
		out = append(out, jiraFieldMeta{ID: id, Name: f.Name, Required: f.Required, Schema: f.Schema.Type})
	}
	return out, nil
}

func (a liveJiraCloudAPI) RefreshToken(refreshToken string) (jiraTokenSet, error) {
	payload, _ := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     jiraOAuthClientID(),
		"client_secret": jiraOAuthClientSecret(),
		"refresh_token": refreshToken,
	})
	req, err := http.NewRequest(http.MethodPost, "https://auth.atlassian.com/oauth/token", bytes.NewReader(payload))
	if err != nil {
		return jiraTokenSet{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return jiraTokenSet{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return jiraTokenSet{}, jiraAPIError{Status: resp.StatusCode, Message: "Jira reauthorization is required"}
	}
	return parseJiraTokenResponse(body)
}

func (a liveJiraCloudAPI) GetMyself(accessToken, cloudID string) (jiraMyself, error) {
	if strings.TrimSpace(cloudID) == "" {
		return jiraMyself{}, fmt.Errorf("jira site is required")
	}
	u := fmt.Sprintf("https://api.atlassian.com/ex/jira/%s/rest/api/3/myself", url.PathEscape(cloudID))
	body, err := a.get(u, accessToken)
	if err != nil {
		return jiraMyself{}, err
	}
	var parsed struct {
		AccountID string `json:"accountId"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || strings.TrimSpace(parsed.AccountID) == "" {
		return jiraMyself{}, fmt.Errorf("jira account could not be identified")
	}
	return jiraMyself{AccountID: parsed.AccountID}, nil
}

func (a liveJiraCloudAPI) get(rawURL, accessToken string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	return a.do(req)
}

func (a liveJiraCloudAPI) post(rawURL, accessToken string, payload []byte) ([]byte, error) {
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	return a.do(req)
}

func (a liveJiraCloudAPI) put(rawURL, accessToken string, payload []byte) ([]byte, error) {
	req, err := http.NewRequest(http.MethodPut, rawURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	return a.do(req)
}

func (a liveJiraCloudAPI) delete(rawURL, accessToken string, payload []byte) ([]byte, error) {
	req, err := http.NewRequest(http.MethodDelete, rawURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	return a.do(req)
}

func (a liveJiraCloudAPI) do(req *http.Request) ([]byte, error) {
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, jiraAPIError{Status: 0, Message: "Jira could not be reached", Temporary: true}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, jiraAPIError{Status: resp.StatusCode, Message: "Jira rate limit reached. Retry shortly.", Temporary: true, RetryAfter: jiraRetryAfter(resp.Header.Get("Retry-After"))}
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, jiraAPIError{Status: resp.StatusCode, Message: "Jira access was revoked. Reauthorize this connection.", Temporary: false}
	}
	if resp.StatusCode == http.StatusForbidden {
		return nil, jiraAPIError{Status: resp.StatusCode, Message: "The connection owner cannot access this Jira work.", Temporary: false}
	}
	if resp.StatusCode >= 500 {
		return nil, jiraAPIError{Status: resp.StatusCode, Message: "Jira is temporarily unavailable.", Temporary: true}
	}
	if resp.StatusCode >= 400 {
		return nil, jiraAPIError{Status: resp.StatusCode, Message: jiraSafeAPIMessage(body), Temporary: false}
	}
	return body, nil
}

type jiraAPIError struct {
	Status     int
	Message    string
	Temporary  bool
	RetryAfter time.Duration
}

func jiraRetryAfter(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	if when, err := http.ParseTime(raw); err == nil {
		wait := time.Until(when)
		if wait > 0 {
			return wait
		}
	}
	return 0
}

func (e jiraAPIError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("jira request failed (%d)", e.Status)
}

func jiraIsTemporary(err error) bool {
	if err == nil {
		return false
	}
	api, ok := err.(jiraAPIError)
	return ok && api.Temporary
}

func jiraNeedsReauth(err error) bool {
	api, ok := err.(jiraAPIError)
	return ok && api.Status == http.StatusUnauthorized
}

func jiraSafeAPIMessage(body []byte) string {
	var parsed struct {
		ErrorMessages []string          `json:"errorMessages"`
		Errors        map[string]string `json:"errors"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if len(parsed.ErrorMessages) > 0 {
			return parsed.ErrorMessages[0]
		}
		for field, msg := range parsed.Errors {
			return field + ": " + msg
		}
	}
	return "Jira rejected the request."
}

func parseJiraTokenResponse(body []byte) (jiraTokenSet, error) {
	var parsed struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || parsed.AccessToken == "" {
		return jiraTokenSet{}, fmt.Errorf("jira token response was invalid")
	}
	expiry := time.Now().Add(time.Duration(parsed.ExpiresIn) * time.Second)
	if parsed.ExpiresIn <= 0 {
		expiry = time.Now().Add(50 * time.Minute)
	}
	return jiraTokenSet{Access: parsed.AccessToken, Refresh: parsed.RefreshToken, Type: parsed.TokenType, Expiry: expiry}, nil
}

func parseJiraRemoteIssue(body []byte, cloudID string) (*jiraRemoteIssue, error) {
	var raw struct {
		ID     string `json:"id"`
		Key    string `json:"key"`
		Self   string `json:"self"`
		Fields struct {
			Summary string `json:"summary"`
			Status  struct {
				Name     string `json:"name"`
				Category struct {
					Key string `json:"key"`
				} `json:"statusCategory"`
			} `json:"status"`
			Priority struct {
				Name string `json:"name"`
			} `json:"priority"`
			Assignee *struct {
				AccountID   string `json:"accountId"`
				DisplayName string `json:"displayName"`
			} `json:"assignee"`
			IssueType struct {
				Name string `json:"name"`
			} `json:"issuetype"`
			Project struct {
				ID  string `json:"id"`
				Key string `json:"key"`
			} `json:"project"`
			Security *struct {
				Name string `json:"name"`
			} `json:"security"`
			Updated string `json:"updated"`
		} `json:"fields"`
	}
	if err := json.Unmarshal(body, &raw); err != nil || raw.ID == "" {
		return nil, fmt.Errorf("jira issue response was invalid")
	}
	issue := &jiraRemoteIssue{
		ID:             raw.ID,
		Key:            raw.Key,
		Summary:        raw.Fields.Summary,
		Status:         raw.Fields.Status.Name,
		StatusCategory: raw.Fields.Status.Category.Key,
		Priority:       raw.Fields.Priority.Name,
		IssueType:      raw.Fields.IssueType.Name,
		ProjectID:      raw.Fields.Project.ID,
		ProjectKey:     raw.Fields.Project.Key,
	}
	if raw.Fields.Assignee != nil {
		issue.AssigneeAccountID = raw.Fields.Assignee.AccountID
		issue.AssigneeDisplay = raw.Fields.Assignee.DisplayName
	}
	if raw.Fields.Security != nil {
		issue.SecurityLevel = raw.Fields.Security.Name
	}
	issue.Updated = jiraParseRemoteTime(raw.Fields.Updated)
	issue.BrowseURL = jiraBrowseURL(cloudID, raw.Key)
	return issue, nil
}

func jiraParseRemoteTime(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000-0700", "2006-01-02T15:04:05.000+0000"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func jiraBrowseURL(cloudID, key string) string {
	cloudID = strings.TrimSpace(cloudID)
	key = strings.TrimSpace(key)
	if cloudID == "" || key == "" {
		return ""
	}
	conn, err := findJiraConnectionByCloud(cloudID)
	if err == nil && strings.TrimSpace(conn.SiteURL) != "" {
		return strings.TrimRight(conn.SiteURL, "/") + "/browse/" + key
	}
	return ""
}

func jiraADFFromText(text string) map[string]any {
	text = strings.TrimSpace(text)
	if text == "" {
		text = "Created from OpsTrellis."
	}
	return map[string]any{
		"type":    "doc",
		"version": 1,
		"content": []any{
			map[string]any{
				"type": "paragraph",
				"content": []any{
					map[string]any{"type": "text", "text": text},
				},
			},
		},
	}
}
