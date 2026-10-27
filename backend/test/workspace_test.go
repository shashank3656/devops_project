package main

import (
	"database/sql"
	"net/http"
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
		{"devops", true, "/tickets?status=pending_devops_approval&id=7"},
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
	if payload.NeedsYou == nil || payload.Failed == nil || payload.Activity == nil || payload.Pipeline.Stages == nil {
		t.Fatal("slices must be non-nil so JSON encodes [] not null")
	}
}

func TestWorkspaceDeliveryClassification(t *testing.T) {
	if !workspaceChangeIsFailed("FAILED") {
		t.Fatal("failed CHG must be classified as failed")
	}
	if workspaceChangeNeedsAction("failed") {
		t.Fatal("failed CHG must not stay in the action queue")
	}
	if !workspaceChangeNeedsAction("implementing") || !workspaceChangeNeedsAction("monitoring") {
		t.Fatal("active CHGs must stay in the action queue")
	}
	if !workspaceDeliveryIsFailed("apply_failed") || !workspaceDeliveryIsFailed("plan_failed") {
		t.Fatal("failed CI statuses must be classified as failed")
	}
	if workspaceDeliveryIsFailed("in_progress") {
		t.Fatal("in-progress tickets are not failed deliveries")
	}
	if !workspaceDeliveryIsBlocked("blocked") || !workspaceDeliveryIsBlocked("promotion_blocked") {
		t.Fatal("blocked promotions must be classified as blocked")
	}
}

func TestWorkspaceIncidentHref(t *testing.T) {
	if got := workspaceIncidentHref(42); got != "/incidents?mine=1" {
		t.Fatalf("workspaceIncidentHref(42) = %q", got)
	}
	if got := workspaceIncidentHref(0); got != "/incidents" {
		t.Fatalf("workspaceIncidentHref(0) = %q", got)
	}
}

func TestIncidentNeedsViewerAction(t *testing.T) {
	owner := 9
	assigned := requestIncident{OwnerUserID: &owner}
	if !incidentNeedsViewerAction(assigned, "user", 9) {
		t.Fatal("assigned incident should appear on the owner home")
	}
	if incidentNeedsViewerAction(assigned, "user", 3) {
		t.Fatal("another user's incident should not appear on User Home")
	}
	unassigned := requestIncident{}
	if incidentNeedsViewerAction(unassigned, "user", 9) {
		t.Fatal("unassigned incidents are not User Home actions")
	}
	if !incidentNeedsViewerAction(unassigned, "devops", 9) {
		t.Fatal("unassigned incidents need DevOps action")
	}
}

func TestChangeNeedsViewerAction(t *testing.T) {
	assignee := 4
	item := changeRequestRecord{AssigneeUserID: &assignee}
	if !changeNeedsViewerAction(item, "user", 1) {
		t.Fatal("users still see visible CHGs they own via project scope")
	}
	if !changeNeedsViewerAction(item, "devops", 4) {
		t.Fatal("assigned CHG should appear on DevOps Home")
	}
	if changeNeedsViewerAction(item, "devops", 8) {
		t.Fatal("another operator's CHG should not appear in Needs my action")
	}
	if !changeNeedsViewerAction(changeRequestRecord{}, "devops", 8) {
		t.Fatal("unassigned CHGs need an owner")
	}
}

func TestAppendProjectIDRestriction(t *testing.T) {
	query, args, pos := appendProjectIDRestriction("WHERE 1=1", nil, 1, nil)
	if query != "WHERE 1=1" || len(args) != 0 || pos != 1 {
		t.Fatalf("nil restriction = %q %#v %d", query, args, pos)
	}
	query, _, _ = appendProjectIDRestriction("WHERE 1=1", nil, 1, []int{})
	if query != "WHERE 1=1 AND FALSE" {
		t.Fatalf("empty restriction = %q", query)
	}
	query, args, pos = appendProjectIDRestriction("WHERE 1=1", nil, 1, []int{3, 9})
	if query != "WHERE 1=1 AND r.project_id IN ($1,$2)" || len(args) != 2 || args[0] != 3 || args[1] != 9 || pos != 3 {
		t.Fatalf("ids restriction = %q %#v %d", query, args, pos)
	}
}

func TestRequestQueryEnvPrefersEnvironmentAlias(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/api/devops/requests?env=dev&environment=prod", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := requestQueryEnv(req); got != "prod" {
		t.Fatalf("requestQueryEnv = %q", got)
	}
	req, err = http.NewRequest(http.MethodGet, "/api/history?env=uat", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := requestQueryEnv(req); got != "uat" {
		t.Fatalf("requestQueryEnv env-only = %q", got)
	}
}

func TestCapWorkspaceQueue(t *testing.T) {
	items := []workspaceQueueItem{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	got := capWorkspaceQueue(items, 2)
	if len(got) != 2 || got[0].ID != "a" {
		t.Fatalf("unexpected cap: %+v", got)
	}
}
