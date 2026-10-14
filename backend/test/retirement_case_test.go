package main

import (
	"testing"
	"time"
)

func retirementFixture(at time.Time) retirementCase {
	return retirementCase{
		ID: "case-1", ProjectID: 1, Service: "checkout",
		ConsumersKnown: true, RetentionDecision: "retain", BackupKnown: true, EvidenceAt: at,
		Resources: []retirementResource{{ID: "logs-bucket", Kind: "resource", Retained: true}},
	}
}

func TestRetirementUnknownConsumerBlocksApproval(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	unknown := retirementFixture(at)
	unknown.ConsumersKnown = false
	if err := reviewRetirement(&unknown, at); err != nil {
		t.Fatal(err)
	}
	if unknown.State != "blocked" || !retirementHasBlocker(unknown, "consumer unknown") {
		t.Fatalf("consumer = %#v", unknown)
	}
	if err := approveRetirement(&unknown, true, true); err != errRetirementInvalid || unknown.Approved {
		t.Fatal("unknown consumer was approved")
	}
	missing := retirementFixture(at)
	missing.RetentionDecision = ""
	if err := reviewRetirement(&missing, at); err != nil {
		t.Fatal(err)
	}
	if missing.State != "blocked" || !retirementHasBlocker(missing, "retention decision missing") || missing.Approved {
		t.Fatalf("retention = %#v", missing)
	}
	stale := retirementFixture(at.Add(-8 * 24 * time.Hour))
	if err := reviewRetirement(&stale, at); err != nil {
		t.Fatal(err)
	}
	if stale.State != "unknown" || stale.State == "healthy" {
		t.Fatalf("stale = %#v", stale)
	}
	backup := retirementFixture(at)
	backup.BackupKnown = false
	if err := reviewRetirement(&backup, at); err != nil {
		t.Fatal(err)
	}
	if backup.State != "unknown" || !retirementHasBlocker(backup, "backup evidence missing") {
		t.Fatalf("backup = %#v", backup)
	}
}

func TestRetirementScopeChangeRequiresPreview(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	item := retirementFixture(at)
	if err := reviewRetirement(&item, at); err != nil || approveRetirement(&item, true, true) != nil {
		t.Fatal("approve")
	}
	changeRetirementScope(&item, []retirementResource{{ID: "logs-bucket", Retained: true}, {ID: "extra-volume", Retained: false}})
	if item.Approved || !item.NeedsPreview {
		t.Fatalf("scope change = %#v", item)
	}
	if err := approveRetirement(&item, true, true); err != errRetirementInvalid {
		t.Fatal("approval skipped the new preview")
	}
	if err := reviewRetirement(&item, at); err != nil {
		t.Fatal(err)
	}
	if item.NeedsPreview || item.Approved {
		t.Fatal("preview did not clear the scope change")
	}
	if err := approveRetirement(&item, false, true); err != errRetirementDenied {
		t.Fatalf("revoked member = %v", err)
	}
	if err := approveRetirement(&item, true, false); err != errRetirementHidden {
		t.Fatalf("other project = %v", err)
	}
}

func TestRetirementFailureDoesNotRepeatVerifiedWork(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	item := retirementFixture(at)
	if err := reviewRetirement(&item, at); err != nil || approveRetirement(&item, true, true) != nil {
		t.Fatal("approve")
	}
	runRetirement(&item, "resource-teardown")
	if item.State != "incomplete" || item.Steps[0].State != "verified" || item.Steps[0].Attempts != 1 || item.Steps[1].State != "failed" || item.Steps[2].State != "pending" {
		t.Fatalf("failed run = %#v", item.Steps)
	}
	runRetirement(&item, "")
	if item.Steps[0].Attempts != 1 || item.Steps[1].State != "verified" || item.Steps[1].Attempts != 1 || item.Steps[2].State != "verified" {
		t.Fatalf("retry = %#v", item.Steps)
	}
	if err := archiveRetirement(&item, true); err != nil {
		t.Fatal(err)
	}
	if !item.HistoryReadable || !item.ProvisioningDenied || item.Resources[0].State != "retained" {
		t.Fatalf("archive = %#v", item)
	}
	for _, resource := range item.Resources {
		if resource.State == "deleted" {
			t.Fatal("a retained resource was reported deleted")
		}
	}
	if _, err := readRetirement(&item, true); err != nil {
		t.Fatal(err)
	}
	if _, err := readRetirement(&item, false); err != errRetirementHidden {
		t.Fatal("archived history was visible to another project")
	}
	if err := provisionRetired(&item, true); err != errRetirementDenied {
		t.Fatalf("new request = %v", err)
	}
}

func retirementHasBlocker(item retirementCase, want string) bool {
	for _, blocker := range item.Blockers {
		if blocker == want {
			return true
		}
	}
	return false
}
