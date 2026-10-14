package main

import (
	"errors"
	"strings"
	"testing"
)

func bootstrapActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"staging"}}},
	}
}

func installBootstrapMemory() {
	records := map[string]serviceBootstrap{}
	steps := map[string]bootstrapStep{}
	reviews := map[int]bootstrapReview{}
	nextRecord, nextStep, nextReview := 1, 1, 1
	key := func(environment, service string) string { return environment + ":" + service }
	stepKey := func(id int, name string) string {
		return strings.Repeat("x", id) + ":" + name
	}
	findServiceBootstrap = func(projectID int, environment, service string) (serviceBootstrap, error) {
		item := records[key(environment, service)]
		if item.ProjectID != 0 && item.ProjectID != projectID {
			return serviceBootstrap{}, nil
		}
		return item, nil
	}
	saveServiceBootstrap = func(item serviceBootstrap) (serviceBootstrap, error) {
		item.ID = nextRecord
		nextRecord++
		item.Applied = true
		records[key(item.Environment, item.Service)] = item
		return item, nil
	}
	loadServiceBootstrap = func(id int) (serviceBootstrap, error) {
		for _, item := range records {
			if item.ID == id {
				return item, nil
			}
		}
		return serviceBootstrap{}, nil
	}
	updateServiceBootstrap = func(item serviceBootstrap) (serviceBootstrap, error) {
		item.Applied = true
		item.CanApply = false
		records[key(item.Environment, item.Service)] = item
		return item, nil
	}
	listServiceBootstraps = func(projectID int, environment string) ([]serviceBootstrap, error) {
		var items []serviceBootstrap
		for _, item := range records {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	findBootstrapStep = func(bootstrapID int, name string) (bootstrapStep, error) {
		return steps[stepKey(bootstrapID, name)], nil
	}
	saveBootstrapStep = func(item bootstrapStep) (bootstrapStep, error) {
		item.ID = nextStep
		nextStep++
		item.Applied = true
		steps[stepKey(item.BootstrapID, item.Name)] = item
		return item, nil
	}
	updateBootstrapStep = func(item bootstrapStep) (bootstrapStep, error) {
		item.Applied = true
		steps[stepKey(item.BootstrapID, item.Name)] = item
		return item, nil
	}
	listBootstrapSteps = func(bootstrapID int) ([]bootstrapStep, error) {
		var items []bootstrapStep
		for _, item := range steps {
			if item.BootstrapID == bootstrapID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	findBootstrapReview = func(bootstrapID int) (bootstrapReview, error) { return reviews[bootstrapID], nil }
	saveBootstrapReview = func(item bootstrapReview) (bootstrapReview, error) {
		item.ID = nextReview
		nextReview++
		reviews[item.BootstrapID] = item
		return item, nil
	}
	saveBootstrapAudit = func(int, string, int, string) error { return nil }
}

func TestRetryCreatesNoDuplicateService(t *testing.T) {
	installBootstrapMemory()
	operator := bootstrapActor("operator", 10)
	item, err := recordServiceBootstrap(operator, 10, "staging", "billing", "go", 3)
	if err != nil || item.State != "staged" || item.Version != 3 || item.Observed != "unknown" || item.CanApply || item.CIValid {
		t.Fatalf("bootstrap = %+v %v", item, err)
	}
	again, err := recordServiceBootstrap(operator, 10, "staging", "billing", "go", 4)
	if err != nil || again.Applied || again.ID != item.ID || again.Version != 3 {
		t.Fatalf("retry = %+v %v", again, err)
	}
	if _, err := recordServiceBootstrap(operator, 10, "production", "billing", "go", 3); !errors.Is(err, errBootstrapInvalid) {
		t.Fatalf("production = %v", err)
	}
	if _, err := recordServiceBootstrap(operator, 10, "staging", "billing", "python", 3); err == nil {
		t.Fatal("language accepted")
	}
	if leaked, err := readServiceBootstraps(bootstrapActor("operator", 11), 10, "staging"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
}

func TestGeneratedCIValidates(t *testing.T) {
	installBootstrapMemory()
	operator := bootstrapActor("operator", 10)
	item, err := recordServiceBootstrap(operator, 10, "staging", "billing", "go", 3)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateBootstrapPipeline(operator, item.ID); !errors.Is(err, errBootstrapInvalid) {
		t.Fatalf("early pipeline = %v", err)
	}
	if _, err := recordBootstrapStep(operator, item.ID, "telemetry", true); !errors.Is(err, errBootstrapInvalid) {
		t.Fatalf("skipped catalog = %v", err)
	}
	for _, name := range []string{"catalog", "telemetry", "security"} {
		step, err := recordBootstrapStep(operator, item.ID, name, true)
		if err != nil || step.State != "passed" || step.Attempts != 1 {
			t.Fatalf("%s = %+v %v", name, step, err)
		}
	}
	validated, err := validateBootstrapPipeline(operator, item.ID)
	if err != nil || !validated.CIValid || validated.State != "validated" || validated.CanApply || validated.Version != 3 || validated.Observed != "unknown" {
		t.Fatalf("pipeline = %+v %v", validated, err)
	}
	again, err := validateBootstrapPipeline(operator, item.ID)
	if err != nil || again.Applied || !again.CIValid {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := openBootstrapReview(operator, item.ID, operator.UserID); !errors.Is(err, errBootstrapInvalid) {
		t.Fatalf("self = %v", err)
	}
	review, err := openBootstrapReview(operator, item.ID, 9)
	if err != nil || review.State != "proposed" || review.Applied {
		t.Fatalf("review = %+v %v", review, err)
	}
	kept, err := loadServiceBootstrap(item.ID)
	if err != nil || kept.CanApply || kept.State != "validated" {
		t.Fatalf("kept = %+v %v", kept, err)
	}
}

func TestFailedStepResumesSafely(t *testing.T) {
	installBootstrapMemory()
	operator := bootstrapActor("operator", 10)
	item, err := recordServiceBootstrap(operator, 10, "staging", "billing", "go", 3)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := recordBootstrapStep(operator, item.ID, "catalog", true)
	if err != nil {
		t.Fatal(err)
	}
	failed, err := recordBootstrapStep(operator, item.ID, "telemetry", false)
	if err != nil || failed.State != "failed" || failed.Attempts != 1 {
		t.Fatalf("failed = %+v %v", failed, err)
	}
	resumed, err := recordBootstrapStep(operator, item.ID, "telemetry", true)
	if err != nil || resumed.ID != failed.ID || resumed.State != "passed" || resumed.Attempts != 2 {
		t.Fatalf("resumed = %+v %v", resumed, err)
	}
	kept, err := findBootstrapStep(item.ID, "catalog")
	if err != nil || kept.ID != catalog.ID || kept.State != "passed" || kept.Attempts != 1 {
		t.Fatalf("catalog = %+v %v", kept, err)
	}
	same, err := recordServiceBootstrap(operator, 10, "staging", "billing", "go", 9)
	if err != nil || same.ID != item.ID || same.Applied {
		t.Fatalf("service = %+v %v", same, err)
	}
	if _, err := recordBootstrapStep(bootstrapActor("viewer", 10), item.ID, "security", true); !errors.Is(err, errBootstrapDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordServiceBootstrap(operator, 10, "*", "other", "go", 3); !errors.Is(err, errBootstrapInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	bound, err := recordServiceBootstrap(operator, 10, "staging", "ledger", "go", 3)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recordBootstrapStep(operator, bound.ID, "catalog", true); err != nil {
		t.Fatal(err)
	}
	var last bootstrapStep
	for i := 0; i < 4; i++ {
		last, err = recordBootstrapStep(operator, bound.ID, "telemetry", false)
		if err != nil {
			t.Fatal(err)
		}
	}
	if last.Attempts != 3 || last.State != "failed" || last.Reason != "retry bound reached" {
		t.Fatalf("bound = %+v", last)
	}
}
