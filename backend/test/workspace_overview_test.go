package main

import (
	"errors"
	"testing"
	"time"
)

func workspaceActor(role string, projectID int, environments []string) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: environments}},
	}
}

func installWorkspaceMemory() {
	workspaceClock = func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) }
	loadWorkspaceDeployments = func(projectID int, environment string) ([]workspaceRef, error) {
		if environment != "dev" {
			return nil, nil
		}
		return []workspaceRef{{
			SourceID: "41", ProjectID: projectID, Environment: "dev", State: "success",
			ObservedAt: "2026-10-14T11:00:00Z", ServiceKey: "payments",
		}}, nil
	}
	loadWorkspaceIncidents = func(projectID int, environment string) ([]workspaceRef, error) {
		return []workspaceRef{
			{SourceID: "7", ProjectID: projectID, Environment: "dev", State: "open", ObservedAt: "2026-10-14T11:30:00Z", Owner: "payments", ServiceKey: "payments"},
			{SourceID: "8", ProjectID: projectID, Environment: "prod", State: "open", ObservedAt: "2026-10-14T11:30:00Z", Owner: "payments", ServiceKey: "payments"},
		}, nil
	}
	loadWorkspaceSecurity = func(projectID int, environment string) ([]workspaceRef, error) {
		return []workspaceRef{{
			SourceID: "3", ProjectID: projectID, Environment: environment, State: "incomplete", ServiceKey: "payments",
		}}, nil
	}
	loadWorkspaceResources = func(projectID int, environment string) ([]workspaceRef, error) {
		return []workspaceRef{{
			SourceID: "9", ProjectID: projectID, Environment: environment, State: "recorded",
			ObservedAt: "2026-10-13T00:00:00Z", ServiceKey: "payments",
		}}, nil
	}
	loadWorkspaceOwners = func(projectID int, environment string) ([]workspaceRef, error) {
		return []workspaceRef{{
			SourceID: "2", ProjectID: projectID, Environment: environment, State: "recorded",
			ObservedAt: "2026-10-14T10:00:00Z", Owner: "payments", ServiceKey: "payments",
		}}, nil
	}
}

func TestInboxRespectsSourcePermissions(t *testing.T) {
	installWorkspaceMemory()
	view, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range view.Items {
		if item.Environment != "dev" || item.ProjectID != 10 {
			t.Fatalf("out of scope: %+v", item)
		}
	}
	if sectionNamed(view, "incident").Count != 1 {
		t.Fatalf("incident leaked: %+v", sectionNamed(view, "incident"))
	}
	if _, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 11, Environment: "dev", Page: 1}); !errors.Is(err, errWorkspaceHidden) {
		t.Fatalf("other project = %v", err)
	}
	if _, err := loadWorkspace(workspaceActor("viewer", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1}); err != nil {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "*", Page: 1}); !errors.Is(err, errWorkspaceInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
}

func TestLinksRetainScope(t *testing.T) {
	installWorkspaceMemory()
	view, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{
		ProjectID: 10, Environment: "dev", ServiceKey: "payments", Page: 1,
	})
	if err != nil || view.ServiceKey != "payments" {
		t.Fatalf("service = %+v %v", view, err)
	}
	if len(view.Items) == 0 {
		t.Fatal("service page empty")
	}
	for _, item := range view.Items {
		if item.ServiceKey != "payments" || item.Environment != "dev" || item.ProjectID != 10 {
			t.Fatalf("scope dropped: %+v", item)
		}
		if !stringsContains(item.Link, "project_id=10") || !stringsContains(item.Link, "environment=dev") || !stringsContains(item.Link, "kind=") || !stringsContains(item.Link, "source_id=") || !stringsContains(item.Link, "service=payments") {
			t.Fatalf("link = %s", item.Link)
		}
	}
	security := sectionNamed(view, "security")
	if security.State != "unknown" || security.ObservedAt != "" || security.Items[0].Freshness != "missing" {
		t.Fatalf("security timestamp = %+v", security)
	}
	if security.Items[0].State == "healthy" {
		t.Fatal("security became healthy")
	}
}

func TestEmptyStaleErrorAreDistinct(t *testing.T) {
	installWorkspaceMemory()
	loadWorkspaceDeployments = func(int, string) ([]workspaceRef, error) { return nil, nil }
	loadWorkspaceIncidents = func(int, string) ([]workspaceRef, error) { return nil, nil }
	loadWorkspaceSecurity = func(int, string) ([]workspaceRef, error) { return nil, nil }
	loadWorkspaceResources = func(int, string) ([]workspaceRef, error) { return nil, nil }
	loadWorkspaceOwners = func(int, string) ([]workspaceRef, error) { return nil, nil }
	empty, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1})
	if err != nil || empty.State != "empty" || empty.Total != 0 {
		t.Fatalf("empty = %+v %v", empty.State, err)
	}
	loadWorkspaceDeployments = func(projectID int, environment string) ([]workspaceRef, error) {
		return []workspaceRef{{
			SourceID: "41", ProjectID: projectID, Environment: environment, State: "healthy",
			ObservedAt: "2026-10-12T00:00:00Z", ServiceKey: "payments",
		}}, nil
	}
	stale, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1})
	if err != nil || stale.State != "stale" {
		t.Fatalf("stale = %+v %v", stale.State, err)
	}
	deployment := sectionNamed(stale, "deployment")
	if deployment.State != "stale" || deployment.ObservedAt != "2026-10-12T00:00:00Z" || deployment.Items[0].State != "unknown" || deployment.Items[0].Freshness != "stale" {
		t.Fatalf("deployment = %+v", deployment)
	}
	loadWorkspaceDeployments = func(int, string) ([]workspaceRef, error) { return nil, errWorkspaceSource }
	failed, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1})
	if err != nil || failed.State != "error" || sectionNamed(failed, "deployment").State != "error" || sectionNamed(failed, "incident").State != "empty" {
		t.Fatalf("error = %+v deployment=%+v", failed.State, sectionNamed(failed, "deployment"))
	}
	work, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{
		ProjectID: 10, Environment: "dev", Owner: "missing-team", Page: 1, PageSize: 10,
	})
	if err != nil || work.State != "error" || work.Total != 0 {
		t.Fatalf("filtered error = %+v total=%d %v", work.State, work.Total, err)
	}
	if _, err := loadWorkspace(workspaceActor("operator", 10, []string{"dev"}), workspaceQuery{ProjectID: 10, Environment: "dev", Page: 1, PageSize: 11}); !errors.Is(err, errWorkspaceInvalid) {
		t.Fatalf("page size = %v", err)
	}
}

func sectionNamed(view workspaceView, kind string) workspaceSection {
	for _, section := range view.Sections {
		if section.Kind == kind {
			return section
		}
	}
	return workspaceSection{}
}

func stringsContains(value, part string) bool {
	return len(value) >= len(part) && (value == part || len(part) == 0 || indexOf(value, part) >= 0)
}

func indexOf(value, part string) int {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
