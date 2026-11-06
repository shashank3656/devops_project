package main

import "testing"

func TestEnvironmentVersionMatrixUsesObservationNotTitle(t *testing.T) {
	previous := listDeploymentAttempts
	t.Cleanup(func() { listDeploymentAttempts = previous })
	listDeploymentAttempts = func(projectID int, environment string) ([]deploymentAttempt, error) {
		if environment != "prod" {
			return nil, nil
		}
		return []deploymentAttempt{{
			ID:          4,
			ProjectID:   projectID,
			Environment: "prod",
			CommitSHA:   "aaaaaaaaaaaa",
			ImageDigest: "sha256:bbbbbbbbbbbb",
			State:       "success",
			ObservedAt:  "2026-10-28T04:01:00Z",
		}}, nil
	}
	projectID := 9
	service := serviceMapEntry{Service: "checkout", Environment: "prod", Repo: "acme/checkout", Team: "payments", ProjectID: &projectID}
	siblings := []serviceMapEntry{
		service,
		{Service: "checkout", Environment: "uat", Repo: "acme/checkout", Team: "payments", ProjectID: &projectID},
		{Service: "checkout", Environment: "dev", Repo: "acme/checkout", Team: "payments", ProjectID: &projectID},
	}
	changes := []changeRequestRecord{
		{ID: 1, ChangeNumber: "CHG1", Service: "checkout", Environment: "uat", SHA: "cccccccccccc", ImageDigest: "sha256:dddddddddddd", Status: "resolved"},
		{ID: 2, ChangeNumber: "CHG2", Service: "checkout", Environment: "dev", SHA: "eeeeeeeeeeee", Status: "resolved"},
	}
	matrix := buildEnvironmentVersionMatrix(service, siblings, changes)
	if len(matrix.Rows) < 3 {
		t.Fatalf("expected dev/uat/prod, got %#v", matrix.Rows)
	}
	var prod, uat, dev environmentVersionRow
	for _, row := range matrix.Rows {
		switch canonicalEnvironmentKey(row.Environment) {
		case "prod":
			prod = row
		case "uat":
			uat = row
		case "dev":
			dev = row
		}
	}
	if prod.Source != "runtime_observation" || prod.ObservedAt != "2026-10-28T04:01:00Z" {
		t.Fatalf("prod should use the runtime observation: %#v", prod)
	}
	if uat.Source != "recorded_change" || uat.CommitSHA != "cccccccccccc" {
		t.Fatalf("uat should use the recorded change: %#v", uat)
	}
	if dev.CommitSHA != "eeeeeeeeeeee" {
		t.Fatalf("dev recorded sha: %#v", dev)
	}
	if len(prod.Differences) == 0 {
		t.Fatal("prod should differ from uat/dev")
	}
}

func TestEnvironmentVersionMatrixUnknownWhenEmpty(t *testing.T) {
	previous := listDeploymentAttempts
	t.Cleanup(func() { listDeploymentAttempts = previous })
	listDeploymentAttempts = func(int, string) ([]deploymentAttempt, error) { return nil, nil }
	matrix := buildEnvironmentVersionMatrix(serviceMapEntry{Service: "api"}, nil, nil)
	if len(matrix.Rows) != 3 {
		t.Fatalf("always show dev/uat/prod, got %d", len(matrix.Rows))
	}
	for _, row := range matrix.Rows {
		if row.CommitSHA != "Unknown" || row.Source != "unknown" {
			t.Fatalf("empty env must stay Unknown: %#v", row)
		}
	}
}

func TestCanonicalEnvironmentKeyDoesNotReadTitle(t *testing.T) {
	if canonicalEnvironmentKey("production") != "prod" {
		t.Fatal("recorded production maps to prod")
	}
	if canonicalEnvironmentKey("deploy prod in title") != "deploy prod in title" {
		t.Fatal("free text is not inferred as prod")
	}
}
