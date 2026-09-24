package main

import (
	"encoding/json"
	"testing"
)

func TestParseInfracostReportUsesDiff(t *testing.T) {
	raw := json.RawMessage(`{"version":"0.2","currency":"EUR","totalMonthlyCost":"412.50","pastTotalMonthlyCost":"300","diffTotalMonthlyCost":"112.5","projects":[]}`)
	report, err := parseInfracostReport(raw)
	if err != nil {
		t.Fatal(err)
	}
	if report.Currency != "EUR" || report.TotalMonthlyCost != 412.5 || report.DiffTotalMonthlyCost != 112.5 {
		t.Fatalf("unexpected report: %+v", report)
	}
}

func TestParseInfracostReportDerivesDiffFromPast(t *testing.T) {
	report, err := parseInfracostReport(json.RawMessage(`{"totalMonthlyCost":"50","pastTotalMonthlyCost":"20"}`))
	if err != nil {
		t.Fatal(err)
	}
	if report.DiffTotalMonthlyCost != 30 {
		t.Fatalf("diff = %v, want 30", report.DiffTotalMonthlyCost)
	}
}

func TestParseInfracostReportRequiresTotal(t *testing.T) {
	if _, err := parseInfracostReport(json.RawMessage(`{"totalMonthlyCost":null}`)); err == nil {
		t.Fatal("expected an error without totalMonthlyCost")
	}
}

func TestRequestInstanceHint(t *testing.T) {
	if got := requestInstanceHint(`{"instance_class":"db.t3.small"}`); got != "db.t3.small" {
		t.Fatalf("got %q", got)
	}
	if got := requestInstanceHint(`not json`); got != "" {
		t.Fatalf("got %q for invalid JSON", got)
	}
}
