package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

type costMetricsContext struct {
	Ready       bool
	Utilization map[string]string
}

type costAnomaly struct {
	CalcID      string         `json:"calc_id"`
	Kind        string         `json:"kind"`
	ResourceID  string         `json:"resource_id,omitempty"`
	Service     string         `json:"service,omitempty"`
	AccountID   string         `json:"account_id,omitempty"`
	Current     map[string]any `json:"current"`
	Baseline    map[string]any `json:"baseline"`
	Delta       map[string]any `json:"delta"`
	LikeForLike bool           `json:"like_for_like"`
	Coverage    string         `json:"coverage"`
	Note        string         `json:"note"`
}

type costRecommendation struct {
	CalcID              string         `json:"calc_id"`
	GroupID             string         `json:"group_id"`
	ResourceID          string         `json:"resource_id"`
	Service             string         `json:"service"`
	AccountID           string         `json:"account_id"`
	FindingType         string         `json:"finding_type"`
	Status              string         `json:"status"`
	Impact              string         `json:"impact"`
	Risk                string         `json:"risk"`
	Effort              string         `json:"effort"`
	Confidence          string         `json:"confidence"`
	SavingsLow          map[string]any `json:"savings_low"`
	SavingsHigh         map[string]any `json:"savings_high"`
	MetricsReady        bool           `json:"metrics_ready"`
	HasUtilization      bool           `json:"has_utilization"`
	BlockedReason       string         `json:"blocked_reason,omitempty"`
	Evidence            string         `json:"evidence"`
	Calculation         string         `json:"calculation"`
	ProposedAction      string         `json:"proposed_action"`
	Verification        string         `json:"verification"`
	Executes            bool           `json:"executes"`
	PausesWorkloads     bool           `json:"pauses_workloads"`
	Lifecycle           string         `json:"lifecycle"`
	ChangeID            int            `json:"change_id,omitempty"`
	ChangeNumber        string         `json:"change_number,omitempty"`
	ChangeHref          string         `json:"change_href,omitempty"`
	DismissReason       string         `json:"dismiss_reason,omitempty"`
	ReviewBy            string         `json:"review_by,omitempty"`
	AllocationReduction map[string]any `json:"allocation_reduction,omitempty"`
	BillReduction       map[string]any `json:"bill_reduction,omitempty"`
	CostAvoidance       map[string]any `json:"cost_avoidance,omitempty"`
	Confounders         string         `json:"confounders,omitempty"`
	WaitingFor          string         `json:"waiting_for,omitempty"`
	Note                string         `json:"note,omitempty"`
}

type costOpportunityGroup struct {
	GroupID    string         `json:"group_id"`
	ResourceID string         `json:"resource_id"`
	CalcIDs    []string       `json:"calc_ids"`
	Savings    map[string]any `json:"savings"`
	Note       string         `json:"note"`
}

type costCalculation struct {
	CalcID     string `json:"calc_id"`
	Kind       string `json:"kind"`
	ResourceID string `json:"resource_id,omitempty"`
	Coverage   string `json:"coverage"`
	Amount     string `json:"amount,omitempty"`
	Note       string `json:"note"`
}

type costInsights struct {
	Anomalies        []costAnomaly          `json:"anomalies"`
	Recommendations  []costRecommendation   `json:"recommendations"`
	Groups           []costOpportunityGroup `json:"opportunity_groups"`
	Forecast         map[string]any         `json:"forecast"`
	NonOverlapping   map[string]any         `json:"nonoverlapping_savings"`
	Calculations     []costCalculation      `json:"calculations"`
	MetricsReady     bool                   `json:"metrics_ready"`
	NotifyCost       bool                   `json:"notify_cost"`
	PausesWorkloads  bool                   `json:"pauses_workloads"`
	PriorWindowStart string                 `json:"prior_window_start,omitempty"`
	PriorWindowEnd   string                 `json:"prior_window_end,omitempty"`
	PriorCoverage    string                 `json:"prior_coverage,omitempty"`
	WindowStart      string                 `json:"window_start,omitempty"`
	WindowEnd        string                 `json:"window_end,omitempty"`
	Coverage         string                 `json:"coverage,omitempty"`
	Basis            string                 `json:"basis,omitempty"`
	Currency         string                 `json:"currency,omitempty"`
}

func costAlertStatus(enabled bool, coverage, priorCoverage string) map[string]any {
	monitoringReady := coverage == "complete" && priorCoverage == "complete"
	blocked := ""
	switch {
	case !enabled:
		blocked = "Cost alerts are off."
	case coverage != "complete":
		blocked = "No complete billed window. Evaluation is blocked."
	case priorCoverage != "complete":
		blocked = "Not enough comparable data. Evaluation is blocked."
	default:
		blocked = ""
	}
	deliveryNote := "No cost notification has been delivered yet."
	return map[string]any{
		"alerts_enabled":     enabled,
		"monitoring_ready":   monitoringReady,
		"delivery_verified":  false,
		"evaluation_blocked": blocked != "",
		"blocked_reason":     firstNonEmpty(blocked, deliveryNote),
		"note":               "Alerts enabled is not monitoring ready. Delivery verified stays No until a Cost alert is sent. Emails are never listed.",
	}
}

func costCalcID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return "CALC-COST-" + strings.ToUpper(hex.EncodeToString(sum[:4]))
}

func costGroupID(resourceID string) string {
	return "GRP-" + strings.TrimPrefix(costCalcID("group", strings.TrimSpace(resourceID)), "CALC-COST-")
}

func costFindingFamily(service string) string {
	value := strings.ToLower(service)
	switch {
	case strings.Contains(value, "elastic compute"), strings.Contains(value, "ec2"):
		return "compute"
	case strings.Contains(value, "relational database"), strings.Contains(value, "rds"):
		return "database"
	case strings.Contains(value, "simple storage"), strings.Contains(value, "s3"), strings.Contains(value, "logging"):
		return "storage"
	default:
		return "other"
	}
}

func costMetricsReady(connections []costConnection) bool {
	if len(connections) == 0 {
		return false
	}
	for _, conn := range connections {
		if costReadiness(conn.MetricsReadiness) != "ready" {
			return false
		}
	}
	return true
}

func priorLikeForLikeWindow(start, end time.Time) (time.Time, time.Time) {
	if start.IsZero() || end.IsZero() {
		return time.Time{}, time.Time{}
	}
	nextDay := end.AddDate(0, 0, 1)
	if start.Day() == 1 && nextDay.Day() == 1 {
		prior := start.AddDate(0, -1, 0)
		priorStart := time.Date(prior.Year(), prior.Month(), 1, 0, 0, 0, 0, time.UTC)
		priorEnd := start.AddDate(0, 0, -1)
		return priorStart, priorEnd
	}
	length := end.Sub(start)
	priorEnd := start.AddDate(0, 0, -1)
	priorStart := priorEnd.Add(-length)
	return priorStart, priorEnd
}

func detectCostAnomalies(current, prior *costWindowSlice) []costAnomaly {
	if current == nil || prior == nil || current.Coverage != "complete" || prior.Coverage != "complete" {
		return []costAnomaly{}
	}
	priorByResource := map[string]costLineRow{}
	for _, line := range prior.Lines {
		priorByResource[strings.ToLower(strings.TrimSpace(line.ResourceID))] = line
	}
	out := []costAnomaly{}
	for _, line := range current.Lines {
		key := strings.ToLower(strings.TrimSpace(line.ResourceID))
		baseline, ok := priorByResource[key]
		calcID := costCalcID("anomaly", line.ResourceID, current.WindowStart, current.WindowEnd, current.Basis)
		if !ok {
			out = append(out, costAnomaly{
				CalcID:      calcID,
				Kind:        "no_baseline",
				ResourceID:  line.ResourceID,
				Service:     line.Service,
				AccountID:   line.AccountID,
				Current:     costMoneyView("complete", line.Amount, current.Currency, current.Basis),
				Baseline:    costMoneyView("incomplete", "", current.Currency, current.Basis),
				Delta:       costMoneyView("incomplete", "", current.Currency, current.Basis),
				LikeForLike: false,
				Coverage:    "incomplete",
				Note:        "No like-for-like baseline for this resource. Missing history stays Unknown, not $0.",
			})
			continue
		}
		delta := subCostAmounts(line.Amount, baseline.Amount)
		if strings.HasPrefix(delta, "-") {
			continue
		}
		threshold := costPercentOf(baseline.Amount, 120)
		if strings.HasPrefix(subCostAmounts(line.Amount, threshold), "-") {
			continue
		}
		out = append(out, costAnomaly{
			CalcID:      calcID,
			Kind:        "spend_increase",
			ResourceID:  line.ResourceID,
			Service:     line.Service,
			AccountID:   line.AccountID,
			Current:     costMoneyView("complete", line.Amount, current.Currency, current.Basis),
			Baseline:    costMoneyView("complete", baseline.Amount, prior.Currency, prior.Basis),
			Delta:       costMoneyView("complete", delta, current.Currency, current.Basis),
			LikeForLike: true,
			Coverage:    "complete",
			Note:        "Spend increased versus the prior complete window. Usage versus price stays Unknown without quantity.",
		})
	}
	return out
}

func buildCostRecommendations(slice *costWindowSlice, metrics costMetricsContext) []costRecommendation {
	if slice == nil {
		return []costRecommendation{}
	}
	out := []costRecommendation{}
	for _, line := range slice.Lines {
		if strings.TrimSpace(line.ResourceID) == "" {
			continue
		}
		family := costFindingFamily(line.Service)
		groupID := costGroupID(line.ResourceID)
		util := ""
		if metrics.Utilization != nil {
			util = strings.TrimSpace(metrics.Utilization[line.ResourceID])
		}
		hasUtil := util != ""
		if family == "compute" || family == "database" {
			out = append(out, costRightsizingRec(slice, line, groupID, family, metrics.Ready, hasUtil, util))
			out = append(out, costUnusedRec(slice, line, groupID, metrics.Ready, hasUtil, util))
		}
		if family == "storage" {
			out = append(out, costStorageRec(slice, line, groupID))
		}
	}
	return out
}

func costRightsizingRec(slice *costWindowSlice, line costLineRow, groupID, family string, metricsReady, hasUtil bool, util string) costRecommendation {
	calcID := costCalcID("rec", "rightsizing", line.ResourceID, slice.WindowStart, slice.WindowEnd, slice.Basis)
	rec := costRecommendation{
		CalcID:          calcID,
		GroupID:         groupID,
		ResourceID:      line.ResourceID,
		Service:         line.Service,
		AccountID:       line.AccountID,
		FindingType:     "oversized_" + family,
		Status:          "detected",
		Impact:          "medium",
		Risk:            "medium",
		Effort:          "medium",
		Confidence:      "low",
		MetricsReady:    metricsReady,
		HasUtilization:  hasUtil,
		Evidence:        "Billed " + family + " resource " + costCSVSafe(line.ResourceID) + " in " + slice.WindowStart + " to " + slice.WindowEnd + ".",
		Calculation:     calcID + " uses billed " + slice.Basis + " spend. Candidate SKU is not priced.",
		ProposedAction:  "Review this " + family + " size with the owner. This product will not resize it.",
		Verification:    "Not measured. Change-linked verification is a later slice.",
		Executes:        false,
		PausesWorkloads: false,
	}
	if !metricsReady || !hasUtil {
		rec.Status = "blocked"
		rec.Confidence = "unsupported"
		rec.BlockedReason = "Missing metrics block rightsizing claims."
		rec.SavingsLow = costMoneyView("incomplete", "", slice.Currency, slice.Basis)
		rec.SavingsHigh = costMoneyView("incomplete", "", slice.Currency, slice.Basis)
		rec.Evidence += " Utilization is Unknown."
		return rec
	}
	rec.Evidence += " Utilization sample " + costCSVSafe(util) + "%."
	rec.SavingsLow = costMoneyView("incomplete", "", slice.Currency, slice.Basis)
	if slice.Coverage == "complete" {
		rec.SavingsHigh = costMoneyView("complete", line.Amount, slice.Currency, slice.Basis)
		rec.Calculation = calcID + " high bound is this resource's billed " + slice.Basis + " amount. Low bound stays Unknown until a candidate SKU is priced."
	} else {
		rec.SavingsHigh = costMoneyView("incomplete", "", slice.Currency, slice.Basis)
	}
	return rec
}

func costUnusedRec(slice *costWindowSlice, line costLineRow, groupID string, metricsReady, hasUtil bool, util string) costRecommendation {
	calcID := costCalcID("rec", "unused", line.ResourceID, slice.WindowStart, slice.WindowEnd, slice.Basis)
	rec := costRecommendation{
		CalcID:          calcID,
		GroupID:         groupID,
		ResourceID:      line.ResourceID,
		Service:         line.Service,
		AccountID:       line.AccountID,
		FindingType:     "unused_resource",
		Status:          "detected",
		Impact:          "medium",
		Risk:            "high",
		Effort:          "low",
		Confidence:      "low",
		MetricsReady:    metricsReady,
		HasUtilization:  hasUtil,
		Evidence:        "Billed resource " + costCSVSafe(line.ResourceID) + ".",
		Calculation:     calcID,
		ProposedAction:  "Review whether this resource is unused. Lack of activity is not deletion authorization.",
		Verification:    "Not measured.",
		Executes:        false,
		PausesWorkloads: false,
		SavingsLow:      costMoneyView("incomplete", "", slice.Currency, slice.Basis),
		SavingsHigh:     costMoneyView("incomplete", "", slice.Currency, slice.Basis),
	}
	if !metricsReady || !hasUtil {
		rec.Status = "blocked"
		rec.Confidence = "unsupported"
		rec.BlockedReason = "Missing metrics block unused-resource claims."
		rec.Evidence += " Utilization is Unknown."
		return rec
	}
	rec.Evidence += " Utilization sample " + costCSVSafe(util) + "%."
	if slice.Coverage == "complete" {
		rec.SavingsHigh = costMoneyView("complete", line.Amount, slice.Currency, slice.Basis)
		rec.Calculation = calcID + " high bound is billed " + slice.Basis + " spend. This is not permission to delete."
	}
	return rec
}

func costStorageRec(slice *costWindowSlice, line costLineRow, groupID string) costRecommendation {
	calcID := costCalcID("rec", "storage", line.ResourceID, slice.WindowStart, slice.WindowEnd, slice.Basis)
	return costRecommendation{
		CalcID:          calcID,
		GroupID:         groupID,
		ResourceID:      line.ResourceID,
		Service:         line.Service,
		AccountID:       line.AccountID,
		FindingType:     "storage_policy",
		Status:          "detected",
		Impact:          "low",
		Risk:            "low",
		Effort:          "low",
		Confidence:      "low",
		SavingsLow:      costMoneyView("incomplete", "", slice.Currency, slice.Basis),
		SavingsHigh:     costMoneyView("incomplete", "", slice.Currency, slice.Basis),
		Evidence:        "Billed storage or logging resource " + costCSVSafe(line.ResourceID) + ". This is an investigation, not a priced saving.",
		Calculation:     calcID + " does not claim a dollar saving without a policy measurement.",
		ProposedAction:  "Review retention and logging policy with the owner. This product will not change the bucket.",
		Verification:    "Not measured.",
		Executes:        false,
		PausesWorkloads: false,
	}
}

func groupCostOpportunities(recs []costRecommendation, currency, basis string) []costOpportunityGroup {
	index := map[string]int{}
	out := []costOpportunityGroup{}
	for _, rec := range recs {
		pos, ok := index[rec.GroupID]
		if !ok {
			out = append(out, costOpportunityGroup{
				GroupID:    rec.GroupID,
				ResourceID: rec.ResourceID,
				CalcIDs:    []string{},
				Note:       "Mutually exclusive actions on the same resource share one opportunity group. Overlapping savings are not summed.",
			})
			pos = len(out) - 1
			index[rec.GroupID] = pos
		}
		out[pos].CalcIDs = append(out[pos].CalcIDs, rec.CalcID)
		out[pos].Savings = capGroupSavings(out[pos].Savings, rec.SavingsHigh, currency, basis)
	}
	for i := range out {
		if out[i].Savings == nil {
			out[i].Savings = costMoneyView("incomplete", "", currency, basis)
		}
	}
	return out
}

func capGroupSavings(current, candidate map[string]any, currency, basis string) map[string]any {
	candAmount, candOK := completeCostAmount(candidate)
	if current == nil {
		if candOK {
			return costMoneyView("complete", candAmount, currency, basis)
		}
		return costMoneyView("incomplete", "", currency, basis)
	}
	curAmount, curOK := completeCostAmount(current)
	if candOK && curOK {
		if !strings.HasPrefix(subCostAmounts(candAmount, curAmount), "-") {
			return costMoneyView("complete", candAmount, currency, basis)
		}
		return costMoneyView("complete", curAmount, currency, basis)
	}
	if candOK {
		return costMoneyView("complete", candAmount, currency, basis)
	}
	if curOK {
		return costMoneyView("complete", curAmount, currency, basis)
	}
	return costMoneyView("incomplete", "", currency, basis)
}

func completeCostAmount(view map[string]any) (string, bool) {
	if view == nil {
		return "", false
	}
	coverage, _ := view["coverage"].(string)
	if coverage != "complete" {
		return "", false
	}
	amount, _ := view["amount"].(string)
	if strings.TrimSpace(amount) == "" {
		return "", false
	}
	return amount, true
}

func sumNonOverlappingSavings(groups []costOpportunityGroup, currency, basis string) map[string]any {
	total := "0." + strings.Repeat("0", costMoneyScale)
	complete := false
	for _, group := range groups {
		amount, ok := completeCostAmount(group.Savings)
		if !ok {
			continue
		}
		complete = true
		total = addCostAmounts(total, amount)
	}
	if !complete {
		return costMoneyView("incomplete", "", currency, basis)
	}
	return costMoneyView("complete", total, currency, basis)
}

func costForecastView(current, prior *costWindowSlice) map[string]any {
	currency, basis := "USD", "actual"
	if current != nil {
		currency, basis = current.Currency, current.Basis
	}
	view := map[string]any{
		"method":   "abstain",
		"coverage": "incomplete",
		"currency": currency,
		"basis":    basis,
		"display":  "Unknown",
		"low":      nil,
		"high":     nil,
		"note":     "Forecasts abstain when history is insufficient. Incomplete windows are not treated as $0.",
	}
	if current == nil || prior == nil || current.Coverage != "complete" || prior.Coverage != "complete" {
		return view
	}
	low, high := current.Total, prior.Total
	if strings.HasPrefix(subCostAmounts(low, high), "-") {
		low, high = high, low
	}
	view["method"] = "prior complete window range"
	view["coverage"] = "complete"
	view["low"] = low
	view["high"] = high
	view["display"] = formatCostDisplay(low, currency) + " – " + formatCostDisplay(high, currency)
	view["note"] = "Range is the min and max of this complete window and the prior complete like-for-like window. Not a priced SKU."
	return view
}

func collectCostCalculations(anomalies []costAnomaly, recs []costRecommendation, forecast map[string]any, savings map[string]any) []costCalculation {
	out := []costCalculation{}
	for _, item := range anomalies {
		amount := ""
		if value, ok := completeCostAmount(item.Delta); ok {
			amount = value
		}
		out = append(out, costCalculation{CalcID: item.CalcID, Kind: "anomaly", ResourceID: item.ResourceID, Coverage: item.Coverage, Amount: amount, Note: item.Note})
	}
	for _, item := range recs {
		amount := ""
		if value, ok := completeCostAmount(item.SavingsHigh); ok {
			amount = value
		}
		out = append(out, costCalculation{CalcID: item.CalcID, Kind: "recommendation", ResourceID: item.ResourceID, Coverage: coverageFromMoney(item.SavingsHigh), Amount: amount, Note: item.Calculation})
	}
	if forecast != nil {
		coverage, _ := forecast["coverage"].(string)
		out = append(out, costCalculation{
			CalcID:   costCalcID("forecast", fmt.Sprintf("%v", forecast["method"])),
			Kind:     "forecast",
			Coverage: coverage,
			Note:     fmt.Sprintf("%v", forecast["note"]),
		})
	}
	if savings != nil {
		coverage, _ := savings["coverage"].(string)
		amount, _ := completeCostAmount(savings)
		out = append(out, costCalculation{
			CalcID:   costCalcID("savings", "nonoverlapping"),
			Kind:     "nonoverlapping_savings",
			Coverage: coverage,
			Amount:   amount,
			Note:     "Sum of opportunity-group caps. Overlapping recs on one resource count once.",
		})
	}
	return out
}

func coverageFromMoney(view map[string]any) string {
	if view == nil {
		return "incomplete"
	}
	coverage, _ := view["coverage"].(string)
	if coverage == "" {
		return "incomplete"
	}
	return coverage
}

func buildCostInsights(userID int, basis, currency, fromRaw, toRaw string, metrics costMetricsContext) (*costInsights, error) {
	current, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		return nil, err
	}
	if !metrics.Ready {
		metrics.Ready = costMetricsReady(current.Connections)
	}
	priorStart, priorEnd := time.Time{}, time.Time{}
	if current.WindowStart != "" && current.WindowEnd != "" {
		start, startErr := costParseDate(current.WindowStart)
		end, endErr := costParseDate(current.WindowEnd)
		if startErr == nil && endErr == nil {
			priorStart, priorEnd = priorLikeForLikeWindow(start, end)
		}
	}
	prior := &costWindowSlice{Coverage: "none", Currency: current.Currency, Basis: current.Basis}
	if !priorStart.IsZero() {
		loaded, priorErr := loadCostWindowSlice(userID, current.Basis, current.Currency, priorStart.Format("2006-01-02"), priorEnd.Format("2006-01-02"), costLineQuery{})
		if priorErr != nil {
			return nil, priorErr
		}
		prior = loaded
	}
	anomalies := detectCostAnomalies(current, prior)
	recs := buildCostRecommendations(current, metrics)
	recs, err = overlayCostReviews(recs)
	if err != nil {
		return nil, err
	}
	groups := groupCostOpportunities(recs, current.Currency, current.Basis)
	forecast := costForecastView(current, prior)
	savings := sumNonOverlappingSavings(groups, current.Currency, current.Basis)
	notifyCost := true
	if settings, settingsErr := loadOpsNotificationSettings(); settingsErr == nil {
		notifyCost = settings.NotifyCost
	}
	return &costInsights{
		Anomalies:        anomalies,
		Recommendations:  recs,
		Groups:           groups,
		Forecast:         forecast,
		NonOverlapping:   savings,
		Calculations:     append(collectCostCalculations(anomalies, recs, forecast, savings), collectCostK8sCapacityCalculations(userID)...),
		MetricsReady:     metrics.Ready,
		NotifyCost:       notifyCost,
		PausesWorkloads:  false,
		PriorWindowStart: prior.WindowStart,
		PriorWindowEnd:   prior.WindowEnd,
		PriorCoverage:    prior.Coverage,
		WindowStart:      current.WindowStart,
		WindowEnd:        current.WindowEnd,
		Coverage:         current.Coverage,
		Basis:            current.Basis,
		Currency:         current.Currency,
	}, nil
}

func findCostCalculation(insights *costInsights, calcID string) *costCalculation {
	if insights == nil {
		return nil
	}
	want := strings.ToUpper(strings.TrimSpace(calcID))
	for i := range insights.Calculations {
		if strings.ToUpper(insights.Calculations[i].CalcID) == want {
			return &insights.Calculations[i]
		}
	}
	return nil
}
