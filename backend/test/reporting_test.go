package main

import (
	"errors"
	"testing"
)

var reportSourcesFail bool

func reportActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installReportMemory() {
	reportSourcesFail = false
	definitions := map[string]reportDefinition{}
	observations := map[string][]reportSource{}
	gates := map[string]bool{}
	drafts := map[int]reportDraft{}
	nextDefinition, nextDraft := 1, 1
	key := func(projectID int, environment, metric string) string {
		return environment + ":" + metric
	}
	saveReportDefinition = func(item reportDefinition) (reportDefinition, error) {
		item.ID = nextDefinition
		nextDefinition++
		definitions[key(item.ProjectID, item.Environment, item.Metric)] = item
		return item, nil
	}
	loadReportDefinition = func(projectID int, environment, metric string) (reportDefinition, error) {
		return definitions[key(projectID, environment, metric)], nil
	}
	loadReportDraftGate = func(projectID int, environment string) (bool, error) {
		return gates[environment], nil
	}
	saveReportDraftGate = func(projectID int, environment string, enabled bool) error {
		gates[environment] = enabled
		return nil
	}
	loadReportSources = func(projectID int, environment string) ([]reportSource, error) {
		if reportSourcesFail {
			return nil, errOutcomeInvalid
		}
		return observations[environment], nil
	}
	saveReportObservation = func(projectID int, environment string, source reportSource) error {
		observations[environment] = append(observations[environment], source)
		return nil
	}
	saveReportDraftRecord = func(item reportDraft) (reportDraft, error) {
		item.ID = nextDraft
		nextDraft++
		item.CanExecute = false
		drafts[item.ID] = item
		return item, nil
	}
	loadReportDraftRecord = func(id int) (reportDraft, error) {
		return drafts[id], nil
	}
	updateReportDraftRecord = func(item reportDraft) (reportDraft, error) {
		item.CanExecute = false
		drafts[item.ID] = item
		return item, nil
	}
	saveReportAudit = func(reportAudit) error { return nil }
}

func TestMetricDenominatorAndTimezone(t *testing.T) {
	installReportMemory()
	operator := reportActor("operator", 10)
	delivery, err := saveReport(operator, 10, "dev", "delivery")
	if err != nil || delivery.Denominator != "attempted deployments" || delivery.Timezone != "UTC" || delivery.Numerator != "delivered deployments" {
		t.Fatalf("delivery = %+v %v", delivery, err)
	}
	incident, err := saveReport(operator, 10, "dev", "incident")
	if err != nil || incident.Denominator != "services in the environment" || incident.Timezone != "UTC" {
		t.Fatalf("incident = %+v %v", incident, err)
	}
	remediation, err := saveReport(operator, 10, "dev", "remediation")
	if err != nil || remediation.Denominator != "findings with a recorded due date" || remediation.Timezone != "UTC" {
		t.Fatalf("remediation = %+v %v", remediation, err)
	}
	if _, err := saveReport(operator, 10, "dev", "custom"); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("custom metric = %v", err)
	}
	if _, err := saveReport(operator, 10, "*", "delivery"); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	if _, err := saveReport(reportActor("viewer", 10), 10, "dev", "delivery"); !errors.Is(err, errOutcomeDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := readReport(reportActor("operator", 11), 10, "dev", "delivery"); !errors.Is(err, errOutcomeHidden) {
		t.Fatalf("other project = %v", err)
	}
}

func TestMissingDataIsDisclosed(t *testing.T) {
	installReportMemory()
	operator := reportActor("operator", 10)
	if _, err := saveReport(operator, 10, "dev", "incident"); err != nil {
		t.Fatal(err)
	}
	unknown, err := readReport(operator, 10, "dev", "incident")
	if err != nil || unknown.Coverage != "unknown" || !unknown.Disclosed || unknown.Numerator != 0 || len(unknown.Missing) != 2 {
		t.Fatalf("unknown = %+v %v", unknown, err)
	}
	if err := recordReportObservation(operator, 10, "dev", reportSource{ID: "incidents", Present: true, Numerator: 2, Denominator: 3}); err != nil {
		t.Fatal(err)
	}
	partial, err := readReport(operator, 10, "dev", "incident")
	if err != nil || partial.Coverage != "partial" || !partial.Disclosed || partial.Numerator != 0 || len(partial.Missing) != 1 || partial.Missing[0] != "services" {
		t.Fatalf("partial = %+v %v", partial, err)
	}
	if err := recordReportObservation(operator, 10, "dev", reportSource{ID: "incidents", Present: true, Numerator: 0, Denominator: 0}); err != nil {
		t.Fatal(err)
	}
	if err := recordReportObservation(operator, 10, "dev", reportSource{ID: "services", Present: true, Numerator: 0, Denominator: 0}); err != nil {
		t.Fatal(err)
	}
	empty, err := readReport(operator, 10, "dev", "incident")
	if err != nil || empty.Coverage != "empty" || !empty.Disclosed || empty.Timezone != "UTC" {
		t.Fatalf("empty = %+v %v", empty, err)
	}
	if _, err := saveReport(operator, 10, "dev", "delivery"); err != nil {
		t.Fatal(err)
	}
	reportSourcesFail = true
	failed, err := readReport(operator, 10, "dev", "delivery")
	if err != nil || failed.Coverage != "unknown" || !failed.Disclosed || failed.Numerator != 0 {
		t.Fatalf("source failure = %+v %v", failed, err)
	}
}

func TestDraftCitesSourcesAndCannotExecute(t *testing.T) {
	installReportMemory()
	operator := reportActor("operator", 10)
	if _, err := saveReport(operator, 10, "dev", "delivery"); err != nil {
		t.Fatal(err)
	}
	if err := recordReportObservation(operator, 10, "dev", reportSource{ID: "deployments", Present: true, Numerator: 1, Denominator: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := saveDraft(operator, 10, "dev", "delivery", "One delivery is recorded.", []string{"deployments"}); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("flag off = %v", err)
	}
	if err := setReportDrafts(operator, 10, "dev", true); err != nil {
		t.Fatal(err)
	}
	if _, err := saveDraft(operator, 10, "dev", "delivery", "Please execute the rollback.", []string{"deployments"}); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("execute text = %v", err)
	}
	if _, err := saveDraft(operator, 10, "dev", "delivery", "Cited draft.", []string{"other"}); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("unknown citation = %v", err)
	}
	draft, err := saveDraft(operator, 10, "dev", "delivery", "Delivered deployments are cited.", []string{"deployments"})
	if err != nil || draft.CanExecute || draft.State != "draft" || len(draft.Citations) != 1 || draft.Citations[0] != "deployments" {
		t.Fatalf("draft = %+v %v", draft, err)
	}
	if _, err := publishDraft(operator, draft.ID, operator.UserID); !errors.Is(err, errOutcomeInvalid) {
		t.Fatalf("self review = %v", err)
	}
	published, err := publishDraft(operator, draft.ID, 9)
	if err != nil || published.State != "published" || published.CanExecute || published.ReviewerID != 9 {
		t.Fatalf("published = %+v %v", published, err)
	}
	if _, err := saveDraft(reportActor("viewer", 10), 10, "dev", "delivery", "Cited draft.", []string{"deployments"}); !errors.Is(err, errOutcomeDenied) {
		t.Fatalf("viewer = %v", err)
	}
}
