package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func expiryAssetsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/expiry/assets"), "/")
	if rest == "suggestions" {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		writeJSON(w, http.StatusOK, map[string]any{
			"suggestions": suggestExpiryHosts(userID, projectID),
			"note":        "Issued certificates from a manager are not proof the currently served endpoint was observed.",
			"status":      "ok",
		})
		return
	}
	if rest == "ownership" {
		serveExpiryOwnership(w, r)
		return
	}
	if rest == "collectors" {
		serveExpiryCollectors(w, r, userID)
		return
	}
	if rest == "observations" {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		items, err := listExpiryHistory(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Check history could not be loaded.", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"observations": items, "status": "ok"})
		return
	}
	if rest == "" {
		switch r.Method {
		case http.MethodGet:
			items, summary, err := listExpiryAssets(userID, r.URL.Query().Get("type"), r.URL.Query().Get("assessment"), r.URL.Query().Get("service"))
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Certificate and domain records could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"assets": items, "summary": summary, "status": "ok"})
		case http.MethodPost:
			var body struct {
				AssetType         string `json:"asset_type"`
				Input             string `json:"input"`
				Port              int    `json:"port"`
				ProjectID         int    `json:"project_id"`
				TeamID            int    `json:"team_id"`
				OwnerUserID       int    `json:"owner_user_id"`
				ServiceName       string `json:"service_name"`
				Environment       string `json:"environment"`
				RunbookURL        string `json:"runbook_url"`
				Collector         string `json:"collector"`
				WarnDays          []int  `json:"warn_days"`
				CheckEveryMinutes int    `json:"check_every_minutes"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			item, err := createExpiryAsset(userID, body.AssetType, body.Input, body.ServiceName, body.Environment, body.RunbookURL, body.Collector, body.ProjectID, body.TeamID, body.OwnerUserID, body.Port, body.WarnDays, body.CheckEveryMinutes)
			if err != nil {
				status := http.StatusBadRequest
				msg := "That endpoint or domain could not be registered."
				switch err {
				case errExpiryDenied, errHandoverDenied:
					status = http.StatusForbidden
					msg = "This project is not available for certificate registration."
				case errExpiryInvalid:
					msg = "Owner must be a member of the selected team."
				}
				writeAPIError(w, r, status, msg, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r)
		}
		return
	}
	parts := strings.Split(rest, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown asset.", nil)
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch {
	case action == "" && r.Method == http.MethodGet:
		item, getErr := getExpiryAsset(id, userID, true)
		writeExpiryMutation(w, r, item, getErr, "That asset is not available.")
	case action == "" && r.Method == http.MethodPatch:
		var body struct {
			TeamID      int `json:"team_id"`
			OwnerUserID int `json:"owner_user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, ownerErr := updateExpiryOwner(id, userID, body.TeamID, body.OwnerUserID)
		writeExpiryMutation(w, r, item, ownerErr, "The owner could not be saved.")
	case action == "check" && r.Method == http.MethodPost:
		item, getErr := getExpiryAsset(id, userID, false)
		if getErr != nil {
			writeExpiryMutation(w, r, expiryAssetView{}, getErr, "That asset is not available.")
			return
		}
		if expiryCollectorIsPrivate(item.Collector) {
			if item.Latest == nil {
				applyExpiryObservation(item, expiryWaitingPrivateObservation())
				item, _ = getExpiryAsset(id, userID, true)
			}
			writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok", "note": "Hosted checks do not reach private collector targets."})
			return
		}
		checkExpiryAssetNow(item)
		item, _ = getExpiryAsset(id, userID, true)
		writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok"})
	case action == "observations" && r.Method == http.MethodGet:
		if _, getErr := getExpiryAsset(id, userID, false); getErr != nil {
			writeExpiryMutation(w, r, expiryAssetView{}, getErr, "That asset is not available.")
			return
		}
		items, listErr := listExpiryObservations(id)
		if listErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Observations could not be loaded.", listErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"observations": items, "status": "ok"})
	case action == "manual" && r.Method == http.MethodPost:
		var body struct {
			ExpiresAt string `json:"expires_at"`
			Source    string `json:"source"`
			Note      string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		when, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(body.ExpiresAt))
		if parseErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Manual evidence needs an exact UTC expiration.", parseErr)
			return
		}
		if err := addManualExpiryEvidence(id, userID, when.UTC(), body.Source, body.Note); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Manual evidence could not be saved.", err)
			return
		}
		item, _ := getExpiryAsset(id, userID, true)
		writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok"})
	case action == "renewal-cases" && r.Method == http.MethodPost:
		var body struct {
			State     string `json:"state"`
			ChangeRef string `json:"change_ref"`
			Note      string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, caseErr := createExpiryRenewalCase(id, userID, body.ChangeRef, body.Note, body.State)
		writeExpiryMutation(w, r, item, caseErr, "The renewal case could not be saved.")
	case action == "verify" && r.Method == http.MethodPost:
		item, verifyErr := verifyExpiryRenewal(id, userID)
		writeExpiryMutation(w, r, item, verifyErr, "Renewal is not verified from the current evidence.")
	case action == "auto-renew" && r.Method == http.MethodPost:
		item, renewErr := trackExpiryAutoRenew(id, userID)
		writeExpiryMutation(w, r, item, renewErr, "Auto-renew could not be tracked. Registrar auto-renew is not treated as completed renewal.")
	case action == "dns-proposals" && r.Method == http.MethodPost:
		var body struct {
			Note      string `json:"note"`
			LiveWrite bool   `json:"live_write"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err.Error() != "EOF" {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.LiveWrite {
			writeAPIError(w, r, http.StatusBadRequest, "Live DNS writes are not performed from this portal.", nil)
			return
		}
		item, dnsErr := proposeExpiryDNS(id, userID, body.Note)
		writeExpiryMutation(w, r, item, dnsErr, "DNS records could not be proposed.")
	case action == "dns-confirm" && r.Method == http.MethodPost:
		var body struct {
			ProposalID int    `json:"proposal_id"`
			Note       string `json:"note"`
			LiveWrite  bool   `json:"live_write"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.LiveWrite {
			writeAPIError(w, r, http.StatusBadRequest, "Live DNS writes are not performed from this portal.", nil)
			return
		}
		item, confErr := confirmExpiryDNS(id, body.ProposalID, userID, body.Note)
		writeExpiryMutation(w, r, item, confErr, "DNS confirmation needs a note that the records were applied outside this portal.")
	case action == "pause" && r.Method == http.MethodPost:
		var body struct {
			Paused bool   `json:"paused"`
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, pauseErr := pauseExpiryAsset(id, userID, body.Paused, body.Reason)
		writeExpiryMutation(w, r, item, pauseErr, "The check schedule could not be updated.")
	case action == "archive" && r.Method == http.MethodPost:
		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, archErr := archiveExpiryAsset(id, userID, body.Reason)
		writeExpiryMutation(w, r, item, archErr, "The asset could not be archived.")
	default:
		writeMethodNotAllowed(w, r)
	}
}

func expiryCollectorsRoute(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	serveExpiryCollectors(w, r, userID)
}

func serveExpiryOwnership(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	teamID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("team_id")))
	teams, err := listExpiryAssignableTeams(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Teams could not be loaded.", err)
		return
	}
	members := []expiryMemberChoice{}
	if teamID > 0 {
		loaded, memberErr := listExpiryTeamMembers(teamID)
		if memberErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Team members could not be loaded.", memberErr)
			return
		}
		members = loaded
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"teams":   teams,
		"members": members,
		"status":  "ok",
	})
}

func writeExpiryMutation(w http.ResponseWriter, r *http.Request, item expiryAssetView, err error, fallback string) {
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case errHandoverDenied, errExpiryDenied:
			status = http.StatusForbidden
		case errHandoverNotFound:
			status = http.StatusNotFound
		}
		writeAPIError(w, r, status, fallback, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok"})
}
