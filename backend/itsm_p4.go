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

func userCanAuthorizeChange(userID int) bool {
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(user.Role), "admin") {
		return true
	}
	if user.IsPortalManager {
		return true
	}
	if user.UserType == "devops_user" {
		return true
	}
	if prof, err := GetDevopsProfile(userID); err == nil && prof != nil && prof.IsManager {
		return true
	}
	return false
}

func approveChangeCAB(id, userID int) (*changeRequestRecord, error) {
	if !userCanAuthorizeChange(userID) {
		return nil, fmt.Errorf("not authorized to approve changes")
	}
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if item.CABStatus == "approved" && normalizeChangeStatus(item.Status) == "scheduled" {
		return item, nil
	}
	if item.CABStatus != "pending" && item.CABStatus != "" {
		return nil, fmt.Errorf("change is not awaiting approval")
	}
	nextStatus := normalizeChangeStatus(item.Status)
	if nextStatus == "new" || nextStatus == "" {
		nextStatus = "scheduled"
	}
	if _, err := execContext(`
		UPDATE change_requests
		SET cab_status = 'approved',
		    cab_approved_by = $2,
		    cab_approved_at = CURRENT_TIMESTAMP,
		    status = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, userID, nextStatus); err != nil {
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

func scheduleChangeRequest(id, userID int) (*changeRequestRecord, error) {
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if normalizeChangeStatus(item.Status) != "new" {
		return nil, fmt.Errorf("only new changes can be scheduled")
	}
	if item.CABStatus == "pending" {
		return nil, fmt.Errorf("approve the change before scheduling")
	}
	return transitionChangeStatus(id, "scheduled")
}

func startChangeImplementation(id, userID int) (*changeRequestRecord, error) {
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if normalizeChangeStatus(item.Status) != "scheduled" {
		return nil, fmt.Errorf("change must be scheduled before implementation")
	}
	return transitionChangeStatus(id, "implementing")
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

func normalizeITSMPriority(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "p1", "1", "critical", "crit", "sev1":
		return "p1"
	case "p2", "2", "high", "sev2":
		return "p2"
	case "p4", "4", "low", "sev4":
		return "p4"
	default:
		return "p3"
	}
}

func itsmPriorityToSeverity(priority string) string {
	switch normalizeITSMPriority(priority) {
	case "p1":
		return "critical"
	case "p2":
		return "high"
	case "p4":
		return "low"
	default:
		return "medium"
	}
}

func severityToITSMPriority(severity string) string {
	return normalizeITSMPriority(severity)
}

func itsmPriorityFromImpactUrgency(impact, urgency string) string {
	rank := func(value string) int {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "1", "high":
			return 1
		case "3", "low":
			return 3
		default:
			return 2
		}
	}
	switch rank(impact) + rank(urgency) {
	case 2:
		return "p1"
	case 3:
		return "p2"
	case 4:
		return "p3"
	default:
		return "p4"
	}
}

func normalizeProblemStatus(value string) string {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), " ", "_")) {
	case "new", "open":
		return "new"
	case "assess", "assessment":
		return "assess"
	case "root_cause_analysis", "rca", "root_cause":
		return "root_cause_analysis"
	case "fix_in_progress", "fix", "implementing":
		return "fix_in_progress"
	case "resolved", "known_error":
		return "resolved"
	case "closed", "complete", "completed":
		return "closed"
	default:
		if value == "" {
			return "new"
		}
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func nextProblemNumber() (string, error) {
	var nextNumber int
	err := queryRowContext(`
		SELECT COALESCE(MAX(CAST(SUBSTRING(problem_number FROM 4) AS INTEGER)), 0) + 1
		FROM problem_records
		WHERE COALESCE(problem_number, '') <> ''
	`).Scan(&nextNumber)
	if err != nil {
		return "", err
	}
	if nextNumber <= 0 {
		nextNumber = 1
	}
	return formatProblemNumber(nextNumber), nil
}
