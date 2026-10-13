package main

import (
	"strings"
	"testing"
	"time"
)

type findingTriageMem struct {
	items  []findingAssignment
	events []findingAssignmentEvent
	audits []triageAuditRecord
}

func (m *findingTriageMem) install() func() {
	previousSave := saveFindingAssignment
	previousFind := findFindingAssignment
	previousLoad := loadFindingAssignment
	previousUpdate := updateFindingAssignment
	previousInsert := insertAssignmentEvent
	previousList := listAssignmentEvents
	previousQueue := listTriageAssignments
	previousAudit := saveTriageAudit
	previousOwner := loadServiceOwner
	saveFindingAssignment = func(item findingAssignment) (findingAssignment, error) {
		item.ID = len(m.items) + 1
		item.History = nil
		m.items = append(m.items, item)
		return item, nil
	}
	findFindingAssignment = func(projectID int, findingKey string) (findingAssignment, error) {
		for _, item := range m.items {
			if item.ProjectID == projectID && item.FindingKey == findingKey {
				item.History = nil
				return item, nil
			}
		}
		return findingAssignment{}, nil
	}
	loadFindingAssignment = func(id int) (findingAssignment, error) {
		for _, item := range m.items {
			if item.ID == id {
				item.History = nil
				return item, nil
			}
		}
		return findingAssignment{}, errTriageHidden
	}
	updateFindingAssignment = func(item findingAssignment) (findingAssignment, error) {
		for index := range m.items {
			if m.items[index].ID == item.ID {
				item.History = nil
				m.items[index] = item
				return item, nil
			}
		}
		return findingAssignment{}, errTriageHidden
	}
	insertAssignmentEvent = func(item findingAssignmentEvent) (findingAssignmentEvent, error) {
		item.ID = len(m.events) + 1
		m.events = append(m.events, item)
		return item, nil
	}
	listAssignmentEvents = func(assignmentID int) ([]findingAssignmentEvent, error) {
		var items []findingAssignmentEvent
		for _, item := range m.events {
			if item.AssignmentID == assignmentID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	listTriageAssignments = func(projectID int) ([]findingAssignment, error) {
		var items []findingAssignment
		for _, item := range m.items {
			if item.ProjectID == projectID && item.State == "triage" {
				item.History = nil
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveTriageAudit = func(item triageAuditRecord) error {
		m.audits = append(m.audits, item)
		return nil
	}
	loadServiceOwner = func(serviceID int) (serviceOwner, error) {
		switch serviceID {
		case 8:
			return serviceOwner{ProjectID: 10, ServiceID: 8, Team: "platform", Verified: true}, nil
		case 9:
			return serviceOwner{ProjectID: 10, ServiceID: 9, Verified: false}, nil
		case 12:
			return serviceOwner{ProjectID: 11, ServiceID: 12, Team: "other", Verified: true}, nil
		default:
			return serviceOwner{}, nil
		}
	}
	return func() {
		saveFindingAssignment = previousSave
		findFindingAssignment = previousFind
		loadFindingAssignment = previousLoad
		updateFindingAssignment = previousUpdate
		insertAssignmentEvent = previousInsert
		listAssignmentEvents = previousList
		listTriageAssignments = previousQueue
		saveTriageAudit = previousAudit
		loadServiceOwner = previousOwner
	}
}

func triageActor(userID int, role string) authzSubject {
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func TestUnmappedFindingIsNotSilentlyAssigned(t *testing.T) {
	mem := &findingTriageMem{}
	defer mem.install()()
	opened := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	previous := triageClock
	triageClock = func() time.Time { return opened }
	defer func() { triageClock = previous }()
	mapped, err := recordFindingAssignment(triageActor(4, "operator"), 10, 8, "finding-a", "critical")
	if err != nil || mapped.State != "assigned" || mapped.OwnerTeam != "platform" || len(mapped.History) != 1 || !mapped.DueAt.Equal(opened.Add(24*time.Hour)) {
		t.Fatalf("mapped %+v err %v", mapped, err)
	}
	if strings.Contains(mapped.PriorityReason, "healthy") {
		t.Fatalf("reason %s", mapped.PriorityReason)
	}
	again, err := recordFindingAssignment(triageActor(4, "operator"), 10, 0, "finding-a", "critical")
	if err != nil || again.ID != mapped.ID || again.OwnerTeam != "platform" || len(mem.events) != 1 {
		t.Fatalf("again %+v events %d err %v", again, len(mem.events), err)
	}
	unmapped, err := recordFindingAssignment(triageActor(4, "operator"), 10, 0, "finding-b", "high")
	if err != nil || unmapped.State != "triage" || unmapped.OwnerTeam != "" || unmapped.PriorityReason != "unmapped finding stays in triage" {
		t.Fatalf("unmapped %+v err %v", unmapped, err)
	}
	unknown, err := recordFindingAssignment(triageActor(4, "operator"), 10, 9, "finding-c", "medium")
	if err != nil || unknown.State != "triage" || unknown.OwnerTeam != "" || unknown.PriorityReason != "owner is unknown" {
		t.Fatalf("unknown %+v err %v", unknown, err)
	}
	if _, err := recordFindingAssignment(triageActor(5, "viewer"), 10, 8, "finding-d", "low"); err != errTriageDenied || len(mem.items) != 3 {
		t.Fatalf("viewer items %d err %v", len(mem.items), err)
	}
	if _, err := recordFindingAssignment(triageActor(4, "operator"), 11, 8, "finding-e", "low"); err != errTriageHidden || len(mem.items) != 3 {
		t.Fatalf("hidden items %d err %v", len(mem.items), err)
	}
	if _, err := recordFindingAssignment(triageActor(4, "operator"), 10, 12, "finding-f", "low"); err != errTriageHidden || len(mem.items) != 3 {
		t.Fatalf("cross items %d err %v", len(mem.items), err)
	}
}

func TestReassignmentPreservesHistory(t *testing.T) {
	mem := &findingTriageMem{}
	defer mem.install()()
	first, err := recordFindingAssignment(triageActor(4, "operator"), 10, 8, "finding-a", "high")
	if err != nil {
		t.Fatal(err)
	}
	next, err := reassignFinding(triageActor(4, "operator"), first.ID, "payments")
	if err != nil || next.OwnerTeam != "payments" || len(next.History) != 2 || next.History[0].NextOwner != "platform" || next.History[1].PreviousOwner != "platform" {
		t.Fatalf("next %+v err %v", next, err)
	}
	same, err := reassignFinding(triageActor(4, "operator"), first.ID, "payments")
	if err != nil || len(same.History) != 2 || len(mem.events) != 2 {
		t.Fatalf("same %+v events %d err %v", same, len(mem.events), err)
	}
	unmapped, err := recordFindingAssignment(triageActor(4, "operator"), 10, 0, "finding-b", "high")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reassignFinding(triageActor(4, "operator"), unmapped.ID, "platform"); err != errTriageInvalid || unmapped.OwnerTeam != "" {
		t.Fatalf("unmapped assign err %v", err)
	}
	stored := mem.items[1]
	if stored.OwnerTeam != "" || stored.State != "triage" {
		t.Fatalf("stored %+v", stored)
	}
	cleared, err := reassignFinding(triageActor(4, "operator"), first.ID, "")
	if err != nil || cleared.State != "triage" || cleared.OwnerTeam != "" || cleared.History[len(cleared.History)-1].PreviousOwner != "payments" {
		t.Fatalf("cleared %+v err %v", cleared, err)
	}
}

func TestDueDateChangesAreAudited(t *testing.T) {
	mem := &findingTriageMem{}
	defer mem.install()()
	opened := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	previous := triageClock
	triageClock = func() time.Time { return opened }
	defer func() { triageClock = previous }()
	first, err := recordFindingAssignment(triageActor(4, "operator"), 10, 8, "finding-a", "critical")
	if err != nil || first.PriorityReason != "severity critical is due within 24h" {
		t.Fatalf("first %+v err %v", first, err)
	}
	same, err := changeFindingDue(triageActor(4, "operator"), first.ID, first.DueAt)
	if err != nil || len(mem.audits) != 0 || len(same.History) != 1 {
		t.Fatalf("same %+v audits %d err %v", same, len(mem.audits), err)
	}
	movedDue := opened.Add(48 * time.Hour)
	moved, err := changeFindingDue(triageActor(4, "operator"), first.ID, movedDue)
	if err != nil || !moved.DueAt.Equal(movedDue) || moved.OwnerTeam != "platform" || len(mem.audits) != 1 {
		t.Fatalf("moved %+v audits %+v err %v", moved, mem.audits, err)
	}
	if mem.audits[0].Summary != "due "+opened.Add(24*time.Hour).Format(time.RFC3339)+" to "+movedDue.Format(time.RFC3339) {
		t.Fatalf("summary %s", mem.audits[0].Summary)
	}
	again, err := changeFindingDue(triageActor(4, "operator"), first.ID, movedDue)
	if err != nil || len(mem.audits) != 1 || len(again.History) != 2 {
		t.Fatalf("again %+v audits %d err %v", again, len(mem.audits), err)
	}
	if _, err := changeFindingDue(triageActor(5, "viewer"), first.ID, opened.Add(72*time.Hour)); err != errTriageDenied || len(mem.audits) != 1 {
		t.Fatalf("viewer audits %d err %v", len(mem.audits), err)
	}
	unmapped, err := recordFindingAssignment(triageActor(4, "operator"), 10, 0, "finding-b", "low")
	if err != nil {
		t.Fatal(err)
	}
	queued, err := triageQueue(triageActor(5, "viewer"), 10)
	if err != nil || len(queued) != 1 || queued[0].FindingKey != "finding-b" || queued[0].OwnerTeam != "" || queued[0].PriorityReason != "unmapped finding stays in triage" {
		t.Fatalf("queue %+v err %v", queued, err)
	}
	changed, err := changeFindingDue(triageActor(4, "operator"), unmapped.ID, opened.Add(96*time.Hour))
	if err != nil || changed.OwnerTeam != "" || changed.State != "triage" || len(mem.audits) != 2 {
		t.Fatalf("changed %+v audits %d err %v", changed, len(mem.audits), err)
	}
}
