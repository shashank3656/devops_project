package main

import "testing"

type changeMem struct {
	items []changeRequest
	saves int
	fail  bool
}

func (m *changeMem) install() func() {
	previousSave := saveChangeRequest
	previousLoad := loadChangeRequest
	previousList := listLifecycleChanges
	saveChangeRequest = func(item changeRequest) (changeRequest, error) {
		if m.fail {
			return changeRequest{}, errInboxStored
		}
		m.saves++
		if item.ID == 0 {
			item.ID = len(m.items) + 1
			m.items = append(m.items, item)
			return item, nil
		}
		for index := range m.items {
			if m.items[index].ID == item.ID {
				m.items[index] = item
				return item, nil
			}
		}
		return changeRequest{}, errChangeHidden
	}
	loadChangeRequest = func(id int) (changeRequest, error) {
		for _, item := range m.items {
			if item.ID == id {
				return item, nil
			}
		}
		return changeRequest{}, errChangeHidden
	}
	listLifecycleChanges = func(projectID int) ([]changeRequest, error) {
		var rows []changeRequest
		for _, item := range m.items {
			if item.ProjectID == projectID {
				rows = append(rows, item)
			}
		}
		return rows, nil
	}
	return func() {
		saveChangeRequest = previousSave
		loadChangeRequest = previousLoad
		listLifecycleChanges = previousList
	}
}

func changeOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func changeViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func uiChange() changeRequest {
	return changeRequest{
		ProjectID: 10, Environment: "prod", ChangeType: "normal", Source: "ui", CreatorUserID: 4,
		IdempotencyKey: "once", CommitSHA: "abc123", ImageDigest: "sha256:artifact", Owner: "ada",
		Impact: "high", Risk: "medium", Window: "Tue 10:00 UTC", ImplementationPlan: "ship",
		ValidationPlan: "check", RollbackPlan: "revert",
	}
}

func webhookChange() changeRequest {
	item := uiChange()
	item.Source = "webhook"
	item.CreatorUserID = 0
	item.IdempotencyKey = ""
	item.ConnectionID = 3
	item.EventID = "evt-1"
	item.ExternalID = "CHG100"
	item.SourceRevision = 2
	item.SourceStatus = "approved"
	return item
}

func TestExternalApprovedCannotRelease(t *testing.T) {
	mem := &changeMem{}
	restore := mem.install()
	defer restore()
	saved, err := submitChange(changeOperator(), webhookChange())
	if err != nil || saved.Change.ID == 0 || saved.Change.SourceStatus != "approved" || saved.Change.LocalState != "assessing" || saved.Change.ApprovalState != "none" || saved.Execution {
		t.Fatalf("create %+v err %v", saved, err)
	}
	released, err := releaseChange(changeOperator(), saved.Change.ID)
	if err != errChangeRelease || released.Execution || mem.saves != 1 {
		t.Fatalf("release %+v err %v saves %d", released, err, mem.saves)
	}
	if _, err := submitChange(changeViewer(), webhookChange()); err != errChangeDenied || len(mem.items) != 1 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.items))
	}
}

func TestRetryDoesNotCreateSecondChange(t *testing.T) {
	mem := &changeMem{}
	restore := mem.install()
	defer restore()
	first, err := submitChange(changeOperator(), uiChange())
	second, err2 := submitChange(changeOperator(), uiChange())
	if err != nil || err2 != nil || !second.Duplicate || first.Change.ID != second.Change.ID || len(mem.items) != 1 || first.Change.Source != "ui" || first.Change.CreatorUserID != 4 {
		t.Fatalf("ui %+v %+v err %v %v rows %d", first, second, err, err2, len(mem.items))
	}
	hook := webhookChange()
	created, err := submitChange(changeOperator(), hook)
	retried, err2 := submitChange(changeOperator(), hook)
	if err != nil || err2 != nil || !retried.Duplicate || created.Change.ID != retried.Change.ID || len(mem.items) != 2 || created.Change.ConnectionID != 3 || created.Change.EventID != "evt-1" {
		t.Fatalf("hook %+v %+v err %v %v rows %d", created, retried, err, err2, len(mem.items))
	}
	mem.fail = true
	failed := webhookChange()
	failed.EventID = "evt-9"
	failed.ExternalID = "CHG999"
	if _, err := submitChange(changeOperator(), failed); err != errInboxStored || len(mem.items) != 2 {
		t.Fatalf("dependency err %v rows %d", err, len(mem.items))
	}
	incomplete := uiChange()
	incomplete.Owner = ""
	incomplete.IdempotencyKey = "other"
	rejected, err := submitChange(changeOperator(), incomplete)
	if err != errChangeInvalid || rejected.FirstError != "owner" || rejected.Values.Impact != "high" || len(mem.items) != 2 {
		t.Fatalf("invalid %+v err %v rows %d", rejected, err, len(mem.items))
	}
}

func TestChangedArtifactInvalidatesApproval(t *testing.T) {
	mem := &changeMem{}
	restore := mem.install()
	defer restore()
	previous := loadApprovalSubject
	loadApprovalSubject = func(id int) (approvalSubject, error) {
		if id != 7 {
			return approvalSubject{}, errApprovalHidden
		}
		return approvalSubject{ID: 7, ProjectID: 10, CommitHash: "abc123", Environment: "prod", State: "approved"}, nil
	}
	defer func() { loadApprovalSubject = previous }()
	created, err := submitChange(changeOperator(), webhookChange())
	if err != nil {
		t.Fatal(err)
	}
	approved, err := approveChange(changeOperator(), created.Change.ID, 7)
	if err != nil || approved.ApprovalState != "approved" || approved.LocalState != "approved" {
		t.Fatalf("approve %+v err %v", approved, err)
	}
	released, err := releaseChange(changeOperator(), approved.ID)
	if err != errChangeRelease || released.Execution {
		t.Fatalf("local approval released %+v err %v", released, err)
	}
	changed := webhookChange()
	changed.EventID = "evt-2"
	changed.SourceRevision = 3
	changed.ImageDigest = "sha256:other"
	updated, err := submitChange(changeOperator(), changed)
	if err != nil || updated.Change.ID != created.Change.ID || updated.Change.ApprovalState != "invalidated" || updated.Change.LocalState != "assessing" || updated.Change.ImageDigest != "sha256:other" || len(mem.items) != 1 {
		t.Fatalf("update %+v err %v rows %d", updated, err, len(mem.items))
	}
	stale := changed
	stale.EventID = "evt-3"
	stale.SourceRevision = 1
	stale.ImageDigest = "sha256:old"
	kept, err := submitChange(changeOperator(), stale)
	if err != errChangeStale || kept.Change.ImageDigest != "sha256:other" || kept.Change.SourceRevision != 3 {
		t.Fatalf("stale %+v err %v", kept, err)
	}
}

func TestClosureRequiresOutcomeAndReview(t *testing.T) {
	mem := &changeMem{}
	restore := mem.install()
	defer restore()
	created, err := submitChange(changeOperator(), uiChange())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := closeChange(changeOperator(), created.Change.ID, "succeeded", ""); err != errChangeClosure || mem.items[0].LocalState != "assessing" {
		t.Fatalf("missing review err %v state %s", err, mem.items[0].LocalState)
	}
	closed, err := closeChange(changeOperator(), created.Change.ID, "succeeded", "reviewed")
	if err != nil || closed.LocalState != "closed" || closed.ClosureOutcome != "succeeded" || closed.ClosureReview != "reviewed" {
		t.Fatalf("close %+v err %v", closed, err)
	}
	queue, err := changeQueue(changeViewer(), 10)
	if err != nil || len(queue) != 1 || queue[0].Source != "ui" || queue[0].CreatorUserID != 4 {
		t.Fatalf("queue %+v err %v", queue, err)
	}
	if _, err := changeQueue(changeOperator(), 99); err != errChangeHidden {
		t.Fatalf("other project err %v", err)
	}
}
