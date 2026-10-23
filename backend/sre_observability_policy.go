package main

import (
	"strings"
	"time"
)

const monitoringWebhookMaxAge = 5 * time.Minute

func monitoringTimestampTooOld(signed, now time.Time) bool {
	if signed.IsZero() {
		return false
	}
	if signed.After(now.Add(time.Minute)) {
		return true
	}
	return now.Sub(signed) > monitoringWebhookMaxAge
}

func ignoreStaleAlert(lastAt, incomingAt time.Time) bool {
	if lastAt.IsZero() || incomingAt.IsZero() {
		return false
	}
	return incomingAt.Before(lastAt)
}

func canCloseLinkedIncident(otherFiring int) bool {
	return otherFiring <= 0
}

func nextAlertEpisodeSequence(lastStatus string, lastSeq int, incomingFiring bool) int {
	if lastSeq <= 0 {
		return 1
	}
	status := strings.ToLower(strings.TrimSpace(lastStatus))
	if incomingFiring && (status == "resolved" || status == "recovered") {
		return lastSeq + 1
	}
	return lastSeq
}

func artifactDecisionUsable(decisionSHA, requestSHA string, expires, now time.Time, outcome string) (bool, string) {
	if decisionSHA != "" && requestSHA != "" && !strings.EqualFold(decisionSHA, requestSHA) {
		return false, "Guardrail decision is bound to a different artifact."
	}
	if !expires.IsZero() && !now.Before(expires) {
		if strings.EqualFold(outcome, "overridden") {
			return false, "The override has expired."
		}
		return false, "The guardrail decision has expired."
	}
	return true, ""
}

func retryEvaluationAnchor(original time.Time, retry bool) time.Time {
	if retry && !original.IsZero() {
		return original.UTC()
	}
	return time.Time{}
}

func evaluatedThrough(anchor time.Time, delayMinutes int) time.Time {
	if delayMinutes <= 0 {
		return anchor
	}
	return anchor.Add(-time.Duration(delayMinutes) * time.Minute)
}

type policySimulation struct {
	Label            string `json:"label"`
	Samples          int    `json:"samples"`
	Critical         int    `json:"critical"`
	Warning          int    `json:"warning"`
	Unknown          int    `json:"unknown"`
	CoverageNote     string `json:"coverage_note"`
	Notifications    bool   `json:"notifications"`
	IncidentsCreated bool   `json:"incidents_created"`
}

func simulateFindingHistory(runs []sliMeasurement, warning, critical findingRule) policySimulation {
	out := policySimulation{
		Label:         "simulation",
		CoverageNote:  "Simulated results are labelled and do not page or open incidents.",
		Notifications: false,
	}
	if len(runs) == 0 {
		out.CoverageNote = "Absent history is not a clean pass."
		out.Unknown = 1
		return out
	}
	for _, run := range runs {
		out.Samples++
		if run.State == measureUnknown || run.State == measureQueryFailed || run.State == measureNoTraffic || run.Quality == qualityInvalid {
			out.Unknown++
			continue
		}
		metric := float64(run.BudgetRemainBPS) / 100
		severity, _, _ := evaluateFindingRules(run.State, metric, warning, critical)
		switch severity {
		case findingCritical:
			out.Critical++
		case findingWarning:
			out.Warning++
		}
	}
	return out
}

func sampleRulePreviews(warning, critical findingRule) map[string]string {
	healthy := warning.Threshold + 5
	if strings.EqualFold(warning.Comparator, "above") || strings.EqualFold(warning.Comparator, ">") {
		healthy = warning.Threshold - 5
	}
	return map[string]string{
		"missing_data": "unknown",
		"healthy":      previewFindingOutcome(healthy, warning, critical),
		"warning":      previewFindingOutcome(warning.Threshold-0.01, warning, critical),
		"critical":     previewFindingOutcome(critical.Threshold-0.01, warning, critical),
	}
}
