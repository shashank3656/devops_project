package main

import (
	"strings"
	"testing"
	"time"
)

func TestServiceTimelineLabelsCorrelationNotCause(t *testing.T) {
	now := time.Date(2026, 10, 28, 4, 0, 0, 0, time.UTC)
	service := serviceMapEntry{ID: 3, Service: "checkout", Environment: "prod"}
	changes := []changeRequestRecord{{
		ID: 11, ChangeNumber: "CHG0000011", Title: "Ship checkout", PRNumber: 88, Status: "monitoring",
		SHA: "abc1234", Environment: "prod", CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-5 * time.Minute),
	}}
	incidents := []requestIncident{{
		ID: 4, IncidentNumber: "INC4", Summary: "Error spike", Service: "checkout", Environment: "prod",
		SuspectedChangeNumber: "CHG0000011", CreatedAt: now.Add(-4 * time.Minute),
	}}
	timeline := buildServiceActivityTimeline(service, changes, incidents, nil, nil)
	if len(timeline.Events) == 0 {
		t.Fatal("expected timeline events")
	}
	found := false
	for _, event := range timeline.Events {
		if event.Kind != "incident" {
			continue
		}
		if !strings.Contains(event.Detail, "not a confirmed cause") {
			t.Fatalf("suspected change must stay unconfirmed: %s", event.Detail)
		}
		if !strings.Contains(event.CorrelationNote, "correlation, not a proven cause") {
			t.Fatalf("nearby timestamps must be correlation: %#v", event)
		}
		found = true
	}
	if !found {
		t.Fatalf("missing incident event: %#v", timeline.Events)
	}
}

func TestServiceTimelineIgnoresDistantEvents(t *testing.T) {
	now := time.Date(2026, 10, 28, 4, 0, 0, 0, time.UTC)
	service := serviceMapEntry{ID: 3, Service: "checkout"}
	changes := []changeRequestRecord{{
		ID: 11, ChangeNumber: "CHG1", PRNumber: 2, Status: "resolved", SHA: "abc",
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-47 * time.Hour),
	}}
	incidents := []requestIncident{{
		ID: 4, IncidentNumber: "INC4", CreatedAt: now,
	}}
	timeline := buildServiceActivityTimeline(service, changes, incidents, nil, nil)
	for _, event := range timeline.Events {
		if event.CorrelationNote != "" {
			t.Fatalf("distant events should not correlate: %#v", event)
		}
	}
}
