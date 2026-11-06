package main

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type deploymentVerificationCheck struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	State  string `json:"state"`
	Detail string `json:"detail"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

type deploymentVerification struct {
	State       string                        `json:"state"`
	Label       string                        `json:"label"`
	Note        string                        `json:"note"`
	Environment string                        `json:"environment,omitempty"`
	SHA         string                        `json:"sha,omitempty"`
	EvaluatedAt string                        `json:"evaluated_at"`
	Reasons     []string                      `json:"reasons,omitempty"`
	Checks      []deploymentVerificationCheck `json:"checks"`
}

type availabilitySample struct {
	BPS        int
	Quality    string
	State      string
	Coverage   int
	ObservedAt time.Time
}

const deploymentVerificationNote = "Deployment verification compares recorded before and after telemetry. Missing samples stay Inconclusive, never Healthy. This is not deployment authorization."

var lookupChangeAvailability = lookupChangeAvailabilityFromDB

func buildChangeDeploymentVerification(item changeRequestRecord) *deploymentVerification {
	return assembleDeploymentVerification(item, true)
}

func buildListedDeploymentVerification(item changeRequestRecord) *deploymentVerification {
	return assembleDeploymentVerification(item, false)
}

func assembleDeploymentVerification(item changeRequestRecord, lookupAvailability bool) *deploymentVerification {
	now := time.Now().UTC()
	env := strings.TrimSpace(item.Environment)
	if env == "" || strings.EqualFold(env, "unspecified") {
		env = "Unknown"
	}
	checks := []deploymentVerificationCheck{
		latencyVerificationCheck(item.Baseline, item.LatestMetrics),
		errorVerificationCheck(item.Baseline, item.LatestMetrics),
	}
	if lookupAvailability {
		checks = append(checks, availabilityVerificationCheck(item))
	} else {
		checks = append(checks, deploymentVerificationCheck{
			Key:    "availability",
			Label:  "Availability",
			State:  "unavailable",
			Detail: "Availability is evaluated on deployment details. Incomplete telemetry stays Inconclusive, never Healthy.",
		})
	}
	if !changeCanHaveDeployVerification(item) {
		for i := range checks {
			if checks[i].State == "passed" {
				checks[i].State = "unavailable"
				checks[i].Detail = "A deployment has not been observed yet. Verification stays Inconclusive."
			}
		}
	}
	state, label, reasons := overallDeploymentVerification(checks)
	return &deploymentVerification{
		State:       state,
		Label:       label,
		Note:        deploymentVerificationNote,
		Environment: env,
		SHA:         strings.TrimSpace(item.SHA),
		EvaluatedAt: now.Format(time.RFC3339),
		Reasons:     reasons,
		Checks:      checks,
	}
}

func changeCanHaveDeployVerification(item changeRequestRecord) bool {
	switch normalizeChangeStatus(item.Status) {
	case "implementing", "implemented", "monitoring", "resolved", "closed", "failed":
		return true
	default:
		return false
	}
}

func latencyVerificationCheck(baseline, latest *serviceMetrics) deploymentVerificationCheck {
	check := deploymentVerificationCheck{Key: "latency", Label: "Latency (p95)"}
	if baseline == nil || !metricsHasSignal(*baseline) || latest == nil || !metricsHasSignal(*latest) {
		check.State = "unavailable"
		check.Detail = "Before and after latency samples are missing. Incomplete telemetry stays Inconclusive, never Healthy."
		return check
	}
	check.Before = formatLatencyMs(baseline.P95Ms)
	check.After = formatLatencyMs(latest.P95Ms)
	ceiling := baseline.P95Ms + math.Max(baseline.P95Ms*0.20, 100)
	if latest.P95Ms > ceiling {
		check.State = "degraded"
		check.Detail = fmt.Sprintf("p95 rose from %s to %s versus the baseline ceiling of %s.", check.Before, check.After, formatLatencyMs(ceiling))
		return check
	}
	check.State = "passed"
	check.Detail = fmt.Sprintf("p95 stayed within the baseline ceiling of %s.", formatLatencyMs(ceiling))
	return check
}

func errorVerificationCheck(baseline, latest *serviceMetrics) deploymentVerificationCheck {
	check := deploymentVerificationCheck{Key: "errors", Label: "Error ratio"}
	if baseline == nil || !metricsHasSignal(*baseline) || latest == nil || !metricsHasSignal(*latest) {
		check.State = "unavailable"
		check.Detail = "Before and after error-ratio samples are missing. Incomplete telemetry stays Inconclusive, never Healthy."
		return check
	}
	check.Before = formatErrorRatio(baseline.ErrorRatio)
	check.After = formatErrorRatio(latest.ErrorRatio)
	ceiling := baseline.ErrorRatio + 0.01
	if baseline.ErrorRatio > 0 && baseline.ErrorRatio*2 > ceiling {
		ceiling = baseline.ErrorRatio * 2
	}
	if latest.ErrorRatio > ceiling {
		check.State = "degraded"
		check.Detail = fmt.Sprintf("Error ratio rose from %s to %s versus the baseline ceiling of %s.", check.Before, check.After, formatErrorRatio(ceiling))
		return check
	}
	check.State = "passed"
	check.Detail = fmt.Sprintf("Error ratio stayed within the baseline ceiling of %s.", formatErrorRatio(ceiling))
	return check
}

func availabilityVerificationCheck(item changeRequestRecord) deploymentVerificationCheck {
	check := deploymentVerificationCheck{Key: "availability", Label: "Availability"}
	beforeAt := item.CreatedAt
	if item.WatchStartedAt != nil && !item.WatchStartedAt.IsZero() {
		beforeAt = *item.WatchStartedAt
	}
	afterAt := item.UpdatedAt
	if afterAt.IsZero() {
		afterAt = time.Now().UTC()
	}
	before, after := lookupChangeAvailability(item, beforeAt, afterAt)
	if before == nil || after == nil {
		check.State = "unavailable"
		check.Detail = "Before and after availability samples were not recorded for this change. Incomplete telemetry stays Inconclusive, never Healthy."
		return check
	}
	if !availabilitySampleUsable(*before) || !availabilitySampleUsable(*after) {
		check.State = "unavailable"
		check.Detail = "Availability quality is invalid, stale, or uncovered. Incomplete telemetry stays Inconclusive, never Healthy."
		if after != nil {
			check.After = formatAvailabilityBPS(after.BPS)
		}
		if before != nil {
			check.Before = formatAvailabilityBPS(before.BPS)
		}
		return check
	}
	check.Before = formatAvailabilityBPS(before.BPS)
	check.After = formatAvailabilityBPS(after.BPS)
	if strings.EqualFold(after.State, measureBreached) && !strings.EqualFold(before.State, measureBreached) {
		check.State = "degraded"
		check.Detail = fmt.Sprintf("Availability moved to breached after the change (%s → %s).", check.Before, check.After)
		return check
	}
	if after.BPS+50 < before.BPS {
		check.State = "degraded"
		check.Detail = fmt.Sprintf("Availability fell from %s to %s.", check.Before, check.After)
		return check
	}
	check.State = "passed"
	check.Detail = fmt.Sprintf("Availability stayed comparable (%s → %s).", check.Before, check.After)
	return check
}

func availabilitySampleUsable(sample availabilitySample) bool {
	quality := strings.ToLower(strings.TrimSpace(sample.Quality))
	state := strings.ToLower(strings.TrimSpace(sample.State))
	if quality == qualityInvalid || state == measureQueryFailed || state == measureStale || state == measureUnknown || state == measureDisabled {
		return false
	}
	if sample.BPS <= 0 && sample.Coverage <= 0 {
		return false
	}
	return true
}

func overallDeploymentVerification(checks []deploymentVerificationCheck) (state, label string, reasons []string) {
	degraded := false
	complete := true
	for _, check := range checks {
		switch strings.ToLower(strings.TrimSpace(check.State)) {
		case "degraded", "failed":
			degraded = true
			reasons = append(reasons, check.Label+": "+check.Detail)
		case "passed":
		default:
			complete = false
			reasons = append(reasons, check.Label+": "+check.Detail)
		}
	}
	if degraded {
		return "degraded", "Degraded", reasons
	}
	if !complete {
		return "inconclusive", "Inconclusive", reasons
	}
	return "healthy", "Healthy", nil
}

func formatLatencyMs(value float64) string {
	return fmt.Sprintf("%.0f ms", value)
}

func formatErrorRatio(value float64) string {
	return fmt.Sprintf("%.3f", value)
}

func formatAvailabilityBPS(bps int) string {
	return fmt.Sprintf("%.2f%%", float64(bps)/100.0)
}

func lookupChangeAvailabilityFromDB(item changeRequestRecord, beforeAt, afterAt time.Time) (*availabilitySample, *availabilitySample) {
	if DB == nil || strings.TrimSpace(item.Service) == "" {
		return nil, nil
	}
	service := strings.ToLower(strings.TrimSpace(item.Service))
	environment := strings.ToLower(strings.TrimSpace(item.Environment))
	before := availabilitySampleNear(service, environment, beforeAt, true)
	after := availabilitySampleNear(service, environment, afterAt, false)
	return before, after
}

func availabilitySampleNear(service, environment string, at time.Time, before bool) *availabilitySample {
	if DB == nil || service == "" || at.IsZero() {
		return nil
	}
	cmp := "<="
	order := "DESC"
	if !before {
		cmp = ">="
		order = "ASC"
	}
	var sample availabilitySample
	var observed time.Time
	query := `
		SELECT COALESCE(r.availability_bps,0), COALESCE(r.quality,''), COALESCE(r.state,''), COALESCE(r.coverage_bps,0),
		       COALESCE(r.observed_at, r.evaluated_at, r.created_at)
		FROM monitor_evaluation_runs r
		JOIN service_monitors m ON m.id = r.monitor_id
		JOIN service_map s ON s.id = m.service_id
		WHERE LOWER(s.service) = $1
		  AND m.measurement_type = $2
		  AND ($3 = '' OR s.environment = '' OR LOWER(s.environment) = $3)
		  AND COALESCE(r.observed_at, r.evaluated_at, r.created_at) ` + cmp + ` $4
		ORDER BY COALESCE(r.observed_at, r.evaluated_at, r.created_at) ` + order + `, r.id ` + order + `
		LIMIT 1`
	err := queryRowContext(query, service, measureAvailability, environment, at.UTC()).Scan(&sample.BPS, &sample.Quality, &sample.State, &sample.Coverage, &observed)
	if err != nil {
		if !before {
			if latest := availabilityLatestSample(service, environment); latest != nil && !latest.ObservedAt.Before(at.UTC()) {
				return latest
			}
		}
		return nil
	}
	sample.ObservedAt = observed.UTC()
	return &sample
}

func availabilityLatestSample(service, environment string) *availabilitySample {
	if DB == nil || service == "" {
		return nil
	}
	var sample availabilitySample
	var observed time.Time
	err := queryRowContext(`
		SELECT COALESCE(r.availability_bps,0), COALESCE(r.quality,''), COALESCE(r.state,''), COALESCE(r.coverage_bps,0),
		       COALESCE(r.observed_at, r.evaluated_at, r.created_at)
		FROM monitor_evaluation_runs r
		JOIN service_monitors m ON m.id = r.monitor_id
		JOIN service_map s ON s.id = m.service_id
		WHERE LOWER(s.service) = $1
		  AND m.measurement_type = $2
		  AND ($3 = '' OR s.environment = '' OR LOWER(s.environment) = $3)
		ORDER BY COALESCE(r.observed_at, r.evaluated_at, r.created_at) DESC, r.id DESC
		LIMIT 1
	`, service, measureAvailability, environment).Scan(&sample.BPS, &sample.Quality, &sample.State, &sample.Coverage, &observed)
	if err != nil {
		return nil
	}
	sample.ObservedAt = observed.UTC()
	return &sample
}
