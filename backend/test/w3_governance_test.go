package main

import (
	"strings"
	"testing"
)

func TestEvaluateRegoDenyEquality(t *testing.T) {
	rego := `
deny[msg] {
  input.environment == "prod"
  input.public == true
  msg := "no public prod"
}
`
	denied := evaluateRegoDeny(rego, map[string]any{"environment": "prod", "public": true})
	if len(denied) != 1 || denied[0] != "no public prod" {
		t.Fatalf("expected deny, got %v", denied)
	}
	if msgs := evaluateRegoDeny(rego, map[string]any{"environment": "dev", "public": true}); len(msgs) != 0 {
		t.Fatalf("dev should pass, got %v", msgs)
	}
}

func TestBuiltinFridayProdCAB(t *testing.T) {
	denied := evaluateBuiltinPolicies("change", map[string]any{
		"environment":  "prod",
		"change_type":  "standard",
		"weekday":      "Friday",
		"cab_approved": false,
	})
	if len(denied) == 0 {
		t.Fatal("expected Friday prod deny")
	}
	if msgs := evaluateBuiltinPolicies("change", map[string]any{
		"environment":  "prod",
		"change_type":  "standard",
		"weekday":      "Friday",
		"cab_approved": true,
	}); len(msgs) != 0 {
		t.Fatalf("CAB should pass, got %v", msgs)
	}
}

func TestParseChangeWebhookInfracost(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/api",
		"sha":"abc123",
		"title":"cost",
		"infracost_report":{"totalMonthlyCost":"80","diffTotalMonthlyCost":"12","currency":"USD"}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	report, err := parseInfracostReport(payload.InfracostReport)
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasDiff || report.DiffTotalMonthlyCost != 12 || report.TotalMonthlyCost != 80 {
		t.Fatalf("%+v", report)
	}
}

func TestEvidenceMarkdownIncludesCostAndPolicy(t *testing.T) {
	md := evidenceMarkdown(evidencePack{
		Summary: "1 change",
		Changes: []changeRequestRecord{{
			ChangeNumber:          "CHG1",
			Repo:                  "acme/api",
			SHA:                   "abc",
			Status:                "resolved",
			WatchResult:           "clean",
			CABApprovedByUsername: "dana",
			PolicyStatus:          "fail",
			CostCurrency:          "USD",
			CostDeltaUSD:          4.5,
		}},
		BranchProtection: []evidenceProtection{{
			Repo:           "acme/api",
			BaseBranch:     "main",
			RequiredChecks: []string{"infragate/policy"},
			Onboarded:      true,
		}},
	})
	for _, needle := range []string{"CHG1", "policy=fail", "USD4.50", "watch=clean", "approved_by=dana", "infragate/policy"} {
		if !strings.Contains(md, needle) {
			t.Fatalf("markdown missing %q:\n%s", needle, md)
		}
	}
}

func TestChangeWatchResult(t *testing.T) {
	if changeWatchResult(changeRequestRecord{Status: "resolved"}) != "clean" {
		t.Fatal("resolved")
	}
	if changeWatchResult(changeRequestRecord{Status: "failed"}) != "failed" {
		t.Fatal("failed")
	}
	if changeWatchResult(changeRequestRecord{Status: "monitoring"}) != "watching" {
		t.Fatal("watching")
	}
}

func TestServiceDoraFailureRate(t *testing.T) {
	metrics := serviceDoraMetrics(10, 1, []float64{4}, []float64{2}, 30)
	if !doraFailureRateOK(metrics) {
		t.Fatalf("10%% should pass %+v", metrics)
	}
	bad := serviceDoraMetrics(4, 2, nil, nil, 30)
	if doraFailureRateOK(bad) {
		t.Fatalf("50%% should fail %+v", bad)
	}
}

func TestBuiltinFreezeBlocksProd(t *testing.T) {
	denied := evaluateBuiltinPolicies("change", map[string]any{
		"environment":   "prod",
		"change_type":   "standard",
		"weekday":       "Monday",
		"freeze_reason": "payroll freeze",
	})
	if len(denied) == 0 || !strings.Contains(denied[0], "payroll freeze") {
		t.Fatalf("expected freeze deny, got %v", denied)
	}
}

func TestFilterScorecardsForProjects(t *testing.T) {
	one := 1
	two := 2
	items := []serviceScorecard{
		{Service: "api", ProjectID: &one, Score: 80},
		{Service: "web", ProjectID: &two, Score: 40},
		{Service: "orphan", Score: 10},
	}
	out := filterScorecardsForProjects(items, projectIDSet([]int{1}))
	if len(out) != 1 || out[0].Service != "api" {
		t.Fatalf("%+v", out)
	}
}

func TestMCPIncludesScorecards(t *testing.T) {
	found := false
	for _, name := range mcpToolNames() {
		if name == "list_scorecards" {
			found = true
		}
	}
	if !found {
		t.Fatal("list_scorecards missing")
	}
}
