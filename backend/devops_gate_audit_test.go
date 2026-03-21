package main

import (
	"testing"
	"time"
)

func TestNormalizeDeploymentGateApprovalStateFilter(t *testing.T) {
	if got := normalizeDeploymentGateApprovalStateFilter(" Active "); got != "active" {
		t.Fatalf("normalizeDeploymentGateApprovalStateFilter() = %q, want %q", got, "active")
	}
	if got := normalizeDeploymentGateApprovalStateFilter("revoked"); got != "revoked" {
		t.Fatalf("normalizeDeploymentGateApprovalStateFilter() = %q, want %q", got, "revoked")
	}
	if got := normalizeDeploymentGateApprovalStateFilter("blocked"); got != "" {
		t.Fatalf("normalizeDeploymentGateApprovalStateFilter() = %q, want empty string for unsupported state", got)
	}
}

func TestDeriveDeploymentGateApprovalState(t *testing.T) {
	now := time.Date(2026, time.March, 19, 10, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-1 * time.Hour)
	futureExpiry := now.Add(2 * time.Hour)
	revokedAt := now.Add(-30 * time.Minute)

	if got := deriveDeploymentGateApprovalState(nil, nil, now); got != "active" {
		t.Fatalf("deriveDeploymentGateApprovalState(nil, nil) = %q, want %q", got, "active")
	}
	if got := deriveDeploymentGateApprovalState(&expiredAt, nil, now); got != "expired" {
		t.Fatalf("deriveDeploymentGateApprovalState(expired, nil) = %q, want %q", got, "expired")
	}
	if got := deriveDeploymentGateApprovalState(&futureExpiry, &revokedAt, now); got != "revoked" {
		t.Fatalf("deriveDeploymentGateApprovalState(future, revoked) = %q, want %q", got, "revoked")
	}
}
