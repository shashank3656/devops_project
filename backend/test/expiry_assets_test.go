package main

import (
	"net"
	"testing"
	"time"
)

func TestExpiryRejectsPrivateAndMetadataIPs(t *testing.T) {
	denied := []string{"127.0.0.1", "10.1.2.3", "192.168.0.8", "172.16.1.1", "169.254.169.254", "::1", "fc00::1"}
	for _, raw := range denied {
		if ipIsPublicForProbe(net.ParseIP(raw)) {
			t.Fatalf("%s must not be probed by the hosted collector", raw)
		}
	}
	if !ipIsPublicForProbe(net.ParseIP("1.1.1.1")) {
		t.Fatal("public IPv4 should be allowed")
	}
}

func TestExpiryPortAllowlist(t *testing.T) {
	if !expiryPortAllowed(443) || !expiryPortAllowed(8443) || expiryPortAllowed(22) || expiryPortAllowed(80) {
		t.Fatal("hosted checks only allow 443 and 8443")
	}
}

func TestNormalizeRegistrableDomainKeepsApex(t *testing.T) {
	got, err := normalizeRegistrableDomain("https://app.Example.com/health")
	if err != nil {
		t.Fatal(err)
	}
	if got != "example.com" {
		t.Fatalf("domain = %s", got)
	}
}

func TestCertificateAssessmentDoesNotTreatTCPAsValid(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	later := now.Add(40 * 24 * time.Hour)
	if got := classifyExpiryAssessment("certificate", &later, false, true, "", now, []int{30, 14, 7}); got != "invalid" {
		t.Fatalf("hostname mismatch = %s", got)
	}
	if got := classifyExpiryAssessment("certificate", &later, true, true, "", now, []int{30}); got != "valid" {
		t.Fatalf("healthy cert = %s", got)
	}
	soon := now.Add(10 * 24 * time.Hour)
	if got := classifyExpiryAssessment("certificate", &soon, true, true, "", now, []int{30, 14}); got != "expiring" {
		t.Fatalf("expiring = %s", got)
	}
	past := now.Add(-time.Hour)
	if got := classifyExpiryAssessment("certificate", &past, true, true, "", now, []int{30}); got != "expired" {
		t.Fatalf("expired = %s", got)
	}
}

func TestMissingRDAPDateStaysUnknown(t *testing.T) {
	if got := classifyExpiryAssessment("domain", nil, true, true, "", time.Now().UTC(), []int{30}); got != "unknown" {
		t.Fatalf("missing date = %s", got)
	}
}

func TestRDAPKeepsRegistrarAndRegistryDistinct(t *testing.T) {
	registrar, registry := rdapExpiryDates([]rdapEvent{
		{Action: "expiration", Date: "2026-11-01T00:00:00Z"},
		{Action: "registrar expiration", Date: "2026-10-28T00:00:00Z"},
	})
	if registrar == nil || registry == nil {
		t.Fatal("both dates are required when RDAP returns both")
	}
	if registrar.Equal(*registry) {
		t.Fatal("registrar and registry expiry must stay distinct")
	}
}

func TestAutoRenewFlagIsNotVerification(t *testing.T) {
	status := []string{"client hold", "auto renew period"}
	flag := rdapAutoRenew(status)
	if flag == nil || !*flag {
		t.Fatal("auto-renew should parse as reported")
	}
}

func TestProbeFailureDoesNotInventExpiry(t *testing.T) {
	if got := classifyExpiryAssessment("certificate", nil, false, false, "unreachable", time.Now().UTC(), []int{30}); got != "unknown" {
		t.Fatalf("unreachable = %s", got)
	}
}
