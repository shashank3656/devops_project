package main

import (
	"testing"
	"time"
)

func TestChangeIsInWatchWindow(t *testing.T) {
	now := time.Date(2026, 9, 24, 18, 0, 0, 0, time.UTC)
	until := now.Add(30 * time.Minute)
	watching := changeRequestRecord{Status: "implemented", WatchUntil: &until, CreatedAt: now.Add(-time.Hour), WatchMinutes: 120}
	if !changeIsInWatchWindow(watching, now) {
		t.Fatal("implemented change inside watch_until should be watched")
	}
	closed := watching
	closed.Status = "closed"
	if changeIsInWatchWindow(closed, now) {
		t.Fatal("closed change should not be watched")
	}
	stale := changeRequestRecord{Status: "implementing", CreatedAt: now.Add(-3 * time.Hour), WatchMinutes: 120}
	if changeIsInWatchWindow(stale, now) {
		t.Fatal("change older than watch_minutes should not be watched")
	}
}

func TestPickSuspectedChangeRequiresServiceOrEnvOverlap(t *testing.T) {
	now := time.Now()
	until := now.Add(time.Hour)
	projectID := 9
	candidates := []changeRequestRecord{
		{ID: 1, Service: "other-api", Environment: "prod", Status: "implemented", WatchUntil: &until, CreatedAt: now.Add(-10 * time.Minute)},
		{ID: 2, Service: "payments-api", Environment: "prod", Status: "implemented", WatchUntil: &until, CreatedAt: now.Add(-5 * time.Minute), ProjectID: &projectID},
	}
	got := pickSuspectedChange(candidates, "payments-api", "prod", &projectID, now)
	if got == nil || got.ID != 2 {
		t.Fatalf("expected change 2, got %+v", got)
	}
	if pickSuspectedChange(candidates, "unrelated", "dev", nil, now) != nil {
		t.Fatal("unrelated service/env should not match")
	}
}

func TestIncidentBlocksPromotion(t *testing.T) {
	if !incidentBlocksPromotion(requestIncident{Source: "ticket", Status: "open", Severity: "low"}) {
		t.Fatal("open ticket incidents still block")
	}
	if incidentBlocksPromotion(requestIncident{Source: "alert", Status: "open", Severity: "medium"}) {
		t.Fatal("medium alert should not block")
	}
	if !incidentBlocksPromotion(requestIncident{Source: "alert", Status: "open", Severity: "critical"}) {
		t.Fatal("SEV1 alert should block")
	}
	if incidentBlocksPromotion(requestIncident{Source: "alert", Status: "resolved", Severity: "critical"}) {
		t.Fatal("resolved SEV1 should not block")
	}
	if !incidentBlocksPromotion(requestIncident{Source: "alert", Status: "acknowledged", Severity: "critical"}) {
		t.Fatal("acknowledged SEV1 should still block")
	}
	if incidentBlocksPromotion(requestIncident{Source: "ticket", Status: "closed", Severity: "low"}) {
		t.Fatal("closed ticket incidents should not block")
	}
}

func TestRunbookMatchesService(t *testing.T) {
	if !runbookMatchesService("payments-api", "payments-api") {
		t.Fatal("exact match")
	}
	if !runbookMatchesService("payments", "payments-api") {
		t.Fatal("partial match")
	}
	if runbookMatchesService("checkout", "payments-api") {
		t.Fatal("other service should not match")
	}
}

func TestShouldAutoResolveStillSkipsSEV1(t *testing.T) {
	if shouldAutoResolveAlert("critical", "resolved") {
		t.Fatal("P1 regression: SEV1 must stay open")
	}
}
