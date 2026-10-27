package main

import (
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
