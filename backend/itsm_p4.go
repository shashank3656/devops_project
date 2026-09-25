package main

import (
	"fmt"
	"strings"
	"time"
)

func normalizeChangeType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "normal":
		return "normal"
	case "emergency", "emerg", "break_fix", "break-fix":
		return "emergency"
	case "preview", "ephemeral", "sandbox":
		return "preview"
	case "flag", "feature_flag", "feature-flag", "flags":
		return "flag"
	default:
		return "standard"
	}
}

func changeRequiresCAB(changeType, environment string) bool {
	return normalizeChangeType(changeType) == "normal" && isHighControlEnvironment(environment)
}

func emergencyRequiresIncident(changeType string, incidentID int, incidentNumber string) bool {
	if normalizeChangeType(changeType) != "emergency" {
		return false
	}
	return incidentID <= 0 && strings.TrimSpace(incidentNumber) == ""
}

func shouldOpenProblem(fingerprint string, incidents []requestIncident, now time.Time) bool {
	print := strings.TrimSpace(fingerprint)
	if print == "" {
		return false
	}
	since := now.Add(-14 * 24 * time.Hour)
	count := 0
	for _, item := range incidents {
		if strings.TrimSpace(item.Fingerprint) != print {
			continue
		}
		seen := item.CreatedAt
		if item.LastSeenAt != nil {
			seen = *item.LastSeenAt
		}
		if seen.Before(since) {
			continue
		}
		count++
		if item.OccurrenceCount > 1 {
			count += item.OccurrenceCount - 1
		}
	}
	return count >= 3
}

func emergencyBypassesFreeze(service, environment string) bool {
	items, err := listChangeRequests(0, environment, "", "")
	if err != nil {
		return emergencyIncidentBypassesFreeze(service, environment)
	}
	now := time.Now()
	for _, item := range items {
		if normalizeChangeType(item.ChangeType) != "emergency" {
			continue
		}
		if service != "" && item.Service != "" && !strings.EqualFold(item.Service, service) {
			continue
		}
		status := strings.ToLower(item.Status)
		if status == "cancelled" || status == "closed" {
			continue
		}
		if changeIsInWatchWindow(item, now) || status == "new" || status == "implementing" || status == "implemented" || status == "monitoring" {
			return true
		}
	}
	return emergencyIncidentBypassesFreeze(service, environment)
}

func resolveLinkedIncidentID(id int, number string) int {
	if id > 0 {
		if item, err := getRequestIncidentByID(id); err == nil && item != nil {
			return item.ID
		}
	}
	trimmed := strings.TrimSpace(number)
	if trimmed == "" {
		return 0
	}
	items, err := listRequestIncidents("")
	if err != nil {
		return 0
	}
	for _, item := range items {
		if strings.EqualFold(item.IncidentNumber, trimmed) {
			return item.ID
		}
	}
	return 0
}

func approveChangeCAB(id, userID int) (*changeRequestRecord, error) {
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if !changeRequiresCAB(item.ChangeType, item.Environment) && item.CABStatus != "pending" {
		return item, nil
	}
	if _, err := execContext(`
		UPDATE change_requests
		SET cab_status = 'approved',
		    cab_approved_by = $2,
		    cab_approved_at = CURRENT_TIMESTAMP,
		    status = CASE WHEN status = 'new' THEN 'implementing' ELSE status END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, userID); err != nil {
		return nil, err
	}
	item, err = getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	applyChangePolicies(id, parsedChangeWebhook{
		Environment: item.Environment,
		ChangeType:  item.ChangeType,
		Service:     item.Service,
		Repo:        item.Repo,
		Impact:      item.Impact,
		Summary:     item.Summary,
	})
	go FireOutboundWebhooks("change.updated", map[string]interface{}{
		"change_id": item.ID, "change_number": item.ChangeNumber, "status": item.Status, "cab_status": item.CABStatus,
	})
	return item, nil
}

func applyMajorIncidentMode(item *requestIncident, major bool, statusNote string) (*requestIncident, error) {
	if item == nil {
		return nil, fmt.Errorf("incident not found")
	}
	note := strings.TrimSpace(statusNote)
	thread := item.SlackThread
	if major && !item.Major {
		text := "Major incident " + item.IncidentNumber + ": " + firstNonEmpty(note, item.Summary)
		SendSlackNotification(text, nil)
		thread = "posted"
		if item.OwnerUserID == nil {
			if owner := activeOncallUserID(); owner != nil {
				_, _ = execContext(`UPDATE request_incidents SET owner_user_id = $2 WHERE id = $1`, item.ID, *owner)
			}
		}
		if strings.EqualFold(item.Severity, "critical") {
			_, _ = execContext(`UPDATE request_incidents SET escalation_level = 'executive' WHERE id = $1`, item.ID)
		}
	}
	if _, err := execContext(`
		UPDATE request_incidents
		SET major = $2, status_note = $3, slack_thread = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, item.ID, major, note, thread); err != nil {
		return nil, err
	}
	return getRequestIncidentByID(item.ID)
}

func causedByChangeCopy(inc requestIncident, change *changeRequestRecord) string {
	if change == nil {
		return ""
	}
	start := change.CreatedAt
	if change.WatchStartedAt != nil {
		start = *change.WatchStartedAt
	}
	lag := int(inc.CreatedAt.Sub(start).Minutes())
	if lag < 0 {
		lag = 0
	}
	extra := ""
	if change.PRNumber > 0 {
		extra = fmt.Sprintf(" (PR %d)", change.PRNumber)
	}
	return fmt.Sprintf("This page started %d min after %s%s.", lag, change.ChangeNumber, extra)
}

func changeBriefFromChangeRequest(item changeRequestRecord) *deployIntelChangeBrief {
	files := make([]prImpactFile, 0, len(item.Files))
	for _, path := range item.Files {
		files = append(files, prImpactFile{Path: path, Category: categorizeChangedPath(path)})
	}
	built := buildChangeBrief(prImpactBrief{
		Title:       item.Title,
		Environment: item.Environment,
		Files:       files,
		FileCount:   len(files),
	})
	return &built
}

func listIncidentsForChange(id int) []requestIncident {
	items, err := listRequestIncidents("")
	if err != nil {
		return nil
	}
	out := []requestIncident{}
	for _, item := range items {
		if item.SuspectedChangeID != nil && *item.SuspectedChangeID == id {
			out = append(out, item)
		}
	}
	return out
}

func formatProblemNumber(id int) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("PRB%07d", id)
}
