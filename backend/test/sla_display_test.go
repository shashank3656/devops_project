package main

import (
	"testing"
	"time"
)

func TestFormatSLARemainingCollapsesOldBreaches(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-80 * time.Hour)
	if got := formatSLARemaining(&stale, now); got != "stale" {
		t.Fatalf("80h breach = %q, want stale", got)
	}
	recent := now.Add(-2 * time.Hour)
	if got := formatSLARemaining(&recent, now); got != "breached 2h ago" {
		t.Fatalf("2h breach = %q", got)
	}
	soon := now.Add(30 * time.Minute)
	if got := formatSLARemaining(&soon, now); got != "30m left" {
		t.Fatalf("30m left = %q", got)
	}
}

func TestDueStatusMarksStaleAfter72Hours(t *testing.T) {
	now := time.Now()
	stale := now.Add(-80 * time.Hour)
	if got := dueStatus(&stale); got != "stale" {
		t.Fatalf("stale due = %q", got)
	}
	overdue := now.Add(-4 * time.Hour)
	if got := dueStatus(&overdue); got != "overdue" {
		t.Fatalf("overdue due = %q", got)
	}
	soon := now.Add(6 * time.Hour)
	if got := dueStatus(&soon); got != "due_soon" {
		t.Fatalf("due soon = %q", got)
	}
	later := now.Add(48 * time.Hour)
	if got := dueStatus(&later); got != "" {
		t.Fatalf("later due = %q", got)
	}
}
