package main

import (
	"errors"
	"testing"
)

func acceptanceActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installAcceptanceMemory() {
	cases := map[string]acceptanceCase{}
	risks := map[int]acceptanceRisk{}
	nextCase, nextRisk := 1, 1
	key := func(environment, scenario, subject string) string {
		return environment + ":" + scenario + ":" + subject
	}
	findAcceptanceCase = func(projectID int, environment, scenario, subject string) (acceptanceCase, error) {
		return cases[key(environment, scenario, subject)], nil
	}
	saveAcceptanceCase = func(item acceptanceCase) (acceptanceCase, error) {
		item.ID = nextCase
		nextCase++
		cases[key(item.Environment, item.Scenario, item.Subject)] = item
		return item, nil
	}
	updateAcceptanceCase = func(item acceptanceCase) (acceptanceCase, error) {
		cases[key(item.Environment, item.Scenario, item.Subject)] = item
		return item, nil
	}
	listAcceptanceCases = func(projectID int, environment string) ([]acceptanceCase, error) {
		var items []acceptanceCase
		for id := 1; id < nextCase; id++ {
			for _, item := range cases {
				if item.ID == id && item.Environment == environment && item.ProjectID == projectID {
					items = append(items, item)
				}
			}
		}
		return items, nil
	}
	loadAcceptanceCase = func(id int) (acceptanceCase, error) {
		for _, item := range cases {
			if item.ID == id {
				return item, nil
			}
		}
		return acceptanceCase{}, nil
	}
	saveAcceptanceRiskRow = func(item acceptanceRisk) (acceptanceRisk, error) {
		item.ID = nextRisk
		nextRisk++
		risks[item.ID] = item
		return item, nil
	}
	loadAcceptanceRiskRow = func(id int) (acceptanceRisk, error) {
		return risks[id], nil
	}
	updateAcceptanceRisk = func(item acceptanceRisk) (acceptanceRisk, error) {
		risks[item.ID] = item
		return item, nil
	}
	saveAcceptanceAudit = func(acceptanceAudit) error { return nil }
}

func TestDeniedRequestsLeakNoRecords(t *testing.T) {
	installAcceptanceMemory()
	operator := acceptanceActor("operator", 10)
	first, err := recordAcceptanceCase(operator, 10, "dev", "webhook_replay", "event-1", 2, false, "")
	if err != nil || !first.Applied || !first.FindingOpen || first.State != "recorded" {
		t.Fatalf("first = %+v %v", first, err)
	}
	if !first.FindingOpen {
		t.Fatal("new case closed a finding")
	}
	again, err := recordAcceptanceCase(operator, 10, "dev", "webhook_replay", "event-1", 2, false, "")
	if err != nil || again.Applied || again.ID != first.ID || again.Attempts != 1 || again.Reason != "duplicate replay" {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "dev", "parser_abuse", "event-1", 1, false, ""); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("parser = %v", err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "dev", "cross_project", "bad subject", 1, false, ""); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("parser subject = %v", err)
	}
	if found, _ := findAcceptanceCase(10, "dev", "parser_abuse", "event-1"); found.ID != 0 {
		t.Fatalf("parser wrote %+v", found)
	}
	items, err := readAcceptanceCases(operator, 10, "dev")
	if err != nil || len(items) != 1 || items[0].Subject != "event-1" {
		t.Fatalf("own records = %+v %v", items, err)
	}
	if leaked, err := readAcceptanceCases(acceptanceActor("operator", 11), 10, "dev"); err == nil || leaked != nil {
		t.Fatalf("other project leaked %+v %v", leaked, err)
	}
	if _, err := recordAcceptanceCase(acceptanceActor("viewer", 10), 10, "dev", "cross_project", "event-2", 1, false, ""); !errors.Is(err, errAcceptanceDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "*", "cross_project", "event-2", 1, false, ""); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
}

func TestPartialScansDoNotCloseFindings(t *testing.T) {
	installAcceptanceMemory()
	operator := acceptanceActor("operator", 10)
	partial, err := recordAcceptanceCase(operator, 10, "dev", "cross_project", "finding-1", 3, true, "")
	if err != nil || !partial.Partial || !partial.FindingOpen || partial.State != "recorded" {
		t.Fatalf("partial = %+v %v", partial, err)
	}
	if _, err := closeAcceptanceFinding(operator, partial.ID); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("partial close = %v", err)
	}
	kept, err := loadAcceptanceCase(partial.ID)
	if err != nil || !kept.FindingOpen {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	older, err := recordAcceptanceCase(operator, 10, "dev", "out_of_order", "finding-1", 1, false, "")
	if err != nil || older.Revision != 1 {
		t.Fatalf("older = %+v %v", older, err)
	}
	stale, err := recordAcceptanceCase(operator, 10, "dev", "out_of_order", "finding-1", 0, false, "")
	if err != nil || stale.Revision != 1 || stale.Reason != "older revision retained" || stale.Applied {
		t.Fatalf("stale = %+v %v", stale, err)
	}
	risk, err := saveAcceptanceRisk(operator, partial.ID, "Residual exposure stays open.")
	if err != nil || risk.State != "open" {
		t.Fatalf("risk = %+v %v", risk, err)
	}
	if _, err := acceptAcceptanceRisk(operator, risk.ID, operator.UserID); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("self accept = %v", err)
	}
	accepted, err := acceptAcceptanceRisk(operator, risk.ID, 9)
	if err != nil || accepted.State != "accepted" || accepted.ReviewerID != 9 {
		t.Fatalf("accepted = %+v %v", accepted, err)
	}
	if still, _ := loadAcceptanceCase(partial.ID); !still.FindingOpen {
		t.Fatal("accepted risk closed the finding")
	}
}

func TestFailureLeavesRecoverableState(t *testing.T) {
	installAcceptanceMemory()
	operator := acceptanceActor("operator", 10)
	crashed, err := recordAcceptanceCase(operator, 10, "dev", "worker_crash", "job-1", 1, false, "")
	if err != nil || crashed.State != "recoverable" || !crashed.FindingOpen || crashed.Attempts != 1 {
		t.Fatalf("crash = %+v %v", crashed, err)
	}
	if _, err := closeAcceptanceFinding(operator, crashed.ID); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("crash close = %v", err)
	}
	throttled, err := recordAcceptanceCase(operator, 10, "dev", "cloud_throttle", "job-1", 1, false, "")
	if err != nil || throttled.State != "recoverable" || throttled.ID == crashed.ID {
		t.Fatalf("throttle = %+v %v", throttled, err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "dev", "cloud_throttle", "job-1", 1, false, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "dev", "cloud_throttle", "job-1", 1, false, ""); err != nil {
		t.Fatal(err)
	}
	bound, err := recordAcceptanceCase(operator, 10, "dev", "cloud_throttle", "job-1", 1, false, "")
	if err != nil || bound.Applied || bound.State != "recoverable" || bound.Attempts != 3 || bound.Reason != "retry bound reached" {
		t.Fatalf("bound = %+v %v", bound, err)
	}
	expired, err := recordAcceptanceCase(operator, 10, "dev", "credential_expiry", "job-1", 1, false, "")
	if err != nil || expired.State != "unknown" || !expired.FindingOpen {
		t.Fatalf("expiry = %+v %v", expired, err)
	}
	if _, err := recordAcceptanceCase(operator, 10, "dev", "worker_crash", "job-1", 1, false, "password=hidden"); !errors.Is(err, errAcceptanceInvalid) {
		t.Fatalf("secret = %v", err)
	}
	items, err := readAcceptanceCases(operator, 10, "dev")
	if err != nil || len(items) != 3 {
		t.Fatalf("retained = %+v %v", items, err)
	}
}
