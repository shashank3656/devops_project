package main

import (
	"fmt"
	"sort"
	"strings"
)

type costAllocationRule struct {
	ID          int    `json:"id"`
	MatchType   string `json:"match_type"`
	MatchValue  string `json:"match_value"`
	TeamSlug    string `json:"team_slug"`
	ServiceName string `json:"service_name"`
	Priority    int    `json:"priority"`
}

type costLineQuery struct {
	Service       string
	Region        string
	Account       string
	Team          string
	PortalService string
}

func costNormalizeMatchType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "product", "service":
		return "product"
	case "account":
		return "account"
	default:
		return "resource"
	}
}

func costRuleRank(matchType string) int {
	switch costNormalizeMatchType(matchType) {
	case "resource":
		return 1
	case "product":
		return 2
	case "account":
		return 3
	default:
		return 9
	}
}

func costRuleMatches(rule costAllocationRule, line costLineRow) bool {
	want := strings.TrimSpace(rule.MatchValue)
	if want == "" {
		return false
	}
	switch costNormalizeMatchType(rule.MatchType) {
	case "resource":
		return strings.EqualFold(strings.TrimSpace(line.ResourceID), want)
	case "product":
		return strings.EqualFold(strings.TrimSpace(line.Service), want)
	case "account":
		return strings.EqualFold(strings.TrimSpace(line.AccountID), want)
	default:
		return false
	}
}

func applyCostAllocation(lines []costLineRow, rules []costAllocationRule, accountTeam map[string]string) []costLineRow {
	sorted := append([]costAllocationRule{}, rules...)
	sort.SliceStable(sorted, func(i, j int) bool {
		ri, rj := costRuleRank(sorted[i].MatchType), costRuleRank(sorted[j].MatchType)
		if ri != rj {
			return ri < rj
		}
		if sorted[i].Priority != sorted[j].Priority {
			return sorted[i].Priority < sorted[j].Priority
		}
		return sorted[i].ID < sorted[j].ID
	})
	out := make([]costLineRow, len(lines))
	for i, line := range lines {
		team := ""
		service := ""
		for _, rule := range sorted {
			if !costRuleMatches(rule, line) {
				continue
			}
			team = strings.TrimSpace(rule.TeamSlug)
			service = strings.TrimSpace(rule.ServiceName)
			break
		}
		if team == "" {
			team = strings.TrimSpace(line.TeamSlug)
		}
		if team == "" {
			team = strings.TrimSpace(accountTeam[line.AccountID])
		}
		line.TeamSlug = team
		line.AllocatedService = service
		out[i] = line
	}
	return out
}

func filterAllocatedCostLines(lines []costLineRow, query costLineQuery) []costLineRow {
	if strings.TrimSpace(query.Team) == "" && strings.TrimSpace(query.PortalService) == "" {
		return lines
	}
	out := []costLineRow{}
	team := strings.TrimSpace(query.Team)
	portal := strings.TrimSpace(query.PortalService)
	for _, line := range lines {
		if team != "" && !strings.EqualFold(line.TeamSlug, team) {
			continue
		}
		if portal != "" && !strings.EqualFold(line.AllocatedService, portal) && !strings.Contains(strings.ToLower(line.ResourceID), strings.ToLower(portal)) {
			continue
		}
		out = append(out, line)
	}
	return out
}

func costCSVSafe(value string) string {
	if strings.Contains(value, "@") {
		return ""
	}
	return value
}

func costExplorerCSV(windowStart, windowEnd, basis, currency, coverage string, lines []costLineRow) string {
	var b strings.Builder
	b.WriteString("window_start,window_end,basis,currency,coverage,product,region,account_id,resource_id,team,amount\n")
	for _, line := range lines {
		amount := line.Amount
		if coverage != "complete" {
			amount = "Unknown"
		}
		fmt.Fprintf(&b, "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
			costCSVCell(windowStart), costCSVCell(windowEnd), costCSVCell(basis), costCSVCell(currency), costCSVCell(coverage),
			costCSVCell(costCSVSafe(line.Service)), costCSVCell(costCSVSafe(line.Region)), costCSVCell(costCSVSafe(line.AccountID)),
			costCSVCell(costCSVSafe(line.ResourceID)), costCSVCell(costCSVSafe(line.TeamSlug)), costCSVCell(amount),
		)
	}
	return b.String()
}

func costCSVCell(value string) string {
	if strings.ContainsAny(value, ",\"\n") {
		return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
	return value
}

func listCostAllocationRules() ([]costAllocationRule, error) {
	if DB == nil {
		return []costAllocationRule{}, nil
	}
	rows, err := DB.Query(`
		SELECT id, match_type, match_value, team_slug, service_name, priority
		  FROM cost_allocation_rules
		 ORDER BY priority, id
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_allocation_rules") {
			return []costAllocationRule{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costAllocationRule{}
	for rows.Next() {
		var rule costAllocationRule
		if err := rows.Scan(&rule.ID, &rule.MatchType, &rule.MatchValue, &rule.TeamSlug, &rule.ServiceName, &rule.Priority); err != nil {
			return nil, err
		}
		rule.MatchType = costNormalizeMatchType(rule.MatchType)
		out = append(out, rule)
	}
	return out, nil
}

func createCostAllocationRule(userID int, matchType, matchValue, teamSlug, serviceName string, priority int) (*costAllocationRule, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	matchValue = strings.TrimSpace(matchValue)
	teamSlug = strings.TrimSpace(teamSlug)
	serviceName = strings.TrimSpace(serviceName)
	if strings.Contains(matchValue, "@") || strings.Contains(teamSlug, "@") || strings.Contains(serviceName, "@") {
		return nil, fmt.Errorf("allocation rule cannot include an email")
	}
	if matchValue == "" {
		return nil, fmt.Errorf("match value is required")
	}
	if priority <= 0 {
		priority = 100
	}
	matchType = costNormalizeMatchType(matchType)
	var id int
	err := DB.QueryRow(`
		INSERT INTO cost_allocation_rules (match_type, match_value, team_slug, service_name, priority, created_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id
	`, matchType, matchValue, teamSlug, serviceName, priority, userID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &costAllocationRule{ID: id, MatchType: matchType, MatchValue: matchValue, TeamSlug: teamSlug, ServiceName: serviceName, Priority: priority}, nil
}

func deleteCostAllocationRule(id int) error {
	_, err := DB.Exec(`DELETE FROM cost_allocation_rules WHERE id = $1`, id)
	return err
}

func accountTeamDefaults(connections []costConnection) map[string]string {
	out := map[string]string{}
	for _, conn := range connections {
		if strings.TrimSpace(conn.AccountID) != "" && strings.TrimSpace(conn.TeamSlug) != "" {
			out[conn.AccountID] = conn.TeamSlug
		}
	}
	return out
}
