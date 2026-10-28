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
	serviceTimelineNote      = "This timeline connects recorded pull requests, approvals, deployments, alerts, and incidents. Nearby timestamps are labelled as correlation, not proven cause."
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
	case "approval":
		return "ok"
	default:
		return "info"
	}
}

func buildServiceActivityTimeline(service serviceMapEntry, changes []changeRequestRecord, incidents []requestIncident, findings []monitorFindingView, attempts []deploymentAttempt) serviceActivityTimeline {
	now := time.Now().UTC()
	events := make([]serviceTimelineEvent, 0, 32)

	for _, item := range changes {
		env := strings.TrimSpace(item.Environment)
		if env == "" || strings.EqualFold(env, "unspecified") {
			env = "Unknown"
		}
		if item.PRNumber > 0 {
			href := item.PRURL
			if strings.TrimSpace(href) == "" {
				href = fmt.Sprintf("/changes/%d", item.ID)
			}
			at := item.CreatedAt
			events = append(events, serviceTimelineEvent{
				ID:          fmt.Sprintf("pr-%d", item.ID),
				Kind:        "pr",
				Label:       "Pull request",
				Summary:     firstNonEmpty(item.Title, fmt.Sprintf("PR #%d", item.PRNumber)),
				Detail:      fmt.Sprintf("%s · PR #%d", firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)), item.PRNumber),
				At:          at.UTC().Format(time.RFC3339),
				Href:        href,
				Environment: env,
				Tone:        "info",
			})
		}
		if item.CABApprovedAt != nil && !item.CABApprovedAt.IsZero() {
			events = append(events, serviceTimelineEvent{
				ID:          fmt.Sprintf("approval-%d", item.ID),
				Kind:        "approval",
				Label:       "Approval",
				Summary:     firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)) + " approved",
				Detail:      firstNonEmpty(item.CABApprovedByUsername, "Recorded change approval"),
				At:          item.CABApprovedAt.UTC().Format(time.RFC3339),
				Href:        fmt.Sprintf("/changes/%d", item.ID),
				Environment: env,
				Tone:        "ok",
			})
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
			events = append(events, serviceTimelineEvent{
				ID:          fmt.Sprintf("change-deploy-%d", item.ID),
				Kind:        "deployment",
				Label:       "Deployment",
				Summary:     firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)) + " " + strings.ReplaceAll(status, "_", " "),
				Detail:      "Recorded on the change. Commit " + shortRevision(item.SHA) + ".",
				At:          at.UTC().Format(time.RFC3339),
				Href:        fmt.Sprintf("/changes/%d", item.ID),
				Environment: env,
				Tone:        timelineTone("deployment", status),
			})
		}
	}

	for _, attempt := range attempts {
		observed := strings.TrimSpace(attempt.ObservedAt)
		if observed == "" || !strings.EqualFold(strings.TrimSpace(attempt.State), "success") {
			continue
		}
		events = append(events, serviceTimelineEvent{
			ID:          fmt.Sprintf("attempt-%d", attempt.ID),
			Kind:        "deployment",
			Label:       "Runtime observation",
			Summary:     "Observed " + shortRevision(attempt.CommitSHA),
			Detail:      "Image " + shortRevision(attempt.ImageDigest) + ". This is an observation, not a proven cause of later alerts.",
			At:          observed,
			Environment: firstNonEmpty(attempt.Environment, "Unknown"),
			Tone:        "info",
		})
	}

	for _, finding := range findings {
		at := firstNonEmpty(finding.LastSeenAt, finding.FirstSeenAt)
		if at == "" {
			continue
		}
		events = append(events, serviceTimelineEvent{
			ID:          fmt.Sprintf("alert-%d", finding.ID),
			Kind:        "alert",
			Label:       "Alert",
			Summary:     firstNonEmpty(finding.Title, "Monitor finding"),
			Detail:      firstNonEmpty(finding.Explanation, finding.Observed),
			At:          at,
			Href:        fmt.Sprintf("/services/%d?tab=findings&finding_id=%d", service.ID, finding.ID),
			Environment: firstNonEmpty(finding.Environment, "Unknown"),
			Tone:        "warn",
		})
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
		events = append(events, serviceTimelineEvent{
			ID:          fmt.Sprintf("incident-%d", incident.ID),
			Kind:        "incident",
			Label:       "Incident",
			Summary:     firstNonEmpty(incident.IncidentNumber, fmt.Sprintf("INC%d", incident.ID)),
			Detail:      detail,
			At:          at.UTC().Format(time.RFC3339),
			Href:        fmt.Sprintf("/incidents/%d/edit", incident.ID),
			Environment: firstNonEmpty(incident.Environment, "Unknown"),
			Tone:        timelineTone("incident", incident.Status),
		})
	}

	sort.SliceStable(events, func(i, j int) bool {
		left, right := eventTime(events[i]), eventTime(events[j])
		if left.Equal(right) {
			return events[i].ID > events[j].ID
		}
		return left.After(right)
	})
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
	timeline := buildServiceActivityTimeline(*service, changes, incidents, findings, attempts)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"timeline": timeline,
		"status":   "ok",
	})
}
