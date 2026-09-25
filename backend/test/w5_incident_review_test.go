package main

import (
	"strings"
	"testing"
)

func TestBuildIncidentReviewFromTimeline(t *testing.T) {
	review := buildIncidentReview(requestIncident{
		ID:             3,
		IncidentNumber: "INC0000003",
		Summary:        "checkout 5xx",
		Status:         "open",
		Source:         "change_regression",
		Service:        "checkout",
		Environment:    "prod",
		OwnerUsername:  "sre",
		Notes:          "p95 spiked",
	})
	if !review.Generated || !strings.Contains(review.ImpactSummary, "INC0000003") {
		t.Fatalf("%+v", review)
	}
	if !strings.Contains(review.ImpactSummary, "checkout 5xx") {
		t.Fatalf("%s", review.ImpactSummary)
	}
	if review.AcknowledgedBy != "sre" {
		t.Fatalf("%s", review.AcknowledgedBy)
	}
	if !strings.Contains(review.MitigationSummary, "sre") {
		t.Fatalf("%s", review.MitigationSummary)
	}
	if !strings.Contains(review.RootCause, "No linked Change Request") {
		t.Fatalf("%s", review.RootCause)
	}
}
