package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func startChangeWatcherScheduler() {
	go func() {
		time.Sleep(15 * time.Second)
		runChangeWatchCycle()
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			runChangeWatchCycle()
		}
	}()
}

func runChangeWatchCycle() {
	if DB == nil {
		return
	}
	now := time.Now()
	watching, err := listWatchingChanges(0, "", now)
	if err != nil {
		log.Printf("[Change Watcher] list failed: %v", err)
		return
	}
	expired, err := listExpiredWatchChanges(now)
	if err != nil {
		log.Printf("[Change Watcher] expired list failed: %v", err)
	}
	seen := map[int]struct{}{}
	for _, item := range append(watching, expired...) {
		if _, ok := seen[item.ID]; ok {
			continue
		}
		seen[item.ID] = struct{}{}
		if err := evaluateChangeWatch(item, now); err != nil {
			log.Printf("[Change Watcher] change=%s err=%v", item.ChangeNumber, err)
		}
	}
}

func listExpiredWatchChanges(now time.Time) ([]changeRequestRecord, error) {
	items, err := listChangeRequests(0, "", "", "")
	if err != nil {
		return nil, err
	}
	out := []changeRequestRecord{}
	for _, item := range items {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status != "implemented" && status != "monitoring" {
			continue
		}
		if !changeIsInWatchWindow(item, now) {
			out = append(out, item)
		}
	}
	return out, nil
}

func pullMappedServiceMetrics(service, repo, environment string) *serviceMetrics {
	mapped := lookupServiceMap(service, repo, environment)
	if mapped == nil || strings.TrimSpace(mapped.MetricsURL) == "" {
		return nil
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(strings.TrimSpace(mapped.MetricsURL))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil
	}
	var raw map[string]interface{}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&raw); err != nil {
		return nil
	}
	sample := normalizeServiceMetrics(&serviceMetrics{
		P95Ms:      floatFromAny(raw["p95_ms"]),
		ErrorRatio: floatFromAny(raw["error_ratio"]),
		Saturation: floatFromAny(raw["saturation"]),
		Source:     "service_map",
	})
	if sample == nil || !metricsHasSignal(*sample) {
		return nil
	}
	return sample
}

func evaluateChangeWatch(item changeRequestRecord, now time.Time) error {
	stale := item.LatestMetrics == nil || item.LatestMetrics.TakenAt.IsZero() || now.Sub(item.LatestMetrics.TakenAt) > 3*time.Minute
	if stale {
		if sample := pullMappedServiceMetrics(item.Service, item.Repo, item.Environment); sample != nil {
			_, _, _ = applyWatchSample(item, *sample)
			if refreshed, err := getChangeRequestByID(item.ID); err == nil && refreshed != nil {
				item = *refreshed
			}
		}
	}
	slo := findServiceSLO(item.Service, item.Environment, item.ProjectID)
	hasRegression := changeHasOpenRegression(item.ID)
	decision := decideWatchOutcome(item, item.Baseline, item.LatestMetrics, now, hasRegression, slo)
	if decision.FailChange {
		return setChangeStatus(item.ID, "failed")
	}
	if decision.CloseChange {
		_, err := resolveChangeRequest(item.ID)
		return err
	}
	if decision.OpenRegression && !hasRegression && item.LatestMetrics != nil {
		_, err := openChangeRegressionIncident(item, decision.Reasons, *item.LatestMetrics)
		return err
	}
	if strings.EqualFold(item.Status, "implemented") && item.Baseline != nil {
		return setChangeStatus(item.ID, "monitoring")
	}
	return nil
}

func changeHasOpenRegression(changeID int) bool {
	items, err := listRequestIncidents("")
	if err != nil {
		return false
	}
	for _, item := range items {
		if item.SuspectedChangeID == nil || *item.SuspectedChangeID != changeID {
			continue
		}
		if strings.EqualFold(item.Source, "change_regression") && incidentBlocksPromotion(item) {
			return true
		}
	}
	return false
}

func applyWatchSample(change changeRequestRecord, sample serviceMetrics) (*requestIncident, []string, error) {
	normalized := normalizeServiceMetrics(&sample)
	if normalized == nil || !metricsHasSignal(*normalized) {
		return nil, nil, fmt.Errorf("metrics are empty")
	}
	asBaseline := change.Baseline == nil || !metricsHasSignal(*change.Baseline)
	if err := recordWatchSample(change.ID, *normalized, asBaseline); err != nil {
		return nil, nil, err
	}
	if asBaseline {
		if strings.EqualFold(change.Status, "implemented") {
			_ = setChangeStatus(change.ID, "monitoring")
		}
		return nil, nil, nil
	}
	refreshed, err := getChangeRequestByID(change.ID)
	if err != nil {
		return nil, nil, err
	}
	slo := findServiceSLO(refreshed.Service, refreshed.Environment, refreshed.ProjectID)
	reasons := detectWatchBreaches(refreshed.Baseline, *normalized, slo)
	if len(reasons) == 0 {
		if strings.EqualFold(refreshed.Status, "implemented") {
			_ = setChangeStatus(refreshed.ID, "monitoring")
		}
		return nil, nil, nil
	}
	incident, err := openChangeRegressionIncident(*refreshed, reasons, *normalized)
	if err != nil {
		return nil, reasons, err
	}
	return incident, reasons, nil
}

func openChangeRegressionIncident(change changeRequestRecord, reasons []string, sample serviceMetrics) (*requestIncident, error) {
	fingerprint := fmt.Sprintf("change_regression/%d/%s", change.ID, strings.ToLower(strings.TrimSpace(change.SHA)))
	existing, err := findOpenAlertIncident("change_regression", fingerprint)
	if err != nil {
		return nil, err
	}
	title := firstNonEmpty(change.Title, change.ChangeNumber) + " post-deploy regression"
	message := strings.Join(reasons, "; ")
	if message == "" {
		message = fmt.Sprintf("Watcher saw p95=%.0fms error=%.3f saturation=%.2f", sample.P95Ms, sample.ErrorRatio, sample.Saturation)
	}
	if hint := changeRollbackHint(change); hint != "" {
		message += "\n\n" + hint
	}
	if existing != nil {
		_, err := execContext(`
			UPDATE request_incidents
			SET last_seen_at = CURRENT_TIMESTAMP,
			    occurrence_count = occurrence_count + 1,
			    notes = CASE WHEN COALESCE($2,'') = '' THEN notes ELSE $2 END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existing.ID, message)
		if err != nil {
			return nil, err
		}
		return getRequestIncidentByID(existing.ID)
	}
	event := parsedAlertEvent{
		Source:      "change_regression",
		Fingerprint: fingerprint,
		Severity:    "high",
		Title:       title,
		Message:     message,
		Service:     change.Service,
		Environment: change.Environment,
		Status:      "firing",
	}
	if change.ProjectID != nil {
		event.ProjectID = *change.ProjectID
	}
	var projectAny any
	if change.ProjectID != nil {
		projectAny = *change.ProjectID
	}
	var ownerAny any
	if ownerID := activeOncallUserID(); ownerID != nil {
		ownerAny = *ownerID
	}
	notes := event.Message
	if guides := matchRunbooksForService(change.ProjectID, change.Service); len(guides) > 0 {
		prefix := "Guide: " + guides[0].Title
		if strings.TrimSpace(guides[0].LinkURL) != "" {
			prefix += " — " + strings.TrimSpace(guides[0].LinkURL)
		}
		notes = prefix + "\n\n" + notes
	}
	var incidentID int
	err = queryRowContext(`
		INSERT INTO request_incidents (
			request_id, project_id, severity, status, escalation_level, owner_user_id, summary, notes,
			source, fingerprint, alert_source, dashboard_url, suspected_change_id, service, environment, occurrence_count, last_seen_at
		) VALUES (
			NULL, $1, $2, 'open', 'monitoring', $3, $4, $5,
			'change_regression', $6, 'change_regression', '', $7, $8, $9, 1, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, projectAny, event.Severity, ownerAny, event.Title, notes, event.Fingerprint, change.ID, event.Service, event.Environment).Scan(&incidentID)
	if err != nil {
		return nil, err
	}
	if _, err := execContext(`
		UPDATE request_incidents
		SET incident_number = $2
		WHERE id = $1 AND COALESCE(incident_number, '') = ''
	`, incidentID, formatIncidentNumber(incidentID)); err != nil {
		return nil, err
	}
	item, getErr := getRequestIncidentByID(incidentID)
	if getErr == nil && item != nil {
		go FireOutboundWebhooks("watch.failed", map[string]interface{}{
			"change_number":   change.ChangeNumber,
			"change_id":       change.ID,
			"incident_number": item.IncidentNumber,
			"reasons":         reasons,
			"rollback_hint":   changeRollbackHint(change),
		})
		go FireOutboundWebhooks("incident.opened", map[string]interface{}{
			"incident_number": item.IncidentNumber,
			"id":              item.ID,
			"source":          item.Source,
			"fingerprint":     item.Fingerprint,
			"severity":        item.Severity,
			"title":           item.Summary,
		})
	}
	return item, getErr
}

func findChangeForWatchMetrics(repo, sha, environment, service string) *changeRequestRecord {
	items, err := listChangeRequests(0, environment, "", "")
	if err != nil {
		return nil
	}
	needleRepo := strings.ToLower(strings.TrimSpace(repo))
	needleSHA := strings.ToLower(strings.TrimSpace(sha))
	needleService := strings.ToLower(strings.TrimSpace(service))
	for i := range items {
		item := items[i]
		if needleSHA != "" && strings.ToLower(item.SHA) == needleSHA && (needleRepo == "" || strings.ToLower(item.Repo) == needleRepo) {
			return &item
		}
		if needleSHA == "" && needleRepo != "" && strings.ToLower(item.Repo) == needleRepo && changeIsInWatchWindow(item, time.Now()) {
			return &item
		}
		if needleSHA == "" && needleService != "" && strings.EqualFold(item.Service, needleService) && changeIsInWatchWindow(item, time.Now()) {
			return &item
		}
	}
	return nil
}

func watchMetricsWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := readWebhookBody(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if !inboundWebhookAuthorized(inboundKindChange, r.Header, body) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	sample := serviceMetrics{
		P95Ms:      floatFromAny(raw["p95_ms"]),
		ErrorRatio: floatFromAny(raw["error_ratio"]),
		Saturation: floatFromAny(raw["saturation"]),
		Source:     firstNonEmpty(stringFromAny(raw["source"]), "webhook"),
	}
	if taken := parseFlexibleTime(stringFromAny(raw["taken_at"])); !taken.IsZero() {
		sample.TakenAt = taken
	}
	change := findChangeForWatchMetrics(stringFromAny(raw["repo"]), stringFromAny(raw["sha"]), normalizeChangeEnvironment(stringFromAny(raw["environment"])), stringFromAny(raw["service"]))
	if change == nil {
		if id := intFromAny(raw["change_id"]); id > 0 {
			if item, err := getChangeRequestByID(id); err == nil {
				change = item
			}
		}
	}
	if change == nil {
		writeAPIError(w, r, http.StatusNotFound, "watching change not found", nil)
		return
	}
	incident, reasons, err := applyWatchSample(*change, sample)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to record watch sample", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        "ok",
		"change_id":     change.ID,
		"change_number": change.ChangeNumber,
		"reasons":       reasons,
		"incident":      incident,
	})
}

func floatFromAny(value interface{}) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		var parsed float64
		_, _ = fmt.Sscanf(strings.TrimSpace(typed), "%f", &parsed)
		return parsed
	default:
		return 0
	}
}
