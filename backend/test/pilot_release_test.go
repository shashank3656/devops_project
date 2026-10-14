package main

import (
	"errors"
	"testing"
)

func pilotActor(role string, projectID int) authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"staging", "production", "probe-wh12"}}},
	}
}

func installPilotMemory() {
	journeys := map[int]pilotJourney{}
	steps := map[string]pilotStep{}
	rollbacks := map[string]pilotRollback{}
	blockers := map[int]pilotBlocker{}
	feedback := map[int]pilotFeedback{}
	releases := map[int]pilotRelease{}
	expansions := map[int]pilotExpansion{}
	checks := map[string]lifecycleCheck{}
	nextJourney, nextStep, nextRollback, nextBlocker, nextFeedback, nextRelease, nextExpansion, nextCheck := 1, 1, 1, 1, 1, 1, 1, 1
	stepKey := func(journeyID int, environment, step string) string {
		return string(rune('0'+journeyID)) + ":" + environment + ":" + step
	}
	findPilotJourney = func(projectID int, service string) (pilotJourney, error) {
		for _, item := range journeys {
			if item.ProjectID == projectID && item.Service == service {
				return item, nil
			}
		}
		return pilotJourney{}, nil
	}
	savePilotJourney = func(item pilotJourney) (pilotJourney, error) {
		item.ID = nextJourney
		nextJourney++
		journeys[item.ID] = item
		return item, nil
	}
	loadPilotJourney = func(id int) (pilotJourney, error) { return journeys[id], nil }
	findPilotStep = func(journeyID int, environment, step string) (pilotStep, error) {
		return steps[stepKey(journeyID, environment, step)], nil
	}
	savePilotStep = func(item pilotStep) (pilotStep, error) {
		item.ID = nextStep
		nextStep++
		steps[stepKey(item.JourneyID, item.Environment, item.Step)] = item
		return item, nil
	}
	updatePilotStep = func(item pilotStep) (pilotStep, error) {
		steps[stepKey(item.JourneyID, item.Environment, item.Step)] = item
		return item, nil
	}
	listPilotSteps = func(journeyID int) ([]pilotStep, error) {
		var items []pilotStep
		for _, item := range steps {
			if item.JourneyID == journeyID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	findPilotRollback = func(journeyID int, environment string) (pilotRollback, error) {
		return rollbacks[stepKey(journeyID, environment, "rollback")], nil
	}
	savePilotRollback = func(item pilotRollback) (pilotRollback, error) {
		item.ID = nextRollback
		nextRollback++
		rollbacks[stepKey(item.JourneyID, item.Environment, "rollback")] = item
		return item, nil
	}
	updatePilotRollback = func(item pilotRollback) (pilotRollback, error) {
		rollbacks[stepKey(item.JourneyID, item.Environment, "rollback")] = item
		return item, nil
	}
	listPilotRollbacks = func(journeyID int) ([]pilotRollback, error) {
		var items []pilotRollback
		for _, item := range rollbacks {
			if item.JourneyID == journeyID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	savePilotBlockerRow = func(item pilotBlocker) (pilotBlocker, error) {
		item.ID = nextBlocker
		nextBlocker++
		blockers[item.ID] = item
		return item, nil
	}
	loadPilotBlockerRow = func(id int) (pilotBlocker, error) { return blockers[id], nil }
	updatePilotBlocker = func(item pilotBlocker) (pilotBlocker, error) {
		blockers[item.ID] = item
		return item, nil
	}
	listPilotBlockers = func(journeyID int) ([]pilotBlocker, error) {
		var items []pilotBlocker
		for _, item := range blockers {
			if item.JourneyID == journeyID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	savePilotFeedbackRow = func(item pilotFeedback) (pilotFeedback, error) {
		item.ID = nextFeedback
		nextFeedback++
		feedback[item.ID] = item
		return item, nil
	}
	findPilotRelease = func(journeyID int) (pilotRelease, error) { return releases[journeyID], nil }
	savePilotRelease = func(item pilotRelease) (pilotRelease, error) {
		item.ID = nextRelease
		nextRelease++
		releases[item.JourneyID] = item
		return item, nil
	}
	findPilotExpansion = func(journeyID int, provider string) (pilotExpansion, error) {
		for _, item := range expansions {
			if item.JourneyID == journeyID && item.Provider == provider {
				return item, nil
			}
		}
		return pilotExpansion{}, nil
	}
	savePilotExpansionRow = func(item pilotExpansion) (pilotExpansion, error) {
		item.ID = nextExpansion
		nextExpansion++
		expansions[item.ID] = item
		return item, nil
	}
	loadPilotExpansion = func(id int) (pilotExpansion, error) { return expansions[id], nil }
	updatePilotExpansion = func(item pilotExpansion) (pilotExpansion, error) {
		expansions[item.ID] = item
		return item, nil
	}
	savePilotAudit = func(int, string, int, string) error { return nil }
	findLifecycleCheck = func(projectID int, environment, scenario, subject string) (lifecycleCheck, error) {
		return checks[environment+":"+scenario+":"+subject], nil
	}
	saveLifecycleCheck = func(item lifecycleCheck) (lifecycleCheck, error) {
		item.ID = nextCheck
		nextCheck++
		checks[item.Environment+":"+item.Scenario+":"+item.Subject] = item
		return item, nil
	}
	updateLifecycleCheck = func(item lifecycleCheck) (lifecycleCheck, error) {
		checks[item.Environment+":"+item.Scenario+":"+item.Subject] = item
		return item, nil
	}
	listLifecycleChecks = func(projectID int, environment string) ([]lifecycleCheck, error) {
		var items []lifecycleCheck
		for _, item := range checks {
			if item.ProjectID == projectID && item.Environment == environment {
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveLifecycleAudit = func(int, string, int, string) error { return nil }
}

func fillPilotChecklist(t *testing.T, actor authzSubject, journeyID int) {
	t.Helper()
	for _, environment := range []string{"staging", "production"} {
		for _, step := range pilotStepNames {
			saved, err := recordPilotEvidence(actor, journeyID, environment, step, "observed")
			if err != nil || saved.State != "recorded" {
				t.Fatalf("step %s %s = %+v %v", environment, step, saved, err)
			}
		}
	}
}

func TestPilotChecklistHasEvidenceForEveryStep(t *testing.T) {
	installPilotMemory()
	operator := pilotActor("operator", 10)
	journey, err := openPilotJourney(operator, 10, 8, "billing", "pilot-account")
	if err != nil || journey.ID == 0 || journey.Ready {
		t.Fatalf("journey = %+v %v", journey, err)
	}
	again, err := openPilotJourney(operator, 10, 8, "billing", "pilot-account")
	if err != nil || again.ID != journey.ID {
		t.Fatalf("duplicate = %+v %v", again, err)
	}
	if _, err := openPilotJourney(operator, 10, 8, "billing", "i-0a1b2c3d4e5f67890"); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("demo account = %v", err)
	}
	if _, err := openPilotJourney(pilotActor("viewer", 10), 10, 8, "other", "pilot-account"); !errors.Is(err, errPilotDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := readPilotJourney(pilotActor("operator", 11), 10, "billing"); !errors.Is(err, errPilotHidden) {
		t.Fatalf("other project = %v", err)
	}
	missing, err := recordPilotEvidence(operator, journey.ID, "staging", "provisioning", "")
	if err != nil || missing.State != "unknown" {
		t.Fatalf("missing = %+v %v", missing, err)
	}
	if _, err := recordPilotEvidence(operator, journey.ID, "staging", "scan", "healthy"); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("healthy = %v", err)
	}
	ready, err := pilotChecklistReady(journey.ID)
	if err != nil || ready {
		t.Fatalf("early ready = %v %v", ready, err)
	}
	fillPilotChecklist(t, operator, journey.ID)
	ready, err = pilotChecklistReady(journey.ID)
	if err != nil || !ready {
		t.Fatalf("ready = %v %v", ready, err)
	}
}

func TestRollbackRehearsed(t *testing.T) {
	installPilotMemory()
	operator := pilotActor("operator", 10)
	journey, err := openPilotJourney(operator, 10, 8, "billing", "pilot-account")
	if err != nil {
		t.Fatal(err)
	}
	fillPilotChecklist(t, operator, journey.ID)
	unknown, err := rehearsePilotRollback(operator, journey.ID, "staging", false, 0)
	if err != nil || unknown.State != "unknown" || unknown.ElapsedSeconds != 0 {
		t.Fatalf("unknown = %+v %v", unknown, err)
	}
	if rehearsed, _ := pilotRollbackReady(journey.ID); rehearsed {
		t.Fatal("incomplete rollback counted")
	}
	if _, err := publishPilotRelease(operator, journey.ID, 9); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("early publish = %v", err)
	}
	staging, err := rehearsePilotRollback(operator, journey.ID, "staging", true, 12)
	if err != nil || staging.State != "rehearsed" || staging.ElapsedSeconds != 12 {
		t.Fatalf("staging = %+v %v", staging, err)
	}
	production, err := rehearsePilotRollback(operator, journey.ID, "production", true, 9)
	if err != nil || production.State != "rehearsed" {
		t.Fatalf("production = %+v %v", production, err)
	}
	if rehearsed, err := pilotRollbackReady(journey.ID); err != nil || !rehearsed {
		t.Fatalf("rehearsed = %v %v", rehearsed, err)
	}
}

func TestNoUnresolvedCriticalBlockers(t *testing.T) {
	installPilotMemory()
	operator := pilotActor("operator", 10)
	journey, err := openPilotJourney(operator, 10, 8, "billing", "pilot-account")
	if err != nil {
		t.Fatal(err)
	}
	fillPilotChecklist(t, operator, journey.ID)
	if _, err := rehearsePilotRollback(operator, journey.ID, "staging", true, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := rehearsePilotRollback(operator, journey.ID, "production", true, 5); err != nil {
		t.Fatal(err)
	}
	blocker, err := openPilotBlocker(operator, journey.ID, "critical", "Restore evidence is missing.")
	if err != nil || blocker.State != "open" {
		t.Fatalf("blocker = %+v %v", blocker, err)
	}
	if _, err := publishPilotRelease(operator, journey.ID, 9); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("blocked publish = %v", err)
	}
	if _, err := resolvePilotBlocker(operator, blocker.ID, operator.UserID, "reviewed"); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("self resolve = %v", err)
	}
	resolved, err := resolvePilotBlocker(operator, blocker.ID, 9, "reviewed")
	if err != nil || resolved.State != "resolved" || resolved.ReviewerID != 9 {
		t.Fatalf("resolved = %+v %v", resolved, err)
	}
	if _, err := publishPilotRelease(operator, journey.ID, operator.UserID); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("self publish = %v", err)
	}
	if _, err := savePilotFeedback(operator, journey.ID, "please execute this"); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("feedback = %v", err)
	}
	note, err := savePilotFeedback(operator, journey.ID, "The restore step was understandable.")
	if err != nil || note.ID == 0 {
		t.Fatalf("note = %+v %v", note, err)
	}
	release, err := publishPilotRelease(operator, journey.ID, 9)
	if err != nil || release.State != "accepted" || !release.Applied || release.ReviewerID != 9 {
		t.Fatalf("release = %+v %v", release, err)
	}
	if _, err := proposePilotExpansion(operator, journey.ID, "azure", "*", 6); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("wildcard expansion = %v", err)
	}
	if _, err := proposePilotExpansion(operator, journey.ID, "azure", "staging", 0); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("ownerless expansion = %v", err)
	}
	expansion, err := proposePilotExpansion(operator, journey.ID, "azure", "staging", 6)
	if err != nil || expansion.State != "proposed" || expansion.OwnerID != 6 || expansion.Scope != "staging" {
		t.Fatalf("expansion = %+v %v", expansion, err)
	}
	if _, err := acceptPilotExpansion(operator, expansion.ID, operator.UserID); !errors.Is(err, errPilotInvalid) {
		t.Fatalf("self expansion = %v", err)
	}
	accepted, err := acceptPilotExpansion(operator, expansion.ID, 9)
	if err != nil || accepted.State != "accepted" || accepted.ReviewerID != 9 {
		t.Fatalf("accepted = %+v %v", accepted, err)
	}
	if open, _ := pilotCriticalOpen(journey.ID); open {
		t.Fatal("critical blocker remained open")
	}
}

func TestWebhookLifecycleRecovery(t *testing.T) {
	installPilotMemory()
	operator := pilotActor("operator", 10)
	first, err := recordLifecycleCheck(operator, 10, "probe-wh12", "duplicate", "event-1", 2, "")
	if err != nil || !first.Applied || first.Effect != 1 || first.State != "recorded" {
		t.Fatalf("duplicate = %+v %v", first, err)
	}
	again, err := recordLifecycleCheck(operator, 10, "probe-wh12", "duplicate", "event-1", 2, "")
	if err != nil || again.Applied || again.ID != first.ID || again.Effect != 1 || again.Attempts != 1 {
		t.Fatalf("replay duplicate = %+v %v", again, err)
	}
	ordered, err := recordLifecycleCheck(operator, 10, "probe-wh12", "out_of_order", "event-1", 4, "")
	if err != nil {
		t.Fatal(err)
	}
	stale, err := recordLifecycleCheck(operator, 10, "probe-wh12", "out_of_order", "event-1", 1, "")
	if err != nil || stale.Revision != ordered.Revision || stale.Reason != "older revision retained" {
		t.Fatalf("stale = %+v %v", stale, err)
	}
	mapped, err := recordLifecycleCheck(operator, 10, "probe-wh12", "replay", "event-1", 1, "")
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := recordLifecycleCheck(operator, 10, "probe-wh12", "replay", "event-1", 1, "")
	if err != nil || repeated.ID != mapped.ID || repeated.Applied || repeated.Effect != 1 {
		t.Fatalf("repeated replay = %+v %v", repeated, err)
	}
	if _, err := recordLifecycleCheck(operator, 10, "probe-wh12", "invalid_signature", "event-1", 1, ""); !errors.Is(err, errLifecycleInvalid) {
		t.Fatalf("signature = %v", err)
	}
	if found, _ := findLifecycleCheck(10, "probe-wh12", "invalid_signature", "event-1"); found.ID != 0 {
		t.Fatalf("signature wrote %+v", found)
	}
	crashed, err := recordLifecycleCheck(operator, 10, "probe-wh12", "worker_crash", "event-1", 1, "")
	if err != nil || crashed.State != "recoverable" {
		t.Fatalf("crash = %+v %v", crashed, err)
	}
	if _, err := recordLifecycleCheck(operator, 10, "probe-wh12", "worker_crash", "event-1", 1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := recordLifecycleCheck(operator, 10, "probe-wh12", "worker_crash", "event-1", 1, ""); err != nil {
		t.Fatal(err)
	}
	bound, err := recordLifecycleCheck(operator, 10, "probe-wh12", "worker_crash", "event-1", 1, "")
	if err != nil || bound.Applied || bound.State != "recoverable" || bound.Attempts != 3 || bound.Reason != "retry bound reached" {
		t.Fatalf("bound = %+v %v", bound, err)
	}
	outage, err := recordLifecycleCheck(operator, 10, "probe-wh12", "provider_outage", "event-1", 1, "")
	if err != nil || outage.State != "unknown" {
		t.Fatalf("outage = %+v %v", outage, err)
	}
	sandbox, err := recordLifecycleCheck(operator, 10, "probe-wh12", "sandbox", "event-1", 1, "")
	if err != nil || sandbox.State != "unknown" || sandbox.Reason != "sandbox resource not observed" {
		t.Fatalf("sandbox = %+v %v", sandbox, err)
	}
	if _, err := recordLifecycleCheck(operator, 10, "probe-wh12", "sandbox", "event-2", 1, "setuops-terraform-dev"); !errors.Is(err, errLifecycleInvalid) {
		t.Fatalf("claimed sandbox = %v", err)
	}
	if leaked, err := readLifecycleChecks(pilotActor("operator", 11), 10, "probe-wh12"); err == nil || leaked != nil {
		t.Fatalf("leaked %+v %v", leaked, err)
	}
	if _, err := recordLifecycleCheck(pilotActor("viewer", 10), 10, "probe-wh12", "cross_scope", "event-1", 1, ""); !errors.Is(err, errLifecycleDenied) {
		t.Fatalf("viewer = %v", err)
	}
}
