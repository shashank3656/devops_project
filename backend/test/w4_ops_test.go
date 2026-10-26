package main

import (
	"strings"
	"testing"
)

func TestQueryAsksToApply(t *testing.T) {
	if !queryAsksToApply("please terraform apply this") {
		t.Fatal("apply")
	}
	if queryAsksToApply("what rollback SHA should we use?") {
		t.Fatal("question should not count as apply")
	}
}

func TestBuildGroundedAnswerRequiresCitations(t *testing.T) {
	empty := buildGroundedAnswer("why is checkout down?", nil)
	if !strings.Contains(empty.Reply, "Change, Incident, runbook") || !strings.Contains(empty.Reply, "CALC-COST") {
		t.Fatalf("%s", empty.Reply)
	}
	apply := buildGroundedAnswer("terraform apply prod now", []groundedSource{{Kind: "change", ID: 1, Number: "CHG1", Title: "ship"}})
	if !strings.Contains(strings.ToLower(apply.Reply), "will not apply") {
		t.Fatalf("%s", apply.Reply)
	}
	answered := buildGroundedAnswer("rollback checkout", []groundedSource{{
		Kind:        "change",
		ID:          12,
		Number:      "CHG0000012",
		Title:       "checkout latency",
		PreviousSHA: "abc123",
		Body:        "failed watch",
	}})
	if len(answered.Citations) != 1 || answered.Citations[0].Number != "CHG0000012" {
		t.Fatalf("%+v", answered.Citations)
	}
	if answered.Rollback == nil || answered.Rollback.PreviousSHA != "abc123" {
		t.Fatalf("%+v", answered.Rollback)
	}
	if !strings.Contains(answered.Reply, "CHG0000012") {
		t.Fatalf("%s", answered.Reply)
	}
}

func TestPlanChangeSHARollbackNeedsPrevious(t *testing.T) {
	plan := &changeRollbackPlan{PreviousSHA: ""}
	if plan.Allowed {
		t.Fatal("empty sha must not be allowed")
	}
	if queryAsksToApply("kubectl apply -f manifest.yaml") != true {
		t.Fatal("kubectl apply")
	}
	attachChangeRollbackPlan(nil)
}

func TestReplyCitesCatalog(t *testing.T) {
	if !replyCitesCatalog("See CHG0000012 for the SHA", []groundedCitation{{Number: "CHG0000012"}}) {
		t.Fatal("should cite")
	}
	if replyCitesCatalog("no ids here", []groundedCitation{{Number: "CHG1"}}) {
		t.Fatal("should not cite")
	}
}
