package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type inboundWebhookKind string

const (
	inboundKindChange       inboundWebhookKind = "change"
	inboundKindGrafana      inboundWebhookKind = "grafana"
	inboundKindAlertmanager inboundWebhookKind = "alertmanager"
	inboundKindGenericLog   inboundWebhookKind = "generic_log"
	inboundKindAlert        inboundWebhookKind = "alert"
)

type parsedChangeWebhook struct {
	ProjectID            int             `json:"project_id"`
	ProjectCode          string          `json:"project_code"`
	Service              string          `json:"service"`
	Environment          string          `json:"environment"`
	Repo                 string          `json:"repo"`
	PRNumber             int             `json:"pr_number"`
	PRURL                string          `json:"pr_url"`
	SHA                  string          `json:"sha"`
	PreviousSHA          string          `json:"previous_sha"`
	Title                string          `json:"title"`
	Author               string          `json:"author"`
	Summary              string          `json:"summary"`
	Files                []string        `json:"files"`
	PipelineURL          string          `json:"pipeline_url"`
	ChangeType           string          `json:"change_type"`
	Status               string          `json:"status"`
	WatchMinutes         int             `json:"watch_minutes"`
	RequestID            int             `json:"request_id"`
	LinkedIncidentID     int             `json:"incident_id"`
	LinkedIncidentNumber string          `json:"incident_number"`
	AssigneeUserID       int             `json:"assignee_user_id"`
	Priority             string          `json:"priority"`
	RiskLevel            string          `json:"risk_level"`
	Impact               string          `json:"impact"`
	BackoutPlan          string          `json:"backout_plan"`
	PlannedStart         string          `json:"planned_start"`
	PlannedEnd           string          `json:"planned_end"`
	CABWindowStart       string          `json:"cab_window_start"`
	CABWindowEnd         string          `json:"cab_window_end"`
	SbomURL              string          `json:"sbom_url"`
	AttestationURL       string          `json:"attestation_url"`
	ImageDigest          string          `json:"image_digest"`
	ImageRef             string          `json:"image"`
	ProvenanceJSON       string          `json:"-"`
	Provenance           map[string]any  `json:"provenance"`
	Signed               *bool           `json:"signed"`
	RolloutStage         string          `json:"rollout_stage"`
	RolloutPercent       int             `json:"rollout_percent"`
	PreviewURL           string          `json:"preview_url"`
	EstimatedCostUSD     float64         `json:"estimated_cost_usd"`
	FlagKey              string          `json:"flag_key"`
	FlagValue            string          `json:"flag_value"`
	CostDeltaUSD         float64         `json:"cost_delta_usd"`
	CostMonthlyAfter     float64         `json:"cost_monthly_after"`
	CostCurrency         string          `json:"cost_currency"`
	InfracostReport      json.RawMessage `json:"infracost_report"`
	Metrics              *serviceMetrics `json:"metrics"`
}

type parsedAlertEvent struct {
	Source       string
	Fingerprint  string
	Severity     string
	Title        string
	Message      string
	Service      string
	Environment  string
	ProjectCode  string
	ProjectID    int
	DashboardURL string
	Status           string
	StartsAt         time.Time
	Labels           map[string]string
	ExternalProvider string
	ExternalID       string
}

func inboundWebhookAuthorized(kind inboundWebhookKind, headers http.Header, body []byte) bool {
	secrets := collectInboundSecrets(kind)
	if len(secrets) == 0 {
		return false
	}
	provided := firstNonEmptyHeader(headers, "X-CI-Secret", "X-SetuOps-Secret", "X-Webhook-Secret")
	signature := firstNonEmptyHeader(headers, "X-Hub-Signature-256", "X-SetuOps-Signature")
	for _, secret := range secrets {
		if provided != "" && secretEqual(provided, secret) {
			return true
		}
		if signature != "" && verifyInboundHMAC(secret, body, signature) {
			return true
		}
	}
	return false
}

func collectInboundSecrets(kind inboundWebhookKind) []string {
	seen := map[string]struct{}{}
	out := []string{}
	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		if _, exists := seen[trimmed]; exists {
			return
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	switch kind {
	case inboundKindChange:
		add(ChangeWebhookSecret)
	case inboundKindAlert, inboundKindGrafana, inboundKindAlertmanager, inboundKindGenericLog:
		add(AlertWebhookSecret)
	}
	add(CIWebhookSecret)
	if DB == nil {
		return out
	}
	for _, source := range listEnabledInboundWebhookSecrets(string(kind)) {
		add(source)
	}
	return out
}

func firstNonEmptyHeader(headers http.Header, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(headers.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func secretEqual(left, right string) bool {
	leftSum := sha256.Sum256([]byte(left))
	rightSum := sha256.Sum256([]byte(right))
	return hmac.Equal(leftSum[:], rightSum[:])
}

func verifyInboundHMAC(secret string, body []byte, signature string) bool {
	if strings.TrimSpace(secret) == "" || strings.TrimSpace(signature) == "" {
		return false
	}
	sig := strings.TrimPrefix(strings.TrimSpace(signature), "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(sig))
}

func changeIdempotencyKey(repo, sha, environment string) string {
	return strings.ToLower(strings.TrimSpace(repo)) + "|" + strings.ToLower(strings.TrimSpace(sha)) + "|" + strings.ToLower(normalizeChangeEnvironment(environment))
}

func normalizeChangeEnvironment(environment string) string {
	trimmed := strings.ToLower(strings.TrimSpace(environment))
	if trimmed == "" {
		return "unspecified"
	}
	return trimmed
}

func normalizeChangeStatus(status string) string {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(status), " ", "_")) {
	case "new", "open", "queued":
		return "new"
	case "implementing", "in_progress", "running", "deploying":
		return "implementing"
	case "implemented", "merged", "deployed", "apply_success", "deploy_success":
		return "implemented"
	case "monitoring":
		return "monitoring"
	case "resolved", "success", "successful", "review":
		return "resolved"
	case "closed", "complete", "completed":
		return "closed"
	case "failed", "error", "apply_failed", "deploy_failed":
		return "failed"
	case "cancelled", "canceled":
		return "cancelled"
	default:
		return "implementing"
	}
}

func changeIsFinished(status string) bool {
	switch normalizeChangeStatus(status) {
	case "resolved", "closed", "failed", "cancelled":
		return true
	default:
		return false
	}
}

func changeStatusRank(status string) int {
	switch normalizeChangeStatus(status) {
	case "new":
		return 0
	case "implementing":
		return 1
	case "implemented":
		return 2
	case "monitoring":
		return 3
	case "resolved":
		return 4
	case "closed":
		return 5
	case "failed", "cancelled":
		return 6
	default:
		return 1
	}
}

func normalizeAlertSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical", "crit", "sev1", "p1", "fatal":
		return "critical"
	case "high", "sev2", "p2", "error", "major":
		return "high"
	case "low", "sev4", "p4", "info":
		return "low"
	default:
		return "medium"
	}
}

func isSEV1Severity(severity string) bool {
	return normalizeAlertSeverity(severity) == "critical"
}

func shouldAutoResolveAlert(severity, incomingStatus string) bool {
	status := strings.ToLower(strings.TrimSpace(incomingStatus))
	if status != "resolved" && status != "ok" && status != "normal" {
		return false
	}
	return !isSEV1Severity(severity)
}

func normalizeAlertSource(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	switch trimmed {
	case "grafana", "alertmanager", "loki", "elk", "datadog", "cloudwatch", "generic", "generic_log":
		if trimmed == "generic" {
			return "generic_log"
		}
		return trimmed
	default:
		if trimmed == "" {
			return "generic_log"
		}
		return trimmed
	}
}

func alertFingerprint(source, fingerprint, title, service, environment string) string {
	if trimmed := strings.TrimSpace(fingerprint); trimmed != "" {
		return trimmed
	}
	parts := []string{
		normalizeAlertSource(source),
		strings.ToLower(strings.TrimSpace(title)),
		strings.ToLower(strings.TrimSpace(service)),
		strings.ToLower(strings.TrimSpace(environment)),
	}
	return strings.Join(parts, "/")
}

func parseChangeWebhookJSON(body []byte) (parsedChangeWebhook, error) {
	var payload parsedChangeWebhook
	if err := json.Unmarshal(body, &payload); err != nil {
		return parsedChangeWebhook{}, err
	}
	envOmitted := strings.TrimSpace(payload.Environment) == ""
	payload.Repo = strings.TrimSpace(payload.Repo)
	payload.SHA = strings.TrimSpace(payload.SHA)
	payload.Environment = normalizeChangeEnvironment(payload.Environment)
	payload.Service = strings.TrimSpace(payload.Service)
	payload.ProjectCode = strings.TrimSpace(payload.ProjectCode)
	payload.Title = strings.TrimSpace(payload.Title)
	payload.Author = strings.TrimSpace(payload.Author)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.Impact = strings.TrimSpace(payload.Impact)
	payload.BackoutPlan = strings.TrimSpace(payload.BackoutPlan)
	payload.PRURL = strings.TrimSpace(payload.PRURL)
	payload.PipelineURL = strings.TrimSpace(payload.PipelineURL)
	payload.PreviousSHA = strings.TrimSpace(payload.PreviousSHA)
	payload.ChangeType = normalizeChangeType(payload.ChangeType)
	payload.Priority = normalizeChangePriority(payload.Priority)
	payload.RiskLevel = normalizeChangeRisk(payload.RiskLevel)
	payload.LinkedIncidentNumber = strings.TrimSpace(payload.LinkedIncidentNumber)
	payload.Status = normalizeChangeStatus(payload.Status)
	if mapped := lookupServiceMap(payload.Service, payload.Repo, payload.Environment); mapped != nil {
		if payload.Service == "" {
			payload.Service = mapped.Service
		}
		if payload.ProjectID == 0 && mapped.ProjectID != nil {
			payload.ProjectID = *mapped.ProjectID
		}
		if envOmitted && strings.TrimSpace(mapped.Environment) != "" {
			payload.Environment = normalizeChangeEnvironment(mapped.Environment)
		}
	}
	if payload.WatchMinutes <= 0 {
		payload.WatchMinutes = 120
	}
	cleanFiles := make([]string, 0, len(payload.Files))
	for _, file := range payload.Files {
		if trimmed := strings.TrimSpace(file); trimmed != "" {
			cleanFiles = append(cleanFiles, trimmed)
		}
	}
	payload.Files = cleanFiles
	payload.Metrics = normalizeServiceMetrics(payload.Metrics)
	if payload.Provenance == nil {
		payload.Provenance = map[string]any{}
	}
	payload.SbomURL = firstNonEmpty(payload.SbomURL, stringFromAny(payload.Provenance["sbom_url"]))
	payload.AttestationURL = firstNonEmpty(payload.AttestationURL, stringFromAny(payload.Provenance["attestation_url"]))
	payload.ImageDigest = firstNonEmpty(payload.ImageDigest, payload.ImageRef, stringFromAny(payload.Provenance["image_digest"]))
	if payload.SbomURL != "" {
		payload.Provenance["sbom_url"] = payload.SbomURL
	}
	if payload.AttestationURL != "" {
		payload.Provenance["attestation_url"] = payload.AttestationURL
	}
	if payload.ImageDigest != "" {
		payload.Provenance["image_digest"] = payload.ImageDigest
	}
	if payload.Signed != nil {
		payload.Provenance["signed"] = *payload.Signed
	} else if payload.AttestationURL != "" {
		payload.Provenance["signed"] = true
	}
	if raw, err := json.Marshal(payload.Provenance); err == nil && len(payload.Provenance) > 0 {
		payload.ProvenanceJSON = string(raw)
	}
	return payload, nil
}

func parseAlertWebhookJSON(body []byte) ([]parsedAlertEvent, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	if alerts, ok := raw["alerts"].([]interface{}); ok && len(alerts) > 0 {
		source := "grafana"
		if _, hasReceiver := raw["receiver"]; !hasReceiver {
			if _, hasStatus := raw["status"]; hasStatus {
				source = "alertmanager"
			}
		}
		if strings.Contains(strings.ToLower(stringFromAny(raw["version"])), "4") {
			source = "alertmanager"
		}
		events := make([]parsedAlertEvent, 0, len(alerts))
		for _, item := range alerts {
			alertMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			events = append(events, alertEventFromGrafanaMap(source, raw, alertMap))
		}
		return events, nil
	}
	event, err := parseGenericAlertMap(raw)
	if err != nil {
		return nil, err
	}
	return []parsedAlertEvent{event}, nil
}

func alertEventFromGrafanaMap(source string, envelope, alert map[string]interface{}) parsedAlertEvent {
	labels := stringMapFromAny(alert["labels"])
	annotations := stringMapFromAny(alert["annotations"])
	title := firstNonEmpty(
		annotations["summary"],
		annotations["title"],
		labels["alertname"],
		stringFromAny(alert["title"]),
		"Alert",
	)
	message := firstNonEmpty(annotations["description"], annotations["message"], stringFromAny(alert["valueString"]), title)
	severity := firstNonEmpty(labels["severity"], labels["priority"], stringFromAny(alert["severity"]), "medium")
	service := firstNonEmpty(labels["service"], labels["app"], labels["job"])
	environment := firstNonEmpty(labels["env"], labels["environment"], labels["namespace"])
	projectCode := firstNonEmpty(labels["project_code"], labels["project"])
	status := firstNonEmpty(stringFromAny(alert["status"]), stringFromAny(envelope["status"]), "firing")
	fingerprint := firstNonEmpty(stringFromAny(alert["fingerprint"]), labels["fingerprint"])
	dashboard := firstNonEmpty(stringFromAny(alert["generatorURL"]), stringFromAny(alert["panelURL"]), stringFromAny(alert["silenceURL"]))
	startsAt := parseFlexibleTime(firstNonEmpty(stringFromAny(alert["startsAt"]), stringFromAny(alert["starts_at"])))
	event := parsedAlertEvent{
		Source:       normalizeAlertSource(source),
		Fingerprint:  alertFingerprint(source, fingerprint, title, service, environment),
		Severity:     normalizeAlertSeverity(severity),
		Title:        title,
		Message:      message,
		Service:      service,
		Environment:  environment,
		ProjectCode:  projectCode,
		DashboardURL: dashboard,
		Status:       strings.ToLower(strings.TrimSpace(status)),
		StartsAt:     startsAt,
		Labels:       labels,
	}
	event.ExternalProvider, event.ExternalID = extractAlertExternalRef(labels, envelope)
	return event
}

func parseGenericAlertMap(raw map[string]interface{}) (parsedAlertEvent, error) {
	labels := stringMapFromAny(raw["labels"])
	title := firstNonEmpty(stringFromAny(raw["title"]), labels["alertname"], "Alert")
	service := firstNonEmpty(stringFromAny(raw["service"]), labels["service"])
	environment := firstNonEmpty(stringFromAny(raw["environment"]), labels["env"], labels["environment"])
	source := normalizeAlertSource(firstNonEmpty(stringFromAny(raw["source"]), "generic_log"))
	fingerprint := alertFingerprint(source, stringFromAny(raw["fingerprint"]), title, service, environment)
	event := parsedAlertEvent{
		Source:       source,
		Fingerprint:  fingerprint,
		Severity:     normalizeAlertSeverity(firstNonEmpty(stringFromAny(raw["severity"]), labels["severity"])),
		Title:        title,
		Message:      firstNonEmpty(stringFromAny(raw["message"]), stringFromAny(raw["description"]), title),
		Service:      service,
		Environment:  environment,
		ProjectCode:  firstNonEmpty(stringFromAny(raw["project_code"]), labels["project_code"]),
		ProjectID:    intFromAny(raw["project_id"]),
		DashboardURL: firstNonEmpty(stringFromAny(raw["dashboard_url"]), stringFromAny(raw["url"])),
		Status:       firstNonEmpty(stringFromAny(raw["status"]), "firing"),
		StartsAt:     parseFlexibleTime(stringFromAny(raw["starts_at"])),
		Labels:       labels,
	}
	event.ExternalProvider, event.ExternalID = extractAlertExternalRef(labels, raw)
	event.ExternalProvider = firstNonEmpty(event.ExternalProvider, normalizeIRMProvider(stringFromAny(raw["external_provider"])))
	event.ExternalID = firstNonEmpty(event.ExternalID, stringFromAny(raw["external_id"]))
	return event, nil
}

func extractAlertExternalRef(labels map[string]string, raw map[string]interface{}) (string, string) {
	if labels == nil {
		labels = map[string]string{}
	}
	if id := firstNonEmpty(labels["pagerduty_incident"], labels["pd_incident"], stringFromAny(raw["pagerduty_incident"])); id != "" {
		return "pagerduty", id
	}
	if id := firstNonEmpty(labels["grafana_alert_uid"], labels["alert_uid"], stringFromAny(raw["alert_uid"])); id != "" {
		return "grafana", id
	}
	if id := firstNonEmpty(labels["opsgenie_alert"], labels["opsgenie_id"], stringFromAny(raw["opsgenie_id"])); id != "" {
		return "opsgenie", id
	}
	return "", ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func stringFromAny(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		if typed == float64(int(typed)) {
			return strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(jsonNumber(typed), ".0"), ".00"))
		}
	}
	return ""
}

func jsonNumber(value float64) string {
	body, _ := json.Marshal(value)
	return string(body)
}

func stringMapFromAny(value interface{}) map[string]string {
	out := map[string]string{}
	raw, ok := value.(map[string]interface{})
	if !ok {
		return out
	}
	for key, item := range raw {
		if text := stringFromAny(item); text != "" {
			out[key] = text
		}
	}
	return out
}

func parseFlexibleTime(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return parsed
	}
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if parsed, err := time.ParseInLocation(layout, trimmed, time.Local); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func readWebhookBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, 1<<20))
}

func changeWebhookHandler(w http.ResponseWriter, r *http.Request) {
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
	payload, err := parseChangeWebhookJSON(body)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if payload.Repo == "" || payload.SHA == "" {
		writeAPIError(w, r, http.StatusBadRequest, "repo and sha are required", nil)
		return
	}
	if emergencyRequiresIncident(payload.ChangeType, payload.LinkedIncidentID, payload.LinkedIncidentNumber) {
		writeAPIError(w, r, http.StatusBadRequest, "emergency changes must link an incident", nil)
		return
	}
	item, created, err := upsertChangeRequest(payload)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to record change", err)
		return
	}
	if created {
		go FireOutboundWebhooks("change.created", map[string]interface{}{
			"change_number": item.ChangeNumber,
			"id":            item.ID,
			"repo":          item.Repo,
			"sha":           item.SHA,
			"pr_number":     item.PRNumber,
			"environment":   item.Environment,
			"service":       item.Service,
		})
	}
	log.Printf("[Change Webhook] repo=%s sha=%s env=%s created=%t number=%s", item.Repo, item.SHA, item.Environment, created, item.ChangeNumber)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        "ok",
		"id":            item.ID,
		"change_number": item.ChangeNumber,
		"created":       created,
		"change_status": item.Status,
	})
}

func alertWebhookHandler(w http.ResponseWriter, r *http.Request) {
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
	if !inboundWebhookAuthorized(inboundKindAlert, r.Header, body) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	events, err := parseAlertWebhookJSON(body)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if len(events) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "no alerts in payload", nil)
		return
	}
	created := 0
	updated := 0
	resolved := 0
	skippedResolve := 0
	silenced := 0
	incidents := make([]requestIncident, 0, len(events))
	for _, event := range events {
		item, action, err := upsertAlertIncident(event)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to record incident", err)
			return
		}
		if item != nil {
			attachIncidentExternalRef(item.ID, event.ExternalProvider, event.ExternalID)
			if refreshed, getErr := getRequestIncidentByID(item.ID); getErr == nil && refreshed != nil {
				item = refreshed
			}
		}
		incidents = append(incidents, *item)
		switch action {
		case "created":
			created++
			go FireOutboundWebhooks("incident.opened", map[string]interface{}{
				"incident_number": item.IncidentNumber,
				"id":              item.ID,
				"source":          item.Source,
				"fingerprint":     item.Fingerprint,
				"severity":        item.Severity,
				"title":           item.Summary,
			})
		case "updated":
			updated++
		case "resolved":
			resolved++
		case "resolve_skipped":
			skippedResolve++
		case "silenced":
			silenced++
		}
	}
	log.Printf("[Alert Webhook] events=%d created=%d updated=%d resolved=%d skipped_sev1=%d silenced=%d", len(events), created, updated, resolved, skippedResolve, silenced)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "ok",
		"created":         created,
		"updated":         updated,
		"resolved":        resolved,
		"resolve_skipped": skippedResolve,
		"silenced":        silenced,
		"incidents":       incidents,
	})
}
