package main

import (
	"testing"
	"time"
)

func TestPRAwaitingOwner(t *testing.T) {
	if !prAwaitingOwner(nil) {
		t.Fatal("missing review meta is awaiting an owner")
	}
	if !prAwaitingOwner(&deployIntelOpenPRMeta{ReviewDecision: "REVIEW_REQUIRED"}) {
		t.Fatal("review required with no reviewers is awaiting")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{Assignees: []string{"alex"}}) {
		t.Fatal("assigned PR is not awaiting an owner")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{RequestedReviewers: []string{"sam"}}) {
		t.Fatal("requested reviewer is not awaiting an owner")
	}
	if prAwaitingOwner(&deployIntelOpenPRMeta{ReviewDecision: "APPROVED"}) {
		t.Fatal("approved PR is not awaiting an owner")
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
	if !summary.DelayKnown || summary.MedianApprovalDelay < 2 {
		t.Fatalf("approval delay should be known: %#v", summary)
	}
	if len(summary.Teams) != 2 {
		t.Fatalf("teams: %#v", summary.Teams)
	}
	if events[0].OpenPR.AwaitingOwner == false {
		t.Fatal("unassigned overdue PR should await an owner")
	}
}
