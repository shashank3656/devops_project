package main

import (
	"encoding/json"
	"testing"
)

func TestParseCheckovReport(t *testing.T) {
	raw := json.RawMessage(`{
		"check_type": "terraform",
		"results": {
			"passed_checks": [{"check_id": "CKV_AWS_1"}, {"check_id": "CKV_AWS_2"}],
			"failed_checks": [
				{"check_id": "CKV_AWS_20", "check_name": "S3 bucket is public", "resource": "aws_s3_bucket.logs", "file_path": "/main.tf", "severity": "HIGH"},
				{"check_id": "CKV_AWS_18", "check_name": "S3 access logging", "resource": "aws_s3_bucket.logs", "file_path": "/main.tf", "severity": null}
			]
		},
		"summary": {"passed": 2, "failed": 2}
	}`)
	result, err := parsePolicyReport(policyReportInput{Tool: "checkov", Report: raw})
	if err != nil {
		t.Fatal(err)
	}
	if result.Passed != 2 || result.Failed != 2 || result.Blocking != 1 {
		t.Fatalf("got passed=%d failed=%d blocking=%d", result.Passed, result.Failed, result.Blocking)
	}
	if result.Findings[0].Severity != "high" || result.Findings[1].Severity != "unknown" {
		t.Fatalf("findings not sorted by severity: %+v", result.Findings)
	}
}

func TestParseTfsecReportWithNoResults(t *testing.T) {
	result, err := parsePolicyReport(policyReportInput{Tool: "tfsec", Report: json.RawMessage(`{"results": null}`)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Failed != 0 || result.Findings == nil {
		t.Fatalf("expected empty, non-nil findings: %+v", result)
	}
}

func TestParseConftestReport(t *testing.T) {
	raw := json.RawMessage(`[{"filename": "plan.json", "namespace": "main", "successes": 5,
		"failures": [{"msg": "prod buckets must be encrypted", "metadata": {"query": "data.main.deny"}}],
		"warnings": [{"msg": "missing cost-center tag"}]}]`)
	result, err := parsePolicyReport(policyReportInput{Tool: "conftest", Report: raw})
	if err != nil {
		t.Fatal(err)
	}
	if result.Tool != "opa" || result.Passed != 5 || result.Failed != 2 || result.Blocking != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Findings[0].Rule != "data.main.deny" {
		t.Fatalf("rule = %q, want data.main.deny", result.Findings[0].Rule)
	}
}

func TestPolicyStatusFor(t *testing.T) {
	if state, _ := policyStatusFor(policyCheckSummary{State: "fail", Blocking: 2}); state != "failure" {
		t.Fatalf("fail state = %s", state)
	}
	if state, _ := policyStatusFor(policyCheckSummary{State: "none"}); state != "" {
		t.Fatalf("none should not publish, got %s", state)
	}
}
