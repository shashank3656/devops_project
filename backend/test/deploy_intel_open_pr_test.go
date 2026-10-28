package main

import (
	"strings"
	"testing"

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

func TestDeliveryPipelinesHref(t *testing.T) {
	href := deliveryPipelinesHref("acme", "infra-live", 12)
	if !strings.Contains(href, "repo=acme%2Finfra-live") || !strings.Contains(href, "pr=12") {
		t.Fatalf("got %s", href)
	}
}
