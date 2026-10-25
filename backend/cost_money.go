package main

import (
	"fmt"
	"math/big"
	"strings"
	"unicode"
)

const costMoneyScale = 6

func parseCostAmount(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("amount is required")
	}
	rat := new(big.Rat)
	if _, ok := rat.SetString(raw); !ok {
		return "", fmt.Errorf("amount is not a number")
	}
	return rat.FloatString(costMoneyScale), nil
}

func subCostAmounts(left, right string) string {
	a, err := parseCostAmount(left)
	if err != nil {
		a = "0." + strings.Repeat("0", costMoneyScale)
	}
	b, err := parseCostAmount(right)
	if err != nil {
		b = "0." + strings.Repeat("0", costMoneyScale)
	}
	diff := new(big.Rat)
	la, _ := new(big.Rat).SetString(a)
	lb, _ := new(big.Rat).SetString(b)
	diff.Sub(la, lb)
	return diff.FloatString(costMoneyScale)
}

func costOwnershipView(total, unallocated, coverage, currency string) map[string]any {
	view := map[string]any{
		"coverage": coverage,
		"currency": currency,
		"display":  "Unknown",
		"percent":  nil,
	}
	if coverage != "complete" {
		return view
	}
	if total == "" || total == "0."+strings.Repeat("0", costMoneyScale) {
		view["display"] = "Unknown"
		return view
	}
	allocated := subCostAmounts(total, unallocated)
	tr, ar := new(big.Rat), new(big.Rat)
	if _, ok := tr.SetString(total); !ok {
		return view
	}
	if _, ok := ar.SetString(allocated); !ok {
		return view
	}
	pct := new(big.Rat).Quo(ar, tr)
	pct.Mul(pct, big.NewRat(100, 1))
	shown := pct.FloatString(0)
	view["percent"] = shown
	view["display"] = shown + "% allocated"
	view["allocated"] = allocated
	return view
}

func addCostAmounts(left, right string) string {
	a, err := parseCostAmount(left)
	if err != nil {
		a = "0." + strings.Repeat("0", costMoneyScale)
	}
	b, err := parseCostAmount(right)
	if err != nil {
		b = "0." + strings.Repeat("0", costMoneyScale)
	}
	sum := new(big.Rat)
	la, _ := new(big.Rat).SetString(a)
	lb, _ := new(big.Rat).SetString(b)
	sum.Add(la, lb)
	return sum.FloatString(costMoneyScale)
}

func costPercentOf(amount string, percent int) string {
	parsed, err := parseCostAmount(amount)
	if err != nil {
		return "0." + strings.Repeat("0", costMoneyScale)
	}
	rat := new(big.Rat)
	rat.SetString(parsed)
	rat.Mul(rat, new(big.Rat).SetInt64(int64(percent)))
	rat.Quo(rat, new(big.Rat).SetInt64(100))
	return rat.FloatString(costMoneyScale)
}

func formatCostDisplay(amount, currency string) string {
	parsed, err := parseCostAmount(amount)
	if err != nil {
		return "Unknown"
	}
	rat := new(big.Rat)
	rat.SetString(parsed)
	shown := rat.FloatString(2)
	label := strings.ToUpper(strings.TrimSpace(currency))
	if label == "" {
		label = "USD"
	}
	return label + " " + withCostThousands(shown)
}

func withCostThousands(value string) string {
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimPrefix(value, "-")
	parts := strings.SplitN(value, ".", 2)
	digits := []rune(parts[0])
	var grouped []rune
	for i, ch := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			grouped = append(grouped, ',')
		}
		grouped = append(grouped, ch)
	}
	out := string(grouped)
	if len(parts) == 2 {
		frac := []rune(parts[1])
		for _, ch := range frac {
			if !unicode.IsDigit(ch) {
				return value
			}
		}
		out += "." + parts[1]
	}
	if negative {
		return "-" + out
	}
	return out
}

func costCoverage(hasLines, complete bool) string {
	if !hasLines {
		return "none"
	}
	if !complete {
		return "incomplete"
	}
	return "complete"
}

func costMoneyView(coverage, amount, currency, basis string) map[string]any {
	basis = strings.ToLower(strings.TrimSpace(basis))
	if basis != "amortized" {
		basis = "actual"
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		currency = "USD"
	}
	view := map[string]any{
		"coverage": coverage,
		"currency": currency,
		"basis":    basis,
	}
	if coverage != "complete" {
		view["display"] = "Unknown"
		view["amount"] = nil
		return view
	}
	view["amount"] = amount
	view["display"] = formatCostDisplay(amount, currency)
	return view
}

func normalizeCostBasis(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == "amortized" {
		return "amortized"
	}
	return "actual"
}

func normalizeCostCurrency(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) != 3 {
		return "USD"
	}
	return value
}

func costDemoAccountID(accountID string) bool {
	switch strings.TrimSpace(accountID) {
	case "111122223333", "444455556666":
		return true
	default:
		return false
	}
}
