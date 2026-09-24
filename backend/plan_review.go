package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

const planReviewStatusContext = "infragate/plan-review"

type planChange struct {
	Address string `json:"address"`
	Action  string `json:"action"` // create, update, destroy, replace, read
}

type planReview struct {
	HasPlan        bool         `json:"has_plan"`
	NoChanges      bool         `json:"no_changes"`
	Import         int          `json:"import"`
	Add            int          `json:"add"`
	Change         int          `json:"change"`
	Destroy        int          `json:"destroy"`
	Replace        int          `json:"replace"`
	DestroyOnly    int          `json:"destroy_only"`
	Changes        []planChange `json:"changes"`
	Truncated      bool         `json:"truncated"`
	PlanHash       string       `json:"plan_hash,omitempty"`
	RequiresAck    bool         `json:"requires_ack"`
	Acknowledged   bool         `json:"acknowledged"`
	AcknowledgedBy string       `json:"acknowledged_by,omitempty"`
	AcknowledgedAt *time.Time   `json:"acknowledged_at,omitempty"`
	AckNote        string       `json:"ack_note,omitempty"`
}

var (
	planANSIPattern     = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)
	planSummaryPattern  = regexp.MustCompile(`Plan:\s*(?:(\d+) to import,\s*)?(\d+) to add,\s*(\d+) to change,\s*(\d+) to destroy`)
	planResourcePattern = regexp.MustCompile(`^\s*#\s+(\S+)\s+(?:is tainted, so\s+)?(will be created|will be updated in-place|will be destroyed|must be replaced|will be read during apply)`)
)

const planChangeLimit = 60

func planActionFor(phrase string) string {
	switch phrase {
	case "will be created":
		return "create"
	case "will be updated in-place":
		return "update"
	case "will be destroyed":
		return "destroy"
	case "must be replaced":
		return "replace"
	default:
		return "read"
	}
}

func planActionRank(action string) int {
	switch action {
	case "destroy":
		return 0
	case "replace":
		return 1
	case "update":
		return 2
	case "create":
		return 3
	default:
		return 4
	}
}

func planOutputHash(output string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(output)))
	return hex.EncodeToString(sum[:])[:16]
}

// parseTerraformPlan summarises human-readable `terraform plan` output. Replacements are
// counted separately because Terraform reports each one as both an add and a destroy.
func parseTerraformPlan(output string) planReview {
	review := planReview{Changes: []planChange{}}
	clean := strings.TrimSpace(planANSIPattern.ReplaceAllString(output, ""))
	if clean == "" {
		return review
	}
	review.HasPlan = true
	review.PlanHash = planOutputHash(output)
	if strings.Contains(clean, "No changes.") || strings.Contains(clean, "Your infrastructure matches the configuration") {
		review.NoChanges = true
	}
	if match := planSummaryPattern.FindStringSubmatch(clean); match != nil {
		review.Import, _ = strconv.Atoi(match[1])
		review.Add, _ = strconv.Atoi(match[2])
		review.Change, _ = strconv.Atoi(match[3])
		review.Destroy, _ = strconv.Atoi(match[4])
	}

	seen := map[string]bool{}
	destroyLines := 0
	for _, line := range strings.Split(clean, "\n") {
		match := planResourcePattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		action := planActionFor(match[2])
		if action == "read" || seen[match[1]+action] {
			continue
		}
		seen[match[1]+action] = true
		switch action {
		case "replace":
			review.Replace++
		case "destroy":
			destroyLines++
		}
		review.Changes = append(review.Changes, planChange{Address: match[1], Action: action})
	}
	// Plans pasted without the summary line still get counts from the resource headers.
	if review.Destroy == 0 && destroyLines > 0 {
		review.Destroy = destroyLines + review.Replace
	}
	sort.SliceStable(review.Changes, func(i, j int) bool {
		return planActionRank(review.Changes[i].Action) < planActionRank(review.Changes[j].Action)
	})
	if len(review.Changes) > planChangeLimit {
		review.Changes = review.Changes[:planChangeLimit]
		review.Truncated = true
	}
	review.NoChanges = review.NoChanges && review.Add == 0 && review.Change == 0 && review.Destroy == 0
	review.DestroyOnly = planPureDestroys(review)
	return review
}

// planDestroysResources reports whether the plan deletes anything, counting replacements.
func planDestroysResources(review planReview) bool {
	return review.Destroy > 0 || review.Replace > 0
}

// planPureDestroys excludes replacements, which Terraform also counts under "to destroy".
func planPureDestroys(review planReview) int {
	if review.Destroy > review.Replace {
		return review.Destroy - review.Replace
	}
	return 0
}

func buildPlanReview(req *PRRequest) planReview {
	if req == nil {
		return planReview{Changes: []planChange{}}
	}
	review := parseTerraformPlan(req.TerraformPlanOutput)
	review.RequiresAck = review.HasPlan && envEqualsProd(req.Env) && planDestroysResources(review)
	if !review.HasPlan || DB == nil {
		return review
	}
	var (
		ackBy   sql.NullInt64
		ackAt   sql.NullTime
		ackNote string
	)
	err := DB.QueryRow(`
		SELECT acknowledged_by, acknowledged_at, COALESCE(note, '')
		FROM pr_request_plan_reviews
		WHERE request_id = $1 AND plan_hash = $2
	`, req.ID, review.PlanHash).Scan(&ackBy, &ackAt, &ackNote)
	if err != nil {
		return review
	}
	review.Acknowledged = true
	review.AckNote = ackNote
	if ackAt.Valid {
		at := ackAt.Time
		review.AcknowledgedAt = &at
	}
	if ackBy.Valid && ackBy.Int64 > 0 {
		names, _ := GetUsernamesByUserIDs([]int{int(ackBy.Int64)})
		review.AcknowledgedBy = names[int(ackBy.Int64)]
	}
	return review
}

func savePlanAcknowledgement(requestID, userID int, planHash, note string) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	acknowledgedBy := sql.NullInt64{Int64: int64(userID), Valid: userID > 0}
	_, err := DB.Exec(`
		INSERT INTO pr_request_plan_reviews (request_id, plan_hash, acknowledged_by, acknowledged_at, note)
		VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
		ON CONFLICT (request_id) DO UPDATE SET
			plan_hash = EXCLUDED.plan_hash,
			acknowledged_by = EXCLUDED.acknowledged_by,
			acknowledged_at = CURRENT_TIMESTAMP,
			note = EXCLUDED.note
	`, requestID, planHash, acknowledgedBy, note)
	return err
}

func planReviewStatusFor(review planReview) (state, description string) {
	switch {
	case !review.HasPlan:
		return "", ""
	case review.RequiresAck && !review.Acknowledged:
		parts := []string{}
		if destroyed := planPureDestroys(review); destroyed > 0 {
			parts = append(parts, fmt.Sprintf("%d destroyed", destroyed))
		}
		if review.Replace > 0 {
			parts = append(parts, fmt.Sprintf("%d replaced", review.Replace))
		}
		return "pending", "Prod plan: " + strings.Join(parts, ", ") + ". Acknowledge in SetuOps to merge."
	case review.RequiresAck:
		who := review.AcknowledgedBy
		if who == "" {
			who = "a reviewer"
		}
		return "success", "Destructive changes acknowledged by " + who
	default:
		return "success", fmt.Sprintf("Plan: +%d ~%d -%d. No production deletions.", review.Add, review.Change, review.Destroy)
	}
}

// publishPlanReviewStatus mirrors the review onto the PR head commit so branch protection
// can require `infragate/plan-review` before merge.
func publishPlanReviewStatus(req *PRRequest, review planReview) {
	state, description := planReviewStatusFor(review)
	publishRequestCommitStatus(req, planReviewStatusContext, state, description)
}

// publishRequestCommitStatus sets a GitHub commit status on the head of the request's PR.
func publishRequestCommitStatus(req *PRRequest, statusContext, state, description string) {
	if state == "" || req == nil || GitHubToken == "" {
		return
	}
	owner, repo, number, ok := parseGitHubPRURL(req.PRURL)
	if !ok || number <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil {
		return
	}
	pr, _, err := client.PullRequests.Get(ctx, owner, repo, number)
	if err != nil || pr == nil || pr.GetHead().GetSHA() == "" {
		log.Printf("[%s] request %d: could not load PR head: %v", statusContext, req.ID, err)
		return
	}
	target := strings.TrimRight(DevOpsFrontendURL, "/") + "/tickets?id=" + strconv.Itoa(req.ID)
	status := &github.RepoStatus{
		State:       github.String(state),
		Context:     github.String(statusContext),
		Description: github.String(truncateStatusDescription(description)),
		TargetURL:   github.String(target),
	}
	if _, _, err := client.Repositories.CreateStatus(ctx, owner, repo, pr.GetHead().GetSHA(), status); err != nil {
		log.Printf("[%s] request %d: set status failed: %v", statusContext, req.ID, err)
	}
}

func truncateStatusDescription(text string) string {
	const limit = 140
	if len(text) <= limit {
		return text
	}
	return text[:limit-1] + "…"
}

// handlePlanReviewAcknowledge serves POST .../requests/:id/plan-review/acknowledge for admin and DevOps managers.
func handlePlanReviewAcknowledge(w http.ResponseWriter, r *http.Request, req *PRRequest, userID int, actor string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		PlanHash string `json:"plan_hash"`
		Note     string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	review := buildPlanReview(req)
	if !review.HasPlan {
		writeAPIError(w, r, http.StatusBadRequest, "this request has no Terraform plan yet", nil)
		return
	}
	if strings.TrimSpace(body.PlanHash) != review.PlanHash {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "error",
			"error":       "The plan changed since you opened it. Review the new plan before acknowledging.",
			"plan_review": review,
		})
		return
	}
	note := strings.TrimSpace(body.Note)
	if len(note) > 500 {
		note = note[:500]
	}
	if err := savePlanAcknowledgement(req.ID, userID, review.PlanHash, note); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to save acknowledgement", err)
		return
	}
	var auditUser *int
	if userID > 0 {
		auditUser = &userID
	}
	AppendAuditLog(auditUser, "plan_review_acknowledge", "pr_request", strconv.Itoa(req.ID),
		fmt.Sprintf("%s:hash=%s destroy=%d replace=%d note=%s", actor, review.PlanHash, review.Destroy, review.Replace, note))
	updated := buildPlanReview(req)
	go publishPlanReviewStatus(req, updated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "plan_review": updated})
}
