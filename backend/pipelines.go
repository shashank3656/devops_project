package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

const pipelineStaleAfter = 24 * time.Hour

type pipelineCatalogRow struct {
	ID              int    `json:"id"`
	ChangeNumber    string `json:"change_number"`
	Repo            string `json:"repo"`
	Service         string `json:"service"`
	Environment     string `json:"environment"`
	Status          string `json:"status"`
	PipelineURL     string `json:"pipeline_url,omitempty"`
	PipelineLabel   string `json:"pipeline_label"`
	SHA             string `json:"sha,omitempty"`
	Title           string `json:"title"`
	ChangeType      string `json:"change_type"`
	UpdatedAt       string `json:"updated_at"`
	LastChecked     string `json:"last_checked"`
	DurationMinutes int    `json:"duration_minutes"`
	DurationKnown   bool   `json:"duration_known"`
	Stale           bool   `json:"stale"`
	Preview         bool   `json:"preview"`
}

func pipelineLabelForChange(item changeRequestRecord) string {
	if strings.TrimSpace(item.PipelineURL) == "" {
		return "Unknown"
	}
	switch strings.ToLower(strings.TrimSpace(item.Status)) {
	case "failed":
		return "Failed"
	case "implementing", "monitoring":
		return "Running"
	case "implemented", "resolved", "closed":
		return "Succeeded"
	case "cancelled":
		return "Cancelled"
	default:
		return "Posted"
	}
}

func pipelineFreshness(item changeRequestRecord, label string, now time.Time) (minutes int, known bool, lastChecked time.Time, stale bool) {
	updated := item.UpdatedAt
	if updated.IsZero() {
		updated = item.CreatedAt
	}
	lastChecked = updated
	created := item.CreatedAt
	if created.IsZero() {
		created = updated
	}
	if created.IsZero() {
		return 0, false, lastChecked, false
	}
	end := updated
	if end.IsZero() || strings.EqualFold(label, "Running") || strings.EqualFold(label, "Posted") {
		end = now
	}
	if end.Before(created) {
		end = created
	}
	minutes = int(end.Sub(created).Minutes())
	if strings.EqualFold(label, "Running") || strings.EqualFold(label, "Posted") {
		stale = now.Sub(updated) > pipelineStaleAfter
	}
	return minutes, true, lastChecked, stale
}

func listPipelineCatalog(projectID int, environment string) []pipelineCatalogRow {
	environment = strings.TrimSpace(environment)
	if strings.EqualFold(environment, "all") {
		environment = ""
	}
	items, err := listChangeRequests(projectID, environment, "", "")
	if err != nil || len(items) == 0 {
		return []pipelineCatalogRow{}
	}
	now := time.Now().UTC()
	out := make([]pipelineCatalogRow, 0, 80)
	for _, item := range items {
		preview := strings.EqualFold(item.ChangeType, "preview")
		if strings.TrimSpace(item.PipelineURL) == "" && !preview {
			continue
		}
		sha := strings.TrimSpace(item.SHA)
		lower := strings.ToLower(sha)
		if strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "bearer") {
			sha = "Hidden"
		} else if len(sha) > 12 {
			sha = sha[:12]
		}
		label := pipelineLabelForChange(item)
		minutes, known, lastChecked, stale := pipelineFreshness(item, label, now)
		if lastChecked.IsZero() {
			lastChecked = item.UpdatedAt
		}
		if lastChecked.IsZero() {
			lastChecked = item.CreatedAt
		}
		checked := ""
		if !lastChecked.IsZero() {
			checked = lastChecked.UTC().Format(time.RFC3339)
		}
		out = append(out, pipelineCatalogRow{
			ID:              item.ID,
			ChangeNumber:    item.ChangeNumber,
			Repo:            item.Repo,
			Service:         item.Service,
			Environment:     firstNonEmpty(item.Environment, "Unknown"),
			Status:          item.Status,
			PipelineURL:     strings.TrimSpace(item.PipelineURL),
			PipelineLabel:   label,
			SHA:             sha,
			Title:           firstNonEmpty(item.Title, item.ChangeNumber),
			ChangeType:      item.ChangeType,
			UpdatedAt:       checked,
			LastChecked:     checked,
			DurationMinutes: minutes,
			DurationKnown:   known,
			Stale:           stale,
			Preview:         preview,
		})
		if len(out) >= 80 {
			break
		}
	}
	return out
}

func devopsPipelinesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"pipelines":   listPipelineCatalog(projectID, environment),
		"status":      "ok",
		"environment": environment,
		"project_id":  projectID,
		"scope_note":  "Environment comes from the recorded change, not the run title.",
		"stale_after": "24h",
		"note":        "Pipelines are CI runs posted onto a change. A missing pipeline URL stays Unknown. A preview environment is a separate catalog.",
	})
}
