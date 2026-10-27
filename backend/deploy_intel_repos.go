package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/go-github/v61/github"
)

var errGitHubRepoNotFound = errors.New("Repository not found")

var lookupGitHubRepository = lookupGitHubRepositoryLive

type deployIntelRepo struct {
	ID          int       `json:"id"`
	Owner       string    `json:"owner"`
	Name        string    `json:"name"`
	BaseBranch  string    `json:"base_branch"`
	Enabled     bool      `json:"enabled"`
	Notes       string    `json:"notes,omitempty"`
	OnboardedAt time.Time `json:"onboarded_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type deployIntelLastChange struct {
	ID               int                 `json:"id"`
	ChangeNumber     string              `json:"change_number"`
	SHA              string              `json:"sha"`
	PreviousSHA      string              `json:"previous_sha,omitempty"`
	ProvenanceSigned bool                `json:"provenance_signed"`
	SbomURL          string              `json:"sbom_url,omitempty"`
	AttestationURL   string              `json:"attestation_url,omitempty"`
	PolicyStatus     string              `json:"policy_status,omitempty"`
	Status           string              `json:"status,omitempty"`
	ImageDigest      string              `json:"image_digest,omitempty"`
	Drift            *liveChangeDrift    `json:"drift,omitempty"`
	Rollback         *changeRollbackPlan `json:"rollback,omitempty"`
}

type deployIntelRepoSummary struct {
	deployIntelRepo
	Ready          bool                   `json:"ready"`
	MergeCount     int                    `json:"merge_count"`
	HighRisk30d    int                    `json:"high_risk_30d"`
	OpenPRCount    int                    `json:"open_pr_count"`
	LastMergedAt   *time.Time             `json:"last_merged_at,omitempty"`
	WebhookPath    string                 `json:"webhook_path"`
	SetupSummary   string                 `json:"setup_summary"`
	GitHubAccess   string                 `json:"github_access"`
	MergeTracking  string                 `json:"merge_tracking"`
	LastSyncAt     *time.Time             `json:"last_sync_at,omitempty"`
	NeedsAttention bool                   `json:"needs_attention"`
	LastChange     *deployIntelLastChange `json:"last_change,omitempty"`
}

func ensureDefaultDeployIntelRepo() {
	if DB == nil {
		return
	}
	owner := strings.TrimSpace(GitHubOwner)
	repo := strings.TrimSpace(GitHubRepo)
	if owner == "" || repo == "" || strings.Contains(owner, "YOUR_GITHUB") {
		return
	}
	base := strings.TrimSpace(BaseBranch)
	if base == "" {
		base = "main"
	}
	_, _ = DB.Exec(`
		INSERT INTO deploy_intel_repos (repo_owner, repo_name, base_branch, enabled, notes)
		VALUES ($1, $2, $3, TRUE, 'Auto-registered from GITHUB_OWNER/GITHUB_REPO')
		ON CONFLICT (repo_owner, repo_name) DO NOTHING
	`, owner, repo, base)
}

func normalizeRepoIdentity(owner, name string) (string, string) {
	owner = strings.TrimSpace(owner)
	name = strings.TrimSpace(name)
	if strings.Contains(name, "/") {
		parts := strings.SplitN(name, "/", 2)
		if owner == "" {
			owner = parts[0]
		}
		name = parts[1]
	}
	return owner, name
}

func lookupGitHubRepositoryLive(owner, name string) (canonicalOwner, canonicalName string, exists bool, err error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return "", "", false, fmt.Errorf("owner and repository name are required")
	}
	if strings.TrimSpace(GitHubToken) == "" {
		return "", "", false, fmt.Errorf("The repository could not be verified on GitHub.")
	}
	client, clientErr := newGitHubClient()
	if clientErr != nil || client == nil {
		return "", "", false, fmt.Errorf("The repository could not be verified on GitHub.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	repo, resp, getErr := client.Repositories.Get(ctx, owner, name)
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	if status == 0 {
		status = githubStatusCode(getErr)
	}
	if status == http.StatusNotFound || isGitHubNotFound(getErr) {
		return owner, name, false, nil
	}
	if getErr != nil {
		return "", "", false, fmt.Errorf("The repository could not be verified on GitHub.")
	}
	if repo != nil {
		if login := strings.TrimSpace(repo.GetOwner().GetLogin()); login != "" {
			owner = login
		}
		if repoName := strings.TrimSpace(repo.GetName()); repoName != "" {
			name = repoName
		}
	}
	return owner, name, true, nil
}

func verifyGitHubRepositoryForOnboard(owner, name string) (string, string, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return "", "", fmt.Errorf("owner and repository name are required")
	}
	canonicalOwner, canonicalName, exists, err := lookupGitHubRepository(owner, name)
	if err != nil {
		return "", "", err
	}
	if !exists {
		return "", "", errGitHubRepoNotFound
	}
	if strings.TrimSpace(canonicalOwner) != "" {
		owner = canonicalOwner
	}
	if strings.TrimSpace(canonicalName) != "" {
		name = canonicalName
	}
	return owner, name, nil
}

func getDeployIntelRepo(owner, name string) (*deployIntelRepo, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if DB == nil || owner == "" || name == "" {
		return nil, nil
	}
	var item deployIntelRepo
	err := DB.QueryRow(`
		SELECT id, repo_owner, repo_name, base_branch, enabled, COALESCE(notes,''), onboarded_at, updated_at
		  FROM deploy_intel_repos
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2)
	`, owner, name).Scan(&item.ID, &item.Owner, &item.Name, &item.BaseBranch, &item.Enabled, &item.Notes, &item.OnboardedAt, &item.UpdatedAt)
	if err != nil {
		return nil, nil
	}
	return &item, nil
}

func listDeployIntelRepos() ([]deployIntelRepo, error) {
	if DB == nil {
		return []deployIntelRepo{}, nil
	}
	rows, err := DB.Query(`
		SELECT id, repo_owner, repo_name, base_branch, enabled, COALESCE(notes,''), onboarded_at, updated_at
		  FROM deploy_intel_repos
		 ORDER BY repo_owner, repo_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]deployIntelRepo, 0)
	for rows.Next() {
		var item deployIntelRepo
		if err := rows.Scan(&item.ID, &item.Owner, &item.Name, &item.BaseBranch, &item.Enabled, &item.Notes, &item.OnboardedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

func updateDeployIntelRepoCatalog(currentOwner, currentName, nextOwner, nextName, baseBranch string) (*deployIntelRepo, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	currentOwner, currentName = normalizeRepoIdentity(currentOwner, currentName)
	if currentOwner == "" || currentName == "" {
		return nil, fmt.Errorf("owner and repository name are required")
	}
	current, _ := getDeployIntelRepo(currentOwner, currentName)
	if current == nil {
		return nil, fmt.Errorf("repository is not onboarded for deploy intelligence")
	}
	if strings.TrimSpace(nextOwner) == "" {
		nextOwner = current.Owner
	}
	if strings.TrimSpace(nextName) == "" {
		nextName = current.Name
	}
	nextOwner, nextName = normalizeRepoIdentity(nextOwner, nextName)
	if nextOwner == "" || nextName == "" {
		return nil, fmt.Errorf("owner and repository name are required")
	}
	identityChanged := !strings.EqualFold(current.Owner, nextOwner) || !strings.EqualFold(current.Name, nextName)
	if identityChanged {
		verifiedOwner, verifiedName, err := verifyGitHubRepositoryForOnboard(nextOwner, nextName)
		if err != nil {
			return nil, err
		}
		nextOwner, nextName = verifiedOwner, verifiedName
	}
	baseBranch = strings.TrimSpace(baseBranch)
	if baseBranch == "" {
		baseBranch = strings.TrimSpace(current.BaseBranch)
	}
	if baseBranch == "" {
		baseBranch = "main"
	}
	_, err := DB.Exec(`
		UPDATE deploy_intel_repos
		   SET repo_owner = $2,
		       repo_name = $3,
		       base_branch = $4,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE id = $1
	`, current.ID, nextOwner, nextName, baseBranch)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate") {
			return nil, fmt.Errorf("that repository is already onboarded")
		}
		return nil, err
	}
	updated, _ := getDeployIntelRepo(nextOwner, nextName)
	if updated == nil {
		return nil, fmt.Errorf("repository is not onboarded for deploy intelligence")
	}
	return updated, nil
}

func disconnectDeployIntelRepo(owner, name string) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return fmt.Errorf("owner and repository name are required")
	}
	result, err := DB.Exec(`
		DELETE FROM deploy_intel_repos
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2)
	`, owner, name)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("repository is not onboarded for deploy intelligence")
	}
	return nil
}

func upsertDeployIntelRepo(owner, name, baseBranch, notes string, enabled bool) (*deployIntelRepo, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return nil, fmt.Errorf("owner and repository name are required")
	}
	baseBranch = strings.TrimSpace(baseBranch)
	if baseBranch == "" {
		baseBranch = "main"
	}
	var item deployIntelRepo
	err := DB.QueryRow(`
		INSERT INTO deploy_intel_repos (repo_owner, repo_name, base_branch, enabled, notes, updated_at)
		VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
		ON CONFLICT (repo_owner, repo_name) DO UPDATE SET
			base_branch = EXCLUDED.base_branch,
			enabled = EXCLUDED.enabled,
			notes = EXCLUDED.notes,
			updated_at = CURRENT_TIMESTAMP
		RETURNING id, repo_owner, repo_name, base_branch, enabled, COALESCE(notes,''), onboarded_at, updated_at
	`, owner, name, baseBranch, enabled, strings.TrimSpace(notes)).Scan(
		&item.ID, &item.Owner, &item.Name, &item.BaseBranch, &item.Enabled, &item.Notes, &item.OnboardedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func deployIntelRepoReady(owner, name string) bool {
	rec, _ := getDeployIntelRepo(owner, name)
	if rec == nil || !rec.Enabled {
		return repoIsOnboardedLegacy(owner, name)
	}
	if GitHubToken == "" {
		return false
	}
	if DB == nil {
		return true
	}
	var count int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM gitops_projects`).Scan(&count)
	return count > 0
}

// deployIntelGitHubAccessAllowed is true when this onboarded repo may call GitHub for live PR data (no GitOps catalog required).
func deployIntelGitHubAccessAllowed(owner, name string) bool {
	owner, name = normalizeRepoIdentity(owner, name)
	if GitHubToken == "" {
		return false
	}
	rec, _ := getDeployIntelRepo(owner, name)
	if rec != nil {
		return rec.Enabled
	}
	return repoIsOnboardedLegacy(owner, name)
}

type deployIntelGitHubFetch struct {
	Configured bool   `json:"configured"`
	Allowed    bool   `json:"allowed"`
	Ready      bool   `json:"ready"`
	Error      string `json:"error,omitempty"`
	FetchedAt  string `json:"fetched_at,omitempty"`
	Listed     int    `json:"listed"`
	TotalOpen  int    `json:"total_open"`
	Truncated  bool   `json:"truncated"`
	MaxListed  int    `json:"max_listed"`
}

const deployIntelMaxOpenPRList = 100

func fetchGitHubOpenPullRequests(ctx context.Context, client *github.Client, owner, name string, max int) ([]*github.PullRequest, int, bool, error) {
	listCap := deployIntelMaxOpenPRList
	if max > 0 && max < listCap {
		listCap = max
	}
	opts := &github.PullRequestListOptions{
		State:       "open",
		ListOptions: github.ListOptions{PerPage: 100},
	}
	collected := make([]*github.PullRequest, 0, deployIntelMaxOpenPRList)
	truncated := false
	for {
		prs, resp, err := client.PullRequests.List(ctx, owner, name, opts)
		if err != nil {
			return collected, len(collected), truncated, err
		}
		for _, pr := range prs {
			if len(collected) >= listCap {
				truncated = true
				break
			}
			collected = append(collected, pr)
		}
		if truncated || resp == nil || resp.NextPage == 0 {
			if !truncated && resp != nil && resp.NextPage != 0 && len(collected) >= listCap {
				truncated = true
			}
			break
		}
		opts.ListOptions.Page = resp.NextPage
	}
	total := len(collected)
	if truncated {
		total = len(collected)
	}
	return collected, total, truncated, nil
}

func shallowOpenPRBrief(owner, name string, pr *github.PullRequest) prImpactBrief {
	brief := prImpactBrief{
		Factors:      []prImpactFactor{},
		BlastRadius:  []string{},
		Commits:      []prImpactCommit{},
		Files:        []prImpactFile{},
		DeployStatus: "open",
		MergeState:   "open",
	}
	if pr == nil {
		return brief
	}
	number := pr.GetNumber()
	brief.PRNumber = number
	brief.PRURL = pr.GetHTMLURL()
	if brief.PRURL == "" && number > 0 {
		brief.PRURL = fmt.Sprintf("https://github.com/%s/%s/pull/%d", owner, name, number)
	}
	brief.Title = strings.TrimSpace(pr.GetTitle())
	if pr.GetUser() != nil {
		brief.Author = pr.GetUser().GetLogin()
	}
	if pr.GetBase() != nil {
		brief.BaseBranch = pr.GetBase().GetRef()
	}
	if pr.GetHead() != nil {
		brief.HeadBranch = pr.GetHead().GetRef()
	}
	brief.Additions = pr.GetAdditions()
	brief.Deletions = pr.GetDeletions()
	brief.ChangedFilesHint(pr.GetChangedFiles())
	brief.Summary = firstNonEmpty(brief.Title, fmt.Sprintf("Open pull request #%d", number))
	return brief
}

func repoDeployEventFromOpenPR(ctx context.Context, client *github.Client, owner, name string, pr *github.PullRequest, deep bool) repoDeployEvent {
	number := 0
	if pr != nil {
		number = pr.GetNumber()
	}
	req := findRequestByPRNumber(number)
	if req == nil && pr != nil && pr.GetHTMLURL() != "" {
		req = findRequestByPRURL(pr.GetHTMLURL())
	}
	var brief prImpactBrief
	if deep && number > 0 {
		brief = analyzeGitHubPullRequest(owner, name, number, req, "open")
	} else if pr != nil {
		brief = shallowOpenPRBrief(owner, name, pr)
		if req != nil {
			brief.RequestID = req.ID
		}
		scorePRImpact(&brief, req)
		if strings.TrimSpace(brief.Summary) == "" || strings.HasPrefix(brief.Summary, "Loading") {
			brief.Summary = firstNonEmpty(brief.Title, fmt.Sprintf("Open pull request #%d", number))
		}
	}
	brief.MergeState = "open"
	brief.DeployStatus = "open"
	if brief.ChangeBrief == nil {
		attachChangeBrief(&brief)
	}
	var reqID *int
	if req != nil && req.ID > 0 {
		reqID = &req.ID
		brief.RequestID = req.ID
	}
	return repoDeployEvent{
		RepoOwner:   owner,
		RepoName:    name,
		PRNumber:    number,
		RequestID:   reqID,
		Title:       brief.Title,
		Author:      brief.Author,
		BaseBranch:  brief.BaseBranch,
		HeadBranch:  brief.HeadBranch,
		CommitCount: brief.CommitCount,
		FileCount:   brief.FileCount,
		Additions:   brief.Additions,
		Deletions:   brief.Deletions,
		Score:       brief.Score,
		RiskLevel:   brief.RiskLevel,
		Summary:     brief.Summary,
		PRURL:       brief.PRURL,
		Impact:      brief,
		ChangeBrief: brief.ChangeBrief,
	}
}

func repoIsOnboardedLegacy(owner, repo string) bool {
	if !strings.EqualFold(strings.TrimSpace(owner), strings.TrimSpace(GitHubOwner)) {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(repo), strings.TrimSpace(GitHubRepo)) {
		return false
	}
	if GitHubToken == "" {
		return false
	}
	if DB == nil {
		return true
	}
	var count int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM gitops_projects`).Scan(&count)
	return count > 0
}

func repoDeployStats(owner, name string) (mergeCount, highRisk30d int, lastMerged *time.Time) {
	if DB == nil {
		return 0, 0, nil
	}
	var last time.Time
	err := DB.QueryRow(`
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE lower(risk_level) = 'high' AND merged_at >= NOW() - INTERVAL '30 days'),
		       MAX(merged_at)
		  FROM repo_deploy_events
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2)
	`, owner, name).Scan(&mergeCount, &highRisk30d, &last)
	if err == nil && !last.IsZero() {
		lastMerged = &last
	}
	return mergeCount, highRisk30d, lastMerged
}

type githubInspectCache struct {
	Count  int
	Access string
	At     time.Time
}

var githubInspectStore sync.Map

const githubInspectTTL = 45 * time.Second

func githubInspectKey(owner, name string) string {
	return strings.ToLower(strings.Trim(owner+"/"+name, "/"))
}

func rememberGitHubInspect(owner, name string, count int, access string) {
	owner, name = normalizeRepoIdentity(owner, name)
	now := time.Now().UTC()
	githubInspectStore.Store(githubInspectKey(owner, name), githubInspectCache{Count: count, Access: access, At: now})
}

func inspectDeployIntelGitHub(owner, name string) (openCount int, access string, fetchedAt *time.Time) {
	owner, name = normalizeRepoIdentity(owner, name)
	if GitHubToken == "" {
		return 0, "failed", nil
	}
	rec, _ := getDeployIntelRepo(owner, name)
	if rec != nil && !rec.Enabled {
		return 0, "paused", nil
	}
	if !deployIntelGitHubAccessAllowed(owner, name) {
		return 0, "failed", nil
	}
	if cached, ok := githubInspectStore.Load(githubInspectKey(owner, name)); ok {
		item := cached.(githubInspectCache)
		if time.Since(item.At) < githubInspectTTL {
			at := item.At
			return item.Count, item.Access, &at
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return 0, "failed", nil
	}
	query := fmt.Sprintf("repo:%s/%s is:pr is:open", owner, name)
	result, resp, err := client.Search.Issues(ctx, query, &github.SearchOptions{ListOptions: github.ListOptions{PerPage: 1}})
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound) {
			rememberGitHubInspect(owner, name, 0, "failed")
			return 0, "failed", nil
		}
		now := time.Now().UTC()
		rememberGitHubInspect(owner, name, 0, "connected")
		return 0, "connected", &now
	}
	total := 0
	if result != nil {
		total = result.GetTotal()
	}
	now := time.Now().UTC()
	rememberGitHubInspect(owner, name, total, "connected")
	return total, "connected", &now
}

func countGitHubOpenPRs(owner, name string) int {
	count, _, _ := inspectDeployIntelGitHub(owner, name)
	return count
}

func buildDeployIntelRepoSummary(item deployIntelRepo) deployIntelRepoSummary {
	mergeCount, highRisk30d, lastMerged := repoDeployStats(item.Owner, item.Name)
	ready := deployIntelRepoReady(item.Owner, item.Name)
	openCount, access, fetchedAt := inspectDeployIntelGitHub(item.Owner, item.Name)
	mergeTracking := "needs_setup"
	if ready {
		mergeTracking = "configured"
	}
	lastSync := fetchedAt
	if lastSync == nil {
		lastSync = lastMerged
	}
	if lastSync == nil && !item.UpdatedAt.IsZero() {
		updated := item.UpdatedAt.UTC()
		lastSync = &updated
	}
	summary := deployIntelRepoSummary{
		deployIntelRepo: item,
		Ready:           ready,
		MergeCount:      mergeCount,
		HighRisk30d:     highRisk30d,
		OpenPRCount:     openCount,
		LastMergedAt:    lastMerged,
		WebhookPath:     "/api/webhooks/github",
		GitHubAccess:    access,
		MergeTracking:   mergeTracking,
		LastSyncAt:      lastSync,
		NeedsAttention:  access != "connected" || mergeTracking == "needs_setup" || !item.Enabled,
	}
	switch {
	case !item.Enabled:
		summary.SetupSummary = "Repository is registered but monitoring is paused. Re-enable to fetch open PRs from GitHub."
	case access == "failed":
		summary.SetupSummary = "GitHub access failed. Confirm GITHUB_TOKEN can list pull requests for this repository."
	case mergeTracking == "needs_setup":
		summary.SetupSummary = fmt.Sprintf("Merge tracking is not configured. Add a GitOps project so merges into %s are captured automatically.", item.BaseBranch)
	default:
		summary.SetupSummary = fmt.Sprintf("GitHub is connected and merge tracking is configured for %s.", item.BaseBranch)
	}
	return summary
}

func lastChangeForRepo(owner, name string) *deployIntelLastChange {
	repo := strings.ToLower(strings.Trim(owner+"/"+name, "/"))
	if repo == "/" || repo == "" {
		return nil
	}
	changes, err := listChangeRequests(0, "", "", repo)
	if err != nil {
		return nil
	}
	var latest *changeRequestRecord
	for i := range changes {
		if strings.ToLower(strings.TrimSpace(changes[i].Repo)) != repo {
			continue
		}
		latest = &changes[i]
		break
	}
	if latest == nil {
		return nil
	}
	attachChangeRollbackPlan(latest)
	drift := detectServiceDrift(latest.Service, latest.Environment, latest.SHA, latest.ImageDigest)
	return &deployIntelLastChange{
		ID:               latest.ID,
		ChangeNumber:     latest.ChangeNumber,
		SHA:              latest.SHA,
		PreviousSHA:      latest.PreviousSHA,
		ProvenanceSigned: latest.ProvenanceSigned,
		SbomURL:          latest.SbomURL,
		AttestationURL:   latest.AttestationURL,
		PolicyStatus:     latest.PolicyStatus,
		Status:           latest.Status,
		ImageDigest:      latest.ImageDigest,
		Drift:            &drift,
		Rollback:         latest.RollbackPlan,
	}
}

func listDeployIntelRepoSummaries() ([]deployIntelRepoSummary, error) {
	repos, err := listDeployIntelRepos()
	if err != nil {
		return nil, err
	}
	if len(repos) == 0 {
		ensureDefaultDeployIntelRepo()
		repos, err = listDeployIntelRepos()
		if err != nil {
			return nil, err
		}
	}
	out := make([]deployIntelRepoSummary, len(repos))
	var wg sync.WaitGroup
	for i, item := range repos {
		wg.Add(1)
		go func(i int, item deployIntelRepo) {
			defer wg.Done()
			out[i] = buildDeployIntelRepoSummary(item)
		}(i, item)
	}
	wg.Wait()
	return out, nil
}

func listDeliveryOpenPullRequests(limitPerRepo int) []repoDeployEvent {
	repos, err := listDeployIntelRepos()
	if err != nil || len(repos) == 0 {
		return []repoDeployEvent{}
	}
	if limitPerRepo <= 0 || limitPerRepo > 20 {
		limitPerRepo = 12
	}
	if len(repos) > 8 {
		repos = repos[:8]
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	out := make([]repoDeployEvent, 0, len(repos)*limitPerRepo)
	for _, item := range repos {
		if !item.Enabled {
			continue
		}
		wg.Add(1)
		go func(item deployIntelRepo) {
			defer wg.Done()
			base := strings.TrimSpace(item.BaseBranch)
			if base == "" {
				base = "main"
			}
			events, _, err := listOpenPullRequestsAnalyzed(item.Owner, item.Name, openPRListOptions{
				Limit:          limitPerRepo,
				ProductionBase: base,
				BaseBranchOnly: true,
			})
			if err != nil || len(events) == 0 {
				return
			}
			mu.Lock()
			out = append(out, events...)
			mu.Unlock()
		}(item)
	}
	wg.Wait()
	return out
}

func listOpenPullRequestsAnalyzed(owner, name string, opts openPRListOptions) ([]repoDeployEvent, deployIntelGitHubFetch, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	meta := deployIntelGitHubFetch{
		Configured: GitHubToken != "",
		Allowed:    deployIntelGitHubAccessAllowed(owner, name),
		Ready:      deployIntelRepoReady(owner, name),
		MaxListed:  deployIntelMaxOpenPRList,
	}
	if !meta.Allowed {
		if !meta.Configured {
			meta.Error = "GITHUB_TOKEN is not configured on the API."
		} else {
			meta.Error = "Repository is not enabled for deploy intelligence."
		}
		return nil, meta, fmt.Errorf("%s", meta.Error)
	}
	if opts.Limit <= 0 || opts.Limit > deployIntelMaxOpenPRList {
		opts.Limit = deployIntelMaxOpenPRList
	}
	timeout := 20 * time.Second
	if opts.BatchDeep {
		timeout = 45 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		meta.Error = "GitHub client is not available."
		return nil, meta, fmt.Errorf("github client unavailable")
	}
	if opts.Only && opts.DeepPR > 0 {
		pr, _, getErr := client.PullRequests.Get(ctx, owner, name, opts.DeepPR)
		if getErr != nil || pr == nil {
			meta.Error = "The pull request could not be loaded from GitHub."
			return nil, meta, getErr
		}
		ev := attachOpenPRMeta(ctx, client, owner, name, pr, repoDeployEventFromOpenPR(ctx, client, owner, name, pr, true), true)
		meta.FetchedAt = time.Now().UTC().Format(time.RFC3339)
		meta.Listed = 1
		meta.TotalOpen = 1
		return []repoDeployEvent{ev}, meta, nil
	}
	fetchCap := opts.Limit
	if opts.BaseBranchOnly || !opts.IncludeDrafts {
		fetchCap = deployIntelMaxOpenPRList
	}
	prs, _, truncated, err := fetchGitHubOpenPullRequests(ctx, client, owner, name, fetchCap)
	if err != nil {
		meta.Error = err.Error()
		return nil, meta, err
	}
	filtered := make([]*github.PullRequest, 0, len(prs))
	for _, pr := range prs {
		if openPRMatchesFilters(pr, opts) {
			filtered = append(filtered, pr)
		}
		if len(filtered) >= opts.Limit {
			break
		}
	}
	meta.FetchedAt = time.Now().UTC().Format(time.RFC3339)
	meta.Listed = len(filtered)
	meta.TotalOpen = len(filtered)
	meta.Truncated = truncated || len(filtered) >= opts.Limit
	rememberGitHubInspect(owner, name, meta.TotalOpen, "connected")
	out := make([]repoDeployEvent, 0, len(filtered))
	batchDeepRemaining := 0
	if opts.BatchDeep {
		batchDeepRemaining = deployIntelBatchDeepMax
	}
	for _, pr := range filtered {
		number := pr.GetNumber()
		deep := opts.DeepPR > 0 && number == opts.DeepPR
		if !deep && opts.BatchDeep && batchDeepRemaining > 0 {
			deep = true
			batchDeepRemaining--
		}
		ev := repoDeployEventFromOpenPR(ctx, client, owner, name, pr, deep)
		ev = attachOpenPRMeta(ctx, client, owner, name, pr, ev, deep)
		out = append(out, ev)
	}
	if opts.DeepPR > 0 {
		found := false
		for i := range out {
			if out[i].PRNumber == opts.DeepPR {
				found = true
				pr := prByNumber(filtered, opts.DeepPR)
				out[i] = attachOpenPRMeta(ctx, client, owner, name, pr, repoDeployEventFromOpenPR(ctx, client, owner, name, pr, true), true)
				break
			}
		}
		if !found {
			pr := &github.PullRequest{Number: github.Int(opts.DeepPR)}
			ev := attachOpenPRMeta(ctx, client, owner, name, pr, repoDeployEventFromOpenPR(ctx, client, owner, name, pr, true), true)
			out = append(out, ev)
		}
	}
	attachOpenPRConflicts(out)
	attachSimilarMergesToOpenEvents(owner, name, out)
	return out, meta, nil
}

func prByNumber(prs []*github.PullRequest, number int) *github.PullRequest {
	for _, pr := range prs {
		if pr != nil && pr.GetNumber() == number {
			return pr
		}
	}
	return &github.PullRequest{Number: github.Int(number)}
}

func writeDeployIntelRepoError(w http.ResponseWriter, r *http.Request, err error) {
	status := http.StatusBadRequest
	msg := err.Error()
	switch {
	case errors.Is(err, errGitHubRepoNotFound):
		status = http.StatusNotFound
	case msg == "repository is not onboarded for deploy intelligence":
		status = http.StatusNotFound
	case strings.Contains(msg, "already onboarded"):
		status = http.StatusConflict
	case msg == "database not available":
		status = http.StatusServiceUnavailable
	}
	writeAPIError(w, r, status, msg, err)
}

func devopsDeployIntelReposHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	var body struct {
		Owner      string `json:"owner"`
		Name       string `json:"name"`
		NewOwner   string `json:"new_owner"`
		NewName    string `json:"new_name"`
		BaseBranch string `json:"base_branch"`
		Notes      string `json:"notes"`
		Enabled    *bool  `json:"enabled"`
		ProjectID  int    `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	switch r.Method {
	case http.MethodPost:
		if body.ProjectID > 0 {
			identity := resolveGitHubRepoForProject(body.ProjectID)
			if strings.TrimSpace(body.Owner) == "" {
				body.Owner = identity.Owner
			}
			if strings.TrimSpace(body.Name) == "" {
				body.Name = identity.Name
			}
			if strings.TrimSpace(body.BaseBranch) == "" {
				body.BaseBranch = identity.BaseBranch
			}
		}
		owner, name, err := verifyGitHubRepositoryForOnboard(body.Owner, body.Name)
		if err != nil {
			writeDeployIntelRepoError(w, r, err)
			return
		}
		enabled := true
		if body.Enabled != nil {
			enabled = *body.Enabled
		}
		repo, err := upsertDeployIntelRepo(owner, name, body.BaseBranch, body.Notes, enabled)
		if err != nil {
			writeDeployIntelRepoError(w, r, err)
			return
		}
		if body.ProjectID > 0 {
			if err := setGitOpsProjectGitHubRepo(body.ProjectID, repo.Owner, repo.Name); err != nil {
				log.Printf("[deploy-intel] link project %d to %s/%s: %v", body.ProjectID, repo.Owner, repo.Name, err)
			}
		}
		AppendAuditLog(&managerID, "deploy_intel_repo_onboard", "deploy_intel_repo", fmt.Sprintf("%s/%s", repo.Owner, repo.Name), repo.BaseBranch)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status": "ok",
			"repo":   buildDeployIntelRepoSummary(*repo),
		})
	case http.MethodPatch:
		repo, err := updateDeployIntelRepoCatalog(body.Owner, body.Name, body.NewOwner, body.NewName, body.BaseBranch)
		if err != nil {
			writeDeployIntelRepoError(w, r, err)
			return
		}
		AppendAuditLog(&managerID, "deploy_intel_repo_edit", "deploy_intel_repo", fmt.Sprintf("%s/%s", repo.Owner, repo.Name), repo.BaseBranch)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status": "ok",
			"repo":   buildDeployIntelRepoSummary(*repo),
			"note":   "Catalog repository updated. The GitHub repository was not renamed or deleted.",
		})
	case http.MethodDelete:
		owner, name := normalizeRepoIdentity(body.Owner, body.Name)
		if err := disconnectDeployIntelRepo(owner, name); err != nil {
			writeDeployIntelRepoError(w, r, err)
			return
		}
		AppendAuditLog(&managerID, "deploy_intel_repo_disconnect", "deploy_intel_repo", fmt.Sprintf("%s/%s", owner, name), "portal catalog only")
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status": "ok",
			"note":   "Disconnected from OpsTrellis. The GitHub repository was not deleted.",
		})
	default:
		writeMethodNotAllowed(w, r, http.MethodPost, http.MethodPatch, http.MethodDelete)
	}
}
