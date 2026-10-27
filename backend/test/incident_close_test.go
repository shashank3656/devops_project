package main

import "testing"

func TestIncidentCloseBlockedReasonRequiresOwnerAndNotes(t *testing.T) {
	owner := 7
	unassigned := requestIncident{ID: 1, Status: "open"}
	if got := incidentCloseBlockedReason(unassigned, "Recovered by rolling back CHG0000123"); got == "" {
		t.Fatal("expected close to be blocked without an owner")
	}
	assigned := requestIncident{ID: 1, Status: "open", OwnerUserID: &owner}
	if got := incidentCloseBlockedReason(assigned, ""); got == "" {
		t.Fatal("expected close to be blocked without recovery notes")
	}
	if got := incidentCloseBlockedReason(assigned, "Closed."); got == "" {
		t.Fatal("expected the default close note to be rejected")
	}
	if got := incidentCloseBlockedReason(assigned, "Service restored after rollback."); got != "" {
		t.Fatalf("unexpected block: %s", got)
	}
}

func TestIncidentHasOwner(t *testing.T) {
	if incidentHasOwner(requestIncident{}) {
		t.Fatal("empty incident should have no owner")
	}
	zero := 0
	if incidentHasOwner(requestIncident{OwnerUserID: &zero}) {
		t.Fatal("owner id 0 is not assigned")
	}
	id := 3
	if !incidentHasOwner(requestIncident{OwnerUserID: &id}) {
		t.Fatal("expected an assigned owner")
	}
}

func TestIncidentOwnerPagePublicOmitsEmails(t *testing.T) {
	page := incidentOwnerPage{
		IncidentNumber: "INC0000001",
		Severity:       "p1",
		Service:        "payments-api",
		Team:           "payments",
		Usernames:      []string{"oncall"},
		Emails:         []string{"hidden@example.com"},
		Paged:          true,
	}
	public := incidentOwnerPagePublic(page)
	if _, ok := public["emails"]; ok {
		t.Fatal("page payload must not include emails")
	}
	count, _ := public["count"].(int)
	if count != 1 {
		t.Fatalf("count = %d", count)
	}
}

func TestListCloudFindingsWithoutDB(t *testing.T) {
	items, err := listCloudFindingsFromDB(authzSubject{}, "open", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty list, got %d", len(items))
	}
}

func TestClipAccessField(t *testing.T) {
	if clipAccessField("  alice  ", 80) != "alice" {
		t.Fatal("expected trimmed username")
	}
	long := stringsRepeat("x", 90)
	if got := clipAccessField(long, 80); len([]rune(got)) != 80 {
		t.Fatalf("clipped length = %d", len([]rune(got)))
	}
}

func stringsRepeat(value string, count int) string {
	out := make([]byte, 0, len(value)*count)
	for i := 0; i < count; i++ {
		out = append(out, value...)
	}
	return string(out)
}
