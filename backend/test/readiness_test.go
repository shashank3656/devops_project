package main

import (
	"errors"
	"testing"
)

func readinessActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installReadinessMemory() {
	signals := map[string]readinessSignal{}
	targets := map[string]readinessTarget{}
	backups := map[int]readinessBackup{}
	jobs := map[string]readinessJob{}
	queues := map[string]bool{}
	nextSignal, nextTarget, nextBackup, nextRestore, nextJob := 1, 1, 1, 1, 1
	saveReadinessSignal = func(item readinessSignal) (readinessSignal, error) {
		key := item.Environment + ":" + item.Kind
		if current, ok := signals[key]; ok {
			item.ID = current.ID
		} else {
			item.ID = nextSignal
			nextSignal++
		}
		signals[key] = item
		return item, nil
	}
	loadReadinessSignal = func(projectID int, environment, kind string) (readinessSignal, error) {
		return signals[environment+":"+kind], nil
	}
	saveReadinessTarget = func(item readinessTarget) (readinessTarget, error) {
		if current, ok := targets[item.Environment]; ok {
			item.ID = current.ID
		} else {
			item.ID = nextTarget
			nextTarget++
		}
		targets[item.Environment] = item
		return item, nil
	}
	saveReadinessBackup = func(item readinessBackup) (readinessBackup, error) {
		item.ID = nextBackup
		nextBackup++
		backups[item.ID] = item
		return item, nil
	}
	loadReadinessBackup = func(id int) (readinessBackup, error) {
		return backups[id], nil
	}
	saveReadinessRestore = func(item readinessRestore) (readinessRestore, error) {
		item.ID = nextRestore
		nextRestore++
		return item, nil
	}
	loadReadinessQueue = func(projectID int, environment string) (bool, error) {
		open, ok := queues[environment]
		if !ok {
			return true, nil
		}
		return open, nil
	}
	saveReadinessQueue = func(projectID int, environment string, open bool) error {
		queues[environment] = open
		return nil
	}
	findReadinessJob = func(projectID int, environment, jobKey string) (readinessJob, error) {
		return jobs[environment+":"+jobKey], nil
	}
	saveReadinessJobRecord = func(item readinessJob) (readinessJob, error) {
		item.ID = nextJob
		nextJob++
		jobs[item.Environment+":"+item.JobKey] = item
		return item, nil
	}
	listReadinessJobRows = func(projectID int, environment string) ([]readinessJob, error) {
		var items []readinessJob
		for id := 1; id < nextJob; id++ {
			for _, item := range jobs {
				if item.ID == id && item.Environment == environment {
					items = append(items, item)
				}
			}
		}
		return items, nil
	}
	saveReadinessAudit = func(readinessAudit) error { return nil }
}

func TestRestoreRecordsElapsedTimeAndLoss(t *testing.T) {
	installReadinessMemory()
	operator := readinessActor("operator", 10)
	backup, err := declareReadinessBackup(operator, 10, "dev", "database")
	if err != nil || backup.State != "declared" || backup.Scope != "database" {
		t.Fatalf("backup = %+v %v", backup, err)
	}
	unknown, err := rehearseReadiness(operator, backup.ID, 12, true, 0, false)
	if err != nil || unknown.State != "unknown" || !unknown.ElapsedSet || unknown.LossSet || unknown.ElapsedSeconds != 0 {
		t.Fatalf("unknown restore = %+v %v", unknown, err)
	}
	restored, err := rehearseReadiness(operator, backup.ID, 12, true, 1, true)
	if err != nil || restored.State != "restored" || restored.ElapsedSeconds != 12 || restored.LossCount != 1 {
		t.Fatalf("restored = %+v %v", restored, err)
	}
	evidence, err := declareReadinessBackup(operator, 10, "dev", "evidence")
	if err != nil || evidence.Scope != "evidence" {
		t.Fatalf("evidence = %+v %v", evidence, err)
	}
	if _, err := declareReadinessBackup(operator, 10, "*", "database"); !errors.Is(err, errReadinessInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	if _, err := rehearseReadiness(readinessActor("operator", 11), backup.ID, 1, true, 0, true); !errors.Is(err, errReadinessHidden) {
		t.Fatalf("other project = %v", err)
	}
}

func TestQueueOutagePreservesJobs(t *testing.T) {
	installReadinessMemory()
	operator := readinessActor("operator", 10)
	target, err := saveRecoveryTarget(operator, 10, "dev", 300, 900, operator.UserID)
	if err != nil || target.State != "proposed" || target.SLO != "proposed" || target.RPOSeconds != 300 || target.RTOSeconds != 900 || target.OwnerUserID != operator.UserID {
		t.Fatalf("target = %+v %v", target, err)
	}
	if _, err := saveRecoveryTarget(operator, 10, "dev", 0, 900, operator.UserID); !errors.Is(err, errReadinessInvalid) {
		t.Fatalf("blank rpo = %v", err)
	}
	first, err := keepReadinessJob(operator, 10, "dev", "job-1")
	if err != nil || first.State != "queued" {
		t.Fatalf("first = %+v %v", first, err)
	}
	if err := setReadinessQueue(operator, 10, "dev", false); err != nil {
		t.Fatal(err)
	}
	open, err := loadReadinessQueue(10, "dev")
	if err != nil || open {
		t.Fatalf("queue open = %v %v", open, err)
	}
	second, err := keepReadinessJob(operator, 10, "dev", "job-2")
	if err != nil || second.State != "queued" || second.ID == first.ID {
		t.Fatalf("outage job = %+v %v", second, err)
	}
	again, err := keepReadinessJob(operator, 10, "dev", "job-1")
	if err != nil || again.ID != first.ID || again.State != "queued" {
		t.Fatalf("duplicate = %+v %v", again, err)
	}
	items, err := reconcileReadiness(operator, 10, "dev")
	if err != nil || len(items) != 2 || items[0].State != "queued" || items[1].State != "queued" {
		t.Fatalf("jobs = %+v %v", items, err)
	}
	if _, err := keepReadinessJob(readinessActor("viewer", 10), 10, "dev", "job-3"); !errors.Is(err, errReadinessDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := reconcileReadiness(readinessActor("operator", 11), 10, "dev"); !errors.Is(err, errReadinessHidden) {
		t.Fatalf("other project = %v", err)
	}
}

func TestSensitiveFieldsStayOutOfTelemetry(t *testing.T) {
	installReadinessMemory()
	operator := readinessActor("operator", 10)
	if _, err := recordReadiness(operator, 10, "dev", "api_error", "", "password=hidden", 2, 0, true); !errors.Is(err, errReadinessInvalid) {
		t.Fatalf("secret = %v", err)
	}
	if found, _ := loadReadinessSignal(10, "dev", "api_error"); found.ID != 0 {
		t.Fatalf("secret wrote %+v", found)
	}
	missing, err := recordReadiness(operator, 10, "dev", "scan_coverage", "ready", "", 0, 0, false)
	if err != nil || missing.State != "unknown" || missing.Coverage != "unknown" || missing.Count != 0 {
		t.Fatalf("missing = %+v %v", missing, err)
	}
	if _, err := recordReadiness(operator, 10, "dev", "scan_coverage", "healthy", "", 0, 0, true); !errors.Is(err, errReadinessInvalid) {
		t.Fatalf("healthy coverage = %v", err)
	}
	recorded, err := recordReadiness(operator, 10, "dev", "queue_age", "", "", 0, 40, true)
	if err != nil || recorded.State != "recorded" || recorded.AgeSeconds != 40 {
		t.Fatalf("queue age = %+v %v", recorded, err)
	}
	lag, err := recordReadiness(operator, 10, "dev", "sync_lag", "", "", 0, 15, true)
	if err != nil || lag.Kind != "sync_lag" || lag.AgeSeconds != 15 || lag.State != "recorded" {
		t.Fatalf("lag = %+v %v", lag, err)
	}
	if _, err := recordReadiness(readinessActor("viewer", 10), 10, "dev", "api_error", "", "", 1, 0, true); !errors.Is(err, errReadinessDenied) {
		t.Fatalf("viewer = %v", err)
	}
}
