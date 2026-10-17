package main

import (
	"errors"
	"testing"
)

func automationActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installAutomationMemory() {
	rules := map[int]automationRule{}
	runs := map[int]automationRun{}
	attempts := map[int][]string{}
	nextRule, nextRun := 1, 1
	saveAutomationRule = func(item automationRule) (automationRule, error) {
		item.ID = nextRule
		nextRule++
		rules[item.ID] = item
		return item, nil
	}
	findAutomationVersion = func(projectID int, environment, trigger, action string) (int, error) {
		version := 0
		for id := 1; id < nextRule; id++ {
			item := rules[id]
			if item.ProjectID == projectID && item.Environment == environment && item.Trigger == trigger && item.Action == action && item.Version > version {
				version = item.Version
			}
		}
		return version, nil
	}
	loadAutomationRule = func(id int) (automationRule, error) {
		item, ok := rules[id]
		if !ok {
			return automationRule{}, errAutomationHidden
		}
		return item, nil
	}
	latestAutomationRule = func(projectID int, environment, trigger string) (automationRule, error) {
		var latest automationRule
		for id := 1; id < nextRule; id++ {
			item := rules[id]
			if item.ProjectID == projectID && item.Environment == environment && item.Trigger == trigger && item.Enabled && item.Version >= latest.Version {
				latest = item
			}
		}
		return latest, nil
	}
	updateAutomationRule = func(item automationRule) (automationRule, error) {
		rules[item.ID] = item
		return item, nil
	}
	findAutomationRun = func(projectID int, environment, key string) (automationRun, error) {
		for id := 1; id < nextRun; id++ {
			item := runs[id]
			if item.ProjectID == projectID && item.Environment == environment && item.ExecutionKey == key {
				return item, nil
			}
		}
		return automationRun{}, nil
	}
	loadAutomationRunByID = func(id int) (automationRun, error) {
		item, ok := runs[id]
		if !ok {
			return automationRun{}, errAutomationHidden
		}
		return item, nil
	}
	saveAutomationRun = func(item automationRun) (automationRun, error) {
		item.ID = nextRun
		nextRun++
		runs[item.ID] = item
		return item, nil
	}
	updateAutomationRun = func(item automationRun) (automationRun, error) {
		current := runs[item.ID]
		current.State = item.State
		current.Attempts = item.Attempts
		current.Applied = item.Applied
		current.Reason = item.Reason
		runs[item.ID] = current
		return current, nil
	}
	saveAutomationAttempt = func(runID, attempt int, state string) error {
		attempts[runID] = append(attempts[runID], state)
		return nil
	}
	countAutomationAttempts = func(runID int) (int, error) {
		return len(attempts[runID]), nil
	}
	saveAutomationAudit = func(automationAudit) error { return nil }
}

func TestReplayDoesNotDoubleNotify(t *testing.T) {
	installAutomationMemory()
	operator := automationActor("operator", 10)
	rule, err := saveAutomation(operator, 10, "dev", "assignment", "notify")
	if err != nil || rule.Version != 1 || rule.Action != "notify" || !rule.Enabled {
		t.Fatalf("rule = %+v %v", rule, err)
	}
	if _, err := saveAutomation(operator, 10, "dev", "assignment", "execute"); !errors.Is(err, errAutomationInvalid) {
		t.Fatalf("execute action = %v", err)
	}
	next, err := saveAutomation(operator, 10, "dev", "assignment", "notify")
	if err != nil || next.Version != 2 || next.ID == rule.ID {
		t.Fatalf("version = %+v %v", next, err)
	}
	first, err := executeAutomation(operator, 10, "dev", "assignment", "finding", "finding-1", "delivered", 0)
	if err != nil || !first.Applied || first.Attempts != 1 || first.Version != 2 {
		t.Fatalf("first = %+v %v", first, err)
	}
	again, err := executeAutomation(operator, 10, "dev", "assignment", "finding", "finding-1", "delivered", 0)
	if err != nil || again.Applied || again.ID != first.ID || again.Attempts != 1 || again.Reason != "duplicate execution" {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := executeAutomation(operator, 10, "dev", "assignment", "automation", "finding-1", "delivered", 0); !errors.Is(err, errAutomationInvalid) {
		t.Fatalf("loop source = %v", err)
	}
	if _, err := executeAutomation(operator, 10, "dev", "assignment", "finding", "finding-2", "delivered", 2); !errors.Is(err, errAutomationInvalid) {
		t.Fatalf("depth = %v", err)
	}
	if _, err := saveAutomation(automationActor("viewer", 10), 10, "dev", "overdue", "notify"); !errors.Is(err, errAutomationDenied) {
		t.Fatalf("viewer = %v", err)
	}
}

func TestDisabledRuleStopsNewActions(t *testing.T) {
	installAutomationMemory()
	operator := automationActor("operator", 10)
	rule, err := saveAutomation(operator, 10, "dev", "expiry", "notify")
	if err != nil {
		t.Fatal(err)
	}
	disabled, err := disableAutomation(operator, rule.ID)
	if err != nil || disabled.Enabled {
		t.Fatalf("disabled = %+v %v", disabled, err)
	}
	if _, err := executeAutomation(operator, 10, "dev", "expiry", "exception", "exception-1", "delivered", 0); !errors.Is(err, errAutomationInvalid) {
		t.Fatalf("disabled run = %v", err)
	}
	if found, _ := findAutomationRun(10, "dev", "expiry:exception:exception-1:v1"); found.ID != 0 {
		t.Fatalf("disabled wrote a run: %+v", found)
	}
	if _, err := executeAutomation(automationActor("operator", 11), 10, "dev", "expiry", "exception", "exception-1", "delivered", 0); !errors.Is(err, errAutomationHidden) {
		t.Fatalf("other project = %v", err)
	}
}

func TestFailureStaysVisibleAndRetryable(t *testing.T) {
	installAutomationMemory()
	operator := automationActor("operator", 10)
	if _, err := saveAutomation(operator, 10, "dev", "scan_health", "notify"); err != nil {
		t.Fatal(err)
	}
	failed, err := executeAutomation(operator, 10, "dev", "scan_health", "scan", "scan-1", "failed", 1)
	if err != nil || failed.State != "failed" || failed.Attempts != 1 {
		t.Fatalf("failed = %+v %v", failed, err)
	}
	retried, err := retryAutomation(operator, failed.ID, "failed")
	if err != nil || retried.State != "failed" || retried.Attempts != 2 || !retried.Applied {
		t.Fatalf("retry = %+v %v", retried, err)
	}
	again, err := retryAutomation(operator, failed.ID, "failed")
	if err != nil || again.Attempts != 3 || again.State != "failed" {
		t.Fatalf("second retry = %+v %v", again, err)
	}
	bound, err := retryAutomation(operator, failed.ID, "delivered")
	if err != nil || bound.Applied || bound.Attempts != 3 || bound.State != "failed" || bound.Reason != "retry bound reached" {
		t.Fatalf("bound = %+v %v", bound, err)
	}
	visible, err := loadAutomationRun(failed.ID)
	if err != nil || visible.State != "failed" || visible.Attempts != 3 {
		t.Fatalf("visible = %+v %v", visible, err)
	}
}
