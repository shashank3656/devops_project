package main

import (
	"net"
	"testing"
	"time"
)

func TestExpiryAssetVisibleAllowsUnscopedAndAssignedProjects(t *testing.T) {
	if expiryAssetVisible(0, 0, nil) {
		t.Fatal("signed-out caller cannot see unscoped assets")
	}
	if !expiryAssetVisible(0, 7, nil) {
		t.Fatal("authenticated caller can see unscoped assets")
	}
	if expiryAssetVisible(12, 7, nil) {
		t.Fatal("unknown project must stay hidden")
	}
	if !expiryAssetVisible(12, 7, map[int]struct{}{12: {}}) {
		t.Fatal("assigned project should be visible")
	}
}

func TestExpiryOwnerNameNeverUsesEmail(t *testing.T) {
	if got := expiryPersonName(""); got != "Unknown" {
		t.Fatalf("blank = %s", got)
	}
	if got := expiryPersonName("  alice  "); got != "alice" {
		t.Fatalf("trimmed = %s", got)
	}
}

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

func TestExpiryResolvedPublicIPsSkipsInternal(t *testing.T) {
	ok, public := expiryResolvedPublicIPs(nil)
	if ok || len(public) != 0 {
		t.Fatal("empty lookup is not a DNS success")
	}
	ok, public = expiryResolvedPublicIPs([]net.IPAddr{{IP: net.ParseIP("10.1.2.3")}, {IP: net.ParseIP("192.168.0.8")}})
	if !ok {
		t.Fatal("internal names still resolved")
	}
	if len(public) != 0 {
		t.Fatalf("internal addresses must not be stored = %v", public)
	}
	ok, public = expiryResolvedPublicIPs([]net.IPAddr{{IP: net.ParseIP("10.1.2.3")}, {IP: net.ParseIP("1.1.1.1")}})
	if !ok || len(public) != 1 || public[0] != "1.1.1.1" {
		t.Fatalf("public = %v ok=%v", public, ok)
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

func TestExpiryActiveReminderUsesTightestWindow(t *testing.T) {
	windows := expiryDefaultReminderWindows()
	key, window := expiryActiveReminder(20, false, windows)
	if key != "expiring:30" || window != 30 {
		t.Fatalf("month window = %s %d", key, window)
	}
	key, window = expiryActiveReminder(14, false, windows)
	if key != "expiring:14" || window != 14 {
		t.Fatalf("two week window = %s %d", key, window)
	}
	key, window = expiryActiveReminder(8, false, windows)
	if key != "expiring:14" || window != 14 {
		t.Fatalf("still two weeks = %s %d", key, window)
	}
	key, window = expiryActiveReminder(7, false, windows)
	if key != "expiring:7" || window != 7 {
		t.Fatalf("one week window = %s %d", key, window)
	}
	key, window = expiryActiveReminder(1, false, windows)
	if key != "expiring:1" || window != 1 {
		t.Fatalf("one day window = %s %d", key, window)
	}
	key, window = expiryActiveReminder(-1, true, windows)
	if key != "expired" || window != 0 {
		t.Fatalf("expired = %s %d", key, window)
	}
	key, window = expiryActiveReminder(40, false, windows)
	if key != "" || window != 0 {
		t.Fatalf("outside policy = %s %d", key, window)
	}
}

func TestExpiryReminderWindowsHonorAssetPolicy(t *testing.T) {
	got := expiryReminderWindows([]int{7, 3, 1})
	if len(got) != 3 || got[0] != 7 || got[1] != 3 || got[2] != 1 {
		t.Fatalf("short-lived windows = %v", got)
	}
	key, window := expiryActiveReminder(20, false, got)
	if key != "" || window != 0 {
		t.Fatalf("short-lived must not warn at 20 days = %s %d", key, window)
	}
	key, window = expiryActiveReminder(7, false, got)
	if key != "expiring:7" || window != 7 {
		t.Fatalf("short-lived week window = %s %d", key, window)
	}
}

func TestExpirySuggestionRejectsInternalHosts(t *testing.T) {
	if expirySuggestionAllowed("internal.example.com") || expirySuggestionAllowed("*.example.com") || expirySuggestionAllowed("app.local") {
		t.Fatal("internal or wildcard hosts must not be suggested")
	}
	if !expirySuggestionAllowed("app.example.com") {
		t.Fatal("public ingress hosts should be suggested")
	}
}

func TestExpiryPrivateCollectorTargetsStayOffHostedPath(t *testing.T) {
	if !expiryCollectorIsPrivate("private") || expiryCollectorIsPrivate("hosted") {
		t.Fatal("collector mode mismatch")
	}
	if !expiryHostNeedsPrivateCollector("app.internal") || !expiryHostNeedsPrivateCollector("10.1.2.3") {
		t.Fatal("internal names need a private collector")
	}
	if expiryHostNeedsPrivateCollector("app.example.com") {
		t.Fatal("public hosts do not require a private collector")
	}
	got, err := normalizeExpiryCollector("")
	if err != nil || got != "hosted" {
		t.Fatalf("default collector = %s %v", got, err)
	}
	if _, err := normalizeExpiryCollector("socket"); err == nil {
		t.Fatal("unknown collector modes must be rejected")
	}
}

func TestCloudCertificateManagerTypeDoesNotTreatComputeAsIssued(t *testing.T) {
	if cloudCertificateManagerType("ec2") || cloudCertificateManagerType("eks") {
		t.Fatal("compute inventory is not certificate-manager issued evidence")
	}
	if !cloudCertificateManagerType("acm") || !cloudCertificateManagerType("certificate-manager") {
		t.Fatal("certificate manager types should be imported as issued-not-served suggestions")
	}
}

func TestExpiryHostnameFromInventoryIgnoresBareIds(t *testing.T) {
	if got := expiryHostnameFromInventory("api-cert", "arn:aws:acm:us-east-1:111122223333:certificate/abcd"); got != "" {
		t.Fatalf("arn must not become a hostname = %s", got)
	}
	if got := expiryHostnameFromInventory("app.example.com", ""); got != "app.example.com" {
		t.Fatalf("fqdn = %s", got)
	}
}

func TestSplitExpirySuggestionHostsSkipsWildcards(t *testing.T) {
	got := splitExpirySuggestionHosts("app.example.com, *.example.com, payments.internal")
	if len(got) != 2 || got[0] != "app.example.com" || got[1] != "payments.internal" {
		t.Fatalf("hosts = %v", got)
	}
}

func TestPlannedExpiryDNSRecordsAreSuggestionsOnly(t *testing.T) {
	records := plannedExpiryDNSRecords(expiryAssetView{AssetType: "certificate", Hostname: "app.example.com", DisplayName: "app.example.com"})
	if len(records) < 3 {
		t.Fatalf("records = %d", len(records))
	}
	foundChallenge := false
	for _, record := range records {
		if record.Type == "TXT" && record.Name == "_acme-challenge.app.example.com" {
			foundChallenge = true
			if record.Value == "" || record.Value == record.Name {
				t.Fatal("challenge value must stay a placeholder")
			}
		}
	}
	if !foundChallenge {
		t.Fatal("ACME challenge placeholder is required")
	}
}

func TestPrivateCollectorObservationRejectsPrivateKeys(t *testing.T) {
	if err := applyPrivateCollectorObservation(1, 0, []byte(`{"asset_id":1,"private_key":"x","not_after":"2027-01-01T00:00:00Z"}`)); err == nil {
		t.Fatal("private keys must be rejected")
	}
	if err := applyPrivateCollectorObservation(1, 0, []byte(`{"pem":"-----BEGIN PRIVATE KEY-----"}`)); err == nil {
		t.Fatal("PEM private keys must be rejected")
	}
}
