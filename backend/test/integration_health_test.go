package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestIntegrationCollectionStateDistinguishesEmptyFromStopped(t *testing.T) {
	now := time.Now().UTC()
	if integrationCollectionState(false, false, true, nil, 24) != "not_connected" {
		t.Fatal("missing connector must be Not connected")
	}
	if integrationCollectionState(true, false, true, &now, 24) != "no_findings" {
		t.Fatal("successful empty load must be No findings, never Healthy")
	}
	old := now.Add(-48 * time.Hour)
	if integrationCollectionState(true, false, false, &old, 24) != "stale" {
		t.Fatal("old last success must be Stale")
	}
	if integrationCollectionState(true, true, false, &now, 24) != "failed" {
		t.Fatal("failed job must be Collection failed")
	}
	if integrationCollectionState(true, false, false, &now, 24) != "ok" {
		t.Fatal("fresh collection must be Current")
	}
}

func TestIntegrationBillingSkipsDemoAndDoesNotFailUnimportedClouds(t *testing.T) {
	complete := true
	family := integrationBillingFamilyFromConnections([]costConnection{
		{ID: 1, AccountID: "111122223333", Provider: "aws", DisplayName: "Demo"},
		{ID: 2, AccountID: "999900001111", Provider: "gcp", DisplayName: "GCP billing"},
		{ID: 3, AccountID: "123456789012", Provider: "aws", DisplayName: "Prod", LastIngestedAt: nil, WindowComplete: &complete},
	})
	if family.State != "not_connected" {
		t.Fatalf("state = %s", family.State)
	}
	if len(family.Connectors) != 2 {
		t.Fatalf("connectors = %d", len(family.Connectors))
	}
	for _, item := range family.Connectors {
		if item.State == "failed" {
			t.Fatal("unimported or empty AWS must not be Collection failed")
		}
		if strings.Contains(strings.ToLower(item.Detail), "secret") || strings.Contains(strings.ToLower(item.Detail), "password") {
			t.Fatal("billing detail leaked a secret word")
		}
	}
	if family.Action == nil || family.Action.Href != "/cost/configuration" {
		t.Fatalf("recovery = %+v", family.Action)
	}
}

func TestIntegrationHealthJSONOmitsSecrets(t *testing.T) {
	family := integrationFamily{
		ID: "jira", Label: "Jira", Source: "Jira Cloud", State: "failed",
		Detail: "1 failed job.", Action: &integrationAction{Label: "Review failed jobs", Href: "/integrations/jira?tab=activity"},
		Connectors: []integrationConnector{{ID: "jira-1", Name: "Company Jira", State: "failed", Source: "Jira Cloud", FailedJobs: 1}},
	}
	raw, err := json.Marshal(map[string]any{"families": []integrationFamily{family}})
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(raw))
	for _, word := range []string{"password", "secret", "token", "database_url", "hmac"} {
		if strings.Contains(lower, word) {
			t.Fatalf("payload contained %s", word)
		}
	}
}

func TestIntegrationWorstStatePrefersFailed(t *testing.T) {
	if integrationWorstState("ok", "no_findings", "stale", "failed") != "failed" {
		t.Fatal("failed should win")
	}
	if integrationWorstState("ok", "not_connected") != "not_connected" {
		t.Fatal("not connected should beat current")
	}
}

func TestIntegrationFamilyStatePartialWhenSourcesMix(t *testing.T) {
	if integrationFamilyState("ok", "not_connected") != "partial" {
		t.Fatal("mixed current and missing must be Partially connected")
	}
	if integrationFamilyState("ok", "stale") != "stale" {
		t.Fatal("stale still wins over mixed current")
	}
	current, total := integrationCurrentSourceCount([]string{"ok", "not_connected"})
	if current != 1 || total != 2 {
		t.Fatalf("source counts = %d/%d", current, total)
	}
}

func TestIntegrationBillingUsesSelectedProjectProvider(t *testing.T) {
	family := billingFamilyFrom([]costConnection{
		{ID: 1, ProjectID: 10, AccountID: "123456789012", Provider: "aws", DisplayName: "AWS prod"},
		{ID: 2, ProjectID: 20, AccountID: "gcp-prod", Provider: "gcp", DisplayName: "GCP prod"},
	}, 20)
	if family.Source != "GCP Cloud Billing" {
		t.Fatalf("source = %s", family.Source)
	}
	if family.Action != nil {
		t.Fatalf("GCP project must not show CUR import %+v", family.Action)
	}
	if family.State != "not_connected" {
		t.Fatalf("state = %s", family.State)
	}
	if len(family.Connectors) != 1 || family.Connectors[0].Source != "GCP Cloud Billing" {
		t.Fatalf("connectors = %+v", family.Connectors)
	}
	if strings.Contains(family.Connectors[0].Name, "Organization-wide") {
		t.Fatal("selected project connector must not be labelled organization-wide")
	}
}

func TestIntegrationBillingOrgWideLabelsAWSAccount(t *testing.T) {
	family := billingFamilyFrom([]costConnection{
		{ID: 1, ProjectID: 10, AccountID: "123456789012", Provider: "aws", DisplayName: "Prod"},
	}, 99)
	if !strings.Contains(family.Source, "Organization-wide") {
		t.Fatalf("source = %s", family.Source)
	}
	if !strings.Contains(family.Detail, "Organization-wide") {
		t.Fatalf("detail = %s", family.Detail)
	}
	if len(family.Connectors) != 1 {
		t.Fatalf("connectors = %d", len(family.Connectors))
	}
	name := family.Connectors[0].Name
	if !strings.Contains(name, "Organization-wide") || !strings.Contains(name, "AWS account 123456789012") {
		t.Fatalf("connector name = %s", name)
	}
}

func integrationBillingFamilyFromConnections(conns []costConnection) integrationFamily {
	return billingFamilyFrom(conns, 0)
}

func TestDecorateConnectorFillsDiagnosticsWithoutSecrets(t *testing.T) {
	now := time.Now().UTC()
	item := decorateConnector(integrationConnector{
		ID: "jira-1", Name: "Company Jira", State: "failed", Source: "Jira Cloud",
		LastSuccessAt: &now, FailedJobs: 2,
		Action: &integrationAction{Label: "Review failed jobs", Href: "/integrations/jira?tab=activity"},
	}, "Jira")
	if item.LastAttemptAt == nil || item.FailureReason != "2 failed jobs." {
		t.Fatalf("diagnostics = %+v", item)
	}
	if len(item.AffectedServices) != 1 || item.AffectedServices[0] != "Jira" {
		t.Fatalf("affected = %+v", item.AffectedServices)
	}
	if !strings.Contains(item.Recovery, "Review failed jobs") {
		t.Fatalf("recovery = %s", item.Recovery)
	}
	lower := strings.ToLower(item.FailureReason + " " + item.Recovery + " " + item.Detail)
	for _, word := range []string{"password", "secret", "token", "database_url", "hmac"} {
		if strings.Contains(lower, word) {
			t.Fatalf("diagnostics contained %s", word)
		}
	}
}
