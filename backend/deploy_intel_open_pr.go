package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/go-github/v61/github"
)

const (
	deployIntelReviewSLAWarnDays   = 3
	deployIntelReviewSLABreachDays = 7
	deployIntelBatchDeepMax        = 12
)

type deployIntelPreviewLink struct {
	RequestID int        `json:"request_id"`
	Env       string     `json:"env"`
	Branch    string     `json:"branch,omitempty"`
	Status    string     `json:"status,omitempty"`
	Label     string     `json:"label"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type deployIntelOpenPRMeta struct {
	IsDraft             bool                       `json:"is_draft"`
	CreatedAt           *time.Time                 `json:"created_at,omitempty"`
	AgeDays             int                        `json:"age_days"`
	ReviewSLA           string                     `json:"review_sla"` // ok, warning, breach
	ReviewDetail        string                     `json:"review_detail,omitempty"`
	Assignees           []string                   `json:"assignees,omitempty"`
	RequestedReviewers  []string                   `json:"requested_reviewers,omitempty"`
	Checks              []deployIntelRequiredCheck `json:"checks,omitempty"`
	PreviewEnvironments []deployIntelPreviewLink   `json:"preview_environments,omitempty"`
	SuggestTicket       bool                       `json:"suggest_ticket"`
	SuggestTicketReason string                     `json:"suggest_ticket_reason,omitempty"`
	ConflictsWith       []int                      `json:"conflicts_with,omitempty"`
}

type openPRListOptions struct {
	Limit          int
	DeepPR         int
	ProductionBase string
	BaseBranchOnly bool
	IncludeDrafts  bool
	BatchDeep      bool
}

func parseOpenPRListOptions(r *http.Request, productionBase string) openPRListOptions {
	opts := openPRListOptions{
		Limit:          deployIntelMaxOpenPRList,
		ProductionBase: strings.TrimSpace(productionBase),
	}
	if opts.ProductionBase == "" {
		opts.ProductionBase = "main"
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			opts.Limit = n
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("refresh_pr")); raw != "" {
		opts.DeepPR, _ = strconv.Atoi(raw)
	}
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("base_filter"))) {
	case "production", "base", "prod":
		opts.BaseBranchOnly = true
	}
	if strings.TrimSpace(r.URL.Query().Get("include_drafts")) == "1" {
		opts.IncludeDrafts = true
	}
	if strings.TrimSpace(r.URL.Query().Get("batch_deep")) == "1" {
		opts.BatchDeep = true
	}
	return opts
}

func openPRMatchesFilters(pr *github.PullRequest, opts openPRListOptions) bool {
	if pr == nil {
		return false
	}
	if pr.GetDraft() && !opts.IncludeDrafts {
		return false
	}
	if opts.BaseBranchOnly {
		base := ""
		if pr.GetBase() != nil {
			base = pr.GetBase().GetRef()
		}
		if !branchMatchesDeployIntelBase(base, opts.ProductionBase) {
			return false
		}
	}
	return true
}

func branchMatchesDeployIntelBase(baseRef, configuredBase string) bool {
	baseRef = strings.TrimSpace(baseRef)
	configuredBase = strings.TrimSpace(configuredBase)
	if baseRef == "" {
		return false
	}
	if configuredBase == "" {
		return isProductionBaseBranch(baseRef)
	}
	if strings.EqualFold(baseRef, configuredBase) {
		return true
	}
	return isProductionBaseBranch(baseRef) && isProductionBaseBranch(configuredBase)
}

func computeReviewSLA(createdAt time.Time, reviewState string) (status, detail string) {
	if createdAt.IsZero() {
		return "ok", ""
	}
	age := int(time.Since(createdAt).Hours() / 24)
	if age >= deployIntelReviewSLABreachDays {
		return "breach", fmt.Sprintf("Open %d days without merge.", age)
	}
	if age >= deployIntelReviewSLAWarnDays {
		return "warning", fmt.Sprintf("Open %d days — consider review or merge.", age)
	}
	if strings.EqualFold(reviewState, "changes_requested") {
		return "warning", "Changes were requested on this PR."
	}
	return "ok", fmt.Sprintf("Open %d day(s).", age)
}

func listInfragateChecksOnRef(ctx context.Context, client *github.Client, owner, name, ref string) []deployIntelRequiredCheck {
	out := []deployIntelRequiredCheck{
		{Key: "plan_review", Label: checkInfragatePlanReview, Required: true, Present: false, Status: "unknown"},
		{Key: "policy", Label: checkInfragatePolicy, Required: true, Present: false, Status: "unknown"},
		{Key: "deploy_intel", Label: checkInfragateDeployIntel, Required: false, Present: false, Status: "unknown"},
	}
	if client == nil || ref == "" {
		return out
	}
	runs, _, err := client.Checks.ListCheckRunsForRef(ctx, owner, name, ref, &github.ListCheckRunsOptions{
		ListOptions: github.ListOptions{PerPage: 100},
	})
	if err != nil || runs == nil {
		for i := range out {
			out[i].Status = "unknown"
			out[i].Detail = "Could not load check runs from GitHub."
		}
		return out
	}
	latest := map[string]string{}
	for _, run := range runs.CheckRuns {
		if run == nil || run.Name == nil {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(run.GetName()))
		conclusion := strings.ToLower(strings.TrimSpace(run.GetConclusion()))
		if conclusion == "" {
			conclusion = strings.ToLower(strings.TrimSpace(run.GetStatus()))
		}
		latest[name] = conclusion
	}
	for i := range out {
		key := strings.ToLower(out[i].Label)
		if state, ok := latest[key]; ok {
			out[i].Present = true
			switch state {
			case "success", "completed", "neutral":
				out[i].Status = "ok"
				out[i].Detail = "Check passed on head commit."
			case "failure", "cancelled", "timed_out", "action_required":
				out[i].Status = "missing"
				out[i].Detail = "Check did not pass: " + state
			default:
				out[i].Status = "unknown"
				out[i].Detail = "Check state: " + state
			}
		} else if out[i].Required {
			out[i].Status = "missing"
			out[i].Detail = "Not reported on latest commit."
		} else {
			out[i].Status = "unknown"
			out[i].Detail = "Change brief not posted yet."
		}
	}
	return out
}

func summarizePRReviews(ctx context.Context, client *github.Client, owner, name string, number int) string {
	if client == nil || number <= 0 {
		return ""
	}
	reviews, _, err := client.PullRequests.ListReviews(ctx, owner, name, number, &github.ListOptions{PerPage: 30})
	if err != nil || len(reviews) == 0 {
		return "No GitHub reviews yet."
	}
	approved := 0
	for _, rev := range reviews {
		if rev != nil && strings.EqualFold(rev.GetState(), "APPROVED") {
			approved++
		}
	}
	if approved > 0 {
		return fmt.Sprintf("%d approval(s) on GitHub.", approved)
	}
	return "Awaiting approval on GitHub."
}

func findPreviewEnvironmentsForBranch(headBranch string) []deployIntelPreviewLink {
	if DB == nil || strings.TrimSpace(headBranch) == "" {
		return nil
	}
	rows, err := DB.Query(`
		SELECT r.id, COALESCE(r.env,''), COALESCE(r.branch,''), COALESCE(r.status,''), l.expires_at
		  FROM pr_requests r
		  LEFT JOIN pr_request_lifetimes l ON l.request_id = r.id AND l.decommission_request_id IS NULL
		 WHERE lower(COALESCE(r.branch,'')) = lower($1)
		   AND lower(COALESCE(r.env,'')) IN ('dev','development','uat','staging','preview','sandbox','test')
		   AND r.status IN ('in_progress','pending_devops_approval','pending_approval','completed')
		 ORDER BY r.updated_at DESC
		 LIMIT 5
	`, strings.TrimSpace(headBranch))
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]deployIntelPreviewLink, 0)
	for rows.Next() {
		var link deployIntelPreviewLink
		var expires sql.NullTime
		if err := rows.Scan(&link.RequestID, &link.Env, &link.Branch, &link.Status, &expires); err != nil {
			continue
		}
		if expires.Valid {
			t := expires.Time
			link.ExpiresAt = &t
		}
		link.Label = fmt.Sprintf("Request #%d · %s", link.RequestID, link.Env)
		out = append(out, link)
	}
	return out
}

func buildOpenPRMeta(ctx context.Context, client *github.Client, owner, name string, pr *github.PullRequest, ev repoDeployEvent, deep bool) *deployIntelOpenPRMeta {
	if pr == nil {
		return nil
	}
	meta := &deployIntelOpenPRMeta{
		IsDraft: pr.GetDraft(),
		Checks: []deployIntelRequiredCheck{
			{Key: "plan_review", Label: checkInfragatePlanReview, Required: true, Status: "unknown"},
			{Key: "policy", Label: checkInfragatePolicy, Required: true, Status: "unknown"},
			{Key: "deploy_intel", Label: checkInfragateDeployIntel, Required: false, Status: "unknown"},
		},
	}
	if t := pr.GetCreatedAt(); !t.IsZero() {
		created := t.Time
		meta.CreatedAt = &created
		meta.AgeDays = int(time.Since(created).Hours() / 24)
		reviewNote := ""
		if deep && client != nil {
			reviewNote = summarizePRReviews(ctx, client, owner, name, pr.GetNumber())
		}
		meta.ReviewSLA, meta.ReviewDetail = computeReviewSLA(created, "")
		if reviewNote != "" && meta.ReviewDetail != "" {
			meta.ReviewDetail = meta.ReviewDetail + " " + reviewNote
		} else if reviewNote != "" {
			meta.ReviewDetail = reviewNote
		}
	}
	for _, u := range pr.Assignees {
		if u != nil && u.GetLogin() != "" {
			meta.Assignees = append(meta.Assignees, u.GetLogin())
		}
	}
	for _, u := range pr.RequestedReviewers {
		if u != nil && u.GetLogin() != "" {
			meta.RequestedReviewers = append(meta.RequestedReviewers, u.GetLogin())
		}
	}
	head := ""
	if pr.GetHead() != nil {
		head = pr.GetHead().GetRef()
	}
	meta.PreviewEnvironments = findPreviewEnvironmentsForBranch(head)
	if deep && client != nil && pr.GetHead() != nil {
		meta.Checks = listInfragateChecksOnRef(ctx, client, owner, name, pr.GetHead().GetSHA())
	}
	hasTicket := ev.RequestID != nil && *ev.RequestID > 0
	if !hasTicket && (strings.EqualFold(ev.RiskLevel, "high") || ev.Score >= 70) {
		meta.SuggestTicket = true
		meta.SuggestTicketReason = "High deploy risk — track through SetuOps approvals."
	} else if !hasTicket && meta.ReviewSLA == "breach" {
		meta.SuggestTicket = true
		meta.SuggestTicketReason = "Long-running open PR without an SetuOps request."
	}
	return meta
}

func countPullRequestCommits(ctx context.Context, client *github.Client, owner, name string, number int) int {
	total := 0
	opts := &github.ListOptions{PerPage: 100}
	for {
		commits, resp, err := client.PullRequests.ListCommits(ctx, owner, name, number, opts)
		if err != nil {
			return total
		}
		total += len(commits)
		if resp == nil || resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	return total
}

func countPullRequestChangedFiles(ctx context.Context, client *github.Client, owner, name string, number int) int {
	total := 0
	opts := &github.ListOptions{PerPage: 100}
	for {
		files, resp, err := client.PullRequests.ListFiles(ctx, owner, name, number, opts)
		if err != nil {
			return total
		}
		total += len(files)
		if resp == nil || resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	return total
}

// enrichOpenPRBriefStats loads commit/file/diff counts from GitHub (List PR omits these).
func enrichOpenPRBriefStats(ctx context.Context, client *github.Client, owner, name string, number int, brief *prImpactBrief, req *PRRequest) {
	if client == nil || brief == nil || number <= 0 {
		return
	}
	subCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	pr, _, err := client.PullRequests.Get(subCtx, owner, name, number)
	if err != nil || pr == nil {
		return
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
	if pr.GetHTMLURL() != "" {
		brief.PRURL = pr.GetHTMLURL()
	}
	brief.Additions = pr.GetAdditions()
	brief.Deletions = pr.GetDeletions()
	brief.CommitCount = countPullRequestCommits(subCtx, client, owner, name, number)
	files := listOpenPRImpactFiles(subCtx, client, owner, name, number)
	if len(files) > 0 {
		brief.Files = files
		brief.FileCount = len(files)
		brief.BlastRadius = blastRadiusFromRequest(req, files)
	} else {
		brief.FileCount = pr.GetChangedFiles()
		if brief.FileCount <= 0 {
			brief.FileCount = countPullRequestChangedFiles(subCtx, client, owner, name, number)
		}
	}
	brief.Summary = fmt.Sprintf(
		"%d commit(s), %d file(s), +%d/-%d (live from GitHub). Open for full file list and CI check details.",
		brief.CommitCount, brief.FileCount, brief.Additions, brief.Deletions,
	)
	scorePRImpact(brief, req)
}

func listOpenPRImpactFiles(ctx context.Context, client *github.Client, owner, name string, number int) []prImpactFile {
	if client == nil || number <= 0 {
		return nil
	}
	files, _, err := client.PullRequests.ListFiles(ctx, owner, name, number, &github.ListOptions{PerPage: 100})
	if err != nil {
		return nil
	}
	out := make([]prImpactFile, 0, len(files))
	for _, file := range files {
		if file == nil {
			continue
		}
		path := file.GetFilename()
		out = append(out, prImpactFile{
			Path:      path,
			Status:    file.GetStatus(),
			Additions: file.GetAdditions(),
			Deletions: file.GetDeletions(),
			Category:  categorizeChangedPath(path),
		})
	}
	return out
}

func attachOpenPRMeta(ctx context.Context, client *github.Client, owner, name string, pr *github.PullRequest, ev repoDeployEvent, deep bool) repoDeployEvent {
	meta := buildOpenPRMeta(ctx, client, owner, name, pr, ev, deep)
	if meta != nil {
		ev.OpenPR = meta
	}
	return ev
}

var deployIntelSlackDigestSchedulerActive int32

func startDeployIntelSlackDigestScheduler() {
	if SlackWebhookURL == "" {
		return
	}
	if !atomic.CompareAndSwapInt32(&deployIntelSlackDigestSchedulerActive, 0, 1) {
		return
	}
	go func() {
		time.Sleep(12 * time.Minute)
		runDeployIntelHighRiskOpenPRDigest(time.Now())
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for tick := range ticker.C {
			runDeployIntelHighRiskOpenPRDigest(tick)
		}
	}()
}

func runDeployIntelHighRiskOpenPRDigest(now time.Time) {
	if SlackWebhookURL == "" || GitHubToken == "" || DB == nil {
		return
	}
	repos, err := listDeployIntelRepos()
	if err != nil || len(repos) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return
	}
	var lines []string
	for _, item := range repos {
		if !item.Enabled || !deployIntelGitHubAccessAllowed(item.Owner, item.Name) {
			continue
		}
		base := item.BaseBranch
		if base == "" {
			base = "main"
		}
		opts := openPRListOptions{Limit: 30, ProductionBase: base, BaseBranchOnly: true}
		prs, _, _, err := fetchGitHubOpenPullRequests(ctx, client, item.Owner, item.Name, opts.Limit)
		if err != nil {
			continue
		}
		for _, pr := range prs {
			if !openPRMatchesFilters(pr, opts) {
				continue
			}
			ev := repoDeployEventFromOpenPR(ctx, client, item.Owner, item.Name, pr, false)
			if strings.EqualFold(ev.RiskLevel, "high") || ev.Score >= 70 {
				lines = append(lines, formatHighRiskOpenPRDigestLine(item.Owner, item.Name, ev))
			}
		}
	}
	if len(lines) == 0 {
		return
	}
	text := "Deploy intelligence — open high-risk PRs (" + now.Format("2006-01-02") + ")\n" + strings.Join(lines, "\n")
	SendSlackNotification(text, nil)
}

func devopsDeployIntelSuggestTicketHandler(w http.ResponseWriter, r *http.Request) {
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
		Owner        string   `json:"owner"`
		Repo         string   `json:"name"`
		PRNumber     int      `json:"pr_number"`
		Team         string   `json:"team"`
		Env          string   `json:"env"`
		Cloud        string   `json:"cloud"`
		Service      string   `json:"service"`
		ProjectID    *int     `json:"project_id"`
		Priority     string   `json:"priority"`
		Acknowledged bool     `json:"acknowledged"`
		Reasons      []string `json:"reasons"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	owner, name := normalizeRepoIdentity(body.Owner, body.Repo)
	if owner == "" || name == "" || body.PRNumber <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "owner, name, and pr_number are required", nil)
		return
	}
	if !deployIntelGitHubAccessAllowed(owner, name) {
		writeAPIError(w, r, http.StatusBadRequest, "repository is not enabled for deploy intelligence", nil)
		return
	}
	brief := analyzeGitHubPullRequest(owner, name, body.PRNumber, nil, "open")
	if strings.EqualFold(brief.RiskLevel, "high") || brief.Score >= 70 {
		if !hasDeployIntelAck(owner, name, body.PRNumber) {
			reasons := normalizeAckReasons(body.Reasons)
			if !body.Acknowledged || len(reasons) == 0 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusPreconditionRequired)
				payload := map[string]interface{}{
					"status":                   "error",
					"error":                    "High-risk open PR requires an exception acknowledgement with reasons before creating a ticket.",
					"high_risk_merge_required": true,
					"ack_reasons_required":     true,
					"change_brief":             brief.ChangeBrief,
					"similar_merges":           brief.SimilarMerges,
					"score":                    brief.Score,
					"risk_level":               brief.RiskLevel,
				}
				_ = json.NewEncoder(w).Encode(payload)
				return
			}
			if _, err := persistDeployIntelAck(owner, name, body.PRNumber, managerID, reasons); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
		}
	}
	if existing := findRequestByPRNumber(body.PRNumber); existing != nil {
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status":     "ok",
			"request_id": existing.ID,
			"existing":   true,
			"message":    "A ticket already exists for this pull request.",
		})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "github unavailable", err)
		return
	}
	pr, _, err := client.PullRequests.Get(ctx, owner, name, body.PRNumber)
	if err != nil || pr == nil {
		writeAPIError(w, r, http.StatusBadRequest, "pull request not found on GitHub", err)
		return
	}
	team := strings.TrimSpace(body.Team)
	if team == "" {
		team = "platform"
	}
	env := strings.TrimSpace(body.Env)
	if env == "" {
		env = "prod"
	}
	cloud := strings.TrimSpace(body.Cloud)
	if cloud == "" {
		cloud = "aws"
	}
	service := strings.TrimSpace(body.Service)
	if service == "" {
		service = "infra"
	}
	priority := strings.TrimSpace(body.Priority)
	if priority == "" {
		priority = "high"
	}
	appID, _ := GenerateApplicationID()
	headBranch := ""
	if pr.GetHead() != nil {
		headBranch = pr.GetHead().GetRef()
	}
	prURL := pr.GetHTMLURL()
	configPayload, _ := json.Marshal(map[string]interface{}{
		"source":     "deploy_intelligence",
		"repo":       owner + "/" + name,
		"pr_number":  body.PRNumber,
		"created_by": managerID,
		"risk_note":  "Suggested from deploy intelligence open PR analysis.",
	})
	req := &PRRequest{
		ProjectID:     body.ProjectID,
		Team:          team,
		Env:           env,
		Cloud:         cloud,
		Service:       service,
		ApplicationID: appID,
		Priority:      priority,
		PRURL:         prURL,
		Branch:        headBranch,
		Status:        "pending_devops_approval",
		Config:        string(configPayload),
		CreatedBy:     &managerID,
	}
	if err := SavePRRequest(req); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create ticket", err)
		return
	}
	AppendAuditLog(&managerID, "deploy_intel_suggest_ticket", "pr_request", strconv.Itoa(req.ID), prURL)
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":     "ok",
		"request_id": req.ID,
		"existing":   false,
		"message":    "SetuOps ticket created from deploy intelligence.",
	})
}
