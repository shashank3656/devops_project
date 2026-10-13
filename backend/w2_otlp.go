package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func pullTempoServiceMetrics(service, environment string) *serviceMetrics {
	base := strings.TrimRight(os.Getenv("GRAFANA_TEMPO_URL"), "/")
	if base == "" || strings.TrimSpace(service) == "" {
		return nil
	}
	endpoint := base + "/api/metrics?service=" + strings.ReplaceAll(service, " ", "%20")
	if environment != "" && environment != "unspecified" {
		endpoint += "&environment=" + strings.ReplaceAll(environment, " ", "%20")
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return nil
	}
	metrics := parseOTLPMetrics(body)
	if len(metrics) == 0 {
		return nil
	}
	sample := normalizeServiceMetrics(&metrics[0].Sample)
	if sample != nil {
		sample.Source = "tempo"
	}
	return sample
}

func upsertLatestServiceMetrics(service, environment string, sample serviceMetrics) {
	if DB == nil {
		return
	}
	service = strings.TrimSpace(service)
	if service == "" {
		return
	}
	normalized := normalizeServiceMetrics(&sample)
	if normalized == nil || !metricsHasSignal(*normalized) {
		return
	}
	env := normalizeChangeEnvironment(environment)
	_, _ = execContext(`
		INSERT INTO service_metric_latest (service, environment, p95_ms, error_ratio, saturation, source, taken_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
		ON CONFLICT (LOWER(service), LOWER(environment))
		DO UPDATE SET p95_ms = EXCLUDED.p95_ms, error_ratio = EXCLUDED.error_ratio, saturation = EXCLUDED.saturation,
		              source = EXCLUDED.source, taken_at = EXCLUDED.taken_at, updated_at = CURRENT_TIMESTAMP
	`, service, env, normalized.P95Ms, normalized.ErrorRatio, normalized.Saturation, firstNonEmpty(normalized.Source, "otlp"), normalized.TakenAt)
}

func latestServiceMetrics(service, environment string) *serviceMetrics {
	if DB == nil {
		return nil
	}
	service = strings.TrimSpace(service)
	if service == "" {
		return nil
	}
	var item serviceMetrics
	var taken time.Time
	err := queryRowContext(`
		SELECT p95_ms, error_ratio, saturation, COALESCE(source,''), taken_at
		FROM service_metric_latest
		WHERE LOWER(service) = LOWER($1) AND LOWER(environment) = LOWER($2)
	`, service, normalizeChangeEnvironment(environment)).Scan(&item.P95Ms, &item.ErrorRatio, &item.Saturation, &item.Source, &taken)
	if err != nil {
		err = queryRowContext(`
			SELECT p95_ms, error_ratio, saturation, COALESCE(source,''), taken_at
			FROM service_metric_latest
			WHERE LOWER(service) = LOWER($1)
			ORDER BY taken_at DESC
			LIMIT 1
		`, service).Scan(&item.P95Ms, &item.ErrorRatio, &item.Saturation, &item.Source, &taken)
	}
	if err != nil {
		return nil
	}
	item.TakenAt = taken
	return normalizeServiceMetrics(&item)
}

func applyServiceMetricsToWatchingChanges(service, environment string, sample serviceMetrics, projectID int) int {
	applied := 0
	now := time.Now()
	watching, err := listWatchingChanges(projectID, "", now)
	if err != nil {
		return 0
	}
	for _, item := range watching {
		if service != "" && item.Service != "" && !strings.EqualFold(item.Service, service) {
			continue
		}
		if environment != "" && environment != "unspecified" && item.Environment != "" && item.Environment != "unspecified" && !strings.EqualFold(item.Environment, environment) {
			continue
		}
		if _, _, err := applyWatchSample(item, sample); err == nil {
			applied++
		}
	}
	return applied
}

func parseOTLPMetrics(body []byte) []parsedOTLPMetric {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}
	if p95 := floatFromAny(raw["p95_ms"]); p95 > 0 || floatFromAny(raw["error_ratio"]) > 0 {
		return []parsedOTLPMetric{{
			Service:     firstNonEmpty(stringFromAny(raw["service"]), stringFromAny(raw["service.name"])),
			Environment: firstNonEmpty(stringFromAny(raw["environment"]), stringFromAny(raw["deployment.environment"])),
			Sample: serviceMetrics{
				P95Ms:      p95,
				ErrorRatio: floatFromAny(raw["error_ratio"]),
				Saturation: floatFromAny(raw["saturation"]),
				Source:     firstNonEmpty(stringFromAny(raw["source"]), "otlp"),
			},
		}}
	}
	out := []parsedOTLPMetric{}
	resources, _ := raw["resourceMetrics"].([]interface{})
	for _, resourceAny := range resources {
		resource, _ := resourceAny.(map[string]interface{})
		if resource == nil {
			continue
		}
		service, env := otlpResourceIdentity(resource)
		scopes, _ := resource["scopeMetrics"].([]interface{})
		sample := serviceMetrics{Source: "otlp"}
		for _, scopeAny := range scopes {
			scope, _ := scopeAny.(map[string]interface{})
			if scope == nil {
				continue
			}
			metrics, _ := scope["metrics"].([]interface{})
			for _, metricAny := range metrics {
				metric, _ := metricAny.(map[string]interface{})
				if metric == nil {
					continue
				}
				name := strings.ToLower(stringFromAny(metric["name"]))
				value := otlpMetricValue(metric)
				switch {
				case strings.Contains(name, "duration") || strings.Contains(name, "latency") || strings.Contains(name, "p95"):
					if value > 0 && (sample.P95Ms == 0 || value > sample.P95Ms) {
						sample.P95Ms = value
					}
				case strings.Contains(name, "error"):
					sample.ErrorRatio = value
				case strings.Contains(name, "saturation") || strings.Contains(name, "cpu") || strings.Contains(name, "util"):
					sample.Saturation = value
				}
			}
		}
		if metricsHasSignal(sample) {
			out = append(out, parsedOTLPMetric{Service: service, Environment: env, Sample: sample})
		}
	}
	return out
}

type parsedOTLPMetric struct {
	Service     string
	Environment string
	Sample      serviceMetrics
}

func otlpResourceIdentity(resource map[string]interface{}) (string, string) {
	res, _ := resource["resource"].(map[string]interface{})
	attrs, _ := res["attributes"].([]interface{})
	service := ""
	env := ""
	for _, attrAny := range attrs {
		attr, _ := attrAny.(map[string]interface{})
		if attr == nil {
			continue
		}
		key := stringFromAny(attr["key"])
		value := otlpAttrValue(attr["value"])
		switch key {
		case "service.name":
			service = value
		case "deployment.environment", "deployment.environment.name":
			env = value
		}
	}
	return service, env
}

func otlpAttrValue(value any) string {
	raw, _ := value.(map[string]interface{})
	if raw == nil {
		return stringFromAny(value)
	}
	return firstNonEmpty(stringFromAny(raw["stringValue"]), stringFromAny(raw["string_value"]))
}

func otlpMetricValue(metric map[string]interface{}) float64 {
	for _, key := range []string{"gauge", "sum", "histogram"} {
		block, _ := metric[key].(map[string]interface{})
		if block == nil {
			continue
		}
		points, _ := block["dataPoints"].([]interface{})
		if len(points) == 0 {
			points, _ = block["data_points"].([]interface{})
		}
		if len(points) == 0 {
			continue
		}
		point, _ := points[len(points)-1].(map[string]interface{})
		if point == nil {
			continue
		}
		if p95 := floatFromAny(point["p95"]); p95 > 0 {
			return p95
		}
		if asDouble := floatFromAny(point["asDouble"]); asDouble != 0 {
			return asDouble
		}
		if asInt := floatFromAny(point["asInt"]); asInt != 0 {
			return asInt
		}
		quantiles, _ := point["quantileValues"].([]interface{})
		for _, qAny := range quantiles {
			q, _ := qAny.(map[string]interface{})
			if q == nil {
				continue
			}
			if floatFromAny(q["quantile"]) >= 0.95 {
				return floatFromAny(q["value"])
			}
		}
	}
	return 0
}

func otlpMetricsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	changeConnection, changeOK := matchedInboundConnection(inboundKindChange, r.Header, body)
	alertConnection, alertOK := matchedInboundConnection(inboundKindAlert, r.Header, body)
	if !changeOK && !alertOK {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	if changeConnection.Bound && alertConnection.Bound && changeConnection.ProjectID != alertConnection.ProjectID {
		writeAPIError(w, r, http.StatusForbidden, "worker cannot leave its connection project", nil)
		return
	}
	connection := workerConnection{}
	if changeConnection.Bound {
		connection = changeConnection
	} else if alertConnection.Bound {
		connection = alertConnection
	}
	metrics := parseOTLPMetrics(body)
	if len(metrics) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "no otlp metrics recognized", nil)
		return
	}
	projectFilter := 0
	if connection.Bound {
		projectFilter = connection.ProjectID
	}
	applied := 0
	for _, item := range metrics {
		item.Sample.Source = firstNonEmpty(item.Sample.Source, "otlp")
		if !connection.Bound {
			upsertLatestServiceMetrics(item.Service, item.Environment, item.Sample)
		}
		applied += applyServiceMetricsToWatchingChanges(item.Service, item.Environment, item.Sample, projectFilter)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"metrics": len(metrics),
		"applied": applied,
	})
}
