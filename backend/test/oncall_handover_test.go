package main

import (
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
