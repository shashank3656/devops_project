package main

import (
	"testing"
	"time"
)

func TestClassifyChangeRiskScore(t *testing.T) {
	t.Parallel()

	tests := []struct {
		score int
		want  string
	}{
		{score: 0, want: "low"},
		{score: 34, want: "low"},
		{score: 35, want: "medium"},
		{score: 64, want: "medium"},
		{score: 65, want: "high"},
		{score: 100, want: "high"},
	}

	for _, test := range tests {
		if got := classifyChangeRiskScore(test.score); got != test.want {
			t.Fatalf("classifyChangeRiskScore(%d) = %q, want %q", test.score, got, test.want)
		}
	}
}

func TestSortIncidentWorkspaceTimeline(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, time.March, 20, 9, 0, 0, 0, time.UTC)
	events := []incidentWorkspaceTimelineEvent{
		{Key: "b", Timestamp: base.Add(2 * time.Hour)},
		{Key: "c", Timestamp: base},
		{Key: "a", Timestamp: base},
	}

	sortIncidentWorkspaceTimeline(events)

	wantOrder := []string{"a", "c", "b"}
	for index, want := range wantOrder {
		if events[index].Key != want {
			t.Fatalf("timeline order[%d] = %q, want %q", index, events[index].Key, want)
		}
	}
}

func TestIsRollbackEligibleStatus(t *testing.T) {
	t.Parallel()

	if !isRollbackEligibleStatus("completed") {
		t.Fatal("completed status should be eligible for rollback")
	}
	if !isRollbackEligibleStatus("in_progress") {
		t.Fatal("in_progress status should be eligible for rollback")
	}
	if isRollbackEligibleStatus("draft") {
		t.Fatal("draft status should not be eligible for rollback")
	}
	if isRollbackEligibleStatus("pending_approval") {
		t.Fatal("pending_approval status should not be eligible for rollback")
	}
}
