package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func devopsRunbookDiagnosticHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		RunbookID   int    `json:"runbook_id"`
		ProjectID   int    `json:"project_id"`
		Service     string `json:"service"`
		Environment string `json:"environment"`
		Action      string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	action := strings.TrimSpace(strings.ToLower(body.Action))
	if action != "" && action != "diagnostic" {
		writeAPIError(w, r, http.StatusBadRequest, "only a read-only diagnostic is available", nil)
		return
	}
	if body.ProjectID > 0 && !ensureProjectVisible(w, r, userID, body.ProjectID) {
		return
	}
	service := strings.TrimSpace(body.Service)
	environment := strings.TrimSpace(body.Environment)
	if service == "" || environment == "" {
		writeAPIError(w, r, http.StatusBadRequest, "service and environment are required", nil)
		return
	}
	revision := "Unknown"
	changeStatus := "Unknown"
	if DB != nil {
		var sha, status string
		err := DB.QueryRow(`
			SELECT COALESCE(sha, ''), COALESCE(status, '')
			FROM change_requests
			WHERE LOWER(service) = LOWER($1) AND LOWER(environment) = LOWER($2)
			ORDER BY updated_at DESC, id DESC
			LIMIT 1
		`, service, environment).Scan(&sha, &status)
		if err == nil {
			if strings.TrimSpace(sha) != "" {
				revision = strings.TrimSpace(sha)
			}
			if strings.TrimSpace(status) != "" {
				changeStatus = strings.TrimSpace(status)
			}
		}
	}
	uid := userID
	AppendUserActivity(&uid, "runbook_diagnostic", "project_runbook", strconv.Itoa(body.RunbookID), "service="+service+" environment="+environment)
	writeIAM(w, http.StatusOK, map[string]any{
		"status": "ok",
		"mode":   "read_only",
		"log": []string{
			"Read-only diagnostic started for " + service + " in " + environment + ".",
			"Latest recorded revision: " + revision + ".",
			"Latest change status: " + changeStatus + ".",
			"No restart or scale was sent.",
		},
	})
}
