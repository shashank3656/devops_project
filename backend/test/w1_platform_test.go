package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeSSOProviderOIDC(t *testing.T) {
	if got := normalizeSSOProvider("openid_connect"); got != "oidc" {
		t.Fatalf("got %s", got)
	}
}

func TestOIDCStartURL(t *testing.T) {
	url := oidcStartURL("devops")
	if url == "" || url[len(url)-13:] != "portal=devops" {
		t.Fatalf("unexpected start url %s", url)
	}
}

func TestParseChangeWebhookProvenance(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/api",
		"sha":"abc123",
		"title":"ship sbom",
		"sbom_url":"https://example.com/sbom.json",
		"attestation_url":"https://example.com/attestation.json",
		"image_digest":"sha256:deadbeef",
		"signed":true
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.SbomURL == "" || payload.AttestationURL == "" || payload.ImageDigest == "" {
		t.Fatalf("provenance fields missing: %+v", payload)
	}
	if payload.ProvenanceJSON == "" {
		t.Fatal("expected provenance json")
	}
	item := changeRequestRecord{AttestationURL: payload.AttestationURL, ProvenanceJSON: payload.ProvenanceJSON}
	if !changeProvenanceSigned(item) {
		t.Fatal("attestation should mark signed")
	}
}

func TestParseIRMPagerDutyAcknowledged(t *testing.T) {
	body := []byte(`{"event":{"event_type":"incident.acknowledged","data":{"id":"Q123","status":"acknowledged","title":"api 5xx"}}}`)
	provider, id, status, title, _, fingerprint, ok := parseIRMWebhook(body, "pagerduty")
	if !ok || provider != "pagerduty" || id != "Q123" {
		t.Fatalf("parse failed provider=%s id=%s ok=%t", provider, id, ok)
	}
	if mapExternalIncidentStatus(provider, status) != "acknowledged" {
		t.Fatalf("status %s", status)
	}
	if title == "" || fingerprint == "" {
		t.Fatal("expected title and fingerprint")
	}
}

func TestParseIRMGrafanaResolve(t *testing.T) {
	provider, id, status, _, _, _, ok := parseIRMWebhook([]byte(`{"alert_uid":"abc","state":"ok","title":"latency"}`), "grafana")
	if !ok || provider != "grafana" || id != "abc" {
		t.Fatalf("grafana parse failed")
	}
	if mapExternalIncidentStatus(provider, status) != "resolved" {
		t.Fatalf("expected resolved got %s", mapExternalIncidentStatus(provider, status))
	}
}

func TestNormalizeIRMProvider(t *testing.T) {
	if normalizeIRMProvider("pd") != "pagerduty" {
		t.Fatal("pd")
	}
	if normalizeIRMProvider("grafana_oncall") != "grafana" {
		t.Fatal("grafana")
	}
}

func TestMCPToolsAreReadOnly(t *testing.T) {
	names := mcpToolNames()
	if len(names) < 4 {
		t.Fatalf("expected core read tools, got %v", names)
	}
	for _, name := range names {
		if name == "create_change" || name == "resolve_incident" {
			t.Fatalf("write tool leaked: %s", name)
		}
	}
	if _, err := callMCPTool("resolve_incident", nil); err == nil {
		t.Fatal("write tool must fail")
	}
}

func TestEncodeDecodeOIDCState(t *testing.T) {
	raw, err := encodeOIDCState("user")
	if err != nil {
		t.Fatal(err)
	}
	state, err := decodeOIDCState(raw)
	if err != nil {
		t.Fatal(err)
	}
	if state.Portal != "user" {
		t.Fatalf("portal %s", state.Portal)
	}
	if _, err := decodeOIDCState("tampered"); err == nil {
		t.Fatal("tampered state must fail")
	}
}

func TestMCPIncludesAskCatalog(t *testing.T) {
	found := false
	for _, name := range mcpToolNames() {
		if name == "ask_catalog" {
			found = true
		}
	}
	if !found {
		t.Fatal("ask_catalog missing")
	}
	answer, err := callMCPTool("ask_catalog", map[string]any{"query": "terraform apply prod now"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(answer), "will not apply") {
		t.Fatalf("%s", answer)
	}
}

func TestGitLabOIDCDefaults(t *testing.T) {
	if gitlabOIDCIssuer() != "https://gitlab.com" {
		t.Fatalf("%s", gitlabOIDCIssuer())
	}
	if !strings.HasSuffix(gitlabOIDCJWKS(), "/oauth/discovery/keys") {
		t.Fatalf("%s", gitlabOIDCJWKS())
	}
	if _, err := verifyGitLabOIDC("not-a-jwt"); err == nil {
		t.Fatal("invalid token must fail")
	}
}

func TestLastChangeForRepoEmpty(t *testing.T) {
	if lastChangeForRepo("", "") != nil {
		t.Fatal("empty repo should have no last change")
	}
}

func TestAudienceContains(t *testing.T) {
	if !audienceContains([]interface{}{"setuops", "other"}, "setuops") {
		t.Fatal("audience should match")
	}
	raw, _ := json.Marshal(map[string]bool{"signed": true})
	if !changeProvenanceSigned(changeRequestRecord{ProvenanceJSON: string(raw)}) {
		t.Fatal("signed json should count")
	}
}
