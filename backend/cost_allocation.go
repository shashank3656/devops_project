package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type costAllocationRule struct {
	ID               int    `json:"id"`
	MatchType        string `json:"match_type"`
	MatchValue       string `json:"match_value"`
	TeamSlug         string `json:"team_slug"`
	ServiceName      string `json:"service_name"`
	Priority         int    `json:"priority"`
	Version          int    `json:"version,omitempty"`
	EffectiveFrom    string `json:"effective_from,omitempty"`
	EffectiveTo      string `json:"effective_to,omitempty"`
	SupersedesRuleID int    `json:"supersedes_rule_id,omitempty"`
}

type costLineQuery struct {
	Service       string
	Region        string
	Account       string
	Team          string
	Family        string
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

func costRuleEffectiveOn(rule costAllocationRule, usageDate string) bool {
	usageDate = strings.TrimSpace(usageDate)
	if usageDate == "" {
		usageDate = time.Now().UTC().Format("2006-01-02")
	}
	from := strings.TrimSpace(rule.EffectiveFrom)
	to := strings.TrimSpace(rule.EffectiveTo)
	if from != "" && usageDate < from {
		return false
	}
	if to != "" && usageDate > to {
		return false
	}
	return true
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
		if sorted[i].Version != sorted[j].Version {
			return sorted[i].Version > sorted[j].Version
		}
		return sorted[i].ID < sorted[j].ID
	})
	out := make([]costLineRow, len(lines))
	for i, line := range lines {
		team := ""
		service := ""
		for _, rule := range sorted {
			if !costRuleEffectiveOn(rule, line.UsageDate) {
				continue
			}
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

func costFamilyMatches(service, want string) bool {
	want = strings.ToLower(strings.TrimSpace(want))
	if want == "" {
		return true
	}
	got := costFindingFamily(service)
	return want == got || want == strings.ToLower(costFamilyLabel(got))
}

func filterAllocatedCostLines(lines []costLineRow, query costLineQuery) []costLineRow {
	team := strings.TrimSpace(query.Team)
	portal := strings.TrimSpace(query.PortalService)
	family := strings.TrimSpace(query.Family)
	if team == "" && portal == "" && family == "" {
		return lines
	}
	out := []costLineRow{}
	for _, line := range lines {
		if team != "" {
			wantUnallocated := strings.EqualFold(team, "unallocated")
			if wantUnallocated {
				if strings.TrimSpace(line.TeamSlug) != "" {
					continue
				}
			} else if !strings.EqualFold(line.TeamSlug, team) {
				continue
			}
		}
		if portal != "" && !strings.EqualFold(line.AllocatedService, portal) && !strings.Contains(strings.ToLower(line.ResourceID), strings.ToLower(portal)) {
			continue
		}
		if family != "" && !costFamilyMatches(line.Service, family) {
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
		SELECT id, match_type, match_value, team_slug, service_name, priority,
		       COALESCE(version, 1), COALESCE(to_char(effective_from, 'YYYY-MM-DD'), ''),
		       COALESCE(to_char(effective_to, 'YYYY-MM-DD'), ''), COALESCE(supersedes_rule_id, 0)
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
		if err := rows.Scan(&rule.ID, &rule.MatchType, &rule.MatchValue, &rule.TeamSlug, &rule.ServiceName, &rule.Priority, &rule.Version, &rule.EffectiveFrom, &rule.EffectiveTo, &rule.SupersedesRuleID); err != nil {
			return nil, err
		}
		rule.MatchType = costNormalizeMatchType(rule.MatchType)
		if rule.Version <= 0 {
			rule.Version = 1
		}
		out = append(out, rule)
	}
	return out, nil
}

func currentCostAllocationRules(rules []costAllocationRule, asOf string) []costAllocationRule {
	asOf = strings.TrimSpace(asOf)
	if asOf == "" {
		asOf = time.Now().UTC().Format("2006-01-02")
	}
	out := []costAllocationRule{}
	for _, rule := range rules {
		if costRuleEffectiveOn(rule, asOf) {
			out = append(out, rule)
		}
	}
	return out
}

func costValidateAllocationValue(matchType, matchValue, teamSlug, serviceName string) error {
	switch costNormalizeMatchType(matchType) {
	case "account":
		if len(matchValue) != 12 {
			return fmt.Errorf("account identifier must be 12 digits")
		}
		for _, ch := range matchValue {
			if ch < '0' || ch > '9' {
				return fmt.Errorf("account identifier must be 12 digits")
			}
		}
	case "product":
		if len(matchValue) < 3 {
			return fmt.Errorf("product name is too short")
		}
	default:
		if len(matchValue) < 3 || strings.ContainsAny(matchValue, " \t") {
			return fmt.Errorf("resource identifier is not valid")
		}
	}
	if teamSlug != "" {
		if len(teamSlug) < 2 || strings.ContainsAny(teamSlug, " \t/") {
			return fmt.Errorf("team is not valid")
		}
	}
	if serviceName != "" {
		if len(serviceName) < 2 || strings.ContainsAny(serviceName, " \t") {
			return fmt.Errorf("service name is not valid")
		}
	}
	return nil
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
	if err := costValidateAllocationValue(matchType, matchValue, teamSlug, serviceName); err != nil {
		return nil, err
	}
	if priority <= 0 {
		priority = 100
	}
	matchType = costNormalizeMatchType(matchType)
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	supersedes := 0
	version := 1
	_ = DB.QueryRow(`
		SELECT id, COALESCE(version, 1)
		  FROM cost_allocation_rules
		 WHERE match_type = $1 AND match_value = $2
		   AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
		 ORDER BY version DESC, id DESC
		 LIMIT 1
	`, matchType, matchValue).Scan(&supersedes, &version)
	if supersedes > 0 {
		version++
		if _, err := DB.Exec(`UPDATE cost_allocation_rules SET effective_to = $2 WHERE id = $1 AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`, supersedes, yesterday); err != nil {
			return nil, err
		}
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO cost_allocation_rules (match_type, match_value, team_slug, service_name, priority, created_by, version, effective_from, supersedes_rule_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id
	`, matchType, matchValue, teamSlug, serviceName, priority, userID, version, today, supersedes).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &costAllocationRule{
		ID: id, MatchType: matchType, MatchValue: matchValue, TeamSlug: teamSlug, ServiceName: serviceName,
		Priority: priority, Version: version, EffectiveFrom: today, SupersedesRuleID: supersedes,
	}, nil
}

func deleteCostAllocationRule(id int) error {
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	res, err := DB.Exec(`UPDATE cost_allocation_rules SET effective_to = $2 WHERE id = $1 AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`, id, yesterday)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_, err = DB.Exec(`DELETE FROM cost_allocation_rules WHERE id = $1 AND effective_from IS NULL`, id)
	}
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
