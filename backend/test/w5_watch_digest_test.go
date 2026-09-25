package main

import "testing"

func TestWatchEndedDigestPayload(t *testing.T) {
	payload := watchEndedDigestPayload(changeRequestRecord{
		ID:           9,
		ChangeNumber: "CHG0000009",
		SHA:          "abc",
		PreviousSHA:  "def",
		CostDeltaUSD: 4.2,
		Status:       "resolved",
		Service:      "checkout",
		Environment:  "prod",
		Repo:         "acme/api",
	})
	if payload["sha"] != "abc" || payload["previous_sha"] != "def" {
		t.Fatalf("%v", payload)
	}
	if payload["cost_delta_usd"] != 4.2 {
		t.Fatalf("%v", payload["cost_delta_usd"])
	}
	if payload["watch_result"] != "clean" {
		t.Fatalf("%v", payload["watch_result"])
	}
	if payload["change_number"] != "CHG0000009" {
		t.Fatalf("%v", payload["change_number"])
	}
}
