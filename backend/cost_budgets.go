package main

import (
	"fmt"
	"strings"
	"time"
)

type costBudget struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	ScopeType   string `json:"scope_type"`
	ScopeValue  string `json:"scope_value"`
	Amount      string `json:"amount"`
	Currency    string `json:"currency"`
	Basis       string `json:"basis"`
	Period      string `json:"period"`
	OwnerSlug   string `json:"owner_slug,omitempty"`
	WarnPercent int    `json:"warn_percent"`
	OverPercent int    `json:"over_percent"`
	Destination string `json:"destination"`
}

type costBudgetStatus struct {
	costBudget
	Spent           map[string]any `json:"spent"`
	Remaining       map[string]any `json:"remaining"`
	Alert           string         `json:"alert"`
	PausesWorkloads bool           `json:"pauses_workloads"`
	PeriodStart     string         `json:"period_start,omitempty"`
	PeriodEnd       string         `json:"period_end,omitempty"`
	Note            string         `json:"note"`
}

func costNormalizeScope(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "account", "team", "service":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "all"
	}
}

func costNormalizeBudgetPeriod(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "calendar_month", "month":
		return "calendar_month"
	default:
		return "calendar_month"
	}
}

func costBudgetPeriodWindow(period string, now time.Time) (time.Time, time.Time) {
	_ = costNormalizeBudgetPeriod(period)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, -1)
	return start, end
}

func costBudgetAlert(spent, amount, coverage string) string {
	return costBudgetAlertAt(spent, amount, coverage, 80, 100)
}

func costBudgetAlertAt(spent, amount, coverage string, warnPercent, overPercent int) string {
	if coverage != "complete" {
		return "unknown"
	}
	if warnPercent <= 0 {
		warnPercent = 80
	}
	if overPercent <= 0 {
		overPercent = 100
	}
	cmp := subCostAmounts(spent, costPercentOf(amount, overPercent))
	if !strings.HasPrefix(cmp, "-") {
		return "over"
	}
	warn := subCostAmounts(spent, costPercentOf(amount, warnPercent))
	if !strings.HasPrefix(warn, "-") {
		return "warn"
	}
	return "none"
}

func linesForBudgetScope(lines []costLineRow, scopeType, scopeValue string) []costLineRow {
	scopeType = costNormalizeScope(scopeType)
	scopeValue = strings.TrimSpace(scopeValue)
	if scopeType == "all" {
		return lines
	}
	if scopeValue == "" {
		return []costLineRow{}
	}
	out := []costLineRow{}
	for _, line := range lines {
		switch scopeType {
		case "account":
			if strings.EqualFold(line.AccountID, scopeValue) {
				out = append(out, line)
			}
		case "team":
			if strings.EqualFold(line.TeamSlug, scopeValue) {
				out = append(out, line)
			}
		case "service":
			if strings.EqualFold(line.AllocatedService, scopeValue) || strings.EqualFold(line.Service, scopeValue) {
				out = append(out, line)
			}
		}
	}
	return out
}

func evaluateCostBudget(budget costBudget, lines []costLineRow, coverage string) costBudgetStatus {
	scoped := linesForBudgetScope(lines, budget.ScopeType, budget.ScopeValue)
	spent, _, currency, hasLines := rollupCostLines(scoped, budget.Basis)
	if currency == "" {
		currency = budget.Currency
	}
	billCoverage := coverage
	if coverage == "complete" && !hasLines {
		spent = "0." + strings.Repeat("0", costMoneyScale)
	}
	if budget.Currency != "" && currency != "" && !strings.EqualFold(budget.Currency, currency) {
		billCoverage = "incomplete"
	}
	remainingAmt := subCostAmounts(budget.Amount, spent)
	status := costBudgetStatus{
		costBudget:      budget,
		Spent:           costMoneyView(billCoverage, spent, currency, budget.Basis),
		Remaining:       costMoneyView(billCoverage, remainingAmt, currency, budget.Basis),
		Alert:           costBudgetAlertAt(spent, budget.Amount, billCoverage, budget.WarnPercent, budget.OverPercent),
		PausesWorkloads: false,
		Note:            "Budgets never stop or resize workloads. Remaining uses the budget period, not the Analysis filter. Incomplete stays Unknown.",
	}
	if budget.Period == "" {
		status.Period = "calendar_month"
	}
	if budget.Destination == "" {
		status.Destination = "cost_alerts"
	}
	if budget.WarnPercent <= 0 {
		status.WarnPercent = 80
	}
	if budget.OverPercent <= 0 {
		status.OverPercent = 100
	}
	return status
}

func listCostBudgets() ([]costBudget, error) {
	if DB == nil {
		return []costBudget{}, nil
	}
	rows, err := DB.Query(`
		SELECT id, name, scope_type, scope_value, amount::text, currency, basis,
		       COALESCE(period, 'calendar_month'), COALESCE(owner_slug, ''),
		       COALESCE(warn_percent, 80), COALESCE(over_percent, 100), COALESCE(destination, 'cost_alerts')
		  FROM cost_budgets
		 ORDER BY id
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_budgets") {
			return []costBudget{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costBudget{}
	for rows.Next() {
		var item costBudget
		if err := rows.Scan(&item.ID, &item.Name, &item.ScopeType, &item.ScopeValue, &item.Amount, &item.Currency, &item.Basis, &item.Period, &item.OwnerSlug, &item.WarnPercent, &item.OverPercent, &item.Destination); err != nil {
			return nil, err
		}
		item.ScopeType = costNormalizeScope(item.ScopeType)
		item.Currency = normalizeCostCurrency(item.Currency)
		item.Basis = normalizeCostBasis(item.Basis)
		item.Period = costNormalizeBudgetPeriod(item.Period)
		item.Destination = "cost_alerts"
		if item.WarnPercent <= 0 {
			item.WarnPercent = 80
		}
		if item.OverPercent <= 0 {
			item.OverPercent = 100
		}
		out = append(out, item)
	}
	return out, nil
}

func createCostBudget(userID int, name, scopeType, scopeValue, amount, currency, basis, period, ownerSlug string, warnPercent, overPercent int) (*costBudget, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	name = strings.TrimSpace(name)
	scopeValue = strings.TrimSpace(scopeValue)
	ownerSlug = strings.TrimSpace(ownerSlug)
	if strings.Contains(name, "@") || strings.Contains(scopeValue, "@") || strings.Contains(ownerSlug, "@") {
		return nil, fmt.Errorf("budget cannot include an email")
	}
	if name == "" {
		return nil, fmt.Errorf("budget name is required")
	}
	if ownerSlug != "" && (len(ownerSlug) < 2 || strings.ContainsAny(ownerSlug, " \t/")) {
		return nil, fmt.Errorf("budget owner is not valid")
	}
	parsed, err := parseCostAmount(amount)
	if err != nil {
		return nil, fmt.Errorf("budget amount is required")
	}
	scopeType = costNormalizeScope(scopeType)
	currency = normalizeCostCurrency(currency)
	basis = normalizeCostBasis(basis)
	period = costNormalizeBudgetPeriod(period)
	if warnPercent <= 0 {
		warnPercent = 80
	}
	if overPercent <= 0 {
		overPercent = 100
	}
	var id int
	err = DB.QueryRow(`
		INSERT INTO cost_budgets (name, scope_type, scope_value, amount, currency, basis, created_by, period, owner_slug, warn_percent, over_percent, destination)
		VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10,$11,'cost_alerts')
		RETURNING id
	`, name, scopeType, scopeValue, parsed, currency, basis, userID, period, ownerSlug, warnPercent, overPercent).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &costBudget{
		ID: id, Name: name, ScopeType: scopeType, ScopeValue: scopeValue, Amount: parsed, Currency: currency, Basis: basis,
		Period: period, OwnerSlug: ownerSlug, WarnPercent: warnPercent, OverPercent: overPercent, Destination: "cost_alerts",
	}, nil
}

func deleteCostBudget(id int) error {
	_, err := DB.Exec(`DELETE FROM cost_budgets WHERE id = $1`, id)
	return err
}
