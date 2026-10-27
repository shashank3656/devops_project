package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

type highRiskMergeGateResult struct {
	Required      bool                      `json:"required"`
	Acknowledged  bool                      `json:"acknowledged,omitempty"`
	Message       string                    `json:"message"`
	Event         *repoDeployEvent          `json:"event,omitempty"`
	ChangeBrief   *deployIntelChangeBrief   `json:"change_brief,omitempty"`
	Ack           *deployIntelAck           `json:"ack,omitempty"`
	SimilarMerges []deployIntelSimilarMerge `json:"similar_merges,omitempty"`
}

type gitHubRepoIdentity struct {
	Owner      string `json:"owner"`
	Name       string `json:"name"`
	BaseBranch string `json:"base_branch"`
	ProjectID  int    `json:"project_id,omitempty"`
	Source     string `json:"source"`
}

func changeBriefFromDeployEvent(ev *repoDeployEvent) *deployIntelChangeBrief {
	if ev == nil {
		return nil
	}
	if ev.ChangeBrief != nil {
		return ev.ChangeBrief
	}
	if ev.Impact.ChangeBrief != nil {
		ev.ChangeBrief = ev.Impact.ChangeBrief
		return ev.ChangeBrief
	}
	if ev.Impact.Score > 0 || len(ev.Impact.Files) > 0 || len(ev.Impact.Factors) > 0 {
		attachChangeBrief(&ev.Impact)
		ev.ChangeBrief = ev.Impact.ChangeBrief
		return ev.ChangeBrief
	}
	return nil
}

func evaluateHighRiskMergeContext(req *PRRequest) highRiskMergeGateResult {
	result := highRiskMergeGateResult{}
	if req == nil || req.ID <= 0 {
		return result
	}
	ev, err := latestHighRiskMergeForRequest(req.ID, 14*24*time.Hour)
	if err != nil || ev == nil {
		return result
	}
	if ev.SimilarMerges == nil {
		attachSimilarPastMerges(&ev.Impact, ev.RepoOwner, ev.RepoName)
		ev.SimilarMerges = ev.Impact.SimilarMerges
	}
	brief := changeBriefFromDeployEvent(ev)
	headline := strings.TrimSpace(ev.Title)
	if brief != nil && strings.TrimSpace(brief.Headline) != "" {
		headline = brief.Headline
	}
	if headline == "" {
		headline = fmt.Sprintf("PR #%d", ev.PRNumber)
	}
	result.Event = ev
	result.ChangeBrief = brief
	result.SimilarMerges = ev.SimilarMerges
	result.Ack = lookupDeployIntelAck(ev.RepoOwner, ev.RepoName, ev.PRNumber)
	result.Acknowledged = result.Ack != nil
	result.Required = !result.Acknowledged
	if result.Acknowledged {
		who := strings.TrimSpace(result.Ack.Username)
		if who == "" {
			who = "a reviewer"
		}
		result.Message = fmt.Sprintf("High-risk merge %s was acknowledged by %s.", headline, who)
	} else {
		result.Message = fmt.Sprintf(
			"A high-risk merge was recorded for this request (%s). Record an exception acknowledgement with reasons before continuing.",
			headline,
		)
	}
	return result
}

func evaluateHighRiskMergeAck(req *PRRequest) highRiskMergeGateResult {
	return evaluateHighRiskMergeContext(req)
}

func writeHighRiskMergeAckRequired(w http.ResponseWriter, gate highRiskMergeGateResult) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusPreconditionRequired)
	payload := map[string]interface{}{
		"status":                       "error",
		"error":                        gate.Message,
		"high_risk_merge_required":     true,
		"high_risk_merge_acknowledged": false,
		"ack_reasons_required":         true,
	}
	if gate.ChangeBrief != nil {
		payload["change_brief"] = gate.ChangeBrief
	}
	if len(gate.SimilarMerges) > 0 {
		payload["similar_merges"] = gate.SimilarMerges
	}
	if gate.Event != nil {
		payload["merge"] = map[string]interface{}{
			"pr_number":   gate.Event.PRNumber,
			"title":       gate.Event.Title,
			"risk_level":  gate.Event.RiskLevel,
			"score":       gate.Event.Score,
			"pr_url":      gate.Event.PRURL,
			"merged_at":   gate.Event.MergedAt,
			"repo_owner":  gate.Event.RepoOwner,
			"repo_name":   gate.Event.RepoName,
			"base_branch": gate.Event.BaseBranch,
		}
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func latestMergeForRequest(requestID int) (*repoDeployEvent, error) {
	return lookupLatestMergeForRequest(requestID, 365*24*time.Hour, false)
}

func changeBriefFromPromotionGate(gate *promotionGateDecision) *deployIntelChangeBrief {
	if gate == nil {
		return nil
	}
	for _, check := range gate.Checks {
		if check.Key == "recent_high_risk_merge" && check.ChangeBrief != nil {
			return check.ChangeBrief
		}
	}
	return nil
}

func scanRepoDeployEvent(row *sql.Row) (*repoDeployEvent, error) {
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
	if ev.Impact.ChangeBrief == nil {
		attachChangeBrief(&ev.Impact)
	}
	ev.ChangeBrief = ev.Impact.ChangeBrief
	attachSimilarPastMerges(&ev.Impact, ev.RepoOwner, ev.RepoName)
	ev.SimilarMerges = ev.Impact.SimilarMerges
	return &ev, nil
}

func listAdminDeployIntelFeed(limit int) ([]repoDeployEvent, error) {
	if DB == nil {
		return []repoDeployEvent{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	rows, err := DB.Query(`
		SELECT id, repo_owner, repo_name, pr_number, request_id, title, author, base_branch, head_branch,
		       merged_at, commit_count, file_count, additions, deletions, score, risk_level, summary, pr_url, payload
		  FROM repo_deploy_events
		 ORDER BY merged_at DESC
		 LIMIT $1
	`, limit)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []repoDeployEvent{}, nil
		}
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
		if ev.Impact.ChangeBrief == nil {
			attachChangeBrief(&ev.Impact)
		}
		ev.ChangeBrief = ev.Impact.ChangeBrief
		out = append(out, ev)
	}
	attachSimilarMergesToEvents(out)
	return out, nil
}

func adminDeployIntelligenceFeedHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	limit := 40
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	events, err := listAdminDeployIntelFeed(limit)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminJSON(w, map[string]interface{}{
		"status":    "ok",
		"events":    events,
		"read_only": true,
	})
}

func claimDeployIntelNotify(owner, repo string, prNumber int, channel string) bool {
	if DB == nil || prNumber <= 0 || strings.TrimSpace(channel) == "" {
		return false
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	result, err := DB.Exec(`
		INSERT INTO deploy_intel_notify_dedup (repo_owner, repo_name, pr_number, channel)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (repo_owner, repo_name, pr_number, channel) DO NOTHING
	`, owner, repo, prNumber, strings.ToLower(strings.TrimSpace(channel)))
	if err != nil {
		log.Printf("[deploy-intel] notify dedup %s #%d: %v", channel, prNumber, err)
		return false
	}
	affected, _ := result.RowsAffected()
	return affected == 1
}

func formatHighRiskMergeSlackText(owner, repo string, brief prImpactBrief) string {
	headline := strings.TrimSpace(brief.Summary)
	if brief.ChangeBrief != nil && strings.TrimSpace(brief.ChangeBrief.Headline) != "" {
		headline = brief.ChangeBrief.Headline
	}
	return fmt.Sprintf(
		"High-risk merge in %s/%s · PR #%d · %s · score %d",
		owner, repo, brief.PRNumber, headline, brief.Score,
	)
}

func formatHighRiskMergeSlackBody(owner, repo string, brief prImpactBrief) string {
	var b strings.Builder
	b.WriteString("*High-risk merge*\n")
	b.WriteString(formatHighRiskMergeSlackText(owner, repo, brief))
	if brief.ChangeBrief != nil && len(brief.ChangeBrief.Changing) > 0 {
		b.WriteString("\nChanging: ")
		parts := make([]string, 0, len(brief.ChangeBrief.Changing))
		for _, group := range brief.ChangeBrief.Changing {
			parts = append(parts, fmt.Sprintf("%s (%d)", group.Label, group.Count))
		}
		b.WriteString(strings.Join(parts, ", "))
	}
	if brief.ChangeBrief != nil && len(brief.ChangeBrief.RiskBecause) > 0 {
		b.WriteString("\nRisk because: ")
		b.WriteString(strings.Join(brief.ChangeBrief.RiskBecause, "; "))
	}
	if brief.PRURL != "" {
		b.WriteString("\nPR: ")
		b.WriteString(brief.PRURL)
	}
	if brief.RequestID > 0 {
		b.WriteString(fmt.Sprintf("\nTicket: #%d", brief.RequestID))
	}
	return b.String()
}

func githubIdentityForRequest(req *PRRequest) gitHubRepoIdentity {
	if req != nil && req.ProjectID != nil && *req.ProjectID > 0 {
		identity := resolveGitHubRepoForProject(*req.ProjectID)
		if identity.Source == "project" {
			return identity
		}
	}
	return defaultGitHubRepoIdentity()
}

func listDeployIntelProjectOptions() []map[string]interface{} {
	projects := listAllGitOpsProjects()
	out := make([]map[string]interface{}, 0, len(projects))
	for _, project := range projects {
		out = append(out, map[string]interface{}{
			"id":           project.ID,
			"name":         project.Name,
			"slug":         project.Slug,
			"github_owner": project.GitHubOwner,
			"github_repo":  project.GitHubRepo,
			"base_branch":  project.BaseBranch,
		})
	}
	return out
}

func listDevopsManagerEmails() []string {
	if DB == nil {
		return nil
	}
	rows, err := DB.Query(`
		SELECT DISTINCT COALESCE(u.email, '')
		  FROM users u
		  INNER JOIN devops_profiles p ON p.user_id = u.id
		 WHERE COALESCE(u.user_type, 'portal_user') = 'devops_user'
		   AND COALESCE(p.is_manager, false) = true
		   AND COALESCE(u.email, '') <> ''
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			continue
		}
		email = strings.TrimSpace(email)
		if email != "" {
			out = append(out, email)
		}
	}
	return out
}

func notifyHighRiskMergeIfNeeded(owner, repo string, brief prImpactBrief) {
	if !strings.EqualFold(strings.TrimSpace(brief.RiskLevel), "high") || brief.PRNumber <= 0 {
		return
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	if owner == "" || repo == "" {
		return
	}
	text := formatHighRiskMergeSlackText(owner, repo, brief)
	body := formatHighRiskMergeSlackBody(owner, repo, brief)
	if SlackWebhookURL != "" && claimDeployIntelNotify(owner, repo, brief.PRNumber, "slack") {
		SendSlackNotification(text, []map[string]interface{}{
			{
				"type": "section",
				"text": map[string]interface{}{
					"type": "mrkdwn",
					"text": body,
				},
			},
		})
	}
	if emails := listDevopsManagerEmails(); len(emails) > 0 && claimDeployIntelNotify(owner, repo, brief.PRNumber, "email") {
		emailBody := strings.ReplaceAll(body, "*", "")
		for _, email := range emails {
			if err := SendEmail(email, text, emailBody); err != nil {
				log.Printf("[deploy-intel] high-risk email to %s: %v", email, err)
			}
		}
	}
}

func recommendedDeployIntelCheckContexts() []string {
	return []string{checkInfragatePlanReview, checkInfragatePolicy}
}

func mergeRequiredCheckContexts(existing, required []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(existing)+len(required))
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		key := strings.ToLower(value)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, value)
	}
	for _, value := range existing {
		add(value)
	}
	for _, value := range required {
		add(value)
	}
	return out
}

func applyRecommendedBranchProtection(owner, name, baseBranch string) (deployIntelBranchProtection, error) {
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return deployIntelBranchProtection{}, fmt.Errorf("repository identity is required")
	}
	if strings.TrimSpace(baseBranch) == "" {
		baseBranch = "main"
	}
	if GitHubToken == "" {
		return deployIntelBranchProtection{}, fmt.Errorf("GITHUB_TOKEN is required to apply branch protection")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		return deployIntelBranchProtection{}, fmt.Errorf("GitHub client is not available")
	}
	required := recommendedDeployIntelCheckContexts()
	protection, _, getErr := client.Repositories.GetBranchProtection(ctx, owner, name, baseBranch)
	if getErr == nil && protection != nil {
		existing := make([]string, 0)
		if protection.RequiredStatusChecks != nil {
			if protection.RequiredStatusChecks.Contexts != nil {
				existing = append(existing, *protection.RequiredStatusChecks.Contexts...)
			}
			if protection.RequiredStatusChecks.Checks != nil {
				for _, check := range *protection.RequiredStatusChecks.Checks {
					if check != nil {
						existing = append(existing, check.Context)
					}
				}
			}
		}
		merged := mergeRequiredCheckContexts(existing, required)
		if _, _, err := client.Repositories.UpdateRequiredStatusChecks(ctx, owner, name, baseBranch, &github.RequiredStatusChecksRequest{
			Strict:   github.Bool(true),
			Contexts: merged,
		}); err != nil {
			return deployIntelBranchProtection{}, err
		}
		return buildDeployIntelBranchProtection(owner, name, baseBranch), nil
	}
	contexts := mergeRequiredCheckContexts(nil, required)
	_, _, err = client.Repositories.UpdateBranchProtection(ctx, owner, name, baseBranch, &github.ProtectionRequest{
		RequiredStatusChecks: &github.RequiredStatusChecks{
			Strict:   true,
			Contexts: &contexts,
		},
		EnforceAdmins: false,
		RequiredPullRequestReviews: &github.PullRequestReviewsEnforcementRequest{
			RequiredApprovingReviewCount: 1,
		},
		Restrictions: nil,
	})
	if err != nil {
		return deployIntelBranchProtection{}, err
	}
	return buildDeployIntelBranchProtection(owner, name, baseBranch), nil
}

func devopsDeployIntelProtectBranchHandler(w http.ResponseWriter, r *http.Request) {
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
		Confirm    bool   `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if !body.Confirm {
		writeAPIError(w, r, http.StatusBadRequest, "confirm is required to apply recommended branch protection", nil)
		return
	}
	owner, name := normalizeRepoIdentity(body.Owner, body.Name)
	if owner == "" || name == "" {
		writeAPIError(w, r, http.StatusBadRequest, "owner and name are required", nil)
		return
	}
	baseBranch := strings.TrimSpace(body.BaseBranch)
	if rec, _ := getDeployIntelRepo(owner, name); rec != nil && baseBranch == "" {
		baseBranch = rec.BaseBranch
	}
	protection, err := applyRecommendedBranchProtection(owner, name, baseBranch)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	AppendAuditLog(&managerID, "deploy_intel_protect_branch", "deploy_intel_repo", fmt.Sprintf("%s/%s", owner, name), protection.BaseBranch)
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":     "ok",
		"protection": protection,
	})
}

func defaultGitHubRepoIdentity() gitHubRepoIdentity {
	return gitHubRepoIdentity{
		Owner:      strings.TrimSpace(GitHubOwner),
		Name:       strings.TrimSpace(GitHubRepo),
		BaseBranch: strings.TrimSpace(BaseBranch),
		Source:     "env",
	}
}

func resolveGitHubRepoForProject(projectID int) gitHubRepoIdentity {
	identity := defaultGitHubRepoIdentity()
	if projectID <= 0 || DB == nil {
		return identity
	}
	var owner, name, base string
	err := DB.QueryRow(`
		SELECT COALESCE(github_owner, ''), COALESCE(github_repo, ''), COALESCE(NULLIF(TRIM(base_branch), ''), $2)
		  FROM gitops_projects
		 WHERE id = $1
	`, projectID, identity.BaseBranch).Scan(&owner, &name, &base)
	if err != nil {
		return identity
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return identity
	}
	if strings.TrimSpace(base) == "" {
		base = identity.BaseBranch
	}
	identity.Owner = owner
	identity.Name = name
	identity.BaseBranch = base
	identity.ProjectID = projectID
	identity.Source = "project"
	return identity
}

func findGitOpsProjectIDByGitHubRepo(owner, name string) int {
	if DB == nil {
		return 0
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return 0
	}
	var id int
	err := DB.QueryRow(`
		SELECT id FROM gitops_projects
		 WHERE lower(github_owner) = lower($1) AND lower(github_repo) = lower($2)
		 ORDER BY id ASC
		 LIMIT 1
	`, owner, name).Scan(&id)
	if err != nil {
		return 0
	}
	return id
}

func enableMergeTrackingForRepo(userID int, owner, name string, projectID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		return fmt.Errorf("owner and repository name are required")
	}
	rec, _ := getDeployIntelRepo(owner, name)
	if rec == nil || !rec.Enabled {
		return fmt.Errorf("repository is not onboarded for deploy intelligence")
	}
	if linked := findGitOpsProjectIDByGitHubRepo(owner, name); linked > 0 && (projectID == 0 || projectID == linked) {
		return nil
	}
	if projectID > 0 {
		identity := resolveGitHubRepoForProject(projectID)
		if identity.Source == "project" && identity.Owner != "" && identity.Name != "" {
			if !strings.EqualFold(identity.Owner, owner) || !strings.EqualFold(identity.Name, name) {
				return fmt.Errorf("that GitOps project is already linked to %s/%s", identity.Owner, identity.Name)
			}
			return nil
		}
		return setGitOpsProjectGitHubRepo(projectID, owner, name)
	}
	teamID, err := resolveGitOpsCreateTeamID(userID, 0, "")
	if err != nil {
		return err
	}
	if !CanUserCreateGitOpsProjectInTeam(userID, teamID) {
		return fmt.Errorf("GitOps admin access is required to create a project in this team")
	}
	projectName := name
	project, err := CreateGitOpsCatalogProject(teamID, projectName, "", nil, nil, "", userID)
	if err != nil {
		project, err = CreateGitOpsCatalogProject(teamID, owner+"/"+name, normalizeGitOpsProjectSlug(owner+"-"+name), nil, nil, "", userID)
		if err != nil {
			return err
		}
	}
	return applyGitHubRepoToCatalogProject(project, owner, name)
}

func setGitOpsProjectGitHubRepo(projectID int, owner, name string) error {
	if DB == nil || projectID <= 0 {
		return fmt.Errorf("project is required")
	}
	owner, name = normalizeRepoIdentity(owner, name)
	_, err := DB.Exec(`
		UPDATE gitops_projects
		   SET github_owner = $2,
		       github_repo = $3,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE id = $1
	`, projectID, owner, name)
	return err
}

func maybeOnboardDeployIntelForProjectRepo(project GitOpsCatalogProject) {
	owner, name := normalizeRepoIdentity(project.GitHubOwner, project.GitHubRepo)
	if owner == "" || name == "" {
		return
	}
	owner, name, err := verifyGitHubRepositoryForOnboard(owner, name)
	if err != nil {
		log.Printf("[deploy-intel] skip auto-onboard %s/%s from project %d: %v", project.GitHubOwner, project.GitHubRepo, project.ID, err)
		return
	}
	base := strings.TrimSpace(project.BaseBranch)
	if base == "" {
		base = BaseBranch
	}
	if _, err := upsertDeployIntelRepo(owner, name, base, fmt.Sprintf("Linked from GitOps project %s", project.Name), true); err != nil {
		log.Printf("[deploy-intel] auto-onboard %s/%s from project %d: %v", owner, name, project.ID, err)
	}
}
