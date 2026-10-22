package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	sourcePrometheus = "prometheus"
	sourceDatadog    = "datadog"
	sourcePrivate    = "private"
)

var secretRefPattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,79}$`)

type connectorQuery struct {
	SourceType    string
	BaseURL       string
	SecretRef     string
	DatasourceUID string
	Query         string
	GoodField     string
	TotalField    string
	ConnectorID   int
	ServiceID     int
	Environment   string
}

type monitoringHTTPResponse struct {
	Status int
	Body   []byte
}

var monitoringHTTPGet = defaultMonitoringHTTPGet

func defaultMonitoringHTTPGet(rawURL, authorization string, extra http.Header) (monitoringHTTPResponse, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return monitoringHTTPResponse{}, fmt.Errorf("connector base URL is not allowed")
	}
	if parsed.User != nil {
		return monitoringHTTPResponse{}, fmt.Errorf("connector URL must not include credentials")
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 2 {
				return fmt.Errorf("too many redirects")
			}
			if req.URL.Host != parsed.Host {
				return fmt.Errorf("redirect host is not allowed")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return monitoringHTTPResponse{}, err
	}
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	for key, values := range extra {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return monitoringHTTPResponse{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return monitoringHTTPResponse{Status: res.StatusCode, Body: body}, nil
}

func validSecretRef(value string) bool {
	return secretRefPattern.MatchString(strings.TrimSpace(value))
}

func resolveSecretRef(ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", fmt.Errorf("connector has no credential reference")
	}
	if !validSecretRef(ref) {
		return "", fmt.Errorf("store a secret reference name, not the credential")
	}
	value := strings.TrimSpace(os.Getenv(ref))
	if value == "" {
		return "", fmt.Errorf("credential reference is empty")
	}
	return value, nil
}

func executeMonitorQuery(sourceType, query, secretRef string) (mappedSample, string, error) {
	return executeConnectorQuery(connectorQuery{SourceType: sourceType, Query: query, SecretRef: secretRef})
}

func executeConnectorQuery(item connectorQuery) (mappedSample, string, error) {
	source := strings.ToLower(strings.TrimSpace(item.SourceType))
	switch source {
	case sourceFixture:
		sample, err := parseFixtureSample(item.Query)
		return sample, "", err
	case sourcePrivate:
		sample, err := latestPrivateSample(item.ConnectorID, item.ServiceID, item.Environment)
		if err != nil {
			return mappedSample{}, measureQueryFailed, err
		}
		return sample, "", nil
	case sourceGrafana, sourcePrometheus, sourceSplunk, sourceDatadog:
		if strings.TrimSpace(item.SecretRef) == "" {
			return mappedSample{}, measureQueryFailed, fmt.Errorf("connector has no credential reference")
		}
		if _, err := resolveSecretRef(item.SecretRef); err != nil {
			return mappedSample{}, measureQueryFailed, err
		}
		if strings.TrimSpace(item.BaseURL) == "" {
			return mappedSample{}, measureQueryFailed, fmt.Errorf("connector has no base URL")
		}
		return queryLiveSource(item)
	default:
		return mappedSample{}, measureQueryFailed, fmt.Errorf("unsupported source type")
	}
}

func queryLiveSource(item connectorQuery) (mappedSample, string, error) {
	token, err := resolveSecretRef(item.SecretRef)
	if err != nil {
		return mappedSample{}, measureQueryFailed, err
	}
	base := strings.TrimRight(strings.TrimSpace(item.BaseURL), "/")
	source := strings.ToLower(strings.TrimSpace(item.SourceType))
	var rawURL, auth string
	extra := http.Header{}
	switch source {
	case sourceGrafana:
		uid := strings.TrimSpace(item.DatasourceUID)
		if uid == "" {
			return mappedSample{}, measureQueryFailed, fmt.Errorf("Grafana data source is required")
		}
		rawURL = base + "/api/datasources/proxy/uid/" + url.PathEscape(uid) + "/api/v1/query?query=" + url.QueryEscape(item.Query)
		auth = "Bearer " + token
	case sourcePrometheus:
		rawURL = base + "/api/v1/query?query=" + url.QueryEscape(item.Query)
		if token != "" {
			auth = "Bearer " + token
		}
	case sourceSplunk:
		rawURL = base + "/services/search/jobs/export?output_mode=json&search=" + url.QueryEscape("search "+strings.TrimSpace(item.Query))
		auth = "Bearer " + token
	case sourceDatadog:
		rawURL = base + "/api/v1/query?from=" + strconv.FormatInt(time.Now().Add(-5*time.Minute).Unix(), 10) + "&to=" + strconv.FormatInt(time.Now().Unix(), 10) + "&query=" + url.QueryEscape(item.Query)
		extra.Set("DD-API-KEY", token)
		if app := strings.TrimSpace(os.Getenv(item.SecretRef + "_APP")); app != "" {
			extra.Set("DD-APPLICATION-KEY", app)
		}
	default:
		return mappedSample{}, measureQueryFailed, fmt.Errorf("unsupported source type")
	}
	res, err := monitoringHTTPGet(rawURL, auth, extra)
	if err != nil {
		return mappedSample{}, measureQueryFailed, err
	}
	if res.Status >= 400 {
		return mappedSample{}, measureQueryFailed, fmt.Errorf("%s query failed (%d)", source, res.Status)
	}
	sample, err := parseSourceSample(source, res.Body, item.GoodField, item.TotalField)
	if err != nil {
		return mappedSample{}, measureQueryFailed, err
	}
	return sample, "", nil
}

func parseSourceSample(source string, body []byte, goodField, totalField string) (mappedSample, error) {
	if sample, err := parseFixtureSample(string(body)); err == nil && sample.Total > 0 {
		return sample, nil
	}
	switch source {
	case sourceGrafana, sourcePrometheus:
		return parsePrometheusInstantJSON(body, goodField, totalField)
	case sourceSplunk:
		return parseSplunkExportJSON(body, goodField, totalField)
	case sourceDatadog:
		return parseDatadogQueryJSON(body)
	default:
		return mappedSample{}, fmt.Errorf("unsupported source payload")
	}
}

func parsePrometheusInstantJSON(body []byte, goodField, totalField string) (mappedSample, error) {
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []any             `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return mappedSample{}, fmt.Errorf("Grafana/Prometheus result is not valid JSON")
	}
	if payload.Status != "" && payload.Status != "success" {
		return mappedSample{}, fmt.Errorf("source query status is %s", payload.Status)
	}
	if len(payload.Data.Result) == 0 {
		return mappedSample{}, fmt.Errorf("query returned no series")
	}
	goodField = strings.TrimSpace(goodField)
	totalField = strings.TrimSpace(totalField)
	var sample mappedSample
	if len(payload.Data.Result) == 1 {
		value, observed, err := prometheusValue(payload.Data.Result[0].Value)
		if err != nil {
			return mappedSample{}, err
		}
		sample.ObservedAt = observed
		if value >= 0 && value <= 1 {
			sample.Total = 10000
			sample.Good = int64(math.Round(value * 10000))
			sample.ProviderValue = value * 100
			return sample, nil
		}
		sample.Total = int64(math.Round(value))
		sample.Good = sample.Total
		return sample, nil
	}
	for _, row := range payload.Data.Result {
		value, observed, err := prometheusValue(row.Value)
		if err != nil {
			continue
		}
		if sample.ObservedAt == "" {
			sample.ObservedAt = observed
		}
		name := row.Metric["__name__"]
		if goodField != "" && (name == goodField || row.Metric[goodField] != "") {
			sample.Good = int64(math.Round(value))
		}
		if totalField != "" && (name == totalField || row.Metric[totalField] != "") {
			sample.Total = int64(math.Round(value))
		}
	}
	if sample.Total == 0 && sample.Good == 0 {
		return mappedSample{}, fmt.Errorf("could not map good and total fields from the result")
	}
	return sample, nil
}

func prometheusValue(raw []any) (float64, string, error) {
	if len(raw) < 2 {
		return 0, "", fmt.Errorf("series value is missing")
	}
	observed := ""
	switch ts := raw[0].(type) {
	case float64:
		observed = time.Unix(int64(ts), 0).UTC().Format(time.RFC3339)
	}
	text := fmt.Sprint(raw[1])
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return 0, "", fmt.Errorf("series value is not a number")
	}
	return value, observed, nil
}

func parseSplunkExportJSON(body []byte, goodField, totalField string) (mappedSample, error) {
	goodField = strings.TrimSpace(goodField)
	if goodField == "" {
		goodField = "good"
	}
	totalField = strings.TrimSpace(totalField)
	if totalField == "" {
		totalField = "total"
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	var last mappedSample
	found := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row struct {
			Result map[string]any `json:"result"`
		}
		if err := json.Unmarshal([]byte(line), &row); err != nil || row.Result == nil {
			var flat map[string]any
			if json.Unmarshal([]byte(line), &flat) != nil {
				continue
			}
			row.Result = flat
		}
		sample := mappedSample{
			Good:  int64(anyToFloat(row.Result[goodField])),
			Total: int64(anyToFloat(row.Result[totalField])),
		}
		last = sample
		found = true
	}
	if !found {
		return mappedSample{}, fmt.Errorf("Splunk result did not include mapped fields")
	}
	return last, nil
}

func parseDatadogQueryJSON(body []byte) (mappedSample, error) {
	var payload struct {
		Series []struct {
			Pointlist [][]float64 `json:"pointlist"`
		} `json:"series"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return mappedSample{}, fmt.Errorf("Datadog result is not valid JSON")
	}
	if len(payload.Series) == 0 || len(payload.Series[0].Pointlist) == 0 {
		return mappedSample{}, fmt.Errorf("Datadog query returned no points")
	}
	last := payload.Series[0].Pointlist[len(payload.Series[0].Pointlist)-1]
	if len(last) < 2 {
		return mappedSample{}, fmt.Errorf("Datadog point is incomplete")
	}
	value := last[1]
	sample := mappedSample{ProviderValue: value, ObservedAt: time.UnixMilli(int64(last[0])).UTC().Format(time.RFC3339)}
	if value >= 0 && value <= 1 {
		sample.Total = 10000
		sample.Good = int64(math.Round(value * 10000))
	} else if value <= 100 {
		sample.Total = 10000
		sample.Good = int64(math.Round(value * 100))
	}
	return sample, nil
}

func anyToFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		out, _ := typed.Float64()
		return out
	case string:
		out, _ := strconv.ParseFloat(typed, 64)
		return out
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return 0
	}
}

func computeProviderSLI(sample mappedSample, targetBPS, windowMinutes int) sliMeasurement {
	out := sliMeasurement{
		TargetBPS:        targetBPS,
		WindowMinutes:    windowMinutes,
		CalculationMode:  calcProvider,
		NumeratorLabel:   "source-provided compliance",
		DenominatorLabel: "source-provided window",
		ObservedAt:       sample.ObservedAt,
	}
	if sample.ProviderWindow > 0 {
		out.WindowMinutes = sample.ProviderWindow
	}
	value := sample.ProviderValue
	if value <= 0 && sample.Total > 0 {
		return computeAvailabilitySLI(sample, targetBPS, windowMinutes, 0, 0)
	}
	var bps int
	switch {
	case value <= 1:
		bps = int(math.Round(value * 10000))
	case value <= 100:
		bps = int(math.Round(value * 100))
	default:
		bps = int(math.Round(value))
	}
	out.AvailabilityBPS = bps
	out.Quality = qualityValid
	out.Reason = "Value was provided by the source and is not locally calculated."
	if targetBPS <= 0 || targetBPS >= 10000 {
		out.State = measureUnknown
		out.Quality = qualityInvalid
		out.Reason = "Provider target is missing or invalid."
		return out
	}
	if bps < targetBPS {
		out.State = measureBreached
	} else {
		out.State = measureHealthy
	}
	allowed := 10000 - targetBPS
	if allowed > 0 {
		consumed := float64(10000-bps) / float64(allowed)
		if consumed < 0 {
			consumed = 0
		}
		if consumed > 1 {
			consumed = 1
		}
		out.BudgetRemainBPS = int(math.Round((1 - consumed) * 10000))
	}
	return out
}

func computePercentileView(sample mappedSample, thresholdMS float64) sliMeasurement {
	out := sliMeasurement{
		State:            measureUnknown,
		Quality:          qualityValid,
		CalculationMode:  calcLocal,
		NumeratorLabel:   "percentile diagnostic",
		DenominatorLabel: "not an event count",
		ObservedAt:       sample.ObservedAt,
		Reason:           "Percentiles are diagnostic. They are not treated as event counts.",
	}
	if sample.LatencyMS <= 0 {
		out.Quality = qualityInvalid
		out.Reason = "No percentile value was returned."
		return out
	}
	out.AvailabilityBPS = int(math.Round(sample.LatencyMS))
	if thresholdMS > 0 && sample.LatencyMS > thresholdMS {
		out.State = measureBreached
		out.Reason = "Diagnostic percentile is above the configured threshold."
		return out
	}
	if thresholdMS > 0 {
		out.State = measureHealthy
		out.Reason = "Diagnostic percentile is within the configured threshold."
	}
	return out
}

func latestPrivateSample(connectorID, serviceID int, environment string) (mappedSample, error) {
	if DB == nil || connectorID <= 0 {
		return mappedSample{}, fmt.Errorf("no private sample has been ingested")
	}
	var good, total int64
	var latency float64
	var observed time.Time
	err := queryRowContext(`
		SELECT good_count, total_count, latency_ms, observed_at
		FROM monitor_private_samples
		WHERE connector_id = $1 AND ($2 = 0 OR service_id = $2) AND ($3 = '' OR LOWER(environment) = LOWER($3))
		ORDER BY observed_at DESC, id DESC
		LIMIT 1
	`, connectorID, serviceID, environment).Scan(&good, &total, &latency, &observed)
	if err != nil {
		return mappedSample{}, fmt.Errorf("no private sample has been ingested")
	}
	return mappedSample{Good: good, Total: total, LatencyMS: latency, ObservedAt: observed.UTC().Format(time.RFC3339)}, nil
}

func supportedMonitorSource(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case sourceGrafana, sourceSplunk, sourceFixture, sourcePrometheus, sourceDatadog, sourcePrivate:
		return true
	default:
		return false
	}
}
