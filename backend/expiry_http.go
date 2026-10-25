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
	if rest == "" {
		switch r.Method {
		case http.MethodGet:
			items, summary, err := listExpiryAssets(userID, r.URL.Query().Get("type"), r.URL.Query().Get("assessment"))
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
				ServiceName       string `json:"service_name"`
				Environment       string `json:"environment"`
				OwnerName         string `json:"owner_name"`
				RunbookURL        string `json:"runbook_url"`
				WarnDays          []int  `json:"warn_days"`
				CheckEveryMinutes int    `json:"check_every_minutes"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			item, err := createExpiryAsset(userID, body.AssetType, body.Input, body.ServiceName, body.Environment, body.OwnerName, body.RunbookURL, body.ProjectID, body.TeamID, body.Port, body.WarnDays, body.CheckEveryMinutes)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "That endpoint or domain could not be registered.", err)
				return
			}
			writeJSON(w, http.StatusAccepted, map[string]any{"asset": item, "status": "ok"})
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
	case action == "check" && r.Method == http.MethodPost:
		if _, getErr := getExpiryAsset(id, userID, false); getErr != nil {
			writeExpiryMutation(w, r, expiryAssetView{}, getErr, "That asset is not available.")
			return
		}
		jobID, queueErr := queueExpiryCheck(id)
		if queueErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "The check could not be queued.", queueErr)
			return
		}
		go drainExpiryCheckJobs()
		writeJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID, "status": "queued"})
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

func writeExpiryMutation(w http.ResponseWriter, r *http.Request, item expiryAssetView, err error, fallback string) {
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case errHandoverDenied:
			status = http.StatusForbidden
		case errHandoverNotFound:
			status = http.StatusNotFound
		}
		writeAPIError(w, r, status, fallback, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"asset": item, "status": "ok"})
}
