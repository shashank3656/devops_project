package main

import (
	"fmt"
	"math/big"
	"sort"
	"strings"
)

type costGraphBar struct {
	Label   string `json:"label"`
	Display string `json:"display"`
	Percent int    `json:"percent"`
	Date    string `json:"date,omitempty"`
}

func userCanSeeCostProject(userID, projectID int) bool {
	if userID <= 0 || projectID <= 0 {
		return false
	}
	_, ok := projectIDSet(visibleProjectIDsForUser(userID))[projectID]
	return ok
}

func filterCostConnectionsByProject(items []costConnection, visible map[int]struct{}) []costConnection {
	if len(items) == 0 {
		return []costConnection{}
	}
	out := make([]costConnection, 0, len(items))
	for _, item := range items {
		if item.ProjectID <= 0 {
			continue
		}
		if _, ok := visible[item.ProjectID]; !ok {
			continue
		}
		out = append(out, item)
	}
	return out
}

func costCloudLabel(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "aws":
		return "AWS"
	case "gcp":
		return "GCP"
	case "azure":
		return "Azure"
	default:
		if strings.TrimSpace(provider) == "" {
			return "Cloud"
		}
		return strings.ToUpper(strings.TrimSpace(provider))
	}
}

func costFamilyLabel(family string) string {
	switch strings.ToLower(strings.TrimSpace(family)) {
	case "compute":
		return "Compute"
	case "database":
		return "Database"
	case "storage":
		return "Storage"
	default:
		return "Other"
	}
}

func costLinesForAccount(lines []costLineRow, accountID string) []costLineRow {
	want := strings.TrimSpace(accountID)
	if want == "" {
		return []costLineRow{}
	}
	out := make([]costLineRow, 0, len(lines))
	for _, line := range lines {
		if strings.EqualFold(strings.TrimSpace(line.AccountID), want) {
			out = append(out, line)
		}
	}
	return out
}

func costSharePercent(part, total string) int {
	parsedPart, err := parseCostAmount(part)
	if err != nil {
		return 0
	}
	parsedTotal, err := parseCostAmount(total)
	if err != nil {
		return 0
	}
	tr := new(big.Rat)
	if _, ok := tr.SetString(parsedTotal); !ok || tr.Sign() == 0 {
		return 0
	}
	pr := new(big.Rat)
	if _, ok := pr.SetString(parsedPart); !ok {
		return 0
	}
	pct := new(big.Rat).Quo(pr, tr)
	pct.Mul(pct, big.NewRat(100, 1))
	shown := pct.FloatString(0)
	n := 0
	fmt.Sscanf(shown, "%d", &n)
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func costServiceSeries(lines []costLineRow, coverage, currency, basis string) []costGraphBar {
	if coverage != "complete" || len(lines) == 0 {
		return []costGraphBar{}
	}
	totals := map[string]string{}
	order := []string{}
	grand := "0." + strings.Repeat("0", costMoneyScale)
	for _, line := range lines {
		family := costFamilyLabel(costFindingFamily(line.Service))
		amount := line.Actual
		if basis == "amortized" {
			amount = line.Amortized
		}
		if _, ok := totals[family]; !ok {
			order = append(order, family)
			totals[family] = "0." + strings.Repeat("0", costMoneyScale)
		}
		totals[family] = addCostAmounts(totals[family], amount)
		grand = addCostAmounts(grand, amount)
	}
	sort.SliceStable(order, func(i, j int) bool {
		return strings.Compare(totals[order[j]], totals[order[i]]) > 0
	})
	out := make([]costGraphBar, 0, len(order))
	for _, label := range order {
		out = append(out, costGraphBar{
			Label:   label,
			Display: formatCostDisplay(totals[label], currency),
			Percent: costSharePercent(totals[label], grand),
		})
	}
	return out
}

func costDaySeries(lines []costLineRow, coverage, currency, basis string) []costGraphBar {
	if coverage != "complete" || len(lines) == 0 {
		return []costGraphBar{}
	}
	totals := map[string]string{}
	dates := []string{}
	max := "0." + strings.Repeat("0", costMoneyScale)
	for _, line := range lines {
		day := strings.TrimSpace(line.UsageDate)
		if day == "" {
			continue
		}
		amount := line.Actual
		if basis == "amortized" {
			amount = line.Amortized
		}
		if _, ok := totals[day]; !ok {
			dates = append(dates, day)
			totals[day] = "0." + strings.Repeat("0", costMoneyScale)
		}
		totals[day] = addCostAmounts(totals[day], amount)
		if strings.Compare(totals[day], max) > 0 {
			max = totals[day]
		}
	}
	sort.Strings(dates)
	out := make([]costGraphBar, 0, len(dates))
	for _, day := range dates {
		out = append(out, costGraphBar{
			Label:   day,
			Date:    day,
			Display: formatCostDisplay(totals[day], currency),
			Percent: costSharePercent(totals[day], max),
		})
	}
	return out
}

func costImportableSources(conn costConnection, k8sBound bool) []map[string]any {
	status := func(ready string, imported bool) string {
		if !imported {
			return "not_imported"
		}
		if costReadiness(ready) == "ready" {
			return "ready"
		}
		return "unknown"
	}
	provider := strings.ToLower(strings.TrimSpace(conn.Provider))
	if provider != "" && provider != "aws" {
		return []map[string]any{{
			"id":     "cloud_billing",
			"label":  costCloudLabel(conn.Provider) + " billing",
			"status": "not_imported",
			"href":   "/cost/configuration",
			"note":   "This product imports AWS CUR 2.0 today. Spend for this cloud stays Unknown until that export exists.",
		}}
	}
	billingImported := strings.TrimSpace(conn.LatestRevision) != "" || costReadiness(conn.BillingReadiness) == "ready"
	return []map[string]any{
		{
			"id":     "aws_cur_2",
			"label":  "AWS CUR 2.0 billing",
			"status": status(conn.BillingReadiness, billingImported),
			"href":   "/cost/configuration",
			"note":   "Invoice lines for this account. Incomplete windows stay Unknown, never $0.",
		},
		{
			"id":     "inventory",
			"label":  "Cloud inventory",
			"status": status(conn.InventoryReadiness, costReadiness(conn.InventoryReadiness) == "ready"),
			"href":   "/cloud-resources",
			"note":   "Existing inventory on this cloud account. Cost does not create resources.",
		},
		{
			"id":     "metrics",
			"label":  "Utilization metrics",
			"status": status(conn.MetricsReadiness, costReadiness(conn.MetricsReadiness) == "ready"),
			"href":   "/cost/optimization",
			"note":   "Needed before rightsizing can leave blocked. Missing usage is Needs more data, not zero.",
		},
		{
			"id":     "k8s_snapshot",
			"label":  "Kubernetes allocation snapshot",
			"status": status("ready", k8sBound),
			"href":   "/cost/kubernetes",
			"note":   "A breakdown of billed node lines. Never added again to cloud spend.",
		},
	}
}

func costAccountSpend(lines []costLineRow, coverage, currency, basis string) map[string]any {
	total, _, lineCurrency, hasLines := rollupCostLines(lines, basis)
	if lineCurrency != "" {
		currency = lineCurrency
	}
	if coverage != "complete" || !hasLines {
		return costMoneyView(costCoverage(hasLines, coverage == "complete"), total, currency, basis)
	}
	return costMoneyView("complete", total, currency, basis)
}

func groupCostTree(connections []costConnection, lines []costLineRow, coverage, currency, basis string, bound map[int]bool) []map[string]any {
	type accountNode struct {
		conn  costConnection
		spend map[string]any
	}
	type cloudNode struct {
		provider string
		accounts []accountNode
	}
	type projectNode struct {
		id    int
		name  string
		code  string
		cloud map[string]*cloudNode
	}
	projects := map[int]*projectNode{}
	order := []int{}
	for _, conn := range connections {
		if conn.ProjectID <= 0 {
			continue
		}
		project, ok := projects[conn.ProjectID]
		if !ok {
			project = &projectNode{
				id:    conn.ProjectID,
				name:  strings.TrimSpace(conn.ProjectName),
				code:  strings.TrimSpace(conn.ProjectCode),
				cloud: map[string]*cloudNode{},
			}
			if project.name == "" {
				project.name = "Project"
			}
			projects[conn.ProjectID] = project
			order = append(order, conn.ProjectID)
		}
		provider := costCloudLabel(conn.Provider)
		cloud, ok := project.cloud[provider]
		if !ok {
			cloud = &cloudNode{provider: provider}
			project.cloud[provider] = cloud
		}
		cloud.accounts = append(cloud.accounts, accountNode{
			conn:  conn,
			spend: costAccountSpend(costLinesForAccount(lines, conn.AccountID), coverage, currency, basis),
		})
	}
	sort.SliceStable(order, func(i, j int) bool {
		left, right := projects[order[i]], projects[order[j]]
		if left.name != right.name {
			return left.name < right.name
		}
		return left.code < right.code
	})
	out := make([]map[string]any, 0, len(order))
	for _, projectID := range order {
		project := projects[projectID]
		cloudKeys := make([]string, 0, len(project.cloud))
		for key := range project.cloud {
			cloudKeys = append(cloudKeys, key)
		}
		sort.Strings(cloudKeys)
		clouds := make([]map[string]any, 0, len(cloudKeys))
		projectLines := []costLineRow{}
		for _, key := range cloudKeys {
			cloud := project.cloud[key]
			sort.SliceStable(cloud.accounts, func(i, j int) bool {
				return cloud.accounts[i].conn.DisplayName < cloud.accounts[j].conn.DisplayName
			})
			accounts := make([]map[string]any, 0, len(cloud.accounts))
			cloudLines := []costLineRow{}
			for _, account := range cloud.accounts {
				accountLines := costLinesForAccount(lines, account.conn.AccountID)
				cloudLines = append(cloudLines, accountLines...)
				projectLines = append(projectLines, accountLines...)
				k8sBound := bound[account.conn.ID]
				accounts = append(accounts, costTreeAccountView(account.conn, account.spend, k8sBound))
			}
			clouds = append(clouds, map[string]any{
				"provider":      cloud.provider,
				"account_count": len(accounts),
				"spend":         costAccountSpend(cloudLines, coverage, currency, basis),
				"accounts":      accounts,
			})
		}
		out = append(out, map[string]any{
			"id":          project.id,
			"name":        project.name,
			"code":        project.code,
			"href":        fmt.Sprintf("/cost/projects/%d", project.id),
			"cloud_count": len(clouds),
			"spend":       costAccountSpend(projectLines, coverage, currency, basis),
			"clouds":      clouds,
		})
	}
	return out
}

func costBoundK8sConnections(userID int) map[int]bool {
	out := map[int]bool{}
	items, err := listCostK8sBindings(userID)
	if err != nil {
		return out
	}
	for _, item := range items {
		if item.CostConnectionID > 0 {
			out[item.CostConnectionID] = true
		}
	}
	return out
}

func costEnvironmentDisplay(values []string) string {
	clean := []string{}
	seen := map[string]struct{}{}
	for _, value := range values {
		label := strings.TrimSpace(value)
		if label == "" {
			continue
		}
		key := strings.ToLower(label)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, label)
	}
	if len(clean) == 0 {
		return "Unknown"
	}
	return strings.Join(clean, ", ")
}

func costStaleHint(freshness string) map[string]any {
	if strings.ToLower(strings.TrimSpace(freshness)) != "stale" {
		return nil
	}
	return map[string]any{
		"status": "stale",
		"note":   "Last ingest is older than this window.",
		"href":   "/cost/configuration",
	}
}

func costImportStatus(conn costConnection) string {
	if conn.ID <= 0 {
		return "not_imported"
	}
	if costReadiness(conn.BillingReadiness) == "ready" || strings.TrimSpace(conn.LatestRevision) != "" {
		return "ready"
	}
	return "not_imported"
}

func costAccountHref(conn costConnection) string {
	if conn.ID > 0 {
		return fmt.Sprintf("/cost/accounts/%d", conn.ID)
	}
	if conn.CloudAccountID > 0 {
		return fmt.Sprintf("/cost/cloud/%d", conn.CloudAccountID)
	}
	return "/cost/configuration"
}

func costTreeAccountView(conn costConnection, spend map[string]any, k8sBound bool) map[string]any {
	view := map[string]any{
		"id":                  conn.ID,
		"cloud_account_id":    conn.CloudAccountID,
		"display_name":        conn.DisplayName,
		"provider":            conn.Provider,
		"href":                costAccountHref(conn),
		"spend":               spend,
		"freshness":           conn.Freshness,
		"billing_readiness":   conn.BillingReadiness,
		"inventory_readiness": conn.InventoryReadiness,
		"metrics_readiness":   conn.MetricsReadiness,
		"import_status":       costImportStatus(conn),
		"environment":         costEnvironmentDisplay(conn.Environments),
		"importable":          costImportableSources(conn, k8sBound),
		"suggestion_href":     "/cost/optimization",
		"stale_hint":          costStaleHint(conn.Freshness),
	}
	return view
}

func listVisibleCostCloudAccounts(userID int) []cloudAccountRecord {
	slugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil || len(slugs) == 0 {
		return []cloudAccountRecord{}
	}
	accounts, err := listCloudAccountsForTeams(slugs)
	if err != nil {
		return []cloudAccountRecord{}
	}
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	out := []cloudAccountRecord{}
	for _, account := range accounts {
		if costDemoAccountID(account.AccountID) || strings.EqualFold(account.Status, "disabled") {
			continue
		}
		if account.ProjectID <= 0 {
			continue
		}
		if _, ok := visible[account.ProjectID]; !ok {
			continue
		}
		out = append(out, account)
	}
	return out
}

func mergeCostTreeConnections(userID int, connections []costConnection) []costConnection {
	byAccount := map[int]struct{}{}
	out := append([]costConnection{}, connections...)
	for _, conn := range connections {
		if conn.CloudAccountID > 0 {
			byAccount[conn.CloudAccountID] = struct{}{}
		}
	}
	for _, account := range listVisibleCostCloudAccounts(userID) {
		if _, ok := byAccount[account.ID]; ok {
			continue
		}
		out = append(out, costConnection{
			CloudAccountID:     account.ID,
			AccountID:          account.AccountID,
			DisplayName:        account.DisplayName,
			Provider:           account.Provider,
			TeamSlug:           account.TeamSlug,
			ProjectID:          account.ProjectID,
			ProjectName:        account.ProjectName,
			ProjectCode:        account.ProjectCode,
			Environments:       account.Environments,
			Status:             "not_imported",
			BillingReadiness:   "unknown",
			InventoryReadiness: costReadiness(inventoryReadinessForAccount(account.Provider, account.AccountID)),
			MetricsReadiness:   "unknown",
			Freshness:          "unknown",
		})
	}
	return out
}

func buildCostTreeNodes(userID int, slice *costWindowSlice) []map[string]any {
	if slice == nil {
		return []map[string]any{}
	}
	connections := mergeCostTreeConnections(userID, slice.Connections)
	tree := groupCostTree(connections, slice.Lines, slice.Coverage, slice.Currency, slice.Basis, costBoundK8sConnections(userID))
	for _, project := range tree {
		id, _ := project["id"].(int)
		role := userCostRoleForProject(userID, id)
		project["cost_role"] = role
		project["can_operate"] = role == "operate"
		project["href"] = fmt.Sprintf("/cost/projects/%d", id)
	}
	return tree
}

func buildCostTree(userID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":       "ok",
		"basis":        slice.Basis,
		"currency":     slice.Currency,
		"window_start": slice.WindowStart,
		"window_end":   slice.WindowEnd,
		"coverage":     slice.Coverage,
		"freshness":    slice.Freshness,
		"rbac":         "project",
		"can_operate":  userHasCostOperateAnywhere(userID),
		"projects":     buildCostTreeNodes(userID, slice),
		"ai":           costAIPolicy(),
		"note":         "Cost is granted at project level. Click an account for spend, importable sources, and suggestions. Kubernetes is a breakdown of this bill, never an extra line.",
	}, nil
}

func costWindowCompare(current, prior map[string]any, priorStart, priorEnd, priorCoverage string) map[string]any {
	like := current != nil && prior != nil
	if current != nil {
		coverage, _ := current["coverage"].(string)
		if coverage != "complete" {
			like = false
		}
	}
	if prior != nil {
		coverage, _ := prior["coverage"].(string)
		if coverage != "complete" {
			like = false
		}
	}
	delta := costMoneyView("incomplete", "", "USD", "actual")
	if like {
		curAmount, _ := current["amount"].(string)
		priorAmount, _ := prior["amount"].(string)
		currency, _ := current["currency"].(string)
		basis, _ := current["basis"].(string)
		delta = costMoneyView("complete", subCostAmounts(curAmount, priorAmount), currency, basis)
	}
	return map[string]any{
		"current":            current,
		"prior":              prior,
		"delta":              delta,
		"prior_window_start": priorStart,
		"prior_window_end":   priorEnd,
		"prior_coverage":     priorCoverage,
		"like_for_like":      like,
		"note":               "Comparison needs two complete like-for-like windows. Incomplete stays Unknown, never a drop to $0.",
	}
}

func costBudgetsForAccount(budgets []costBudgetStatus, accountID, teamSlug string) []costBudgetStatus {
	out := []costBudgetStatus{}
	for _, budget := range budgets {
		switch costNormalizeScope(budget.ScopeType) {
		case "all":
			out = append(out, budget)
		case "account":
			if strings.EqualFold(strings.TrimSpace(budget.ScopeValue), strings.TrimSpace(accountID)) {
				out = append(out, budget)
			}
		case "team":
			if strings.EqualFold(strings.TrimSpace(budget.ScopeValue), strings.TrimSpace(teamSlug)) {
				out = append(out, budget)
			}
		}
	}
	return out
}

func loadPriorAccountSlice(userID int, current *costWindowSlice, accountID string) (*costWindowSlice, string, string) {
	if current == nil || current.WindowStart == "" || current.WindowEnd == "" {
		return &costWindowSlice{Coverage: "none"}, "", ""
	}
	start, startErr := costParseDate(current.WindowStart)
	end, endErr := costParseDate(current.WindowEnd)
	if startErr != nil || endErr != nil {
		return &costWindowSlice{Coverage: "none", Currency: current.Currency, Basis: current.Basis}, "", ""
	}
	priorStart, priorEnd := priorLikeForLikeWindow(start, end)
	loaded, err := loadCostWindowSlice(userID, current.Basis, current.Currency, priorStart.Format("2006-01-02"), priorEnd.Format("2006-01-02"), costLineQuery{Account: accountID})
	if err != nil || loaded == nil {
		return &costWindowSlice{Coverage: "none", Currency: current.Currency, Basis: current.Basis}, priorStart.Format("2006-01-02"), priorEnd.Format("2006-01-02")
	}
	return loaded, loaded.WindowStart, loaded.WindowEnd
}

func buildCostProjectDashboard(userID, projectID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	if !userCanSeeCostProject(userID, projectID) {
		return nil, fmt.Errorf("cost project not found")
	}
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		return nil, err
	}
	tree := buildCostTreeNodes(userID, slice)
	var project map[string]any
	for _, item := range tree {
		id, _ := item["id"].(int)
		if id == projectID {
			project = item
			break
		}
	}
	if project == nil {
		projects, projErr := getVisibleProjectsForUser(userID)
		name, code := "Project", ""
		if projErr == nil {
			for _, item := range projects {
				if item.ID == projectID {
					name, code = item.Name, item.Code
					break
				}
			}
		}
		project = map[string]any{
			"id": projectID, "name": name, "code": code, "clouds": []map[string]any{},
			"spend": costMoneyView("none", "", slice.Currency, slice.Basis),
		}
	}
	accountIDs := map[string]struct{}{}
	projectLines := []costLineRow{}
	clouds, _ := project["clouds"].([]map[string]any)
	for _, cloud := range clouds {
		accounts, _ := cloud["accounts"].([]map[string]any)
		for _, account := range accounts {
			cloudAccountID, _ := account["cloud_account_id"].(int)
			for _, conn := range slice.Connections {
				if conn.CloudAccountID == cloudAccountID || conn.ProjectID == projectID {
					accountIDs[conn.AccountID] = struct{}{}
				}
			}
		}
	}
	for _, line := range slice.Lines {
		if _, ok := accountIDs[line.AccountID]; ok {
			projectLines = append(projectLines, line)
		}
	}
	if len(accountIDs) == 0 {
		for _, conn := range slice.Connections {
			if conn.ProjectID == projectID {
				accountIDs[conn.AccountID] = struct{}{}
			}
		}
		projectLines = []costLineRow{}
		for _, line := range slice.Lines {
			if _, ok := accountIDs[line.AccountID]; ok {
				projectLines = append(projectLines, line)
			}
		}
	}
	insights, err := buildCostInsights(userID, basis, currency, fromRaw, toRaw, costMetricsContext{})
	if err != nil {
		return nil, err
	}
	suggestions := []map[string]any{}
	for accountID := range accountIDs {
		suggestions = append(suggestions, costDashboardSuggestions(insights.Recommendations, accountID)...)
	}
	budgets, err := evaluateCostBudgetsForSlice(slice)
	if err != nil {
		return nil, err
	}
	role := userCostRoleForProject(userID, projectID)
	return map[string]any{
		"status":        "ok",
		"basis":         slice.Basis,
		"currency":      slice.Currency,
		"window_start":  slice.WindowStart,
		"window_end":    slice.WindowEnd,
		"coverage":      slice.Coverage,
		"freshness":     slice.Freshness,
		"rbac":          "project",
		"cost_role":     role,
		"can_operate":   role == "operate",
		"project":       project,
		"spend":         costAccountSpend(projectLines, slice.Coverage, slice.Currency, slice.Basis),
		"service_mix":   costServiceSeries(projectLines, slice.Coverage, slice.Currency, slice.Basis),
		"daily":         costDaySeries(projectLines, slice.Coverage, slice.Currency, slice.Basis),
		"suggestions":   suggestions,
		"waiting_count": countCostWaiting(insights.Recommendations),
		"budgets":       budgets,
		"ai":            costAIPolicy(),
		"note":          "Project Cost is the rollup of clouds and accounts you can see. Kubernetes is a breakdown of the cloud bill, never an extra line.",
	}, nil
}

func decorateCostAccountDashboard(userID int, conn *costConnection, payload map[string]any, slice *costWindowSlice, lines []costLineRow) map[string]any {
	role := userCostRoleForProject(userID, conn.ProjectID)
	payload["cost_role"] = role
	payload["can_operate"] = role == "operate"
	payload["environment"] = costEnvironmentDisplay(conn.Environments)
	payload["import_status"] = costImportStatus(*conn)
	payload["stale_hint"] = costStaleHint(conn.Freshness)
	payload["export_href"] = fmt.Sprintf("/api/cost/connections/%d/export", conn.ID)
	prior, priorStart, priorEnd := loadPriorAccountSlice(userID, slice, conn.AccountID)
	priorLines := costLinesForAccount(prior.Lines, conn.AccountID)
	payload["compare"] = costWindowCompare(
		costAccountSpend(lines, slice.Coverage, slice.Currency, slice.Basis),
		costAccountSpend(priorLines, prior.Coverage, prior.Currency, prior.Basis),
		priorStart, priorEnd, prior.Coverage,
	)
	if budgets, err := evaluateCostBudgetsForSlice(slice); err == nil {
		payload["budgets"] = costBudgetsForAccount(budgets, conn.AccountID, conn.TeamSlug)
	}
	return payload
}

func costDashboardSuggestions(recs []costRecommendation, accountID string) []map[string]any {
	out := []map[string]any{}
	for _, item := range recs {
		if strings.TrimSpace(accountID) != "" && !strings.EqualFold(strings.TrimSpace(item.AccountID), accountID) {
			continue
		}
		out = append(out, map[string]any{
			"calc_id":         item.CalcID,
			"finding_type":    item.FindingType,
			"family":          costFamilyLabel(costFindingFamily(item.Service)),
			"status":          item.Status,
			"lifecycle":       item.Lifecycle,
			"savings_low":     item.SavingsLow,
			"savings_high":    item.SavingsHigh,
			"blocked_reason":  item.BlockedReason,
			"proposed_action": item.ProposedAction,
			"executes":        false,
			"href":            "/cost/optimization?calc=" + item.CalcID,
		})
	}
	return out
}

func buildCostAccountDashboard(userID, connectionID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	conn, err := getCostConnection(userID, connectionID)
	if err != nil || conn == nil {
		return nil, fmt.Errorf("cost connection not found")
	}
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{Account: conn.AccountID})
	if err != nil {
		return nil, err
	}
	lines := costLinesForAccount(slice.Lines, conn.AccountID)
	insights, err := buildCostInsights(userID, basis, currency, fromRaw, toRaw, costMetricsContext{})
	if err != nil {
		return nil, err
	}
	k8sBound := costBoundK8sConnections(userID)[conn.ID]
	suggestions := costDashboardSuggestions(insights.Recommendations, conn.AccountID)
	payload := map[string]any{
		"status":       "ok",
		"basis":        slice.Basis,
		"currency":     slice.Currency,
		"window_start": slice.WindowStart,
		"window_end":   slice.WindowEnd,
		"coverage":     slice.Coverage,
		"freshness":    slice.Freshness,
		"rbac":         "project",
		"project": map[string]any{
			"id":   conn.ProjectID,
			"name": conn.ProjectName,
			"code": conn.ProjectCode,
		},
		"cloud":       costCloudLabel(conn.Provider),
		"connection":  conn,
		"spend":       costAccountSpend(lines, slice.Coverage, slice.Currency, slice.Basis),
		"service_mix": costServiceSeries(lines, slice.Coverage, slice.Currency, slice.Basis),
		"daily":       costDaySeries(lines, slice.Coverage, slice.Currency, slice.Basis),
		"importable":  costImportableSources(*conn, k8sBound),
		"suggestions": suggestions,
		"kubernetes": map[string]any{
			"bound":                k8sBound,
			"added_to_cloud_total": false,
			"href":                 "/cost/kubernetes",
			"note":                 "Kubernetes cost is a breakdown of charges already on this cloud bill. It is never added again to total cloud spend.",
		},
		"ai":   costAIPolicy(),
		"note": "Acceptance is not permission to execute. Incomplete graphs stay empty, never a fake $0. Copilot never receives this account number, role names, or passwords.",
	}
	return decorateCostAccountDashboard(userID, conn, payload, slice, lines), nil
}

func buildCostCloudDashboard(userID, cloudAccountID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	account, err := getCloudAccountByID(cloudAccountID)
	if err != nil || account == nil {
		return nil, fmt.Errorf("cloud account not found")
	}
	if costDemoAccountID(account.AccountID) || account.ProjectID <= 0 || !userCanSeeCostProject(userID, account.ProjectID) {
		return nil, fmt.Errorf("cloud account not found")
	}
	if conn, connErr := getCostConnectionByCloudAccount(userID, cloudAccountID); connErr == nil && conn != nil {
		return buildCostAccountDashboard(userID, conn.ID, basis, currency, fromRaw, toRaw)
	}
	placeholder := costConnection{
		CloudAccountID:     account.ID,
		AccountID:          account.AccountID,
		DisplayName:        account.DisplayName,
		Provider:           account.Provider,
		TeamSlug:           account.TeamSlug,
		ProjectID:          account.ProjectID,
		ProjectName:        account.ProjectName,
		ProjectCode:        account.ProjectCode,
		Environments:       account.Environments,
		Status:             "not_imported",
		BillingReadiness:   "unknown",
		InventoryReadiness: inventoryReadinessForAccount(account.Provider, account.AccountID),
		MetricsReadiness:   "unknown",
		Freshness:          "unknown",
	}
	role := userCostRoleForProject(userID, account.ProjectID)
	return map[string]any{
		"status":        "ok",
		"basis":         normalizeCostBasis(basis),
		"currency":      normalizeCostCurrency(currency),
		"coverage":      "none",
		"freshness":     "unknown",
		"rbac":          "project",
		"cost_role":     role,
		"can_operate":   role == "operate",
		"import_status": "not_imported",
		"environment":   costEnvironmentDisplay(account.Environments),
		"project":       map[string]any{"id": account.ProjectID, "name": account.ProjectName, "code": account.ProjectCode},
		"cloud":         costCloudLabel(account.Provider),
		"connection":    placeholder,
		"spend":         costMoneyView("none", "", "USD", normalizeCostBasis(basis)),
		"service_mix":   []costGraphBar{},
		"daily":         []costGraphBar{},
		"importable":    costImportableSources(placeholder, false),
		"suggestions":   []map[string]any{},
		"budgets":       []costBudgetStatus{},
		"stale_hint":    nil,
		"ai":            costAIPolicy(),
		"note":          "Cost billing for this cloud is not imported yet. Spend stays Unknown, never $0.",
	}, nil
}

func costConnectionForAccount(userID int, accountID string) *costConnection {
	items, err := listCostConnections(userID)
	if err != nil {
		return nil
	}
	for i := range items {
		if strings.EqualFold(items[i].AccountID, strings.TrimSpace(accountID)) {
			return &items[i]
		}
	}
	return nil
}

func getCostConnectionByCloudAccount(userID, cloudAccountID int) (*costConnection, error) {
	items, err := listCostConnections(userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].CloudAccountID == cloudAccountID {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("cost connection not found")
}
