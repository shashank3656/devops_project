package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type costConnection struct {
	ID                 int        `json:"id"`
	CloudAccountID     int        `json:"cloud_account_id"`
	AccountID          string     `json:"account_id"`
	DisplayName        string     `json:"display_name"`
	Provider           string     `json:"provider"`
	TeamSlug           string     `json:"team_slug"`
	ProjectID          int        `json:"project_id,omitempty"`
	ProjectName        string     `json:"project_name,omitempty"`
	ProjectCode        string     `json:"project_code,omitempty"`
	Environments       []string   `json:"environments,omitempty"`
	BillingSource      string     `json:"billing_source"`
	Status             string     `json:"status"`
	BillingReadiness   string     `json:"billing_readiness"`
	InventoryReadiness string     `json:"inventory_readiness"`
	MetricsReadiness   string     `json:"metrics_readiness"`
	LatestRevision     string     `json:"latest_revision,omitempty"`
	WindowStart        string     `json:"window_start,omitempty"`
	WindowEnd          string     `json:"window_end,omitempty"`
	WindowComplete     *bool      `json:"window_complete,omitempty"`
	LastIngestedAt     *time.Time `json:"last_ingested_at,omitempty"`
	Freshness          string     `json:"freshness"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type costLineRow struct {
	Service          string `json:"service"`
	Region           string `json:"region"`
	AccountID        string `json:"account_id"`
	ResourceID       string `json:"resource_id"`
	TeamSlug         string `json:"team_slug"`
	ProjectCode      string `json:"project_code"`
	UsageDate        string `json:"usage_date"`
	Actual           string `json:"actual_amount"`
	Amortized        string `json:"amortized_amount"`
	Currency         string `json:"currency"`
	Amount           string `json:"amount"`
	AllocatedService string `json:"allocated_service,omitempty"`
}

type costWindowSlice struct {
	Basis       string
	Currency    string
	WindowStart string
	WindowEnd   string
	Coverage    string
	Freshness   string
	Connections []costConnection
	Lines       []costLineRow
	Total       string
	Unallocated string
	HasLines    bool
	HasRevision bool
}

type costEligibleAccount struct {
	ID          int    `json:"id"`
	AccountID   string `json:"account_id"`
	DisplayName string `json:"display_name"`
	Provider    string `json:"provider"`
	TeamSlug    string `json:"team_slug"`
	ProjectID   int    `json:"project_id,omitempty"`
	ProjectName string `json:"project_name,omitempty"`
	ProjectCode string `json:"project_code,omitempty"`
	Status      string `json:"status"`
}

func costReadiness(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "ready":
		return "ready"
	default:
		return "unknown"
	}
}

func listCostConnections(userID int) ([]costConnection, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	slugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		return nil, err
	}
	if len(slugs) == 0 {
		return []costConnection{}, nil
	}
	placeholders := make([]string, len(slugs))
	args := make([]interface{}, len(slugs))
	for i, slug := range slugs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = slug
	}
	rows, err := DB.Query(`
		SELECT cc.id, cc.cloud_account_id, ca.account_id, ca.display_name, cc.provider, ca.team_slug,
		       cc.project_id, COALESCE(p.name, ''), COALESCE(p.code, ''), COALESCE(ca.environments_json, '[]'), cc.billing_source, cc.status,
		       cc.billing_readiness, cc.inventory_readiness, cc.metrics_readiness,
		       cc.created_at, cc.updated_at, cc.last_ingested_at,
		       COALESCE(rev.revision, ''), COALESCE(to_char(batch.window_start, 'YYYY-MM-DD'), ''),
		       COALESCE(to_char(batch.window_end, 'YYYY-MM-DD'), ''), batch.complete
		  FROM cost_connections cc
		  JOIN cloud_accounts ca ON ca.id = cc.cloud_account_id
		  LEFT JOIN projects p ON p.id = NULLIF(cc.project_id, 0)
		  LEFT JOIN LATERAL (
		    SELECT b.window_start, b.window_end, b.complete, b.id
		      FROM cost_ingestion_batches b
		     WHERE b.connection_id = cc.id
		     ORDER BY b.created_at DESC, b.id DESC
		     LIMIT 1
		  ) batch ON true
		  LEFT JOIN LATERAL (
		    SELECT r.revision
		      FROM cost_source_revisions r
		     WHERE r.batch_id = batch.id
		     ORDER BY r.imported_at DESC, r.id DESC
		     LIMIT 1
		  ) rev ON true
		 WHERE ca.team_slug IN (`+strings.Join(placeholders, ",")+`)
		 ORDER BY ca.display_name, ca.account_id
	`, args...)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_connections") {
			return []costConnection{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costConnection{}
	for rows.Next() {
		item, scanErr := scanCostConnection(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return filterCostConnectionsByProject(out, projectIDSet(visibleProjectIDsForUser(userID))), nil
}

func scanCostConnection(rows *sql.Rows) (*costConnection, error) {
	var item costConnection
	var complete sql.NullBool
	var lastIngested sql.NullTime
	var envJSON string
	err := rows.Scan(
		&item.ID, &item.CloudAccountID, &item.AccountID, &item.DisplayName, &item.Provider, &item.TeamSlug,
		&item.ProjectID, &item.ProjectName, &item.ProjectCode, &envJSON, &item.BillingSource, &item.Status,
		&item.BillingReadiness, &item.InventoryReadiness, &item.MetricsReadiness,
		&item.CreatedAt, &item.UpdatedAt, &lastIngested, &item.LatestRevision, &item.WindowStart, &item.WindowEnd, &complete,
	)
	if err != nil {
		return nil, err
	}
	item.Environments = parseEnvironmentsJSON(envJSON)
	item.BillingReadiness = costReadiness(item.BillingReadiness)
	item.InventoryReadiness = costReadiness(item.InventoryReadiness)
	item.MetricsReadiness = costReadiness(item.MetricsReadiness)
	if lastIngested.Valid {
		t := lastIngested.Time.UTC()
		item.LastIngestedAt = &t
	}
	if complete.Valid {
		v := complete.Bool
		item.WindowComplete = &v
	}
	windowEnd, _ := costParseDate(item.WindowStart)
	if parsed, parseErr := costParseDate(item.WindowEnd); parseErr == nil {
		windowEnd = parsed
	}
	item.Freshness = costFreshness(item.LastIngestedAt, windowEnd, complete.Valid && complete.Bool, time.Now().UTC())
	return &item, nil
}

func getCostConnection(userID, id int) (*costConnection, error) {
	items, err := listCostConnections(userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("cost connection not found")
}

func inventoryReadinessForAccount(provider, accountID string) string {
	if DB == nil || strings.TrimSpace(accountID) == "" {
		return "unknown"
	}
	var count int
	err := DB.QueryRow(`
		SELECT COUNT(*) FROM cloud_resources
		 WHERE LOWER(cloud) = LOWER($1) AND account_id = $2
	`, provider, accountID).Scan(&count)
	if err != nil || count == 0 {
		return "unknown"
	}
	return "ready"
}

func enableCostConnection(userID, cloudAccountID int) (*costConnection, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	account, err := getCloudAccountByID(cloudAccountID)
	if err != nil || account == nil {
		return nil, fmt.Errorf("cloud account not found")
	}
	if !devopsUserCanAccessTeamSlug(userID, account.TeamSlug) {
		return nil, fmt.Errorf("cloud account is not in your workspace")
	}
	if account.ProjectID <= 0 {
		return nil, fmt.Errorf("Cost is granted at project level. Assign this cloud account to a project first")
	}
	if !userCanSeeCostProject(userID, account.ProjectID) {
		return nil, fmt.Errorf("this cloud account is outside your Cost projects")
	}
	if !userCanOperateCost(userID, account.ProjectID) {
		return nil, errCostOperateRequired
	}
	if costDemoAccountID(account.AccountID) {
		return nil, fmt.Errorf("demo cloud accounts cannot be used for Cost")
	}
	if normalizeCloudProvider(account.Provider) != "aws" {
		return nil, fmt.Errorf("Cost C1 only enables AWS CUR 2.0 on an existing account")
	}
	if strings.EqualFold(account.Status, "disabled") {
		return nil, fmt.Errorf("disabled cloud accounts cannot enable Cost")
	}
	inventory := inventoryReadinessForAccount(account.Provider, account.AccountID)
	var id int
	err = DB.QueryRow(`
		INSERT INTO cost_connections (
			cloud_account_id, project_id, provider, billing_source, status,
			billing_readiness, inventory_readiness, metrics_readiness, created_by
		) VALUES ($1,$2,'aws','aws_cur_2','pending','unknown',$3,'unknown',$4)
		ON CONFLICT (cloud_account_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, account.ID, account.ProjectID, inventory, userID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return getCostConnection(userID, id)
}

func listEligibleCostAccounts(userID int) ([]costEligibleAccount, error) {
	slugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		return nil, err
	}
	accounts, err := listCloudAccountsForTeams(slugs)
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_accounts") {
			return []costEligibleAccount{}, nil
		}
		return nil, err
	}
	connected := map[int]bool{}
	existing, err := listCostConnections(userID)
	if err != nil {
		return nil, err
	}
	for _, item := range existing {
		connected[item.CloudAccountID] = true
	}
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	out := []costEligibleAccount{}
	for _, account := range accounts {
		if connected[account.ID] || costDemoAccountID(account.AccountID) {
			continue
		}
		if account.ProjectID <= 0 {
			continue
		}
		if _, ok := visible[account.ProjectID]; !ok {
			continue
		}
		if !userCanOperateCost(userID, account.ProjectID) {
			continue
		}
		if normalizeCloudProvider(account.Provider) != "aws" {
			continue
		}
		if strings.EqualFold(account.Status, "disabled") {
			continue
		}
		out = append(out, costEligibleAccount{
			ID:          account.ID,
			AccountID:   account.AccountID,
			DisplayName: account.DisplayName,
			Provider:    account.Provider,
			TeamSlug:    account.TeamSlug,
			ProjectID:   account.ProjectID,
			ProjectName: account.ProjectName,
			ProjectCode: account.ProjectCode,
			Status:      account.Status,
		})
	}
	return out, nil
}

func latestCostRevision(connectionID int) (revisionID int, windowStart, windowEnd time.Time, complete bool, err error) {
	return latestCostRevisionForWindow(connectionID, time.Time{}, time.Time{})
}

func latestCostRevisionForWindow(connectionID int, from, to time.Time) (revisionID int, windowStart, windowEnd time.Time, complete bool, err error) {
	query := `
		SELECT r.id, b.window_start, b.window_end, b.complete
		  FROM cost_source_revisions r
		  JOIN cost_ingestion_batches b ON b.id = r.batch_id
		 WHERE b.connection_id = $1
	`
	args := []interface{}{connectionID}
	if !from.IsZero() && !to.IsZero() {
		query += ` AND b.window_start = $2 AND b.window_end = $3`
		args = append(args, from, to)
	}
	query += ` ORDER BY r.imported_at DESC, r.id DESC LIMIT 1`
	err = DB.QueryRow(query, args...).Scan(&revisionID, &windowStart, &windowEnd, &complete)
	if err == sql.ErrNoRows {
		return 0, time.Time{}, time.Time{}, false, nil
	}
	return revisionID, windowStart, windowEnd, complete, err
}

func rollupCostLines(lines []costLineRow, basis string) (total, unallocated, currency string, hasLines bool) {
	basis = normalizeCostBasis(basis)
	currency = "USD"
	total = "0." + strings.Repeat("0", costMoneyScale)
	unallocated = total
	for _, line := range lines {
		hasLines = true
		if line.Currency != "" {
			currency = normalizeCostCurrency(line.Currency)
		}
		amount := line.Actual
		if basis == "amortized" {
			amount = line.Amortized
		}
		total = addCostAmounts(total, amount)
		if strings.TrimSpace(line.TeamSlug) == "" {
			unallocated = addCostAmounts(unallocated, amount)
		}
	}
	return total, unallocated, currency, hasLines
}

func loadCostLines(connectionIDs []int, revisionByConnection map[int]int, basis string, filter costLineQuery) ([]costLineRow, error) {
	if len(connectionIDs) == 0 {
		return []costLineRow{}, nil
	}
	basis = normalizeCostBasis(basis)
	args := []interface{}{}
	filters := []string{}
	for _, id := range connectionIDs {
		rev := revisionByConnection[id]
		if rev <= 0 {
			continue
		}
		args = append(args, id, rev)
		filters = append(filters, fmt.Sprintf("(connection_id = $%d AND revision_id = $%d)", len(args)-1, len(args)))
	}
	if len(filters) == 0 {
		return []costLineRow{}, nil
	}
	sqlQuery := `
		SELECT service, region, account_id, resource_id, team_slug, project_code,
		       to_char(usage_date, 'YYYY-MM-DD'), actual_amount::text, amortized_amount::text, currency
		  FROM cost_lines
		 WHERE (` + strings.Join(filters, " OR ") + `)
	`
	if service := strings.TrimSpace(filter.Service); service != "" {
		args = append(args, service)
		sqlQuery += fmt.Sprintf(" AND service = $%d", len(args))
	}
	if region := strings.TrimSpace(filter.Region); region != "" {
		args = append(args, region)
		sqlQuery += fmt.Sprintf(" AND region = $%d", len(args))
	}
	if account := strings.TrimSpace(filter.Account); account != "" {
		args = append(args, account)
		sqlQuery += fmt.Sprintf(" AND account_id = $%d", len(args))
	}
	sqlQuery += " ORDER BY service, region, resource_id"
	rows, err := DB.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []costLineRow{}
	for rows.Next() {
		var line costLineRow
		if err := rows.Scan(&line.Service, &line.Region, &line.AccountID, &line.ResourceID, &line.TeamSlug, &line.ProjectCode, &line.UsageDate, &line.Actual, &line.Amortized, &line.Currency); err != nil {
			return nil, err
		}
		if basis == "amortized" {
			line.Amount = line.Amortized
		} else {
			line.Amount = line.Actual
		}
		out = append(out, line)
	}
	return out, nil
}

func requestEstimateCard() map[string]any {
	digest, err := buildFleetCostDigest(time.Now())
	card := map[string]any{
		"label":       "Request estimates",
		"note":        "Infracost and calculator estimates from tickets. This is not the operating bill.",
		"coverage":    "separate",
		"display":     "Unknown",
		"summary":     "No request estimates yet.",
		"idle_usd":    nil,
		"alert_count": 0,
	}
	if err != nil || digest == nil {
		return card
	}
	card["summary"] = digest.Summary
	card["alert_count"] = len(digest.BudgetAlerts)
	card["idle_count"] = len(digest.IdleResources)
	if digest.TotalIdleUSD > 0 || len(digest.IdleResources) > 0 {
		card["display"] = formatCostDisplay(fmt.Sprintf("%.6f", digest.TotalIdleUSD), "USD")
		card["idle_usd"] = digest.TotalIdleUSD
	} else if digest.Summary != "" {
		card["display"] = digest.Summary
	}
	return card
}

func selectCostRevisions(connections []costConnection, from, to time.Time) (ids []int, revisions map[int]int, windowStart, windowEnd string, complete, hasRevision bool, err error) {
	revisions = map[int]int{}
	complete = true
	ids = make([]int, 0, len(connections))
	for _, conn := range connections {
		ids = append(ids, conn.ID)
		rev, start, end, ok, revErr := latestCostRevisionForWindow(conn.ID, from, to)
		if revErr != nil {
			return nil, nil, "", "", false, false, revErr
		}
		if rev == 0 {
			if !from.IsZero() {
				continue
			}
			complete = false
			continue
		}
		hasRevision = true
		revisions[conn.ID] = rev
		if !ok {
			complete = false
		}
		if windowStart == "" {
			windowStart = start.Format("2006-01-02")
			windowEnd = end.Format("2006-01-02")
		}
	}
	if hasRevision && len(revisions) == 0 {
		complete = false
	}
	if !hasRevision {
		complete = false
	}
	return ids, revisions, windowStart, windowEnd, complete, hasRevision, nil
}

func loadCostWindowSlice(userID int, basis, currency, fromRaw, toRaw string, filter costLineQuery) (*costWindowSlice, error) {
	basis = normalizeCostBasis(basis)
	currency = normalizeCostCurrency(currency)
	from, to := parseCostWindowQuery(fromRaw, toRaw)
	connections, err := listCostConnections(userID)
	if err != nil {
		return nil, err
	}
	ids, revisions, windowStart, windowEnd, complete, hasRevision, err := selectCostRevisions(connections, from, to)
	if err != nil {
		return nil, err
	}
	lines, err := loadCostLines(ids, revisions, basis, filter)
	if err != nil {
		return nil, err
	}
	rules, err := listCostAllocationRules()
	if err != nil {
		return nil, err
	}
	allocated := applyCostAllocation(lines, rules, accountTeamDefaults(connections))
	allocated = filterAllocatedCostLines(allocated, filter)
	total, unallocated, lineCurrency, hasLines := rollupCostLines(allocated, basis)
	if lineCurrency != "" {
		currency = normalizeCostCurrency(lineCurrency)
	}
	coverage := costCoverage(hasLines || hasRevision, complete && hasLines)
	freshness := "unknown"
	for _, conn := range connections {
		if conn.Freshness == "stale" {
			freshness = "stale"
			break
		}
		if conn.Freshness == "current" {
			freshness = "current"
		}
	}
	return &costWindowSlice{
		Basis:       basis,
		Currency:    currency,
		WindowStart: windowStart,
		WindowEnd:   windowEnd,
		Coverage:    coverage,
		Freshness:   freshness,
		Connections: connections,
		Lines:       allocated,
		Total:       total,
		Unallocated: unallocated,
		HasLines:    hasLines,
		HasRevision: hasRevision,
	}, nil
}

func evaluateCostBudgetsForSlice(slice *costWindowSlice) ([]costBudgetStatus, error) {
	budgets, err := listCostBudgets()
	if err != nil {
		return nil, err
	}
	out := make([]costBudgetStatus, 0, len(budgets))
	for _, budget := range budgets {
		if budget.Basis == "" {
			budget.Basis = slice.Basis
		}
		out = append(out, evaluateCostBudget(budget, slice.Lines, slice.Coverage))
	}
	return out, nil
}

func buildCostOverview(userID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		return nil, err
	}
	budgets, err := evaluateCostBudgetsForSlice(slice)
	if err != nil {
		return nil, err
	}
	insights, err := buildCostInsights(userID, basis, currency, fromRaw, toRaw, costMetricsContext{})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":                 "ok",
		"basis":                  slice.Basis,
		"currency":               slice.Currency,
		"window_start":           slice.WindowStart,
		"window_end":             slice.WindowEnd,
		"freshness":              slice.Freshness,
		"coverage":               slice.Coverage,
		"operating_bill":         costMoneyView(slice.Coverage, slice.Total, slice.Currency, slice.Basis),
		"unallocated":            costMoneyView(slice.Coverage, slice.Unallocated, slice.Currency, slice.Basis),
		"service_mix":            costServiceSeries(slice.Lines, slice.Coverage, slice.Currency, slice.Basis),
		"daily":                  costDaySeries(slice.Lines, slice.Coverage, slice.Currency, slice.Basis),
		"ownership":              costOwnershipView(slice.Total, slice.Unallocated, slice.Coverage, slice.Currency),
		"forecast":               insights.Forecast,
		"nonoverlapping_savings": insights.NonOverlapping,
		"anomaly_count":          len(insights.Anomalies),
		"recommendation_count":   len(insights.Recommendations),
		"waiting_count":          countCostWaiting(insights.Recommendations),
		"budgets":                budgets,
		"pauses_workloads":       false,
		"request_estimates":      requestEstimateCard(),
		"connections":            slice.Connections,
		"projects":               buildCostTreeNodes(userID, slice),
		"rbac":                   "project",
		"can_operate":            userHasCostOperateAnywhere(userID),
		"ai":                     costAIPolicy(),
		"ai_proof":               costAIProofSummary(listCostAIProofs(userID)),
		"line_count":             len(slice.Lines),
		"kubernetes":             buildCostKubernetesCard(userID),
		"note":                   "Cost is granted at project level. Actual and amortized are never added together. A replayed export does not add a second charge. Incomplete windows stay Unknown, never zero. Budgets never stop workloads. Overlapping savings are not summed. Acceptance is not permission to execute. Kubernetes cost is a breakdown of the cloud bill, never an extra line. Copilot never receives cloud account details, passwords, or role names.",
	}, nil
}

func buildCostExplorer(userID int, basis, currency, fromRaw, toRaw string, filter costLineQuery) (map[string]any, error) {
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, filter)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":           "ok",
		"basis":            slice.Basis,
		"currency":         slice.Currency,
		"window_start":     slice.WindowStart,
		"window_end":       slice.WindowEnd,
		"coverage":         slice.Coverage,
		"total":            costMoneyView(slice.Coverage, slice.Total, slice.Currency, slice.Basis),
		"unallocated":      costMoneyView(slice.Coverage, slice.Unallocated, slice.Currency, slice.Basis),
		"ownership":        costOwnershipView(slice.Total, slice.Unallocated, slice.Coverage, slice.Currency),
		"pauses_workloads": false,
		"lines":            slice.Lines,
		"empty":            len(slice.Lines) == 0,
		"note":             "Explorer uses the same window, basis, and currency as Overview and CSV export. Latest revision for that window is billed once.",
	}, nil
}

func buildCostExplorerCSV(userID int, basis, currency, fromRaw, toRaw string, filter costLineQuery) (string, error) {
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, filter)
	if err != nil {
		return "", err
	}
	return costExplorerCSV(slice.WindowStart, slice.WindowEnd, slice.Basis, slice.Currency, slice.Coverage, slice.Lines), nil
}

func buildCostServiceStrip(userID int, serviceName, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	serviceName = strings.TrimSpace(serviceName)
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{PortalService: serviceName})
	if err != nil {
		return nil, err
	}
	coverage := slice.Coverage
	if serviceName == "" || len(slice.Lines) == 0 {
		coverage = costCoverage(false, false)
	}
	return map[string]any{
		"status":           "ok",
		"service":          serviceName,
		"basis":            slice.Basis,
		"currency":         slice.Currency,
		"window_start":     slice.WindowStart,
		"window_end":       slice.WindowEnd,
		"coverage":         coverage,
		"operating_cost":   costMoneyView(coverage, slice.Total, slice.Currency, slice.Basis),
		"pauses_workloads": false,
		"empty":            len(slice.Lines) == 0,
		"note":             "Operating cost for this service from allocated billed lines. No match stays Unknown, never $0. This strip does not stop workloads.",
	}, nil
}

func buildCostBudgets(userID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	slice, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		return nil, err
	}
	budgets, err := evaluateCostBudgetsForSlice(slice)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":           "ok",
		"basis":            slice.Basis,
		"currency":         slice.Currency,
		"window_start":     slice.WindowStart,
		"window_end":       slice.WindowEnd,
		"coverage":         slice.Coverage,
		"budgets":          budgets,
		"pauses_workloads": false,
		"can_operate":      userHasCostOperateAnywhere(userID),
		"note":             "Budgets warn in the portal. They never pause, drain, or resize workloads.",
	}, nil
}

func parseCostWindowQuery(fromRaw, toRaw string) (time.Time, time.Time) {
	from, fromErr := costParseDate(fromRaw)
	to, toErr := costParseDate(toRaw)
	if fromErr != nil || toErr != nil {
		return time.Time{}, time.Time{}
	}
	return from, to
}
