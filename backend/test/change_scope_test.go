package main

import "testing"

func TestChangeScopeIncomplete(t *testing.T) {
	if !changeScopeIncomplete(changeRequestRecord{Environment: "unspecified"}) {
		t.Fatal("missing project and unspecified environment is incomplete")
	}
	projectID := 4
	if changeScopeIncomplete(changeRequestRecord{ProjectID: &projectID, ProjectName: "Checkout", Environment: "production"}) {
		t.Fatal("catalog project and environment should be complete")
	}
	if !changeScopeIncomplete(changeRequestRecord{ProjectID: &projectID, ProjectName: "Checkout", Environment: "unknown"}) {
		t.Fatal("unknown environment is incomplete")
	}
}

func TestClampChangeStatusToScope(t *testing.T) {
	if got := clampChangeStatusToScope("implementing", nil, "production"); got != "new" {
		t.Fatalf("incomplete implementing should hold at new, got %q", got)
	}
	projectID := 7
	if got := clampChangeStatusToScope("implementing", &projectID, "production"); got != "implementing" {
		t.Fatalf("complete implementing should stay, got %q", got)
	}
	if got := clampChangeStatusToScope("bogus", &projectID, "production"); got != "new" {
		t.Fatalf("unknown status should be new, got %q", got)
	}
}

func TestNormalizeChangeStatusUnknownIsNew(t *testing.T) {
	if normalizeChangeStatus("") != "new" {
		t.Fatal("empty status should be new")
	}
	if normalizeChangeStatus("not-a-status") != "new" {
		t.Fatal("unknown status should be new")
	}
	if normalizeChangeStatus("implementing") != "implementing" {
		t.Fatal("explicit implementing should stay")
	}
}

func TestChangeRequiresCompleteScope(t *testing.T) {
	if !changeRequiresCompleteScope("scheduled") || !changeRequiresCompleteScope("implementing") {
		t.Fatal("execution statuses require scope")
	}
	if changeRequiresCompleteScope("new") || changeRequiresCompleteScope("cancelled") {
		t.Fatal("new and cancelled should not require execution scope")
	}
}

func TestOncallRosterBackup(t *testing.T) {
	if got := oncallRosterBackup(nil, 1); got != 0 {
		t.Fatalf("empty roster backup = %d", got)
	}
	if got := oncallRosterBackup([]int{4}, 1); got != 0 {
		t.Fatalf("single person has no backup, got %d", got)
	}
	roster := []int{4, 9}
	if got := oncallRosterBackup(roster, 1); got != 9 {
		t.Fatalf("day 1 backup = %d", got)
	}
	if got := oncallRosterBackup(roster, 2); got != 4 {
		t.Fatalf("day 2 backup = %d", got)
	}
}
