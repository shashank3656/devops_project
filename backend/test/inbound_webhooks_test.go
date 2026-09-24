package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
)

func TestInboundWebhookAuthRequiresSecret(t *testing.T) {
	prevChange := ChangeWebhookSecret
	prevCI := CIWebhookSecret
	prevAlert := AlertWebhookSecret
	ChangeWebhookSecret = "change-secret"
	CIWebhookSecret = ""
	AlertWebhookSecret = ""
	t.Cleanup(func() {
		ChangeWebhookSecret = prevChange
		CIWebhookSecret = prevCI
		AlertWebhookSecret = prevAlert
	})

	if inboundWebhookAuthorized(inboundKindChange, http.Header{}, []byte(`{}`)) {
		t.Fatal("unsigned webhook must be 401")
	}
	headers := http.Header{}
	headers.Set("X-CI-Secret", "wrong")
	if inboundWebhookAuthorized(inboundKindChange, headers, []byte(`{}`)) {
		t.Fatal("wrong secret must fail")
	}
	headers.Set("X-CI-Secret", "change-secret")
	if !inboundWebhookAuthorized(inboundKindChange, headers, []byte(`{}`)) {
		t.Fatal("matching X-CI-Secret should pass")
	}
}

func TestInboundWebhookHMAC(t *testing.T) {
	prev := ChangeWebhookSecret
	ChangeWebhookSecret = "hmac-secret"
	t.Cleanup(func() { ChangeWebhookSecret = prev })
	body := []byte(`{"repo":"acme/api","sha":"abc"}`)
	mac := hmac.New(sha256.New, []byte("hmac-secret"))
	_, _ = mac.Write(body)
	headers := http.Header{}
	headers.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	if !inboundWebhookAuthorized(inboundKindChange, headers, body) {
		t.Fatal("valid HMAC should pass")
	}
}

func TestChangeIdempotencyKey(t *testing.T) {
	left := changeIdempotencyKey("Acme/API", "ABC123", "")
	right := changeIdempotencyKey("acme/api", "abc123", "unspecified")
	if left != right {
		t.Fatalf("keys should match: %q vs %q", left, right)
	}
}

func TestParseChangeWebhookJSON(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"project_code":"PAY",
		"service":"payments-api",
		"environment":"prod",
		"repo":"acme/payments-api",
		"pr_number":1842,
		"sha":"a1b2c3d",
		"title":"Reduce checkout timeout",
		"files":["cmd/api/main.go", ""]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Repo != "acme/payments-api" || payload.SHA != "a1b2c3d" || payload.PRNumber != 1842 {
		t.Fatalf("parsed change = %+v", payload)
	}
	if payload.Environment != "prod" || payload.WatchMinutes != 120 || payload.ChangeType != "standard" {
		t.Fatalf("defaults = %+v", payload)
	}
	if len(payload.Files) != 1 || payload.Files[0] != "cmd/api/main.go" {
		t.Fatalf("files = %#v", payload.Files)
	}
}

func TestParseGrafanaAlertWebhook(t *testing.T) {
	events, err := parseAlertWebhookJSON([]byte(`{
		"receiver":"setuops",
		"status":"firing",
		"alerts":[{
			"status":"firing",
			"fingerprint":"pay-5xx",
			"generatorURL":"https://grafana.example/d/pay",
			"labels":{"alertname":"payments 5xx","severity":"critical","service":"payments-api","env":"prod"},
			"annotations":{"summary":"payments-api 5xx > 2%","description":"error ratio 4.1%"}
		}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("event count = %d", len(events))
	}
	event := events[0]
	if event.Source != "grafana" || event.Fingerprint != "pay-5xx" || event.Severity != "critical" {
		t.Fatalf("grafana event = %+v", event)
	}
	if event.Service != "payments-api" || event.Environment != "prod" {
		t.Fatalf("labels = %+v", event)
	}
}

func TestParseGenericLogAlertWebhook(t *testing.T) {
	events, err := parseAlertWebhookJSON([]byte(`{
		"source":"loki",
		"fingerprint":"payments-api/5xx/prod",
		"severity":"high",
		"title":"payments-api 5xx > 2%",
		"message":"error ratio 4.1%",
		"labels":{"service":"payments-api","env":"prod"}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Source != "loki" || events[0].Fingerprint != "payments-api/5xx/prod" {
		t.Fatalf("generic event = %+v", events)
	}
}

func TestAlertFingerprintFallback(t *testing.T) {
	got := alertFingerprint("loki", "", "Payments 5xx", "payments-api", "prod")
	if got != "loki/payments 5xx/payments-api/prod" {
		t.Fatalf("fingerprint = %q", got)
	}
}

func TestShouldNotAutoResolveSEV1(t *testing.T) {
	if shouldAutoResolveAlert("critical", "resolved") {
		t.Fatal("SEV1 resolve must not auto-close")
	}
	if shouldAutoResolveAlert("sev1", "ok") {
		t.Fatal("sev1 alias must not auto-close")
	}
	if !shouldAutoResolveAlert("high", "resolved") {
		t.Fatal("non-SEV1 resolve may move to monitoring")
	}
	if shouldAutoResolveAlert("high", "firing") {
		t.Fatal("firing must not resolve")
	}
}

func TestChangeStatusRankForwardOnly(t *testing.T) {
	if changeStatusRank("implemented") <= changeStatusRank("implementing") {
		t.Fatal("implemented should rank above implementing")
	}
}

func TestGrafanaPayloadRoundTripJSON(t *testing.T) {
	raw := json.RawMessage(`{"alerts":[{"labels":{"alertname":"x"},"status":"firing"}]}`)
	events, err := parseAlertWebhookJSON(raw)
	if err != nil || len(events) != 1 || events[0].Title != "x" {
		t.Fatalf("got %+v err=%v", events, err)
	}
}
