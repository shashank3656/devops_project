package main

import "testing"

func TestChangeVisibleToUserRequiresProject(t *testing.T) {
	allowed := map[int]struct{}{7: {}}
	if changeVisibleToUser(changeRequestRecord{ID: 1}, allowed) {
		t.Fatal("unmapped change must stay hidden from the user portal")
	}
	projectID := 7
	if !changeVisibleToUser(changeRequestRecord{ID: 2, ProjectID: &projectID}, allowed) {
		t.Fatal("change on a visible project should appear")
	}
	other := 9
	if changeVisibleToUser(changeRequestRecord{ID: 3, ProjectID: &other}, allowed) {
		t.Fatal("change on another project must stay hidden")
	}
}

func TestIncidentVisibleToUserAssignedOrProject(t *testing.T) {
	allowed := map[int]struct{}{4: {}}
	owner := 22
	if !incidentVisibleToUser(requestIncident{ID: 1, OwnerUserID: &owner}, 22, allowed) {
		t.Fatal("assigned incident should be visible even without a project")
	}
	projectID := 4
	if !incidentVisibleToUser(requestIncident{ID: 2, ProjectID: &projectID}, 99, allowed) {
		t.Fatal("incident on a visible project should appear")
	}
	if incidentVisibleToUser(requestIncident{ID: 3}, 99, allowed) {
		t.Fatal("unassigned incident with no project must stay hidden")
	}
}

func TestFilterIncidentsForPortal(t *testing.T) {
	projectID := 4
	items := []requestIncident{
		{ID: 1, ProjectID: &projectID, Environment: "dev", Source: "alert", Summary: "latency", IncidentNumber: "INC0000001"},
		{ID: 2, ProjectID: &projectID, Environment: "prod", Source: "ticket", Summary: "help", IncidentNumber: "INC0000002"},
	}
	got := filterIncidentsForPortal(items, 4, "dev", "alert", "latency")
	if len(got) != 1 || got[0].ID != 1 {
		t.Fatalf("expected the matching alert, got %#v", got)
	}
}
