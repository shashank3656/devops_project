package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestPermissionFailureMarksPartialCoverage(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	contract, err := evaluateConnectionContract(connectionObservation{
		ProjectID:   10,
		Name:        "github",
		Environment: "dev",
		SecretRef:   "projects.10.github",
		HasSuccess:  true,
		LastSuccess: now.Add(-time.Minute),
		ObservedAt:  now,
		Capabilities: []connectionCapability{
			{Name: "contents:read", Granted: true},
			{Name: "metadata:read", Granted: false},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	view := contract.Public()
	if view.State != "partial" || view.Coverage != "partial" {
		t.Fatalf("state=%s coverage=%s", view.State, view.Coverage)
	}
	if len(view.MissingPermissions) != 1 || view.MissingPermissions[0] != "metadata:read" {
		t.Fatalf("missing = %+v", view.MissingPermissions)
	}
	if view.State == "healthy" {
		t.Fatal("a permission failure was marked healthy")
	}
}

func TestConnectionContractKeepsSecretsOffTheView(t *testing.T) {
	secret := "super-secret-token"
	_, err := evaluateConnectionContract(connectionObservation{
		ProjectID:   10,
		Name:        "github",
		Environment: "dev",
		SecretRef:   "projects.10.github",
		SecretValue: secret,
	})
	if err == nil || err.Error() == "" || strings.Contains(err.Error(), secret) {
		t.Fatalf("secret rejection = %v", err)
	}
	contract, err := evaluateConnectionContract(connectionObservation{
		ProjectID:   10,
		Name:        "github",
		Environment: "dev",
		SecretRef:   "projects.10.github",
		HasSuccess:  true,
		LastSuccess: time.Now(),
		ObservedAt:  time.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(contract.Public())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "projects.10.github") || strings.Contains(string(raw), secret) {
		t.Fatalf("public view leaked a secret reference: %s", raw)
	}
	if !contract.Public().SecretRefSet {
		t.Fatal("secret reference was not recorded")
	}
}

func TestStaleAndUnknownStayDistinctFromHealthy(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	stale, err := evaluateConnectionContract(connectionObservation{
		ProjectID: 10, Name: "metrics", Environment: "dev", SecretRef: "projects.10.metrics",
		HasSuccess: true, LastSuccess: now.Add(-48 * time.Hour), ObservedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stale.State != "stale" || stale.Coverage != "full" {
		t.Fatalf("stale = %+v", stale.Public())
	}
	unknown, err := evaluateConnectionContract(connectionObservation{
		ProjectID: 10, Name: "metrics", Environment: "dev", SecretRef: "projects.10.metrics", ObservedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if unknown.State != "unknown" || unknown.Coverage != "unknown" {
		t.Fatalf("unknown = %+v", unknown.Public())
	}
}

func TestConnectionContractHidesOtherProjects(t *testing.T) {
	other := connectionObservation{
		ProjectID: 11, Name: "github", Environment: "dev", SecretRef: "projects.11.github",
	}
	view, err := recordConnectionContract(connectionGrant(10, "operator"), other)
	if err != errConnectionHidden || view.Name != "" {
		t.Fatalf("hidden = %+v err=%v", view, err)
	}
	view, err = recordConnectionContract(connectionGrant(10, "viewer"), connectionObservation{
		ProjectID: 10, Name: "github", Environment: "dev", SecretRef: "projects.10.github", SecretValue: "super-secret-token",
	})
	if err != errConnectionDenied {
		t.Fatalf("viewer write err = %v", err)
	}
	if strings.Contains(err.Error(), "super-secret-token") || view.SecretRefSet {
		t.Fatal("denied write recorded a secret")
	}
}

func connectionGrant(projectID int, role string) authzSubject {
	return authzSubject{
		UserID:         4,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Role:           role,
			Environments:   []string{"dev"},
		}},
	}
}
