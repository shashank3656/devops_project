package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCreateInboundSourceRequiresSecret(t *testing.T) {
	_, err := createInboundWebhookSource("change", "checkout-ci", "  ", nil)
	if err == nil || !strings.Contains(err.Error(), "X-CI-Secret") {
		t.Fatalf("empty secret error = %v", err)
	}
}

func TestInboundSourceJSONOmitsSecret(t *testing.T) {
	raw, err := json.Marshal(inboundWebhookSource{ID: 1, Kind: "change", Name: "checkout-ci", HasSecret: true, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"secret"`) {
		t.Fatalf("secret leaked in json: %s", raw)
	}
}
