package main

import "testing"

func TestEstimateMonthlyCostUsesBandRangeNotConcatenatedDigits(t *testing.T) {
	estimate, low, high, _, exact := estimateMonthlyCost("aws", "rds", "dev", "")
	if exact {
		t.Fatal("band estimate must not be marked exact")
	}
	if low != 400 || high != 1500 || estimate != 950 {
		t.Fatalf("rds dev = %d (%d-%d), want 950 (400-1500)", estimate, low, high)
	}
	if estimate, _, _, _, _ := estimateMonthlyCost("aws", "alb", "dev", ""); estimate != 62 {
		t.Fatalf("alb dev = %d, want 62", estimate)
	}
}

func TestEstimateMonthlyCostInstanceTableDoublesInProd(t *testing.T) {
	estimate, low, high, _, exact := estimateMonthlyCost("aws", "rds", "prod", "db.t3.small")
	if !exact || estimate != 56 || low != 56 || high != 56 {
		t.Fatalf("got %d (%d-%d) exact=%v, want 56 exact", estimate, low, high, exact)
	}
}

func TestBuildCostGuardrailBudget(t *testing.T) {
	over := buildCostGuardrail(costGuardrailInput{Service: "alb", Env: "dev", Budget: 50})
	if over.Allowed || over.Warning == "" || over.RiskLevel != "high" {
		t.Fatalf("expected over-budget block, got %+v", over)
	}
	if over.BudgetUsedPct != 124 {
		t.Fatalf("budget pct = %d, want 124", over.BudgetUsedPct)
	}

	near := buildCostGuardrail(costGuardrailInput{Service: "alb", Env: "dev", Budget: 70})
	if !near.Allowed || near.Warning == "" {
		t.Fatalf("expected near-budget warning, got %+v", near)
	}

	none := buildCostGuardrail(costGuardrailInput{Service: "alb", Env: "dev"})
	if !none.Allowed || none.Warning != "" || none.BudgetUsedPct != 0 {
		t.Fatalf("no budget should never warn, got %+v", none)
	}
}

func TestBuildCostGuardrailRisk(t *testing.T) {
	cases := []struct {
		name string
		in   costGuardrailInput
		want string
	}{
		{"dev stateless", costGuardrailInput{Service: "alb", Env: "dev"}, "low"},
		{"prod stateless", costGuardrailInput{Service: "alb", Env: "prod"}, "medium"},
		{"prod stateful", costGuardrailInput{Service: "rds", Env: "production"}, "high"},
		{"freeze", costGuardrailInput{Service: "alb", Env: "prod", FreezeActive: true}, "high"},
	}
	for _, tc := range cases {
		got := buildCostGuardrail(tc.in)
		if got.RiskLevel != tc.want {
			t.Errorf("%s: risk = %q, want %q", tc.name, got.RiskLevel, tc.want)
		}
		if len(got.ImpactNotes) == 0 {
			t.Errorf("%s: expected impact notes", tc.name)
		}
	}
}

func TestGuardrailApprovalPathWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if got := guardrailApprovalPath(1, 1, "team", "dev"); len(got) != 0 {
		t.Fatalf("expected empty path without DB, got %v", got)
	}
}
