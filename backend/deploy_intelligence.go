package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type repoDeployEvent struct {
	ID          int           `json:"id"`
	RepoOwner   string        `json:"repo_owner"`
	RepoName    string        `json:"repo_name"`
	PRNumber    int           `json:"pr_number"`
	RequestID   *int          `json:"request_id,omitempty"`
	Title       string        `json:"title"`
	Author      string        `json:"author"`
	BaseBranch  string        `json:"base_branch"`
	HeadBranch  string        `json:"head_branch"`
	MergedAt    time.Time     `json:"merged_at"`
	CommitCount int           `json:"commit_count"`
	FileCount   int           `json:"file_count"`
	Additions   int           `json:"additions"`
	Deletions   int           `json:"deletions"`
	Score       int           `json:"score"`
	RiskLevel   string        `json:"risk_level"`
	Summary     string        `json:"summary"`
	PRURL       string        `json:"pr_url"`
	Impact      prImpactBrief `json:"impact"`
}

func isProductionBaseBranch(ref string) bool {
	switch strings.ToLower(strings.TrimSpace(ref)) {
	case "main", "master", "prod", "production":
		return true
	default:
		return false
	}
}

// repoIsOnboarded is true when the repo is registered for deploy intelligence and GitHub/GitOps prerequisites are met.
func repoIsOnboarded(owner, repo string) bool {
	owner, repo = normalizeRepoIdentity(owner, repo)
	if rec, _ := getDeployIntelRepo(owner, repo); rec != nil {
		return rec.Enabled && deployIntelRepoReady(owner, repo)
	}
	return repoIsOnboardedLegacy(owner, repo)
}

func analyzeGitHubPullRequest(owner, repo string, number int, req *PRRequest, deployStatus string) prImpactBrief {
	brief := prImpactBrief{Factors: []prImpactFactor{}, BlastRadius: []string{}, Commits: []prImpactCommit{}, Files: []prImpactFile{}}
	if number > 0 && owner != "" && repo != "" {
		brief.PRNumber = number
		brief.PRURL = fmt.Sprintf("https://github.com/%s/%s/pull/%d", owner, repo, number)
	}
	if req != nil {
		brief = buildPRImpactFromRequest(req)
		if brief.PRURL == "" && number > 0 {
			brief.PRURL = fmt.Sprintf("https://github.com/%s/%s/pull/%d", owner, repo, number)
			brief.PRNumber = number
		}
	}
	if deployStatus != "" {
		brief.DeployStatus = deployStatus
	}
	enrichPRImpactFromGitHub(&brief, req)
	scorePRImpact(&brief, req)
	if req != nil && req.ID > 0 {
		_ = savePRImpactBrief(brief)
	}
	return brief
}

func saveRepoDeployEvent(owner, repo string, mergedAt time.Time, brief prImpactBrief, requestID *int) error {
	if DB == nil || brief.PRNumber <= 0 {
		return nil
	}
	payload, err := json.Marshal(brief)
	if err != nil {
		return err
	}
	var reqID interface{}
	if requestID != nil && *requestID > 0 {
		reqID = *requestID
	}
	_, err = DB.Exec(`
		INSERT INTO repo_deploy_events (
			repo_owner, repo_name, pr_number, request_id, title, author, base_branch, head_branch,
			merged_at, commit_count, file_count, additions, deletions, score, risk_level, summary, pr_url, payload, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_TIMESTAMP)
		ON CONFLICT (repo_owner, repo_name, pr_number) DO UPDATE SET
			request_id = COALESCE(EXCLUDED.request_id, repo_deploy_events.request_id),
			title = EXCLUDED.title,
			author = EXCLUDED.author,
			base_branch = EXCLUDED.base_branch,
			head_branch = EXCLUDED.head_branch,
			merged_at = EXCLUDED.merged_at,
			commit_count = EXCLUDED.commit_count,
			file_count = EXCLUDED.file_count,
			additions = EXCLUDED.additions,
			deletions = EXCLUDED.deletions,
			score = EXCLUDED.score,
			risk_level = EXCLUDED.risk_level,
			summary = EXCLUDED.summary,
			pr_url = EXCLUDED.pr_url,
			payload = EXCLUDED.payload,
			updated_at = CURRENT_TIMESTAMP
	`, owner, repo, brief.PRNumber, reqID, brief.Title, brief.Author, brief.BaseBranch, brief.HeadBranch,
		mergedAt, brief.CommitCount, brief.FileCount, brief.Additions, brief.Deletions,
		brief.Score, brief.RiskLevel, brief.Summary, brief.PRURL, string(payload))
	return err
}

func listRepoDeployEvents(owner, repo string, limit int) ([]repoDeployEvent, error) {
	if DB == nil {
		return nil, nil
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	if owner == "" || repo == "" {
		owner, repo = normalizeRepoIdentity(GitHubOwner, GitHubRepo)
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := DB.Query(`
		SELECT id, repo_owner, repo_name, pr_number, request_id, title, author, base_branch, head_branch,
		       merged_at, commit_count, file_count, additions, deletions, score, risk_level, summary, pr_url, payload
		  FROM repo_deploy_events
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2)
		 ORDER BY merged_at DESC
		 LIMIT $3
	`, owner, repo, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]repoDeployEvent, 0)
	for rows.Next() {
		var ev repoDeployEvent
		var reqID *int
		var payload string
		if err := rows.Scan(
			&ev.ID, &ev.RepoOwner, &ev.RepoName, &ev.PRNumber, &reqID, &ev.Title, &ev.Author,
			&ev.BaseBranch, &ev.HeadBranch, &ev.MergedAt, &ev.CommitCount, &ev.FileCount,
			&ev.Additions, &ev.Deletions, &ev.Score, &ev.RiskLevel, &ev.Summary, &ev.PRURL, &payload,
		); err != nil {
			return nil, err
		}
		ev.RequestID = reqID
		if payload != "" {
			_ = json.Unmarshal([]byte(payload), &ev.Impact)
		}
		out = append(out, ev)
	}
	return out, nil
}

func processGitHubPullRequestWebhook(payload map[string]interface{}) {
	pr, _ := payload["pull_request"].(map[string]interface{})
	if pr == nil {
		return
	}
	action, _ := payload["action"].(string)
	merged, _ := pr["merged"].(bool)
	number := intFromAny(pr["number"])
	htmlURL, _ := pr["html_url"].(string)

	owner, repo := parseRepositoryFromWebhook(payload)
	baseRef := ""
	if base, ok := pr["base"].(map[string]interface{}); ok {
		baseRef, _ = base["ref"].(string)
	}

	req := findRequestByPRNumber(number)
	if req == nil && htmlURL != "" {
		req = findRequestByPRURL(htmlURL)
	}

	deploy := ""
	if merged {
		deploy = "merged"
	} else if action == "opened" || action == "synchronize" {
		deploy = "open"
	}

	if req != nil {
		refreshPRImpactForRequest(req, deploy)
	}

	if !merged || !isProductionBaseBranch(baseRef) {
		return
	}
	if owner == "" || repo == "" {
		owner, repo = GitHubOwner, GitHubRepo
	}
	if !repoIsOnboarded(owner, repo) {
		return
	}

	brief := analyzeGitHubPullRequest(owner, repo, number, req, "merged")
	brief.MergeState = "merged"
	brief.DeployStatus = "merged"

	mergedAt := time.Now().UTC()
	if mergedAtRaw, ok := pr["merged_at"].(string); ok && strings.TrimSpace(mergedAtRaw) != "" {
		if parsed, err := time.Parse(time.RFC3339, mergedAtRaw); err == nil {
			mergedAt = parsed
		}
	}

	var reqID *int
	if req != nil && req.ID > 0 {
		reqID = &req.ID
	}
	if err := saveRepoDeployEvent(owner, repo, mergedAt, brief, reqID); err != nil {
		log.Printf("[deploy-intel] save merge #%d: %v", number, err)
		return
	}
	details := fmt.Sprintf("PR #%d merged to %s · risk=%s score=%d commits=%d", number, baseRef, brief.RiskLevel, brief.Score, brief.CommitCount)
	AppendGitHubLog("deploy_merge_analyzed", details, htmlURL)
	if reqID != nil {
		AppendAuditLog(nil, "deploy_merge_analyzed", "pr_request", strconv.Itoa(*reqID), details)
	}
}

func parseRepositoryFromWebhook(payload map[string]interface{}) (owner, name string) {
	repoObj, _ := payload["repository"].(map[string]interface{})
	if repoObj == nil {
		return "", ""
	}
	name, _ = repoObj["full_name"].(string)
	if parts := strings.SplitN(name, "/", 2); len(parts) == 2 {
		return parts[0], parts[1]
	}
	name, _ = repoObj["name"].(string)
	if ownerObj, ok := repoObj["owner"].(map[string]interface{}); ok {
		owner, _ = ownerObj["login"].(string)
	}
	return owner, name
}

func intFromAny(value interface{}) int {
	switch n := value.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

func latestHighRiskMergeForRequest(requestID int, within time.Duration) (*repoDeployEvent, error) {
	if DB == nil || requestID <= 0 {
		return nil, nil
	}
	if within <= 0 {
		within = 14 * 24 * time.Hour
	}
	cutoff := time.Now().UTC().Add(-within)
	row := DB.QueryRow(`
		SELECT id, repo_owner, repo_name, pr_number, request_id, title, author, base_branch, head_branch,
		       merged_at, commit_count, file_count, additions, deletions, score, risk_level, summary, pr_url, payload
		  FROM repo_deploy_events
		 WHERE request_id = $1
		   AND lower(risk_level) = 'high'
		   AND merged_at >= $2
		 ORDER BY merged_at DESC
		 LIMIT 1
	`, requestID, cutoff)
	var ev repoDeployEvent
	var reqID *int
	var payload string
	err := row.Scan(
		&ev.ID, &ev.RepoOwner, &ev.RepoName, &ev.PRNumber, &reqID, &ev.Title, &ev.Author,
		&ev.BaseBranch, &ev.HeadBranch, &ev.MergedAt, &ev.CommitCount, &ev.FileCount,
		&ev.Additions, &ev.Deletions, &ev.Score, &ev.RiskLevel, &ev.Summary, &ev.PRURL, &payload,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	ev.RequestID = reqID
	if payload != "" {
		_ = json.Unmarshal([]byte(payload), &ev.Impact)
	}
	return &ev, nil
}

func applyHighRiskMergePromotionCheck(decision *promotionGateDecision, requestID int, targetEnvironment string) {
	if decision == nil || requestID <= 0 {
		return
	}
	if !isHighControlEnvironment(targetEnvironment) {
		return
	}
	ev, err := latestHighRiskMergeForRequest(requestID, 14*24*time.Hour)
	if err != nil || ev == nil {
		return
	}
	detail := fmt.Sprintf(
		"PR #%d merged to %s on %s with high change risk (score %d). %s",
		ev.PRNumber,
		ev.BaseBranch,
		ev.MergedAt.Format("2006-01-02"),
		ev.Score,
		strings.TrimSpace(ev.Summary),
	)
	if ev.PRURL != "" {
		detail += " " + ev.PRURL
	}
	check := deploymentGateCheck{
		Key:    "recent_high_risk_merge",
		Label:  "Recent high-risk merge",
		Status: "attention",
		Detail: detail,
	}
	decision.Checks = append(decision.Checks, check)
	decision.AttentionCheckCount++
	if decision.Approved {
		return
	}
	if decision.Status == "ready" && decision.CanPromote {
		decision.Status = "attention"
		decision.CanPromote = false
		decision.RequiresAcknowledgement = true
		decision.ReviewMessage = fmt.Sprintf(
			"A high-risk merge was recorded for this request. Review deploy intelligence before promoting to %s.",
			strings.ToUpper(strings.TrimSpace(targetEnvironment)),
		)
	} else if decision.Status != "blocked" && !decision.CanPromote && decision.ReviewMessage == "" {
		decision.ReviewMessage = "Review recent high-risk merge activity before continuing promotion."
	}
}

func devopsDeployIntelligenceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}

	owner := strings.TrimSpace(r.URL.Query().Get("owner"))
	repo := strings.TrimSpace(r.URL.Query().Get("repo"))
	if owner == "" && repo == "" {
		if combined := strings.TrimSpace(r.URL.Query().Get("repository")); strings.Contains(combined, "/") {
			owner, repo = normalizeRepoIdentity("", combined)
		}
	}

	// Catalog: onboard repos first, then drill into owner/repo for PR analysis.
	if owner == "" || repo == "" {
		summaries, err := listDeployIntelRepoSummaries()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{
			"status":               "ok",
			"repos":                summaries,
			"future_capabilities":  deployIntelFutureCapabilities,
		})
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	section := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("section")))
	if section == "" {
		section = "merges"
	}

	rec, _ := getDeployIntelRepo(owner, repo)
	if rec == nil {
		ensureDefaultDeployIntelRepo()
		rec, _ = getDeployIntelRepo(owner, repo)
	}
	if rec == nil && !repoIsOnboardedLegacy(owner, repo) {
		writeAPIError(w, r, http.StatusNotFound, "repository is not onboarded for deploy intelligence", nil)
		return
	}
	baseBranch := BaseBranch
	if rec != nil && strings.TrimSpace(rec.BaseBranch) != "" {
		baseBranch = rec.BaseBranch
	}

	refreshNumber, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("refresh_pr")))
	if refreshNumber > 0 && repoIsOnboarded(owner, repo) {
		req := findRequestByPRNumber(refreshNumber)
		brief := analyzeGitHubPullRequest(owner, repo, refreshNumber, req, "merged")
		brief.MergeState = "merged"
		var reqID *int
		if req != nil {
			reqID = &req.ID
		}
		_ = saveRepoDeployEvent(owner, repo, time.Now().UTC(), brief, reqID)
	}

	repoSummary := buildDeployIntelRepoSummary(deployIntelRepo{
		Owner: owner, Name: repo, BaseBranch: baseBranch, Enabled: true,
	})
	if rec != nil {
		repoSummary = buildDeployIntelRepoSummary(*rec)
	}

	var events []repoDeployEvent
	var err error
	if section == "open" {
		events, err = listOpenPullRequestsAnalyzed(owner, repo, limit)
	} else {
		events, err = listRepoDeployEvents(owner, repo, limit)
	}
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}

	insights, insightErr := buildDeployIntelRepoInsights(owner, repo, baseBranch)
	if insightErr != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", insightErr)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":              "ok",
		"repo":                repoSummary,
		"section":             section,
		"events":              events,
		"insights":            insights,
		"future_capabilities": deployIntelFutureCapabilities,
		"onboarded_repo": map[string]interface{}{
			"owner":     owner,
			"name":      repo,
			"base":      baseBranch,
			"onboarded": repoSummary.Ready,
		},
	})
}
