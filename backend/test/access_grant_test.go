package main

import (
	"errors"
	"testing"
)

func entitlementActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"prod"}}},
	}
}

func installEntitlementMemory() {
	grants := map[string]accessGrant{}
	next := 1
	key := func(environment, target string) string { return environment + ":" + target }
	findAccessGrant = func(projectID int, environment, target string) (accessGrant, error) {
		item := grants[key(environment, target)]
		if item.ProjectID != 0 && item.ProjectID != projectID {
			return accessGrant{}, nil
		}
		return item, nil
	}
	saveAccessGrant = func(item accessGrant) (accessGrant, error) {
		item.ID = next
		next++
		grants[key(item.Environment, item.Target)] = item
		return item, nil
	}
	loadAccessGrant = func(id int) (accessGrant, error) {
		for _, item := range grants {
			if item.ID == id {
				return item, nil
			}
		}
		return accessGrant{}, nil
	}
	updateAccessGrant = func(item accessGrant) (accessGrant, error) {
		grants[key(item.Environment, item.Target)] = item
		return item, nil
	}
	listAccessGrants = func(projectID int, environment string) ([]accessGrant, error) {
		var items []accessGrant
		for _, item := range grants {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveAccessAudit = func(int, string, int, string) error { return nil }
}

func TestDeniedApprovalCreatesNoGrant(t *testing.T) {
	installEntitlementMemory()
	operator := entitlementActor("operator", 10)
	if _, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "denied", 30, 9); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("denied = %v", err)
	}
	if found, _ := findAccessGrant(10, "prod", "db-billing"); found.ID != 0 {
		t.Fatalf("denied wrote %+v", found)
	}
	if _, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, operator.UserID); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("self approve = %v", err)
	}
	if _, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 90, 9); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("long duration = %v", err)
	}
	if _, err := approveAccessGrant(operator, 10, "*", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, 9); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	if _, err := approveAccessGrant(operator, 10, "prod", "i-0a1b2c3d4e5f67890", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, 9); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("demo target = %v", err)
	}
	if _, err := approveAccessGrant(entitlementActor("viewer", 10), 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, 9); !errors.Is(err, errEntitlementDenied) {
		t.Fatalf("viewer = %v", err)
	}
	granted, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, 9)
	if err != nil || !granted.Applied || !granted.Entitled || granted.MaxSessionMinutes != 60 || granted.Observed != "unknown" || granted.Executor != "sandbox-executor" {
		t.Fatalf("grant = %+v %v", granted, err)
	}
	again, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 30, 9)
	if err != nil || again.Applied || again.ID != granted.ID {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if leaked, err := readAccessGrants(entitlementActor("operator", 11), 10, "prod"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
}

func TestExpiryRemovesEntitlement(t *testing.T) {
	installEntitlementMemory()
	operator := entitlementActor("operator", 10)
	granted, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 15, 9)
	if err != nil {
		t.Fatal(err)
	}
	expired, err := expireAccessGrant(operator, granted.ID)
	if err != nil || expired.Entitled || expired.State != "expired" || !expired.ResidualSession || expired.Observed != "unknown" {
		t.Fatalf("expired = %+v %v", expired, err)
	}
	again, err := expireAccessGrant(operator, granted.ID)
	if err != nil || again.Applied || again.Entitled || again.State != "expired" {
		t.Fatalf("repeat = %+v %v", again, err)
	}
}

func TestRevocationFailureStaysVisible(t *testing.T) {
	installEntitlementMemory()
	operator := entitlementActor("operator", 10)
	granted, err := approveAccessGrant(operator, 10, "prod", "db-billing", "Investigate a page error.", "sandbox", "sandbox-executor", "approved", 15, 9)
	if err != nil {
		t.Fatal(err)
	}
	failed, err := failAccessRevocation(operator, granted.ID)
	if err != nil || failed.State != "revocation_failed" || !failed.Entitled || !failed.ResidualSession {
		t.Fatalf("failed = %+v %v", failed, err)
	}
	if _, err := expireAccessGrant(operator, granted.ID); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("expire hid failure = %v", err)
	}
	kept, err := loadAccessGrant(granted.ID)
	if err != nil || kept.State != "revocation_failed" {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	repeat, err := failAccessRevocation(operator, granted.ID)
	if err != nil || repeat.Applied || repeat.State != "revocation_failed" {
		t.Fatalf("repeat = %+v %v", repeat, err)
	}
	if _, err := verifyAccessRevocation(operator, granted.ID, operator.UserID); !errors.Is(err, errEntitlementInvalid) {
		t.Fatalf("self verify = %v", err)
	}
	verified, err := verifyAccessRevocation(operator, granted.ID, 9)
	if err != nil || verified.State != "revoked" || verified.Entitled || !verified.ResidualSession || verified.ReviewerID != 9 {
		t.Fatalf("verified = %+v %v", verified, err)
	}
}
