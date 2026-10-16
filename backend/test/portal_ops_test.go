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

func TestListAndDetailStayInsideTheGrant(t *testing.T) {
	projectID := 7
	otherID := 9
	subject := authzSubject{
		UserID:         4,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Role:           "operator",
			Environments:   []string{"dev"},
		}},
	}
	own := changeRequestRecord{ID: 2, ChangeNumber: "CHG-15", ProjectID: &projectID, Environment: "dev"}
	other := changeRequestRecord{ID: 3, ChangeNumber: "CHG-15", ProjectID: &otherID, Environment: "dev"}
	listed := filterChangesInScope([]changeRequestRecord{own, other}, subject)
	if len(listed) != 1 || listed[0].ID != 2 {
		t.Fatalf("list kept %#v", listed)
	}
	if changeInScope(subject, other, authzRead) {
		t.Fatal("detail of the same change number in another project must be denied")
	}

	called := false
	err := runChangeAction(subject, other, func() error {
		called = true
		return nil
	})
	if err == nil || called {
		t.Fatal("denied change write must not run")
	}
	if err := runChangeAction(subject, own, func() error { return nil }); err != nil {
		t.Fatalf("granted write returned %v", err)
	}

	owner := 4
	incidentOther := requestIncident{ID: 8, IncidentNumber: "INC-8", OwnerUserID: &owner, ProjectID: &otherID, Environment: "dev"}
	if incidentInScope(subject, incidentOther, authzRead) {
		t.Fatal("owning an incident in another project must not reveal it")
	}
}

func TestDoubledChangeWebhookPathCollapses(t *testing.T) {
	if got := canonicalWebhookPath("/api/webhooks/change/api/webhooks/change"); got != "/api/webhooks/change" {
		t.Fatalf("doubled change path = %s", got)
	}
	if got := canonicalWebhookPath("/api/webhooks/change"); got != "/api/webhooks/change" {
		t.Fatalf("plain change path = %s", got)
	}
}

func TestAdminAndOperatorListsUseTheSameMatrix(t *testing.T) {
	projectID := 7
	otherID := 9
	own := changeRequestRecord{ID: 2, ChangeNumber: "CHG-15", ProjectID: &projectID, Environment: "dev"}
	other := changeRequestRecord{ID: 3, ChangeNumber: "CHG-15", ProjectID: &otherID, Environment: "prod"}
	unscoped := changeRequestRecord{ID: 4, ChangeNumber: "CHG-15"}
	operator := authzSubject{
		UserID:         4,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Role:           "operator",
			Environments:   []string{"*"},
		}},
	}
	admin := portalAdminSubject(8)
	operatorList := filterChangesInScope([]changeRequestRecord{own, other, unscoped}, operator)
	if len(operatorList) != 1 || operatorList[0].ID != 2 {
		t.Fatalf("operator list = %#v", operatorList)
	}
	adminList := filterChangesInScope([]changeRequestRecord{own, other, unscoped}, admin)
	if len(adminList) != 3 {
		t.Fatalf("admin list = %#v", adminList)
	}
	if changeInScope(admin, unscoped, authzWrite) {
		t.Fatal("admin write must not run for a change with no project")
	}
}

func TestAdminRoleSubjectSeesIncidentsAndChanges(t *testing.T) {
	subject, ok := subjectFromRole(8, "admin")
	if !ok {
		t.Fatal("admin role should use the organization grant")
	}
	projectID := 7
	otherID := 9
	changes := filterChangesInScope([]changeRequestRecord{
		{ID: 2, ChangeNumber: "CHG-15", ProjectID: &projectID, Environment: "dev"},
		{ID: 3, ChangeNumber: "CHG-16", ProjectID: &otherID, Environment: "prod"},
	}, subject)
	if len(changes) != 2 {
		t.Fatalf("admin change list = %#v", changes)
	}
	incidents := filterIncidentsInScope([]requestIncident{
		{ID: 1, IncidentNumber: "INC-1", ProjectID: &projectID, Environment: "dev"},
		{ID: 2, IncidentNumber: "INC-2", ProjectID: &otherID, Environment: "prod"},
	}, subject)
	if len(incidents) != 2 {
		t.Fatalf("admin incident list = %#v", incidents)
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
