package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"
)

// Infracost results posted by CI as "infracost_report" (output of
// `infracost breakdown --format json` or `infracost diff --format json`).
// Project spend is the sum of each completed request's monthly cost delta, so
// several PRs touching the same stack are not double counted.

const (
	budgetWarnPercent = 80
	idleAfterDays     = 60
)

type requestCostCheck struct {
	HasInfracost    bool       `json:"has_infracost"`
	Currency        string     `json:"currency"`
	MonthlyCost     float64    `json:"monthly_cost"`
	PastMonthlyCost float64    `json:"past_monthly_cost"`
	DiffMonthlyCost float64    `json:"diff_monthly_cost"`
	Estimate        int        `json:"estimate"`
	EstimateLow     int        `json:"estimate_low"`
	EstimateHigh    int        `json:"estimate_high"`
	EstimateBasis   string     `json:"estimate_basis"`
	Variance        string     `json:"variance"` // within, above, below, unknown
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type idleCandidate struct {
	RequestID   int     `json:"request_id"`
	Environment string  `json:"environment"`
	Service     string  `json:"service"`
	MonthlyCost float64 `json:"monthly_cost"`
	DaysIdle    int     `json:"days_idle"`
}

type projectCostSummary struct {
	Currency         string          `json:"currency"`
	BudgetMonthly    int             `json:"budget_monthly"`
	CommittedMonthly float64         `json:"committed_monthly"`
	PendingMonthly   float64         `json:"pending_monthly"`
	ProjectedMonthly float64         `json:"projected_monthly"`
	PercentUsed      float64         `json:"percent_used"`
	ProjectedPercent float64         `json:"projected_percent"`
	AlertLevel       string          `json:"alert_level"` // none, warn, over
	TrackedRequests  int             `json:"tracked_requests"`
	IdleCandidates   []idleCandidate `json:"idle_candidates"`
}

type infracostReport struct {
	Currency              string
	TotalMonthlyCost      float64
	PastTotalMonthlyCost  float64
	DiffTotalMonthlyCost  float64
	HasDiff, HasPastTotal bool
}

func parseCostNumber(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	}
	return 0, false
}

func parseInfracostReport(raw json.RawMessage) (infracostReport, error) {
	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return infracostReport{}, fmt.Errorf("infracost report is not valid JSON")
	}
	report := infracostReport{Currency: "USD"}
	if currency, ok := decoded["currency"].(string); ok && strings.TrimSpace(currency) != "" {
		report.Currency = strings.ToUpper(strings.TrimSpace(currency))
	}
	total, ok := parseCostNumber(decoded["totalMonthlyCost"])
	if !ok {
		return infracostReport{}, fmt.Errorf("infracost report has no totalMonthlyCost")
	}
	report.TotalMonthlyCost = total
	if past, ok := parseCostNumber(decoded["pastTotalMonthlyCost"]); ok {
		report.PastTotalMonthlyCost = past
		report.HasPastTotal = true
	}
	if diff, ok := parseCostNumber(decoded["diffTotalMonthlyCost"]); ok {
		report.DiffTotalMonthlyCost = diff
		report.HasDiff = true
	} else if report.HasPastTotal {
		report.DiffTotalMonthlyCost = report.TotalMonthlyCost - report.PastTotalMonthlyCost
		report.HasDiff = true
	} else {
		report.DiffTotalMonthlyCost = report.TotalMonthlyCost
	}
	return report, nil
}

func saveInfracostReport(requestID int, report infracostReport) error {
	_, err := execContext(`
		INSERT INTO pr_request_costs (request_id, currency, monthly_cost, past_monthly_cost, diff_monthly_cost, updated_at)
		VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
		ON CONFLICT (request_id) DO UPDATE SET
			currency = EXCLUDED.currency, monthly_cost = EXCLUDED.monthly_cost,
			past_monthly_cost = EXCLUDED.past_monthly_cost, diff_monthly_cost = EXCLUDED.diff_monthly_cost,
			updated_at = CURRENT_TIMESTAMP
	`, requestID, report.Currency, report.TotalMonthlyCost, report.PastTotalMonthlyCost, report.DiffTotalMonthlyCost)
	return err
}

func requestInstanceHint(config string) string {
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(config), &decoded); err != nil {
		return ""
	}
	for _, key := range []string{"instance_type", "instance_class", "node_type", "machine_type", "vm_size"} {
		if value, ok := decoded[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func buildRequestCostCheck(req *PRRequest) requestCostCheck {
	check := requestCostCheck{Currency: "USD", Variance: "unknown"}
	if req == nil {
		return check
	}
	check.Estimate, check.EstimateLow, check.EstimateHigh, check.EstimateBasis, _ =
		estimateMonthlyCost(req.Cloud, req.Service, req.Env, requestInstanceHint(req.Config))
	if DB == nil {
		return check
	}
	var updatedAt sql.NullTime
	err := queryRowContext(`
		SELECT currency, monthly_cost, past_monthly_cost, diff_monthly_cost, updated_at
		  FROM pr_request_costs WHERE request_id = $1
	`, req.ID).Scan(&check.Currency, &check.MonthlyCost, &check.PastMonthlyCost, &check.DiffMonthlyCost, &updatedAt)
	if err != nil {
		return check
	}
	check.HasInfracost = true
	if updatedAt.Valid {
		value := updatedAt.Time
		check.UpdatedAt = &value
	}
	delta := math.Abs(check.DiffMonthlyCost)
	switch {
	case delta > float64(check.EstimateHigh)*1.25:
		check.Variance = "above"
	case delta < float64(check.EstimateLow)*0.75:
		check.Variance = "below"
	default:
		check.Variance = "within"
	}
	return check
}

func buildProjectCostSummary(projectID int, now time.Time) projectCostSummary {
	summary := projectCostSummary{Currency: "USD", AlertLevel: "none", IdleCandidates: []idleCandidate{}}
	if DB == nil || projectID <= 0 {
		return summary
	}
	summary.BudgetMonthly = loadProjectBudget(projectID)

	rows, cancel, err := queryRowsWithTimeout(`
		SELECT r.id, COALESCE(r.env, ''), COALESCE(r.service, ''), COALESCE(r.status, ''), r.updated_at,
		       c.currency, c.monthly_cost, c.diff_monthly_cost,
		       NOT EXISTS (
		         SELECT 1 FROM pr_requests newer
		          WHERE newer.project_id = r.project_id AND newer.env = r.env AND newer.service = r.service
		            AND newer.id <> r.id AND newer.updated_at > r.updated_at
		       ) AS latest
		  FROM pr_requests r
		  JOIN pr_request_costs c ON c.request_id = r.id
		 WHERE r.project_id = $1
	`, projectID)
	if err != nil {
		return summary
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var (
			id                   int
			env, service, status string
			updatedAt            time.Time
			currency             string
			monthly, diff        float64
			latest               bool
		)
		if err := rows.Scan(&id, &env, &service, &status, &updatedAt, &currency, &monthly, &diff, &latest); err != nil {
			continue
		}
		summary.TrackedRequests++
		if currency != "" {
			summary.Currency = currency
		}
		switch status {
		case "completed":
			summary.CommittedMonthly += diff
			daysIdle := int(now.Sub(updatedAt).Hours() / 24)
			if latest && !envEqualsProd(env) && monthly > 0 && daysIdle >= idleAfterDays {
				summary.IdleCandidates = append(summary.IdleCandidates, idleCandidate{
					RequestID: id, Environment: env, Service: service, MonthlyCost: roundTo(monthly, 2), DaysIdle: daysIdle,
				})
			}
		case "rejected", "draft":
		default:
			summary.PendingMonthly += diff
		}
	}
	summary.CommittedMonthly = roundTo(summary.CommittedMonthly, 2)
	summary.PendingMonthly = roundTo(summary.PendingMonthly, 2)
	summary.ProjectedMonthly = roundTo(summary.CommittedMonthly+summary.PendingMonthly, 2)
	if summary.BudgetMonthly > 0 {
		budget := float64(summary.BudgetMonthly)
		summary.PercentUsed = roundTo(summary.CommittedMonthly/budget*100, 1)
		summary.ProjectedPercent = roundTo(summary.ProjectedMonthly/budget*100, 1)
		switch {
		case summary.ProjectedPercent >= 100:
			summary.AlertLevel = "over"
		case summary.ProjectedPercent >= budgetWarnPercent:
			summary.AlertLevel = "warn"
		}
	}
	return summary
}

func notifyProjectBudget(req *PRRequest, now time.Time) {
	if req == nil || req.ProjectID == nil || *req.ProjectID <= 0 {
		return
	}
	summary := buildProjectCostSummary(*req.ProjectID, now)
	if summary.AlertLevel == "none" {
		return
	}
	project, err := getProjectCatalogByID(*req.ProjectID)
	if err != nil || project == nil {
		return
	}
	threshold := strconv.Itoa(budgetWarnPercent)
	title := fmt.Sprintf("%s is at %.0f%% of its monthly budget", project.Name, summary.ProjectedPercent)
	if summary.AlertLevel == "over" {
		threshold = "100"
		title = fmt.Sprintf("%s is over its monthly budget", project.Name)
	}
	message := fmt.Sprintf("Projected %s %.2f per month against a budget of %d (committed %.2f, pending approval %.2f). Latest change: request #%d.",
		summary.Currency, summary.ProjectedMonthly, summary.BudgetMonthly, summary.CommittedMonthly, summary.PendingMonthly, req.ID)

	recipients := make([]int, 0, 8)
	if req.CreatedBy != nil {
		recipients = append(recipients, *req.CreatedBy)
	}
	if owners, err := resolveOpsNotificationRecipientsFromOwner(project.OwnerTeam); err == nil {
		recipients = append(recipients, owners...)
	}
	recipients, err = buildOpsNotificationRecipients(recipients)
	if err != nil {
		return
	}
	eventKey := buildOpsNotificationEventKey("budget", strconv.Itoa(project.ID), threshold, now.Format("2006-01"))
	if err := dispatchOpsNotification(eventKey, "budget_alert", title, message, &req.ID, req.ProjectID, recipients, map[string]any{
		"project_id":        project.ID,
		"budget_monthly":    summary.BudgetMonthly,
		"projected_monthly": summary.ProjectedMonthly,
		"projected_percent": summary.ProjectedPercent,
	}); err != nil {
		log.Printf("[budget] project %d: notification failed: %v", project.ID, err)
	}
}

func ingestInfracostReport(req *PRRequest, raw json.RawMessage) error {
	report, err := parseInfracostReport(raw)
	if err != nil {
		return err
	}
	if err := saveInfracostReport(req.ID, report); err != nil {
		return err
	}
	reqCopy := *req
	go notifyProjectBudget(&reqCopy, time.Now())
	return nil
}
