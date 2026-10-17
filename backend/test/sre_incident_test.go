package main

import (
	"errors"
	"testing"
)

func incidentActor(role string, projectID int, environments []string) authzSubject {
	userID := 4
	if role == "viewer" {
		userID = 5
	}
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: environments}},
	}
}

func installIncidentMemory() {
	incidents := map[int]sreIncident{}
	timeline := map[int]sreTimelineEntry{}
	runbooks := map[int]sreRunbookLink{}
	reviews := map[int]sreReviewDraft{}
	followUps := map[int]sreFollowUp{}
	nextIncident, nextTimeline, nextRunbook, nextReview, nextFollow := 1, 1, 1, 1, 1
	saveSREIncident = func(item sreIncident) (sreIncident, error) {
		item.ID = nextIncident
		nextIncident++
		incidents[item.ID] = item
		return item, nil
	}
	findSREIncident = func(projectID int, source, fingerprint string) (sreIncident, error) {
		for id := 1; id < nextIncident; id++ {
			item, ok := incidents[id]
			if ok && item.ProjectID == projectID && item.Source == source && item.Fingerprint == fingerprint {
				return item, nil
			}
		}
		return sreIncident{}, nil
	}
	loadSREIncident = func(id int) (sreIncident, error) {
		item, ok := incidents[id]
		if !ok {
			return sreIncident{}, errIncidentHidden
		}
		return item, nil
	}
	updateSREIncident = func(item sreIncident) (sreIncident, error) {
		if _, ok := incidents[item.ID]; !ok {
			return sreIncident{}, errIncidentHidden
		}
		incidents[item.ID] = item
		return item, nil
	}
	saveSRETimeline = func(item sreTimelineEntry) (sreTimelineEntry, error) {
		item.ID = nextTimeline
		nextTimeline++
		timeline[item.ID] = item
		return item, nil
	}
	findSRETimeline = func(incidentID int, eventKey string) (sreTimelineEntry, error) {
		for id := 1; id < nextTimeline; id++ {
			item, ok := timeline[id]
			if ok && item.IncidentID == incidentID && item.EventKey == eventKey {
				return item, nil
			}
		}
		return sreTimelineEntry{}, nil
	}
	listSRETimeline = func(incidentID int) ([]sreTimelineEntry, error) {
		list := []sreTimelineEntry{}
		for id := 1; id < nextTimeline; id++ {
			item, ok := timeline[id]
			if ok && item.IncidentID == incidentID {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveSRERunbook = func(item sreRunbookLink) (sreRunbookLink, error) {
		item.ID = nextRunbook
		nextRunbook++
		runbooks[item.ID] = item
		return item, nil
	}
	findSRERunbook = func(incidentID int, name string) (sreRunbookLink, error) {
		for id := 1; id < nextRunbook; id++ {
			item, ok := runbooks[id]
			if ok && item.IncidentID == incidentID && item.Name == name {
				return item, nil
			}
		}
		return sreRunbookLink{}, nil
	}
	listSRERunbooks = func(incidentID int) ([]sreRunbookLink, error) {
		list := []sreRunbookLink{}
		for id := 1; id < nextRunbook; id++ {
			item, ok := runbooks[id]
			if ok && item.IncidentID == incidentID {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveSREReview = func(item sreReviewDraft) (sreReviewDraft, error) {
		item.ID = nextReview
		nextReview++
		reviews[item.ID] = item
		return item, nil
	}
	findSREReview = func(incidentID int) (sreReviewDraft, error) {
		for id := 1; id < nextReview; id++ {
			item, ok := reviews[id]
			if ok && item.IncidentID == incidentID {
				return item, nil
			}
		}
		return sreReviewDraft{}, nil
	}
	saveSREFollowUp = func(item sreFollowUp) (sreFollowUp, error) {
		item.ID = nextFollow
		nextFollow++
		followUps[item.ID] = item
		return item, nil
	}
	findSREFollowUp = func(incidentID int, title string) (sreFollowUp, error) {
		for id := 1; id < nextFollow; id++ {
			item, ok := followUps[id]
			if ok && item.IncidentID == incidentID && item.Title == title {
				return item, nil
			}
		}
		return sreFollowUp{}, nil
	}
	listSREFollowUps = func(incidentID int) ([]sreFollowUp, error) {
		list := []sreFollowUp{}
		for id := 1; id < nextFollow; id++ {
			item, ok := followUps[id]
			if ok && item.IncidentID == incidentID {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveSREIncidentAudit = func(sreIncidentAudit) error { return nil }
}

func incidentInput(source, fingerprint, severity string) sreIncidentInput {
	return sreIncidentInput{
		ProjectID: 10, Environment: "dev", Source: source, Fingerprint: fingerprint,
		Severity: severity, Summary: "error budget spent",
	}
}

func TestRepeatedAlertUpdatesSameIncident(t *testing.T) {
	installIncidentMemory()
	operator := incidentActor("operator", 10, []string{"dev"})
	first, err := recordSREIncident(operator, incidentInput("pager", "fp-api", "critical"))
	if err != nil || first.Status != "open" || first.Occurrences != 1 || first.OwnerTeam != "" || first.Severity != "critical" {
		t.Fatalf("first = %+v %v", first, err)
	}
	againInput := incidentInput("pager", "fp-api", "low")
	againInput.Summary = "still firing"
	againInput.OwnerTeam = "payments"
	again, err := recordSREIncident(operator, againInput)
	if err != nil || again.ID != first.ID || again.Occurrences != 2 || again.Summary != "still firing" || again.Severity != "critical" || again.OwnerTeam != "payments" || again.Status != "open" {
		t.Fatalf("repeat = %+v %v", again, err)
	}
	other, err := recordSREIncident(operator, incidentInput("grafana", "fp-api", "critical"))
	if err != nil || other.ID == first.ID {
		t.Fatalf("other source = %+v %v", other, err)
	}
	if _, err := recordSREIncident(incidentActor("viewer", 10, []string{"dev"}), incidentInput("pager", "fp-new", "high")); !errors.Is(err, errIncidentDenied) {
		t.Fatalf("viewer = %v", err)
	}
	if _, err := recordSREIncident(incidentActor("operator", 11, []string{"dev"}), incidentInput("pager", "fp-api", "critical")); !errors.Is(err, errIncidentHidden) {
		t.Fatalf("other project = %v", err)
	}
}

func TestCriticalClosurePolicyIsEnforced(t *testing.T) {
	installIncidentMemory()
	operator := incidentActor("operator", 10, []string{"dev"})
	item, err := recordSREIncident(operator, incidentInput("pager", "fp-api", "critical"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := closeSREIncident(operator, item.ID, "recovered"); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("bare close = %v", err)
	}
	current, _ := loadSREIncident(item.ID)
	if current.Status != "open" {
		t.Fatalf("status changed to %s", current.Status)
	}
	unknown, err := appendSRETimeline(operator, item.ID, "event-1", "slo", "slo:api", "", "window incomplete")
	if err != nil || unknown.EvidenceState != "unknown" {
		t.Fatalf("unknown evidence = %+v %v", unknown, err)
	}
	if _, err := closeSREIncident(operator, item.ID, "recovered"); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("unknown close = %v", err)
	}
	recorded, err := appendSRETimeline(operator, item.ID, "event-2", "pod_failure", "pod:11111111-1111-1111-1111-111111111111", "recorded", "oom")
	if err != nil || recorded.EvidenceState != "recorded" {
		t.Fatalf("recorded = %+v %v", recorded, err)
	}
	same, err := appendSRETimeline(operator, item.ID, "event-2", "pod_failure", "pod:other", "recorded", "oom")
	if err != nil || same.ID != recorded.ID || same.EvidenceRef != recorded.EvidenceRef {
		t.Fatalf("timeline retry = %+v %v", same, err)
	}
	if _, err := linkSRERunbook(operator, item.ID, "restart-api", false); err != nil {
		t.Fatal(err)
	}
	if _, err := closeSREIncident(operator, item.ID, "recovered"); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("unreviewed close = %v", err)
	}
	if _, err := linkSRERunbook(operator, item.ID, "restart-api-reviewed", true); err != nil {
		t.Fatal(err)
	}
	closed, err := closeSREIncident(operator, item.ID, "recovered")
	if err != nil || closed.Status != "resolved" || closed.ClosureReason != "recovered" || len(closed.Timeline) != 2 {
		t.Fatalf("closed = %+v %v", closed, err)
	}
	blank, err := recordSREIncident(operator, incidentInput("pager", "fp-blank", ""))
	if err != nil || blank.Severity != "unknown" {
		t.Fatalf("unknown severity = %+v %v", blank, err)
	}
	if _, err := closeSREIncident(operator, blank.ID, "recovered"); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("unknown severity close = %v", err)
	}
}

func TestPIRDraftCitesEvidence(t *testing.T) {
	installIncidentMemory()
	operator := incidentActor("operator", 10, []string{"dev"})
	item, err := recordSREIncident(operator, incidentInput("pager", "fp-api", "high"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recordSREReview(operator, item.ID, "draft without a citation", "chg-1", "chg-1", true, nil); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("empty citation = %v", err)
	}
	if _, err := appendSRETimeline(operator, item.ID, "event-1", "pod_failure", "pod:probe-f21", "recorded", "oom"); err != nil {
		t.Fatal(err)
	}
	if _, err := recordSREReview(operator, item.ID, "draft cites nothing", "chg-1", "oom", true, []string{"pod:missing"}); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("missing ref = %v", err)
	}
	if found, _ := findSREReview(item.ID); found.ID != 0 {
		t.Fatalf("invalid review wrote %+v", found)
	}
	draft, err := recordSREReview(operator, item.ID, "draft cites pod:probe-f21", "chg-1", "chg-1", true, []string{"pod:probe-f21"})
	if err != nil || draft.ProvenCause != "unknown" || draft.SuspectedChange != "chg-1" || len(draft.EvidenceRefs) != 1 {
		t.Fatalf("suspected = %+v %v", draft, err)
	}
	provenItem, err := recordSREIncident(operator, incidentInput("pager", "fp-proven", "high"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := appendSRETimeline(operator, provenItem.ID, "event-1", "slo", "slo:api", "recorded", "budget"); err != nil {
		t.Fatal(err)
	}
	proven, err := recordSREReview(operator, provenItem.ID, "draft cites slo:api after the digest check", "chg-1", "oom on the new digest", true, []string{"slo:api"})
	if err != nil || proven.ProvenCause != "oom on the new digest" || proven.SuspectedChange != "chg-1" {
		t.Fatalf("proven = %+v %v", proven, err)
	}
	if _, err := recordSREFollowUp(operator, item.ID, "add-limit", ""); !errors.Is(err, errIncidentInvalid) {
		t.Fatalf("missing owner = %v", err)
	}
	follow, err := recordSREFollowUp(operator, item.ID, "add-limit", "payments")
	if err != nil || follow.Status != "open" || follow.OwnerTeam != "payments" {
		t.Fatalf("follow = %+v %v", follow, err)
	}
	same, err := recordSREFollowUp(operator, item.ID, "add-limit", "payments")
	if err != nil || same.ID != follow.ID {
		t.Fatalf("follow retry = %+v %v", same, err)
	}
	read, err := readSREIncident(operator, 10, "pager", "fp-api")
	if err != nil || read.Status != "open" || len(read.FollowUps) != 1 || read.Review == nil || read.Review.ProvenCause != "unknown" {
		t.Fatalf("read = %+v %v", read, err)
	}
}
