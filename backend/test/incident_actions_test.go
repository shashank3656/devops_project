package main

import "testing"

func TestImprovementEvidenceRejectsSecretsAndAllowsRecordRefs(t *testing.T) {
	if improvementEvidenceAllowed("") || improvementEvidenceAllowed("password=hidden") {
		t.Fatal("empty or secret evidence must be rejected")
	}
	if !improvementEvidenceAllowed("/changes/12") || !improvementEvidenceAllowed("CHG0000012 watch samples") {
		t.Fatal("record evidence must be allowed")
	}
}

func TestApplyImprovementStatusKeepsImplementedAndVerifiedSeparate(t *testing.T) {
	open := incidentImprovementAction{Status: "open"}
	if _, err := applyImprovementStatus(open, "verified", "/changes/1"); err != errImprovementInvalid {
		t.Fatal("open actions cannot skip to verified")
	}
	implemented, err := applyImprovementStatus(open, "implemented", "")
	if err != nil || implemented.Status != "implemented" || implemented.ImplementedAt == nil || implemented.VerifiedAt != nil {
		t.Fatalf("implemented = %#v err %v", implemented, err)
	}
	if _, err := applyImprovementStatus(implemented, "verified", ""); err != errImprovementInvalid {
		t.Fatal("verified needs evidence")
	}
	verified, err := applyImprovementStatus(implemented, "verified", "/slos?q=checkout")
	if err != nil || verified.Status != "verified" || verified.VerifiedAt == nil {
		t.Fatalf("verified = %#v err %v", verified, err)
	}
	if _, err := applyImprovementStatus(verified, "implemented", ""); err != errImprovementInvalid {
		t.Fatal("verified cannot be downgraded to implemented")
	}
}
