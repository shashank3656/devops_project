package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

type serviceMetrics struct {
	P95Ms      float64   `json:"p95_ms"`
	ErrorRatio float64   `json:"error_ratio"`
	Saturation float64   `json:"saturation"`
	Source     string    `json:"source,omitempty"`
	TakenAt    time.Time `json:"taken_at,omitempty"`
}

type watchDecision struct {
	OpenRegression bool
	Reasons        []string
	CloseChange    bool
	FailChange     bool
}

func normalizeRatio(value float64) float64 {
	if value > 1 {
		return value / 100
	}
	if value < 0 {
		return 0
	}
	return value
}

func normalizeServiceMetrics(item *serviceMetrics) *serviceMetrics {
	if item == nil {
		return nil
	}
	copy := *item
	copy.ErrorRatio = normalizeRatio(copy.ErrorRatio)
	copy.Saturation = normalizeRatio(copy.Saturation)
	if copy.P95Ms < 0 {
		copy.P95Ms = 0
	}
	if copy.Source == "" {
		copy.Source = "webhook"
	}
	if copy.TakenAt.IsZero() {
		copy.TakenAt = time.Now().UTC()
	}
	return &copy
}

func metricsHasSignal(item serviceMetrics) bool {
	return item.P95Ms > 0 || item.ErrorRatio > 0 || item.Saturation > 0
}

func encodeServiceMetrics(item *serviceMetrics) string {
	if item == nil || !metricsHasSignal(*item) {
		return ""
	}
	body, err := json.Marshal(item)
	if err != nil {
		return ""
	}
	return string(body)
}

func decodeServiceMetrics(raw string) *serviceMetrics {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" {
		return nil
	}
	var item serviceMetrics
	if err := json.Unmarshal([]byte(trimmed), &item); err != nil {
		return nil
	}
	return normalizeServiceMetrics(&item)
}

func watchRemainingMinutes(item changeRequestRecord, now time.Time) int {
	if item.WatchUntil != nil {
		remaining := int(math.Ceil(item.WatchUntil.Sub(now).Minutes()))
		if remaining < 0 {
			return 0
		}
		return remaining
	}
	minutes := item.WatchMinutes
	if minutes <= 0 {
		minutes = 120
	}
	elapsed := int(now.Sub(item.CreatedAt).Minutes())
	remaining := minutes - elapsed
	if remaining < 0 {
		return 0
	}
	return remaining
}

func changeRollbackHint(item changeRequestRecord) string {
	previous := strings.TrimSpace(item.PreviousSHA)
	if previous == "" {
		return ""
	}
	target := firstNonEmpty(item.Service, item.Repo)
	if target == "" {
		return "Roll back to " + previous
	}
	return fmt.Sprintf("Roll back %s to %s", target, previous)
}

func detectWatchBreaches(baseline *serviceMetrics, current serviceMetrics, slo *serviceSLO) []string {
	currentNorm := normalizeServiceMetrics(&current)
	if currentNorm == nil || !metricsHasSignal(*currentNorm) {
		return nil
	}
	reasons := []string{}
	if baseline != nil && metricsHasSignal(*baseline) {
		p95Ceiling := baseline.P95Ms + math.Max(baseline.P95Ms*0.20, 100)
		if currentNorm.P95Ms > p95Ceiling && exceedsAbsoluteSLO(currentNorm.P95Ms, sloLatency(slo)) {
			reasons = append(reasons, fmt.Sprintf("p95 %.0fms vs baseline %.0fms", currentNorm.P95Ms, baseline.P95Ms))
		}
		errorCeiling := baseline.ErrorRatio + 0.01
		if baseline.ErrorRatio > 0 && baseline.ErrorRatio*2 > errorCeiling {
			errorCeiling = baseline.ErrorRatio * 2
		}
		if currentNorm.ErrorRatio > errorCeiling && exceedsAbsoluteSLO(currentNorm.ErrorRatio, sloError(slo)) {
			reasons = append(reasons, fmt.Sprintf("error ratio %.3f vs baseline %.3f", currentNorm.ErrorRatio, baseline.ErrorRatio))
		}
		if currentNorm.Saturation > baseline.Saturation+0.30 && exceedsAbsoluteSLO(currentNorm.Saturation, sloSaturation(slo)) {
			reasons = append(reasons, fmt.Sprintf("saturation %.2f vs baseline %.2f", currentNorm.Saturation, baseline.Saturation))
		}
	}
	return reasons
}

func exceedsAbsoluteSLO(value, limit float64) bool {
	if limit <= 0 {
		return true
	}
	return value > limit
}

func sloLatency(slo *serviceSLO) float64 {
	if slo == nil {
		return 0
	}
	return slo.LatencyP95Ms
}

func sloError(slo *serviceSLO) float64 {
	if slo == nil {
		return 0
	}
	return slo.ErrorRatio
}

func sloSaturation(slo *serviceSLO) float64 {
	if slo == nil {
		return 0
	}
	return slo.Saturation
}

func decideWatchOutcome(item changeRequestRecord, baseline *serviceMetrics, latest *serviceMetrics, now time.Time, hasOpenRegression bool, slo *serviceSLO) watchDecision {
	decision := watchDecision{}
	inWindow := changeIsInWatchWindow(item, now)
	if !inWindow {
		if hasOpenRegression {
			decision.FailChange = true
		} else {
			decision.CloseChange = true
		}
		return decision
	}
	if latest == nil || baseline == nil {
		return decision
	}
	decision.Reasons = detectWatchBreaches(baseline, *latest, slo)
	decision.OpenRegression = len(decision.Reasons) > 0
	return decision
}

func recordWatchSample(changeID int, sample serviceMetrics, asBaseline bool) error {
	if DB == nil || changeID <= 0 {
		return fmt.Errorf("database not available")
	}
	normalized := normalizeServiceMetrics(&sample)
	if normalized == nil {
		return fmt.Errorf("metrics are empty")
	}
	if _, err := execContext(`
		INSERT INTO change_watch_samples (change_id, taken_at, p95_ms, error_ratio, saturation, source)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, changeID, normalized.TakenAt, normalized.P95Ms, normalized.ErrorRatio, normalized.Saturation, normalized.Source); err != nil {
		if !strings.Contains(err.Error(), "does not exist") {
			return err
		}
	}
	latestJSON := encodeServiceMetrics(normalized)
	if asBaseline {
		_, err := execContext(`
			UPDATE change_requests
			SET baseline_json = CASE WHEN COALESCE(baseline_json,'') = '' THEN $2 ELSE baseline_json END,
			    latest_metrics_json = $2,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, changeID, latestJSON)
		return err
	}
	_, err := execContext(`
		UPDATE change_requests
		SET latest_metrics_json = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, changeID, latestJSON)
	return err
}

func setChangeStatus(id int, status string) error {
	if DB == nil || id <= 0 {
		return fmt.Errorf("database not available")
	}
	_, err := execContext(`
		UPDATE change_requests
		SET status = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status)
	return err
}

func changeHasBlockingIncidents(changeID int) bool {
	for _, item := range listIncidentsForChange(changeID) {
		if incidentIsActive(item.Status) {
			return true
		}
	}
	return false
}

func validateChangeTransition(current, next string, blockingIncidents bool) (string, error) {
	current = normalizeChangeStatus(current)
	want := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(next), " ", "_"))
	if want == "reopen" || want == "open" {
		want = "implementing"
	} else {
		want = normalizeChangeStatus(next)
	}
	if want == current {
		return want, nil
	}
	if blockingIncidents && (want == "resolved" || want == "closed") {
		return "", fmt.Errorf("resolve or close linked incidents first")
	}
	if changeIsFinished(current) {
		if current == "resolved" && (want == "closed" || want == "failed" || want == "cancelled") {
			return want, nil
		}
		if want == "implementing" || want == "new" || want == "scheduled" || want == "monitoring" {
			return "implementing", nil
		}
		return "", fmt.Errorf("reopen this change before moving it to %s", want)
	}
	if current == "new" && want != "scheduled" && want != "cancelled" && want != "failed" && changeStatusRank(want) > changeStatusRank("scheduled") {
		if itemNeedsScheduleGate(current, want) {
			return "", fmt.Errorf("schedule the change before moving to %s", want)
		}
	}
	if current == "scheduled" && want == "new" {
		return "", fmt.Errorf("cannot move a scheduled change back to new")
	}
	return want, nil
}

func itemNeedsScheduleGate(current, want string) bool {
	_ = current
	switch want {
	case "implementing", "implemented", "monitoring", "resolved", "closed":
		return true
	default:
		return false
	}
}

func transitionChangeStatus(id int, next string) (*changeRequestRecord, error) {
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	want, err := validateChangeTransition(item.Status, next, changeHasBlockingIncidents(id))
	if err != nil {
		return nil, err
	}
	if want == normalizeChangeStatus(item.Status) {
		return item, nil
	}
	if err := setChangeStatus(id, want); err != nil {
		return nil, err
	}
	item, err = getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	go FireOutboundWebhooks("change.updated", map[string]interface{}{
		"change_id":     item.ID,
		"change_number": item.ChangeNumber,
		"status":        item.Status,
	})
	if strings.EqualFold(item.Status, "resolved") {
		fireWatchEndedDigest(*item)
	}
	return item, nil
}

func resolveChangeRequest(id int) (*changeRequestRecord, error) {
	return transitionChangeStatus(id, "resolved")
}

func closeChangeRequest(id int) (*changeRequestRecord, error) {
	return transitionChangeStatus(id, "closed")
}

func listWatchSamples(changeID int, since time.Time) ([]serviceMetrics, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT taken_at, p95_ms, error_ratio, saturation, COALESCE(source,'')
		FROM change_watch_samples
		WHERE change_id = $1 AND taken_at >= $2
		ORDER BY taken_at DESC
		LIMIT 500
	`, changeID, since)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceMetrics{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []serviceMetrics{}
	for rows.Next() {
		var item serviceMetrics
		if err := rows.Scan(&item.TakenAt, &item.P95Ms, &item.ErrorRatio, &item.Saturation, &item.Source); err != nil {
			return nil, err
		}
		out = append(out, *normalizeServiceMetrics(&item))
	}
	return out, nil
}

func listWatchSamplesForService(service, environment string, since time.Time) ([]serviceMetrics, error) {
	if DB == nil {
		return []serviceMetrics{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT s.taken_at, s.p95_ms, s.error_ratio, s.saturation, COALESCE(s.source,'')
		FROM change_watch_samples s
		JOIN change_requests c ON c.id = s.change_id
		WHERE LOWER(c.service) = LOWER($1)
		  AND ($2 = '' OR LOWER(c.environment) = LOWER($2))
		  AND s.taken_at >= $3
		ORDER BY s.taken_at DESC
		LIMIT 1000
	`, service, environment, since)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceMetrics{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []serviceMetrics{}
	for rows.Next() {
		var item serviceMetrics
		if err := rows.Scan(&item.TakenAt, &item.P95Ms, &item.ErrorRatio, &item.Saturation, &item.Source); err != nil {
			return nil, err
		}
		out = append(out, *normalizeServiceMetrics(&item))
	}
	return out, nil
}
