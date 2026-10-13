package main

import "testing"

type scanJobMem struct {
	items []scanJob
}

func (m *scanJobMem) install() func() {
	previousSave := saveScanJob
	previousLoad := loadScanJob
	previousUpdate := updateScanJob
	previousCount := countOpenScanJobs
	saveScanJob = func(item scanJob) (scanJob, error) {
		item.ID = len(m.items) + 1
		item.State = "running"
		item.ProwlerVersion = pinnedProwlerVersion
		item.WritePermitted = false
		item.CredentialsIssued = false
		m.items = append(m.items, item)
		return item, nil
	}
	loadScanJob = func(id int) (scanJob, error) {
		for _, item := range m.items {
			if item.ID == id {
				return item, nil
			}
		}
		return scanJob{}, errScanHidden
	}
	updateScanJob = func(item scanJob) (scanJob, error) {
		for index := range m.items {
			if m.items[index].ID == item.ID {
				m.items[index] = item
				return item, nil
			}
		}
		return scanJob{}, errScanHidden
	}
	countOpenScanJobs = func(projectID int, accountID, region string) (int, error) {
		count := 0
		for _, item := range m.items {
			if item.ProjectID == projectID && item.AccountID == accountID && item.Region == region && (item.State == "queued" || item.State == "running") {
				count++
			}
		}
		return count, nil
	}
	return func() {
		saveScanJob = previousSave
		loadScanJob = previousLoad
		updateScanJob = previousUpdate
		countOpenScanJobs = previousCount
	}
}

func TestOverlappingScansAreBounded(t *testing.T) {
	profiles := &scanMem{}
	jobs := &scanJobMem{}
	restoreProfiles := profiles.install()
	restoreJobs := jobs.install()
	defer restoreProfiles()
	defer restoreJobs()
	saved, err := prepareScanProfile(scanOperator(), readyProfile())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startIsolatedScan(scanOperator(), saved.ID, saved.AccountID, saved.Region, []string{"iam_root_mfa"}, "4.0.0"); err != errScanVersion || len(jobs.items) != 0 {
		t.Fatalf("version err %v rows %d", err, len(jobs.items))
	}
	first, err := startIsolatedScan(scanOperator(), saved.ID, saved.AccountID, saved.Region, []string{"iam_root_mfa"}, "")
	if err != nil || first.ProwlerVersion != pinnedProwlerVersion || first.WritePermitted || first.CredentialsIssued || first.State != "running" {
		t.Fatalf("first %+v err %v", first, err)
	}
	if _, err := startIsolatedScan(scanOperator(), saved.ID, saved.AccountID, saved.Region, []string{"iam_root_mfa"}, pinnedProwlerVersion); err != errScanBounded || len(jobs.items) != 1 {
		t.Fatalf("overlap err %v rows %d", err, len(jobs.items))
	}
	if _, err := startIsolatedScan(scanViewer(), saved.ID, saved.AccountID, saved.Region, []string{"iam_root_mfa"}, ""); err != errScanDenied || len(jobs.items) != 1 {
		t.Fatalf("viewer err %v rows %d", err, len(jobs.items))
	}
	if _, err := startIsolatedScan(scanOperator(), saved.ID, "999999999999", saved.Region, []string{"iam_root_mfa"}, ""); err != errScanIdentity || len(jobs.items) != 1 || profiles.items[0].State != "aborted" {
		t.Fatalf("identity err %v rows %d state %s", err, len(jobs.items), profiles.items[0].State)
	}
}

func TestPermissionFailureReportsPartial(t *testing.T) {
	profiles := &scanMem{}
	jobs := &scanJobMem{}
	restoreProfiles := profiles.install()
	restoreJobs := jobs.install()
	defer restoreProfiles()
	defer restoreJobs()
	saved, err := prepareScanProfile(scanOperator(), readyProfile())
	if err != nil {
		t.Fatal(err)
	}
	started, err := startIsolatedScan(scanOperator(), saved.ID, saved.AccountID, saved.Region, []string{"iam_root_mfa", "s3_bucket_public"}, "")
	if err != nil || started.Total != 2 {
		t.Fatalf("start %+v err %v", started, err)
	}
	partial, err := recordScanProgress(scanOperator(), started.ID, 1, "iam:GetAccountSummary denied")
	if err != nil || partial.State != "partial" || partial.State == "completed" || partial.Completed != 1 || partial.PermissionFailure == "" || partial.WritePermitted {
		t.Fatalf("partial %+v err %v", partial, err)
	}
	if _, err := recordScanProgress(scanOperator(), started.ID, 2, ""); err != errScanInvalid || jobs.items[0].State != "partial" {
		t.Fatalf("upgrade err %v state %s", err, jobs.items[0].State)
	}
}
