package main

import (
	"strings"
)

type incidentOwnerPage struct {
	IncidentNumber string   `json:"incident_number"`
	Severity       string   `json:"severity"`
	Service        string   `json:"service,omitempty"`
	Team           string   `json:"team,omitempty"`
	Usernames      []string `json:"usernames,omitempty"`
	Emails         []string `json:"emails,omitempty"`
	Paged          bool     `json:"paged"`
}

func isSEV12(severity string) bool {
	normalized := normalizeAlertSeverity(severity)
	return normalized == "critical" || normalized == "high"
}

func findServiceMapEntry(service string, projectID *int) *serviceMapEntry {
	service = strings.ToLower(strings.TrimSpace(service))
	if service == "" {
		return nil
	}
	pid := 0
	if projectID != nil && *projectID > 0 {
		pid = *projectID
	}
	items, err := listServiceMap(pid, "", service)
	if err != nil {
		return nil
	}
	var fallback *serviceMapEntry
	for i := range items {
		item := items[i]
		if !strings.EqualFold(item.Service, service) {
			continue
		}
		copy := item
		if projectID != nil && item.ProjectID != nil && *item.ProjectID == *projectID {
			return &copy
		}
		if fallback == nil {
			fallback = &copy
		}
	}
	return fallback
}

func shouldPageIncidentOwners(item requestIncident) bool {
	if !isSEV12(item.Severity) {
		return false
	}
	status := normalizeIncidentStatus(item.Status)
	return status == "open" || status == "acknowledged"
}

func buildIncidentOwnerPage(item requestIncident) incidentOwnerPage {
	page := incidentOwnerPage{
		IncidentNumber: firstNonEmpty(item.IncidentNumber, formatIncidentNumber(item.ID)),
		Severity:       item.Severity,
		Service:        firstNonEmpty(item.Service, item.RequestService),
	}
	if !shouldPageIncidentOwners(item) {
		return page
	}
	if svc := findServiceMapEntry(page.Service, item.ProjectID); svc != nil {
		page.Team = strings.TrimSpace(svc.Team)
	}
	if page.Team == "" {
		page.Team = strings.TrimSpace(item.TeamName)
	}
	seen := map[string]bool{}
	addOwner := func(username, email string) {
		username = strings.TrimSpace(username)
		email = strings.TrimSpace(email)
		key := strings.ToLower(firstNonEmpty(email, username))
		if key == "" || seen[key] {
			return
		}
		seen[key] = true
		if username != "" {
			page.Usernames = append(page.Usernames, username)
		}
		if email != "" {
			page.Emails = append(page.Emails, email)
		}
	}
	if team, err := GetTeamByNameOrSlug(page.Team); err == nil && team != nil {
		if members, err := GetTeamMembers(team.ID); err == nil {
			for _, member := range members {
				addOwner(member.Username, member.Email)
			}
		}
	}
	addOwner(item.OwnerUsername, "")
	page.Paged = true
	return page
}

func pageIncidentOwners(item requestIncident) incidentOwnerPage {
	page := buildIncidentOwnerPage(item)
	if !page.Paged {
		return page
	}
	go FireOutboundWebhooks("incident.owner_paged", map[string]interface{}{
		"incident_number": page.IncidentNumber,
		"id":              item.ID,
		"severity":        page.Severity,
		"service":         page.Service,
		"team":            page.Team,
		"usernames":       page.Usernames,
		"emails":          page.Emails,
		"source":          item.Source,
		"title":           item.Summary,
	})
	return page
}

func pageIncidentOwnersIfNewlyOpen(previous *requestIncident, current requestIncident) {
	if !shouldPageIncidentOwners(current) {
		return
	}
	if previous != nil && shouldPageIncidentOwners(*previous) {
		return
	}
	pageIncidentOwners(current)
}
