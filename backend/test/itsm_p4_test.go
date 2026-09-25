package main

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeChangeType(t *testing.T) {
	if normalizeChangeType("") != "standard" || normalizeChangeType("NORMAL") != "normal" {
		t.Fatal("standard/normal mapping")
	}
	if normalizeChangeType("break_fix") != "emergency" {
		t.Fatal("emergency alias")
	}
}

func TestChangeRequiresCAB(t *testing.T) {
	if !changeRequiresCAB("normal", "prod") {
		t.Fatal("normal prod needs CAB")
	}
	if changeRequiresCAB("standard", "prod") || changeRequiresCAB("emergency", "prod") {
		t.Fatal("standard and emergency skip CAB")
	}
}

func TestEmergencyRequiresIncident(t *testing.T) {
	if !emergencyRequiresIncident("emergency", 0, "") {
		t.Fatal("emergency without INC should be rejected")
	}
	if emergencyRequiresIncident("emergency", 0, "INC0000001") || emergencyRequiresIncident("standard", 0, "") {
		t.Fatal("linked emergency or standard should pass")
	}
}

func TestShouldOpenProblemAfterThreeHits(t *testing.T) {
	now := time.Now()
	incidents := []requestIncident{
		{Fingerprint: "pay/5xx", CreatedAt: now.Add(-time.Hour), OccurrenceCount: 1},
		{Fingerprint: "pay/5xx", CreatedAt: now.Add(-2 * time.Hour), OccurrenceCount: 1},
		{Fingerprint: "other", CreatedAt: now.Add(-time.Hour), OccurrenceCount: 5},
	}
	if shouldOpenProblem("pay/5xx", incidents, now) {
		t.Fatal("two hits should not open a problem")
	}
	incidents = append(incidents, requestIncident{Fingerprint: "pay/5xx", CreatedAt: now, OccurrenceCount: 1})
	if !shouldOpenProblem("pay/5xx", incidents, now) {
		t.Fatal("three hits in 14 days should open a problem")
	}
}

func TestCausedByChangeCopy(t *testing.T) {
	started := time.Date(2026, 9, 24, 17, 0, 0, 0, time.UTC)
	change := &changeRequestRecord{ChangeNumber: "CHG0000123", PRNumber: 1842, WatchStartedAt: &started}
	inc := requestIncident{CreatedAt: started.Add(14 * time.Minute)}
	got := causedByChangeCopy(inc, change)
	if got != "This page started 14 min after CHG0000123 (PR 1842)." {
		t.Fatalf("got %q", got)
	}
}

func TestITSMSLAPolicyAndJournalKind(t *testing.T) {
	p1 := slaPolicyForPriority("P1")
	if p1.RespondMinutes != 15 || p1.ResolveMinutes != 4*60 {
		t.Fatalf("p1 sla: %#v", p1)
	}
	p4 := slaPolicyForPriority("p4")
	if p4.RespondMinutes != 8*60 || p4.ResolveMinutes != 5*24*60 {
		t.Fatalf("p4 sla: %#v", p4)
	}
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	respondBy := now.Add(-time.Minute)
	resolveBy := now.Add(2 * time.Hour)
	sla := buildIncidentSLA("p1", &respondBy, &resolveBy, nil, nil, now)
	if !sla.ResponseBreached || sla.ResolveBreached || sla.ResponseRemaining == "" {
		t.Fatalf("expected response breach with resolve remaining, got %#v", sla)
	}
	if formatKBNumber(12) != "KB0000012" {
		t.Fatal("kb number")
	}
	cats := itsmCategoryCatalog()
	if len(cats) < 3 || len(cats[0].Subcategories) == 0 {
		t.Fatal("category catalog")
	}
}

func TestNormalizeITSMPriorityAndIncidentFlow(t *testing.T) {
	if normalizeITSMPriority("P1") != "p1" || itsmPriorityToSeverity("p1") != "critical" {
		t.Fatal("p1 mapping")
	}
	if itsmPriorityFromImpactUrgency("high", "high") != "p1" || itsmPriorityFromImpactUrgency("low", "low") != "p4" {
		t.Fatal("impact/urgency matrix")
	}
	if normalizeIncidentStatus("in progress") != "investigating" || normalizeIncidentStatus("on_hold") != "on_hold" {
		t.Fatal("incident state mapping")
	}
	if normalizeProblemStatus("rca") != "root_cause_analysis" {
		t.Fatal("problem state mapping")
	}
}

func TestNormalizeChangePriorityAndRisk(t *testing.T) {
	if normalizeChangePriority("P1") != "critical" || normalizeChangePriority("") != "medium" {
		t.Fatal("priority mapping")
	}
	if normalizeChangeRisk("HIGH") != "high" || normalizeChangeRisk("") != "medium" {
		t.Fatal("risk mapping")
	}
	if _, _, err := changeWindowTimes(parsedChangeWebhook{PlannedStart: "2026-09-25T18:00", PlannedEnd: "2026-09-25T17:00"}); err == nil {
		t.Fatal("end before start should fail")
	}
}

func TestPrepareManualChangeRequiresTitle(t *testing.T) {
	if _, err := prepareManualChange(parsedChangeWebhook{Title: ""}, "ops"); err == nil {
		t.Fatal("empty title should fail")
	}
	got, err := prepareManualChange(parsedChangeWebhook{Title: "Cutover"}, "ops")
	if err != nil {
		t.Fatal(err)
	}
	if got.Repo != "manual" || !strings.HasPrefix(got.SHA, "manual-") || got.Author != "ops" {
		t.Fatalf("expected generated repo/sha and author, got %#v", got)
	}
	if got.Environment != "unspecified" {
		t.Fatalf("manual change should default environment, got %q", got.Environment)
	}
}

func TestPrepareManualChangeEmergencyNeedsIncident(t *testing.T) {
	if _, err := prepareManualChange(parsedChangeWebhook{Title: "Break fix", Environment: "prod", ChangeType: "emergency"}, "ops"); err == nil {
		t.Fatal("emergency without incident should fail")
	}
	got, err := prepareManualChange(parsedChangeWebhook{Title: "Break fix", Environment: "prod", ChangeType: "emergency", LinkedIncidentNumber: "INC0000001"}, "ops")
	if err != nil || got.ChangeType != "emergency" {
		t.Fatalf("linked emergency should pass: %v %#v", err, got)
	}
}

func TestChangeBriefFromFiles(t *testing.T) {
	brief := changeBriefFromChangeRequest(changeRequestRecord{
		Title:       "Tighten IAM",
		Environment: "prod",
		Files:       []string{"iam/policy.tf", "cmd/api/main.go"},
	})
	if brief == nil || brief.Headline == "" {
		t.Fatal("expected a change brief from files")
	}
}

func TestReleaseNoteItemKeepsTitle(t *testing.T) {
	item := releaseNoteItem{ChangeNumber: "CHG0000001", Title: "Cut timeout"}
	if item.Title == "" || item.ChangeNumber == "" {
		t.Fatal("release note should keep identity")
	}
}
