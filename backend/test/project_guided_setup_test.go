package main

import (
	"strings"
	"testing"
)

func TestAttachGuidedProjectSetupOrderAndLinks(t *testing.T) {
	owner := 4
	project := &ProjectCatalog{
		ID:          9,
		Name:        "Checkout",
		OwnerTeamID: &owner,
		ReadinessChecks: []ProjectReadinessCheck{
			{Key: "environments", Label: "Environment layout"},
		},
	}
	attachGuidedProjectSetup(project)
	if len(project.ReadinessChecks) < 6 {
		t.Fatalf("expected guided checks plus catalog, got %#v", project.ReadinessChecks)
	}
	want := []string{"guided_owner", "guided_repository", "guided_monitoring", "guided_oncall", "guided_deployment"}
	for i, key := range want {
		if project.ReadinessChecks[i].Key != key {
			t.Fatalf("check %d = %#v", i, project.ReadinessChecks[i])
		}
		if project.ReadinessChecks[i].Href == "" || project.ReadinessChecks[i].ActionLabel == "" {
			t.Fatalf("incomplete %s must open a setup screen: %#v", key, project.ReadinessChecks[i])
		}
	}
	if project.ReadinessChecks[0].Complete != true {
		t.Fatal("owner should be complete when owner team is set")
	}
	if !strings.Contains(project.ReadinessChecks[4].Href, "/services/new") {
		t.Fatalf("missing environment should open service setup, href = %q", project.ReadinessChecks[4].Href)
	}
	if project.ReadinessChecks[4].Complete {
		t.Fatal("empty catalog must not count as deployment configured")
	}
	if project.ReadinessChecks[5].Key != "environments" {
		t.Fatalf("catalog checks should follow guided setup, got %#v", project.ReadinessChecks[5])
	}
}
