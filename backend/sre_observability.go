package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	serviceClassUnclassified       = "unclassified"
	serviceClassMissionCritical    = "mission_critical"
	serviceClassBusinessEssential  = "business_essential"
	serviceClassBusinessSupporting = "business_supporting"
	serviceClassLowImpact          = "low_impact"

	measureAvailability = "availability_sli"
	measureLatencySLI   = "latency_sli"
	measurePercentiles  = "latency_percentiles"
	measureProvider     = "provider_calculated"

	sourceGrafana = "grafana"
	sourceSplunk  = "splunk"
	sourceFixture = "fixture"

	calcLocal    = "local"
	calcProvider = "provider"

	qualityValid   = "valid"
	qualityPartial = "partial"
	qualityInvalid = "invalid"

	measureHealthy     = "healthy"
	measureAtRisk      = "at_risk"
	measureBreached    = "breached"
	measureUnknown     = "unknown"
	measureStale       = "stale"
	measureNoTraffic   = "no_traffic"
	measureQueryFailed = "query_failed"
	measureDisabled    = "disabled"

	findingCritical = "critical"
	findingWarning  = "warning"
	findingInfo     = "info"

	lifecycleOpen     = "open"
	lifecycleAcked    = "acknowledged"
	lifecycleResolved = "resolved"
)

type findingRule struct {
	Comparator  string  `json:"comparator"`
	Threshold   float64 `json:"threshold"`
	WindowMin   int     `json:"window_minutes"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
}

type mappedSample struct {
	Good           int64   `json:"good"`
	Total          int64   `json:"total"`
	Bad            int64   `json:"bad"`
	LatencyMS      float64 `json:"latency_ms"`
	CoveredMinutes int     `json:"covered_minutes"`
	WindowMinutes  int     `json:"window_minutes"`
	ObservedAt     string  `json:"observed_at"`
	ProviderValue  float64 `json:"provider_value"`
	ProviderTarget float64 `json:"provider_target"`
	ProviderWindow int     `json:"provider_window_minutes"`
	ProviderMode   string  `json:"provider_mode"`
}

type sliMeasurement struct {
	State            string `json:"state"`
	Quality          string `json:"quality"`
	Good             int64  `json:"good"`
	Total            int64  `json:"total"`
	Bad              int64  `json:"bad"`
	AvailabilityBPS  int    `json:"availability_bps"`
	TargetBPS        int    `json:"target_bps"`
	BudgetRemainBPS  int    `json:"budget_remaining_bps"`
	BurnRateMilli    int    `json:"burn_rate_milli"`
	CoverageBPS      int    `json:"coverage_bps"`
	SampleCount      int64  `json:"sample_count"`
	WindowMinutes    int    `json:"window_minutes"`
	CoveredMinutes   int    `json:"covered_minutes"`
	ObservedAt       string `json:"observed_at"`
	Reason           string `json:"reason"`
	CalculationMode  string `json:"calculation_mode"`
	NumeratorLabel   string `json:"numerator_label"`
	DenominatorLabel string `json:"denominator_label"`
}

func normalizeServiceCriticality(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case serviceClassMissionCritical, "mission-critical", "mission critical":
		return serviceClassMissionCritical
	case serviceClassBusinessEssential, "business-essential", "business essential":
		return serviceClassBusinessEssential
	case serviceClassBusinessSupporting, "business-supporting", "business supporting":
		return serviceClassBusinessSupporting
	case serviceClassLowImpact, "low-impact", "low impact":
		return serviceClassLowImpact
	default:
		return serviceClassUnclassified
	}
}

func serviceCriticalityLabel(value string) string {
	switch normalizeServiceCriticality(value) {
	case serviceClassMissionCritical:
		return "Mission Critical"
	case serviceClassBusinessEssential:
		return "Business Essential"
	case serviceClassBusinessSupporting:
		return "Business Supporting"
	case serviceClassLowImpact:
		return "Low Impact"
	default:
		return "Unclassified"
	}
}

func bpsFromRatio(good, total int64) int {
	if total <= 0 {
		return 0
	}
	return int(math.Round(float64(good) * 10000 / float64(total)))
}

func parseFixtureSample(query string) (mappedSample, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return mappedSample{}, fmt.Errorf("query is empty")
	}
	var sample mappedSample
	if err := json.Unmarshal([]byte(query), &sample); err != nil {
		return mappedSample{}, fmt.Errorf("fixture query must be JSON with good and total counts")
	}
	if sample.Bad == 0 && sample.Total >= sample.Good {
		sample.Bad = sample.Total - sample.Good
	}
	return sample, nil
}

func computeAvailabilitySLI(sample mappedSample, targetBPS, windowMinutes, minSamples, minCoverageBPS int) sliMeasurement {
	out := sliMeasurement{
		TargetBPS:        targetBPS,
		WindowMinutes:    windowMinutes,
		CoveredMinutes:   sample.CoveredMinutes,
		SampleCount:      sample.Total,
		Good:             sample.Good,
		Total:            sample.Total,
		Bad:              sample.Bad,
		ObservedAt:       strings.TrimSpace(sample.ObservedAt),
		CalculationMode:  calcLocal,
		NumeratorLabel:   "good eligible events",
		DenominatorLabel: "all eligible events",
	}
	if windowMinutes <= 0 {
		windowMinutes = sample.WindowMinutes
		out.WindowMinutes = windowMinutes
	}
	if sample.CoveredMinutes <= 0 && windowMinutes > 0 {
		out.CoveredMinutes = windowMinutes
		sample.CoveredMinutes = windowMinutes
	}
	if sample.Total < 0 || sample.Good < 0 || sample.Bad < 0 {
		out.State = measureUnknown
		out.Quality = qualityInvalid
		out.Reason = "Counts must be non-negative."
		return out
	}
	if sample.Good > sample.Total {
		out.State = measureUnknown
		out.Quality = qualityInvalid
		out.Reason = "Good events cannot exceed total events."
		return out
	}
	if sample.Total == 0 {
		out.State = measureNoTraffic
		out.Quality = qualityValid
		out.Reason = "No eligible traffic in this window. This is not 100% healthy."
		return out
	}
	if minSamples > 0 && sample.Total < int64(minSamples) {
		out.State = measureUnknown
		out.Quality = qualityPartial
		out.AvailabilityBPS = bpsFromRatio(sample.Good, sample.Total)
		out.Reason = "Insufficient samples for a full-window SLO result."
		return out
	}
	if windowMinutes > 0 {
		out.CoverageBPS = bpsFromRatio(int64(sample.CoveredMinutes), int64(windowMinutes))
		if minCoverageBPS > 0 && out.CoverageBPS < minCoverageBPS {
			out.State = measureUnknown
			out.Quality = qualityPartial
			out.AvailabilityBPS = bpsFromRatio(sample.Good, sample.Total)
			out.Reason = "Only part of the requested window is available. A full-window SLO result cannot yet be established."
			return out
		}
	} else {
		out.CoverageBPS = 10000
	}
	out.AvailabilityBPS = bpsFromRatio(sample.Good, sample.Total)
	out.Quality = qualityValid
	if targetBPS <= 0 || targetBPS >= 10000 {
		out.State = measureUnknown
		out.Reason = "SLO target is missing or invalid."
		out.Quality = qualityInvalid
		return out
	}
	allowedBad := float64(sample.Total) * float64(10000-targetBPS) / 10000
	if allowedBad <= 0 {
		out.State = measureUnknown
		out.Quality = qualityInvalid
		out.Reason = "Allowed bad events is zero for this target."
		return out
	}
	consumed := float64(sample.Bad) / allowedBad
	if consumed < 0 {
		consumed = 0
	}
	remaining := 1 - consumed
	if remaining < 0 {
		remaining = 0
	}
	out.BudgetRemainBPS = int(math.Round(remaining * 10000))
	observedBadFrac := float64(sample.Bad) / float64(sample.Total)
	out.BurnRateMilli = int(math.Round(observedBadFrac / (float64(10000-targetBPS) / 10000) * 1000))
	switch {
	case out.AvailabilityBPS < targetBPS:
		out.State = measureBreached
		out.Reason = "Availability is below the configured target."
	case out.BudgetRemainBPS < 2000:
		out.State = measureAtRisk
		out.Reason = "Error budget is running low."
	default:
		out.State = measureHealthy
		out.Reason = "Availability target met."
	}
	return out
}

func computeLatencySLI(sample mappedSample, targetBPS int, thresholdMS float64, windowMinutes, minSamples int) sliMeasurement {
	out := computeAvailabilitySLI(sample, targetBPS, windowMinutes, minSamples, 0)
	out.NumeratorLabel = "requests within threshold"
	out.DenominatorLabel = "eligible requests"
	if thresholdMS <= 0 && out.Quality == qualityValid && out.State != measureNoTraffic {
		out.State = measureUnknown
		out.Quality = qualityInvalid
		out.Reason = "Latency threshold is required for a latency SLI."
	}
	return out
}

func ruleMatches(value float64, rule findingRule) bool {
	if strings.TrimSpace(rule.Comparator) == "" {
		return false
	}
	switch rule.Comparator {
	case "below", "<":
		return value < rule.Threshold
	case "at_or_below", "<=":
		return value <= rule.Threshold
	case "above", ">":
		return value > rule.Threshold
	case "at_or_above", ">=":
		return value >= rule.Threshold
	default:
		return false
	}
}

func evaluateFindingRules(state string, metricValue float64, warning, critical findingRule) (severity, title, explanation string) {
	if state == measureQueryFailed || state == measureNoTraffic || state == measureUnknown || state == measureDisabled {
		return "", "", ""
	}
	critHit := ruleMatches(metricValue, critical)
	warnHit := ruleMatches(metricValue, warning)
	if critHit {
		title = strings.TrimSpace(critical.Title)
		if title == "" {
			title = "Critical threshold breached"
		}
		explanation = strings.TrimSpace(critical.Description)
		return findingCritical, title, explanation
	}
	if warnHit {
		title = strings.TrimSpace(warning.Title)
		if title == "" {
			title = "Warning threshold reached"
		}
		explanation = strings.TrimSpace(warning.Description)
		return findingWarning, title, explanation
	}
	return "", "", ""
}

func previewFindingOutcome(value float64, warning, critical findingRule) string {
	if ruleMatches(value, critical) {
		return findingCritical
	}
	if ruleMatches(value, warning) {
		return findingWarning
	}
	return "healthy"
}

type monitorQueryTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	SourceType  string `json:"source_type"`
	Measurement string `json:"measurement_type"`
	Language    string `json:"query_language"`
	Query       string `json:"query"`
	GoodField   string `json:"good_field"`
	TotalField  string `json:"total_field"`
	Help        string `json:"help"`
}

func monitoringQueryTemplates() []monitorQueryTemplate {
	return []monitorQueryTemplate{
		{
			ID: "fixture-availability", Name: "Pilot availability counts", SourceType: sourceFixture,
			Measurement: measureAvailability, Language: "json",
			Query:     "{\n  \"good\": 999000,\n  \"total\": 1000000,\n  \"covered_minutes\": 43200,\n  \"window_minutes\": 43200\n}",
			GoodField: "good", TotalField: "total",
			Help: "Pilot fixture. Paste known counts from the source. This is not a live Splunk or Grafana query.",
		},
		{
			ID: "splunk-availability", Name: "Splunk availability counts", SourceType: sourceSplunk,
			Measurement: measureAvailability, Language: "spl",
			Query:     "index=app sourcetype=access status=* | stats count AS total, count(eval(status<500)) AS good",
			GoodField: "good", TotalField: "total",
			Help: "Requires a Splunk connector with a read-only identity. Map good and total before enabling.",
		},
		{
			ID: "grafana-latency", Name: "Grafana latency compliance", SourceType: sourceGrafana,
			Measurement: measureLatencySLI, Language: "promql",
			Query:     "sum(rate(http_request_duration_seconds_bucket{le=\"0.5\"}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))",
			GoodField: "good", TotalField: "total",
			Help: "Select a Grafana data source. A dashboard URL is evidence, not an executable query.",
		},
		{
			ID: "prometheus-availability", Name: "Prometheus availability ratio", SourceType: sourcePrometheus,
			Measurement: measureAvailability, Language: "promql",
			Query:     "sum(rate(http_requests_total{code!~\"5..\"}[5m])) / sum(rate(http_requests_total[5m]))",
			GoodField: "good", TotalField: "total",
			Help: "Direct Prometheus instant query. Map a 0–1 ratio or named good/total series.",
		},
		{
			ID: "percentile-diagnostic", Name: "Latency percentiles", SourceType: sourceFixture,
			Measurement: measurePercentiles, Language: "json",
			Query:     "{\n  \"latency_ms\": 180,\n  \"p50\": 80,\n  \"p95\": 180,\n  \"p99\": 400\n}",
			GoodField: "good", TotalField: "total",
			Help: "Diagnostic percentiles. These are not event counts and are not averaged.",
		},
		{
			ID: "provider-compliance", Name: "Provider-calculated compliance", SourceType: sourceFixture,
			Measurement: measureProvider, Language: "json",
			Query:     "{\n  \"provider_value\": 99.95,\n  \"provider_target\": 99.9,\n  \"provider_window_minutes\": 43200\n}",
			GoodField: "good", TotalField: "total",
			Help: "Use only when the source already calculated compliance. Labelled as source-provided.",
		},
	}
}

type evalBatchGate struct {
	mu     sync.Mutex
	active map[string]int
}

var monitorEvalGate = evalBatchGate{active: map[string]int{}}

func coalesceRefreshKey(serviceID int, environment string, versionIDs []int, window string) string {
	parts := make([]string, 0, len(versionIDs)+3)
	parts = append(parts, strconv.Itoa(serviceID), strings.ToLower(strings.TrimSpace(environment)), strings.TrimSpace(window))
	for _, id := range versionIDs {
		parts = append(parts, strconv.Itoa(id))
	}
	return strings.Join(parts, "|")
}

func (g *evalBatchGate) begin(key string) (ok bool, existing int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if id, found := g.active[key]; found {
		return false, id
	}
	g.active[key] = 0
	return true, 0
}

func (g *evalBatchGate) bind(key string, id int) {
	g.mu.Lock()
	g.active[key] = id
	g.mu.Unlock()
}

func (g *evalBatchGate) done(key string) {
	g.mu.Lock()
	delete(g.active, key)
	g.mu.Unlock()
}

func newerResultWins(existing, incoming time.Time) bool {
	if incoming.IsZero() {
		return false
	}
	if existing.IsZero() {
		return true
	}
	return !incoming.Before(existing)
}
