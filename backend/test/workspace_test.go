package main

import (
	"database/sql"
	"testing"
	"time"
)

func TestWorkspaceStatusPhrase(t *testing.T) {
	cases := map[string]string{
		"pending_user_manager_approval": "waiting on manager",
		"pending_devops_approval":       "waiting on DevOps",
		"pending_approval":              "waiting on DevOps",
		"in_progress":                   "being provisioned",
		"COMPLETED":                     "completed",
		"":                              "updated",
		"needs_changes":                 "needs changes",
	}
	for status, want := range cases {
		if got := workspaceStatusPhrase(status); got != want {
			t.Errorf("workspaceStatusPhrase(%q) = %q, want %q", status, got, want)
		}
	}
}

func TestWorkspaceRequestHref(t *testing.T) {
	cases := []struct {
		portal   string
		approval bool
		want     string
	}{
		{"user", true, "/history?id=7"},
		{"user", false, "/history?id=7"},
		{"admin", true, "/approval-center"},
		{"admin", false, "/requests?id=7"},
		{"devops", true, "/approval-center"},
		{"devops", false, "/tickets?id=7"},
	}
	for _, tc := range cases {
		if got := workspaceRequestHref(tc.portal, 7, tc.approval); got != tc.want {
			t.Errorf("workspaceRequestHref(%q, 7, %v) = %q, want %q", tc.portal, tc.approval, got, tc.want)
		}
	}
}

func TestSortWorkspaceActivityNewestFirstAndCapped(t *testing.T) {
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	events := []workspaceActivity{
		{ID: "old", sortAt: base.Add(-2 * time.Hour)},
		{ID: "new", sortAt: base},
		{ID: "mid", sortAt: base.Add(-1 * time.Hour)},
	}
	got := sortWorkspaceActivity(events, 2)
	if len(got) != 2 || got[0].ID != "new" || got[1].ID != "mid" {
		t.Fatalf("unexpected order: %+v", got)
	}
}

func TestWorkspaceTime(t *testing.T) {
	if got := workspaceTime(sql.NullTime{}); got != "" {
		t.Fatalf("invalid time should be empty, got %q", got)
	}
	ts := time.Date(2026, 9, 23, 10, 30, 0, 0, time.FixedZone("IST", 19800))
	if got := workspaceTime(sql.NullTime{Time: ts, Valid: true}); got != "2026-09-23T05:00:00Z" {
		t.Fatalf("workspaceTime = %q", got)
	}
}

func TestTruncateWorkspaceText(t *testing.T) {
	if got := truncateWorkspaceText("  short  ", 10); got != "short" {
		t.Fatalf("got %q", got)
	}
	if got := truncateWorkspaceText("abcdefghij", 5); got != "abcd…" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildWorkspacePayloadWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()

	payload := buildWorkspacePayload("devops", "", 0)
	if payload.Title != "Operations queue" {
		t.Fatalf("title = %q", payload.Title)
	}
	if payload.NeedsYou == nil || payload.Activity == nil || payload.Pipeline.Stages == nil {
		t.Fatal("slices must be non-nil so JSON encodes [] not null")
	}
}
