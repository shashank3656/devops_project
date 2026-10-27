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
	passing := ciSummaryFromRollup("SUCCESS")
	if passing.Label != "Passing" || passing.Passed != 1 {
		t.Fatalf("success rollup: %#v", passing)
	}
	failing := ciSummaryFromRollup("FAILURE")
	if failing.Label != "Failing" || failing.Failed != 1 {
		t.Fatalf("failure rollup: %#v", failing)
	}
	pending := ciSummaryFromRollup("PENDING")
	if pending.Label != "Pending" || pending.Pending != 1 {
		t.Fatalf("pending rollup: %#v", pending)
	}
	if ciSummaryFromRollup("").Label != "No checks yet" {
		t.Fatal("empty rollup stays unknown")
	}
}

func TestDeliveryPipelinesHref(t *testing.T) {
	href := deliveryPipelinesHref("acme", "infra-live", 12)
	if !strings.Contains(href, "repo=acme%2Finfra-live") || !strings.Contains(href, "pr=12") {
		t.Fatalf("got %s", href)
	}
}
