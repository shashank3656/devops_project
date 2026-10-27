package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type portalAccessRequest struct {
	ID           int    `json:"id"`
	Username     string `json:"username"`
	Team         string `json:"team,omitempty"`
	Project      string `json:"project,omitempty"`
	AccessNeeded string `json:"access_needed,omitempty"`
	Reason       string `json:"reason,omitempty"`
	CreatedAt    string `json:"created_at,omitempty"`
}

func ensurePortalAccessRequestsTable() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS portal_access_requests (
			id SERIAL PRIMARY KEY,
			username VARCHAR(80) NOT NULL,
			team VARCHAR(80) NOT NULL DEFAULT '',
			project VARCHAR(80) NOT NULL DEFAULT '',
			access_needed VARCHAR(40) NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func clipAccessField(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func publicAccessRequestHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		Username     string `json:"username"`
		Team         string `json:"team"`
		Project      string `json:"project"`
		AccessNeeded string `json:"access_needed"`
		Reason       string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	username := clipAccessField(body.Username, 80)
	if username == "" {
		writeAPIError(w, r, http.StatusBadRequest, "username is required", nil)
		return
	}
	ensurePortalAccessRequestsTable()
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "access requests are unavailable", nil)
		return
	}
	item := portalAccessRequest{
		Username:     username,
		Team:         clipAccessField(body.Team, 80),
		Project:      clipAccessField(body.Project, 80),
		AccessNeeded: clipAccessField(body.AccessNeeded, 40),
		Reason:       clipAccessField(body.Reason, 500),
	}
	var created time.Time
	if err := DB.QueryRow(`
		INSERT INTO portal_access_requests (username, team, project, access_needed, reason)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at
	`, item.Username, item.Team, item.Project, item.AccessNeeded, item.Reason).Scan(&item.ID, &created); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "could not save the access request", err)
		return
	}
	item.CreatedAt = created.UTC().Format(time.RFC3339)
	_ = writeJSONResponse(w, http.StatusCreated, map[string]any{
		"request": item,
		"status":  "ok",
		"note":    "An administrator reviews this request. This is not a sign-up.",
	})
}

func adminAccessRequestsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	ensurePortalAccessRequestsTable()
	if DB == nil {
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"requests": []portalAccessRequest{}, "status": "ok"})
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, username, team, project, access_needed, reason, created_at
		FROM portal_access_requests
		ORDER BY id DESC
		LIMIT 100
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			_ = writeJSONResponse(w, http.StatusOK, map[string]any{"requests": []portalAccessRequest{}, "status": "ok"})
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list access requests", err)
		return
	}
	defer cancel()
	defer rows.Close()
	items := []portalAccessRequest{}
	for rows.Next() {
		var item portalAccessRequest
		var created time.Time
		if err := rows.Scan(&item.ID, &item.Username, &item.Team, &item.Project, &item.AccessNeeded, &item.Reason, &created); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list access requests", err)
			return
		}
		item.CreatedAt = created.UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"requests": items, "status": "ok"})
}
