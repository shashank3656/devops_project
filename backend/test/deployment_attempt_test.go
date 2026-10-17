package main

import "testing"

type attemptMem struct {
	items []deploymentAttempt
}

func (m *attemptMem) install() func() {
	previousSave := saveDeploymentAttempt
	previousLoad := loadDeploymentAttempt
	previousUpdate := updateDeploymentAttempt
	previousList := listDeploymentAttempts
	saveDeploymentAttempt = func(item deploymentAttempt) (deploymentAttempt, error) {
		item.ID = len(m.items) + 1
		item.State = "queued"
		item.CallbackState = "missing"
		item.WatchStarted = false
		m.items = append(m.items, item)
		return item, nil
	}
	loadDeploymentAttempt = func(id int) (deploymentAttempt, error) {
		for _, item := range m.items {
			if item.ID == id {
				return item, nil
			}
		}
		return deploymentAttempt{}, errAttemptHidden
	}
	updateDeploymentAttempt = func(item deploymentAttempt) (deploymentAttempt, error) {
		for index := range m.items {
			if m.items[index].ID == item.ID {
				m.items[index] = item
				return item, nil
			}
		}
		return deploymentAttempt{}, errAttemptHidden
	}
	listDeploymentAttempts = func(projectID int, environment string) ([]deploymentAttempt, error) {
		var rows []deploymentAttempt
		for _, item := range m.items {
			if item.ProjectID == projectID && item.Environment == environment {
				rows = append(rows, item)
			}
		}
		return rows, nil
	}
	return func() {
		saveDeploymentAttempt = previousSave
		loadDeploymentAttempt = previousLoad
		updateDeploymentAttempt = previousUpdate
		listDeploymentAttempts = previousList
	}
}

func attemptOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func attemptViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func installApprovedSHA() func() {
	previous := loadApprovalSubject
	loadApprovalSubject = func(id int) (approvalSubject, error) {
		if id != 7 {
			return approvalSubject{}, errApprovalHidden
		}
		return approvalSubject{ID: 7, ProjectID: 10, CommitHash: "abc123", Environment: "prod", State: "approved"}, nil
	}
	return func() { loadApprovalSubject = previous }
}

func newAttempt() deploymentAttempt {
	return deploymentAttempt{ProjectID: 10, ApprovalID: 7, Environment: "prod", CommitSHA: "abc123", ImageDigest: "sha256:artifact"}
}

func TestRedeployingSHACreatesNewAttempt(t *testing.T) {
	mem := &attemptMem{}
	restore := mem.install()
	defer restore()
	restoreApproval := installApprovedSHA()
	defer restoreApproval()
	first, err := startDeploymentAttempt(attemptOperator(), newAttempt())
	second, err2 := startDeploymentAttempt(attemptOperator(), newAttempt())
	if err != nil || err2 != nil || first.ID == second.ID || first.CommitSHA != "abc123" || second.CommitSHA != "abc123" || first.ImageDigest != "sha256:artifact" || first.WatchStarted || first.CallbackState != "missing" {
		t.Fatalf("attempts %+v %+v err %v %v", first, second, err, err2)
	}
	if _, err := startDeploymentAttempt(attemptViewer(), newAttempt()); err != errAttemptDenied || len(mem.items) != 2 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.items))
	}
	same := newAttempt()
	same.ImageDigest = same.CommitSHA
	if _, err := startDeploymentAttempt(attemptOperator(), same); err != errAttemptInvalid || len(mem.items) != 2 {
		t.Fatalf("same identity err %v rows %d", err, len(mem.items))
	}
}

func TestLateRunningCannotOverwriteSuccess(t *testing.T) {
	mem := &attemptMem{}
	restore := mem.install()
	defer restore()
	restoreApproval := installApprovedSHA()
	defer restoreApproval()
	started, err := startDeploymentAttempt(attemptOperator(), newAttempt())
	if err != nil {
		t.Fatal(err)
	}
	running, err := applyDeploymentCallback(attemptOperator(), started.ID, "evt-1", "running", "sha256:artifact", "abc123", "2026-10-14T00:00:00Z")
	if err != nil || running.State != "running" || running.WatchStarted || running.CallbackState != "received" {
		t.Fatalf("running %+v err %v", running, err)
	}
	success, err := applyDeploymentCallback(attemptOperator(), started.ID, "evt-2", "success", "sha256:artifact", "abc123", "2026-10-14T00:05:00Z")
	if err != nil || success.State != "success" || !success.WatchStarted || success.ImageDigest != "sha256:artifact" || success.CommitSHA != "abc123" {
		t.Fatalf("success %+v err %v", success, err)
	}
	mismatch, err := applyDeploymentCallback(attemptOperator(), started.ID, "evt-3", "running", "sha256:other", "abc123", "2026-10-14T00:06:00Z")
	if err != errAttemptInvalid || mismatch.State != "success" || mismatch.ImageDigest != "sha256:artifact" {
		t.Fatalf("mismatch %+v err %v", mismatch, err)
	}
	late, err := applyDeploymentCallback(attemptOperator(), started.ID, "evt-4", "running", "sha256:artifact", "abc123", "2026-10-14T00:07:00Z")
	if err != errAttemptBackward || late.State != "success" || late.ImageDigest != "sha256:artifact" || late.ObservedAt != "2026-10-14T00:05:00Z" || !late.WatchStarted {
		t.Fatalf("late %+v err %v", late, err)
	}
	if _, err := applyDeploymentCallback(attemptViewer(), started.ID, "evt-5", "failed", "", "", "2026-10-14T00:08:00Z"); err != errAttemptDenied || mem.items[0].State != "success" {
		t.Fatalf("viewer err %v state %s", err, mem.items[0].State)
	}
}

func TestUnknownRuntimeIsNotGreen(t *testing.T) {
	mem := &attemptMem{}
	restore := mem.install()
	defer restore()
	restoreApproval := installApprovedSHA()
	defer restoreApproval()
	started, err := startDeploymentAttempt(attemptOperator(), newAttempt())
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := deploymentRuntimeView(attemptOperator(), 10, "prod")
	if err != nil || unknown.State != "unknown" || unknown.State == "green" || unknown.Running != nil || unknown.WatchStarted || len(unknown.History) != 1 || unknown.History[0].CallbackState != "missing" {
		t.Fatalf("unknown %+v err %v", unknown, err)
	}
	if _, err := applyDeploymentCallback(attemptOperator(), started.ID, "evt-2", "success", "sha256:artifact", "abc123", "2026-10-14T00:05:00Z"); err != nil {
		t.Fatal(err)
	}
	again, err := startDeploymentAttempt(attemptOperator(), newAttempt())
	if err != nil {
		t.Fatal(err)
	}
	verified, err := deploymentRuntimeView(attemptViewer(), 10, "prod")
	if err != nil || verified.State != "verified" || verified.State == "green" || verified.Running == nil || verified.Running.AttemptID != started.ID || verified.Running.ImageDigest != "sha256:artifact" || verified.Running.ObservedAt != "2026-10-14T00:05:00Z" || !verified.WatchStarted || len(verified.History) != 2 || verified.History[1].ID != again.ID || verified.History[1].CallbackState != "missing" {
		t.Fatalf("verified %+v err %v", verified, err)
	}
}
