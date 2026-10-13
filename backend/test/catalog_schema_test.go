package main

import "testing"

func TestRenameCatalogServiceKeepsLinks(t *testing.T) {
	services := []catalogServiceRecord{{ID: 7, ProjectID: 1, Name: "payments"}}
	repos, err := linkCatalogTarget(nil, 7, "acme/payments")
	if err != nil {
		t.Fatal(err)
	}
	resources, err := linkCatalogTarget(nil, 7, "b/payments-logs")
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := renameCatalogService(services, 7, "billing")
	if err != nil {
		t.Fatal(err)
	}
	if renamed[0].ID != 7 || renamed[0].Name != "billing" {
		t.Fatalf("renamed = %+v", renamed[0])
	}
	if got := catalogTargetsForService(repos, 7); len(got) != 1 || got[0] != "acme/payments" {
		t.Fatalf("repo links changed: %+v", got)
	}
	if got := catalogTargetsForService(resources, 7); len(got) != 1 || got[0] != "b/payments-logs" {
		t.Fatalf("resource links changed: %+v", got)
	}
}

func TestSharedCatalogResourceLinksTwoServices(t *testing.T) {
	links, err := linkCatalogTarget(nil, 7, "b/shared-logs")
	if err != nil {
		t.Fatal(err)
	}
	links, err = linkCatalogTarget(links, 8, "b/shared-logs")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := linkCatalogTarget(links, 7, "b/shared-logs"); err == nil {
		t.Fatal("the same service must not link one resource twice")
	}
	if len(catalogTargetsForService(links, 7)) != 1 || len(catalogTargetsForService(links, 8)) != 1 {
		t.Fatalf("links = %+v", links)
	}
}
