package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type opsHealthSummary struct {
	Watching       int `json:"watching"`
	Regressions    int `json:"regressions"`
	OpenAlerts     int `json:"open_alerts"`
	HighRiskAlerts int `json:"high_risk_alerts"`
	BurnedSLOs     int `json:"burned_slos"`
}

type opsHealthPayload struct {
	Summary     opsHealthSummary      `json:"summary"`
	Watching    []changeRequestRecord `json:"watching"`
	Regressions []requestIncident     `json:"regressions"`
	SLOs        []serviceSLOBudget    `json:"slos"`
	Dora        *projectHealth        `json:"dora,omitempty"`
}

func isRegressionIncident(item requestIncident) bool {
	source := strings.ToLower(strings.TrimSpace(item.Source))
	if source != "alert" && source != "change_regression" {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(item.Status))
	return incidentIsActive(status)
}

func buildOpsHealth(projectID int, environment string) (*opsHealthPayload, error) {
	now := time.Now()
	watching, err := listWatchingChanges(projectID, environment, now)
	if err != nil {
		return nil, err
	}
	incidents, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	envNeedle := strings.ToLower(strings.TrimSpace(environment))
	regressions := []requestIncident{}
	openAlerts := 0
	highRisk := 0
	for _, item := range incidents {
		if projectID > 0 && (item.ProjectID == nil || *item.ProjectID != projectID) {
			continue
		}
		if envNeedle != "" && incidentEnvironmentKey(item) != envNeedle {
			continue
		}
		if !isRegressionIncident(item) {
			continue
		}
		openAlerts++
		if strings.EqualFold(item.Severity, "high") || strings.EqualFold(item.Severity, "critical") {
			highRisk++
		}
		if item.SuspectedChangeID != nil || item.Source == "change_regression" {
			regressions = append(regressions, item)
		}
	}
	if len(watching) > 40 {
		watching = watching[:40]
	}
	if len(regressions) > 40 {
		regressions = regressions[:40]
	}
	for i := range regressions {
		if regressions[i].SuspectedChangeID == nil {
			continue
		}
		if change, err := getChangeRequestByID(*regressions[i].SuspectedChangeID); err == nil && change != nil {
			regressions[i].RollbackHint = change.RollbackHint
			regressions[i].CausedBy = causedByChangeCopy(regressions[i], change)
		}
	}
	slos, _ := listServiceSLOBudgets(projectID, environment)
	burned := 0
	for _, item := range slos {
		if item.Burned {
			burned++
		}
	}
	payload := &opsHealthPayload{
		Summary: opsHealthSummary{
			Watching:       len(watching),
			Regressions:    len(regressions),
			OpenAlerts:     openAlerts,
			HighRiskAlerts: highRisk,
			BurnedSLOs:     burned,
		},
		Watching:    watching,
		Regressions: regressions,
		SLOs:        slos,
	}
	if projectID > 0 {
		if project, err := getProjectCatalogByID(projectID); err == nil && project != nil {
			if health, err := buildProjectHealth(*project, now); err == nil {
				payload.Dora = health
			}
		}
	}
	return payload, nil
}

func devopsHealthHandler(w http.ResponseWriter, r *http.Request) {
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
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	payload, err := buildOpsHealth(projectID, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load health", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"health": payload,
		"status": "ok",
	})
}
