package main

import (
	"errors"
	"testing"
)

func monitorActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"staging"}}},
	}
}

func installMonitorMemory() {
	events := map[string]changeEvent{}
	rescans := map[int]changeRescan{}
	nextEvent, nextRescan := 1, 1
	key := func(environment, eventKey string) string { return environment + ":" + eventKey }
	findChangeEvent = func(projectID int, environment, eventKey string) (changeEvent, error) {
		item := events[key(environment, eventKey)]
		if item.ProjectID != 0 && item.ProjectID != projectID {
			return changeEvent{}, nil
		}
		return item, nil
	}
	saveChangeEvent = func(item changeEvent) (changeEvent, error) {
		item.ID = nextEvent
		nextEvent++
		item.Applied = true
		events[key(item.Environment, item.EventKey)] = item
		return item, nil
	}
	loadChangeEvent = func(id int) (changeEvent, error) {
		for _, item := range events {
			if item.ID == id {
				return item, nil
			}
		}
		return changeEvent{}, nil
	}
	updateChangeEvent = func(item changeEvent) (changeEvent, error) {
		item.Applied = true
		events[key(item.Environment, item.EventKey)] = item
		return item, nil
	}
	listChangeEvents = func(projectID int, environment string) ([]changeEvent, error) {
		var items []changeEvent
		for _, item := range events {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	findChangeRescan = func(eventID int) (changeRescan, error) { return rescans[eventID], nil }
	saveChangeRescan = func(item changeRescan) (changeRescan, error) {
		item.ID = nextRescan
		nextRescan++
		item.Applied = true
		rescans[item.EventID] = item
		return item, nil
	}
	updateChangeRescan = func(item changeRescan) (changeRescan, error) {
		item.Applied = true
		rescans[item.EventID] = item
		return item, nil
	}
	saveMonitorAudit = func(int, string, int, string) error { return nil }
}

func TestRepeatedEventSchedulesNoDuplicateWork(t *testing.T) {
	installMonitorMemory()
	operator := monitorActor("operator", 10)
	item, err := recordChangeEvent(operator, 10, "staging", "chg-1", "actor-1", "billing", 5, true)
	if err != nil || item.State != "suspected" || !item.Suspected || item.Verified || item.WorkCount != 1 || item.Observed != "unknown" {
		t.Fatalf("event = %+v %v", item, err)
	}
	again, err := recordChangeEvent(operator, 10, "staging", "chg-1", "actor-1", "billing", 5, true)
	if err != nil || again.Applied || again.ID != item.ID || again.WorkCount != 1 {
		t.Fatalf("repeat = %+v %v", again, err)
	}
	older, err := recordChangeEvent(operator, 10, "staging", "chg-1", "actor-1", "billing", 2, true)
	if err != nil || older.Applied || older.Revision != 5 || older.Reason != "older revision" || older.WorkCount != 1 {
		t.Fatalf("older = %+v %v", older, err)
	}
	rescan, err := findChangeRescan(item.ID)
	if err != nil || rescan.State != "scheduled" || rescan.ID == 0 {
		t.Fatalf("rescan = %+v %v", rescan, err)
	}
	if _, err := recordChangeEvent(operator, 10, "staging", "chg-1", "actor-1", "billing", 6, false); !errors.Is(err, errMonitorInvalid) {
		t.Fatalf("unauthenticated = %v", err)
	}
	if leaked, err := readChangeEvents(monitorActor("operator", 11), 10, "staging"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
}

func TestMissedEventsReconciledByPeriodicScan(t *testing.T) {
	installMonitorMemory()
	operator := monitorActor("operator", 10)
	missed, err := reconcileChangeScan(operator, 10, "staging", "chg-2", false)
	if err != nil || missed.State != "unknown" || missed.WorkCount != 0 || missed.Reason != "delivery loss" {
		t.Fatalf("missed = %+v %v", missed, err)
	}
	item, err := recordChangeEvent(operator, 10, "staging", "chg-2", "actor-1", "billing", 4, true)
	if err != nil || item.ID != missed.ID || item.State != "suspected" || item.WorkCount != 1 || item.Verified {
		t.Fatalf("arrived = %+v %v", item, err)
	}
	reconciled, err := reconcileChangeScan(operator, 10, "staging", "chg-2", true)
	if err != nil || reconciled.WorkCount != 1 || reconciled.Verified || !reconciled.Suspected {
		t.Fatalf("reconciled = %+v %v", reconciled, err)
	}
	rescan, err := findChangeRescan(item.ID)
	if err != nil || rescan.State != "reconciled" || rescan.Coverage != "partial" {
		t.Fatalf("rescan = %+v %v", rescan, err)
	}
	again, err := reconcileChangeScan(operator, 10, "staging", "chg-2", true)
	if err != nil || again.Applied || again.WorkCount != 1 {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := verifyChangeEvent(operator, item.ID, operator.UserID); !errors.Is(err, errMonitorInvalid) {
		t.Fatalf("self = %v", err)
	}
	verified, err := verifyChangeEvent(operator, item.ID, 9)
	if err != nil || !verified.Verified || verified.Suspected || verified.State != "verified" {
		t.Fatalf("verified = %+v %v", verified, err)
	}
}

func TestEventDeliveryLossBecomesVisible(t *testing.T) {
	installMonitorMemory()
	operator := monitorActor("operator", 10)
	item, err := recordChangeEvent(operator, 10, "staging", "chg-3", "actor-1", "billing", 5, true)
	if err != nil {
		t.Fatal(err)
	}
	lost, err := reconcileChangeScan(operator, 10, "staging", "chg-3", false)
	if err != nil || lost.Reason != "delivery loss" || lost.Observed != "unknown" || lost.WorkCount != 1 || lost.State != "suspected" {
		t.Fatalf("lost = %+v %v", lost, err)
	}
	again, err := reconcileChangeScan(operator, 10, "staging", "chg-3", false)
	if err != nil || again.Applied || again.Reason != "delivery loss" {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := reconcileChangeScan(operator, 10, "staging", "missing", true); !errors.Is(err, errMonitorInvalid) {
		t.Fatalf("invented = %v", err)
	}
	if _, err := recordChangeEvent(monitorActor("viewer", 10), 10, "staging", "chg-4", "actor-1", "billing", 1, true); !errors.Is(err, errMonitorDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordChangeEvent(operator, 10, "*", "chg-4", "actor-1", "billing", 1, true); !errors.Is(err, errMonitorInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	if _, err := verifyChangeEvent(operator, item.ID, 9); !errors.Is(err, errMonitorInvalid) {
		t.Fatalf("unreconciled verify = %v", err)
	}
}
