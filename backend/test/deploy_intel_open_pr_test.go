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
