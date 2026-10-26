package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func normalizeIRMProvider(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "pagerduty", "pd":
		return "pagerduty"
	case "grafana", "grafana_irm", "oncall", "grafana_oncall":
		return "grafana"
	case "opsgenie", "og":
		return "opsgenie"
	case "zenduty", "zd":
		return "zenduty"
	default:
		return ""
	}
}

func attachIncidentExternalRef(id int, provider, externalID string) {
	if id <= 0 {
		return
	}
	provider = normalizeIRMProvider(provider)
	externalID = strings.TrimSpace(externalID)
	if provider == "" || externalID == "" || DB == nil {
		return
	}
	_, _ = execContext(`
		UPDATE request_incidents
		SET external_provider = $2,
		    external_id = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, provider, externalID)
}

func findIncidentByExternalRef(provider, externalID string) (*requestIncident, error) {
	provider = normalizeIRMProvider(provider)
	externalID = strings.TrimSpace(externalID)
	if provider == "" || externalID == "" {
		return nil, fmt.Errorf("external ref required")
	}
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if normalizeIRMProvider(items[i].ExternalProvider) == provider && strings.EqualFold(items[i].ExternalID, externalID) {
			return &items[i], nil
		}
	}
	return nil, nil
}

func mapExternalIncidentStatus(provider, raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	switch value {
	case "acknowledged", "ack", "acknowledge", "acknowledged_by_user", "incident.acknowledged", "1":
		return "acknowledged"
	case "resolved", "ok", "closed", "complete", "resolve", "incident.resolved", "incident.closed", "2":
		return "resolved"
	case "triggered", "firing", "open", "unresolved", "create", "incident.triggered", "0":
		return "open"
	}
	if provider == "grafana" && (value == "alerting" || value == "pending") {
		return "open"
	}
	return normalizeIncidentStatus(value)
}

func applyInboundIRMStatus(item *requestIncident, status string) (*requestIncident, error) {
	if item == nil {
		return nil, fmt.Errorf("incident not found")
	}
	next := mapExternalIncidentStatus(item.ExternalProvider, status)
	if next == "" || next == item.Status {
		return item, nil
	}
	_, err := execContext(`
		UPDATE request_incidents
		SET status = $2, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, item.ID, next)
	if err != nil {
		return nil, err
	}
	return getRequestIncidentByID(item.ID)
}

func parsePagerDutyIRM(body []byte) (provider, externalID, status, title, service, fingerprint string, ok bool) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", "", "", "", "", "", false
	}
	event, _ := raw["event"].(map[string]interface{})
	if event == nil {
		event = raw
	}
	data, _ := event["data"].(map[string]interface{})
	if data == nil {
		data, _ = raw["incident"].(map[string]interface{})
	}
	if data == nil {
		return "", "", "", "", "", "", false
	}
	externalID = firstNonEmpty(stringFromAny(data["id"]), stringFromAny(data["incident_id"]))
	if externalID == "" {
		return "", "", "", "", "", "", false
	}
	status = firstNonEmpty(stringFromAny(event["event_type"]), stringFromAny(data["status"]))
	status = strings.TrimPrefix(strings.ToLower(status), "incident.")
	title = firstNonEmpty(stringFromAny(data["title"]), stringFromAny(data["summary"]))
	if svc, ok := data["service"].(map[string]interface{}); ok {
		service = firstNonEmpty(stringFromAny(svc["summary"]), stringFromAny(svc["name"]))
	}
	fingerprint = "pagerduty/" + externalID
	return "pagerduty", externalID, status, title, service, fingerprint, true
}

func parseGrafanaIRM(body []byte) (provider, externalID, status, title, service, fingerprint string, ok bool) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", "", "", "", "", "", false
	}
	externalID = firstNonEmpty(
		stringFromAny(raw["alert_uid"]),
		stringFromAny(raw["alertUid"]),
		stringFromAny(raw["id"]),
		stringFromAny(raw["payload_id"]),
	)
	if payload, ok := raw["payload"].(map[string]interface{}); ok && externalID == "" {
		externalID = firstNonEmpty(stringFromAny(payload["id"]), stringFromAny(payload["alert_uid"]))
	}
	if externalID == "" {
		return "", "", "", "", "", "", false
	}
	status = firstNonEmpty(stringFromAny(raw["state"]), stringFromAny(raw["status"]), stringFromAny(raw["event"]))
	title = firstNonEmpty(stringFromAny(raw["title"]), stringFromAny(raw["message"]), stringFromAny(raw["alert_name"]))
	service = firstNonEmpty(stringFromAny(raw["service"]), stringFromAny(raw["service_name"]))
	fingerprint = "grafana/" + externalID
	return "grafana", externalID, status, title, service, fingerprint, true
}

func parseOpsgenieIRM(body []byte) (provider, externalID, status, title, service, fingerprint string, ok bool) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", "", "", "", "", "", false
	}
	alert, _ := raw["alert"].(map[string]interface{})
	if alert == nil {
		alert = raw
	}
	externalID = firstNonEmpty(stringFromAny(alert["alertId"]), stringFromAny(alert["id"]))
	if externalID == "" {
		return "", "", "", "", "", "", false
	}
	status = firstNonEmpty(stringFromAny(raw["action"]), stringFromAny(alert["status"]))
	title = firstNonEmpty(stringFromAny(alert["message"]), stringFromAny(alert["alias"]))
	service = stringFromAny(alert["source"])
	fingerprint = "opsgenie/" + externalID
	return "opsgenie", externalID, status, title, service, fingerprint, true
}

func parseZendutyIRM(body []byte) (provider, externalID, status, title, service, fingerprint string, ok bool) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", "", "", "", "", "", false
	}
	payload, _ := raw["payload"].(map[string]interface{})
	incident, _ := raw["incident"].(map[string]interface{})
	if incident == nil && payload != nil {
		incident, _ = payload["incident"].(map[string]interface{})
		if incident == nil && stringFromAny(payload["unique_id"]) != "" {
			incident = payload
		}
	}
	if incident == nil {
		if data, ok := raw["data"].(map[string]interface{}); ok {
			incident = data
		}
	}
	if incident == nil {
		return "", "", "", "", "", "", false
	}
	externalID = firstNonEmpty(stringFromAny(incident["unique_id"]), stringFromAny(incident["incident_unique_id"]), stringFromAny(raw["incident_unique_id"]))
	if externalID == "" {
		return "", "", "", "", "", "", false
	}
	status = firstNonEmpty(stringFromAny(raw["event_type"]), stringFromAny(raw["event"]), stringFromAny(incident["status"]))
	if payload != nil {
		status = firstNonEmpty(status, stringFromAny(payload["event_type"]))
	}
	status = strings.TrimPrefix(strings.ToLower(status), "incident.")
	title = firstNonEmpty(stringFromAny(incident["title"]), stringFromAny(incident["summary"]), stringFromAny(raw["message"]))
	if svc, ok := incident["service"].(map[string]interface{}); ok {
		service = firstNonEmpty(stringFromAny(svc["name"]), stringFromAny(svc["unique_id"]))
	}
	if service == "" {
		service = stringFromAny(incident["service"])
	}
	fingerprint = "zenduty/" + externalID
	return "zenduty", externalID, status, title, service, fingerprint, true
}

func parseIRMWebhook(body []byte, hint string) (provider, externalID, status, title, service, fingerprint string, ok bool) {
	hint = normalizeIRMProvider(hint)
	if hint == "pagerduty" || hint == "" {
		if provider, externalID, status, title, service, fingerprint, ok = parsePagerDutyIRM(body); ok {
			return provider, externalID, status, title, service, fingerprint, true
		}
	}
	if hint == "grafana" || hint == "" {
		if provider, externalID, status, title, service, fingerprint, ok = parseGrafanaIRM(body); ok {
			return provider, externalID, status, title, service, fingerprint, true
		}
	}
	if hint == "opsgenie" || hint == "" {
		if provider, externalID, status, title, service, fingerprint, ok = parseOpsgenieIRM(body); ok {
			return provider, externalID, status, title, service, fingerprint, true
		}
	}
	if hint == "zenduty" || hint == "" {
		if provider, externalID, status, title, service, fingerprint, ok = parseZendutyIRM(body); ok {
			return provider, externalID, status, title, service, fingerprint, true
		}
	}
	return "", "", "", "", "", "", false
}

func irmWebhookHint(r *http.Request) string {
	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case strings.HasPrefix(path, "/api/webhooks/irm/"):
		return strings.TrimPrefix(path, "/api/webhooks/irm/")
	case path == "/api/webhooks/pagerduty":
		return "pagerduty"
	case path == "/api/webhooks/zenduty":
		return "zenduty"
	}
	if q := strings.TrimSpace(r.URL.Query().Get("provider")); q != "" {
		return q
	}
	return r.Header.Get("X-IRM-Provider")
}

func irmWebhookHandler(w http.ResponseWriter, r *http.Request) {
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
	connection, authorized := matchedInboundConnection(inboundKindAlert, r.Header, body)
	if !authorized {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	provider, externalID, status, title, service, fingerprint, ok := parseIRMWebhook(body, irmWebhookHint(r))
	if !ok {
		writeAPIError(w, r, http.StatusBadRequest, "unrecognized irm payload", nil)
		return
	}
	item, err := findIncidentByExternalRef(provider, externalID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to lookup incident", err)
		return
	}
	action := "updated"
	if item == nil {
		event := parsedAlertEvent{
			Source:      provider,
			Fingerprint: fingerprint,
			Severity:    "sev2",
			Title:       firstNonEmpty(title, provider+" incident "+externalID),
			Message:     "Inbound IRM sync for " + externalID,
			Service:     service,
			Status:      mapExternalIncidentStatus(provider, status),
			StartsAt:    time.Now(),
		}
		if err := bindAlertWorker(&event, connection); err != nil {
			writeAPIError(w, r, http.StatusForbidden, "worker cannot leave its connection project", nil)
			return
		}
		created, _, upsertErr := upsertAlertIncident(event)
		if upsertErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to upsert incident", upsertErr)
			return
		}
		item = created
		action = "created"
	} else {
		if err := workerOwnsRecord(connection, item.ProjectID); err != nil {
			writeAPIError(w, r, http.StatusForbidden, "worker cannot leave its connection project", nil)
			return
		}
		item, err = applyInboundIRMStatus(item, status)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to apply irm status", err)
			return
		}
	}
	if item != nil {
		attachIncidentExternalRef(item.ID, provider, externalID)
		if refreshed, getErr := getRequestIncidentByID(item.ID); getErr == nil && refreshed != nil {
			item = refreshed
		}
		if action == "created" {
			pageIncidentOwners(*item)
		}
	}
	incidentNumber := ""
	if item != nil {
		incidentNumber = item.IncidentNumber
	}
	log.Printf("[IRM] provider=%s id=%s status=%s action=%s incident=%s", provider, externalID, status, action, incidentNumber)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":   "ok",
		"action":   action,
		"provider": provider,
		"incident": item,
	})
}

func pushIncidentToExternalIRM(item requestIncident) {
	if strings.TrimSpace(item.ExternalID) == "" {
		return
	}
	provider := normalizeIRMProvider(item.ExternalProvider)
	switch provider {
	case "pagerduty":
		pushPagerDutyIncident(item)
	case "grafana":
		pushGrafanaIncident(item)
	case "opsgenie":
		pushOpsgenieIncident(item)
	case "zenduty":
		pushZendutyIncident(item)
	}
}

func pagerDutyAPIKey() string {
	return firstNonEmpty(os.Getenv("PAGERDUTY_API_KEY"), os.Getenv("PAGERDUTY_TOKEN"))
}

func pushPagerDutyIncident(item requestIncident) {
	key := pagerDutyAPIKey()
	if key == "" {
		return
	}
	status := ""
	switch item.Status {
	case "acknowledged", "investigating", "mitigating":
		status = "acknowledged"
	case "resolved", "closed", "cancelled":
		status = "resolved"
	default:
		return
	}
	body, _ := json.Marshal(map[string]any{
		"incident": map[string]any{
			"type":   "incident_reference",
			"status": status,
		},
	})
	req, err := http.NewRequest(http.MethodPut, "https://api.pagerduty.com/incidents/"+urlPathEscape(item.ExternalID), bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Token token="+key)
	req.Header.Set("Accept", "application/vnd.pagerduty+json;version=2")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[IRM] pagerduty push failed: %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 300 {
		log.Printf("[IRM] pagerduty push status=%d id=%s", resp.StatusCode, item.ExternalID)
	}
}

func pushGrafanaIncident(item requestIncident) {
	base := strings.TrimRight(os.Getenv("GRAFANA_IRM_URL"), "/")
	token := firstNonEmpty(os.Getenv("GRAFANA_IRM_TOKEN"), os.Getenv("GRAFANA_ONCALL_TOKEN"))
	if base == "" || token == "" {
		return
	}
	path := "/api/v1/alerts/" + urlPathEscape(item.ExternalID) + "/acknowledge"
	if item.Status == "resolved" || item.Status == "closed" || item.Status == "cancelled" {
		path = "/api/v1/alerts/" + urlPathEscape(item.ExternalID) + "/resolve"
	} else if item.Status != "acknowledged" && item.Status != "investigating" && item.Status != "mitigating" {
		return
	}
	req, err := http.NewRequest(http.MethodPost, base+path, bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[IRM] grafana push failed: %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
}

func pushOpsgenieIncident(item requestIncident) {
	key := os.Getenv("OPSGENIE_API_KEY")
	if key == "" {
		return
	}
	action := ""
	switch item.Status {
	case "acknowledged", "investigating", "mitigating":
		action = "acknowledge"
	case "resolved", "closed", "cancelled":
		action = "close"
	default:
		return
	}
	body, _ := json.Marshal(map[string]any{"note": "Updated from OpsTrellis " + item.IncidentNumber})
	req, err := http.NewRequest(http.MethodPost, "https://api.opsgenie.com/v2/alerts/"+urlPathEscape(item.ExternalID)+"/"+action+"?identifierType=id", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "GenieKey "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[IRM] opsgenie push failed: %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
}

func pushZendutyIncident(item requestIncident) {
	key := os.Getenv("ZENDUTY_API_KEY")
	if key == "" {
		return
	}
	action := ""
	switch item.Status {
	case "acknowledged", "investigating", "mitigating":
		action = "acknowledge"
	case "resolved", "closed", "cancelled":
		action = "resolve"
	default:
		return
	}
	req, err := http.NewRequest(http.MethodPost, "https://www.zenduty.com/api/incidents/"+urlPathEscape(item.ExternalID)+"/"+action+"/", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Token "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[IRM] zenduty push failed: %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 300 {
		log.Printf("[IRM] zenduty push status=%d id=%s", resp.StatusCode, item.ExternalID)
	}
}

func urlPathEscape(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), " ", "%20")
}
