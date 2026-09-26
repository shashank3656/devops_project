package main

import (
	"strings"
	"testing"
)

func TestSanitizeOperatorAuditSummary(t *testing.T) {
	raw := "connected token=super-secret-value ok"
	got := sanitizeOperatorAuditSummary(raw)
	if strings.Contains(got, "super-secret") {
		t.Fatalf("expected secret redacted, got %q", got)
	}
}

func TestNormalizeOperatorAuditLimit(t *testing.T) {
	if got := normalizeOperatorAuditLimit(0); got != operatorAuditDefaultLimit {
		t.Fatalf("default limit = %d, want %d", got, operatorAuditDefaultLimit)
	}
	if got := normalizeOperatorAuditLimit(9999); got != operatorAuditMaxLimit {
		t.Fatalf("capped limit = %d, want %d", got, operatorAuditMaxLimit)
	}
}

func TestParsePromoteSourceRequestID(t *testing.T) {
	if got := parsePromoteSourceRequestID("devops:42->prod:gate-approved"); got != 42 {
		t.Fatalf("parsePromoteSourceRequestID = %d, want 42", got)
	}
}

func TestOperatorAuditActionTracked(t *testing.T) {
	if !operatorAuditActionTracked("request_approve") {
		t.Fatal("expected request_approve tracked")
	}
	if !operatorAuditActionTracked("k8s_workload_restart") {
		t.Fatal("expected k8s actions tracked")
	}
	if operatorAuditActionTracked("admin_break_glass") {
		t.Fatal("admin_break_glass should not mirror to operator log")
	}
}
