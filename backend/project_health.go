package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Delivery health (DORA) plus an operational scorecard for one project.
// A "deployment" is a request that reached status completed; a "failure" is a
// rollback of that change or an incident raised against it.

const projectHealthWindowDays = 30

type doraMetric struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	Value    float64 `json:"value"`
	Previous float64 `json:"previous"`
	Unit     string  `json:"unit"`
	Band     string  `json:"band"`
	Samples  int     `json:"samples"`
	// Lower values are better for lead time, failure rate and recovery time.
	LowerIsBetter bool `json:"lower_is_better"`
}

type scorecardCheck struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail"`
	Href   string `json:"href,omitempty"`
}

type projectHealth struct {
	WindowDays int                  `json:"window_days"`
	Metrics    []doraMetric         `json:"metrics"`
	Scorecard  []scorecardCheck     `json:"scorecard"`
	Score      int                  `json:"score"`
	Cost       projectCostSummary   `json:"cost"`
	Settings   projectInfraSettings `json:"settings"`
}

type doraWindow struct {
	deployments   int
	leadHours     []float64
	failures      int
	recoveryHours []float64
}

func medianHours(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[mid-1] + sorted[mid]) / 2
	}
	return sorted[mid]
}

func roundTo(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
}

func doraBand(key string, value float64, samples int) string {
	if samples == 0 {
		return "none"
	}
	switch key {
	case "deploy_frequency":
		switch {
		case value >= 7:
			return "elite"
		case value >= 1:
			return "high"
		case value >= 0.25:
			return "medium"
		}
	case "lead_time":
		switch {
		case value < 24:
			return "elite"
		case value < 168:
			return "high"
		case value < 720:
			return "medium"
		}
	case "change_failure_rate":
		switch {
		case value <= 5:
			return "elite"
		case value <= 10:
			return "high"
		case value <= 15:
			return "medium"
		}
	case "time_to_restore":
		switch {
		case value < 1:
			return "elite"
		case value < 24:
			return "high"
		case value < 168:
			return "medium"
		}
	}
	return "low"
}

func loadDoraWindow(projectID int, from, to time.Time) (doraWindow, error) {
	window := doraWindow{}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT created_at, updated_at
		  FROM pr_requests
		 WHERE project_id = $1 AND status = 'completed' AND updated_at >= $2 AND updated_at < $3
	`, projectID, from, to)
	if err != nil {
		return window, err
	}
	for rows.Next() {
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&createdAt, &updatedAt); err != nil {
			rows.Close()
			cancel()
			return window, err
		}
		window.deployments++
		if updatedAt.After(createdAt) {
			window.leadHours = append(window.leadHours, updatedAt.Sub(createdAt).Hours())
		}
	}
	rows.Close()
	cancel()

	if err := addChangeRequestDoraSamples(&window, projectID, from, to); err != nil {
		return window, err
	}

	var failures int
	err = queryRowContext(`
		SELECT COUNT(DISTINCT r.id)
		  FROM pr_requests r
		 WHERE r.project_id = $1 AND r.status = 'completed' AND r.updated_at >= $2 AND r.updated_at < $3
		   AND (EXISTS (SELECT 1 FROM rollback_operations ro WHERE ro.source_request_id = r.id)
		        OR EXISTS (SELECT 1 FROM request_incidents ri WHERE ri.request_id = r.id))
	`, projectID, from, to).Scan(&failures)
	if err != nil {
		return window, err
	}
	window.failures = failures

	rows, cancel, err = queryRowsWithTimeout(`
		SELECT created_at, updated_at
		  FROM request_incidents
		 WHERE project_id = $1 AND LOWER(status) IN ('resolved', 'closed') AND updated_at >= $2 AND updated_at < $3
	`, projectID, from, to)
	if err != nil {
		return window, err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var openedAt, resolvedAt time.Time
		if err := rows.Scan(&openedAt, &resolvedAt); err != nil {
			return window, err
		}
		if resolvedAt.After(openedAt) {
			window.recoveryHours = append(window.recoveryHours, resolvedAt.Sub(openedAt).Hours())
		}
	}
	return window, rows.Err()
}

func addChangeRequestDoraSamples(window *doraWindow, projectID int, from, to time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT c.id, c.created_at, c.updated_at, LOWER(COALESCE(c.status,'')), c.request_id
		  FROM change_requests c
		 WHERE c.project_id = $1 AND c.updated_at >= $2 AND c.updated_at < $3
		   AND LOWER(COALESCE(c.status,'')) IN ('implemented', 'monitoring', 'closed', 'failed')
	`, projectID, from, to)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id int
		var createdAt, updatedAt time.Time
		var status string
		var requestID sql.NullInt64
		if err := rows.Scan(&id, &createdAt, &updatedAt, &status, &requestID); err != nil {
			return err
		}
		if requestID.Valid {
			continue
		}
		window.deployments++
		if updatedAt.After(createdAt) {
			window.leadHours = append(window.leadHours, updatedAt.Sub(createdAt).Hours())
		}
		var linked int
		_ = queryRowContext(`
			SELECT COUNT(*) FROM request_incidents
			 WHERE suspected_change_id = $1 AND LOWER(severity) IN ('high', 'critical')
		`, id).Scan(&linked)
		if status == "failed" || linked > 0 {
			window.failures++
		}
	}
	return rows.Err()
}

func buildDoraMetrics(current, previous doraWindow, windowDays int) []doraMetric {
	weeks := float64(windowDays) / 7
	failureRate := func(w doraWindow) float64 {
		if w.deployments == 0 {
			return 0
		}
		return float64(w.failures) / float64(w.deployments) * 100
	}
	metrics := []doraMetric{
		{
			Key: "deploy_frequency", Label: "Deploy frequency", Unit: "per_week",
			Value:    roundTo(float64(current.deployments)/weeks, 1),
			Previous: roundTo(float64(previous.deployments)/weeks, 1),
			Samples:  current.deployments,
		},
		{
			Key: "lead_time", Label: "Lead time", Unit: "hours", LowerIsBetter: true,
			Value:    roundTo(medianHours(current.leadHours), 1),
			Previous: roundTo(medianHours(previous.leadHours), 1),
			Samples:  len(current.leadHours),
		},
		{
			Key: "change_failure_rate", Label: "Change failure rate", Unit: "percent", LowerIsBetter: true,
			Value:    roundTo(failureRate(current), 1),
			Previous: roundTo(failureRate(previous), 1),
			Samples:  current.deployments,
		},
		{
			Key: "time_to_restore", Label: "Time to restore", Unit: "hours", LowerIsBetter: true,
			Value:    roundTo(medianHours(current.recoveryHours), 1),
			Previous: roundTo(medianHours(previous.recoveryHours), 1),
			Samples:  len(current.recoveryHours),
		},
	}
	for index := range metrics {
		metrics[index].Band = doraBand(metrics[index].Key, metrics[index].Value, metrics[index].Samples)
	}
	return metrics
}

func buildProjectScorecard(project ProjectCatalog) []scorecardCheck {
	checks := make([]scorecardCheck, 0, 7)
	projectQuery := fmt.Sprintf("?project_id=%d", project.ID)

	owner := scorecardCheck{Key: "owner", Label: "Owner team", Href: fmt.Sprintf("/projects/%d/edit", project.ID)}
	if project.OwnerTeamID != nil && *project.OwnerTeamID > 0 {
		owner.Passed = true
		owner.Detail = project.OwnerTeam
		if owner.Detail == "" {
			owner.Detail = "Owner team assigned"
		}
	} else {
		owner.Detail = "No owner team. Incidents and approvals have nobody to route to."
	}
	checks = append(checks, owner)

	var runbooks int
	_ = queryRowContext(`SELECT COUNT(*) FROM project_runbooks WHERE project_id = $1`, project.ID).Scan(&runbooks)
	checks = append(checks, scorecardCheck{
		Key: "runbook", Label: "Runbook", Passed: runbooks > 0, Href: "/runbooks" + projectQuery,
		Detail: map[bool]string{true: fmt.Sprintf("%d runbook(s) linked", runbooks), false: "No runbook. Add one so on-call knows how to operate this project."}[runbooks > 0],
	})

	oncall := scorecardCheck{Key: "oncall", Label: "On-call coverage", Href: "/dashboard"}
	if project.OwnerTeamID != nil && *project.OwnerTeamID > 0 {
		var who string
		err := queryRowContext(`
			SELECT COALESCE(u.username, '')
			  FROM oncall_rotations o JOIN users u ON u.id = o.user_id
			 WHERE o.team_id = $1 AND o.starts_at <= NOW() AND o.ends_at > NOW()
			 ORDER BY o.starts_at DESC LIMIT 1
		`, *project.OwnerTeamID).Scan(&who)
		if err == nil && who != "" {
			oncall.Passed = true
			oncall.Detail = who + " is on call now"
		} else {
			oncall.Detail = "Nobody from the owner team is on call right now."
		}
	} else {
		oncall.Detail = "Set an owner team first."
	}
	checks = append(checks, oncall)

	alerts := scorecardCheck{Key: "alerts", Label: "Alert channel", Href: "/notification-settings"}
	if settings, err := loadOpsNotificationSettings(); err == nil {
		channels := make([]string, 0, 3)
		if settings.SlackEnabled && settings.SlackConfigured {
			channels = append(channels, "Slack")
		}
		if settings.TeamsEnabled && settings.TeamsConfigured {
			channels = append(channels, "Teams")
		}
		if settings.WebhookEnabled && settings.WebhookConfigured {
			channels = append(channels, "webhook")
		}
		alerts.Passed = len(channels) > 0
		if alerts.Passed {
			alerts.Detail = "Alerts go to " + strings.Join(channels, ", ")
		} else {
			alerts.Detail = "Only in-app and email alerts. Connect Slack, Teams or a webhook."
		}
	} else {
		alerts.Detail = "Could not read notification settings."
	}
	checks = append(checks, alerts)

	var budget int
	_ = queryRowContext(`SELECT COALESCE(monthly_budget_usd, 0) FROM projects WHERE id = $1`, project.ID).Scan(&budget)
	checks = append(checks, scorecardCheck{
		Key: "budget", Label: "Monthly budget", Passed: budget > 0, Href: fmt.Sprintf("/projects/%d/edit", project.ID),
		Detail: map[bool]string{true: fmt.Sprintf("$%d per month", budget), false: "No budget, so cost alerts cannot fire."}[budget > 0],
	})

	expiry := scorecardCheck{Key: "expiry", Label: "Secrets and certificates", Href: "/credential-audit" + projectQuery}
	if preview, err := buildProjectExpiryPreview(project); err == nil && preview != nil {
		summary := preview.Summary
		expiry.Passed = summary.ExpiredCount == 0
		switch {
		case summary.ExpiredCount > 0:
			expiry.Detail = fmt.Sprintf("%d expired", summary.ExpiredCount)
		case summary.ExpiringWithin30Days > 0:
			expiry.Detail = fmt.Sprintf("Nothing expired; %d expire within 30 days", summary.ExpiringWithin30Days)
		case summary.TotalItems == 0:
			expiry.Detail = "No tracked credentials"
		default:
			expiry.Detail = fmt.Sprintf("All %d tracked items healthy", summary.TotalItems)
		}
	} else {
		expiry.Passed = true
		expiry.Detail = "No tracked credentials"
	}
	checks = append(checks, expiry)

	var resolved, reviewed int
	_ = queryRowContext(`
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE EXISTS (
		         SELECT 1 FROM incident_postmortems p WHERE p.incident_id = i.id AND p.status IN ('review', 'completed')))
		  FROM request_incidents i
		 WHERE i.project_id = $1 AND LOWER(i.status) IN ('resolved', 'closed')
		   AND LOWER(i.severity) IN ('high', 'critical') AND i.updated_at >= NOW() - INTERVAL '90 days'
	`, project.ID).Scan(&resolved, &reviewed)
	postmortems := scorecardCheck{Key: "postmortems", Label: "Postmortems", Passed: reviewed >= resolved, Href: "/incidents" + projectQuery}
	if resolved == 0 {
		postmortems.Detail = "No high-severity incidents in 90 days"
	} else {
		postmortems.Detail = fmt.Sprintf("%d of %d high-severity incidents reviewed", reviewed, resolved)
	}
	checks = append(checks, postmortems)

	return checks
}

func buildProjectHealth(project ProjectCatalog, now time.Time) (*projectHealth, error) {
	window := time.Duration(projectHealthWindowDays) * 24 * time.Hour
	current, err := loadDoraWindow(project.ID, now.Add(-window), now)
	if err != nil {
		return nil, err
	}
	previous, err := loadDoraWindow(project.ID, now.Add(-2*window), now.Add(-window))
	if err != nil {
		return nil, err
	}
	scorecard := buildProjectScorecard(project)
	passed := 0
	for _, check := range scorecard {
		if check.Passed {
			passed++
		}
	}
	score := 0
	if len(scorecard) > 0 {
		score = int(math.Round(float64(passed) / float64(len(scorecard)) * 100))
	}
	return &projectHealth{
		WindowDays: projectHealthWindowDays,
		Metrics:    buildDoraMetrics(current, previous, projectHealthWindowDays),
		Scorecard:  scorecard,
		Score:      score,
		Cost:       buildProjectCostSummary(project.ID, now),
		Settings:   loadProjectInfraSettings(project.ID),
	}, nil
}

func exportProjectHealthCSV(w http.ResponseWriter, r *http.Request, projectID int) {
	project, err := getProjectCatalogByID(projectID)
	if err != nil || project == nil {
		writeAPIError(w, r, http.StatusNotFound, "project not found", err)
		return
	}
	health, err := buildProjectHealth(*project, time.Now())
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	filename := fmt.Sprintf("dora-%s-%s.csv", strings.ToLower(project.Code), time.Now().Format("20060102"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"section", "key", "label", "value", "previous", "unit", "band", "samples", "detail"})
	for _, metric := range health.Metrics {
		_ = writer.Write([]string{
			"dora", metric.Key, metric.Label,
			strconv.FormatFloat(metric.Value, 'f', -1, 64),
			strconv.FormatFloat(metric.Previous, 'f', -1, 64),
			metric.Unit, metric.Band, strconv.Itoa(metric.Samples), "",
		})
	}
	for _, check := range health.Scorecard {
		_ = writer.Write([]string{
			"scorecard", check.Key, check.Label,
			strconv.FormatBool(check.Passed), "", "", "", "", check.Detail,
		})
	}
	_ = writer.Write([]string{"summary", "score", "Operational scorecard", strconv.Itoa(health.Score), "", "percent", "", "", ""})
	_ = writer.Write([]string{
		"cost", "budget", "Monthly budget",
		strconv.Itoa(health.Cost.BudgetMonthly), "", "USD", health.Cost.AlertLevel, strconv.Itoa(health.Cost.TrackedRequests), "",
	})
	writer.Flush()
}

func handleProjectHealth(w http.ResponseWriter, r *http.Request, projectID int) {
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	if project == nil {
		writeAPIError(w, r, http.StatusNotFound, "project not found", nil)
		return
	}
	health, err := buildProjectHealth(*project, time.Now())
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "health": health})
}
