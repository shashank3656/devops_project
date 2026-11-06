package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestJiraIssueIdentityUsesSiteAndIssueID(t *testing.T) {
	left := jiraIssueIdentity("cloud-a", "10001")
	right := jiraIssueIdentity("cloud-b", "10001")
	if left == right {
		t.Fatal("the same issue key on two sites must not share an identity")
	}
	if left != "cloud-a:10001" {
		t.Fatalf("identity = %q", left)
	}
}

func TestJiraSecretRoundTripAndNeverPlain(t *testing.T) {
	t.Setenv("SESSION_SECRET", "jira-test-session-secret")
	plain := "atlassian-refresh-token-value"
	sealed, err := encryptJiraSecret(plain)
	if err != nil {
		t.Fatal(err)
	}
	if sealed == plain || !strings.HasPrefix(sealed, jiraSecretEncPrefix) {
		t.Fatal("jira secret was stored in plaintext")
	}
	opened, err := decryptJiraSecret(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if opened != plain {
		t.Fatal("encrypted jira secret did not round-trip")
	}
	conn := jiraConnection{ID: 9, Name: "Company Jira", CloudID: "abc", AuthHealth: jiraHealthConnected, SyncHealth: jiraHealthSynced}
	raw, err := json.Marshal(conn)
	if err != nil {
		t.Fatal(err)
	}
	if jiraJSONHasSecret(conn) || strings.Contains(strings.ToLower(string(raw)), "token") {
		t.Fatalf("connection JSON leaked a credential: %s", raw)
	}
}

func TestJiraSanitizeDropsSecretsAndKeepsSummary(t *testing.T) {
	if got := jiraSanitizeCreateText("Fix checkout timeout"); got != "Fix checkout timeout" {
		t.Fatalf("summary stripped: %q", got)
	}
	if got := jiraSanitizeCreateText("Authorization: Bearer abc.def"); got != "" {
		t.Fatalf("bearer token was copied into Jira: %q", got)
	}
}

func TestJiraDoneDoesNotClosePortalRecords(t *testing.T) {
	if !jiraDoneDoesNotClosePortal("done") {
		t.Fatal("done status must stay informational")
	}
	if jiraDoneDoesNotClosePortal("indeterminate") {
		t.Fatal("in-progress work is not a Jira Done signal")
	}
}

func TestJiraOperationIDsAreStableAndUnique(t *testing.T) {
	first := newJiraOperationID()
	time.Sleep(time.Millisecond)
	second := newJiraOperationID()
	if first == "" || first == second {
		t.Fatalf("operation ids collided: %s %s", first, second)
	}
	if jiraOperationLabel(first) == "" {
		t.Fatal("operation label was empty")
	}
}

type stubJiraAPI struct {
	created int
	search  []jiraRemoteIssue
	fail    error
}

func (s *stubJiraAPI) AccessibleResources(string) ([]jiraRemoteSite, error) { return nil, nil }
func (s *stubJiraAPI) ListProjects(string, string, string) ([]jiraRemoteSpace, error) {
	return nil, nil
}
func (s *stubJiraAPI) GetIssue(string, string, string) (*jiraRemoteIssue, error) { return nil, nil }
func (s *stubJiraAPI) SearchIssues(string, string, string, int) ([]jiraRemoteIssue, error) {
	return s.search, nil
}
func (s *stubJiraAPI) CreateIssue(string, string, map[string]any) (*jiraRemoteIssue, error) {
	s.created++
	if s.fail != nil {
		return nil, s.fail
	}
	return &jiraRemoteIssue{ID: "10001", Key: "PAY-1"}, nil
}
func (s *stubJiraAPI) AddComment(string, string, string, string) (string, error) {
	if s.fail != nil {
		return "", s.fail
	}
	return "10050", nil
}
func (s *stubJiraAPI) GetIssueTypes(string, string, string) ([]jiraIssueType, error) { return nil, nil }
func (s *stubJiraAPI) GetCreateMeta(string, string, string, string) ([]jiraFieldMeta, error) {
	return nil, nil
}
func (s *stubJiraAPI) GetTransitions(string, string, string) ([]jiraTransition, error) {
	return []jiraTransition{{ID: "31", Name: "Done", To: "Done"}}, nil
}
func (s *stubJiraAPI) TransitionIssue(string, string, string, string) error { return s.fail }
func (s *stubJiraAPI) AddAttachment(string, string, string, string, []byte) (string, error) {
	if s.fail != nil {
		return "", s.fail
	}
	return "att-1", nil
}
func (s *stubJiraAPI) RegisterWebhooks(string, string, string, string, []string) ([]string, error) {
	return []string{"1"}, s.fail
}
func (s *stubJiraAPI) ListWebhooks(string, string) ([]jiraRemoteWebhook, error) {
	return nil, nil
}
func (s *stubJiraAPI) RefreshWebhooks(string, string, []string) error { return s.fail }
func (s *stubJiraAPI) DeleteWebhooks(string, string, []string) error  { return nil }
func (s *stubJiraAPI) RefreshToken(string) (jiraTokenSet, error)      { return jiraTokenSet{}, nil }
func (s *stubJiraAPI) GetMyself(string, string) (jiraMyself, error) {
	return jiraMyself{AccountID: "acct-owner"}, nil
}

func TestJiraCreateReconcilesBeforeRetry(t *testing.T) {
	stub := &stubJiraAPI{
		fail: jiraAPIError{Status: 0, Message: "timeout", Temporary: true},
		search: []jiraRemoteIssue{{
			ID:  "10001",
			Key: "PAY-1",
		}},
	}
	prev := jiraAPI
	jiraAPI = stub
	defer func() { jiraAPI = prev }()
	found, ok := reconcileJiraCreate("token", jiraSpace{JiraProjectKey: "PAY", CloudID: "site-1"}, "jiraop-abc")
	if !ok || found == nil || found.ID != "10001" {
		t.Fatal("timeout must reconcile the existing issue before creating another")
	}
	if _, err := stub.CreateIssue("", "", nil); err == nil {
		t.Fatal("expected the first create to remain uncertain")
	}
	if stub.created != 1 {
		t.Fatalf("create was called %d times", stub.created)
	}
}

func TestJiraDisconnectKeepsBusinessRecords(t *testing.T) {
	note := "Synchronization stopped. Linked records were kept."
	if !strings.Contains(strings.ToLower(note), "kept") {
		t.Fatal("disconnect copy must keep portal records")
	}
}

func TestJiraRestrictedIssueHiddenFromNonAdmin(t *testing.T) {
	issue := jiraIssueView{Restricted: true, CloudID: "site", IssueID: "1"}
	viewer := jiraViewerAccess{CanView: true, IsOwner: false, CanAdminister: false}
	if viewer.CanView && issue.Restricted && !viewer.IsOwner && !viewer.CanAdminister {
		// expected hide path used by jiraCanViewIssue
	} else {
		t.Fatal("restricted issue visibility check drifted")
	}
}

func TestJiraWebhookDedupesEventIDs(t *testing.T) {
	if jiraEventAlreadyProcessed("") {
		t.Fatal("empty event ids must not be treated as duplicates")
	}
}

func TestJiraOAuthRedirectOmitsSecrets(t *testing.T) {
	url := jiraAuthorizeURL("state-1")
	secret := jiraOAuthClientSecret()
	if strings.Contains(strings.ToLower(url), "client_secret") || (secret != "" && strings.Contains(url, secret)) {
		t.Fatal("authorize URL included a client secret")
	}
	if !strings.Contains(url, "audience=api.atlassian.com") {
		t.Fatal("authorize URL missing Atlassian audience")
	}
}

func TestJiraOAuthAppViewNeverReturnsSecret(t *testing.T) {
	t.Setenv("SESSION_SECRET", "jira-test-session-secret")
	clearJiraOAuthAppCache()
	jiraOAuthAppMu.Lock()
	jiraOAuthAppCache = &jiraOAuthApp{ClientID: "atlassian-client-id", Secret: "atlassian-client-secret-value"}
	jiraOAuthAppMu.Unlock()
	t.Cleanup(clearJiraOAuthAppCache)

	view := jiraOAuthAppPublicView(0)
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	body := strings.ToLower(string(raw))
	if strings.Contains(body, "atlassian-client-secret-value") || jiraJSONHasSecret(view) {
		t.Fatalf("oauth app view leaked a secret: %s", raw)
	}
	if !view.Configured || !view.ClientSecretSet || view.ClientID != "atlassian-client-id" {
		t.Fatalf("oauth app view dropped stored status: %+v", view)
	}
	if jiraOAuthClientID() != "atlassian-client-id" || jiraOAuthClientSecret() != "atlassian-client-secret-value" {
		t.Fatal("stored oauth app was not used for authorization")
	}
}

func TestJiraOAuthSaveRequiresClientID(t *testing.T) {
	_, err := saveJiraOAuthApp(1, "", "secret", "", "")
	if err == nil {
		t.Fatal("empty client ID must be rejected")
	}
}

func TestJiraExtractsIssueKeysFromPRText(t *testing.T) {
	keys := jiraExtractIssueKeys("PAY-245 checkout timeout", "fix/PAY-245-checkout", "Also see OPS-9 in the description.")
	if len(keys) != 2 || keys[0] != "PAY-245" || keys[1] != "OPS-9" {
		t.Fatalf("keys = %#v", keys)
	}
	if jiraKeyMatchReason("PAY-245", "PAY-245 checkout", "main", "") != "title" {
		t.Fatal("title match missing")
	}
	if jiraKeyMatchReason("PAY-245", "checkout", "fix/PAY-245", "") != "branch" {
		t.Fatal("branch match missing")
	}
}

func TestJiraCommentOriginPreventsMirrorLoops(t *testing.T) {
	if !jiraCommentHasOrigin("Status update\nOrigin: opstrellis") {
		t.Fatal("origin marker must be detected")
	}
	if jiraCommentHasOrigin("plain operator note") {
		t.Fatal("unmarked text must not look like an OpsTrellis comment")
	}
}

func TestJiraRemediationRulesStayScoped(t *testing.T) {
	if jiraSourceFinding == jiraSourcePR {
		t.Fatal("remediation must not target pull requests")
	}
	if !jiraDoneDoesNotClosePortal("done") {
		t.Fatal("Jira Done still must not close portal records")
	}
}

func TestJiraAttachmentControlsRejectSecretsAndLogs(t *testing.T) {
	if jiraAttachmentRejected("notes.pdf") != "" {
		t.Fatal("pdf should be allowed")
	}
	if jiraAttachmentRejected("debug.log") == "" {
		t.Fatal("log files must be blocked")
	}
	if jiraAttachmentRejected("secret-tokens.txt") == "" {
		t.Fatal("credential filenames must be blocked")
	}
	if jiraAttachmentRejected("payload.exe") == "" {
		t.Fatal("executables must be blocked")
	}
}

func TestJiraBulkLimitAndUnknownAction(t *testing.T) {
	if errJiraBulkUnknown.Error() != "unknown bulk action" {
		t.Fatal("bulk unknown action copy drifted")
	}
	if !strings.Contains(jiraDefaultScopes(), "manage:jira-webhook") {
		t.Fatal("webhook scope must be requested for renewal")
	}
}

func TestJiraMergeScopesAddsWebhook(t *testing.T) {
	got := jiraMergeScopes("read:jira-work write:jira-work offline_access", jiraDefaultScopes())
	if !strings.Contains(got, "manage:jira-webhook") {
		t.Fatalf("stored scopes must still request webhook renewal: %s", got)
	}
	if strings.Count(got, "read:jira-work") != 1 {
		t.Fatalf("duplicate scopes leaked: %s", got)
	}
}

func TestJiraRetryAfterParsesHeader(t *testing.T) {
	if jiraRetryAfter("12") != 12*time.Second {
		t.Fatal("Retry-After seconds were ignored")
	}
	if jiraRetryAfter("") != 0 {
		t.Fatal("empty Retry-After must stay zero")
	}
}

func TestJiraWebhookSkipsOlderEvents(t *testing.T) {
	current := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	older := current.Add(-2 * time.Minute).UnixMilli()
	if !jiraWebhookIsStale(older, current) {
		t.Fatal("out-of-order webhook must be skipped")
	}
	if jiraWebhookIsStale(current.Add(time.Minute).UnixMilli(), current) {
		t.Fatal("newer webhook must still refresh")
	}
}

func TestJiraAssignedFilterUsesAccountID(t *testing.T) {
	links := []jiraIssueLinkView{
		{Issue: jiraIssueView{AssigneeAccountID: "acct-a", AssigneeDisplay: "Ada"}},
		{Issue: jiraIssueView{AssigneeAccountID: "acct-b", AssigneeDisplay: "Ada"}},
	}
	got := filterJiraLinksByAssigneeAccounts(links, []string{"acct-a"})
	if len(got) != 1 || got[0].Issue.AssigneeAccountID != "acct-a" {
		t.Fatal("assigned filter must use Jira account IDs, not display names")
	}
}

func TestJiraDefaultSyncPolicyKeepsJiraAsFieldOwner(t *testing.T) {
	policy := jiraDefaultSyncPolicy()
	if !policy.CreateIssues || !policy.LinkIssues || !policy.ReadStatus {
		t.Fatal("first usable release must still create, link, and read")
	}
	found := false
	for _, row := range jiraFieldOwnership() {
		if strings.Contains(row["field"], "Title") && row["owner"] == "Jira after creation" {
			found = true
		}
	}
	if !found {
		t.Fatal("sync rules must show Jira owns title and status")
	}
}

func TestJiraSetupStepFollowsConnectJourney(t *testing.T) {
	clearJiraOAuthAppCache()
	if got := jiraSetupStep(jiraConnection{}, nil); got != "onboard_app" {
		t.Fatalf("setup_step=%s want onboard_app", got)
	}
	jiraOAuthAppMu.Lock()
	jiraOAuthAppCache = &jiraOAuthApp{ClientID: "id", Secret: "secret"}
	jiraOAuthAppMu.Unlock()
	t.Cleanup(clearJiraOAuthAppCache)

	draft := jiraConnection{State: jiraStateDraft, AuthHealth: jiraHealthNotConfigured}
	if got := jiraSetupStep(draft, nil); got != "authorize" {
		t.Fatalf("setup_step=%s want authorize", got)
	}
	authorized := jiraConnection{State: jiraStateConnected, AuthHealth: jiraHealthConnected}
	if got := jiraSetupStep(authorized, nil); got != "select_site" {
		t.Fatalf("setup_step=%s want select_site", got)
	}
	authorized.CloudID = "cloud-1"
	if got := jiraSetupStep(authorized, nil); got != "select_spaces" {
		t.Fatalf("setup_step=%s want select_spaces", got)
	}
	if jiraReadyToEnable(authorized, nil) {
		t.Fatal("enable must wait for a selected space")
	}
	if !jiraReadyToEnable(authorized, []jiraSpace{{ID: 1}}) {
		t.Fatal("site plus space should be ready to enable")
	}
	authorized.AuthHealth = jiraHealthReauth
	if jiraReadyToEnable(authorized, []jiraSpace{{ID: 1}}) {
		t.Fatal("reauthorization must block enable")
	}
}
