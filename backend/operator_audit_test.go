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
