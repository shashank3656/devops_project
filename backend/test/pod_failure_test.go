package main

import (
	"errors"
	"testing"
	"time"
)

const (
	failureDigest = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	failurePod    = "11111111-1111-1111-1111-111111111111"
	failureEventA = "22222222-2222-2222-2222-222222222222"
	failureEventB = "33333333-3333-3333-3333-333333333333"
	failureRecent = "2026-10-13T00:00:00Z"
	failureOld    = "2026-09-01T00:00:00Z"
	failureStart  = "2026-10-13T00:00:00Z"
)

func failureActor(role string, projectID int, environments []string) authzSubject {
	userID := 4
	if role == "viewer" {
		userID = 5
	}
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: projectID, Role: role, Environments: environments}},
	}
}

func installFailureMemory() {
	failures := map[int]podFailure{}
	events := map[int]podFailureEvent{}
	gaps := map[int]podFailureGap{}
	retention := map[string]int{}
	nextFailure, nextEvent, nextGap := 1, 1, 1
	failureClock = func() time.Time { return time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC) }
	savePodFailure = func(item podFailure) (podFailure, error) {
		item.ID = nextFailure
		nextFailure++
		item.PodPresent = false
		failures[item.ID] = item
		return item, nil
	}
	findPodFailure = func(projectID int, namespace, podUID string) (podFailure, error) {
		for _, item := range failures {
			if item.ProjectID == projectID && item.Namespace == namespace && item.PodUID == podUID {
				return item, nil
			}
		}
		return podFailure{}, nil
	}
	loadPodFailure = func(id int) (podFailure, error) {
		item, ok := failures[id]
		if !ok {
			return podFailure{}, errFailureHidden
		}
		return item, nil
	}
	updatePodFailureLogs = func(item podFailure) (podFailure, error) {
		current, ok := failures[item.ID]
		if !ok {
			return podFailure{}, errFailureHidden
		}
		current.LogState = item.LogState
		current.LogLink = item.LogLink
		current.PodPresent = false
		failures[item.ID] = current
		return current, nil
	}
	listPodFailures = func(projectID int, namespace string) ([]podFailure, error) {
		list := []podFailure{}
		for id := 1; id < nextFailure; id++ {
			item, ok := failures[id]
			if ok && item.ProjectID == projectID && item.Namespace == namespace {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveFailureEvent = func(item podFailureEvent) (podFailureEvent, error) {
		item.ID = nextEvent
		nextEvent++
		events[item.ID] = item
		return item, nil
	}
	findFailureEvent = func(failureID int, eventUID string) (podFailureEvent, error) {
		for _, item := range events {
			if item.FailureID == failureID && item.EventUID == eventUID {
				return item, nil
			}
		}
		return podFailureEvent{}, nil
	}
	listFailureEvents = func(failureID int) ([]podFailureEvent, error) {
		list := []podFailureEvent{}
		for id := 1; id < nextEvent; id++ {
			item, ok := events[id]
			if ok && item.FailureID == failureID {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveFailureGap = func(item podFailureGap) (podFailureGap, error) {
		item.ID = nextGap
		nextGap++
		gaps[item.ID] = item
		return item, nil
	}
	findFailureGap = func(failureID int, reason string) (podFailureGap, error) {
		for _, item := range gaps {
			if item.FailureID == failureID && item.Reason == reason {
				return item, nil
			}
		}
		return podFailureGap{}, nil
	}
	listFailureGaps = func(failureID int) ([]podFailureGap, error) {
		list := []podFailureGap{}
		for id := 1; id < nextGap; id++ {
			item, ok := gaps[id]
			if ok && item.FailureID == failureID {
				list = append(list, item)
			}
		}
		return list, nil
	}
	saveFailureRetention = func(projectID int, namespace string, days int) error {
		retention[namespaceKey(projectID, namespace)] = days
		return nil
	}
	loadFailureRetention = func(projectID int, namespace string) (int, error) {
		return retention[namespaceKey(projectID, namespace)], nil
	}
	saveFailureAudit = func(failureAuditRecord) error { return nil }
}

func namespaceKey(projectID int, namespace string) string {
	return string(rune(projectID)) + ":" + namespace
}

func failureInput(namespace, finished string) podFailureInput {
	return podFailureInput{
		ProjectID: 10, Namespace: namespace, PodUID: failurePod, ExitReason: "OOMKilled",
		StartedAt: failureStart, FinishedAt: finished, Workload: "api", Revision: "rev-1", ImageDigest: failureDigest,
	}
}

func TestDeletedPodRemainsInvestigable(t *testing.T) {
	installFailureMemory()
	operator := failureActor("operator", 10, []string{"payments"})
	saved, err := recordPodFailure(operator, failureInput("payments", failureRecent))
	if err != nil || saved.PodPresent || saved.WriteRequested || saved.ExitReason != "OOMKilled" || saved.Workload != "api" || saved.Revision != "rev-1" || saved.ImageDigest != failureDigest {
		t.Fatalf("record = %+v %v", saved, err)
	}
	changed := failureInput("payments", failureRecent)
	changed.ExitReason = "Error"
	again, err := recordPodFailure(operator, changed)
	if err != nil || again.ID != saved.ID || again.ExitReason != "OOMKilled" {
		t.Fatalf("retry = %+v %v", again, err)
	}
	read, err := readPodFailure(operator, 10, "payments", failurePod)
	if err != nil || read.PodPresent || read.ID != saved.ID || read.StartedAt != failureStart || read.FinishedAt != failureRecent {
		t.Fatalf("read = %+v %v", read, err)
	}
	if _, err := recordPodFailure(operator, podFailureInput{ProjectID: 10, Namespace: "payments", Mutate: true}); !errors.Is(err, errFailureInvalid) {
		t.Fatalf("mutate = %v", err)
	}
	if _, err := recordPodFailure(failureActor("viewer", 10, []string{"payments"}), failureInput("payments", failureRecent)); !errors.Is(err, errFailureDenied) {
		t.Fatalf("viewer = %v", err)
	}
}

func TestMissingLogsAreLabeled(t *testing.T) {
	installFailureMemory()
	operator := failureActor("operator", 10, []string{"payments"})
	saved, err := recordPodFailure(operator, failureInput("payments", failureRecent))
	if err != nil {
		t.Fatal(err)
	}
	labeled, err := recordFailureLogs(operator, saved.ID, "")
	if err != nil || labeled.LogState != "missing" || labeled.LogLink != "" || len(labeled.Gaps) != 1 || labeled.Gaps[0].Reason != "logs are missing" {
		t.Fatalf("missing = %+v %v", labeled, err)
	}
	again, err := recordFailureLogs(operator, saved.ID, "")
	if err != nil || len(again.Gaps) != 1 || again.Gaps[0].ID != labeled.Gaps[0].ID {
		t.Fatalf("gap retry = %+v %v", again, err)
	}
	event, err := recordFailureEvent(operator, saved.ID, failureEventA, "BackOff", failureRecent)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := recordFailureEvent(operator, saved.ID, failureEventA, "BackOff", failureRecent)
	if err != nil || duplicate.ID != event.ID {
		t.Fatalf("event retry = %+v %v", duplicate, err)
	}
	if _, err := recordFailureEvent(operator, saved.ID, failureEventB, "Unhealthy", failureRecent); err != nil {
		t.Fatal(err)
	}
	read, err := readPodFailure(operator, 10, "payments", failurePod)
	if err != nil || read.LogState != "missing" || len(read.Events) != 2 {
		t.Fatalf("read = %+v %v", read, err)
	}
	linked, err := recordFailureLogs(operator, saved.ID, "logs/probe-f20")
	if err != nil || linked.LogState != "linked" || linked.LogLink != "logs/probe-f20" {
		t.Fatalf("link = %+v %v", linked, err)
	}
}

func TestUnrelatedNamespacesAreInaccessible(t *testing.T) {
	installFailureMemory()
	operator := failureActor("operator", 10, []string{"payments"})
	if _, err := recordPodFailure(operator, failureInput("kube-system", failureRecent)); !errors.Is(err, errFailureHidden) {
		t.Fatalf("other namespace = %v", err)
	}
	if found, _ := findPodFailure(10, "kube-system", failurePod); found.ID != 0 {
		t.Fatalf("other namespace wrote %+v", found)
	}
	if _, err := recordPodFailure(operator, failureInput("*", failureRecent)); !errors.Is(err, errFailureInvalid) {
		t.Fatalf("wildcard = %v", err)
	}
	if _, err := recordPodFailure(failureActor("operator", 11, []string{"payments"}), failureInput("payments", failureRecent)); !errors.Is(err, errFailureHidden) {
		t.Fatalf("other project = %v", err)
	}
	saved, err := recordPodFailure(operator, failureInput("payments", failureRecent))
	if err != nil {
		t.Fatal(err)
	}
	old := failureInput("payments", failureOld)
	old.PodUID = "44444444-4444-4444-4444-444444444444"
	if _, err := recordPodFailure(operator, old); err != nil {
		t.Fatal(err)
	}
	gap, err := recordFailureGap(operator, saved.ID, "events unavailable")
	if err != nil || gap.Reason != "events unavailable" {
		t.Fatalf("gap = %+v %v", gap, err)
	}
	same, err := recordFailureGap(operator, saved.ID, "events unavailable")
	if err != nil || same.ID != gap.ID {
		t.Fatalf("gap retry = %+v %v", same, err)
	}
	if _, err := setFailureRetention(operator, 10, "payments", 0); !errors.Is(err, errFailureInvalid) {
		t.Fatalf("zero retention = %v", err)
	}
	if _, err := setFailureRetention(operator, 10, "kube-system", 7); !errors.Is(err, errFailureHidden) {
		t.Fatalf("other retention = %v", err)
	}
	if _, err := setFailureRetention(operator, 10, "payments", 7); err != nil {
		t.Fatal(err)
	}
	history, err := failureHistory(operator, 10, "payments")
	if err != nil || len(history) != 1 || history[0].PodUID != failurePod || history[0].Retention != "active" {
		t.Fatalf("history = %+v %v", history, err)
	}
	expired, err := readPodFailure(operator, 10, "payments", "44444444-4444-4444-4444-444444444444")
	if err != nil || expired.Retention != "expired" || expired.ExitReason != "OOMKilled" || expired.PodPresent {
		t.Fatalf("expired = %+v %v", expired, err)
	}
	if _, err := failureHistory(operator, 10, "kube-system"); !errors.Is(err, errFailureHidden) {
		t.Fatalf("other history = %v", err)
	}
	if _, err := failureHistory(failureActor("viewer", 10, []string{"payments"}), 10, "payments"); err != nil {
		t.Fatalf("viewer history = %v", err)
	}
}
