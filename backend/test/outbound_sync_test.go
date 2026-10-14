package main

import (
	"errors"
	"testing"
)

func syncActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installSyncMemory() {
	gates := map[string]bool{}
	attempts := map[string]outboundSyncAttempt{}
	next := 1
	key := func(projectID int, environment, mutationID string) string {
		return environment + ":" + mutationID
	}
	loadOutboundSyncGate = func(projectID int, environment string) (bool, error) {
		return gates[environment], nil
	}
	saveOutboundSyncGate = func(projectID int, environment string, enabled bool) error {
		gates[environment] = enabled
		return nil
	}
	findOutboundSync = func(projectID int, environment, mutationID string) (outboundSyncAttempt, error) {
		return attempts[key(projectID, environment, mutationID)], nil
	}
	saveOutboundSync = func(item outboundSyncAttempt) (outboundSyncAttempt, error) {
		item.ID = next
		next++
		attempts[key(item.ProjectID, item.Environment, item.MutationID)] = item
		return item, nil
	}
	updateOutboundSync = func(item outboundSyncAttempt) (outboundSyncAttempt, error) {
		attempts[key(item.ProjectID, item.Environment, item.MutationID)] = item
		return item, nil
	}
	saveOutboundSyncAudit = func(outboundSyncAudit) error { return nil }
}

func TestOutboundGateSuppressesEcho(t *testing.T) {
	installSyncMemory()
	operator := syncActor("operator", 10)
	if _, err := deliverOutbound(operator, 10, "dev", "mutation-1", 1); !errors.Is(err, errSyncInvalid) {
		t.Fatalf("gate off = %v", err)
	}
	if found, _ := findOutboundSync(10, "dev", "mutation-1"); found.ID != 0 {
		t.Fatalf("gate off wrote %+v", found)
	}
	if err := setOutboundSync(operator, 10, "dev", true); err != nil {
		t.Fatal(err)
	}
	first, err := deliverOutbound(operator, 10, "dev", "mutation-1", 1)
	if err != nil || !first.Applied || first.State != "delivered" || first.Attempts != 1 {
		t.Fatalf("first = %+v %v", first, err)
	}
	again, err := deliverOutbound(operator, 10, "dev", "mutation-1", 1)
	if err != nil || again.Applied || again.ID != first.ID || again.Attempts != 1 || again.Reason != "duplicate delivery" {
		t.Fatalf("duplicate = %+v %v", again, err)
	}
	echo, err := reconcileOutbound(operator, 10, "dev", "mutation-1", "mutation-echo", 1, 1, "delivered")
	if err != nil || echo.Applied || echo.ID != first.ID || echo.Reason != "echo suppressed" || echo.Attempts != 1 {
		t.Fatalf("echo = %+v %v", echo, err)
	}
	if found, _ := findOutboundSync(10, "dev", "mutation-echo"); found.ID != 0 {
		t.Fatalf("echo wrote %+v", found)
	}
	if _, err := deliverOutbound(syncActor("viewer", 10), 10, "dev", "mutation-2", 1); !errors.Is(err, errSyncDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := deliverOutbound(syncActor("operator", 11), 10, "dev", "mutation-2", 1); !errors.Is(err, errSyncHidden) {
		t.Fatalf("other project = %v", err)
	}
	if _, err := deliverOutbound(operator, 10, "*", "mutation-2", 1); !errors.Is(err, errSyncInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
}

func TestConflictStaysSeparateFromFailure(t *testing.T) {
	installSyncMemory()
	operator := syncActor("operator", 10)
	if err := setOutboundSync(operator, 10, "dev", true); err != nil {
		t.Fatal(err)
	}
	conflict, err := reconcileOutbound(operator, 10, "dev", "", "mutation-conflict", 1, 2, "delivered")
	if err != nil || conflict.State != "conflict" || conflict.Applied || conflict.Reason != "revision conflict" {
		t.Fatalf("conflict = %+v %v", conflict, err)
	}
	kept, err := reconcileOutbound(operator, 10, "dev", "", "mutation-conflict", 1, 2, "delivered")
	if err != nil || kept.State != "conflict" || kept.Attempts != 1 || kept.Reason != "revision conflict" {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	failed, err := reconcileOutbound(operator, 10, "dev", "", "mutation-fail", 3, 3, "unavailable")
	if err != nil || failed.State != "failed" || failed.Reason != "sync failure" || failed.State == conflict.State {
		t.Fatalf("failure = %+v %v", failed, err)
	}
	retried, err := reconcileOutbound(operator, 10, "dev", "", "mutation-fail", 3, 3, "failed")
	if err != nil || retried.State != "failed" || retried.Attempts != 2 || retried.Reason != "sync failure" {
		t.Fatalf("retry = %+v %v", retried, err)
	}
	if _, err := reconcileOutbound(operator, 10, "dev", "", "mutation-fail", 3, 3, "failed"); err != nil {
		t.Fatal(err)
	}
	bound, err := reconcileOutbound(operator, 10, "dev", "", "mutation-fail", 3, 3, "delivered")
	if err != nil || bound.Applied || bound.State != "failed" || bound.Attempts != 3 || bound.Reason != "retry bound reached" {
		t.Fatalf("bound = %+v %v", bound, err)
	}
	if _, err := reconcileOutbound(operator, 10, "dev", "", "mutation-bad", 1, 1, "execute"); !errors.Is(err, errSyncInvalid) {
		t.Fatalf("invalid outcome = %v", err)
	}
	if found, _ := findOutboundSync(10, "dev", "mutation-bad"); found.ID != 0 {
		t.Fatalf("invalid wrote %+v", found)
	}
}
