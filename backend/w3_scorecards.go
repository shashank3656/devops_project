package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type serviceScorecard struct {
	Service         string           `json:"service"`
	Environment     string           `json:"environment,omitempty"`
	Repo            string           `json:"repo,omitempty"`
	Team            string           `json:"team,omitempty"`
	ProjectID       *int             `json:"project_id,omitempty"`
	ProjectName     string           `json:"project_name,omitempty"`
	ProjectCode     string           `json:"project_code,omitempty"`
	Score           int              `json:"score"`
	OpenIncidents   int              `json:"open_incidents"`
	Deployments30d  int              `json:"deployments_30d"`
	Failed30d       int              `json:"failed_30d"`
	LastChange      string           `json:"last_change,omitempty"`
	LastChangeID    *int             `json:"last_change_id,omitempty"`
	RunbookAgeDays  *int             `json:"runbook_age_days,omitempty"`
	SLOBurned       bool             `json:"slo_burned"`
	Dora            []doraMetric     `json:"dora,omitempty"`
	Checks          []scorecardCheck `json:"checks"`
}

func buildServiceScorecards(projectID int, environment string) ([]serviceScorecard, error) {
	services, err := listServiceMap(projectID, environment, "")
	if err != nil {
		return nil, err
	}
	changes, _ := listChangeRequests(projectID, environment, "", "")
	incidents, _ := listRequestIncidents("")
	now := time.Now()
	since := now.Add(-30 * 24 * time.Hour)
	out := make([]serviceScorecard, 0, len(services))
	for _, svc := range services {
		card := serviceScorecard{
			Service:     svc.Service,
			Environment: svc.Environment,
			Repo:        svc.Repo,
			Team:        svc.Team,
			ProjectID:   svc.ProjectID,
			ProjectName: svc.ProjectName,
			ProjectCode: svc.ProjectCode,
		}
		var latestChangeAt time.Time
		leadHours := []float64{}
		for _, change := range changes {
			if !strings.EqualFold(change.Service, svc.Service) {
				continue
			}
			if svc.Environment != "" && change.Environment != "" && change.Environment != "unspecified" && !strings.EqualFold(change.Environment, svc.Environment) {
				continue
			}
			if change.CreatedAt.After(since) {
				card.Deployments30d++
				if change.Status == "failed" {
					card.Failed30d++
				}
			}
			if card.LastChangeID == nil || change.CreatedAt.After(latestChangeAt) {
				copyID := change.ID
				card.LastChangeID = &copyID
				card.LastChange = change.ChangeNumber
				latestChangeAt = change.CreatedAt
			}
			if change.CreatedAt.After(since) && (change.Status == "resolved" || change.Status == "closed" || change.Status == "failed") && !change.UpdatedAt.IsZero() {
				leadHours = append(leadHours, change.UpdatedAt.Sub(change.CreatedAt).Hours())
			}
		}
		restoreHours := []float64{}
		for _, incident := range incidents {
			if !strings.EqualFold(incident.Service, svc.Service) && incident.Service != "" {
				continue
			}
			if incident.Service == "" && !strings.EqualFold(incident.RequestService, svc.Service) {
				continue
			}
			if incidentIsActive(incident.Status) {
				card.OpenIncidents++
			}
			if (strings.EqualFold(incident.Status, "resolved") || strings.EqualFold(incident.Status, "closed")) && !incident.CreatedAt.IsZero() && incident.UpdatedAt.After(incident.CreatedAt) {
				restoreHours = append(restoreHours, incident.UpdatedAt.Sub(incident.CreatedAt).Hours())
			}
		}
		guides := matchRunbooksForService(svc.ProjectID, svc.Service)
		if len(guides) > 0 {
			age := int(now.Sub(guides[0].UpdatedAt).Hours() / 24)
			card.RunbookAgeDays = &age
		}
		card.Dora = serviceDoraMetrics(card.Deployments30d, card.Failed30d, leadHours, restoreHours, 30)
		slo := findServiceSLO(svc.Service, svc.Environment, svc.ProjectID)
		latest := latestServiceMetrics(svc.Service, svc.Environment)
		if slo != nil && latest != nil {
			reasons := detectWatchBreaches(&serviceMetrics{P95Ms: slo.LatencyP95Ms, ErrorRatio: slo.ErrorRatio, Saturation: slo.Saturation}, *latest, slo)
			card.SLOBurned = len(reasons) > 0
		}
		card.Checks = []scorecardCheck{
			{Key: "owner", Label: "Owner", Passed: strings.TrimSpace(svc.Team) != "", Detail: firstNonEmpty(svc.Team, "No team on this service")},
			{Key: "slo", Label: "SLO", Passed: slo != nil && !card.SLOBurned, Detail: map[bool]string{true: "Within budget", false: "No SLO or currently burning"}[slo != nil && !card.SLOBurned]},
			{Key: "incidents", Label: "Open incidents", Passed: card.OpenIncidents == 0, Detail: strconv.Itoa(card.OpenIncidents) + " active"},
			{Key: "runbook", Label: "Runbook", Passed: card.RunbookAgeDays != nil && *card.RunbookAgeDays < 180, Detail: map[bool]string{true: "Fresh enough", false: "Missing or older than 180 days"}[card.RunbookAgeDays != nil && *card.RunbookAgeDays < 180]},
			{Key: "change", Label: "Last change", Passed: card.LastChange != "", Detail: firstNonEmpty(card.LastChange, "No CHG in catalog")},
			{Key: "dora", Label: "DORA", Passed: doraFailureRateOK(card.Dora), Detail: doraScorecardDetail(card.Dora)},
		}
		passed := 0
		for _, check := range card.Checks {
			if check.Passed {
				passed++
			}
		}
		if len(card.Checks) > 0 {
			card.Score = int(math.Round(float64(passed) / float64(len(card.Checks)) * 100))
		}
		out = append(out, card)
	}
	return out, nil
}

func serviceDoraMetrics(deployments, failures int, leadHours, restoreHours []float64, windowDays int) []doraMetric {
	if windowDays <= 0 {
		windowDays = 30
	}
	current := doraWindow{deployments: deployments, failures: failures, leadHours: leadHours, recoveryHours: restoreHours}
	return buildDoraMetrics(current, doraWindow{}, windowDays)
}

func doraFailureRateOK(metrics []doraMetric) bool {
	for _, metric := range metrics {
		if metric.Key == "change_failure_rate" {
			return metric.Samples == 0 || metric.Value <= 15
		}
	}
	return true
}

func doraScorecardDetail(metrics []doraMetric) string {
	for _, metric := range metrics {
		if metric.Key == "change_failure_rate" {
			if metric.Samples == 0 {
				return "No deployments in the window"
			}
			return fmt.Sprintf("Change failure rate %.1f%% (%s)", metric.Value, metric.Band)
		}
	}
	return "No DORA samples"
}

func filterScorecardsForProjects(items []serviceScorecard, projectIDs map[int]struct{}) []serviceScorecard {
	if len(projectIDs) == 0 {
		return []serviceScorecard{}
	}
	out := items[:0]
	for _, item := range items {
		if item.ProjectID == nil {
			continue
		}
		if _, ok := projectIDs[*item.ProjectID]; ok {
			out = append(out, item)
		}
	}
	return out
}

func devopsScorecardsHandler(w http.ResponseWriter, r *http.Request) {
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
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	items, err := buildServiceScorecards(projectID, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load scorecards", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"scorecards": items, "status": "ok"})
}

func adminScorecardsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	items, err := buildServiceScorecards(projectID, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load scorecards", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"scorecards": items, "status": "ok"})
}

func meScorecardsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := buildServiceScorecards(0, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load scorecards", err)
		return
	}
	items = filterScorecardsForProjects(items, projectIDSet(visibleProjectIDsForUser(userID)))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"scorecards": items, "status": "ok"})
}
