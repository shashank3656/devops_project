package main

import "testing"

type findingMem struct {
	items        []cloudFinding
	observations []findingObservation
}

func (m *findingMem) install() func() {
	previousSave := saveCloudFinding
	previousFind := findCloudFinding
	previousUpdate := updateCloudFinding
	previousInsert := insertFindingObservation
	previousLoad := loadCloudFinding
	saveCloudFinding = func(item cloudFinding) (cloudFinding, error) {
		item.ID = len(m.items) + 1
		m.items = append(m.items, item)
		return item, nil
	}
	findCloudFinding = func(fingerprint string) (cloudFinding, error) {
		for _, item := range m.items {
			if item.Fingerprint == fingerprint {
				item.Observations = m.observationsFor(item.ID)
				return item, nil
			}
		}
		return cloudFinding{}, nil
	}
	updateCloudFinding = func(item cloudFinding) (cloudFinding, error) {
		for index := range m.items {
			if m.items[index].ID == item.ID {
				m.items[index] = item
				return item, nil
			}
		}
		return cloudFinding{}, errFindingHidden
	}
	insertFindingObservation = func(item findingObservation) (findingObservation, error) {
		item.ID = len(m.observations) + 1
		m.observations = append(m.observations, item)
		return item, nil
	}
	loadCloudFinding = func(id int) (cloudFinding, error) {
		for _, item := range m.items {
			if item.ID == id {
				item.Observations = m.observationsFor(item.ID)
				return item, nil
			}
		}
		return cloudFinding{}, errFindingHidden
	}
	return func() {
		saveCloudFinding = previousSave
		findCloudFinding = previousFind
		updateCloudFinding = previousUpdate
		insertFindingObservation = previousInsert
		loadCloudFinding = previousLoad
	}
}

func (m *findingMem) observationsFor(findingID int) []findingObservation {
	var items []findingObservation
	for _, item := range m.observations {
		if item.FindingID == findingID {
			items = append(items, item)
		}
	}
	return items
}

func findingFixture(t *testing.T) (*scanMem, *scanJobMem, *findingMem, scanProfile, func()) {
	t.Helper()
	profiles := &scanMem{}
	jobs := &scanJobMem{}
	findings := &findingMem{}
	restoreProfiles := profiles.install()
	restoreJobs := jobs.install()
	restoreFindings := findings.install()
	saved, err := prepareScanProfile(scanOperator(), readyProfile())
	if err != nil {
		t.Fatal(err)
	}
	return profiles, jobs, findings, saved, func() {
		restoreFindings()
		restoreJobs()
		restoreProfiles()
	}
}

func startCompletedScan(t *testing.T, profile scanProfile) scanJob {
	t.Helper()
	started, err := startIsolatedScan(scanOperator(), profile.ID, profile.AccountID, profile.Region, []string{"iam_root_mfa"}, "")
	if err != nil {
		t.Fatal(err)
	}
	completed, err := recordScanProgress(scanOperator(), started.ID, 1, "")
	if err != nil || completed.State != "completed" {
		t.Fatalf("complete %+v err %v", completed, err)
	}
	return completed
}

func TestRerunUpdatesSameFinding(t *testing.T) {
	_, _, findings, profile, restore := findingFixture(t)
	defer restore()
	firstJob := startCompletedScan(t, profile)
	first, err := recordCloudObservation(scanOperator(), findingInput{
		JobID: firstJob.ID, AccountID: profile.AccountID, Region: profile.Region,
		CheckID: "IAM_Root_MFA", ResourceID: "arn:aws:s3:::logs", Result: "fail", PolicyVersion: "pack-1", Evidence: "root mfa missing",
	})
	if err != nil || first.ID == 0 || first.State != "open" || first.LatestResult != "fail" {
		t.Fatalf("first %+v err %v", first, err)
	}
	secondJob := startCompletedScan(t, profile)
	second, err := recordCloudObservation(scanOperator(), findingInput{
		JobID: secondJob.ID, AccountID: profile.AccountID, Region: "US-EAST-1",
		CheckID: "iam_root_mfa", ResourceID: "arn:aws:s3:::logs", Result: "fail", PolicyVersion: "pack-2", Evidence: "still missing",
	})
	if err != nil || second.ID != first.ID || len(second.Observations) != 2 || second.PolicyVersion != "pack-2" || len(findings.items) != 1 {
		t.Fatalf("rerun %+v rows %d err %v", second, len(findings.items), err)
	}
	if _, err := recordCloudObservation(scanViewer(), findingInput{
		JobID: secondJob.ID, AccountID: profile.AccountID, Region: profile.Region,
		CheckID: "iam_root_mfa", ResourceID: "arn:aws:s3:::logs", Result: "pass", PolicyVersion: "pack-2",
	}); err != errFindingDenied || len(findings.observations) != 2 {
		t.Fatalf("viewer err %v observations %d", err, len(findings.observations))
	}
}

func TestFailedCollectionNeverResolves(t *testing.T) {
	_, jobs, findings, profile, restore := findingFixture(t)
	defer restore()
	openJob := startCompletedScan(t, profile)
	opened, err := recordCloudObservation(scanOperator(), findingInput{
		JobID: openJob.ID, AccountID: profile.AccountID, Region: profile.Region,
		CheckID: "iam_root_mfa", ResourceID: "arn:aws:s3:::logs", Result: "fail", PolicyVersion: "pack-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	partialJob, err := startIsolatedScan(scanOperator(), profile.ID, profile.AccountID, profile.Region, []string{"iam_root_mfa"}, "")
	if err != nil {
		t.Fatal(err)
	}
	partial, err := recordScanProgress(scanOperator(), partialJob.ID, 0, "iam:GetAccountSummary denied")
	if err != nil || partial.State != "partial" {
		t.Fatalf("partial %+v err %v", partial, err)
	}
	kept, err := recordCloudObservation(scanOperator(), findingInput{
		JobID: partial.ID, AccountID: profile.AccountID, Region: profile.Region,
		CheckID: "iam_root_mfa", ResourceID: "arn:aws:s3:::logs", Result: "pass", PolicyVersion: "pack-9", Coverage: "failed",
	})
	if err != nil || kept.ID != opened.ID || kept.State != "open" || kept.State == "resolved" || kept.LatestResult != "error" || kept.PolicyVersion != "pack-1" || kept.Coverage != "failed" || len(kept.Observations) != 2 {
		t.Fatalf("kept %+v err %v jobs %d", kept, err, len(jobs.items))
	}
	if findings.items[0].State != "open" {
		t.Fatalf("stored %+v", findings.items[0])
	}
}

func TestDeletedResourceHasClosureReason(t *testing.T) {
	_, _, findings, profile, restore := findingFixture(t)
	defer restore()
	job := startCompletedScan(t, profile)
	results := []string{"pass", "fail", "error", "not_applicable"}
	var opened []cloudFinding
	for _, result := range results {
		item, err := recordCloudObservation(scanOperator(), findingInput{
			JobID: job.ID, AccountID: profile.AccountID, Region: profile.Region,
			CheckID: "iam_root_mfa", ResourceID: "resource-" + result, Result: result, PolicyVersion: "pack-1",
		})
		if err != nil {
			t.Fatal(err)
		}
		opened = append(opened, item)
	}
	if opened[0].LatestResult != "pass" || opened[0].State != "resolved" || opened[1].LatestResult != "fail" || opened[1].State != "open" || opened[2].LatestResult != "error" || opened[3].LatestResult != "not_applicable" || opened[3].State != "open" {
		t.Fatalf("results %+v", opened)
	}
	if _, err := closeCloudFinding(scanOperator(), opened[1].ID, " "); err != errFindingInvalid || findings.items[1].State != "open" || findings.items[1].ClosureReason != "" {
		t.Fatalf("blank close err %v state %s", err, findings.items[1].State)
	}
	closed, err := closeCloudFinding(scanOperator(), opened[1].ID, "resource deleted")
	if err != nil || closed.State != "closed" || closed.ClosureReason != "resource deleted" || closed.LatestResult != "fail" || len(closed.Observations) != 1 {
		t.Fatalf("closed %+v err %v", closed, err)
	}
}
