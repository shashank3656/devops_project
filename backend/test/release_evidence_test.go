package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestCaptureReleaseEvidenceRecordsDecisionFields(t *testing.T) {
	approved := time.Date(2026, 10, 30, 8, 0, 0, 0, time.UTC)
	item := changeRequestRecord{
		ID:                    12,
		ChangeNumber:          "CHG0000012",
		SHA:                   "abcdef1234567890",
		Service:               "checkout",
		Environment:           "prod",
		CABStatus:             "approved",
		CABApprovedAt:         &approved,
		CABApprovedByUsername: "cab.reviewer",
		AssigneeUsername:      "change.owner",
		PolicyStatus:          "pass",
		BackoutPlan:           "Revert to previous_sha",
		PipelineURL:           "https://ci.example/jobs/12",
	}
	snap := captureReleaseEvidence(item)
	if snap.SHA != item.SHA {
		t.Fatalf("sha = %q", snap.SHA)
	}
	if snap.CapturedAt != approved.Format(time.RFC3339) {
		t.Fatalf("captured_at = %q", snap.CapturedAt)
	}
	if !strings.Contains(snap.Approvals, "cab.reviewer") {
		t.Fatalf("approvals = %q", snap.Approvals)
	}
	if snap.Checks == "" || snap.Security == "" || snap.Window == "" || snap.Rollback == "" {
		t.Fatalf("snapshot missing fields: %#v", snap)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(raw))
	for _, banned := range []string{"password", "secret", "token", "hmac", "jwt"} {
		if strings.Contains(lower, banned) {
			t.Fatalf("snapshot JSON included %s: %s", banned, raw)
		}
	}
}

func TestApplyEvidenceInvalidationWhenCommitMoves(t *testing.T) {
	snap := releaseEvidenceSnapshot{SHA: "oldcommitsha0001"}
	applyEvidenceInvalidation(&snap, "newcommitsha0002")
	if !snap.Invalidated || !strings.Contains(snap.InvalidatedReason, "newer commit") {
		t.Fatalf("moved commit = %#v", snap)
	}
	applyEvidenceInvalidation(&snap, "oldcommitsha0001")
	if snap.Invalidated || snap.InvalidatedReason != "" {
		t.Fatalf("matching commit stayed invalidated: %#v", snap)
	}
}

func TestApplyEvidenceInvalidationUnknownSHAStaysValid(t *testing.T) {
	snap := releaseEvidenceSnapshot{SHA: "abcdef1234567890"}
	applyEvidenceInvalidation(&snap, "")
	if snap.Invalidated {
		t.Fatal("unknown current SHA must not invalidate captured evidence")
	}
}
