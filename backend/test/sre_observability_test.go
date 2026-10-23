package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNormalizeServiceCriticality(t *testing.T) {
	if got := normalizeServiceCriticality(""); got != serviceClassUnclassified {
		t.Fatalf("empty = %q", got)
	}
	if got := normalizeServiceCriticality("Mission Critical"); got != serviceClassMissionCritical {
		t.Fatalf("mission = %q", got)
	}
	if got := serviceCriticalityLabel("unclassified"); got != "Unclassified" {
		t.Fatalf("label = %q", got)
	}
}

func TestAvailabilityBudgetExample(t *testing.T) {
	sample := mappedSample{Good: 999750, Total: 1000000, Bad: 250, CoveredMinutes: 43200, WindowMinutes: 43200}
	got := computeAvailabilitySLI(sample, 9990, 43200, 1, 8000)
	if got.State != measureHealthy {
		t.Fatalf("state = %q reason=%q", got.State, got.Reason)
	}
	if got.BudgetRemainBPS != 7500 {
		t.Fatalf("remaining bps = %d want 7500 (25%% consumed)", got.BudgetRemainBPS)
	}
}

func TestZeroTrafficIsNotHealthy(t *testing.T) {
	got := computeAvailabilitySLI(mappedSample{}, 9990, 43200, 1, 0)
	if got.State != measureNoTraffic {
		t.Fatalf("state = %q", got.State)
	}
}

func TestGoodCannotExceedTotal(t *testing.T) {
	got := computeAvailabilitySLI(mappedSample{Good: 5, Total: 3}, 9990, 60, 0, 0)
	if got.Quality != qualityInvalid {
		t.Fatalf("quality = %q", got.Quality)
	}
}

func TestPartialCoverageIsUnknown(t *testing.T) {
	got := computeAvailabilitySLI(mappedSample{Good: 100, Total: 100, CoveredMinutes: 2 * 24 * 60, WindowMinutes: 30 * 24 * 60}, 9990, 30*24*60, 0, 8000)
	if got.State != measureUnknown || got.Quality != qualityPartial {
		t.Fatalf("state=%q quality=%q", got.State, got.Quality)
	}
}

func TestCriticalWinsOverlappingRules(t *testing.T) {
	warning := findingRule{Comparator: "below", Threshold: 20}
	critical := findingRule{Comparator: "below", Threshold: 5, Title: "Budget exhausted"}
	severity, title, _ := evaluateFindingRules(measureAtRisk, 3, warning, critical)
	if severity != findingCritical || title != "Budget exhausted" {
		t.Fatalf("severity=%q title=%q", severity, title)
	}
	if previewFindingOutcome(3, warning, critical) != findingCritical {
		t.Fatal("preview should pick critical")
	}
}

func TestQueryFailureDoesNotCreateFinding(t *testing.T) {
	severity, _, _ := evaluateFindingRules(measureQueryFailed, 1, findingRule{Comparator: "below", Threshold: 20}, findingRule{})
	if severity != "" {
		t.Fatalf("query failure created %q", severity)
	}
}

func TestFixtureQueryParsesCounts(t *testing.T) {
	sample, err := parseFixtureSample(`{"good":9,"total":10}`)
	if err != nil || sample.Good != 9 || sample.Bad != 1 {
		t.Fatalf("sample=%+v err=%v", sample, err)
	}
}

func TestGrafanaWithoutCredentialFails(t *testing.T) {
	_, state, err := executeMonitorQuery(sourceGrafana, "up", "")
	if err == nil || state != measureQueryFailed {
		t.Fatalf("state=%q err=%v", state, err)
	}
	if !strings.Contains(err.Error(), "credential") {
		t.Fatalf("err = %v", err)
	}
}

func TestNewerResultWins(t *testing.T) {
	older := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Minute)
	if !newerResultWins(older, newer) {
		t.Fatal("newer should win")
	}
	if newerResultWins(newer, older) {
		t.Fatal("older must not overwrite")
	}
}

func TestPrometheusRatioMapsToCounts(t *testing.T) {
	body := []byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"__name__":"ratio"},"value":[1710000000,"0.999"]}]}}`)
	sample, err := parsePrometheusInstantJSON(body, "good", "total")
	if err != nil || sample.Total != 10000 || sample.Good != 9990 {
		t.Fatalf("sample=%+v err=%v", sample, err)
	}
}

func TestSplunkExportMapsFields(t *testing.T) {
	body := []byte(`{"result":{"good":"9","total":"10"}}`)
	sample, err := parseSplunkExportJSON(body, "good", "total")
	if err != nil || sample.Good != 9 || sample.Total != 10 {
		t.Fatalf("sample=%+v err=%v", sample, err)
	}
}

func TestProviderCalculatedIsLabelled(t *testing.T) {
	got := computeProviderSLI(mappedSample{ProviderValue: 99.95}, 9990, 43200)
	if got.CalculationMode != calcProvider || got.State != measureHealthy {
		t.Fatalf("got=%+v", got)
	}
}

func TestPercentileIsNotEventCount(t *testing.T) {
	got := computePercentileView(mappedSample{LatencyMS: 920}, 800)
	if got.State != measureBreached || !strings.Contains(got.Reason, "diagnostic") && !strings.Contains(got.Reason, "Diagnostic") {
		t.Fatalf("got=%+v", got)
	}
}

func TestSecretRefRejectsRawCredential(t *testing.T) {
	if validSecretRef("eyJhbGciOi") || validSecretRef("not a ref") {
		t.Fatal("raw secrets must be rejected")
	}
	if !validSecretRef("GRAFANA_TOKEN") {
		t.Fatal("env reference should be accepted")
	}
}

func TestGrafanaSecretWithoutBaseURLFails(t *testing.T) {
	t.Setenv("SRE_TEST_GRAFANA_TOKEN", "placeholder")
	_, state, err := executeConnectorQuery(connectorQuery{SourceType: sourceGrafana, Query: "up", SecretRef: "SRE_TEST_GRAFANA_TOKEN"})
	if err == nil || state != measureQueryFailed || !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("state=%q err=%v", state, err)
	}
}

func TestObservationGuardrailDoesNotBlock(t *testing.T) {
	decision := monitorGuardrailDecision{Mode: "observation", Outcome: "proposed_block"}
	if decision.blocksRelease() {
		t.Fatal("observation must not block")
	}
	enforced := monitorGuardrailDecision{Mode: "enforced", Outcome: "block"}
	if !enforced.blocksRelease() {
		t.Fatal("enforced block should stop the release")
	}
}

func TestMonitorVersionDiff(t *testing.T) {
	items := []monitorVersionView{
		{Version: 2, QueryText: "b", TargetBPS: 9990, WindowMinutes: 60, GoodField: "good", TotalField: "total", CalculationMode: "local"},
		{Version: 1, QueryText: "a", TargetBPS: 9900, WindowMinutes: 60, GoodField: "good", TotalField: "total", CalculationMode: "local"},
	}
	got := diffMonitorVersions(items)
	if len(got) == 0 || !strings.Contains(strings.Join(got, " "), "Query") {
		t.Fatalf("diff = %v", got)
	}
}

func TestSecretRefRejectsCredentialValues(t *testing.T) {
	if validSecretRef("GRAFANA_TOKEN") != true {
		t.Fatal("env name should be accepted")
	}
	if validSecretRef("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9") {
		t.Fatal("token-shaped values must be rejected")
	}
	if overlappingServiceChanges(nil, "") != nil && len(overlappingServiceChanges(nil, "")) != 0 {
		t.Fatal("nil service has no overlapping changes")
	}
}

func TestAlertOrderingAndPartialRecovery(t *testing.T) {
	now := time.Now().UTC()
	if !ignoreStaleAlert(now, now.Add(-time.Minute)) {
		t.Fatal("older events should be ignored")
	}
	if canCloseLinkedIncident(2) {
		t.Fatal("other firing alerts must keep the incident open")
	}
	if !canCloseLinkedIncident(0) {
		t.Fatal("no remaining firing alerts can close")
	}
	if nextAlertEpisodeSequence("resolved", 1, true) != 2 {
		t.Fatal("a recovered alert firing again starts a new episode")
	}
	if nextAlertEpisodeSequence("firing", 1, true) != 1 {
		t.Fatal("repeat delivery must not open a duplicate episode")
	}
}

func TestGuardrailArtifactAndExpiry(t *testing.T) {
	now := time.Now().UTC()
	if ok, _ := artifactDecisionUsable("abc", "def", now.Add(time.Hour), now, "block"); ok {
		t.Fatal("wrong artifact must be rejected")
	}
	if ok, _ := artifactDecisionUsable("abc", "abc", now.Add(-time.Minute), now, "overridden"); ok {
		t.Fatal("expired override must be rejected")
	}
	if ok, _ := artifactDecisionUsable("abc", "abc", now.Add(time.Hour), now, "overridden"); !ok {
		t.Fatal("fresh matching override should be usable")
	}
}

func TestHistoricalPolicySimulation(t *testing.T) {
	empty := simulateFindingHistory(nil, findingRule{Comparator: "below", Threshold: 20}, findingRule{Comparator: "below", Threshold: 5})
	if empty.Notifications || empty.IncidentsCreated || !strings.Contains(empty.CoverageNote, "Absent") {
		t.Fatalf("empty simulation = %+v", empty)
	}
	runs := []sliMeasurement{{State: measureHealthy, Quality: qualityValid, BudgetRemainBPS: 7500}}
	got := simulateFindingHistory(runs, findingRule{Comparator: "below", Threshold: 20}, findingRule{Comparator: "below", Threshold: 5})
	if got.Label != "simulation" || got.Samples != 1 || got.Notifications {
		t.Fatalf("simulation = %+v", got)
	}
}

func TestGroupedGrafanaAlertsParseSeparately(t *testing.T) {
	body := []byte(`{"receiver":"ops","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"Latency","service":"checkout","env":"prod","severity":"critical"},"fingerprint":"aaa"},{"status":"resolved","labels":{"alertname":"Errors","service":"checkout","env":"prod"},"fingerprint":"bbb"}]}`)
	events, err := parseAlertWebhookJSON(body)
	if err != nil || len(events) != 2 {
		t.Fatalf("events=%d err=%v", len(events), err)
	}
	if events[0].Status != "firing" || events[1].Status != "resolved" {
		t.Fatalf("status=%q %q", events[0].Status, events[1].Status)
	}
	if events[0].Fingerprint == events[1].Fingerprint {
		t.Fatal("grouped alerts must keep distinct fingerprints")
	}
}

func TestRetryKeepsOriginalAnchor(t *testing.T) {
	original := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	got := retryEvaluationAnchor(original, true)
	if !got.Equal(original) {
		t.Fatalf("retry anchor = %s", got)
	}
	if !retryEvaluationAnchor(original, false).IsZero() {
		t.Fatal("a new refresh must not reuse the previous window")
	}
}

func TestServiceEvalMetaEmptyIDs(t *testing.T) {
	if got := serviceEvalMetaForServices(nil); len(got) != 0 {
		t.Fatalf("nil ids = %+v", got)
	}
}

func TestConnectorProbeQueryPrometheus(t *testing.T) {
	if got := connectorProbeQuery("prometheus"); got != "vector(1)" {
		t.Fatalf("prometheus probe = %q", got)
	}
	if got := connectorProbeQuery("grafana"); got != "vector(1)" {
		t.Fatalf("grafana probe = %q", got)
	}
	if got := connectorProbeQuery("fixture"); got != `{"good":1,"total":1}` {
		t.Fatalf("fixture probe = %q", got)
	}
}

func TestFindingIncidentLinkKeepsFirst(t *testing.T) {
	if got := findingIncidentLink(0, 12); got != 12 {
		t.Fatalf("empty finding should take the incident, got %d", got)
	}
	if got := findingIncidentLink(7, 12); got != 7 {
		t.Fatalf("an existing incident must stay, got %d", got)
	}
	if got := findingIncidentLink(7, 0); got != 7 {
		t.Fatalf("zero incident id must not clear a link, got %d", got)
	}
}

func TestAttachFindingIncidentNoopWithoutDB(t *testing.T) {
	attachIncidentToMonitorFinding(1, 9, 4)
}

func TestConnectorPublicOmitsSecretValue(t *testing.T) {
	item := connectorPublic(1, nil, "Grafana prod", "grafana", "prom", "https://metrics.example.internal", "GRAFANA_TOKEN", "ready", "", nil, 0, 15, true)
	if !item.HasCredential || !item.Enabled {
		t.Fatalf("%+v", item)
	}
	raw, _ := json.Marshal(item)
	if strings.Contains(string(raw), "GRAFANA_TOKEN") && strings.Contains(string(raw), `"secret_ref"`) {
		t.Fatalf("secret reference leaked: %s", raw)
	}
}

func TestWebhookTimestampAndIngestDelay(t *testing.T) {
	now := time.Now().UTC()
	if !monitoringTimestampTooOld(now.Add(-10*time.Minute), now) {
		t.Fatal("stale signed timestamps must be rejected")
	}
	if monitoringTimestampTooOld(time.Time{}, now) {
		t.Fatal("missing timestamp is allowed when HMAC already matched")
	}
	anchor := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	got := evaluatedThrough(anchor, 15)
	if !got.Equal(anchor.Add(-15 * time.Minute)) {
		t.Fatalf("evaluated through = %s", got)
	}
}
