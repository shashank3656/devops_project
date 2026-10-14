package main

import (
	"errors"
	"testing"
)

func driftActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"staging"}}},
	}
}

func installDriftMemory() {
	plans := map[string]driftPlan{}
	locks := map[string]bool{}
	reviews := map[int]driftReview{}
	nextPlan, nextReview := 1, 1
	key := func(environment, workspace, kind string) string { return environment + ":" + workspace + ":" + kind }
	lockKey := func(environment, workspace string) string { return environment + ":" + workspace }
	findDriftPlan = func(projectID int, environment, workspace, kind string) (driftPlan, error) {
		item := plans[key(environment, workspace, kind)]
		if item.ProjectID != 0 && item.ProjectID != projectID {
			return driftPlan{}, nil
		}
		return item, nil
	}
	saveDriftPlan = func(item driftPlan) (driftPlan, error) {
		item.ID = nextPlan
		nextPlan++
		item.ReadOnly = true
		item.CanApply = false
		plans[key(item.Environment, item.Workspace, item.Kind)] = item
		return item, nil
	}
	loadDriftPlan = func(id int) (driftPlan, error) {
		for _, item := range plans {
			if item.ID == id {
				item.ReadOnly = true
				return item, nil
			}
		}
		return driftPlan{}, nil
	}
	updateDriftPlan = func(item driftPlan) (driftPlan, error) {
		item.ReadOnly = true
		item.CanApply = false
		plans[key(item.Environment, item.Workspace, item.Kind)] = item
		return item, nil
	}
	listDriftPlans = func(projectID int, environment string) ([]driftPlan, error) {
		var items []driftPlan
		for _, item := range plans {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	driftLockHeld = func(projectID int, environment, workspace string) (bool, error) {
		return locks[lockKey(environment, workspace)], nil
	}
	setDriftLock = func(projectID int, environment, workspace string, held bool) error {
		locks[lockKey(environment, workspace)] = held
		return nil
	}
	saveDriftReview = func(item driftReview) (driftReview, error) {
		item.ID = nextReview
		nextReview++
		reviews[item.PlanID] = item
		return item, nil
	}
	findDriftReview = func(planID int) (driftReview, error) { return reviews[planID], nil }
	saveDriftAudit = func(int, string, int, string) error { return nil }
}

func TestManualChangeProducesDriftEvidence(t *testing.T) {
	installDriftMemory()
	operator := driftActor("operator", 10)
	plan, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", true, "manual attribute differs")
	if err != nil || plan.State != "drifted" || plan.Evidence != "manual attribute differs" || !plan.ReadOnly || plan.CanApply || plan.Observed != "unknown" {
		t.Fatalf("plan = %+v %v", plan, err)
	}
	again, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", true, "manual attribute differs")
	if err != nil || again.Applied || again.ID != plan.ID {
		t.Fatalf("replay = %+v %v", again, err)
	}
	refresh, err := recordDriftPlan(operator, 10, "staging", "billing", "refresh", true, "attribute refreshed")
	if err != nil || refresh.State != "refresh" || refresh.ID == plan.ID {
		t.Fatalf("refresh = %+v %v", refresh, err)
	}
	if _, err := openDriftReview(operator, refresh.ID, 9); !errors.Is(err, errDriftInvalid) {
		t.Fatalf("refresh review = %v", err)
	}
	if _, err := openDriftReview(operator, plan.ID, operator.UserID); !errors.Is(err, errDriftInvalid) {
		t.Fatalf("self review = %v", err)
	}
	review, err := openDriftReview(operator, plan.ID, 9)
	if err != nil || review.State != "proposed" || review.Applied {
		t.Fatalf("review = %+v %v", review, err)
	}
	kept, err := loadDriftPlan(plan.ID)
	if err != nil || kept.State != "drifted" || kept.CanApply {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	if _, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", true, "password=hidden"); !errors.Is(err, errDriftInvalid) {
		t.Fatalf("secret = %v", err)
	}
	if leaked, err := readDriftPlans(driftActor("operator", 11), 10, "staging"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
}

func TestInaccessibleStateReportsUnknown(t *testing.T) {
	installDriftMemory()
	operator := driftActor("operator", 10)
	plan, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", false, "manual attribute differs")
	if err != nil || plan.State != "unknown" || plan.Observed != "unknown" || plan.Evidence != "" || plan.CanApply {
		t.Fatalf("unknown = %+v %v", plan, err)
	}
	if _, err := recordDriftPlan(driftActor("viewer", 10), 10, "staging", "billing", "configuration", true, "manual attribute differs"); !errors.Is(err, errDriftDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordDriftPlan(operator, 10, "*", "billing", "configuration", true, "manual attribute differs"); !errors.Is(err, errDriftInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
}

func TestNoScanAppliesAChange(t *testing.T) {
	installDriftMemory()
	operator := driftActor("operator", 10)
	if err := holdDriftApply(operator, 10, "staging", "billing", true); err != nil {
		t.Fatal(err)
	}
	blocked, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", true, "manual attribute differs")
	if err != nil || blocked.State != "blocked" || blocked.CanApply || blocked.Applied {
		t.Fatalf("blocked = %+v %v", blocked, err)
	}
	if err := holdDriftApply(operator, 10, "staging", "billing", false); err != nil {
		t.Fatal(err)
	}
	plan, err := recordDriftPlan(operator, 10, "staging", "billing", "configuration", true, "manual attribute differs")
	if err != nil || plan.State != "drifted" || plan.CanApply {
		t.Fatalf("plan = %+v %v", plan, err)
	}
	refused, err := applyDriftPlan(operator, plan.ID)
	if !errors.Is(err, errDriftInvalid) || refused.CanApply || refused.Applied || refused.State != "drifted" {
		t.Fatalf("apply = %+v %v", refused, err)
	}
	kept, err := loadDriftPlan(plan.ID)
	if err != nil || kept.State != "drifted" || kept.Evidence != "manual attribute differs" {
		t.Fatalf("kept = %+v %v", kept, err)
	}
}
