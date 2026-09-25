package main

import "testing"

func TestNormalizeChangeTypePreviewAndFlag(t *testing.T) {
	if normalizeChangeType("ephemeral") != "preview" {
		t.Fatal("preview")
	}
	if normalizeChangeType("feature_flag") != "flag" {
		t.Fatal("flag")
	}
}

func TestNormalizeRolloutStage(t *testing.T) {
	if rolloutPercentForStage("canary") != 1 {
		t.Fatal("canary")
	}
	if normalizeRolloutStage("50%") != "50" || rolloutPercentForStage("100") != 100 {
		t.Fatal("percent stages")
	}
	if _, err := setChangeRollout(0, "nope"); err == nil {
		t.Fatal("invalid stage must fail")
	}
}

func TestParseFlagWebhookLaunchDarkly(t *testing.T) {
	payload, err := parseFlagWebhook([]byte(`{"kind":"flag","data":{"key":"checkout-v2","project":"shop","environment":"prod","value":"on","member":{"email":"dev@example.com"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.ChangeType != "flag" || payload.FlagKey != "checkout-v2" || payload.Repo != "flags/shop" {
		t.Fatalf("%+v", payload)
	}
}

func TestParseOTLPSimplifiedAndResource(t *testing.T) {
	simple := parseOTLPMetrics([]byte(`{"service":"api","p95_ms":210,"error_ratio":0.02}`))
	if len(simple) != 1 || simple[0].Sample.P95Ms != 210 {
		t.Fatalf("simple %+v", simple)
	}
	otlp := parseOTLPMetrics([]byte(`{
		"resourceMetrics":[{
			"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},
			"scopeMetrics":[{"metrics":[{"name":"http.server.duration","histogram":{"dataPoints":[{"p95":180}]}}]}]
		}]
	}`))
	if len(otlp) != 1 || otlp[0].Service != "checkout" || otlp[0].Sample.P95Ms != 180 {
		t.Fatalf("otlp %+v", otlp)
	}
}

func TestPreviewURLTemplate(t *testing.T) {
	url := previewURLFor("acme/api", 12, "feat")
	if url == "" {
		t.Fatal("expected preview url")
	}
}

func TestMCPIncludesTickets(t *testing.T) {
	found := false
	for _, name := range mcpToolNames() {
		if name == "list_tickets" {
			found = true
		}
	}
	if !found {
		t.Fatal("list_tickets missing")
	}
}
