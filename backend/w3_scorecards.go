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
	Service        string           `json:"service"`
	Environment    string           `json:"environment,omitempty"`
	Repo           string           `json:"repo,omitempty"`
	Team           string           `json:"team,omitempty"`
	ProjectID      *int             `json:"project_id,omitempty"`
	ProjectName    string           `json:"project_name,omitempty"`
	ProjectCode    string           `json:"project_code,omitempty"`
	Score          int              `json:"score"`
	ScoreState     string           `json:"score_state"` // known or unknown
	OpenIncidents  int              `json:"open_incidents"`
	Deployments30d int              `json:"deployments_30d"`
	Failed30d      int              `json:"failed_30d"`
	LastChange     string           `json:"last_change,omitempty"`
	LastChangeID   *int             `json:"last_change_id,omitempty"`
	LastChangeSHA  string           `json:"last_change_sha,omitempty"`
	RunbookAgeDays *int             `json:"runbook_age_days,omitempty"`
	SLOBurned      bool             `json:"slo_burned"`
	Drift          *liveChangeDrift `json:"drift,omitempty"`
	Dora           []doraMetric     `json:"dora,omitempty"`
	Checks         []scorecardCheck `json:"checks"`
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
		var latestChange *changeRequestRecord
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
				card.LastChangeSHA = change.SHA
				latestChangeAt = change.CreatedAt
				copyChange := change
				latestChange = &copyChange
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
		digest := ""
		if latestChange != nil {
			digest = latestChange.ImageDigest
		}
		drift := detectServiceDrift(svc.Service, firstNonEmpty(svc.Environment, environment), card.LastChangeSHA, digest)
		card.Drift = &drift
		sloState := "unknown"
		sloDetail := "No SLO or live metrics. Missing telemetry is Unknown, not healthy."
		if slo != nil && latest != nil {
			if card.SLOBurned {
				sloState = "fail"
				sloDetail = "Error or latency is outside the SLO."
			} else {
				sloState = "pass"
				sloDetail = "Live metrics are inside the SLO."
			}
		}
		runbookFresh := card.RunbookAgeDays != nil && *card.RunbookAgeDays < 180
		driftState := "unknown"
		if drift.Compared {
			if drift.Drifted {
				driftState = "fail"
			} else {
				driftState = "pass"
			}
		}
		card.Checks = []scorecardCheck{
			scoredCheck("owner", "Owner", firstNonEmpty(svc.Team, "No team on this service"), map[bool]string{true: "pass", false: "fail"}[strings.TrimSpace(svc.Team) != ""]),
			scoredCheck("slo", "SLO", sloDetail, sloState),
			scoredCheck("incidents", "Open incidents", strconv.Itoa(card.OpenIncidents)+" active", map[bool]string{true: "pass", false: "fail"}[card.OpenIncidents == 0]),
			scoredCheck("runbook", "Runbook", map[bool]string{true: "Fresh enough", false: "Missing or older than 180 days"}[runbookFresh], map[bool]string{true: "pass", false: "fail"}[runbookFresh]),
			scoredCheck("change", "Last change", firstNonEmpty(card.LastChange, "No change record. Unknown, not healthy."), map[bool]string{true: "pass", false: "unknown"}[card.LastChange != ""]),
			scoredCheck("drift", "Live vs last CHG", firstNonEmpty(drift.Detail, "No cluster image to compare. Unknown, not healthy."), driftState),
			doraScorecardCheck(card.Dora),
		}
		known, passed := countKnownChecks(card.Checks)
		card.ScoreState = "unknown"
		if known > 0 {
			card.ScoreState = "known"
			card.Score = int(math.Round(float64(passed) / float64(known) * 100))
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

func scoredCheck(key, label, detail, state string) scorecardCheck {
	return scorecardCheck{Key: key, Label: label, Detail: detail, State: state, Passed: state == "pass"}
}

func doraFailureRateOK(metrics []doraMetric) bool {
	for _, metric := range metrics {
		if metric.Key == "change_failure_rate" {
			return metric.Samples > 0 && metric.Value <= 15
		}
	}
	return false
}

func doraScorecardCheck(metrics []doraMetric) scorecardCheck {
	detail := doraScorecardDetail(metrics)
	for _, metric := range metrics {
		if metric.Key != "change_failure_rate" {
			continue
		}
		if metric.Samples == 0 {
			return scoredCheck("dora", "DORA", "No deployments in the last 30 days. Unknown, not healthy.", "unknown")
		}
		if metric.Value <= 15 {
			return scoredCheck("dora", "DORA", detail, "pass")
		}
		return scoredCheck("dora", "DORA", detail, "fail")
	}
	return scoredCheck("dora", "DORA", "No DORA samples. Unknown, not healthy.", "unknown")
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
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
		return
	}
	items, err := buildServiceScorecards(projectID, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load scorecards", err)
		return
	}
	seeAll := callerSeesEveryProject(userID)
	var visible map[int]bool
	if !seeAll {
		visible, err = getVisibleProjectIDSetForUser(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load scorecards", err)
			return
		}
	}
	kept := make([]serviceScorecard, 0, len(items))
	for _, item := range items {
		if seeAll || (item.ProjectID != nil && visible[*item.ProjectID]) {
			kept = append(kept, item)
		}
	}
	items = kept
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
