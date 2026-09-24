package main

import "testing"

func TestDeployIntelRequiredCheckLabels(t *testing.T) {
	bp := buildDeployIntelBranchProtection("acme", "infra", "main")
	if len(bp.RequiredChecks) != 2 {
		t.Fatalf("checks = %d", len(bp.RequiredChecks))
	}
	if bp.RequiredChecks[0].Label != checkInfragatePlanReview {
		t.Fatalf("plan label = %s", bp.RequiredChecks[0].Label)
	}
	if bp.RequiredChecks[1].Label != checkInfragatePolicy {
		t.Fatalf("policy label = %s", bp.RequiredChecks[1].Label)
	}
}
