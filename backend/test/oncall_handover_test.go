package main

import (
	"strings"
	"testing"
	"time"
)

func TestHandoverShiftBoundaryUsesTimezoneMidnight(t *testing.T) {
	outgoing, endAt, err := handoverShiftBoundary("2026-10-25", "Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	if outgoing != "2026-10-25" {
		t.Fatalf("outgoing = %s", outgoing)
	}
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	incoming := endAt.In(loc).Format("2006-01-02")
	if incoming != "2026-10-26" {
		t.Fatalf("incoming = %s", incoming)
	}
}

func TestHandoverOvernightDSTStillResolvesNextCalendarDay(t *testing.T) {
	outgoing, endAt, err := handoverShiftBoundary("2026-03-07", "America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	if outgoing != "2026-03-07" {
		t.Fatalf("outgoing = %s", outgoing)
	}
	loc, _ := time.LoadLocation("America/New_York")
	if endAt.In(loc).Format("2006-01-02 15:04") != "2026-03-08 00:00" {
		t.Fatalf("boundary = %s", endAt.In(loc))
	}
}

func TestHandoverFreshnessUnknownWithoutCollection(t *testing.T) {
	if got := handoverFreshness(nil, time.Now()); got != "Unknown" {
		t.Fatalf("freshness = %s", got)
	}
}

func TestCriticalHandoverItemsStayDistinct(t *testing.T) {
	items := []handoverItemView{
		{ID: 1, SourceRef: "INC0000001", Critical: true},
		{ID: 2, SourceRef: "CHG0000001", Critical: false},
	}
	got := criticalHandoverItems(items)
	if len(got) != 1 || got[0].SourceRef != "INC0000001" {
		t.Fatalf("critical = %+v", got)
	}
}

func TestFilterHandoverItemsHidesUnauthorizedProjects(t *testing.T) {
	items := []handoverItemView{
		{ID: 1, ProjectID: 4, Title: "visible"},
		{ID: 2, ProjectID: 9, Title: "hidden"},
	}
	got := filterHandoverItems(items, map[int]struct{}{4: {}}, false)
	if len(got) != 1 || got[0].Title != "visible" {
		t.Fatalf("filtered = %+v", got)
	}
}

func TestHandoverItemKeyPrefersSourceID(t *testing.T) {
	if got := handoverItemKey("incident", 12, "INC0000012"); got != "incident:12" {
		t.Fatalf("key = %s", got)
	}
	if got := handoverItemKey("change", 0, "CHG1"); got != "change:CHG1" {
		t.Fatalf("ref key = %s", got)
	}
}

func TestHandoverIncidentIDsSkipClosedItems(t *testing.T) {
	ids := handoverIncidentIDs([]handoverItemView{
		{SourceType: "incident", SourceID: 4, State: "open"},
		{SourceType: "incident", SourceID: 5, State: "resolved"},
		{SourceType: "change", SourceID: 9, State: "open"},
		{SourceType: "incident", SourceID: 4, State: "investigating"},
	})
	if len(ids) != 1 || ids[0] != 4 {
		t.Fatalf("ids = %v", ids)
	}
}

func TestHandoverShouldReassignHonorsExplicitChoice(t *testing.T) {
	on := true
	off := false
	if !handoverShouldReassignIncidents(&on, 0, 0) {
		t.Fatal("explicit true must reassign")
	}
	if handoverShouldReassignIncidents(&off, 0, 0) {
		t.Fatal("explicit false must leave assignment unchanged")
	}
	if handoverShouldReassignIncidents(nil, 0, 0) {
		t.Fatal("missing schedule policy must not reassign")
	}
}

func TestIncidentReassignmentNoteKeepsStatusUnchanged(t *testing.T) {
	got := incidentReassignmentNote("Ada", "Lin", 12)
	if !strings.Contains(got, "status was not changed") {
		t.Fatalf("note = %s", got)
	}
}

func TestHandoverPolicyClampsTeamWindows(t *testing.T) {
	if got := handoverRemindMinutes(0); got != 30 {
		t.Fatalf("default remind = %d", got)
	}
	if got := handoverEscalateMinutes(0); got != 15 {
		t.Fatalf("default escalate = %d", got)
	}
	if got := handoverRemindMinutes(5); got != 5 {
		t.Fatalf("min remind = %d", got)
	}
	if got := handoverRemindMinutes(200); got != 120 {
		t.Fatalf("max remind = %d", got)
	}
	if got := handoverEscalateMinutes(45); got != 45 {
		t.Fatalf("custom escalate = %d", got)
	}
}

func TestHandoverReminderHonorsAlertToggle(t *testing.T) {
	settings := defaultOpsNotificationSettings()
	if !isOpsNotificationCategoryEnabled(settings, "oncall_handover_reminder") {
		t.Fatal("handover reminders default on")
	}
	settings.NotifyHandovers = false
	if isOpsNotificationCategoryEnabled(settings, "oncall_handover_reminder") {
		t.Fatal("handover reminder toggle must suppress draft emails")
	}
}
