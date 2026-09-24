package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"
)

type releaseNoteItem struct {
	ChangeNumber string   `json:"change_number"`
	Title        string   `json:"title"`
	Service      string   `json:"service"`
	Repo         string   `json:"repo"`
	SHA          string   `json:"sha"`
	Author       string   `json:"author,omitempty"`
	PRNumber     int      `json:"pr_number,omitempty"`
	Environment  string   `json:"environment"`
	ClosedAt     string   `json:"closed_at"`
	Files        []string `json:"files,omitempty"`
}

type releaseNotesPayload struct {
	From      string                       `json:"from"`
	To        string                       `json:"to"`
	Count     int                          `json:"count"`
	ByService map[string][]releaseNoteItem `json:"by_service"`
	Items     []releaseNoteItem            `json:"items"`
}

func buildReleaseNotes(from, to time.Time) (*releaseNotesPayload, error) {
	items, err := listChangeRequests(0, "", "", "")
	if err != nil {
		return nil, err
	}
	notes := []releaseNoteItem{}
	grouped := map[string][]releaseNoteItem{}
	for _, item := range items {
		status := strings.ToLower(item.Status)
		if status != "closed" && status != "resolved" && status != "monitoring" && status != "implemented" {
			continue
		}
		stamp := item.UpdatedAt
		if stamp.IsZero() {
			stamp = item.CreatedAt
		}
		if stamp.Before(from) || stamp.After(to) {
			continue
		}
		note := releaseNoteItem{
			ChangeNumber: item.ChangeNumber,
			Title:        firstNonEmpty(item.Title, item.ChangeNumber),
			Service:      firstNonEmpty(item.Service, item.Repo),
			Repo:         item.Repo,
			SHA:          item.SHA,
			Author:       item.Author,
			PRNumber:     item.PRNumber,
			Environment:  item.Environment,
			ClosedAt:     stamp.Format(time.RFC3339),
			Files:        item.Files,
		}
		notes = append(notes, note)
		key := note.Service
		grouped[key] = append(grouped[key], note)
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].ClosedAt > notes[j].ClosedAt })
	return &releaseNotesPayload{
		From:      from.Format(time.RFC3339),
		To:        to.Format(time.RFC3339),
		Count:     len(notes),
		ByService: grouped,
		Items:     notes,
	}, nil
}

func devopsReleaseNotesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	now := time.Now()
	from := now.AddDate(0, 0, -7)
	to := now
	if raw := strings.TrimSpace(r.URL.Query().Get("from")); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			from = parsed
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("to")); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			to = parsed
		}
	}
	payload, err := buildReleaseNotes(from, to)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build release notes", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"release_notes": payload, "status": "ok"})
}
