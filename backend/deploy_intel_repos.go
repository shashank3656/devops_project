package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

var deployIntelFutureCapabilities = []string{
	"deploy_frequency_by_service",
	"rollback_correlation",
	"required_checks_per_environment_branch",
}

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

type deployIntelRepoSummary struct {
	deployIntelRepo
	Ready           bool       `json:"ready"`
	MergeCount      int        `json:"merge_count"`
	HighRisk30d     int        `json:"high_risk_30d"`
	OpenPRCount     int        `json:"open_pr_count"`
	LastMergedAt    *time.Time `json:"last_merged_at,omitempty"`
	WebhookPath     string     `json:"webhook_path"`
	SetupSummary    string     `json:"setup_summary"`
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

func countGitHubOpenPRs(owner, name string) int {
	if GitHubToken == "" {
		return 0
	}
	owner, name = normalizeRepoIdentity(owner, name)
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return 0
	}
	prs, _, err := client.PullRequests.List(ctx, owner, name, &github.PullRequestListOptions{
		State: "open", ListOptions: github.ListOptions{PerPage: 1},
	})
	if err != nil {
		return 0
	}
	// GitHub does not return total; fetch up to 30 for display count
	if len(prs) == 0 {
		return 0
	}
	all, _, err := client.PullRequests.List(ctx, owner, name, &github.PullRequestListOptions{
		State: "open", ListOptions: github.ListOptions{PerPage: 30},
	})
	if err != nil {
		return len(prs)
	}
	return len(all)
}

func buildDeployIntelRepoSummary(item deployIntelRepo) deployIntelRepoSummary {
	mergeCount, highRisk30d, lastMerged := repoDeployStats(item.Owner, item.Name)
	ready := deployIntelRepoReady(item.Owner, item.Name)
	openCount := 0
	if ready {
		openCount = countGitHubOpenPRs(item.Owner, item.Name)
	}
	summary := deployIntelRepoSummary{
		deployIntelRepo: item,
		Ready:           ready,
		MergeCount:      mergeCount,
		HighRisk30d:     highRisk30d,
		OpenPRCount:     openCount,
		LastMergedAt:    lastMerged,
		WebhookPath:     "/api/webhooks/github",
	}
	switch {
	case !item.Enabled:
		summary.SetupSummary = "Repository is registered but monitoring is paused."
	case GitHubToken == "":
		summary.SetupSummary = "Add GITHUB_TOKEN on the API so InfraGate can read pull requests."
	case !ready:
		summary.SetupSummary = "Enable this repo and add at least one GitOps project in the catalog."
	default:
		summary.SetupSummary = fmt.Sprintf("Listening for merges into %s and analyzing open pull requests on demand.", item.BaseBranch)
	}
	return summary
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
	out := make([]deployIntelRepoSummary, 0, len(repos))
	for _, item := range repos {
		out = append(out, buildDeployIntelRepoSummary(item))
	}
	return out, nil
}

func listOpenPullRequestsAnalyzed(owner, name string, limit int) ([]repoDeployEvent, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if !deployIntelRepoReady(owner, name) {
		return nil, fmt.Errorf("repository is not ready for deploy intelligence")
	}
	if limit <= 0 || limit > 30 {
		limit = 20
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return nil, fmt.Errorf("github client unavailable")
	}
	prs, _, err := client.PullRequests.List(ctx, owner, name, &github.PullRequestListOptions{
		State: "open", ListOptions: github.ListOptions{PerPage: limit},
	})
	if err != nil {
		return nil, err
	}
	out := make([]repoDeployEvent, 0, len(prs))
	for _, pr := range prs {
		number := pr.GetNumber()
		req := findRequestByPRNumber(number)
		if req == nil && pr.GetHTMLURL() != "" {
			req = findRequestByPRURL(pr.GetHTMLURL())
		}
		brief := analyzeGitHubPullRequest(owner, name, number, req, "open")
		brief.MergeState = "open"
		var reqID *int
		if req != nil && req.ID > 0 {
			reqID = &req.ID
		}
		out = append(out, repoDeployEvent{
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
		})
	}
	return out, nil
}

func devopsDeployIntelReposHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	var body struct {
		Owner      string `json:"owner"`
		Name       string `json:"name"`
		BaseBranch string `json:"base_branch"`
		Notes      string `json:"notes"`
		Enabled    *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	repo, err := upsertDeployIntelRepo(body.Owner, body.Name, body.BaseBranch, body.Notes, enabled)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	AppendAuditLog(&managerID, "deploy_intel_repo_onboard", "deploy_intel_repo", fmt.Sprintf("%s/%s", repo.Owner, repo.Name), repo.BaseBranch)
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status": "ok",
		"repo":   buildDeployIntelRepoSummary(*repo),
	})
}
