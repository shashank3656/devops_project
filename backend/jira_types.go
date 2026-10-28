package main

import (
	"strings"
	"time"
)

func jiraIssueIdentity(cloudID, issueID string) string {
	return strings.TrimSpace(cloudID) + ":" + strings.TrimSpace(issueID)
}

const (
	jiraProviderCloud = "jira_cloud"

	jiraStateDraft       = "draft"
	jiraStateAuthorizing = "authorizing"
	jiraStateConnected   = "connected"
	jiraStatePaused      = "paused"
	jiraStateFailed      = "failed"

	jiraHealthConnected     = "connected"
	jiraHealthSynced        = "synced"
	jiraHealthSyncing       = "syncing"
	jiraHealthQueued        = "queued"
	jiraHealthPartial       = "partial"
	jiraHealthDelayed       = "delayed"
	jiraHealthConfigNeeded  = "configuration_needed"
	jiraHealthFailed        = "failed"
	jiraHealthReauth        = "reauthorization_required"
	jiraHealthPaused        = "paused"
	jiraHealthUnknown       = "unknown"
	jiraHealthNotConfigured = "not_configured"

	jiraOpQueued    = "queued"
	jiraOpRunning   = "running"
	jiraOpSucceeded = "succeeded"
	jiraOpRetrying  = "retrying"
	jiraOpFailed    = "failed"
	jiraOpReconcile = "reconcile"

	jiraRelImplements = "implements"
	jiraRelRemediates = "remediates"
	jiraRelCausedBy   = "caused_by"
	jiraRelFollowUp   = "follow_up"
	jiraRelRelated    = "related"

	jiraSourcePR       = "pull_request"
	jiraSourceChange   = "change"
	jiraSourceIncident = "incident"
	jiraSourceProblem  = "problem"
	jiraSourceFinding  = "security_finding"
	jiraSourceCost     = "cost_recommendation"
	jiraSourceService  = "service"
)

type jiraConnection struct {
	ID            int        `json:"id"`
	TenantKey     string     `json:"tenant_key,omitempty"`
	Name          string     `json:"name"`
	Provider      string     `json:"provider"`
	CloudID       string     `json:"cloud_id,omitempty"`
	SiteURL       string     `json:"site_url,omitempty"`
	SiteName      string     `json:"site_name,omitempty"`
	OwnerUserID   int        `json:"owner_user_id,omitempty"`
	OwnerUsername string     `json:"owner_username,omitempty"`
	Scopes        string     `json:"scopes,omitempty"`
	State         string     `json:"state"`
	AuthHealth    string     `json:"auth_health"`
	SyncHealth    string     `json:"sync_health"`
	Enabled       bool       `json:"enabled"`
	SpaceCount    int        `json:"connected_space_count"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	OAuthReady    bool       `json:"oauth_ready"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type jiraSpace struct {
	ID                   int        `json:"id"`
	ConnectionID         int        `json:"connection_id"`
	ConnectionName       string     `json:"connection_name,omitempty"`
	SiteName             string     `json:"site_name,omitempty"`
	CloudID              string     `json:"cloud_id,omitempty"`
	JiraProjectID        string     `json:"jira_project_id"`
	JiraProjectKey       string     `json:"jira_project_key"`
	Name                 string     `json:"name"`
	Style                string     `json:"style,omitempty"`
	Enabled              bool       `json:"enabled"`
	SyncHealth           string     `json:"sync_health"`
	LastSuccessAt        *time.Time `json:"last_success_at,omitempty"`
	LastError            string     `json:"last_error,omitempty"`
	MappedProjects       []string   `json:"mapped_portal_projects,omitempty"`
	PermittedTeams       []string   `json:"permitted_teams,omitempty"`
	CanView              bool       `json:"can_view,omitempty"`
	CanLink              bool       `json:"can_link,omitempty"`
	CanCreate            bool       `json:"can_create,omitempty"`
	CanAdminister        bool       `json:"can_administer,omitempty"`
	DefaultIssueTypeID   string     `json:"default_issue_type_id,omitempty"`
	DefaultIssueTypeName string     `json:"default_issue_type_name,omitempty"`
	DefaultRelationship  string     `json:"default_relationship,omitempty"`
	FieldDefaultsJSON    string     `json:"field_defaults_json,omitempty"`
}

type jiraSpaceAccess struct {
	TeamID        int    `json:"team_id"`
	TeamName      string `json:"team_name,omitempty"`
	TeamSlug      string `json:"team_slug,omitempty"`
	CanView       bool   `json:"can_view"`
	CanLink       bool   `json:"can_link"`
	CanCreate     bool   `json:"can_create"`
	CanAdminister bool   `json:"can_administer"`
}

type jiraMapping struct {
	ID                  int    `json:"id"`
	SpaceID             int    `json:"space_id"`
	PortalProjectID     int    `json:"portal_project_id,omitempty"`
	PortalProjectName   string `json:"portal_project_name,omitempty"`
	PortalService       string `json:"portal_service,omitempty"`
	IssueTypeID         string `json:"issue_type_id"`
	IssueTypeName       string `json:"issue_type_name"`
	DefaultRelationship string `json:"default_relationship"`
	FieldDefaultsJSON   string `json:"field_defaults_json,omitempty"`
	Version             int    `json:"version"`
}

type jiraIssueView struct {
	CloudID           string     `json:"cloud_id"`
	IssueID           string     `json:"issue_id"`
	IssueKey          string     `json:"issue_key"`
	Summary           string     `json:"summary"`
	Status            string     `json:"status"`
	StatusCategory    string     `json:"status_category,omitempty"`
	Priority          string     `json:"priority,omitempty"`
	AssigneeAccountID string     `json:"assignee_account_id,omitempty"`
	AssigneeDisplay   string     `json:"assignee,omitempty"`
	IssueType         string     `json:"issue_type,omitempty"`
	Restricted        bool       `json:"restricted,omitempty"`
	BrowseURL         string     `json:"browse_url,omitempty"`
	SiteName          string     `json:"site_name,omitempty"`
	SpaceName         string     `json:"space_name,omitempty"`
	SpaceKey          string     `json:"space_key,omitempty"`
	LastSuccessAt     *time.Time `json:"last_success_at,omitempty"`
	RemoteUpdatedAt   time.Time  `json:"-"`
	Freshness         string     `json:"freshness"`
	Stale             bool       `json:"stale"`
}

type jiraIssueLinkView struct {
	ID           int           `json:"id"`
	SourceType   string        `json:"source_type"`
	SourceID     int           `json:"source_id,omitempty"`
	SourceKey    string        `json:"source_key,omitempty"`
	Relationship string        `json:"relationship"`
	Issue        jiraIssueView `json:"issue"`
	CanUnlink    bool          `json:"can_unlink"`
}

type jiraOperationView struct {
	ID          int        `json:"id"`
	OperationID string     `json:"operation_id"`
	Kind        string     `json:"kind"`
	SourceType  string     `json:"source_type,omitempty"`
	SourceID    int        `json:"source_id,omitempty"`
	SourceKey   string     `json:"source_key,omitempty"`
	CloudID     string     `json:"cloud_id,omitempty"`
	IssueID     string     `json:"issue_id,omitempty"`
	IssueKey    string     `json:"issue_key,omitempty"`
	State       string     `json:"state"`
	Attempts    int        `json:"attempts"`
	LastError   string     `json:"last_error,omitempty"`
	Retryable   bool       `json:"retryable"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	NextAttempt *time.Time `json:"next_attempt_at,omitempty"`
}

type jiraAuditView struct {
	ID         int       `json:"id"`
	Action     string    `json:"action"`
	Result     string    `json:"result"`
	Detail     string    `json:"detail,omitempty"`
	SourceType string    `json:"source_type,omitempty"`
	IssueKey   string    `json:"issue_key,omitempty"`
	Actor      string    `json:"actor,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type jiraRemoteSite struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	URL       string   `json:"url"`
	Scopes    []string `json:"scopes,omitempty"`
	AvatarURL string   `json:"avatarUrl,omitempty"`
}

type jiraRemoteSpace struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Name  string `json:"name"`
	Style string `json:"style,omitempty"`
}

type jiraRemoteIssue struct {
	ID                string
	Key               string
	Summary           string
	Status            string
	StatusCategory    string
	Priority          string
	AssigneeAccountID string
	AssigneeDisplay   string
	IssueType         string
	ProjectID         string
	ProjectKey        string
	SecurityLevel     string
	BrowseURL         string
	Updated           time.Time
}

type jiraFieldMeta struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Required bool   `json:"required"`
	Schema   string `json:"schema,omitempty"`
}

type jiraIssueType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type jiraCreatePreview struct {
	SiteName     string          `json:"site_name"`
	CloudID      string          `json:"cloud_id"`
	SpaceName    string          `json:"space_name"`
	SpaceKey     string          `json:"space_key"`
	IssueType    string          `json:"issue_type"`
	Relationship string          `json:"relationship"`
	Fields       []jiraFieldMeta `json:"fields"`
	Note         string          `json:"note"`
}

type jiraSuggestion struct {
	Key          string        `json:"key"`
	Reason       string        `json:"reason"`
	Validated    bool          `json:"validated"`
	SpaceID      int           `json:"space_id,omitempty"`
	Relationship string        `json:"relationship"`
	Issue        jiraIssueView `json:"issue"`
	Note         string        `json:"note"`
}

type jiraTransition struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	To   string `json:"to,omitempty"`
}

type jiraBulkResult struct {
	Index       int    `json:"index"`
	OK          bool   `json:"ok"`
	Error       string `json:"error,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	IssueKey    string `json:"issue_key,omitempty"`
}

type jiraWebhookStatus struct {
	RenewalStatus string     `json:"renewal_status"`
	Expiration    *time.Time `json:"expiration,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	ProviderIDs   string     `json:"provider_ids,omitempty"`
}

type jiraRemediationRule struct {
	ID            int    `json:"id"`
	SpaceID       int    `json:"space_id"`
	SpaceName     string `json:"space_name,omitempty"`
	SpaceKey      string `json:"space_key,omitempty"`
	SiteName      string `json:"site_name,omitempty"`
	SourceType    string `json:"source_type"`
	MatchText     string `json:"match_text,omitempty"`
	IssueTypeID   string `json:"issue_type_id"`
	IssueTypeName string `json:"issue_type_name"`
	Relationship  string `json:"relationship"`
	Enabled       bool   `json:"enabled"`
	AutoCreate    bool   `json:"auto_create"`
	DailyLimit    int    `json:"daily_limit"`
}
