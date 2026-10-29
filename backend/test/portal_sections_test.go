package main

import "testing"

func TestDefaultSectionGrantsFollowGroupKind(t *testing.T) {
	portal := defaultSectionGrants("portal")
	if !portal.Requests || portal.Daily || portal.PortalAccess {
		t.Fatalf("portal default = %+v", portal)
	}
	devops := defaultSectionGrants("devops")
	if devops.Requests || !devops.Daily || !devops.Operations || !devops.Cost || !devops.Infrastructure || !devops.Security || devops.Records {
		t.Fatalf("devops default = %+v", devops)
	}
}

func TestSectionGrantsMergeAndAdmin(t *testing.T) {
	merged := defaultSectionGrants("portal").merge(defaultSectionGrants("devops"))
	if !merged.Requests || !merged.Daily || !merged.Security {
		t.Fatalf("merge = %+v", merged)
	}
	admin := sectionGrantsForUser(&User{ID: 1, Role: "admin", UserType: "portal_user"})
	if !admin.PortalAccess || !admin.Daily || !admin.Requests || !admin.Records || !admin.Manager {
		t.Fatalf("admin grants = %+v", admin)
	}
	if DB == nil {
		requester := sectionGrantsForUser(&User{ID: 2, Role: "viewer", UserType: "portal_user"})
		if !requester.Requests || requester.Daily {
			t.Fatalf("requester fallback = %+v", requester)
		}
	}
}

func TestSectionForPath(t *testing.T) {
	cases := map[string]string{
		"/api/admin/users":                      "portal",
		"/api/admin/teams/4/grants":             "portal",
		"/api/history":                          "requests",
		"/api/request":                          "requests-or-daily",
		"/api/oncall/days":                      "operations",
		"/api/oncall/handovers":                 "operations",
		"/api/expiry/assets":                    "operations",
		"/api/cost/overview":                    "cost",
		"/api/cost/tree":                        "cost",
		"/api/cost/connections":                 "cost",
		"/api/devops/inbound-sources":           "operations",
		"/api/devops/integrations/jira":         "operations",
		"/api/devops/integrations/health":       "integrations-health",
		"/api/integrations/jira/oauth/callback": "",
		"/api/webhooks/jira":                    "",
		"/api/devops/projects":                  "projects",
		"/api/devops/environment-catalog":       "catalog",
		"/api/devops/k8s-pods":                  "infrastructure",
		"/api/scans/jobs":                       "security",
		"/api/devops/security/overview":         "security",
		"/api/devops/evidence":                  "records",
		"/api/devops/pipelines":                 "records-or-infrastructure",
		"/api/devops/me":                        "",
		"/api/webhooks/github":                  "",
		"/api/deployments/callbacks":            "",
		"/api/security/agent/enroll":            "",
		"/api/security/webhooks/github":         "",
		"/api/expiry/collector/observations":    "",
		"/api/cost/collector/snapshots":         "",
		"/health":                               "",
	}
	for path, want := range cases {
		if got := sectionForPath(path); got != want {
			t.Fatalf("%s section = %q, want %q", path, got, want)
		}
	}
	requester := defaultSectionGrants("portal")
	if requester.allows("portal") || requester.allows("operations") || !requester.allows("requests") {
		t.Fatalf("requester allow = %+v", requester)
	}
	if !allSectionGrants().allows("security") {
		t.Fatal("admin section was rejected")
	}
	costOnly := sectionGrants{Cost: true}
	if !costOnly.allows("integrations-health") || requester.allows("integrations-health") {
		t.Fatalf("health grants cost=%v requester=%v", costOnly.allows("integrations-health"), requester.allows("integrations-health"))
	}
}

func TestInfrastructurePageCanBeIAMOnly(t *testing.T) {
	grants := defaultSectionGrants("devops")
	grants.Pages = map[string]bool{"iam": true, "kubernetes": false}
	if !grants.allows("infrastructure") || !grants.allowsPage("iam") || grants.allowsPage("kubernetes") {
		t.Fatalf("page grants = %+v", grants)
	}
	if pageForPath("/api/devops/iam/access-requests") != "iam" || pageForPath("/api/devops/k8s-pods") != "kubernetes" || pageForPath("/api/devops/pipelines") != "releases" {
		t.Fatal("page path mapping changed")
	}
	if !defaultSectionGrants("devops").allowsPage("kubernetes") {
		t.Fatal("a group without page grants should keep every page in the section")
	}
}

func TestCostSectionInheritsFromOperationsUntilSaved(t *testing.T) {
	inherited, err := decodeSectionGrants([]byte(`{"operations":true,"pages":{"cost":true}}`))
	if err != nil || !inherited.Cost {
		t.Fatalf("inherit on = %+v err=%v", inherited, err)
	}
	denied, err := decodeSectionGrants([]byte(`{"operations":true,"pages":{"cost":false}}`))
	if err != nil || denied.Cost {
		t.Fatalf("inherit off = %+v err=%v", denied, err)
	}
	explicit, err := decodeSectionGrants([]byte(`{"operations":false,"cost":true}`))
	if err != nil || !explicit.Cost || explicit.Operations {
		t.Fatalf("explicit cost = %+v err=%v", explicit, err)
	}
}
