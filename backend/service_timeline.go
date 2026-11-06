package main

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

type serviceTimelineEvent struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Label           string `json:"label"`
	Summary         string `json:"summary"`
	Detail          string `json:"detail,omitempty"`
	At              string `json:"at"`
	Href            string `json:"href,omitempty"`
	EvidenceHref    string `json:"evidence_href,omitempty"`
	EvidenceLabel   string `json:"evidence_label,omitempty"`
	Environment     string `json:"environment,omitempty"`
	CorrelationNote string `json:"correlation_note,omitempty"`
	Tone            string `json:"tone,omitempty"`
}

type serviceActivityTimeline struct {
	Service     string                 `json:"service"`
	Note        string                 `json:"note"`
	EvaluatedAt string                 `json:"evaluated_at"`
	Events      []serviceTimelineEvent `json:"events"`
}

const (
	serviceTimelineNote      = "This timeline combines deployments, configuration changes, incidents, and SLO breaches for the selected service and environment. Each event links to its source evidence. Nearby timestamps are correlation, not proven cause."
	serviceTimelineProximity = 30 * time.Minute
	serviceTimelineMaxEvents = 40
)

func parseTimelineTime(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed.UTC()
	}
	if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return parsed.UTC()
	}
	return time.Time{}
}

func eventTime(item serviceTimelineEvent) time.Time {
	return parseTimelineTime(item.At)
}

func timelineTone(kind, status string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "incident":
		if strings.Contains(strings.ToLower(status), "resolved") || strings.Contains(strings.ToLower(status), "closed") {
			return "ok"
		}
		return "danger"
	case "alert":
		return "warn"
	case "deployment":
		if strings.Contains(strings.ToLower(status), "fail") {
			return "danger"
		}
		return "info"
	case "configuration":
		return "info"
	case "slo":
		return "danger"
	case "approval":
		return "ok"
	default:
		return "info"
	}
}

func changeLooksLikeConfiguration(item changeRequestRecord) bool {
	if normalizeChangeType(item.ChangeType) == "flag" {
		return true
	}
	for _, file := range item.Files {
		lower := strings.ToLower(strings.TrimSpace(file))
		if lower == "" {
			continue
		}
		if strings.Contains(lower, "config") || strings.Contains(lower, "values.") || strings.Contains(lower, "kustomization") {
			return true
		}
		for _, suffix := range []string{".yaml", ".yml", ".toml", ".tf", ".env", ".ini", ".conf"} {
			if strings.HasSuffix(lower, suffix) {
				return true
			}
		}
	}
	return false
}

func withTimelineEvidence(event serviceTimelineEvent, href, label string) serviceTimelineEvent {
	event.Href = firstNonEmpty(event.Href, href)
	event.EvidenceHref = firstNonEmpty(href, event.Href)
	event.EvidenceLabel = firstNonEmpty(label, "Source evidence")
	return event
}

func buildServiceActivityTimeline(service serviceMapEntry, changes []changeRequestRecord, incidents []requestIncident, findings []monitorFindingView, attempts []deploymentAttempt, slos []serviceSLOBudget, environment string) serviceActivityTimeline {
	now := time.Now().UTC()
	events := make([]serviceTimelineEvent, 0, 32)

	for _, item := range changes {
		env := strings.TrimSpace(item.Environment)
		if env == "" || strings.EqualFold(env, "unspecified") {
			env = "Unknown"
		}
		changeHref := fmt.Sprintf("/changes/%d", item.ID)
		if item.PRNumber > 0 {
			href := item.PRURL
			if strings.TrimSpace(href) == "" {
				href = changeHref
			}
			at := item.CreatedAt
			events = append(events, withTimelineEvidence(serviceTimelineEvent{
				ID:          fmt.Sprintf("pr-%d", item.ID),
				Kind:        "pr",
				Label:       "Pull request",
				Summary:     firstNonEmpty(item.Title, fmt.Sprintf("PR #%d", item.PRNumber)),
				Detail:      fmt.Sprintf("%s · PR #%d", firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)), item.PRNumber),
				At:          at.UTC().Format(time.RFC3339),
				Environment: env,
				Tone:        "info",
			}, href, "Pull request"))
		}
		if item.CABApprovedAt != nil && !item.CABApprovedAt.IsZero() {
			events = append(events, withTimelineEvidence(serviceTimelineEvent{
				ID:          fmt.Sprintf("approval-%d", item.ID),
				Kind:        "approval",
				Label:       "Approval",
				Summary:     firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)) + " approved",
				Detail:      firstNonEmpty(item.CABApprovedByUsername, "Recorded change approval"),
				At:          item.CABApprovedAt.UTC().Format(time.RFC3339),
				Environment: env,
				Tone:        "ok",
			}, changeHref, "Change record"))
		}
		if changeLooksLikeConfiguration(item) {
			at := item.UpdatedAt
			if at.IsZero() {
				at = item.CreatedAt
			}
			events = append(events, withTimelineEvidence(serviceTimelineEvent{
				ID:          fmt.Sprintf("config-%d", item.ID),
				Kind:        "configuration",
				Label:       "Configuration change",
				Summary:     firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)) + " configuration",
				Detail:      firstNonEmpty(item.Title, "Recorded configuration or flag change."),
				At:          at.UTC().Format(time.RFC3339),
				Environment: env,
				Tone:        "info",
			}, changeHref, "Change record"))
		}
		status := normalizeChangeStatus(item.Status)
		if status == "implementing" || status == "implemented" || status == "monitoring" || status == "resolved" || status == "failed" {
			at := item.UpdatedAt
			if item.WatchStartedAt != nil && !item.WatchStartedAt.IsZero() {
				at = *item.WatchStartedAt
			}
			if at.IsZero() {
				at = item.CreatedAt
			}
			events = append(events, withTimelineEvidence(serviceTimelineEvent{
				ID:          fmt.Sprintf("change-deploy-%d", item.ID),
				Kind:        "deployment",
				Label:       "Deployment",
				Summary:     firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)) + " " + strings.ReplaceAll(status, "_", " "),
				Detail:      "Recorded on the change. Commit " + shortRevision(item.SHA) + ".",
				At:          at.UTC().Format(time.RFC3339),
				Environment: env,
				Tone:        timelineTone("deployment", status),
			}, changeHref, "Change record"))
		}
	}

	for _, attempt := range attempts {
		observed := strings.TrimSpace(attempt.ObservedAt)
		if observed == "" || !strings.EqualFold(strings.TrimSpace(attempt.State), "success") {
			continue
		}
		env := firstNonEmpty(attempt.Environment, "Unknown")
		events = append(events, withTimelineEvidence(serviceTimelineEvent{
			ID:          fmt.Sprintf("attempt-%d", attempt.ID),
			Kind:        "deployment",
			Label:       "Runtime observation",
			Summary:     "Observed " + shortRevision(attempt.CommitSHA),
			Detail:      "Image " + shortRevision(attempt.ImageDigest) + ". This is an observation, not a proven cause of later alerts.",
			At:          observed,
			Environment: env,
			Tone:        "info",
		}, "/pipelines?environment="+env, "Pipeline observation"))
	}

	for _, finding := range findings {
		at := firstNonEmpty(finding.LastSeenAt, finding.FirstSeenAt)
		if at == "" {
			continue
		}
		href := fmt.Sprintf("/services/%d?tab=findings&finding_id=%d", service.ID, finding.ID)
		events = append(events, withTimelineEvidence(serviceTimelineEvent{
			ID:          fmt.Sprintf("alert-%d", finding.ID),
			Kind:        "alert",
			Label:       "Alert",
			Summary:     firstNonEmpty(finding.Title, "Monitor finding"),
			Detail:      firstNonEmpty(finding.Explanation, finding.Observed),
			At:          at,
			Environment: firstNonEmpty(finding.Environment, "Unknown"),
			Tone:        "warn",
		}, href, "Monitor finding"))
	}

	for _, incident := range incidents {
		at := incident.CreatedAt
		if at.IsZero() {
			at = incident.UpdatedAt
		}
		detail := firstNonEmpty(incident.Summary, "Incident")
		if strings.TrimSpace(incident.SuspectedChangeNumber) != "" {
			detail += ". Suspected change " + incident.SuspectedChangeNumber + ". That link is not a confirmed cause."
		}
		href := fmt.Sprintf("/incidents/%d/edit", incident.ID)
		events = append(events, withTimelineEvidence(serviceTimelineEvent{
			ID:          fmt.Sprintf("incident-%d", incident.ID),
			Kind:        "incident",
			Label:       "Incident",
			Summary:     firstNonEmpty(incident.IncidentNumber, fmt.Sprintf("INC%d", incident.ID)),
			Detail:      detail,
			At:          at.UTC().Format(time.RFC3339),
			Environment: firstNonEmpty(incident.Environment, incident.RequestEnv, "Unknown"),
			Tone:        timelineTone("incident", incident.Status),
		}, href, "Incident record"))
	}

	for _, budget := range slos {
		if budget.Samples <= 0 || (budget.Breaching <= 0 && !budget.Burned) {
			continue
		}
		windowDays := budget.WindowDays
		if windowDays <= 0 {
			windowDays = 30
		}
		samples, _ := listWatchSamplesForService(budget.Service, budget.Environment, time.Now().AddDate(0, 0, -windowDays))
		at := latestSLOBreachAt(budget.serviceSLO, samples)
		if at.IsZero() {
			continue
		}
		summary := firstNonEmpty(budget.FreezeReason, "Error budget burning")
		if !budget.Burned {
			summary = fmt.Sprintf("%d of %d samples breached the SLO", budget.Breaching, budget.Samples)
		}
		href := "/slos?q=" + budget.Service
		events = append(events, withTimelineEvidence(serviceTimelineEvent{
			ID:          fmt.Sprintf("slo-%d", budget.ID),
			Kind:        "slo",
			Label:       "SLO breach",
			Summary:     summary,
			Detail:      "Missing telemetry stays Unknown. A burned budget is not a proven cause of an incident.",
			At:          at.UTC().Format(time.RFC3339),
			Environment: firstNonEmpty(budget.Environment, "Unknown"),
			Tone:        timelineTone("slo", ""),
		}, href, "SLO object"))
	}

	sort.SliceStable(events, func(i, j int) bool {
		left, right := eventTime(events[i]), eventTime(events[j])
		if left.Equal(right) {
			return events[i].ID > events[j].ID
		}
		return left.After(right)
	})
	events = filterTimelineByEnvironment(events, environment)
	if len(events) > serviceTimelineMaxEvents {
		events = events[:serviceTimelineMaxEvents]
	}
	labelTimelineCorrelations(events)

	return serviceActivityTimeline{
		Service:     service.Service,
		Note:        serviceTimelineNote,
		EvaluatedAt: now.Format(time.RFC3339),
		Events:      events,
	}
}

func latestSLOBreachAt(slo serviceSLO, samples []serviceMetrics) time.Time {
	var latest time.Time
	for _, sample := range samples {
		breach := false
		if slo.ErrorRatio > 0 && sample.ErrorRatio > slo.ErrorRatio {
			breach = true
		}
		if slo.LatencyP95Ms > 0 && sample.P95Ms > slo.LatencyP95Ms {
			breach = true
		}
		if breach && sample.TakenAt.After(latest) {
			latest = sample.TakenAt
		}
	}
	return latest
}

func filterTimelineByEnvironment(events []serviceTimelineEvent, environment string) []serviceTimelineEvent {
	if strings.TrimSpace(environment) == "" {
		return events
	}
	out := make([]serviceTimelineEvent, 0, len(events))
	for _, event := range events {
		if workspaceEnvironmentMatches(event.Environment, environment) {
			out = append(out, event)
		}
	}
	return out
}

func labelTimelineCorrelations(events []serviceTimelineEvent) {
	for i := range events {
		left := eventTime(events[i])
		if left.IsZero() {
			continue
		}
		var nearby []string
		for j := range events {
			if i == j {
				continue
			}
			right := eventTime(events[j])
			if right.IsZero() {
				continue
			}
			delta := left.Sub(right)
			if delta < 0 {
				delta = -delta
			}
			if delta > serviceTimelineProximity {
				continue
			}
			if events[i].Kind == events[j].Kind {
				continue
			}
			nearby = append(nearby, events[j].Label)
			if len(nearby) >= 2 {
				break
			}
		}
		if len(nearby) == 0 {
			continue
		}
		events[i].CorrelationNote = "Nearby in time with " + strings.Join(nearby, " and ") + ". This is correlation, not a proven cause."
	}
}

func listIncidentsForService(service string, projectID int) []requestIncident {
	service = strings.ToLower(strings.TrimSpace(service))
	items, err := listRequestIncidents("")
	if err != nil || len(items) == 0 {
		return []requestIncident{}
	}
	out := make([]requestIncident, 0, 16)
	for _, item := range items {
		named := strings.ToLower(strings.TrimSpace(firstNonEmpty(item.Service, item.RequestService)))
		if service != "" && named != service {
			continue
		}
		if projectID > 0 && item.ProjectID != nil && *item.ProjectID != projectID {
			continue
		}
		out = append(out, item)
	}
	return out
}

func listObservedAttemptsForService(service serviceMapEntry, siblings []serviceMapEntry) []deploymentAttempt {
	seen := map[string]bool{}
	out := []deploymentAttempt{}
	consider := append([]serviceMapEntry{service}, siblings...)
	for _, item := range consider {
		projectID := 0
		if item.ProjectID != nil {
			projectID = *item.ProjectID
		} else if service.ProjectID != nil {
			projectID = *service.ProjectID
		}
		env := strings.ToLower(strings.TrimSpace(item.Environment))
		if projectID <= 0 || env == "" || seen[fmt.Sprintf("%d:%s", projectID, env)] {
			continue
		}
		seen[fmt.Sprintf("%d:%s", projectID, env)] = true
		history, err := listDeploymentAttempts(projectID, env)
		if err != nil {
			continue
		}
		out = append(out, history...)
	}
	return out
}

func serveServiceActivityTimeline(w http.ResponseWriter, r *http.Request, service *serviceMapEntry) {
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID := 0
	if service.ProjectID != nil {
		projectID = *service.ProjectID
	}
	siblings := listServiceSiblings(*service)
	changes := listChangeRequestsForService(projectID, service.Service)
	incidents := listIncidentsForService(service.Service, projectID)
	findings, _ := listMonitorFindings(service.ID, "", "", "")
	attempts := listObservedAttemptsForService(*service, siblings)
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	if environment == "" {
		environment = strings.TrimSpace(service.Environment)
	}
	slos, _ := listServiceSLOBudgets(projectID, environment)
	timeline := buildServiceActivityTimeline(*service, changes, incidents, findings, attempts, slos, environment)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"timeline": timeline,
		"status":   "ok",
	})
}
