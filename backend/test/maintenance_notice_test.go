package main

import (
	"testing"
	"time"
)

func maintenanceFixture(at time.Time) maintenanceNotice {
	return maintenanceNotice{
		ID: "notice-1", ProjectID: 1, Service: "checkout", Timezone: "America/New_York",
		Impact: "checkout writes pause", Body: "Planned maintenance for checkout.", Owner: "Ada",
		ChangeID: "change-9", IncidentID: "incident-4",
		Start: at, End: at.Add(2 * time.Hour), IncidentOpen: true, ChangeOpen: true,
	}
}

func TestMaintenancePrivateNoticeStaysHidden(t *testing.T) {
	notice := maintenanceFixture(time.Date(2026, 3, 8, 1, 0, 0, 0, time.UTC))
	if _, err := readMaintenance(&notice, false); err != errMaintenanceHidden {
		t.Fatalf("guessed read = %v", err)
	}
	notices := []maintenanceNotice{notice}
	if len(searchMaintenance(notices, 1, false)) != 0 {
		t.Fatal("search returned a private notice")
	}
	if len(searchMaintenance(notices, 1, true)) != 1 {
		t.Fatal("allowed search hid the notice")
	}
	if len(searchMaintenance(notices, 2, true)) != 0 {
		t.Fatal("another project export returned the notice")
	}
}

func TestMaintenanceApprovalAudienceAndOnePublication(t *testing.T) {
	at := time.Date(2026, 3, 8, 1, 0, 0, 0, time.UTC)
	notice := maintenanceFixture(at)
	subscribers := []maintenanceSubscriber{{Service: "checkout", OptedOut: false}, {Service: "checkout", OptedOut: true}}
	if err := reviewMaintenance(&notice, nil, subscribers); err != nil {
		t.Fatal(err)
	}
	if notice.AudienceCount != 1 {
		t.Fatalf("opt-out count = %d", notice.AudienceCount)
	}
	if err := approveMaintenance(&notice, subscribers, true, true); err != nil {
		t.Fatal(err)
	}
	subscribers[0].OptedOut = true
	if err := reviewMaintenance(&notice, nil, subscribers); err != nil {
		t.Fatal(err)
	}
	if notice.Approved || notice.AudienceCount != 0 {
		t.Fatalf("audience change stayed approved: %#v", notice)
	}
	notice = maintenanceFixture(at)
	if err := reviewMaintenance(&notice, nil, nil); err != nil || approveMaintenance(&notice, nil, true, true) != nil {
		t.Fatal("approve")
	}
	if err := publishMaintenance(&notice, "notice-1", false, true, true); err != nil {
		t.Fatal(err)
	}
	if err := publishMaintenance(&notice, "notice-1", false, true, true); err != nil {
		t.Fatal(err)
	}
	if notice.Publications != 1 || notice.Delivery != "sent" {
		t.Fatalf("duplicate publication = %#v", notice)
	}
	notice.Body = "Updated impact for checkout."
	if err := reviewMaintenance(&notice, nil, nil); err != nil {
		t.Fatal(err)
	}
	if notice.Approved || notice.State != "corrected" || notice.Correction == "" {
		t.Fatalf("content change = %#v", notice)
	}
	failed := maintenanceFixture(at)
	failed.ID = "notice-2"
	if err := reviewMaintenance(&failed, nil, nil); err != nil || approveMaintenance(&failed, nil, true, true) != nil {
		t.Fatal("approve failed path")
	}
	if err := publishMaintenance(&failed, "notice-2", true, true, true); err != nil {
		t.Fatal(err)
	}
	if failed.Delivery != "failed" || failed.Publications != 1 {
		t.Fatalf("provider failure = %#v", failed)
	}
	if err := publishMaintenance(&failed, "notice-2", false, false, true); err != errMaintenanceDenied {
		t.Fatalf("revoked member = %v", err)
	}
	if err := publishMaintenance(&failed, "notice-2", false, true, false); err != errMaintenanceHidden {
		t.Fatalf("other project = %v", err)
	}
}

func TestMaintenanceOverlapCancelKeepsLinkedRecords(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 8, 0, 0, 0, 0, location)
	notice := maintenanceFixture(start)
	notice.End = time.Date(2026, 3, 8, 4, 0, 0, 0, location)
	other := maintenanceWindow{Service: "checkout", Timezone: "America/New_York", Start: time.Date(2026, 3, 8, 3, 0, 0, 0, location), End: time.Date(2026, 3, 8, 6, 0, 0, 0, location)}
	if !maintenanceOverlaps(maintenanceWindow{Service: notice.Service, Start: notice.Start, End: notice.End}, other) {
		t.Fatal("expected an overlap")
	}
	if err := reviewMaintenance(&notice, []maintenanceWindow{other}, nil); err != nil {
		t.Fatal(err)
	}
	if notice.Overlap == "" {
		t.Fatal("overlap warning was hidden")
	}
	if err := approveMaintenance(&notice, nil, true, true); err != nil {
		t.Fatal(err)
	}
	if err := cancelMaintenance(&notice, true, true); err != nil {
		t.Fatal(err)
	}
	if notice.State != "cancelled" || notice.Correction == "" || !notice.IncidentOpen || !notice.ChangeOpen {
		t.Fatalf("cancel = %#v", notice)
	}
	if _, err := readMaintenance(&notice, true); err != nil {
		t.Fatal(err)
	}
}
