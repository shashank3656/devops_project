package main

import (
	"testing"
	"time"
)

func TestNormalizeExpiryTrackerWorkflowState(t *testing.T) {
	testCases := []struct {
		input string
		want  string
	}{
		{input: "", want: "open"},
		{input: " acked ", want: "acknowledged"},
		{input: "in-progress", want: "in_progress"},
		{input: "completed", want: "rotated"},
		{input: "mystery", want: ""},
	}

	for _, testCase := range testCases {
		if got := normalizeExpiryTrackerWorkflowState(testCase.input); got != testCase.want {
			t.Fatalf("normalizeExpiryTrackerWorkflowState(%q) = %q, want %q", testCase.input, got, testCase.want)
		}
	}
}

func TestBuildExpiryTrackerItemKeyIncludesCanonicalDimensions(t *testing.T) {
	projectID := 42
	item := expiryTrackerItem{
		Category:     "Secret",
		Source:       "K8s Connection",
		ProjectID:    &projectID,
		ProjectCode:  "Payments",
		Cloud:        "AWS",
		Environment:  "prod",
		ClusterName:  "prod-cluster",
		Namespace:    "payments",
		ResourceName: "tls-cert",
		ResourceType: "certificate",
	}

	got := buildExpiryTrackerItemKey(item)
	want := "secret|k8s_connection|42|payments|aws|prod|prod_cluster|payments|tls_cert|certificate"
	if got != want {
		t.Fatalf("buildExpiryTrackerItemKey() = %q, want %q", got, want)
	}
}

func TestApplyExpiryTrackerActionsUpdatesItemsAndSummary(t *testing.T) {
	now := time.Date(2026, time.March, 19, 10, 0, 0, 0, time.UTC)
	payload := &expiryTrackerPayload{
		Summary: expiryTrackerSummary{
			TotalItems: 3,
		},
		Items: []expiryTrackerItem{
			{ItemKey: "expired-item", Status: "expired"},
			{ItemKey: "thirty-day-item", Status: "expiring_30d"},
			{ItemKey: "healthy-item", Status: "healthy"},
		},
	}

	actions := map[string]expiryTrackerActionRecord{
		"expired-item": {
			ItemKey:           "expired-item",
			WorkflowState:     "acknowledged",
			Note:              "Owner notified",
			UpdatedByUsername: "ops-lead",
			UpdatedAt:         now,
		},
		"thirty-day-item": {
			ItemKey:           "thirty-day-item",
			WorkflowState:     "rotated",
			Note:              "Rotated on-call",
			UpdatedByUsername: "ops-bot",
			UpdatedAt:         now.Add(15 * time.Minute),
		},
	}

	applyExpiryTrackerActions(payload, actions)

	if payload.Items[0].WorkflowState != "acknowledged" {
		t.Fatalf("expected first item to be acknowledged, got %q", payload.Items[0].WorkflowState)
	}
	if payload.Items[0].WorkflowUpdatedAt == nil {
		t.Fatalf("expected first item updated time to be set")
	}
	if payload.Items[1].WorkflowState != "rotated" {
		t.Fatalf("expected second item to be rotated, got %q", payload.Items[1].WorkflowState)
	}
	if payload.Items[2].WorkflowState != "open" {
		t.Fatalf("expected third item to default to open, got %q", payload.Items[2].WorkflowState)
	}

	if payload.Summary.ActionableCount != 1 {
		t.Fatalf("expected actionable count to ignore rotated/healthy items, got %d", payload.Summary.ActionableCount)
	}
	if payload.Summary.AcknowledgedCount != 1 {
		t.Fatalf("expected acknowledged count to be 1, got %d", payload.Summary.AcknowledgedCount)
	}
	if payload.Summary.InProgressCount != 0 {
		t.Fatalf("expected in-progress count to be 0, got %d", payload.Summary.InProgressCount)
	}
	if payload.Summary.RotatedCount != 1 {
		t.Fatalf("expected rotated count to be 1, got %d", payload.Summary.RotatedCount)
	}
}
