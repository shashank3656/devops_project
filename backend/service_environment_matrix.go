package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

type environmentVersionRow struct {
	Environment  string   `json:"environment"`
	CommitSHA    string   `json:"commit_sha"`
	ImageDigest  string   `json:"image_digest"`
	ObservedAt   string   `json:"observed_at,omitempty"`
	Source       string   `json:"source"`
	SourceLabel  string   `json:"source_label"`
	ChangeID     int      `json:"change_id,omitempty"`
	ChangeNumber string   `json:"change_number,omitempty"`
	ChangeStatus string   `json:"change_status,omitempty"`
	OwnerTeam    string   `json:"owner_team,omitempty"`
	Repository   string   `json:"repository,omitempty"`
	Differences  []string `json:"differences,omitempty"`
	Comparable   bool     `json:"comparable"`
}

type environmentVersionMatrix struct {
	Service     string                  `json:"service"`
	Note        string                  `json:"note"`
	EvaluatedAt string                  `json:"evaluated_at"`
	Rows        []environmentVersionRow `json:"rows"`
}

const environmentVersionNote = "This matrix shows the last observed commit and image for each recorded environment. A recorded change is not a runtime observation. Missing values stay Unknown. Environment is taken from the stored field, not the title."

func canonicalEnvironmentKey(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "dev", "development":
		return "dev"
	case "uat", "staging", "stage":
		return "uat"
	case "prod", "production":
		return "prod"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func displayEnvironmentName(key, recorded string) string {
	recorded = strings.TrimSpace(recorded)
	if recorded != "" && !strings.EqualFold(recorded, "unspecified") && !strings.EqualFold(recorded, "unknown") {
		return recorded
	}
	switch key {
	case "dev":
		return "dev"
	case "uat":
		return "uat"
	case "prod":
		return "prod"
	default:
		return "Unknown"
	}
}

func maskRevision(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	if strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "bearer") {
		return "Hidden"
	}
	if strings.HasPrefix(lower, "manual-") || strings.HasPrefix(lower, "manual_") {
		return "Manual reference " + text
	}
	return text
}

func shortRevision(value string) string {
	text := maskRevision(value)
	if text == "" {
		return "Unknown"
	}
	if strings.HasPrefix(text, "Manual reference ") || text == "Hidden" {
		return text
	}
	if len(text) > 12 {
		return text[:12]
	}
	return text
}

func sameRevision(left, right string) bool {
	a := strings.ToLower(strings.TrimSpace(left))
	b := strings.ToLower(strings.TrimSpace(right))
	if a == "" || b == "" || a == "unknown" || b == "unknown" || a == "hidden" || b == "hidden" {
		return false
	}
	if strings.HasPrefix(a, "manual") || strings.HasPrefix(b, "manual") {
		return false
	}
	if a == b {
		return true
	}
	min := 7
	if len(a) < min || len(b) < min {
		return false
	}
	if len(a) > 12 {
		a = a[:12]
	}
	if len(b) > 12 {
		b = b[:12]
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

func latestSuccessfulAttempt(projectID int, environment string) *deploymentAttempt {
	if projectID <= 0 || strings.TrimSpace(environment) == "" {
		return nil
	}
	history, err := listDeploymentAttempts(projectID, strings.ToLower(strings.TrimSpace(environment)))
	if err != nil || len(history) == 0 {
		return nil
	}
	for i := len(history) - 1; i >= 0; i-- {
		item := history[i]
		sha := strings.TrimSpace(item.CommitSHA)
		digest := strings.TrimSpace(item.ImageDigest)
		observed := strings.TrimSpace(item.ObservedAt)
		if !strings.EqualFold(strings.TrimSpace(item.State), "success") || observed == "" || sha == "" || digest == "" || sha == digest {
			continue
		}
		copy := item
		return &copy
	}
	return nil
}

func latestChangeForEnvironment(changes []changeRequestRecord, environment string) *changeRequestRecord {
	want := canonicalEnvironmentKey(environment)
	var best *changeRequestRecord
	for i := range changes {
		item := changes[i]
		if canonicalEnvironmentKey(item.Environment) != want {
			continue
		}
		if best == nil || item.UpdatedAt.After(best.UpdatedAt) || (item.UpdatedAt.Equal(best.UpdatedAt) && item.ID > best.ID) {
			copy := item
			best = &copy
		}
	}
	return best
}

func buildEnvironmentVersionMatrix(service serviceMapEntry, siblings []serviceMapEntry, changes []changeRequestRecord) environmentVersionMatrix {
	now := time.Now().UTC()
	keys := []string{"dev", "uat", "prod"}
	seen := map[string]string{"dev": "dev", "uat": "uat", "prod": "prod"}
	remember := func(raw string) {
		key := canonicalEnvironmentKey(raw)
		if key == "" || key == "unspecified" || key == "unknown" {
			return
		}
		if _, ok := seen[key]; ok {
			if recorded := strings.TrimSpace(raw); recorded != "" && (seen[key] == key || len(recorded) > len(seen[key])) {
				if !strings.EqualFold(raw, key) {
					seen[key] = strings.TrimSpace(raw)
				}
			}
			return
		}
		seen[key] = strings.TrimSpace(raw)
		keys = append(keys, key)
	}
	remember(service.Environment)
	for _, sibling := range siblings {
		remember(sibling.Environment)
	}
	for _, change := range changes {
		remember(change.Environment)
	}

	byKey := map[string]serviceMapEntry{}
	for _, sibling := range siblings {
		key := canonicalEnvironmentKey(sibling.Environment)
		if key == "" {
			continue
		}
		if _, ok := byKey[key]; !ok {
			byKey[key] = sibling
		}
	}
	serviceKey := canonicalEnvironmentKey(service.Environment)
	if serviceKey != "" {
		byKey[serviceKey] = service
	}

	rows := make([]environmentVersionRow, 0, len(keys))
	for _, key := range keys {
		recorded := seen[key]
		sibling := byKey[key]
		row := environmentVersionRow{
			Environment: displayEnvironmentName(key, firstNonEmpty(sibling.Environment, recorded)),
			CommitSHA:   "Unknown",
			ImageDigest: "Unknown",
			Source:      "unknown",
			SourceLabel: "No runtime observation or recorded change",
			OwnerTeam:   firstNonEmpty(sibling.Team, service.Team, "Not assigned"),
			Repository:  firstNonEmpty(sibling.Repo, service.Repo, "Unknown"),
		}
		projectID := 0
		if sibling.ProjectID != nil && *sibling.ProjectID > 0 {
			projectID = *sibling.ProjectID
		} else if service.ProjectID != nil && *service.ProjectID > 0 {
			projectID = *service.ProjectID
		}
		if attempt := latestSuccessfulAttempt(projectID, firstNonEmpty(sibling.Environment, recorded, key)); attempt != nil {
			row.CommitSHA = maskRevision(attempt.CommitSHA)
			row.ImageDigest = maskRevision(attempt.ImageDigest)
			row.ObservedAt = strings.TrimSpace(attempt.ObservedAt)
			row.Source = "runtime_observation"
			row.SourceLabel = "Runtime observation"
			row.Comparable = row.CommitSHA != "Unknown" && row.CommitSHA != "Hidden"
		} else if change := latestChangeForEnvironment(changes, key); change != nil {
			sha := maskRevision(change.SHA)
			digest := maskRevision(change.ImageDigest)
			if sha == "" {
				sha = "Unknown"
			}
			if digest == "" {
				digest = "Unknown"
			}
			row.CommitSHA = sha
			row.ImageDigest = digest
			if !change.UpdatedAt.IsZero() {
				row.ObservedAt = change.UpdatedAt.UTC().Format(time.RFC3339)
			}
			row.ChangeID = change.ID
			row.ChangeNumber = change.ChangeNumber
			row.ChangeStatus = change.Status
			row.Source = "recorded_change"
			row.SourceLabel = "Recorded change, not a runtime observation"
			row.Comparable = sha != "Unknown" && sha != "Hidden" && !strings.HasPrefix(sha, "Manual reference")
		}
		rows = append(rows, row)
	}

	for i := range rows {
		left := rows[i]
		if !left.Comparable {
			if left.Source == "unknown" {
				rows[i].Differences = []string{"Unknown"}
			}
			continue
		}
		var diffs []string
		for j := range rows {
			if i == j || !rows[j].Comparable {
				continue
			}
			if !sameRevision(left.CommitSHA, rows[j].CommitSHA) {
				diffs = append(diffs, fmt.Sprintf("Commit differs from %s (%s)", rows[j].Environment, shortRevision(rows[j].CommitSHA)))
			}
			if left.ImageDigest != "Unknown" && left.ImageDigest != "Hidden" && rows[j].ImageDigest != "Unknown" && rows[j].ImageDigest != "Hidden" && !sameRevision(left.ImageDigest, rows[j].ImageDigest) {
				diffs = append(diffs, fmt.Sprintf("Image differs from %s", rows[j].Environment))
			}
		}
		rows[i].Differences = diffs
	}

	return environmentVersionMatrix{
		Service:     service.Service,
		Note:        environmentVersionNote,
		EvaluatedAt: now.Format(time.RFC3339),
		Rows:        rows,
	}
}

func listChangeRequestsForService(projectID int, service string) []changeRequestRecord {
	service = strings.ToLower(strings.TrimSpace(service))
	items, err := listChangeRequests(projectID, "", "", "")
	if err != nil || len(items) == 0 {
		return []changeRequestRecord{}
	}
	out := make([]changeRequestRecord, 0, len(items))
	for _, item := range items {
		if service != "" && !strings.EqualFold(strings.TrimSpace(item.Service), service) {
			continue
		}
		out = append(out, item)
	}
	return out
}

func listServiceSiblings(service serviceMapEntry) []serviceMapEntry {
	projectID := 0
	if service.ProjectID != nil {
		projectID = *service.ProjectID
	}
	items, err := listServiceMap(projectID, "", service.Service)
	if err != nil {
		return []serviceMapEntry{service}
	}
	out := make([]serviceMapEntry, 0, len(items))
	for _, item := range items {
		if !strings.EqualFold(item.Service, service.Service) {
			continue
		}
		if projectID > 0 && item.ProjectID != nil && *item.ProjectID != projectID {
			continue
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return []serviceMapEntry{service}
	}
	return out
}

func serveServiceEnvironmentMatrix(w http.ResponseWriter, r *http.Request, service *serviceMapEntry) {
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
	matrix := buildEnvironmentVersionMatrix(*service, siblings, changes)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"matrix": matrix,
		"status": "ok",
	})
}
