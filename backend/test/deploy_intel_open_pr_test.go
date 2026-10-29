package main

import (
	"strings"
	"testing"
	"time"

	"github.com/google/go-github/v61/github"
)

func TestBranchMatchesDeployIntelBase(t *testing.T) {
	if !branchMatchesDeployIntelBase("main", "main") {
		t.Fatal("exact match")
	}
	if !branchMatchesDeployIntelBase("main", "production") {
		t.Fatal("both production aliases")
	}
	if branchMatchesDeployIntelBase("feature/foo", "main") {
		t.Fatal("feature branch should not match production base")
	}
}

func TestOpenPRMatchesFiltersDraft(t *testing.T) {
	pr := &github.PullRequest{Draft: github.Bool(true)}
	opts := openPRListOptions{IncludeDrafts: false}
	if openPRMatchesFilters(pr, opts) {
		t.Fatal("draft excluded")
	}
	opts.IncludeDrafts = true
	if !openPRMatchesFilters(pr, opts) {
		t.Fatal("draft included")
	}
}

func TestGithubCheckOutcomeAndCILabel(t *testing.T) {
	if githubCheckOutcome("failure", "completed") != "failed" {
		t.Fatal("failure is failed")
	}
	if githubCheckOutcome("", "in_progress") != "pending" {
		t.Fatal("in progress is pending")
	}
	if githubCheckOutcome("success", "completed") != "ok" {
		t.Fatal("success is ok")
	}
	label := formatCISummaryLabel(deployIntelCISummary{Failed: 2, Pending: 1, Passed: 3})
	if label != "2 failed · 1 pending · 3 passed" {
		t.Fatalf("got %q", label)
	}
	if formatCISummaryLabel(deployIntelCISummary{}) != "No checks yet" {
		t.Fatal("empty checks stay unknown")
	}
	if !isOpsTrellisCheckName("infragate/plan-review") || isOpsTrellisCheckName("ci / test") {
		t.Fatal("infragate checks stay internal")
	}
}

func TestCISummaryFromRollup(t *testing.T) {
	if ciSummaryFromRollup("SUCCESS").Label != "No checks yet" {
		t.Fatal("rollup SUCCESS without check conclusions is not a pass")
	}
	failing := ciSummaryFromRollup("FAILURE")
	if failing.Label != "Failing" || failing.Failed != 1 {
		t.Fatalf("failure rollup: %#v", failing)
	}
	pending := ciSummaryFromRollup("PENDING")
	if pending.Label != "Pending" || pending.Pending != 1 {
		t.Fatalf("pending rollup: %#v", pending)
	}
	skipped := ciSummaryFromChecks([]deployIntelRequiredCheck{
		{Status: "skipped"}, {Status: "skipped"}, {Status: "skipped"},
		{Status: "skipped"}, {Status: "skipped"}, {Status: "skipped"},
	})
	if skipped.Skipped != 6 || skipped.Passed != 0 || skipped.Label != "6 skipped" {
		t.Fatalf("skipped checks must stay skipped, got %#v", skipped)
	}
}

func TestOverallReleaseReadiness(t *testing.T) {
	blocked, label, reasons := overallReleaseReadiness([]releaseReadinessCheck{
		{Label: "Required CI checks", State: "skipped", Detail: "6 skipped"},
		{Label: "Required reviews", State: "missing", Detail: "No GitHub reviews yet."},
	})
	if blocked != "awaiting_evidence" || label != "Awaiting evidence" || len(reasons) != 2 {
		t.Fatalf("got %s %s %#v", blocked, label, reasons)
	}
	ready, readyLabel, readyReasons := overallReleaseReadiness([]releaseReadinessCheck{
		{Label: "Required CI checks", State: "passed"},
		{Label: "Required reviews", State: "approved"},
		{Label: "Security policy", State: "passed"},
		{Label: "Change approval", State: "approved"},
		{Label: "Deployment window", State: "allowed"},
		{Label: "Rollback preparation", State: "documented"},
		{Label: "Evidence freshness", State: "passed"},
	})
	if ready != "ready" || readyLabel != "Ready for approval" || len(readyReasons) != 0 {
		t.Fatalf("got %s %s %#v", ready, readyLabel, readyReasons)
	}
}

func TestSameCommitSHA(t *testing.T) {
	if !sameCommitSHA("abcdef1234567890", "abcdef1") {
		t.Fatal("short prefix of the same commit must match")
	}
	if sameCommitSHA("abcdef1234567890", "ffffff1234567890") {
		t.Fatal("different commits must not match")
	}
	if evidenceCommitMoved("", "abcdef1234567890") {
		t.Fatal("unknown current SHA is not a moved commit")
	}
	if !evidenceCommitMoved("aaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbb") {
		t.Fatal("different recorded SHA must count as moved")
	}
}

func TestReadinessMissingRequirementsAreActionable(t *testing.T) {
	ready := finalizeReleaseReadiness(releaseReadinessInput{
		SHA:            "abcdef1234567890",
		Source:         "GitHub pull request",
		ReviewDecision: "REVIEW_REQUIRED",
		PRURL:          "https://github.com/acme/app/pull/12",
		PRNumber:       12,
		RepoOwner:      "acme",
		RepoName:       "app",
	})
	actions := map[string]releaseReadinessCheck{}
	for _, check := range ready.Checks {
		actions[check.Key] = check
	}
	if actions["reviews"].ActionLabel != "Assign reviewer" || actions["reviews"].ActionHref != "https://github.com/acme/app/pull/12" {
		t.Fatalf("reviews action = %#v", actions["reviews"])
	}
	if actions["change"].ActionLabel != "Link change" || actions["change"].ActionKey != "link_change" {
		t.Fatalf("change action = %#v", actions["change"])
	}
	if actions["security"].ActionLabel != "Configure security scan" {
		t.Fatalf("security action = %#v", actions["security"])
	}
	if actions["window"].ActionLabel != "Select deployment window" {
		t.Fatalf("window action = %#v", actions["window"])
	}
}

func TestReadinessReevaluatesWhenCommitChanges(t *testing.T) {
	change := &changeRequestRecord{
		ID:           9,
		ChangeNumber: "CHG0000009",
		SHA:          "oldcommitsha0001",
		PolicyStatus: "pass",
		CABStatus:    "approved",
		Status:       "authorized",
		Service:      "checkout",
		Environment:  "prod",
	}
	ready := finalizeReleaseReadiness(releaseReadinessInput{
		SHA:      "newcommitsha0002",
		Source:   "GitHub pull request",
		Change:   change,
		PRURL:    "https://github.com/acme/app/pull/4",
		PRNumber: 4,
	})
	byKey := map[string]releaseReadinessCheck{}
	for _, check := range ready.Checks {
		byKey[check.Key] = check
	}
	if byKey["security"].State != "unavailable" || !strings.Contains(byKey["security"].Detail, "Re-evaluate") {
		t.Fatalf("stale security = %#v", byKey["security"])
	}
	if byKey["change"].State != "pending" || !strings.Contains(byKey["change"].Detail, "Re-evaluate") {
		t.Fatalf("stale approval = %#v", byKey["change"])
	}
	if byKey["evidence"].State != "unavailable" || !strings.Contains(byKey["evidence"].Detail, "Head commit changed") {
		t.Fatalf("stale evidence = %#v", byKey["evidence"])
	}
	if ready.State == "ready" {
		t.Fatal("moved commit must not stay ready")
	}
}

func TestReadinessWindowNotEvaluatedWithoutChange(t *testing.T) {
	item := readinessWindowCheck("prod", nil)
	if item.State != "unavailable" || item.Detail != "Not evaluated—select a deployment window" {
		t.Fatalf("missing change must stay unevaluated: %#v", item)
	}
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)
	ready := readinessWindowCheck("prod", &changeRequestRecord{
		Service:        "checkout",
		Environment:    "prod",
		CABWindowStart: &start,
		CABWindowEnd:   &end,
	})
	if ready.State != "allowed" && ready.State != "conflict" {
		t.Fatalf("complete window must be evaluated: %#v", ready)
	}
}

func TestComputeReviewSLADoesNotAdviseMerge(t *testing.T) {
	status, detail := computeReviewSLA(time.Now().Add(-4*24*time.Hour), "")
	if status != "warning" {
		t.Fatalf("status=%s", status)
	}
	if !strings.Contains(detail, "Review required; release readiness is unconfirmed.") {
		t.Fatalf("detail=%q", detail)
	}
	if strings.Contains(strings.ToLower(detail), "merge") {
		t.Fatalf("SLA copy still advised merge: %q", detail)
	}
}

func TestResponsiblePRReviewerIsNotAuthor(t *testing.T) {
	if got := responsiblePRReviewer("dependabot[bot]", &deployIntelOpenPRMeta{Assignees: []string{"dependabot[bot]"}}, nil); got != "" {
		t.Fatalf("author must not become owner: %q", got)
	}
	if got := responsiblePRReviewer("dependabot[bot]", &deployIntelOpenPRMeta{RequestedReviewers: []string{"platform-review"}}, nil); got != "platform-review" {
		t.Fatalf("requested reviewer = %q", got)
	}
}

func TestDeliveryPipelinesHref(t *testing.T) {
	href := deliveryPipelinesHref("acme", "infra-live", 12)
	if !strings.Contains(href, "repo=acme%2Finfra-live") || !strings.Contains(href, "pr=12") {
		t.Fatalf("got %s", href)
	}
}
