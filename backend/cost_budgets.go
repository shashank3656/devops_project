package main

import (
	"fmt"
	"strings"
)

type costBudget struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	ScopeType  string `json:"scope_type"`
	ScopeValue string `json:"scope_value"`
	Amount     string `json:"amount"`
	Currency   string `json:"currency"`
	Basis      string `json:"basis"`
}

type costBudgetStatus struct {
	costBudget
	Spent           map[string]any `json:"spent"`
	Remaining       map[string]any `json:"remaining"`
	Alert           string         `json:"alert"`
	PausesWorkloads bool           `json:"pauses_workloads"`
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

func costBudgetAlert(spent, amount, coverage string) string {
	if coverage != "complete" {
		return "unknown"
	}
	cmp := subCostAmounts(spent, amount)
	if !strings.HasPrefix(cmp, "-") {
		return "over"
	}
	warn := subCostAmounts(spent, costPercentOf(amount, 80))
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
		Alert:           costBudgetAlert(spent, budget.Amount, billCoverage),
		PausesWorkloads: false,
		Note:            "Budgets never stop or resize workloads. Remaining is Unknown when the operating window is incomplete.",
	}
	return status
}

func listCostBudgets() ([]costBudget, error) {
	if DB == nil {
		return []costBudget{}, nil
	}
	rows, err := DB.Query(`
		SELECT id, name, scope_type, scope_value, amount::text, currency, basis
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
		if err := rows.Scan(&item.ID, &item.Name, &item.ScopeType, &item.ScopeValue, &item.Amount, &item.Currency, &item.Basis); err != nil {
			return nil, err
		}
		item.ScopeType = costNormalizeScope(item.ScopeType)
		item.Currency = normalizeCostCurrency(item.Currency)
		item.Basis = normalizeCostBasis(item.Basis)
		out = append(out, item)
	}
	return out, nil
}

func createCostBudget(userID int, name, scopeType, scopeValue, amount, currency, basis string) (*costBudget, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	name = strings.TrimSpace(name)
	scopeValue = strings.TrimSpace(scopeValue)
	if strings.Contains(name, "@") || strings.Contains(scopeValue, "@") {
		return nil, fmt.Errorf("budget cannot include an email")
	}
	if name == "" {
		return nil, fmt.Errorf("budget name is required")
	}
	parsed, err := parseCostAmount(amount)
	if err != nil {
		return nil, fmt.Errorf("budget amount is required")
	}
	scopeType = costNormalizeScope(scopeType)
	currency = normalizeCostCurrency(currency)
	basis = normalizeCostBasis(basis)
	var id int
	err = DB.QueryRow(`
		INSERT INTO cost_budgets (name, scope_type, scope_value, amount, currency, basis, created_by)
		VALUES ($1,$2,$3,$4::numeric,$5,$6,$7)
		RETURNING id
	`, name, scopeType, scopeValue, parsed, currency, basis, userID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &costBudget{ID: id, Name: name, ScopeType: scopeType, ScopeValue: scopeValue, Amount: parsed, Currency: currency, Basis: basis}, nil
}

func deleteCostBudget(id int) error {
	_, err := DB.Exec(`DELETE FROM cost_budgets WHERE id = $1`, id)
	return err
}
