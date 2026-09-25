package main

import "testing"

func TestSLOFreezeReasonFormat(t *testing.T) {
	budget := serviceSLOBudget{
		serviceSLO:   serviceSLO{Service: "checkout", Environment: "prod"},
		FreezeReason: "Error budget burned for checkout in prod",
	}
	reason := formatSLOFreezeReason(budget)
	if !isSLOFreezeReason(reason) {
		t.Fatalf("expected slo prefix, got %s", reason)
	}
	if got := sloFreezeIdentityFromReason(reason); got != "slo:checkout/prod" {
		t.Fatalf("identity %s", got)
	}
	if isSLOFreezeReason("payroll freeze") {
		t.Fatal("manual freeze is not an SLO freeze")
	}
}

func TestBurnedBudgetWritesFreezeShape(t *testing.T) {
	slo := serviceSLO{Service: "api", Environment: "prod", ErrorRatio: 0.01, FreezeOnBudget: true}
	budget := computeErrorBudget(slo, []serviceMetrics{
		{ErrorRatio: 0.2},
		{ErrorRatio: 0.3},
		{ErrorRatio: 0.4},
	})
	if !budget.Burned {
		t.Fatal("expected burned budget")
	}
	if !isSLOFreezeReason(formatSLOFreezeReason(budget)) {
		t.Fatalf("%s", formatSLOFreezeReason(budget))
	}
}

func TestBuiltinPolicyBlocksSLOFreezeReason(t *testing.T) {
	denied := evaluateBuiltinPolicies("change", map[string]any{
		"environment":   "prod",
		"change_type":   "standard",
		"weekday":       "Tuesday",
		"freeze_reason": formatSLOFreezeReason(serviceSLOBudget{serviceSLO: serviceSLO{Service: "api", Environment: "prod"}, FreezeReason: "Error budget burned"}),
	})
	if len(denied) == 0 {
		t.Fatal("expected freeze deny")
	}
}

func TestEmergencyIncidentBypassesWithoutCatalog(t *testing.T) {
	if emergencyIncidentBypassesFreeze("checkout", "prod") {
		t.Fatal("empty catalog must not bypass")
	}
}
