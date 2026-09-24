package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

type prImpactFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Category  string `json:"category"`
}

type prImpactCommit struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
}

type prImpactFactor struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
	Weight   int    `json:"weight"`
	Detail   string `json:"detail"`
}

type prImpactBrief struct {
	RequestID         int                       `json:"request_id,omitempty"`
	PRNumber          int                       `json:"pr_number,omitempty"`
	PRURL             string                    `json:"pr_url,omitempty"`
	Title             string                    `json:"title,omitempty"`
	Author            string                    `json:"author,omitempty"`
	BaseBranch        string                    `json:"base_branch,omitempty"`
	HeadBranch        string                    `json:"head_branch,omitempty"`
	MergeState        string                    `json:"merge_state,omitempty"`
	DeployStatus      string                    `json:"deploy_status,omitempty"`
	CommitCount       int                       `json:"commit_count"`
	FileCount         int                       `json:"file_count"`
	Additions         int                       `json:"additions"`
	Deletions         int                       `json:"deletions"`
	Environment       string                    `json:"environment,omitempty"`
	NextEnvironment   string                    `json:"next_environment,omitempty"`
	BlastRadius       []string                  `json:"blast_radius"`
	Score             int                       `json:"score"`
	RiskLevel         string                    `json:"risk_level"`
	Summary           string                    `json:"summary"`
	RecommendedAction string                    `json:"recommended_action"`
	Factors           []prImpactFactor          `json:"factors"`
	Commits           []prImpactCommit          `json:"commits,omitempty"`
	Files             []prImpactFile            `json:"files,omitempty"`
	Acknowledged      bool                      `json:"acknowledged,omitempty"`
	ChangeBrief       *deployIntelChangeBrief   `json:"change_brief,omitempty"`
	PlanDelta         *deployIntelPlanDelta     `json:"plan_delta,omitempty"`
	SimilarMerges     []deployIntelSimilarMerge `json:"similar_merges,omitempty"`
}

var prURLPattern = regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/pull/(\d+)`)

func requestPRImpactHandler(w http.ResponseWriter, r *http.Request, requestID, userID int) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		return
	}
	req, err := GetPRRequestByID(requestID)
	if err != nil || req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", err)
		return
	}
	if r.Method == http.MethodPost {
		brief := refreshPRImpactForRequest(req, "")
		if r.URL.Query().Get("acknowledge") == "1" {
			brief.Acknowledged = true
			_ = savePRImpactBrief(brief)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "impact": brief})
		return
	}
	brief := loadOrBuildPRImpact(req)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "impact": brief})
}

func devopsPRImpactHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		return
	}
	number, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("number")))
	requestID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("request_id")))
	var req *PRRequest
	if requestID > 0 {
		req, _ = GetPRRequestByID(requestID)
	} else if number > 0 {
		req = findRequestByPRNumber(number)
	}
	if req == nil {
		writeAPIError(w, r, http.StatusNotFound, "PR impact not found", nil)
		return
	}
	brief := loadOrBuildPRImpact(req)
	if r.Method == http.MethodPost && r.URL.Query().Get("acknowledge") == "1" {
		brief.Acknowledged = true
		_ = savePRImpactBrief(brief)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "impact": brief})
}

func devopsPRNumberImpactHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/prs/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[1] != "impact" {
		http.NotFound(w, r)
		return
	}
	query := r.URL.Query()
	query.Set("number", parts[0])
	r.URL.RawQuery = query.Encode()
	devopsPRImpactHandler(w, r)
}

func loadOrBuildPRImpact(req *PRRequest) prImpactBrief {
	if stored, ok := loadPRImpactBrief(req.ID); ok {
		return stored
	}
	return refreshPRImpactForRequest(req, "")
}

func refreshPRImpactForRequest(req *PRRequest, deployStatus string) prImpactBrief {
	owner, repo, number, _ := parseGitHubPRURL(req.PRURL)
	if owner == "" || repo == "" {
		identity := githubIdentityForRequest(req)
		if owner == "" {
			owner = identity.Owner
		}
		if repo == "" {
			repo = identity.Name
		}
	}
	return analyzeGitHubPullRequest(owner, repo, number, req, deployStatus)
}

func buildPRImpactFromRequest(req *PRRequest) prImpactBrief {
	if req == nil {
		return prImpactBrief{BlastRadius: []string{}, Factors: []prImpactFactor{}}
	}
	_, _, number, _ := parseGitHubPRURL(req.PRURL)
	files := []prImpactFile{}
	if req.FilePath != "" {
		files = append(files, prImpactFile{
			Path:     req.FilePath,
			Status:   "modified",
			Category: categorizeChangedPath(req.FilePath),
		})
	}
	brief := prImpactBrief{
		RequestID:       req.ID,
		PRNumber:        number,
		PRURL:           req.PRURL,
		Title:           fmt.Sprintf("%s %s for %s", req.Cloud, req.Service, req.Team),
		HeadBranch:      req.Branch,
		BaseBranch:      BaseBranch,
		MergeState:      req.Status,
		DeployStatus:    deployStatusFromRequest(req.Status),
		CommitCount:     1,
		FileCount:       len(files),
		Environment:     req.Env,
		NextEnvironment: nextEnvironment(req.Env),
		BlastRadius:     blastRadiusFromRequest(req, files),
		Files:           files,
		Factors:         []prImpactFactor{},
		Commits:         []prImpactCommit{},
	}
	return brief
}

func enrichPRImpactFromGitHub(brief *prImpactBrief, req *PRRequest, repoOwner, repoName string) {
	if brief == nil || GitHubToken == "" {
		return
	}
	prURL := strings.TrimSpace(brief.PRURL)
	if req != nil && strings.TrimSpace(req.PRURL) != "" {
		prURL = strings.TrimSpace(req.PRURL)
	}
	owner, repo, number, ok := parseGitHubPRURL(prURL)
	if !ok {
		owner = strings.TrimSpace(repoOwner)
		repo = strings.TrimSpace(repoName)
		number = brief.PRNumber
	}
	if owner == "" || repo == "" {
		owner = strings.TrimSpace(GitHubOwner)
		repo = strings.TrimSpace(GitHubRepo)
	}
	if number <= 0 || owner == "" || repo == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return
	}
	pr, _, err := client.PullRequests.Get(ctx, owner, repo, number)
	if err != nil || pr == nil {
		return
	}
	brief.PRNumber = number
	brief.Title = strings.TrimSpace(pr.GetTitle())
	brief.Author = pr.GetUser().GetLogin()
	brief.BaseBranch = pr.GetBase().GetRef()
	brief.HeadBranch = pr.GetHead().GetRef()
	brief.PRURL = pr.GetHTMLURL()
	if pr.GetMerged() {
		brief.MergeState = "merged"
		if brief.DeployStatus == "" || brief.DeployStatus == "open" {
			brief.DeployStatus = "merged"
		}
	} else if pr.GetState() != "" {
		brief.MergeState = pr.GetState()
	}
	brief.Additions = pr.GetAdditions()
	brief.Deletions = pr.GetDeletions()
	brief.ChangedFilesHint(pr.GetChangedFiles())

	commits, _, err := client.PullRequests.ListCommits(ctx, owner, repo, number, &github.ListOptions{PerPage: 50})
	if err == nil {
		brief.CommitCount = len(commits)
		brief.Commits = make([]prImpactCommit, 0, len(commits))
		for _, commit := range commits {
			message := ""
			author := ""
			if commit.Commit != nil {
				message = strings.TrimSpace(commit.Commit.GetMessage())
				if commit.Commit.Author != nil {
					author = commit.Commit.Author.GetName()
				}
			}
			if message == "" {
				continue
			}
			if idx := strings.Index(message, "\n"); idx > 0 {
				message = message[:idx]
			}
			brief.Commits = append(brief.Commits, prImpactCommit{
				SHA:     commit.GetSHA(),
				Message: message,
				Author:  author,
			})
		}
	}

	files, _, err := client.PullRequests.ListFiles(ctx, owner, repo, number, &github.ListOptions{PerPage: 100})
	if err == nil {
		brief.Files = make([]prImpactFile, 0, len(files))
		for _, file := range files {
			brief.Files = append(brief.Files, prImpactFile{
				Path:      file.GetFilename(),
				Status:    file.GetStatus(),
				Additions: file.GetAdditions(),
				Deletions: file.GetDeletions(),
				Category:  categorizeChangedPath(file.GetFilename()),
			})
		}
		brief.FileCount = len(brief.Files)
		brief.BlastRadius = blastRadiusFromRequest(req, brief.Files)
	}
}

func (brief *prImpactBrief) ChangedFilesHint(count int) {
	if brief.FileCount == 0 && count > 0 {
		brief.FileCount = count
	}
}

func scorePRImpact(brief *prImpactBrief, req *PRRequest) {
	if brief == nil {
		return
	}
	factors := make([]prImpactFactor, 0, 8)
	score := 8

	env := strings.ToLower(strings.TrimSpace(brief.Environment))
	if req != nil && env == "" {
		env = strings.ToLower(strings.TrimSpace(req.Env))
		brief.Environment = req.Env
	}
	if env == "prod" || env == "production" {
		score += 25
		factors = append(factors, prImpactFactor{"prod-target", "Targets production", "high", 25, "This change is intended for a production environment."})
	}
	base := strings.ToLower(strings.TrimSpace(brief.BaseBranch))
	if base == "main" || base == "master" || base == "prod" || base == "production" {
		score += 12
		factors = append(factors, prImpactFactor{"prod-branch", "Merges to a production branch", "high", 12, "Base branch is " + brief.BaseBranch + "."})
	}
	switch {
	case brief.CommitCount >= 9:
		score += 18
		factors = append(factors, prImpactFactor{"commit-volume", "Large commit batch", "high", 18, fmt.Sprintf("%d commits landed in this PR.", brief.CommitCount)})
	case brief.CommitCount >= 3:
		score += 8
		factors = append(factors, prImpactFactor{"commit-volume", "Multiple commits", "medium", 8, fmt.Sprintf("%d commits are included.", brief.CommitCount)})
	}
	diff := brief.Additions + brief.Deletions
	if diff >= 800 {
		score += 12
		factors = append(factors, prImpactFactor{"diff-size", "Large diff", "high", 12, fmt.Sprintf("%d lines changed.", diff)})
	} else if diff >= 200 {
		score += 6
		factors = append(factors, prImpactFactor{"diff-size", "Moderate diff", "medium", 6, fmt.Sprintf("%d lines changed.", diff)})
	}

	sensitive := 0
	docsOnly := brief.FileCount > 0
	for _, file := range brief.Files {
		if file.Category != "docs" && file.Category != "tests" {
			docsOnly = false
		}
		switch file.Category {
		case "kubernetes", "helm", "terraform", "iam", "secrets", "database", "ingress":
			sensitive++
		}
	}
	if sensitive > 0 {
		weight := minInt(sensitive*7, 28)
		score += weight
		factors = append(factors, prImpactFactor{"sensitive-files", "Touches operational files", "high", weight, fmt.Sprintf("%d files affect infra, access, or runtime config.", sensitive)})
	}
	if docsOnly {
		score -= 15
		factors = append(factors, prImpactFactor{"docs-only", "Docs or tests only", "low", -15, "No runtime files were detected in this PR."})
	}
	if req != nil && strings.Contains(strings.ToLower(req.Priority), "critical") {
		score += 10
		factors = append(factors, prImpactFactor{"priority", "Critical request priority", "high", 10, "The linked request is marked critical."})
	}
	if openIncidentCountForRequest(req) > 0 {
		score += 16
		factors = append(factors, prImpactFactor{"open-incident", "Open incident on this change", "high", 16, "An incident is still open for the linked request or project."})
	}
	if envEqualsProd(env) && activeFreezeReason() != "" {
		score += 20
		factors = append(factors, prImpactFactor{"freeze", "Production freeze is active", "high", 20, activeFreezeReason()})
	}
	for _, factor := range attachPlanDelta(brief, req) {
		score += factor.Weight
		factors = append(factors, factor)
	}
	for _, factor := range applyWatchlistFactors(brief, req) {
		score += factor.Weight
		factors = append(factors, factor)
	}

	brief.Score = clampChangeRiskScore(score)
	brief.RiskLevel = classifyChangeRiskScore(brief.Score)
	brief.Factors = factors
	brief.RecommendedAction = recommendPRImpactAction(*brief)
	brief.Summary = summarizePRImpact(*brief)
	attachChangeBrief(brief)
}

func recommendPRImpactAction(brief prImpactBrief) string {
	if brief.RiskLevel == "high" && envEqualsProd(brief.Environment) {
		return "Do not promote to production until this brief is acknowledged and blockers are cleared."
	}
	if brief.RiskLevel == "high" {
		return "Needs extra approval before merge or promotion."
	}
	if brief.RiskLevel == "medium" {
		return "Review the blast radius, then continue with the normal promotion checks."
	}
	return "Safe to merge with standard review."
}

func summarizePRImpact(brief prImpactBrief) string {
	env := strings.ToUpper(strings.TrimSpace(brief.Environment))
	if env == "" {
		env = "the target environment"
	}
	return fmt.Sprintf("This PR has %s risk (%d/100) for %s, with %d commit(s) and %d file(s) changed.", brief.RiskLevel, brief.Score, env, brief.CommitCount, brief.FileCount)
}

func blastRadiusFromRequest(req *PRRequest, files []prImpactFile) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 8)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	if req != nil {
		add(req.Service)
		add(req.Cloud)
		add(req.Env)
		add(req.Team)
	}
	for _, file := range files {
		add(file.Category)
	}
	return out
}

func categorizeChangedPath(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.Contains(lower, "secret"), strings.Contains(lower, ".env"), strings.Contains(lower, "vault"):
		return "secrets"
	case strings.Contains(lower, "iam"), strings.Contains(lower, "rbac"), strings.Contains(lower, "policy"):
		return "iam"
	case strings.Contains(lower, "helm"):
		return "helm"
	case strings.Contains(lower, "k8s"), strings.Contains(lower, "kubernetes"), strings.Contains(lower, "deployment"):
		return "kubernetes"
	case strings.Contains(lower, "ingress"):
		return "ingress"
	case strings.Contains(lower, ".tf"), strings.Contains(lower, "terraform"):
		return "terraform"
	case strings.Contains(lower, "sql"), strings.Contains(lower, "migration"), strings.Contains(lower, "rds"), strings.Contains(lower, "database"):
		return "database"
	case strings.HasSuffix(lower, ".md"), strings.Contains(lower, "docs/"):
		return "docs"
	case strings.Contains(lower, "_test."), strings.Contains(lower, "/test"):
		return "tests"
	default:
		return "code"
	}
}

func parseGitHubPRURL(raw string) (owner, repo string, number int, ok bool) {
	matches := prURLPattern.FindStringSubmatch(raw)
	if len(matches) != 4 {
		return "", "", 0, false
	}
	number, err := strconv.Atoi(matches[3])
	if err != nil || number <= 0 {
		return "", "", 0, false
	}
	return matches[1], strings.TrimSuffix(matches[2], ".git"), number, true
}

func deployStatusFromRequest(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed":
		return "applied"
	case "in_progress":
		return "open"
	case "rejected":
		return "failed"
	default:
		return status
	}
}

func openIncidentCountForRequest(req *PRRequest) int {
	if DB == nil || req == nil {
		return 0
	}
	var count int
	if req.ProjectID != nil {
		_ = DB.QueryRow(`
			SELECT COUNT(*) FROM request_incidents
			WHERE project_id = $1
			  AND LOWER(status) IN ('open', 'acknowledged', 'investigating', 'mitigating')
			  AND (
			    COALESCE(source,'ticket') NOT IN ('alert', 'change_regression')
			    OR LOWER(severity) IN ('high', 'critical')
			  )
		`, *req.ProjectID).Scan(&count)
		return count
	}
	_ = DB.QueryRow(`SELECT COUNT(*) FROM request_incidents WHERE request_id = $1 AND LOWER(status) NOT IN ('closed', 'resolved')`, req.ID).Scan(&count)
	return count
}

func findRequestByPRNumber(number int) *PRRequest {
	if DB == nil || number <= 0 {
		return nil
	}
	var id int
	err := DB.QueryRow(`SELECT id FROM pr_requests WHERE pr_url LIKE $1 ORDER BY updated_at DESC LIMIT 1`, "%/pull/"+strconv.Itoa(number)+"%").Scan(&id)
	if err != nil || id <= 0 {
		return nil
	}
	req, _ := GetPRRequestByID(id)
	return req
}

func savePRImpactBrief(brief prImpactBrief) error {
	if DB == nil || brief.RequestID <= 0 {
		return nil
	}
	payload, err := json.Marshal(brief)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`
		INSERT INTO pr_request_impact (request_id, pr_number, payload, score, risk_level, deploy_status, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
		ON CONFLICT (request_id) DO UPDATE SET
			pr_number = EXCLUDED.pr_number,
			payload = EXCLUDED.payload,
			score = EXCLUDED.score,
			risk_level = EXCLUDED.risk_level,
			deploy_status = EXCLUDED.deploy_status,
			updated_at = CURRENT_TIMESTAMP
	`, brief.RequestID, brief.PRNumber, string(payload), brief.Score, brief.RiskLevel, brief.DeployStatus)
	return err
}

func loadPRImpactBrief(requestID int) (prImpactBrief, bool) {
	var brief prImpactBrief
	if DB == nil || requestID <= 0 {
		return brief, false
	}
	var payload string
	err := DB.QueryRow(`SELECT payload FROM pr_request_impact WHERE request_id = $1`, requestID).Scan(&payload)
	if err != nil || payload == "" {
		return brief, false
	}
	if err := json.Unmarshal([]byte(payload), &brief); err != nil {
		return brief, false
	}
	return brief, true
}

func handleGitHubPullRequestEvent(payload map[string]interface{}) {
	processGitHubPullRequestWebhook(payload)
}

func findRequestByPRURL(raw string) *PRRequest {
	if DB == nil || strings.TrimSpace(raw) == "" {
		return nil
	}
	var id int
	err := DB.QueryRow(`SELECT id FROM pr_requests WHERE pr_url = $1 ORDER BY updated_at DESC LIMIT 1`, strings.TrimSpace(raw)).Scan(&id)
	if err != nil || id <= 0 {
		return nil
	}
	req, _ := GetPRRequestByID(id)
	return req
}
