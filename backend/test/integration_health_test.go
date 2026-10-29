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

func integrationBillingFamilyFromConnections(conns []costConnection) integrationFamily {
	return billingFamilyFrom(conns)
}
