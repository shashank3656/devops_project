package main

import (
	"errors"
	"strings"
	"testing"
)

const sloDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func sloActor(role string, projectID int) authzSubject {
	userID := 4
	if role == "viewer" {
		userID = 5
	}
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"*"}}},
	}
}

func installSLOMemory() {
	definitions := map[int]sloDefinition{}
	evaluations := map[int]sloEvaluation{}
	watches := map[int]serviceWatch{}
	nextDef, nextEval, nextWatch := 1, 1, 1
	saveSLODefinition = func(item sloDefinition) (sloDefinition, error) {
		item.ID = nextDef
		nextDef++
		definitions[item.ID] = item
		return item, nil
	}
	findSLODefinition = func(projectID int, serviceKey, environment string, version int) (sloDefinition, error) {
		for _, item := range definitions {
			if item.ProjectID == projectID && item.ServiceKey == serviceKey && item.Environment == environment && item.Version == version {
				return item, nil
			}
		}
		return sloDefinition{}, nil
	}
	loadSLODefinition = func(id int) (sloDefinition, error) {
		item, ok := definitions[id]
		if !ok {
			return sloDefinition{}, errSLOHidden
		}
		return item, nil
	}
	latestSLODefinition = func(projectID int, serviceKey, environment string) (sloDefinition, error) {
		var latest sloDefinition
		for _, item := range definitions {
			if item.ProjectID == projectID && item.ServiceKey == serviceKey && item.Environment == environment && item.Version >= latest.Version {
				latest = item
			}
		}
		return latest, nil
	}
	saveSLOEvaluation = func(item sloEvaluation) (sloEvaluation, error) {
		item.ID = nextEval
		nextEval++
		evaluations[item.ID] = item
		return presentSLOEvaluation(item), nil
	}
	findSLOEvaluation = func(definitionID, sampleCount, coveredMinutes int, freshness string) (sloEvaluation, error) {
		for _, item := range evaluations {
			if item.DefinitionID == definitionID && item.SampleCount == sampleCount && item.CoveredMinutes == coveredMinutes && item.Freshness == freshness {
				return item, nil
			}
		}
		return sloEvaluation{}, nil
	}
	latestSLOEvaluation = func(definitionID int) (sloEvaluation, error) {
		var latest sloEvaluation
		for _, item := range evaluations {
			if item.DefinitionID == definitionID && item.ID >= latest.ID {
				latest = item
			}
		}
		return latest, nil
	}
	saveServiceWatch = func(item serviceWatch) (serviceWatch, error) {
		item.ID = nextWatch
		nextWatch++
		watches[item.ID] = item
		return item, nil
	}
	findServiceWatch = func(projectID, attemptID int) (serviceWatch, error) {
		for _, item := range watches {
			if item.ProjectID == projectID && item.AttemptID == attemptID {
				return item, nil
			}
		}
		return serviceWatch{}, nil
	}
	loadServiceWatch = func(id int) (serviceWatch, error) {
		item, ok := watches[id]
		if !ok {
			return serviceWatch{}, errSLOHidden
		}
		return item, nil
	}
	updateServiceWatch = func(item serviceWatch) (serviceWatch, error) {
		watches[item.ID] = item
		return item, nil
	}
	latestServiceWatch = func(definitionID int) (serviceWatch, error) {
		var latest serviceWatch
		for _, item := range watches {
			if item.DefinitionID == definitionID && item.ID >= latest.ID {
				latest = item
			}
		}
		return latest, nil
	}
	loadHealthAttempt = func(id int) (deploymentAttempt, error) {
		if id == 4 {
			return deploymentAttempt{ID: 4, ProjectID: 10, Environment: "dev", ImageDigest: sloDigest, State: "success"}, nil
		}
		if id == 5 {
			return deploymentAttempt{ID: 5, ProjectID: 10, Environment: "dev", ImageDigest: sloDigest, State: "failed"}, nil
		}
		return deploymentAttempt{}, errSLOHidden
	}
	saveSLOAudit = func(sloAuditRecord) error { return nil }
}

func sampleSLO(actor authzSubject) sloDefinition {
	saved, err := recordSLODefinition(actor, sloDefinitionInput{
		ProjectID: 10, ServiceKey: "api", Environment: "dev", Version: 1,
		Query: "rate(http_requests_total[5m])", ObjectiveBPS: 9900, WindowMinutes: 60, MinSamples: 30,
	})
	if err != nil {
		panic(err)
	}
	return saved
}

func TestMissingTelemetryIsUnknown(t *testing.T) {
	installSLOMemory()
	operator := sloActor("operator", 10)
	definition := sampleSLO(operator)
	again, err := recordSLODefinition(operator, sloDefinitionInput{
		ProjectID: 10, ServiceKey: "api", Environment: "dev", Version: 1,
		Query: "different", ObjectiveBPS: 100, WindowMinutes: 1, MinSamples: 2,
	})
	if err != nil || again.ID != definition.ID || again.Query != definition.Query {
		t.Fatalf("version retry = %+v %v", again, err)
	}
	for _, freshness := range []string{"", "missing", "unknown", "healthy"} {
		saved, err := recordSLOEvaluation(operator, sloEvaluationInput{DefinitionID: definition.ID, Freshness: freshness})
		if err != nil || saved.State != "unknown" || saved.Freshness != "missing" || saved.BudgetRemaining != nil || strings.Contains(saved.Reason, "healthy") {
			t.Fatalf("freshness %q = %+v %v", freshness, saved, err)
		}
	}
	stale, err := recordSLOEvaluation(operator, sloEvaluationInput{DefinitionID: definition.ID, SampleCount: 100, GoodCount: 100, CoveredMinutes: 60, Freshness: "stale"})
	if err != nil || stale.State != "unknown" || stale.Freshness != "stale" || stale.BudgetRemaining != nil {
		t.Fatalf("stale = %+v %v", stale, err)
	}
	if _, err := recordSLOEvaluation(sloActor("viewer", 10), sloEvaluationInput{DefinitionID: definition.ID, Freshness: "fresh", SampleCount: 40, GoodCount: 40, CoveredMinutes: 60}); !errors.Is(err, errSLODenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordSLODefinition(sloActor("operator", 11), sloDefinitionInput{ProjectID: 10, ServiceKey: "api", Environment: "dev", Version: 2, Query: "up", ObjectiveBPS: 9900, WindowMinutes: 60, MinSamples: 30}); !errors.Is(err, errSLOHidden) {
		t.Fatalf("other project = %v", err)
	}
	view, err := readServiceHealth(operator, 10, "api", "dev")
	if err != nil || view.State != "unknown" || view.BudgetRemaining != nil || view.BudgetFromWatch {
		t.Fatalf("health = %+v %v", view, err)
	}
}

func TestWatchSamplesDoNotBecomeBudget(t *testing.T) {
	installSLOMemory()
	operator := sloActor("operator", 10)
	definition := sampleSLO(operator)
	watch, err := startServiceWatch(operator, definition.ID, 4)
	if err != nil || watch.State != "watching" || watch.BudgetFromWatch || watch.ImageDigest != sloDigest {
		t.Fatalf("watch = %+v %v", watch, err)
	}
	again, err := startServiceWatch(operator, definition.ID, 4)
	if err != nil || again.ID != watch.ID {
		t.Fatalf("watch retry = %+v %v", again, err)
	}
	if _, err := startServiceWatch(operator, definition.ID, 5); !errors.Is(err, errSLOInvalid) {
		t.Fatalf("failed deployment = %v", err)
	}
	sampled, err := recordWatchSamples(operator, watch.ID, 100)
	if err != nil || sampled.SampleCount != 100 || sampled.BudgetFromWatch {
		t.Fatalf("samples = %+v %v", sampled, err)
	}
	if len(evaluationsFor(definition.ID)) != 0 {
		t.Fatal("watch samples created an evaluation")
	}
	short, err := recordSLOEvaluation(operator, sloEvaluationInput{DefinitionID: definition.ID, SampleCount: 3, GoodCount: 3, CoveredMinutes: 5, Freshness: "fresh"})
	if err != nil || short.State != "unknown" || short.Freshness != "partial" || short.BudgetRemaining != nil {
		t.Fatalf("short window = %+v %v", short, err)
	}
	view, err := readServiceHealth(operator, 10, "api", "dev")
	if err != nil || view.State != "unknown" || view.BudgetRemaining != nil || view.BudgetFromWatch {
		t.Fatalf("health after watch = %+v %v", view, err)
	}
	full, err := recordSLOEvaluation(operator, sloEvaluationInput{DefinitionID: definition.ID, SampleCount: 40, GoodCount: 40, CoveredMinutes: 60, Freshness: "fresh"})
	if err != nil || full.State != "evaluated" || full.BudgetRemaining == nil || *full.BudgetRemaining != 100 {
		t.Fatalf("full window = %+v %v", full, err)
	}
}

func TestFreezeHasSourceAndReleaseCriteria(t *testing.T) {
	installSLOMemory()
	operator := sloActor("operator", 10)
	definition := sampleSLO(operator)
	watch, err := startServiceWatch(operator, definition.ID, 4)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := freezeServiceWatch(operator, watch.ID, "", "full window meets the objective"); !errors.Is(err, errSLOInvalid) {
		t.Fatalf("missing source = %v", err)
	}
	if _, err := freezeServiceWatch(operator, watch.ID, sloDigest, ""); !errors.Is(err, errSLOInvalid) {
		t.Fatalf("missing criteria = %v", err)
	}
	current, _ := loadServiceWatch(watch.ID)
	if current.State != "watching" || current.Source != "" || current.ReleaseCriteria != "" {
		t.Fatalf("invalid freeze wrote %+v", current)
	}
	frozen, err := freezeServiceWatch(operator, watch.ID, sloDigest, "full window meets the objective")
	if err != nil || frozen.State != "frozen" || frozen.Source != sloDigest || frozen.ReleaseCriteria != "full window meets the objective" || frozen.BudgetFromWatch {
		t.Fatalf("freeze = %+v %v", frozen, err)
	}
	view, err := readServiceHealth(operator, 10, "api", "dev")
	if err != nil || view.State != "unknown" || view.WatchState != "frozen" || view.FreezeSource != sloDigest || view.ReleaseCriteria != "full window meets the objective" || view.BudgetRemaining != nil {
		t.Fatalf("health = %+v %v", view, err)
	}
}

func evaluationsFor(definitionID int) []sloEvaluation {
	latest, _ := latestSLOEvaluation(definitionID)
	if latest.ID == 0 {
		return nil
	}
	return []sloEvaluation{latest}
}
