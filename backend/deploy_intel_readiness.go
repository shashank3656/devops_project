package main

import (
	"strings"
	"time"
)

type releaseReadinessCheck struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	State  string `json:"state"`
	Detail string `json:"detail"`
	Owner  string `json:"owner,omitempty"`
}

type releaseReadiness struct {
	State       string                  `json:"state"`
	Label       string                  `json:"label"`
	Note        string                  `json:"note"`
	SHA         string                  `json:"sha,omitempty"`
	Source      string                  `json:"source"`
	EvaluatedAt string                  `json:"evaluated_at"`
	Author      string                  `json:"author,omitempty"`
	Owner       string                  `json:"owner,omitempty"`
	Reasons     []string                `json:"reasons,omitempty"`
	Checks      []releaseReadinessCheck `json:"checks"`
}

const releaseReadinessNote = "Release readiness is not deployment authorization. The risk score is a separate impact estimate."

func attachReleaseReadiness(owner, name string, events []repoDeployEvent) {
	for i := range events {
		events[i].Readiness = buildPRReleaseReadiness(owner, name, events[i])
	}
}

func buildPRReleaseReadiness(owner, name string, ev repoDeployEvent) *releaseReadiness {
	now := time.Now().UTC()
	sha := strings.TrimSpace(ev.HeadSHA)
	ci := deployIntelCISummary{Label: "No checks yet"}
	var checks []deployIntelRequiredCheck
	reviewDecision := ""
	reviewDetail := ""
	if ev.OpenPR != nil {
		ci = ev.OpenPR.CI
		checks = ev.OpenPR.Checks
		reviewDecision = ev.OpenPR.ReviewDecision
		reviewDetail = ev.OpenPR.ReviewDetail
	}
	if len(checks) > 0 {
		ci = ciSummaryFromChecks(checks)
	}
	var change *changeRequestRecord
	if ev.PRNumber > 0 {
		if found := findChangesForRepoPRs(owner, name, []int{ev.PRNumber}); len(found) > 0 {
			item := found[ev.PRNumber]
			change = &item
			if sha == "" {
				sha = strings.TrimSpace(item.SHA)
			}
		}
	}
	authorName := strings.TrimSpace(ev.Author)
	return finalizeReleaseReadiness(releaseReadinessInput{
		SHA:            sha,
		Source:         "GitHub pull request",
		EvaluatedAt:    now,
		Author:         authorName,
		Owner:          responsiblePRReviewer(authorName, ev.OpenPR, change),
		CI:             ci,
		ReviewDecision: reviewDecision,
		ReviewDetail:   reviewDetail,
		Change:         change,
		Environment:    "",
	})
}

func buildChangeReleaseReadiness(item changeRequestRecord) *releaseReadiness {
	ci := deployIntelCISummary{Label: "No checks yet"}
	switch strings.ToLower(strings.TrimSpace(pipelineLabelForChange(item))) {
	case "failed":
		ci = deployIntelCISummary{Failed: 1, Label: "Failing"}
	case "running", "posted":
		ci = deployIntelCISummary{Pending: 1, Label: "Pending"}
	case "succeeded":
		ci = deployIntelCISummary{Passed: 1}
		ci.Label = formatCISummaryLabel(ci)
	}
	if strings.TrimSpace(item.PipelineURL) == "" && ci.Passed == 0 && ci.Failed == 0 && ci.Pending == 0 {
		ci.Label = "No checks yet"
	}
	authorName := strings.TrimSpace(item.Author)
	return finalizeReleaseReadiness(releaseReadinessInput{
		SHA:            strings.TrimSpace(item.SHA),
		Source:         "Change record",
		EvaluatedAt:    time.Now().UTC(),
		Author:         authorName,
		Owner:          responsiblePRReviewer(authorName, nil, &item),
		CI:             ci,
		ReviewDecision: "",
		ReviewDetail:   "",
		Change:         &item,
		Environment:    item.Environment,
	})
}

type releaseReadinessInput struct {
	SHA            string
	Source         string
	EvaluatedAt    time.Time
	Author         string
	Owner          string
	CI             deployIntelCISummary
	ReviewDecision string
	ReviewDetail   string
	Change         *changeRequestRecord
	Environment    string
}

func responsiblePRReviewer(author string, meta *deployIntelOpenPRMeta, change *changeRequestRecord) string {
	author = strings.TrimSpace(author)
	candidates := []string{}
	if meta != nil {
		candidates = append(candidates, meta.Assignees...)
		candidates = append(candidates, meta.RequestedReviewers...)
	}
	if change != nil {
		candidates = append(candidates, change.AssigneeUsername)
	}
	for _, login := range candidates {
		login = strings.TrimSpace(login)
		if login == "" || strings.EqualFold(login, author) {
			continue
		}
		return login
	}
	return ""
}

func finalizeReleaseReadiness(in releaseReadinessInput) *releaseReadiness {
	checks := []releaseReadinessCheck{
		readinessCICheck(in.CI),
		readinessReviewCheck(in.ReviewDecision, in.ReviewDetail),
		readinessSecurityCheck(in.Change),
		readinessChangeApprovalCheck(in.Change),
		readinessWindowCheck(in.Environment, in.Change),
		readinessRollbackCheck(in.Change),
		readinessEvidenceCheck(in.SHA, in.Source, in.EvaluatedAt),
	}
	state, label, reasons := overallReleaseReadiness(checks)
	evaluated := ""
	if !in.EvaluatedAt.IsZero() {
		evaluated = in.EvaluatedAt.UTC().Format(time.RFC3339)
	}
	return &releaseReadiness{
		State:       state,
		Label:       label,
		Note:        releaseReadinessNote,
		SHA:         in.SHA,
		Source:      in.Source,
		EvaluatedAt: evaluated,
		Author:      in.Author,
		Owner:       in.Owner,
		Reasons:     reasons,
		Checks:      checks,
	}
}

func readinessCICheck(ci deployIntelCISummary) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "ci", Label: "Required CI checks"}
	switch {
	case ci.Failed > 0:
		item.State = "failed"
		item.Detail = firstNonEmpty(ci.Label, "Required checks failed.")
	case ci.Pending > 0:
		item.State = "pending"
		item.Detail = firstNonEmpty(ci.Label, "Required checks are still running.")
	case ci.Passed > 0:
		item.State = "passed"
		item.Detail = firstNonEmpty(ci.Label, "Required checks passed.")
		if ci.Skipped > 0 {
			item.Detail = ci.Label + " Skipped checks are not treated as passed."
		}
	case ci.Skipped > 0:
		item.State = "skipped"
		item.Detail = firstNonEmpty(ci.Label, "Required checks were skipped.")
	default:
		item.State = "unavailable"
		item.Detail = "CI status is unavailable for this commit."
	}
	return item
}

func readinessReviewCheck(decision, detail string) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "reviews", Label: "Required reviews"}
	switch strings.ToUpper(strings.TrimSpace(decision)) {
	case "APPROVED":
		item.State = "approved"
		item.Detail = firstNonEmpty(detail, "GitHub review is approved.")
	case "CHANGES_REQUESTED":
		item.State = "failed"
		item.Detail = firstNonEmpty(detail, "Changes were requested on GitHub.")
	case "REVIEW_REQUIRED":
		item.State = "missing"
		item.Detail = firstNonEmpty(detail, "A required GitHub review is missing.")
	default:
		if strings.Contains(strings.ToLower(detail), "approval") && strings.Contains(strings.ToLower(detail), "github") && !strings.Contains(strings.ToLower(detail), "awaiting") && !strings.Contains(strings.ToLower(detail), "no github") {
			item.State = "approved"
			item.Detail = detail
			return item
		}
		if strings.Contains(strings.ToLower(detail), "changes were requested") {
			item.State = "failed"
			item.Detail = detail
			return item
		}
		item.State = "missing"
		item.Detail = firstNonEmpty(detail, "No GitHub reviews yet.")
	}
	return item
}

func readinessSecurityCheck(change *changeRequestRecord) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "security", Label: "Security policy"}
	if change == nil {
		item.State = "unavailable"
		item.Detail = "Scan unavailable for this pull request."
		return item
	}
	status := strings.ToLower(strings.TrimSpace(change.PolicyStatus))
	switch status {
	case "fail", "failed", "blocked", "deny":
		item.State = "failed"
		item.Detail = "Blocking policy findings are recorded on this change."
	case "exception", "accepted", "waived":
		item.State = "approved"
		item.Detail = "An accepted exception is recorded."
	case "pass", "passed", "ok", "allow":
		item.State = "passed"
		item.Detail = "Policy evaluation passed for the recorded commit."
	default:
		item.State = "unavailable"
		item.Detail = "Scan unavailable. Empty coverage is not Secure."
	}
	return item
}

func readinessChangeApprovalCheck(change *changeRequestRecord) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "change", Label: "Change approval"}
	if change == nil {
		item.State = "missing"
		item.Detail = "Not linked. Create or link a change before release approval."
		return item
	}
	cab := strings.ToLower(strings.TrimSpace(change.CABStatus))
	status := strings.ToLower(strings.TrimSpace(change.Status))
	switch {
	case cab == "approved" || status == "authorized" || status == "approved" || status == "scheduled" || status == "implementing" || status == "monitoring" || status == "implemented" || status == "resolved" || status == "closed":
		item.State = "approved"
		item.Detail = firstNonEmpty(change.ChangeNumber, "Change") + " is approved or already in progress."
	case cab == "rejected" || status == "failed" || status == "cancelled":
		item.State = "failed"
		item.Detail = firstNonEmpty(change.ChangeNumber, "Change") + " is not approved."
	default:
		item.State = "pending"
		item.Detail = firstNonEmpty(change.ChangeNumber, "Change") + " is awaiting approval."
	}
	if strings.TrimSpace(change.AssigneeUsername) != "" {
		item.Owner = change.AssigneeUsername
	}
	return item
}

func readinessWindowCheck(environment string, change *changeRequestRecord) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "window", Label: "Deployment window"}
	env := strings.TrimSpace(environment)
	if change != nil && env == "" {
		env = strings.TrimSpace(change.Environment)
	}
	reason := activeFreezeReason()
	if reason != "" && (envEqualsProd(env) || env == "") {
		item.State = "freeze"
		item.Detail = reason
		return item
	}
	if change == nil || strings.TrimSpace(change.Service) == "" || env == "" || (change.CABWindowStart == nil && change.CABWindowEnd == nil) {
		item.State = "unavailable"
		item.Detail = "Not evaluated—select a deployment window"
		return item
	}
	if !windowAllowsChange(*change, time.Now().UTC()) {
		item.State = "conflict"
		item.Detail = "The recorded change window does not allow deployment now."
		return item
	}
	item.State = "allowed"
	item.Detail = "No freeze or maintenance conflict is recorded."
	return item
}

func readinessRollbackCheck(change *changeRequestRecord) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "rollback", Label: "Rollback preparation"}
	if change == nil {
		item.State = "not_applicable"
		item.Detail = "Not applicable until a change is linked."
		return item
	}
	if strings.TrimSpace(change.BackoutPlan) != "" || (change.RollbackPlan != nil && strings.TrimSpace(change.RollbackPlan.PreviousSHA) != "") {
		item.State = "documented"
		item.Detail = "A rollback plan is recorded on the change."
		return item
	}
	item.State = "missing"
	item.Detail = "Rollback plan is missing."
	return item
}

func readinessEvidenceCheck(sha, source string, evaluated time.Time) releaseReadinessCheck {
	item := releaseReadinessCheck{Key: "evidence", Label: "Evidence freshness"}
	when := "Unknown"
	if !evaluated.IsZero() {
		when = evaluated.UTC().Format(time.RFC3339)
	}
	if strings.TrimSpace(sha) == "" {
		item.State = "unavailable"
		item.Detail = "Commit SHA is unknown. Approvals must name the commit they cover."
		return item
	}
	short := sha
	if len(short) > 12 {
		short = short[:12]
	}
	item.State = "passed"
	item.Detail = "Commit " + short + " · " + firstNonEmpty(source, "Unknown source") + " · evaluated " + when
	return item
}

func overallReleaseReadiness(checks []releaseReadinessCheck) (state, label string, reasons []string) {
	blocked := make([]string, 0)
	awaiting := make([]string, 0)
	for _, check := range checks {
		switch check.State {
		case "failed", "blocked", "conflict", "freeze":
			blocked = append(blocked, check.Label+": "+check.Detail)
		case "pending", "skipped", "unavailable", "missing", "awaiting":
			awaiting = append(awaiting, check.Label+": "+check.Detail)
		}
	}
	if len(blocked) > 0 {
		return "blocked", "Blocked", blocked
	}
	if len(awaiting) > 0 {
		return "awaiting_evidence", "Awaiting evidence", awaiting
	}
	return "ready", "Ready for approval", nil
}

func windowAllowsChange(item changeRequestRecord, now time.Time) bool {
	if item.CABWindowStart == nil && item.CABWindowEnd == nil {
		return true
	}
	if item.CABWindowStart != nil && now.Before(item.CABWindowStart.UTC()) {
		return false
	}
	if item.CABWindowEnd != nil && now.After(item.CABWindowEnd.UTC()) {
		return false
	}
	return true
}
