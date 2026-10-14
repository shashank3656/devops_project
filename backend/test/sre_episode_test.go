package main

import (
	"errors"
	"testing"
	"time"
)

func episodeActor(role string, projectID int) authzSubject {
	userID := 4
	if role == "viewer" {
		userID = 5
	}
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: []string{"dev"}}},
	}
}

func installEpisodeMemory() {
	episodes := map[int]alertEpisode{}
	events := map[string]int{}
	problems := map[int]sreProblem{}
	links := map[int]map[int]bool{}
	incidents := map[int]sreIncident{}
	nextEpisode, nextProblem := 1, 1
	var resolved []int
	episodeClock = func() time.Time { return time.Date(2026, 10, 14, 1, 0, 0, 0, time.UTC) }
	loadEpisodeConnection = func(id int) (episodeConnection, error) {
		if id == 7 {
			return episodeConnection{ID: 7, ProjectID: 10, Name: "probe-wh07"}, nil
		}
		return episodeConnection{}, errEpisodeHidden
	}
	saveAlertEpisode = func(item alertEpisode) (alertEpisode, error) {
		item.ID = nextEpisode
		nextEpisode++
		episodes[item.ID] = item
		return item, nil
	}
	updateAlertEpisode = func(item alertEpisode) (alertEpisode, error) {
		if _, ok := episodes[item.ID]; !ok {
			return alertEpisode{}, errEpisodeHidden
		}
		episodes[item.ID] = item
		return item, nil
	}
	findAlertEpisode = func(id int) (alertEpisode, error) {
		item, ok := episodes[id]
		if !ok {
			return alertEpisode{}, errEpisodeHidden
		}
		return item, nil
	}
	latestAlertEpisode = func(projectID, connectionID int, fingerprint string) (alertEpisode, error) {
		var latest alertEpisode
		for id := 1; id < nextEpisode; id++ {
			item, ok := episodes[id]
			if ok && item.ProjectID == projectID && item.ConnectionID == connectionID && item.Fingerprint == fingerprint && item.Sequence >= latest.Sequence {
				latest = item
			}
		}
		return latest, nil
	}
	listAlertEpisodes = func(projectID int, environment string) ([]alertEpisode, error) {
		list := []alertEpisode{}
		for id := 1; id < nextEpisode; id++ {
			item, ok := episodes[id]
			if ok && item.ProjectID == projectID && item.Environment == environment {
				list = append(list, item)
			}
		}
		return list, nil
	}
	findEpisodeEvent = func(projectID int, eventID string) (alertEpisode, error) {
		episodeID, ok := events[eventID]
		if !ok {
			return alertEpisode{}, nil
		}
		item := episodes[episodeID]
		if item.ProjectID != projectID {
			return alertEpisode{}, nil
		}
		return item, nil
	}
	saveEpisodeEvent = func(projectID, episodeID int, eventID string, applied bool, reason string) error {
		events[eventID] = episodeID
		return nil
	}
	openEpisodeIncident = func(actor authzSubject, projectID int, environment, fingerprint string, sequence int, severity string) (int, error) {
		id := 100 + sequence
		incidents[id] = sreIncident{ID: id, ProjectID: projectID, Environment: environment, Source: "episode", Fingerprint: fingerprint, Severity: severity, Status: "open"}
		return id, nil
	}
	resolveEpisodeIncident = func(actor authzSubject, incidentID int) error {
		resolved = append(resolved, incidentID)
		item := incidents[incidentID]
		item.Status = "resolved"
		incidents[incidentID] = item
		return nil
	}
	loadSREIncident = func(id int) (sreIncident, error) {
		item, ok := incidents[id]
		if !ok {
			return sreIncident{}, errIncidentHidden
		}
		return item, nil
	}
	saveSREProblem = func(item sreProblem) (sreProblem, error) {
		item.ID = nextProblem
		nextProblem++
		problems[item.ID] = item
		return item, nil
	}
	findSREProblem = func(projectID, connectionID int, externalID string) (sreProblem, error) {
		for id := 1; id < nextProblem; id++ {
			item, ok := problems[id]
			if ok && item.ProjectID == projectID && item.ConnectionID == connectionID && item.ExternalID == externalID {
				return item, nil
			}
		}
		return sreProblem{}, nil
	}
	loadSREProblem = func(id int) (sreProblem, error) {
		item, ok := problems[id]
		if !ok {
			return sreProblem{}, errEpisodeHidden
		}
		return item, nil
	}
	updateSREProblem = func(item sreProblem) (sreProblem, error) {
		problems[item.ID] = item
		return item, nil
	}
	listSREProblems = func(projectID int, environment string) ([]sreProblem, error) {
		list := []sreProblem{}
		for id := 1; id < nextProblem; id++ {
			item, ok := problems[id]
			if ok && item.ProjectID == projectID && item.Environment == environment {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveProblemLink = func(problemID, incidentID int) error {
		if links[problemID] == nil {
			links[problemID] = map[int]bool{}
		}
		links[problemID][incidentID] = true
		return nil
	}
	findProblemLink = func(problemID, incidentID int) (int, error) {
		if links[problemID][incidentID] {
			return incidentID, nil
		}
		return 0, nil
	}
	listProblemLinks = func(problemID int) ([]int, error) {
		list := []int{}
		for incidentID := range links[problemID] {
			list = append(list, incidentID)
		}
		return list, nil
	}
	saveEpisodeAudit = func(episodeAudit) error { return nil }
	_ = resolved
}

func firingInput(eventID, occurred, received, severity string) episodeInput {
	return episodeInput{
		ProjectID: 10, ConnectionID: 7, Environment: "dev", Fingerprint: "fp-api", Kind: "firing",
		EventID: eventID, OccurrenceAt: occurred, ReceivedAt: received, EvidenceState: "unknown", Severity: severity, Source: "webhook",
	}
}

func TestRepeatedFiringUpdatesOneEpisode(t *testing.T) {
	installEpisodeMemory()
	operator := episodeActor("operator", 10)
	first, err := ingestAlertEpisode(operator, firingInput("event-1", "2026-10-14T00:00:00Z", "2026-10-14T00:01:00Z", "critical"))
	if err != nil || !first.Applied || first.Sequence != 1 || first.Status != "firing" || first.IncidentID == 0 {
		t.Fatalf("first = %+v %v", first, err)
	}
	again, err := ingestAlertEpisode(operator, firingInput("event-2", "2026-10-14T00:02:00Z", "2026-10-14T00:03:00Z", "critical"))
	if err != nil || again.ID != first.ID || again.Sequence != 1 || again.IncidentID != first.IncidentID || again.Reason != "firing updated the episode" {
		t.Fatalf("repeat = %+v %v", again, err)
	}
	duplicate, err := ingestAlertEpisode(operator, firingInput("event-2", "2026-10-14T00:02:00Z", "2026-10-14T00:03:00Z", "critical"))
	if err != nil || duplicate.ID != first.ID || duplicate.Reason != "duplicate event" {
		t.Fatalf("duplicate = %+v %v", duplicate, err)
	}
	if _, err := ingestAlertEpisode(episodeActor("viewer", 10), firingInput("event-9", "2026-10-14T00:04:00Z", "2026-10-14T00:05:00Z", "high")); !errors.Is(err, errEpisodeDenied) {
		t.Fatalf("viewer = %v", err)
	}
}

func TestLateFiringDoesNotReopen(t *testing.T) {
	installEpisodeMemory()
	operator := episodeActor("operator", 10)
	first, err := ingestAlertEpisode(operator, firingInput("event-1", "2026-10-14T00:00:00Z", "2026-10-14T00:01:00Z", "high"))
	if err != nil {
		t.Fatal(err)
	}
	recovery := firingInput("event-2", "2026-10-14T00:10:00Z", "2026-10-14T00:11:00Z", "high")
	recovery.Kind = "recovery"
	recovery.EvidenceState = "recorded"
	resolved, err := ingestAlertEpisode(operator, recovery)
	if err != nil || resolved.Status != "resolved" || resolved.ID != first.ID {
		t.Fatalf("recovery = %+v %v", resolved, err)
	}
	late := firingInput("event-3", "2026-10-14T00:05:00Z", "2026-10-14T00:12:00Z", "high")
	held, err := ingestAlertEpisode(operator, late)
	if err != nil || held.Applied || held.Status != "resolved" || held.Sequence != 1 || held.Reason != "late firing does not reopen" {
		t.Fatalf("late = %+v %v", held, err)
	}
	next := firingInput("event-4", "2026-10-14T00:20:00Z", "2026-10-14T00:21:00Z", "high")
	opened, err := ingestAlertEpisode(operator, next)
	if err != nil || opened.ID == first.ID || opened.Sequence != 2 || opened.Status != "firing" || opened.IncidentID == first.IncidentID {
		t.Fatalf("new episode = %+v %v", opened, err)
	}
}

func TestRecoveryWithoutEvidenceStaysOpen(t *testing.T) {
	installEpisodeMemory()
	operator := episodeActor("operator", 10)
	first, err := ingestAlertEpisode(operator, firingInput("event-1", "2026-10-14T00:00:00Z", "2026-10-14T00:01:00Z", "critical"))
	if err != nil {
		t.Fatal(err)
	}
	recovery := firingInput("event-2", "2026-10-14T00:10:00Z", "2026-10-14T00:11:00Z", "critical")
	recovery.Kind = "recovery"
	held, err := ingestAlertEpisode(operator, recovery)
	if err != nil || held.Status != "firing" || held.Applied || held.Reason != "recovery evidence is unknown" || held.CausationProven {
		t.Fatalf("unknown recovery = %+v %v", held, err)
	}
	incident, _ := loadSREIncident(first.IncidentID)
	if incident.Status != "open" {
		t.Fatalf("incident closed: %+v", incident)
	}
	manual := firingInput("event-ui-1", "2026-10-14T00:30:00Z", "2026-10-14T00:31:00Z", "high")
	manual.Source = "ui"
	manual.ConnectionID = 0
	manual.CreatorUserID = operator.UserID
	manual.Fingerprint = "fp-manual"
	created, err := ingestAlertEpisode(operator, manual)
	if err != nil || created.Source != "ui" || created.CreatorUserID != operator.UserID || created.ConnectionID != 0 {
		t.Fatalf("manual = %+v %v", created, err)
	}
	rows, err := listEpisodeRecords(operator, 10, "dev")
	if err != nil || len(rows) != 2 {
		t.Fatalf("list = %+v %v", rows, err)
	}
}

func TestIncidentClosureLeavesProblemOpen(t *testing.T) {
	installEpisodeMemory()
	operator := episodeActor("operator", 10)
	first, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 7, ExternalID: "prb-1", Title: "oom loop", SymptomKey: "oom", Source: "webhook", EventID: "problem-1",
	})
	if err != nil || first.Status != "open" {
		t.Fatalf("problem = %+v %v", first, err)
	}
	again, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 7, ExternalID: "prb-1", Title: "oom loop updated", SymptomKey: "oom", Source: "webhook", EventID: "problem-1",
	})
	if err != nil || again.ID != first.ID || again.Title != "oom loop updated" {
		t.Fatalf("upsert = %+v %v", again, err)
	}
	sameTitle, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 7, ExternalID: "prb-2", Title: "oom loop updated", SymptomKey: "disk", Source: "webhook", EventID: "problem-2",
	})
	if err != nil || sameTitle.ID == first.ID {
		t.Fatalf("title merge = %+v %v", sameTitle, err)
	}
	episode, err := ingestAlertEpisode(operator, firingInput("event-1", "2026-10-14T00:00:00Z", "2026-10-14T00:01:00Z", "high"))
	if err != nil {
		t.Fatal(err)
	}
	linked, err := linkEpisodeProblem(operator, episode.ID, first.ID)
	if err != nil || linked.ProblemID != first.ID || linked.CausationProven {
		t.Fatalf("link = %+v %v", linked, err)
	}
	joined, err := linkSREProblemIncident(operator, first.ID, episode.IncidentID)
	if err != nil || len(joined.IncidentIDs) != 1 {
		t.Fatalf("incident link = %+v %v", joined, err)
	}
	retried, err := linkSREProblemIncident(operator, first.ID, episode.IncidentID)
	if err != nil || len(retried.IncidentIDs) != 1 {
		t.Fatalf("link retry = %+v %v", retried, err)
	}
	if err := resolveEpisodeIncident(operator, episode.IncidentID); err != nil {
		t.Fatal(err)
	}
	problem, err := loadSREProblem(first.ID)
	if err != nil || problem.Status != "open" {
		t.Fatalf("problem changed = %+v %v", problem, err)
	}
}

func TestKnownErrorNeedsCauseAndWorkaround(t *testing.T) {
	installEpisodeMemory()
	operator := episodeActor("operator", 10)
	first, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 0, ExternalID: "prb-ui-1", Title: "oom loop", SymptomKey: "oom", Source: "ui", EventID: "manual-1", CreatorUserID: operator.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 0, ExternalID: "prb-ui-2", Title: "another oom", SymptomKey: "oom", Source: "ui", EventID: "manual-2", CreatorUserID: operator.UserID,
	}); !errors.Is(err, errEpisodeInvalid) {
		t.Fatalf("missing reason = %v", err)
	}
	if found, _ := findSREProblem(10, 0, "prb-ui-2"); found.ID != 0 {
		t.Fatalf("separate write = %+v", found)
	}
	separate, err := upsertSREProblem(operator, problemInput{
		ProjectID: 10, Environment: "dev", ConnectionID: 0, ExternalID: "prb-ui-2", Title: "another oom", SymptomKey: "oom", Source: "ui", EventID: "manual-2", CreatorUserID: operator.UserID, SeparateReason: "different digest",
	})
	if err != nil || separate.ID == first.ID || separate.SeparateReason != "different digest" {
		t.Fatalf("separate = %+v %v", separate, err)
	}
	if _, err := publishKnownError(operator, first.ID, "oom", ""); !errors.Is(err, errEpisodeInvalid) {
		t.Fatalf("missing workaround = %v", err)
	}
	known, err := publishKnownError(operator, first.ID, "container memory limit", "raise the limit")
	if err != nil || known.Status != "known_error" || known.Verified {
		t.Fatalf("known = %+v %v", known, err)
	}
	if _, err := verifyProblemFix(operator, first.ID, ""); !errors.Is(err, errEpisodeInvalid) {
		t.Fatalf("missing fix = %v", err)
	}
	closed, err := verifyProblemFix(operator, first.ID, "deployed digest sha256:abc")
	if err != nil || closed.Status != "closed" || !closed.Verified || closed.FixEvidence == "" {
		t.Fatalf("verified = %+v %v", closed, err)
	}
}
