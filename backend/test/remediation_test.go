package main

import "testing"

const (
	remediationDigestA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	remediationDigestB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type remediationMem struct {
	links []remediationLink
	runs  []verificationRun
}

func (m *remediationMem) install() func() {
	previousSave := saveRemediationLink
	previousFind := findRemediationLink
	previousLoad := loadRemediationLink
	previousUpdate := updateRemediationLink
	previousInsert := insertVerificationRun
	previousFindRun := findVerificationRun
	previousList := listVerificationRuns
	previousAssignment := loadRemediationAssignment
	previousAttempt := loadRemediationAttempt
	saveRemediationLink = func(item remediationLink) (remediationLink, error) {
		item.ID = len(m.links) + 1
		item.Runs = nil
		m.links = append(m.links, item)
		return item, nil
	}
	findRemediationLink = func(projectID int, findingKey, pullRequest string) (remediationLink, error) {
		for _, item := range m.links {
			if item.ProjectID == projectID && item.FindingKey == findingKey && item.PullRequest == pullRequest {
				item.Runs = nil
				return item, nil
			}
		}
		return remediationLink{}, nil
	}
	loadRemediationLink = func(id int) (remediationLink, error) {
		for _, item := range m.links {
			if item.ID == id {
				item.Runs = nil
				return item, nil
			}
		}
		return remediationLink{}, errRemediationHidden
	}
	updateRemediationLink = func(item remediationLink) (remediationLink, error) {
		for index := range m.links {
			if m.links[index].ID == item.ID {
				item.Runs = nil
				m.links[index] = item
				return item, nil
			}
		}
		return remediationLink{}, errRemediationHidden
	}
	insertVerificationRun = func(item verificationRun) (verificationRun, error) {
		item.ID = len(m.runs) + 1
		m.runs = append(m.runs, item)
		return item, nil
	}
	findVerificationRun = func(linkID int, digest, result string) (verificationRun, error) {
		for _, item := range m.runs {
			if item.LinkID == linkID && item.ImageDigest == digest && item.Result == result {
				return item, nil
			}
		}
		return verificationRun{}, nil
	}
	listVerificationRuns = func(linkID int) ([]verificationRun, error) {
		var items []verificationRun
		for _, item := range m.runs {
			if item.LinkID == linkID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	loadRemediationAssignment = func(projectID int, findingKey string) (findingAssignment, error) {
		if projectID == 10 && findingKey == "finding-a" {
			return findingAssignment{ID: 3, ProjectID: 10, FindingKey: findingKey, State: "triage"}, nil
		}
		return findingAssignment{}, nil
	}
	loadRemediationAttempt = func(id int) (deploymentAttempt, error) {
		switch id {
		case 4:
			return deploymentAttempt{ID: 4, ProjectID: 10, Environment: "dev", ImageDigest: remediationDigestA, State: "success"}, nil
		case 5:
			return deploymentAttempt{ID: 5, ProjectID: 10, Environment: "dev", ImageDigest: remediationDigestA, State: "failed"}, nil
		case 6:
			return deploymentAttempt{ID: 6, ProjectID: 10, Environment: "dev", ImageDigest: remediationDigestB, State: "success"}, nil
		default:
			return deploymentAttempt{}, errRemediationHidden
		}
	}
	return func() {
		saveRemediationLink = previousSave
		findRemediationLink = previousFind
		loadRemediationLink = previousLoad
		updateRemediationLink = previousUpdate
		insertVerificationRun = previousInsert
		findVerificationRun = previousFindRun
		listVerificationRuns = previousList
		loadRemediationAssignment = previousAssignment
		loadRemediationAttempt = previousAttempt
	}
}

func remediationActor(userID int, role string) authzSubject {
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func remediationInputFor(state string) remediationInput {
	return remediationInput{
		ProjectID: 10, FindingKey: "finding-a", PullRequest: "17", PullRequestState: state,
		ChangeID: "CHG-17", ImageDigest: remediationDigestA, Environment: "dev",
	}
}

func TestMergedPullRequestCannotResolve(t *testing.T) {
	mem := &remediationMem{}
	defer mem.install()()
	linked, err := linkRemediation(remediationActor(4, "operator"), remediationInputFor("merged"))
	if err != nil || linked.Resolved || linked.State != "open" || linked.DeploymentState != "missing" || linked.PullRequestState != "merged" {
		t.Fatalf("linked %+v err %v", linked, err)
	}
	again, err := linkRemediation(remediationActor(4, "operator"), remediationInputFor("merged"))
	if err != nil || again.ID != linked.ID || again.Resolved || len(mem.links) != 1 {
		t.Fatalf("again %+v links %d err %v", again, len(mem.links), err)
	}
	if _, err := linkRemediation(remediationActor(5, "viewer"), remediationInputFor("open")); err != errRemediationDenied || len(mem.links) != 1 {
		t.Fatalf("viewer links %d err %v", len(mem.links), err)
	}
	hidden := remediationInputFor("merged")
	hidden.ProjectID = 11
	if _, err := linkRemediation(remediationActor(4, "operator"), hidden); err != errRemediationHidden || len(mem.links) != 1 {
		t.Fatalf("hidden links %d err %v", len(mem.links), err)
	}
	missing := remediationInputFor("merged")
	missing.FindingKey = "missing"
	if _, err := linkRemediation(remediationActor(4, "operator"), missing); err != errRemediationInvalid || len(mem.links) != 1 {
		t.Fatalf("missing links %d err %v", len(mem.links), err)
	}
}

func TestFailedRescanLeavesItOpen(t *testing.T) {
	mem := &remediationMem{}
	defer mem.install()()
	linked, err := linkRemediation(remediationActor(4, "operator"), remediationInputFor("merged"))
	if err != nil {
		t.Fatal(err)
	}
	waiting, err := recordRemediationDelivery(remediationActor(4, "operator"), linked.ID, 4)
	if err != nil || waiting.Resolved || waiting.State != "awaiting_verification" || waiting.DeploymentState != "success" {
		t.Fatalf("waiting %+v err %v", waiting, err)
	}
	failedDelivery, err := recordRemediationDelivery(remediationActor(4, "operator"), linked.ID, 5)
	if err != nil || failedDelivery.Resolved || failedDelivery.State != "open" || failedDelivery.DeploymentState != "failed" {
		t.Fatalf("failed delivery %+v err %v", failedDelivery, err)
	}
	waiting, err = recordRemediationDelivery(remediationActor(4, "operator"), linked.ID, 4)
	if err != nil || waiting.State != "awaiting_verification" {
		t.Fatalf("redeliver %+v err %v", waiting, err)
	}
	failed, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestA, "fail")
	if err != nil || failed.Resolved || failed.State != "open" || len(failed.Runs) != 1 || failed.Runs[0].Result != "fail" {
		t.Fatalf("failed %+v err %v", failed, err)
	}
	again, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestA, "fail")
	if err != nil || len(again.Runs) != 1 || len(mem.runs) != 1 {
		t.Fatalf("again %+v runs %d err %v", again, len(mem.runs), err)
	}
	other, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestB, "pass")
	if err != nil || other.Resolved || other.State != "open" || len(other.Runs) != 2 {
		t.Fatalf("other %+v err %v", other, err)
	}
	if _, err := recordRemediationDelivery(remediationActor(4, "operator"), linked.ID, 6); err != errRemediationInvalid {
		t.Fatalf("mismatch err %v", err)
	}
}

func TestDeployedArtifactVerifiedBeforeClosure(t *testing.T) {
	mem := &remediationMem{}
	defer mem.install()()
	linked, err := linkRemediation(remediationActor(4, "operator"), remediationInputFor("merged"))
	if err != nil {
		t.Fatal(err)
	}
	early, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestA, "pass")
	if err != nil || early.Resolved || early.State != "open" || early.DeploymentState != "missing" {
		t.Fatalf("early %+v err %v", early, err)
	}
	waiting, err := recordRemediationDelivery(remediationActor(4, "operator"), linked.ID, 4)
	if err != nil || waiting.Resolved || waiting.State != "awaiting_verification" {
		t.Fatalf("waiting %+v err %v", waiting, err)
	}
	closed, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestA, "pass")
	if err != nil || !closed.Resolved || closed.State != "resolved" || closed.ImageDigest != remediationDigestA {
		t.Fatalf("closed %+v err %v", closed, err)
	}
	reopened, err := recordRemediationVerification(remediationActor(4, "operator"), linked.ID, remediationDigestA, "fail")
	if err != nil || reopened.Resolved || reopened.State != "open" || len(reopened.Runs) < 2 {
		t.Fatalf("reopened %+v err %v", reopened, err)
	}
	kept := 0
	for _, run := range reopened.Runs {
		if run.Result == "pass" || run.Result == "fail" {
			kept++
		}
	}
	if kept < 2 {
		t.Fatalf("runs %+v", reopened.Runs)
	}
	if _, err := recordRemediationVerification(remediationActor(5, "viewer"), linked.ID, remediationDigestA, "pass"); err != errRemediationDenied {
		t.Fatalf("viewer err %v", err)
	}
}
