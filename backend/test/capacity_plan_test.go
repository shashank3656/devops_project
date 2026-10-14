package main

import (
	"testing"
	"time"
)

func capacityFixture(at time.Time) capacityInput {
	return capacityInput{
		Service:          "checkout",
		Timezone:         "America/New_York",
		TrafficSource:    "campaign",
		WorkloadRevision: "rev-1",
		Assumptions: capacityAssumptions{
			Headroom: 0.2, ExpectedRPS: 250, StressRPS: 400, Note: "campaign peak",
		},
		Evidence: &capacityEvidence{
			Unit: "rps", SustainableRPS: 100, ObservedAt: at, WorkloadRevision: "rev-1", Bottleneck: "database pool",
		},
		Limits: capacityLimits{NodeCapacity: 8, DatabaseQuota: 200, DependencyLimit: 4},
	}
}

func TestCapacityReplicaFormulaRoundsUp(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	result, err := planCapacity(at, capacityFixture(at))
	if err != nil {
		t.Fatal(err)
	}
	if result.Formula != capacityFormula || result.Minimum != 3 || result.Maximum != 5 || result.Readiness != "review" {
		t.Fatalf("fixture = %#v", result)
	}
	rounded := capacityFixture(at)
	rounded.Evidence.SustainableRPS = 80
	rounded.Assumptions.ExpectedRPS = 100
	rounded.Assumptions.StressRPS = 0
	rounded.Assumptions.Headroom = 0.1
	up, err := planCapacity(at, rounded)
	if err != nil {
		t.Fatal(err)
	}
	if up.Minimum != 2 || up.Maximum != 2 {
		t.Fatalf("round up = %#v", up)
	}
	invalid := capacityFixture(at)
	invalid.Evidence.Unit = "rpm"
	if _, err := planCapacity(at, invalid); err != errCapacityInvalid {
		t.Fatalf("invalid unit = %v", err)
	}
	zero := capacityFixture(at)
	zero.Evidence.SustainableRPS = 0
	if _, err := planCapacity(at, zero); err != errCapacityInvalid {
		t.Fatalf("zero capacity = %v", err)
	}
}

func TestCapacityMissingEvidenceAndQuotaStayBlocked(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	missing := capacityFixture(at)
	missing.Evidence = nil
	unknown, err := planCapacity(at, missing)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.Readiness != "unknown" || unknown.Minimum != 0 || !capacityHasBlocker(unknown, "load evidence missing") {
		t.Fatalf("missing evidence = %#v", unknown)
	}
	if unknown.Readiness == "ready" || unknown.Readiness == "healthy" {
		t.Fatal("missing evidence looked ready")
	}
	quota := capacityFixture(at)
	quota.Limits.DatabaseQuota = 0
	blocked, err := planCapacity(at, quota)
	if err != nil {
		t.Fatal(err)
	}
	if blocked.Readiness != "blocked" || !capacityHasBlocker(blocked, "database quota missing") || blocked.Readiness == "healthy" {
		t.Fatalf("quota = %#v", blocked)
	}
	failed := capacityFixture(at)
	failed.Evidence.Failed = true
	external, err := planCapacity(at, failed)
	if err != nil {
		t.Fatal(err)
	}
	if external.Readiness != "unknown" || !capacityHasBlocker(external, "load evidence failed") {
		t.Fatalf("external failure = %#v", external)
	}
}

func TestCapacityApprovalInvalidatesAndDoesNotExecute(t *testing.T) {
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	input := capacityFixture(at)
	var plan capacityPlan
	if _, err := applyCapacityInput(&plan, input, at); err != nil {
		t.Fatal(err)
	}
	if err := approveCapacity(&plan, "change-1", true, true); err != nil {
		t.Fatal(err)
	}
	if err := approveCapacity(&plan, "change-1", true, true); err != nil {
		t.Fatal(err)
	}
	if len(plan.ChangeRefs) != 1 || plan.Result.ChangeRef != "change-1" || plan.Result.Executed {
		t.Fatalf("retry = %#v", plan)
	}
	input.Assumptions.ExpectedRPS = 500
	updated, err := applyCapacityInput(&plan, input, at)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Approved || updated.Readiness == "approved" {
		t.Fatalf("changed target stayed approved: %#v", updated)
	}
	input.Assumptions.ExpectedRPS = 250
	input.Assumptions.Note = "revised assumption"
	revised, err := applyCapacityInput(&plan, input, at)
	if err != nil {
		t.Fatal(err)
	}
	if revised.Approved {
		t.Fatal("changed assumption stayed approved")
	}
	input.Assumptions.Note = "campaign peak"
	input.WorkloadRevision = "rev-2"
	input.Evidence.WorkloadRevision = "rev-1"
	mismatched, err := applyCapacityInput(&plan, input, at)
	if err != nil {
		t.Fatal(err)
	}
	if mismatched.Readiness != "unknown" || mismatched.Minimum != 0 || mismatched.Approved {
		t.Fatalf("revision mismatch = %#v", mismatched)
	}
	if err := executeCapacity(&plan); err != errCapacityInvalid || plan.Result.Executed {
		t.Fatalf("execute mutated the plan: %#v", plan.Result)
	}
	if err := approveCapacity(&plan, "change-2", false, true); err != errCapacityDenied {
		t.Fatalf("revoked member = %v", err)
	}
	if err := approveCapacity(&plan, "change-2", true, false); err != errCapacityHidden {
		t.Fatalf("other project = %v", err)
	}
}

func capacityHasBlocker(result capacityResult, want string) bool {
	for _, blocker := range result.Blockers {
		if blocker == want {
			return true
		}
	}
	return false
}
