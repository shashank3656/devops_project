package main

import (
	"errors"
	"testing"
)

func backupActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"staging"}}},
	}
}

func installBackupMemory() {
	records := map[string]backupRecord{}
	dependencies := map[string]backupDependency{}
	drills := map[int]backupDrill{}
	nextRecord, nextDependency, nextDrill := 1, 1, 1
	key := func(environment, service, scope string) string { return environment + ":" + service + ":" + scope }
	findBackupRecord = func(projectID int, environment, service, scope string) (backupRecord, error) {
		item := records[key(environment, service, scope)]
		if item.ProjectID != 0 && item.ProjectID != projectID {
			return backupRecord{}, nil
		}
		return item, nil
	}
	saveBackupRecord = func(item backupRecord) (backupRecord, error) {
		item.ID = nextRecord
		nextRecord++
		item.Applied = true
		records[key(item.Environment, item.Service, item.Scope)] = item
		return item, nil
	}
	loadBackupRecord = func(id int) (backupRecord, error) {
		for _, item := range records {
			if item.ID == id {
				return item, nil
			}
		}
		return backupRecord{}, nil
	}
	updateBackupRecord = func(item backupRecord) (backupRecord, error) {
		records[key(item.Environment, item.Service, item.Scope)] = item
		return item, nil
	}
	listBackupRecords = func(projectID int, environment string) ([]backupRecord, error) {
		var items []backupRecord
		for _, item := range records {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	findBackupDependency = func(backupID int, service string) (backupDependency, error) {
		return dependencies[service], nil
	}
	saveBackupDependency = func(item backupDependency) (backupDependency, error) {
		item.ID = nextDependency
		nextDependency++
		item.Applied = true
		dependencies[item.Service] = item
		return item, nil
	}
	findBackupDrill = func(backupID int) (backupDrill, error) { return drills[backupID], nil }
	saveBackupDrill = func(item backupDrill) (backupDrill, error) {
		item.ID = nextDrill
		nextDrill++
		item.Applied = true
		drills[item.BackupID] = item
		return item, nil
	}
	saveBackupAudit = func(int, string, int, string) error { return nil }
}

func TestSuccessfulBackupStaysUnverified(t *testing.T) {
	installBackupMemory()
	operator := backupActor("operator", 10)
	item, err := recordBackupEvidence(operator, 10, "staging", "billing", "database", "sandbox", 7)
	if err != nil || item.State != "succeeded" || item.Verified || item.Observed != "unknown" || item.RetentionDays != 7 {
		t.Fatalf("backup = %+v %v", item, err)
	}
	again, err := recordBackupEvidence(operator, 10, "staging", "billing", "database", "sandbox", 7)
	if err != nil || again.Applied || again.ID != item.ID || again.Verified {
		t.Fatalf("replay = %+v %v", again, err)
	}
	link, err := linkBackupService(operator, item.ID, "ledger")
	if err != nil || link.Service != "ledger" || !link.Applied {
		t.Fatalf("link = %+v %v", link, err)
	}
	if _, err := recordBackupEvidence(operator, 10, "staging", "billing", "database", "aws", 7); err == nil || again.ID == 0 {
		t.Fatalf("provider = %v", err)
	}
	if leaked, err := readBackupEvidence(backupActor("operator", 11), 10, "staging"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
}

func TestRestoreDrillValidatesSampleData(t *testing.T) {
	installBackupMemory()
	operator := backupActor("operator", 10)
	item, err := recordBackupEvidence(operator, 10, "staging", "billing", "database", "sandbox", 7)
	if err != nil {
		t.Fatal(err)
	}
	unchecked, err := recordBackupDrill(operator, item.ID, 9, true, false, true, 8, true, 1, "succeeded")
	if err != nil || unchecked.State != "unverified" || unchecked.CanLaunch {
		t.Fatalf("unchecked = %+v %v", unchecked, err)
	}
	kept, err := loadBackupRecord(item.ID)
	if err != nil || kept.Verified {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	installBackupMemory()
	item, err = recordBackupEvidence(operator, 10, "staging", "billing", "evidence", "sandbox", 7)
	if err != nil {
		t.Fatal(err)
	}
	missing, err := recordBackupDrill(operator, item.ID, 9, true, true, true, 8, false, 0, "succeeded")
	if err != nil || missing.State != "unknown" || missing.GapSet {
		t.Fatalf("missing = %+v %v", missing, err)
	}
	if kept, err := loadBackupRecord(item.ID); err != nil || kept.Verified {
		t.Fatalf("missing kept = %+v %v", kept, err)
	}
	installBackupMemory()
	item, err = recordBackupEvidence(operator, 10, "staging", "billing", "database", "sandbox", 7)
	if err != nil {
		t.Fatal(err)
	}
	drill, err := recordBackupDrill(operator, item.ID, 9, true, true, true, 8, true, 1, "succeeded")
	if err != nil || drill.State != "restored" || drill.DurationSeconds != 8 || drill.DataGap != 1 || drill.CanLaunch {
		t.Fatalf("drill = %+v %v", drill, err)
	}
	verified, err := loadBackupRecord(item.ID)
	if err != nil || !verified.Verified {
		t.Fatalf("verified = %+v %v", verified, err)
	}
	again, err := recordBackupDrill(operator, item.ID, 9, true, true, true, 8, true, 1, "succeeded")
	if err != nil || again.Applied || again.ID != drill.ID {
		t.Fatalf("replay = %+v %v", again, err)
	}
}

func TestFailedDrillCreatesAssignedFollowUp(t *testing.T) {
	installBackupMemory()
	operator := backupActor("operator", 10)
	item, err := recordBackupEvidence(operator, 10, "staging", "billing", "database", "sandbox", 7)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recordBackupDrill(operator, item.ID, operator.UserID, true, true, true, 8, true, 1, "failed"); !errors.Is(err, errBackupInvalid) {
		t.Fatalf("self = %v", err)
	}
	if _, err := recordBackupDrill(operator, item.ID, 9, false, true, true, 8, true, 1, "failed"); !errors.Is(err, errBackupInvalid) {
		t.Fatalf("shared = %v", err)
	}
	if _, err := recordBackupDrill(backupActor("viewer", 10), item.ID, 9, true, true, true, 8, true, 1, "failed"); !errors.Is(err, errBackupDenied) {
		t.Fatalf("viewer = %v", err)
	}
	drill, err := recordBackupDrill(operator, item.ID, 9, true, false, false, 0, false, 0, "failed")
	if err != nil || drill.State != "failed" || !drill.FollowUp || drill.AssigneeID != 9 || drill.CanLaunch {
		t.Fatalf("failed = %+v %v", drill, err)
	}
	kept, err := loadBackupRecord(item.ID)
	if err != nil || kept.Verified {
		t.Fatalf("kept = %+v %v", kept, err)
	}
	again, err := recordBackupDrill(operator, item.ID, 8, true, true, true, 3, true, 2, "succeeded")
	if err != nil || again.Applied || again.State != "failed" || again.AssigneeID != 9 {
		t.Fatalf("replay = %+v %v", again, err)
	}
	if _, err := recordBackupEvidence(operator, 10, "*", "billing", "database", "sandbox", 7); !errors.Is(err, errBackupInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
}
