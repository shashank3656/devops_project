package main

import (
	"testing"
	"time"
)

func TestPRAwaitingOwner(t *testing.T) {
	if !prAwaitingOwner(nil, "") {
		t.Fatal("missing review meta is awaiting a reviewer")
	}
	if !prAwaitingOwner(&deployIntelOpenPRMeta{ReviewDecision: "REVIEW_REQUIRED"}, "dependabot[bot]") {
		t.Fatal("review required with no reviewers is awaiting")
	}
	if !prAwaitingOwner(&deployIntelOpenPRMeta{Assignees: []string{"dependabot[bot]"}}, "dependabot[bot]") {
		t.Fatal("author-only assignee is still awaiting a reviewer")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{Assignees: []string{"alex"}}, "dependabot[bot]") {
		t.Fatal("assigned PR is not awaiting a reviewer")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{RequestedReviewers: []string{"sam"}}, "lee") {
		t.Fatal("requested reviewer is not awaiting a reviewer")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{ReviewDecision: "APPROVED"}, "lee") {
		t.Fatal("approved PR is not awaiting a reviewer")
	}
}

func TestPRApprovalDelayRequiresFirstApproval(t *testing.T) {
	created := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	if days, ok := prApprovalDelayDays(repoDeployEvent{OpenPR: &deployIntelOpenPRMeta{AgeDays: 4, ReviewDecision: "REVIEW_REQUIRED", CreatedAt: &created}}); ok || days != 0 {
		t.Fatalf("unreviewed PR must not count: days=%d ok=%v", days, ok)
	}
	approved := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	days, ok := prApprovalDelayDays(repoDeployEvent{OpenPR: &deployIntelOpenPRMeta{CreatedAt: &created, FirstApprovedAt: &approved}})
	if !ok || days != 4 {
		t.Fatalf("first-approval delay = %d ok=%v", days, ok)
	}
}

func TestReviewBottleneckSummaryNoApprovalsYet(t *testing.T) {
	summary := buildReviewBottleneckSummary([]repoDeployEvent{{
		RepoName: "checkout",
		OpenPR:   &deployIntelOpenPRMeta{AgeDays: 4, ReviewDecision: "REVIEW_REQUIRED"},
	}})
	if summary.DelayKnown || summary.ApprovalSample != 0 || summary.MedianApprovalDelay != 0 {
		t.Fatalf("unreviewed PRs must show no approvals yet: %#v", summary)
	}
}

func TestReviewBottleneckSummary(t *testing.T) {
	created := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	approved := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	events := []repoDeployEvent{
		{
			RepoName: "checkout",
			OpenPR: &deployIntelOpenPRMeta{
				AgeDays: 8, ReviewSLA: "breach", ReviewDecision: "REVIEW_REQUIRED",
			},
		},
		{
			RepoName: "checkout",
			OpenPR: &deployIntelOpenPRMeta{
				AgeDays: 3, ReviewSLA: "warning", ReviewDecision: "APPROVED",
				CreatedAt: &created, FirstApprovedAt: &approved,
			},
		},
		{
			RepoName: "billing",
			OpenPR: &deployIntelOpenPRMeta{
				AgeDays: 1, ReviewSLA: "ok", Assignees: []string{"lee"},
			},
		},
	}
	summary := buildReviewBottleneckSummary(events)
	if summary.Open != 3 || summary.AwaitingOwner != 1 || summary.Overdue != 1 {
		t.Fatalf("got open=%d awaiting=%d overdue=%d", summary.Open, summary.AwaitingOwner, summary.Overdue)
	}
	if !summary.DelayKnown || summary.MedianApprovalDelay != 3 || summary.ApprovalSample != 1 {
		t.Fatalf("approval delay should use the first-approval sample only: %#v", summary)
	}
	if len(summary.Teams) != 2 {
		t.Fatalf("teams: %#v", summary.Teams)
	}
	if events[0].OpenPR.AwaitingOwner == false {
		t.Fatal("unassigned overdue PR should await a reviewer")
	}
}
