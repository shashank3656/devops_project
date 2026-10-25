package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func oncallHandoverHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/oncall/handovers"), "/")
	if rest == "" {
		switch r.Method {
		case http.MethodGet:
			teamID, _ := strconv.Atoi(r.URL.Query().Get("team_id"))
			projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
			items, summary, err := listHandovers(userID, teamID, projectID, r.URL.Query().Get("state"), r.URL.Query().Get("shift_date"))
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Handovers could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"handovers": items, "summary": summary, "timezones": oncallTimezones, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r)
		}
		return
	}
	if rest == "generate" {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r)
			return
		}
		var body struct {
			TeamID    int    `json:"team_id"`
			ProjectID int    `json:"project_id"`
			Timezone  string `json:"timezone"`
			ShiftDate string `json:"shift_date"`
			Notes     string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err.Error() != "EOF" {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.Timezone == "" {
			body.Timezone = "Asia/Kolkata"
		}
		if body.TeamID <= 0 {
			items, err := generateHandoversForVisibleTeams(userID, body.Timezone, body.ShiftDate)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "Handovers could not be generated.", err)
				return
			}
			writeJSON(w, http.StatusAccepted, map[string]any{"handovers": items, "status": "ok"})
			return
		}
		item, err := generateHandover(userID, body.TeamID, body.ProjectID, body.Timezone, body.ShiftDate, body.Notes)
		if err != nil {
			status := http.StatusBadRequest
			if err == errHandoverDenied {
				status = http.StatusForbidden
			}
			writeAPIError(w, r, status, "That handover could not be generated.", err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"handover": item, "status": "ok"})
		return
	}
	parts := strings.Split(rest, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown handover.", nil)
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch {
	case action == "" && r.Method == http.MethodGet:
		item, getErr := getHandover(id, userID)
		if getErr != nil {
			status := http.StatusNotFound
			if getErr == errHandoverDenied {
				status = http.StatusForbidden
			}
			writeAPIError(w, r, status, "That handover is not available.", getErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"handover": item, "status": "ok"})
	case action == "draft" && r.Method == http.MethodPatch:
		var body struct {
			Notes          string `json:"notes"`
			IncomingUserID int    `json:"incoming_user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, updErr := updateHandoverDraft(id, userID, body.Notes, body.IncomingUserID)
		writeHandoverMutation(w, r, item, updErr, "The draft could not be saved.")
	case action == "submit" && r.Method == http.MethodPost:
		item, subErr := submitHandover(id, userID)
		writeHandoverMutation(w, r, item, subErr, "The handover could not be submitted.")
	case action == "acknowledge" && r.Method == http.MethodPost:
		var body struct {
			ExpectedRevision int               `json:"expected_revision"`
			ReviewedItemIDs  []int             `json:"reviewed_item_ids"`
			Reasons          map[string]string `json:"reasons"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, ackErr := acknowledgeHandover(id, userID, body.ExpectedRevision, body.ReviewedItemIDs, body.Reasons)
		writeHandoverMutation(w, r, item, ackErr, "The handover could not be acknowledged.")
	case action == "cancel" && r.Method == http.MethodPost:
		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, cancelErr := cancelHandover(id, userID, body.Reason)
		writeHandoverMutation(w, r, item, cancelErr, "The handover could not be cancelled.")
	case action == "revise" && r.Method == http.MethodPost:
		var body struct {
			Notes string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, revErr := reopenHandoverAfterEdit(id, userID, body.Notes)
		writeHandoverMutation(w, r, item, revErr, "The handover could not be revised.")
	case action == "actions" && r.Method == http.MethodPost:
		var body struct {
			ID         int    `json:"id"`
			Title      string `json:"title"`
			SourceType string `json:"source_type"`
			SourceID   int    `json:"source_id"`
			SourceRef  string `json:"source_ref"`
			OwnerName  string `json:"owner_name"`
			NextAction string `json:"next_action"`
			Status     string `json:"status"`
			DueAt      string `json:"due_at"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		var due *time.Time
		if strings.TrimSpace(body.DueAt) != "" {
			if parsed, parseErr := time.Parse(time.RFC3339, body.DueAt); parseErr == nil {
				due = &parsed
			}
		}
		item, actErr := upsertHandoverAction(id, userID, body.ID, body.Title, body.SourceType, body.SourceRef, body.OwnerName, body.NextAction, body.Status, body.SourceID, due)
		writeHandoverMutation(w, r, item, actErr, "The action could not be saved.")
	default:
		writeMethodNotAllowed(w, r)
	}
}

func writeHandoverMutation(w http.ResponseWriter, r *http.Request, item handoverView, err error, fallback string) {
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case errHandoverDenied:
			status = http.StatusForbidden
		case errHandoverNotFound:
			status = http.StatusNotFound
		case errHandoverConflict:
			status = http.StatusConflict
		case errHandoverState:
			status = http.StatusConflict
		}
		writeAPIError(w, r, status, fallback, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"handover": item, "status": "ok"})
}

func startOncallHandoverWorker() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		generateDueHandoverDrafts(time.Now().UTC())
		escalateOverdueHandovers(time.Now().UTC())
		for range ticker.C {
			generateDueHandoverDrafts(time.Now().UTC())
			escalateOverdueHandovers(time.Now().UTC())
		}
	}()
}
