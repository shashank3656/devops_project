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

func TestWorkerCannotLeaveConnection(t *testing.T) {
	connection := workerConnection{ProjectID: 7, Bound: true}
	if id, err := workerProject(connection, 0); err != nil || id != 7 {
		t.Fatalf("empty target id=%d err=%v", id, err)
	}
	if id, err := workerProject(connection, 7); err != nil || id != 7 {
		t.Fatalf("same project id=%d err=%v", id, err)
	}
	if _, err := workerProject(connection, 9); err == nil {
		t.Fatal("a bound worker must not write another project")
	}
	if _, err := workerProject(workerConnection{}, 9); err == nil {
		t.Fatal("an unbound worker must not choose a project")
	}

	payload := parsedChangeWebhook{ProjectID: 9, ProjectCode: "other", Service: "api"}
	if err := bindChangeWorker(&payload, connection); err == nil {
		t.Fatal("cross-project change payload must be rejected before upsert")
	}
	payload.ProjectID = 0
	if err := bindChangeWorker(&payload, connection); err != nil {
		t.Fatalf("bind own project: %v", err)
	}
	resolved := resolveChangeProjectID(&payload)
	if resolved == nil || *resolved != 7 || payload.ProjectCode != "" {
		t.Fatalf("bound project = %v code=%q", resolved, payload.ProjectCode)
	}

	event := parsedAlertEvent{ProjectID: 9, ProjectCode: "other"}
	if err := bindAlertWorker(&event, connection); err == nil {
		t.Fatal("cross-project alert must be rejected before upsert")
	}

	other := 9
	if err := workerOwnsRecord(connection, &other); err == nil {
		t.Fatal("watch and IRM updates must stay on the connection project")
	}
	if err := workerOwnsRecord(connection, nil); err == nil {
		t.Fatal("a bound worker must not update a record with no project")
	}
}

func TestUnboundWorkerLeavesPayloadProject(t *testing.T) {
	payload := parsedChangeWebhook{ProjectID: 9, ProjectCode: "other", Service: "api"}
	if err := bindChangeWorker(&payload, workerConnection{}); err != nil {
		t.Fatalf("unbound change: %v", err)
	}
	if payload.ProjectID != 9 || payload.ProjectCode != "other" || payload.WorkerBoundProject != 0 {
		t.Fatalf("global secret pinned a project: %+v", payload)
	}
	event := parsedAlertEvent{ProjectID: 9, ProjectCode: "other"}
	if err := bindAlertWorker(&event, workerConnection{}); err != nil {
		t.Fatalf("unbound alert: %v", err)
	}
	if event.ProjectID != 9 || event.BoundProject != 0 {
		t.Fatalf("global secret pinned an alert: %+v", event)
	}
	other := 9
	if err := workerOwnsRecord(workerConnection{}, &other); err != nil {
		t.Fatalf("unbound record check: %v", err)
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
	if payload.Priority != "medium" || payload.RiskLevel != "medium" {
		t.Fatalf("priority/risk defaults = %+v", payload)
	}
}

func TestParseChangeWebhookOmitsEnvironment(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/payments-api",
		"sha":"a1b2c3d",
		"service":"payments-api",
		"title":"merge to main"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Environment != "unspecified" {
		t.Fatalf("omitted environment should resolve, got %q", payload.Environment)
	}
	if payload.Service != "payments-api" || payload.ChangeType != "standard" {
		t.Fatalf("service/type = %+v", payload)
	}
}

func TestParseChangeWebhookAliasesIgnoreDescription(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/payments-api",
		"sha":"a1b2c3d",
		"service":"payments-api",
		"env":"dev",
		"project":"12",
		"title":"deploy to uat project 99",
		"summary":"environment prod and project 4"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Environment != "dev" || payload.ProjectID != 12 {
		t.Fatalf("aliases = env %q project %d", payload.Environment, payload.ProjectID)
	}

	omitted, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/payments-api",
		"sha":"a1b2c3d",
		"service":"payments-api",
		"title":"deploy to dev project 12",
		"summary":"environment uat"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if omitted.Environment != "unspecified" || omitted.ProjectID != 0 {
		t.Fatalf("description must not set scope, got env %q project %d", omitted.Environment, omitted.ProjectID)
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
	if changeStatusRank("scheduled") <= changeStatusRank("new") {
		t.Fatal("scheduled should rank above new")
	}
	if changeStatusRank("implementing") <= changeStatusRank("scheduled") {
		t.Fatal("implementing should rank above scheduled")
	}
	if changeStatusRank("implemented") <= changeStatusRank("implementing") {
		t.Fatal("implemented should rank above implementing")
	}
	if changeStatusRank("resolved") <= changeStatusRank("monitoring") {
		t.Fatal("resolved should rank above monitoring")
	}
	if changeStatusRank("closed") <= changeStatusRank("resolved") {
		t.Fatal("closed should rank above resolved")
	}
	if normalizeChangeStatus("success") != "resolved" {
		t.Fatal("success should normalize to resolved")
	}
}

func TestValidateChangeTransition(t *testing.T) {
	got, err := validateChangeTransition("monitoring", "resolved", false)
	if err != nil || got != "resolved" {
		t.Fatalf("monitoring -> resolved: got %q err=%v", got, err)
	}
	if _, err := validateChangeTransition("monitoring", "resolved", true); err == nil {
		t.Fatal("open incidents should block resolve")
	}
	if _, err := validateChangeTransition("monitoring", "closed", true); err == nil {
		t.Fatal("open incidents should block close")
	}
	got, err = validateChangeTransition("resolved", "closed", false)
	if err != nil || got != "closed" {
		t.Fatalf("resolved -> closed: got %q err=%v", got, err)
	}
	got, err = validateChangeTransition("closed", "reopen", false)
	if err != nil || got != "implementing" {
		t.Fatalf("reopen closed: got %q err=%v", got, err)
	}
	if _, err := validateChangeTransition("closed", "failed", false); err == nil {
		t.Fatal("closed change must reopen before fail")
	}
}

func TestNormalizeIncidentStatus(t *testing.T) {
	if normalizeIncidentStatus("ack") != "acknowledged" {
		t.Fatal("ack should become acknowledged")
	}
	if normalizeIncidentStatus("complete") != "closed" {
		t.Fatal("complete should become closed")
	}
	if !incidentIsActive("acknowledged") {
		t.Fatal("acknowledged incidents are still active")
	}
	if incidentIsActive("resolved") || incidentIsActive("closed") || incidentIsActive("cancelled") {
		t.Fatal("finished incidents should not be active")
	}
}

func TestGrafanaPayloadRoundTripJSON(t *testing.T) {
	raw := json.RawMessage(`{"alerts":[{"labels":{"alertname":"x"},"status":"firing"}]}`)
	events, err := parseAlertWebhookJSON(raw)
	if err != nil || len(events) != 1 || events[0].Title != "x" {
		t.Fatalf("got %+v err=%v", events, err)
	}
}
