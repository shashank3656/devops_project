package main

import (
	"net/http"
	"strings"
	"time"
)

type pipelineCatalogRow struct {
	ID            int    `json:"id"`
	ChangeNumber  string `json:"change_number"`
	Repo          string `json:"repo"`
	Service       string `json:"service"`
	Environment   string `json:"environment"`
	Status        string `json:"status"`
	PipelineURL   string `json:"pipeline_url,omitempty"`
	PipelineLabel string `json:"pipeline_label"`
	SHA           string `json:"sha,omitempty"`
	Title         string `json:"title"`
	ChangeType    string `json:"change_type"`
	UpdatedAt     string `json:"updated_at"`
	Preview       bool   `json:"preview"`
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

func listPipelineCatalog() []pipelineCatalogRow {
	items, err := listChangeRequests(0, "", "", "")
	if err != nil || len(items) == 0 {
		return []pipelineCatalogRow{}
	}
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
		updated := item.UpdatedAt
		if updated.IsZero() {
			updated = item.CreatedAt
		}
		out = append(out, pipelineCatalogRow{
			ID:            item.ID,
			ChangeNumber:  item.ChangeNumber,
			Repo:          item.Repo,
			Service:       item.Service,
			Environment:   item.Environment,
			Status:        item.Status,
			PipelineURL:   strings.TrimSpace(item.PipelineURL),
			PipelineLabel: pipelineLabelForChange(item),
			SHA:           sha,
			Title:         firstNonEmpty(item.Title, item.ChangeNumber),
			ChangeType:    item.ChangeType,
			UpdatedAt:     updated.UTC().Format(time.RFC3339),
			Preview:       preview,
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
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"pipelines": listPipelineCatalog(),
		"status":    "ok",
		"note":      "Pipelines are CI runs posted onto a change. A missing pipeline URL stays Unknown. A preview environment is a separate catalog.",
	})
}
