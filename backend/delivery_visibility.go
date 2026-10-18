package main

import (
	"database/sql"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// DeliveryVisibility surfaces CI / deploy state for tickets and CHGs (BRD-08).
type DeliveryVisibility struct {
	Environment     string `json:"environment,omitempty"`
	PipelineStatus  string `json:"pipeline_status"`
	PipelineLabel   string `json:"pipeline_label"`
	CIResult        string `json:"ci_result,omitempty"`
	LastSHA         string `json:"last_sha,omitempty"`
	PromoteState    string `json:"promote_state,omitempty"`
	PipelineURL     string `json:"pipeline_url,omitempty"`
	PRURL           string `json:"pr_url,omitempty"`
	ImageDigest     string `json:"image_digest,omitempty"`
	DeployIntelHref string `json:"deploy_intel_href,omitempty"`
	Repo            string `json:"repo,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

func requestHasVerificationEvidence(req *PRRequest) bool {
	if req == nil {
		return false
	}
	if strings.TrimSpace(req.PRURL) != "" {
		return true
	}
	change, err := latestChangeForRequest(req.ID)
	if err != nil || change == nil {
		return false
	}
	return strings.TrimSpace(change.SHA) != "" || strings.TrimSpace(change.PipelineURL) != "" || strings.TrimSpace(change.ImageDigest) != ""
}

func buildRequestDeliveryVisibility(req *PRRequest) DeliveryVisibility {
	if req == nil {
		return DeliveryVisibility{PipelineStatus: "unknown", PipelineLabel: "Unknown"}
	}
	out := DeliveryVisibility{
		Environment: req.Env,
		PRURL:       strings.TrimSpace(req.PRURL),
		UpdatedAt:   req.UpdatedAt.UTC().Format(time.RFC3339),
	}
	ciStatus, ciAt := latestCIStatusForRequest(req.ID)
	plan := buildPlanReview(req)
	out.PipelineStatus, out.PipelineLabel, out.CIResult = classifyRequestPipeline(req, ciStatus, plan.HasPlan)
	if ciAt != nil {
		out.UpdatedAt = ciAt.UTC().Format(time.RFC3339)
	}
	if merge, _ := latestMergeForRequest(req.ID); merge != nil {
		if sha := latestCommitSHAFromImpact(merge.Impact); sha != "" {
			out.LastSHA = sha
		}
		if out.PRURL == "" {
			out.PRURL = strings.TrimSpace(merge.PRURL)
		}
	}
	if chg, _ := latestChangeForRequest(req.ID); chg != nil {
		if out.LastSHA == "" {
			out.LastSHA = strings.TrimSpace(chg.SHA)
		}
		if out.PipelineURL == "" {
			out.PipelineURL = strings.TrimSpace(chg.PipelineURL)
		}
		if out.Repo == "" {
			out.Repo = strings.TrimSpace(chg.Repo)
		}
		out.ImageDigest = strings.TrimSpace(chg.ImageDigest)
	}
	out.PromoteState = promotionStateForRequest(req.ID)
	out.DeployIntelHref = deployIntelHrefForRepo(out.Repo, out.PRURL)
	return out
}

func buildChangeDeliveryVisibility(item *changeRequestRecord) DeliveryVisibility {
	if item == nil {
		return DeliveryVisibility{PipelineStatus: "unknown", PipelineLabel: "Unknown"}
	}
	out := DeliveryVisibility{
		Environment: item.Environment,
		LastSHA:     strings.TrimSpace(item.SHA),
		PipelineURL: strings.TrimSpace(item.PipelineURL),
		PRURL:       strings.TrimSpace(item.PRURL),
		Repo:        strings.TrimSpace(item.Repo),
		UpdatedAt:   item.UpdatedAt.UTC().Format(time.RFC3339),
	}
	out.PipelineStatus, out.PipelineLabel, out.CIResult = classifyChangePipeline(item.Status)
	if item.RolloutStage != "" || item.RolloutPercent > 0 {
		out.PromoteState = fmt.Sprintf("Rollout %s at %d%%", defaultString(item.RolloutStage, "full"), item.RolloutPercent)
		if item.RolloutHalted {
			out.PromoteState += " · halted"
		}
	}
	if item.RequestID != nil && *item.RequestID > 0 {
		if promo := promotionStateForRequest(*item.RequestID); promo != "" {
			if out.PromoteState != "" {
				out.PromoteState += " · " + promo
			} else {
				out.PromoteState = promo
			}
		}
	}
	out.DeployIntelHref = deployIntelHrefForRepo(out.Repo, out.PRURL)
	return out
}

func classifyRequestPipeline(req *PRRequest, ciStatus string, hasPlan bool) (status, label, ciResult string) {
	st := strings.ToLower(strings.TrimSpace(req.Status))
	ci := normalizeCIWebhookStatus(ciStatus)
	if ci != "" {
		ciResult = strings.ReplaceAll(ci, "_", " ")
		switch {
		case strings.Contains(ci, "fail"):
			return "failed", "Pipeline failed", ciResult
		case strings.Contains(ci, "success") || strings.Contains(ci, "completed"):
			return "success", "Pipeline succeeded", ciResult
		case strings.Contains(ci, "plan"):
			return "running", "Plan finished", ciResult
		}
	}
	switch st {
	case "failed", "apply_failed", "plan_failed", "deploy_failed", "blocked", "rejected":
		return "failed", "Delivery failed", st
	case "completed":
		return "success", "Delivered", "completed"
	case "in_progress", "pending_approval", "pending_devops_approval", "pending_user_manager_approval":
		if hasPlan {
			return "running", "In progress", "plan ready"
		}
		return "running", "In progress", st
	case "draft":
		return "pending", "Not started", "draft"
	default:
		return "unknown", titleCasePipeline(st), st
	}
}

func classifyChangePipeline(changeStatus string) (status, label, ciResult string) {
	st := strings.ToLower(strings.TrimSpace(changeStatus))
	ciResult = st
	switch st {
	case "failed", "cancelled":
		return "failed", "Change failed", st
	case "resolved", "closed":
		return "success", "Change completed", st
	case "implementing", "scheduled", "approved":
		return "running", "Change in flight", st
	default:
		return "unknown", titleCasePipeline(st), st
	}
}

func titleCasePipeline(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	if s == "" {
		return "Unknown"
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func latestCIStatusForRequest(requestID int) (status string, at *time.Time) {
	if DB == nil || requestID <= 0 {
		return "", nil
	}
	rid := fmt.Sprintf("%d", requestID)
	var details string
	var created time.Time
	err := DB.QueryRow(`
		SELECT COALESCE(details, ''), created_at
		FROM user_activity
		WHERE resource_type = 'pr_request' AND resource_id = $1
		  AND (action = 'request_completed_by_pipeline' OR details LIKE 'ci_status=%')
		ORDER BY created_at DESC
		LIMIT 1
	`, rid).Scan(&details, &created)
	if err != nil {
		return "", nil
	}
	details = strings.TrimSpace(details)
	if strings.HasPrefix(details, "ci_status=") {
		return strings.TrimPrefix(details, "ci_status="), &created
	}
	return normalizeCIWebhookStatus(details), &created
}

func latestChangeForRequest(requestID int) (*changeRequestRecord, error) {
	if DB == nil || requestID <= 0 {
		return nil, sql.ErrNoRows
	}
	var id int
	err := DB.QueryRow(`
		SELECT id FROM change_requests
		WHERE request_id = $1
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
	`, requestID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return getChangeRequestByID(id)
}

func promotionStateForRequest(requestID int) string {
	if DB == nil || requestID <= 0 {
		return ""
	}
	var childID int
	var childEnv, childStatus string
	err := DB.QueryRow(`
		SELECT id, env, status FROM pr_requests
		WHERE linked_request_id = $1
		ORDER BY id DESC LIMIT 1
	`, requestID).Scan(&childID, &childEnv, &childStatus)
	if err == nil && childID > 0 {
		return fmt.Sprintf("Promoted to %s as request #%d (%s)", childEnv, childID, childStatus)
	}
	var parentID sql.NullInt64
	_ = DB.QueryRow(`SELECT linked_request_id FROM pr_requests WHERE id = $1`, requestID).Scan(&parentID)
	if parentID.Valid && parentID.Int64 > 0 {
		return fmt.Sprintf("Promoted from request #%d", parentID.Int64)
	}
	return ""
}

func deployIntelHrefForRepo(repo, prURL string) string {
	owner, name := parseRepoOwnerName(repo)
	if owner == "" || name == "" {
		owner, name = parseRepoFromPRURL(prURL)
	}
	if owner == "" || name == "" {
		return ""
	}
	return fmt.Sprintf("/deploy-intelligence/%s/%s", url.PathEscape(owner), url.PathEscape(name))
}

func parseRepoOwnerName(repo string) (owner, name string) {
	repo = strings.TrimSpace(repo)
	if strings.HasPrefix(repo, "http://") || strings.HasPrefix(repo, "https://") {
		if u, err := url.Parse(repo); err == nil {
			repo = strings.Trim(u.Path, "/")
		}
	} else if strings.Contains(repo, "github.com/") || strings.Contains(repo, "gitlab.com/") {
		if idx := strings.Index(repo, "/"); idx >= 0 {
			repo = strings.Trim(repo[idx+1:], "/")
		}
	}
	parts := strings.Split(strings.Trim(repo, "/"), "/")
	if len(parts) >= 2 {
		return parts[0], strings.TrimSuffix(parts[1], ".git")
	}
	return "", ""
}

func parseRepoFromPRURL(prURL string) (owner, name string) {
	u, err := url.Parse(strings.TrimSpace(prURL))
	if err != nil {
		return "", ""
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) >= 4 && strings.EqualFold(parts[2], "pull") {
		return parts[0], parts[1]
	}
	if len(parts) >= 2 {
		return parts[0], strings.TrimSuffix(parts[1], ".git")
	}
	return "", ""
}

func latestCommitSHAFromImpact(brief prImpactBrief) string {
	for i := len(brief.Commits) - 1; i >= 0; i-- {
		if sha := strings.TrimSpace(brief.Commits[i].SHA); sha != "" {
			return sha
		}
	}
	return ""
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
