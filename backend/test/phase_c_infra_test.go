package main

import "testing"

func TestEvaluateProdRunbookGateNonProd(t *testing.T) {
	req := &PRRequest{Env: "dev", Service: "api"}
	gate := evaluateProdRunbookGate(req)
	if gate.Required {
		t.Fatal("dev requests should not require runbooks")
	}
}

func TestEvaluateProdRunbookGateProdNoProject(t *testing.T) {
	req := &PRRequest{Env: "prod", Service: "api"}
	gate := evaluateProdRunbookGate(req)
	if !gate.Required {
		t.Fatal("prod without project should require runbook gate")
	}
}

func TestEnvRankOrdersDevBeforeProd(t *testing.T) {
	if envRank("prod") <= envRank("dev") {
		t.Fatalf("prod rank %d should be after dev %d", envRank("prod"), envRank("dev"))
	}
}
