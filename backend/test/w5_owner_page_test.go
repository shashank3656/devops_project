package main

import "testing"

func TestIsSEV12(t *testing.T) {
	if !isSEV12("SEV1") || !isSEV12("critical") || !isSEV12("high") || !isSEV12("sev2") {
		t.Fatal("SEV1/SEV2 aliases should page")
	}
	if isSEV12("low") || isSEV12("medium") {
		t.Fatal("lower severity should not page")
	}
}

func TestShouldPageIncidentOwners(t *testing.T) {
	if !shouldPageIncidentOwners(requestIncident{Severity: "critical", Status: "open"}) {
		t.Fatal("open SEV1 should page")
	}
	if shouldPageIncidentOwners(requestIncident{Severity: "low", Status: "open"}) {
		t.Fatal("low should not page")
	}
	if shouldPageIncidentOwners(requestIncident{Severity: "critical", Status: "resolved"}) {
		t.Fatal("resolved should not page")
	}
}

func TestBuildIncidentOwnerPageRequiresSEV(t *testing.T) {
	page := buildIncidentOwnerPage(requestIncident{ID: 1, Severity: "low", Status: "open", Service: "checkout"})
	if page.Paged {
		t.Fatal("low severity must not page")
	}
	page = buildIncidentOwnerPage(requestIncident{ID: 2, IncidentNumber: "INC0000002", Severity: "critical", Status: "open", Service: "checkout", OwnerUsername: "sre"})
	if !page.Paged || page.IncidentNumber != "INC0000002" {
		t.Fatalf("%+v", page)
	}
}

func TestPageIncidentOwnersIfNewlyOpen(t *testing.T) {
	current := requestIncident{ID: 4, Severity: "critical", Status: "open"}
	previous := requestIncident{ID: 4, Severity: "critical", Status: "open"}
	if !shouldPageIncidentOwners(current) || !shouldPageIncidentOwners(previous) {
		t.Fatal("both should be pageable")
	}
	pageIncidentOwnersIfNewlyOpen(&previous, current)
	draft := requestIncident{ID: 5, Severity: "critical", Status: "draft"}
	opened := requestIncident{ID: 5, Severity: "critical", Status: "open"}
	if shouldPageIncidentOwners(draft) {
		t.Fatal("draft must not page")
	}
	pageIncidentOwnersIfNewlyOpen(&draft, opened)
}
