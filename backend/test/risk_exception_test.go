package main

import (
	"testing"
	"time"
)

type riskMem struct {
	items  []riskException
	events []riskExceptionEvent
	audits int
}

func (m *riskMem) install() func() {
	previousSave := saveRiskException
	previousFind := findRiskException
	previousLoad := loadRiskException
	previousUpdate := updateRiskException
	previousInsert := insertRiskEvent
	previousListEvents := listRiskEvents
	previousList := listRiskExceptions
	previousAssignment := loadRiskAssignment
	previousAudit := saveRiskAudit
	previousClock := exceptionClock
	saveRiskException = func(item riskException) (riskException, error) {
		item.ID = len(m.items) + 1
		item.History = nil
		m.items = append(m.items, item)
		return item, nil
	}
	findRiskException = func(projectID int, findingKey, environment string) (riskException, error) {
		for _, item := range m.items {
			if item.ProjectID == projectID && item.FindingKey == findingKey && item.Environment == environment {
				item.History = nil
				return item, nil
			}
		}
		return riskException{}, nil
	}
	loadRiskException = func(id int) (riskException, error) {
		for _, item := range m.items {
			if item.ID == id {
				item.History = nil
				return item, nil
			}
		}
		return riskException{}, errRiskHidden
	}
	updateRiskException = func(item riskException) (riskException, error) {
		for index := range m.items {
			if m.items[index].ID == item.ID {
				item.History = nil
				m.items[index].ExpiresAt = item.ExpiresAt
				m.items[index].State = item.State
				m.items[index].ApproverUserID = item.ApproverUserID
				return m.items[index], nil
			}
		}
		return riskException{}, errRiskHidden
	}
	insertRiskEvent = func(item riskExceptionEvent) (riskExceptionEvent, error) {
		item.ID = len(m.events) + 1
		m.events = append(m.events, item)
		return item, nil
	}
	listRiskEvents = func(exceptionID int) ([]riskExceptionEvent, error) {
		var items []riskExceptionEvent
		for _, item := range m.events {
			if item.ExceptionID == exceptionID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	listRiskExceptions = func(projectID int, findingKey string) ([]riskException, error) {
		var items []riskException
		for _, item := range m.items {
			if item.ProjectID == projectID && item.FindingKey == findingKey {
				item.History = nil
				items = append(items, item)
			}
		}
		return items, nil
	}
	loadRiskAssignment = func(projectID int, findingKey string) (findingAssignment, error) {
		if projectID == 10 && findingKey == "finding-a" {
			return findingAssignment{ID: 3, ProjectID: 10, FindingKey: findingKey, State: "triage"}, nil
		}
		return findingAssignment{}, nil
	}
	saveRiskAudit = func(riskAuditRecord) error {
		m.audits++
		return nil
	}
	return func() {
		saveRiskException = previousSave
		findRiskException = previousFind
		loadRiskException = previousLoad
		updateRiskException = previousUpdate
		insertRiskEvent = previousInsert
		listRiskEvents = previousListEvents
		listRiskExceptions = previousList
		loadRiskAssignment = previousAssignment
		saveRiskAudit = previousAudit
		exceptionClock = previousClock
	}
}

func riskActor(userID int, role string) authzSubject {
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func riskInput(environment string, expires time.Time) riskExceptionInput {
	return riskExceptionInput{
		ProjectID: 10, FindingKey: "finding-a", Environment: environment,
		Reason: "accepted for one environment", CompensatingControl: "restrict the security group",
		Evidence: "scanner: unrestricted ssh on sg-1", ApproverUserID: 9, ExpiresAt: expires,
	}
}

func TestExpiredExceptionReturnsToReview(t *testing.T) {
	mem := &riskMem{}
	defer mem.install()()
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	exceptionClock = func() time.Time { return now }
	changedRemediation := false
	previousUpdate := updateRemediationLink
	updateRemediationLink = func(item remediationLink) (remediationLink, error) {
		changedRemediation = true
		return item, nil
	}
	defer func() { updateRemediationLink = previousUpdate }()

	created, err := recordRiskException(riskActor(4, "operator"), riskInput("dev", now.Add(time.Hour)))
	if err != nil || created.State != "active" || created.Verified || created.AccessGranted || created.RemediationState != "" {
		t.Fatalf("created %+v err %v", created, err)
	}
	now = now.Add(2 * time.Hour)
	reviewed, err := reviewRiskExceptions(riskActor(4, "operator"), 10, "finding-a")
	if err != nil || len(reviewed) != 1 || reviewed[0].State != "review" || reviewed[0].Verified || reviewed[0].AccessGranted || reviewed[0].RemediationState != "" {
		t.Fatalf("reviewed %+v err %v", reviewed, err)
	}
	if changedRemediation {
		t.Fatal("risk acceptance changed remediation state")
	}
}

func TestBroadSuppressionCannotEscapeProjectScope(t *testing.T) {
	mem := &riskMem{}
	defer mem.install()()
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	exceptionClock = func() time.Time { return now }
	created, err := recordRiskException(riskActor(4, "operator"), riskInput("dev", now.Add(24*time.Hour)))
	if err != nil || created.Environment != "dev" {
		t.Fatalf("created %+v err %v", created, err)
	}
	again, err := recordRiskException(riskActor(4, "operator"), riskInput("dev", now.Add(48*time.Hour)))
	if err != nil || again.ID != created.ID || len(mem.items) != 1 {
		t.Fatalf("again %+v items %d err %v", again, len(mem.items), err)
	}
	for _, environment := range []string{"*", "all", "dev,prod"} {
		broad := riskInput(environment, now.Add(time.Hour))
		if _, err := recordRiskException(riskActor(4, "operator"), broad); err != errRiskInvalid || len(mem.items) != 1 {
			t.Fatalf("broad %s items %d err %v", environment, len(mem.items), err)
		}
	}
	other := riskInput("dev", now.Add(time.Hour))
	other.ProjectID = 11
	if _, err := recordRiskException(riskActor(4, "operator"), other); err != errRiskHidden || len(mem.items) != 1 {
		t.Fatalf("other items %d err %v", len(mem.items), err)
	}
	missing := riskInput("dev", now.Add(time.Hour))
	missing.Reason = ""
	if _, err := recordRiskException(riskActor(4, "operator"), missing); err != errRiskInvalid || len(mem.items) != 1 {
		t.Fatalf("missing reason items %d err %v", len(mem.items), err)
	}
	self := riskInput("prod", now.Add(time.Hour))
	self.ApproverUserID = 4
	if _, err := recordRiskException(riskActor(4, "operator"), self); err != errRiskInvalid || len(mem.items) != 1 {
		t.Fatalf("self items %d err %v", len(mem.items), err)
	}
	if _, err := recordRiskException(riskActor(5, "viewer"), riskInput("prod", now.Add(time.Hour))); err != errRiskDenied || len(mem.items) != 1 {
		t.Fatalf("viewer items %d err %v", len(mem.items), err)
	}
	same, err := renewRiskException(riskActor(4, "operator"), created.ID, 9, created.ExpiresAt)
	if err != nil || len(same.History) != 0 || len(mem.events) != 0 {
		t.Fatalf("same %+v events %d err %v", same, len(mem.events), err)
	}
	renewed, err := renewRiskException(riskActor(4, "operator"), created.ID, 9, now.Add(72*time.Hour))
	if err != nil || renewed.State != "active" || len(renewed.History) != 1 || renewed.History[0].Action != "renew" || len(mem.events) != 1 {
		t.Fatalf("renewed %+v events %d err %v", renewed, len(mem.events), err)
	}
	visible, err := reviewRiskExceptions(riskActor(4, "operator"), 10, "finding-a")
	if err != nil || len(visible) != 1 || visible[0].ProjectID != 10 {
		t.Fatalf("visible %+v err %v", visible, err)
	}
}

func TestScannerEvidenceStaysReadable(t *testing.T) {
	mem := &riskMem{}
	defer mem.install()()
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	exceptionClock = func() time.Time { return now }
	created, err := recordRiskException(riskActor(4, "operator"), riskInput("dev", now.Add(time.Hour)))
	if err != nil || created.Evidence != "scanner: unrestricted ssh on sg-1" {
		t.Fatalf("created %+v err %v", created, err)
	}
	now = now.Add(2 * time.Hour)
	reviewed, err := reviewRiskExceptions(riskActor(5, "viewer"), 10, "finding-a")
	if err != nil || len(reviewed) != 1 || reviewed[0].State != "review" || reviewed[0].Evidence != created.Evidence {
		t.Fatalf("reviewed %+v err %v", reviewed, err)
	}
	now = reviewed[0].ExpiresAt.Add(-time.Minute)
	renewed, err := renewRiskException(riskActor(4, "operator"), created.ID, 9, now.Add(48*time.Hour))
	if err != nil || renewed.Evidence != created.Evidence || renewed.Verified || renewed.AccessGranted || len(renewed.History) != 1 {
		t.Fatalf("renewed %+v err %v", renewed, err)
	}
	if _, err := renewRiskException(riskActor(4, "operator"), created.ID, 4, now.Add(96*time.Hour)); err != errRiskInvalid || len(mem.events) != 1 {
		t.Fatalf("self renew events %d err %v", len(mem.events), err)
	}
	if reviewed[0].Evidence == "" || stringsContainsHealthy(reviewed[0].Evidence) {
		t.Fatalf("evidence %q", reviewed[0].Evidence)
	}
}

func stringsContainsHealthy(value string) bool {
	return value == "healthy"
}
