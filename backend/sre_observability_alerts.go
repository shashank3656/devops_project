package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type monitorRoutingPolicy struct {
	ServiceID       int    `json:"service_id"`
	Environment     string `json:"environment"`
	ObservationOnly bool   `json:"observation_only"`
	CreateIncidents bool   `json:"create_incidents"`
	PageOncall      bool   `json:"page_oncall"`
}

func loadMonitorRouting(serviceID int, environment string) monitorRoutingPolicy {
	policy := monitorRoutingPolicy{ServiceID: serviceID, Environment: environment, ObservationOnly: true}
	if DB == nil {
		return policy
	}
	_ = queryRowContext(`
		SELECT observation_only, create_incidents, page_oncall
		FROM monitor_routing_policies
		WHERE service_id = $1 AND LOWER(environment) = LOWER($2)
	`, serviceID, environment).Scan(&policy.ObservationOnly, &policy.CreateIncidents, &policy.PageOncall)
	return policy
}

func saveMonitorRouting(userID int, service *serviceMapEntry, body monitorRoutingPolicy) monitorRoutingPolicy {
	env := strings.TrimSpace(body.Environment)
	if env == "" {
		env = service.Environment
	}
	_, _ = execContext(`
		INSERT INTO monitor_routing_policies (service_id, environment, observation_only, create_incidents, page_oncall, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (service_id, environment) DO UPDATE SET
			observation_only = EXCLUDED.observation_only,
			create_incidents = EXCLUDED.create_incidents,
			page_oncall = EXCLUDED.page_oncall,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`, service.ID, env, body.ObservationOnly, body.CreateIncidents, body.PageOncall, userID)
	return loadMonitorRouting(service.ID, env)
}

func parseWebhookSignedTime(r *http.Request) time.Time {
	raw := strings.TrimSpace(r.Header.Get("X-Hub-Timestamp"))
	if raw == "" {
		raw = strings.TrimSpace(r.Header.Get("X-Grafana-Alerting-Timestamp"))
	}
	if raw == "" {
		return time.Time{}
	}
	if unix, err := strconv.ParseInt(raw, 10, 64); err == nil && unix > 1e9 {
		if unix > 1e12 {
			unix = unix / 1000
		}
		return time.Unix(unix, 0).UTC()
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed.UTC()
	}
	return time.Time{}
}

func persistMonitoringWebhookReceipt(source, bodySHA string) error {
	if DB == nil {
		return nil
	}
	_, err := execContext(`
		INSERT INTO monitor_webhook_receipts (source, body_sha)
		VALUES ($1, $2)
		ON CONFLICT (source, body_sha) DO NOTHING
	`, source, bodySHA)
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		return nil
	}
	return err
}

func incomingAlertTime(event parsedAlertEvent) time.Time {
	return event.StartsAt
}

func lastAlertEpisode(serviceID int, fingerprint string) (status string, seq int, lastAt time.Time, incidentID int) {
	if DB == nil {
		return "", 0, time.Time{}, 0
	}
	_ = queryRowContext(`
		SELECT status, sequence, last_event_at, incident_id
		FROM monitor_alert_episodes
		WHERE service_id = $1 AND fingerprint = $2
		ORDER BY sequence DESC, id DESC
		LIMIT 1
	`, serviceID, fingerprint).Scan(&status, &seq, &lastAt, &incidentID)
	return status, seq, lastAt, incidentID
}

func countOtherFiringEpisodes(serviceID int, environment, fingerprint string) int {
	if DB == nil {
		return 0
	}
	var n int
	_ = queryRowContext(`
		SELECT COUNT(*) FROM monitor_alert_episodes
		WHERE service_id = $1 AND LOWER(environment) = LOWER($2) AND status = 'firing' AND fingerprint <> $3
	`, serviceID, environment, fingerprint).Scan(&n)
	return n
}

func recordMonitorAlertEpisode(serviceID int, environment, fingerprint, status, severity, title string, sequence, incidentID int, at time.Time) int {
	if DB == nil {
		return 0
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}
	if sequence <= 0 {
		sequence = 1
	}
	recovered := any(nil)
	if status == "resolved" {
		recovered = at
	}
	var id int
	_ = queryRowContext(`
		INSERT INTO monitor_alert_episodes (service_id, environment, fingerprint, sequence, status, severity, title, incident_id, started_at, last_event_at, recovered_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
		ON CONFLICT (service_id, fingerprint, sequence) DO UPDATE SET
			status = EXCLUDED.status,
			severity = EXCLUDED.severity,
			title = EXCLUDED.title,
			incident_id = CASE WHEN EXCLUDED.incident_id > 0 THEN EXCLUDED.incident_id ELSE monitor_alert_episodes.incident_id END,
			last_event_at = EXCLUDED.last_event_at,
			recovered_at = CASE WHEN EXCLUDED.status = 'resolved' THEN COALESCE(monitor_alert_episodes.recovered_at, EXCLUDED.recovered_at) ELSE NULL END
		RETURNING id
	`, serviceID, environment, fingerprint, sequence, status, severity, title, incidentID, at, recovered).Scan(&id)
	return id
}

func listMonitorAlertEpisodes(serviceID int, environment string) []map[string]any {
	out := []map[string]any{}
	if DB == nil {
		return out
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, fingerprint, sequence, status, severity, title, incident_id, started_at, last_event_at
		FROM monitor_alert_episodes
		WHERE service_id = $1 AND ($2 = '' OR LOWER(environment) = LOWER($2))
		ORDER BY CASE status WHEN 'firing' THEN 0 ELSE 1 END, last_event_at DESC, id DESC
		LIMIT 50
	`, serviceID, environment)
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, seq, incidentID int
		var fingerprint, status, severity, title string
		var started, last time.Time
		if rows.Scan(&id, &fingerprint, &seq, &status, &severity, &title, &incidentID, &started, &last) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":            id,
			"fingerprint":   fingerprint,
			"sequence":      seq,
			"status":        status,
			"severity":      severity,
			"title":         title,
			"incident_id":   incidentID,
			"started_at":    started.UTC().Format(time.RFC3339),
			"last_event_at": last.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func correlateMonitorAlert(event parsedAlertEvent, incident *requestIncident) {
	if strings.TrimSpace(event.Service) == "" {
		return
	}
	item := lookupServiceMap(event.Service, "", event.Environment)
	if item == nil {
		return
	}
	policy := loadMonitorRouting(item.ID, item.Environment)
	severity := findingWarning
	if strings.EqualFold(event.Severity, "critical") || strings.EqualFold(event.Severity, "p1") {
		severity = findingCritical
	}
	firing := !strings.EqualFold(event.Status, "resolved") && !strings.EqualFold(event.Status, "ok")
	status := "firing"
	if !firing {
		status = "resolved"
	}
	fingerprint := strings.TrimSpace(event.Fingerprint)
	if fingerprint == "" {
		fingerprint = fmt.Sprintf("%s:%s", item.Service, event.Title)
	}
	identity := fmt.Sprintf("alert:%s", fingerprint)
	incidentID := 0
	if incident != nil {
		incidentID = incident.ID
	}
	lastStatus, lastSeq, lastAt, lastIncident := lastAlertEpisode(item.ID, fingerprint)
	incomingAt := incomingAlertTime(event)
	if ignoreStaleAlert(lastAt, incomingAt) {
		return
	}
	if incidentID == 0 {
		incidentID = lastIncident
	}
	seq := nextAlertEpisodeSequence(lastStatus, lastSeq, firing)
	episodeID := recordMonitorAlertEpisode(item.ID, item.Environment, fingerprint, status, severity, strings.TrimSpace(event.Title), seq, incidentID, incomingAt)
	if !firing {
		_, _ = execContext(`
			UPDATE monitor_findings
			SET lifecycle = 'resolved', resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP), last_evaluated_at = CURRENT_TIMESTAMP, episode_id = $3
			WHERE service_id = $1 AND identity_key = $2 AND lifecycle <> 'resolved'
		`, item.ID, identity, episodeID)
		_ = canCloseLinkedIncident(countOtherFiringEpisodes(item.ID, item.Environment, fingerprint))
		_ = policy.PageOncall
		return
	}
	_, _ = execContext(`
		INSERT INTO monitor_findings (
			service_id, monitor_id, environment, identity_key, severity, lifecycle, title, explanation,
			observed, expected, source_type, last_evaluated_at, incident_id, episode_id
		) VALUES ($1, NULL, $2, $3, $4, 'open', $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10, $11)
		ON CONFLICT (service_id, identity_key) DO UPDATE SET
			severity = EXCLUDED.severity,
			title = EXCLUDED.title,
			explanation = EXCLUDED.explanation,
			observed = EXCLUDED.observed,
			last_seen_at = CURRENT_TIMESTAMP,
			last_evaluated_at = CURRENT_TIMESTAMP,
			incident_id = CASE WHEN EXCLUDED.incident_id > 0 THEN EXCLUDED.incident_id ELSE monitor_findings.incident_id END,
			episode_id = EXCLUDED.episode_id,
			lifecycle = CASE WHEN monitor_findings.lifecycle = 'acknowledged' THEN 'acknowledged' ELSE 'open' END,
			resolved_at = NULL
	`, item.ID, item.Environment, identity, severity, strings.TrimSpace(event.Title), strings.TrimSpace(event.Message),
		"Source alert is firing.", "Alert should not be firing after recovery evidence.", event.Source, incidentID, episodeID)
	if policy.ObservationOnly || !policy.CreateIncidents {
		return
	}
	_ = policy.PageOncall
}

func monitoringAlertWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := readWebhookBody(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	_, authorized := matchedInboundConnection(inboundKindAlert, r.Header, body)
	if !authorized {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	if signed := parseWebhookSignedTime(r); monitoringTimestampTooOld(signed, time.Now().UTC()) {
		writeAPIError(w, r, http.StatusUnauthorized, "stale webhook", nil)
		return
	}
	sum := sha256.Sum256(body)
	if err := persistMonitoringWebhookReceipt("monitoring", hex.EncodeToString(sum[:])); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to persist webhook", err)
		return
	}
	events, err := parseAlertWebhookJSON(body)
	if err != nil || len(events) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "no alerts in payload", err)
		return
	}
	for _, event := range events {
		correlateMonitorAlert(event, nil)
	}
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "accepted", "mode": "observation", "events": len(events)})
}

func monitoringSampleWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	connectorID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("connector_id")))
	if connectorID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "connector_id is required", nil)
		return
	}
	var secretRef string
	if err := queryRowContext(`SELECT secret_ref FROM observability_connectors WHERE id = $1 AND source_type = $2`, connectorID, sourcePrivate).Scan(&secretRef); err != nil {
		writeAPIError(w, r, http.StatusNotFound, "connector not found", err)
		return
	}
	secret, err := resolveSecretRef(secretRef)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	sig := strings.TrimPrefix(strings.TrimSpace(r.Header.Get("X-Hub-Signature-256")), "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	if sig == "" || !hmac.Equal([]byte(sig), []byte(hex.EncodeToString(mac.Sum(nil)))) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	if signed := parseWebhookSignedTime(r); monitoringTimestampTooOld(signed, time.Now().UTC()) {
		writeAPIError(w, r, http.StatusUnauthorized, "stale webhook", nil)
		return
	}
	sum := sha256.Sum256(body)
	if err := persistMonitoringWebhookReceipt(fmt.Sprintf("sample:%d", connectorID), hex.EncodeToString(sum[:])); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to persist webhook", err)
		return
	}
	var payload struct {
		ServiceID   int     `json:"service_id"`
		Environment string  `json:"environment"`
		Good        int64   `json:"good"`
		Total       int64   `json:"total"`
		LatencyMS   float64 `json:"latency_ms"`
		ObservedAt  string  `json:"observed_at"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	observed := time.Now().UTC()
	if payload.ObservedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, payload.ObservedAt); err == nil {
			observed = parsed
		}
	}
	_, err = execContext(`
		INSERT INTO monitor_private_samples (connector_id, service_id, environment, good_count, total_count, latency_ms, observed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, connectorID, payload.ServiceID, strings.TrimSpace(payload.Environment), payload.Good, payload.Total, payload.LatencyMS, observed)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to store sample", err)
		return
	}
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "accepted"})
}
