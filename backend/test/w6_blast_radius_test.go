package main

import "testing"

func TestOneHopServiceDependents(t *testing.T) {
	anchor := serviceMapEntry{Service: "checkout", Repo: "acme/shop", Team: "payments", Environment: "prod"}
	hops := oneHopServiceDependents(anchor, []serviceMapEntry{
		anchor,
		{Service: "payments-api", Repo: "acme/shop", Environment: "prod"},
		{Service: "ledger", Repo: "acme/ledger", Team: "payments", Environment: "prod"},
		{Service: "docs", Repo: "acme/docs", Team: "docs", Environment: "dev"},
	})
	if len(hops) != 2 {
		t.Fatalf("%+v", hops)
	}
}

func TestFormatBlastRadius(t *testing.T) {
	labels := formatBlastRadius("checkout", []serviceMapEntry{{Service: "payments-api", Environment: "prod", Repo: "acme/shop"}})
	if len(labels) != 2 || labels[0] != "checkout" {
		t.Fatalf("%v", labels)
	}
}
