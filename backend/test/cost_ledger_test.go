package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestCostMoneyNeverSumsActualAndAmortized(t *testing.T) {
	lines := []costLineRow{
		{Actual: "410.250000", Amortized: "380.100000", Currency: "USD", TeamSlug: "platform-team"},
		{Actual: "220.000000", Amortized: "198.500000", Currency: "USD", TeamSlug: "platform-team"},
		{Actual: "41.800000", Amortized: "41.800000", Currency: "USD"},
	}
	actual, unallocated, currency, ok := rollupCostLines(lines, "actual")
	if !ok || currency != "USD" || actual != "672.050000" {
		t.Fatalf("actual total = %s %s ok=%t", actual, currency, ok)
	}
	if unallocated != "41.800000" {
		t.Fatalf("unallocated actual = %s", unallocated)
	}
	amortized, _, _, _ := rollupCostLines(lines, "amortized")
	if amortized != "620.400000" {
		t.Fatalf("amortized total = %s", amortized)
	}
	if addCostAmounts(actual, amortized) == actual {
		t.Fatal("actual and amortized must stay distinct")
	}
}

func TestCostIncompletePeriodIsUnknown(t *testing.T) {
	none := costMoneyView(costCoverage(false, false), "0.000000", "USD", "actual")
	if none["display"] != "Unknown" || none["amount"] != nil {
		t.Fatalf("empty coverage = %+v", none)
	}
	incomplete := costMoneyView(costCoverage(true, false), "672.050000", "USD", "actual")
	if incomplete["display"] != "Unknown" || incomplete["coverage"] != "incomplete" || incomplete["amount"] != nil {
		t.Fatalf("incomplete must not show a dollar amount: %+v", incomplete)
	}
	complete := costMoneyView(costCoverage(true, true), "672.050000", "USD", "actual")
	if complete["display"] != "USD 672.05" {
		t.Fatalf("complete display = %v", complete["display"])
	}
}

func TestCostDisplayRoundsOnlyAtPresentation(t *testing.T) {
	stored, err := parseCostAmount("10.239")
	if err != nil || stored != "10.239000" {
		t.Fatalf("stored = %s err=%v", stored, err)
	}
	if formatCostDisplay(stored, "usd") != "USD 10.24" {
		t.Fatalf("display = %s", formatCostDisplay(stored, "usd"))
	}
}

func TestCostDemoAccountIDsRejected(t *testing.T) {
	if !costDemoAccountID("111122223333") || !costDemoAccountID("444455556666") {
		t.Fatal("seeded inventory account IDs must stay out of Cost")
	}
	if costDemoAccountID("123456789012") {
		t.Fatal("a real twelve-digit account must be allowed")
	}
}

func TestCUR2MapsUnblendedAndAmortizedSeparately(t *testing.T) {
	line, err := mapCUR2Line(map[string]any{
		"product_servicename":          "Amazon Elastic Compute Cloud",
		"product_region":               "us-east-1",
		"line_item_resource_id":        "i-0costc2api01",
		"line_item_usage_start_date":   "2026-09-01T00:00:00Z",
		"line_item_unblended_cost":     "100.10",
		"line_item_net_amortized_cost": "88.40",
		"line_item_currency_code":      "USD",
		"line_item_usage_account_id":   "123456789012",
		"resource_tags_user_team":      "platform-team",
	}, "123456789012")
	if err != nil {
		t.Fatal(err)
	}
	if line.Actual != "100.100000" || line.Amortized != "88.400000" {
		t.Fatalf("mapped amounts actual=%s amortized=%s", line.Actual, line.Amortized)
	}
	if addCostAmounts(line.Actual, line.Amortized) == line.Actual {
		t.Fatal("actual and amortized must stay distinct after CUR mapping")
	}
}

func TestCUR2ReplayHashIsStableAndCorrectionChanges(t *testing.T) {
	lines := []costLineRow{{Service: "Amazon Elastic Compute Cloud", Region: "us-east-1", AccountID: "123456789012", ResourceID: "i-1", Actual: "10.000000", Amortized: "9.000000", Currency: "USD", UsageDate: "2026-09-01"}}
	first := costExportFingerprint("123456789012", "2026-09-01", "2026-09-30", true, lines)
	replay := costExportFingerprint("123456789012", "2026-09-01", "2026-09-30", true, lines)
	if first == "" || first != replay {
		t.Fatalf("replay hash changed: %s vs %s", first, replay)
	}
	corrected := []costLineRow{{Service: "Amazon Elastic Compute Cloud", Region: "us-east-1", AccountID: "123456789012", ResourceID: "i-1", Actual: "11.000000", Amortized: "9.000000", Currency: "USD", UsageDate: "2026-09-01"}}
	if costExportFingerprint("123456789012", "2026-09-01", "2026-09-30", true, corrected) == first {
		t.Fatal("a corrected export must get a new revision hash")
	}
}

func TestCostBackfillOlderThan13MonthsRejected(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	start := time.Date(2025, 8, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2025, 8, 31, 0, 0, 0, 0, time.UTC)
	if err := costWindowAllowed(start, end, now); err == nil {
		t.Fatal("14-month-old backfill must be rejected")
	}
	okStart := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	okEnd := time.Date(2025, 10, 31, 0, 0, 0, 0, time.UTC)
	if err := costWindowAllowed(okStart, okEnd, now); err != nil {
		t.Fatalf("13-month window should be allowed: %v", err)
	}
}

func TestCostImportRejectsSecretsAndEmails(t *testing.T) {
	if !costPayloadHasSecret(map[string]any{"aws_secret_access_key": "x"}) {
		t.Fatal("secret keys must be rejected")
	}
	if costPayloadHasSecret(map[string]any{"line_item_unblended_cost": "1.00"}) {
		t.Fatal("billed columns are not secrets")
	}
	if _, err := costSanitizeLabel("finance@example.com"); err == nil {
		t.Fatal("labels cannot include an email")
	}
}

func TestCostFreshnessStaleVsUnknown(t *testing.T) {
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	if costFreshness(nil, now, false, now) != "unknown" {
		t.Fatal("missing ingest is Unknown, never Healthy")
	}
	stale := now.Add(-48 * time.Hour)
	if costFreshness(&stale, now, true, now) != "stale" {
		t.Fatal("current-month ingest older than 36h is stale")
	}
	fresh := now.Add(-time.Hour)
	if costFreshness(&fresh, now, true, now) != "current" {
		t.Fatal("recent ingest should be current")
	}
	pastEnd := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	old := now.Add(-48 * time.Hour)
	if costFreshness(&old, pastEnd, true, now) != "current" {
		t.Fatal("a completed past window is current, not stale")
	}
}

func TestCostAllocationOrderThenUnallocated(t *testing.T) {
	lines := []costLineRow{
		{ResourceID: "i-1", Service: "Amazon Elastic Compute Cloud", AccountID: "123456789012", TeamSlug: "tag-team", Actual: "10.000000", Currency: "USD"},
		{ResourceID: "i-2", Service: "Amazon Elastic Compute Cloud", AccountID: "123456789012", TeamSlug: "tag-team", Actual: "5.000000", Currency: "USD"},
		{ResourceID: "i-3", Service: "Amazon S3", AccountID: "123456789012", Actual: "4.000000", Currency: "USD"},
		{ResourceID: "i-4", Service: "Amazon S3", AccountID: "999", TeamSlug: "tag-team", Actual: "3.000000", Currency: "USD"},
		{ResourceID: "i-5", Service: "Amazon S3", AccountID: "acct-conn", Actual: "2.000000", Currency: "USD"},
		{ResourceID: "i-6", Service: "Amazon S3", AccountID: "none", Actual: "1.000000", Currency: "USD"},
	}
	rules := []costAllocationRule{
		{ID: 1, MatchType: "account", MatchValue: "123456789012", TeamSlug: "account-team", Priority: 1},
		{ID: 2, MatchType: "product", MatchValue: "Amazon Elastic Compute Cloud", TeamSlug: "product-team", Priority: 1},
		{ID: 3, MatchType: "resource", MatchValue: "i-1", TeamSlug: "resource-team", ServiceName: "payments-api", Priority: 10},
	}
	out := applyCostAllocation(lines, rules, map[string]string{"acct-conn": "conn-team"})
	if out[0].TeamSlug != "resource-team" || out[0].AllocatedService != "payments-api" {
		t.Fatalf("resource rule should win: %+v", out[0])
	}
	if out[1].TeamSlug != "product-team" {
		t.Fatalf("product rule should beat account and tag: %+v", out[1])
	}
	if out[2].TeamSlug != "account-team" {
		t.Fatalf("account rule should beat empty tag: %+v", out[2])
	}
	if out[3].TeamSlug != "tag-team" {
		t.Fatalf("CUR tag should beat connection default: %+v", out[3])
	}
	if out[4].TeamSlug != "conn-team" {
		t.Fatalf("connection default should apply: %+v", out[4])
	}
	if out[5].TeamSlug != "" {
		t.Fatalf("unmatched line must stay Unallocated, not zero-owned: %+v", out[5])
	}
}

func TestCostOwnershipIncompleteIsUnknownNotZero(t *testing.T) {
	view := costOwnershipView("100.000000", "10.000000", "incomplete", "USD")
	if view["display"] != "Unknown" || view["percent"] != nil {
		t.Fatalf("incomplete ownership must stay Unknown: %+v", view)
	}
	empty := costOwnershipView("0.000000", "0.000000", "complete", "USD")
	if empty["display"] != "Unknown" || empty["percent"] != nil {
		t.Fatalf("zero total ownership must stay Unknown: %+v", empty)
	}
}

func TestCostExplorerCSVBlanksEmailsAndUnknownAmounts(t *testing.T) {
	if costCSVSafe("owner@example.com") != "" {
		t.Fatal("CSV cells must blank emails")
	}
	body := costExplorerCSV("2026-09-01", "2026-09-30", "actual", "USD", "incomplete", []costLineRow{
		{Service: "Amazon S3", Region: "us-east-1", AccountID: "123456789012", ResourceID: "bucket", TeamSlug: "owner@example.com", Amount: "12.500000"},
	})
	if strings.Contains(body, "@") {
		t.Fatal("CSV export must not include emails")
	}
	if !strings.Contains(body, "Unknown") {
		t.Fatal("incomplete coverage must export Unknown, not a dollar amount")
	}
	if strings.Contains(body, "12.500000") {
		t.Fatal("incomplete export must not leak a billed amount")
	}
}

func TestCostBudgetsNeverPauseAndUnknownRemaining(t *testing.T) {
	if costBudgetAlert("90.000000", "100.000000", "complete") != "warn" {
		t.Fatal("80 percent should warn")
	}
	if costBudgetAlert("100.000000", "100.000000", "complete") != "over" {
		t.Fatal("100 percent should be over")
	}
	if costBudgetAlert("50.000000", "100.000000", "incomplete") != "unknown" {
		t.Fatal("incomplete budget alert must stay Unknown")
	}
	status := evaluateCostBudget(costBudget{
		Name: "ops", ScopeType: "all", Amount: "100.000000", Currency: "USD", Basis: "actual",
	}, []costLineRow{{Actual: "40.000000", Currency: "USD", TeamSlug: "platform-team"}}, "incomplete")
	if status.PausesWorkloads {
		t.Fatal("budgets must never pause workloads")
	}
	if status.Remaining["display"] != "Unknown" || status.Remaining["amount"] != nil {
		t.Fatalf("incomplete remaining must stay Unknown: %+v", status.Remaining)
	}
}

func TestCostServiceStripNoMatchIsUnknown(t *testing.T) {
	lines := applyCostAllocation([]costLineRow{
		{ResourceID: "i-logs", Service: "Amazon S3", AccountID: "123", TeamSlug: "platform-team", Actual: "12.500000"},
	}, []costAllocationRule{{MatchType: "resource", MatchValue: "i-api", ServiceName: "payments-api", TeamSlug: "platform-team"}}, nil)
	matched := filterAllocatedCostLines(lines, costLineQuery{PortalService: "payments-api"})
	if len(matched) != 0 {
		t.Fatal("unmapped service must not inherit another resource's spend")
	}
	view := costMoneyView(costCoverage(false, false), "12.500000", "USD", "actual")
	if view["display"] != "Unknown" || view["amount"] != nil {
		t.Fatalf("no match must stay Unknown, never $0: %+v", view)
	}
}

func TestCostPageGrantMapsToOperations(t *testing.T) {
	if pageForPath("/api/cost/overview") != "cost" {
		t.Fatal("cost APIs need the cost page grant")
	}
	if pageForPath("/api/cost/tree") != "cost" || pageForPath("/api/cost/connections/1/dashboard") != "cost" {
		t.Fatal("Cost tree and account dashboards stay on the cost page grant")
	}
	if pageForPath("/api/cost/projects/1") != "cost" || pageForPath("/api/cost/cloud-accounts/9/dashboard") != "cost" {
		t.Fatal("project and cloud dashboards stay on the cost page grant")
	}
	if pageForPath("/api/cost/connections/1/export") != "cost" || pageForPath("/api/cost/ai-proof") != "cost" {
		t.Fatal("account CSV and AI proofs stay on the cost page grant")
	}
	if sectionForPath("/api/cost/explorer") != "cost" {
		t.Fatal("cost APIs belong under Cost")
	}
	grants := defaultSectionGrants("devops")
	if !grants.allows("cost") || !grants.allowsPage("cost") {
		t.Fatal("devops groups keep Cost until the section or page is turned off")
	}
	grants.Pages = map[string]bool{"cost": false, "certificates": true}
	if grants.allowsPage("cost") {
		t.Fatal("an explicit Cost deny must hide the page")
	}
}

func TestCostMissingMetricsBlocksRightsizing(t *testing.T) {
	slice := &costWindowSlice{
		Coverage: "complete", Currency: "USD", Basis: "actual", WindowStart: "2026-09-01", WindowEnd: "2026-09-30",
		Lines: []costLineRow{{Service: "Amazon Elastic Compute Cloud", ResourceID: "i-1", Amount: "410.250000", Actual: "410.250000", Currency: "USD"}},
	}
	recs := buildCostRecommendations(slice, costMetricsContext{Ready: false})
	found := false
	for _, rec := range recs {
		if rec.FindingType != "oversized_compute" {
			continue
		}
		found = true
		if rec.Status != "blocked" || rec.Executes || rec.PausesWorkloads {
			t.Fatalf("rightsizing must stay blocked and never execute: %+v", rec)
		}
		if rec.SavingsHigh["display"] != "Unknown" || rec.SavingsHigh["amount"] != nil {
			t.Fatalf("missing metrics must not show a dollar saving: %+v", rec.SavingsHigh)
		}
	}
	if !found {
		t.Fatal("compute spend should produce a rightsizing recommendation")
	}
}

func TestCostOverlappingSavingsAreNotSummed(t *testing.T) {
	recs := []costRecommendation{
		{GroupID: "GRP-1", ResourceID: "i-1", CalcID: "CALC-COST-AAAAAAA1", SavingsHigh: costMoneyView("complete", "410.250000", "USD", "actual")},
		{GroupID: "GRP-1", ResourceID: "i-1", CalcID: "CALC-COST-AAAAAAA2", SavingsHigh: costMoneyView("complete", "410.250000", "USD", "actual")},
		{GroupID: "GRP-2", ResourceID: "i-2", CalcID: "CALC-COST-AAAAAAA3", SavingsHigh: costMoneyView("complete", "50.000000", "USD", "actual")},
	}
	groups := groupCostOpportunities(recs, "USD", "actual")
	total := sumNonOverlappingSavings(groups, "USD", "actual")
	if total["amount"] != "460.250000" {
		t.Fatalf("group cap must count i-1 once: %+v groups=%+v", total, groups)
	}
}

func TestCostIncompleteForecastIsUnknown(t *testing.T) {
	view := costForecastView(
		&costWindowSlice{Coverage: "incomplete", Total: "100.000000", Currency: "USD", Basis: "actual"},
		&costWindowSlice{Coverage: "complete", Total: "80.000000", Currency: "USD", Basis: "actual"},
	)
	if view["display"] != "Unknown" || view["low"] != nil || view["method"] != "abstain" {
		t.Fatalf("incomplete forecast must abstain: %+v", view)
	}
}

func TestCostAnomalyNeedsTwoCompleteWindows(t *testing.T) {
	out := detectCostAnomalies(
		&costWindowSlice{Coverage: "complete", Currency: "USD", Basis: "actual", WindowStart: "2026-09-01", WindowEnd: "2026-09-30", Lines: []costLineRow{{ResourceID: "i-1", Amount: "200.000000"}}},
		&costWindowSlice{Coverage: "incomplete", Currency: "USD", Basis: "actual"},
	)
	if len(out) != 1 || out[0].LikeForLike || out[0].Delta["display"] != "Unknown" {
		t.Fatalf("incomplete baseline must not look like a drop to zero: %+v", out)
	}
}

func TestCostLikeForLikeIncreaseUsesPriorCompleteWindow(t *testing.T) {
	out := detectCostAnomalies(
		&costWindowSlice{Coverage: "complete", Currency: "USD", Basis: "actual", WindowStart: "2026-09-01", WindowEnd: "2026-09-30", Lines: []costLineRow{{ResourceID: "i-1", Service: "Amazon Elastic Compute Cloud", AccountID: "123456789012", Amount: "200.000000"}}},
		&costWindowSlice{Coverage: "complete", Currency: "USD", Basis: "actual", Lines: []costLineRow{{ResourceID: "i-1", Amount: "100.000000"}}},
	)
	if len(out) != 1 || !out[0].LikeForLike || out[0].Delta["amount"] != "100.000000" {
		t.Fatalf("like-for-like increase: %+v", out)
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	priorStart, priorEnd := priorLikeForLikeWindow(start, end)
	if priorStart.Format("2006-01-02") != "2026-08-01" || priorEnd.Format("2006-01-02") != "2026-08-31" {
		t.Fatalf("prior window %s %s", priorStart, priorEnd)
	}
}

func TestCostCopilotCitesCalculationIDs(t *testing.T) {
	if !costQueryRelated("explain CALC-COST-DEADBEEF") {
		t.Fatal("named calculation IDs must be in scope")
	}
	answer := buildGroundedAnswer("why did spend increase", []groundedSource{{
		Kind:   "cost_calculation",
		Number: "CALC-COST-DEADBEEF",
		Title:  "recommendation",
		Body:   "Missing metrics block rightsizing claims.",
	}})
	if !strings.Contains(answer.Reply, "CALC-COST-DEADBEEF") {
		t.Fatalf("copilot fallback must name the calculation ID: %s", answer.Reply)
	}
	if len(answer.Citations) != 1 || answer.Citations[0].Number != "CALC-COST-DEADBEEF" {
		t.Fatalf("citations: %+v", answer.Citations)
	}
}

func TestCostNotifyCategoryHonorsToggle(t *testing.T) {
	settings := defaultOpsNotificationSettings()
	if !isOpsNotificationCategoryEnabled(settings, "cost_anomaly") {
		t.Fatal("cost alerts default on")
	}
	settings.NotifyCost = false
	if isOpsNotificationCategoryEnabled(settings, "cost_anomaly") || isOpsNotificationCategoryEnabled(settings, "cost_budget") {
		t.Fatal("notify_cost off must suppress cost alerts")
	}
}

func TestCostAcceptDoesNotExecute(t *testing.T) {
	rec := costRecommendation{Status: "detected", Lifecycle: "detected", CalcID: "CALC-COST-1"}
	next, err := transitionCostReview(rec, costReviewAction{Action: "accept"})
	if err != nil {
		t.Fatal(err)
	}
	if next.Executes || next.PausesWorkloads || next.Lifecycle != "accepted" {
		t.Fatalf("accept must not execute: %+v", next)
	}
}

func TestCostBlockedCannotBeAccepted(t *testing.T) {
	rec := costRecommendation{Status: "blocked", Lifecycle: "blocked", BlockedReason: "Missing metrics block rightsizing claims."}
	if _, err := transitionCostReview(rec, costReviewAction{Action: "accept"}); err == nil {
		t.Fatal("blocked recommendations cannot be accepted")
	}
}

func TestCostDismissNeedsReasonAndDate(t *testing.T) {
	rec := costRecommendation{Status: "detected", Lifecycle: "detected"}
	if _, err := transitionCostReview(rec, costReviewAction{Action: "dismiss", Reason: "later"}); err == nil {
		t.Fatal("dismissal needs a review date")
	}
	next, err := transitionCostReview(rec, costReviewAction{Action: "dismiss", Reason: "deferred", ReviewBy: "2026-11-01"})
	if err != nil || next.Lifecycle != "dismissed" {
		t.Fatalf("dismiss: %v %+v", err, next)
	}
}

func TestCostChangeRefRejectsEmailAndParsesNumber(t *testing.T) {
	if _, err := parseCostChangeID("owner@example.com"); err == nil {
		t.Fatal("change refs cannot include an email")
	}
	id, err := parseCostChangeID("CHG0000009")
	if err != nil || id != 9 {
		t.Fatalf("CHG0000009 = %d %v", id, err)
	}
}

func TestCostVerificationCanBeInconclusive(t *testing.T) {
	result := evaluateCostVerification("", nil, nil, nil, "price change")
	if result.Outcome != "inconclusive" || result.BillReduction["display"] != "Unknown" {
		t.Fatalf("confounders must stay Inconclusive: %+v", result)
	}
	forced := evaluateCostVerification("verified", costMoneyView("incomplete", "", "USD", "actual"), nil, nil, "")
	if forced.Outcome != "inconclusive" {
		t.Fatalf("incomplete windows cannot be verified: %+v", forced)
	}
}

func TestCostLinkRequiresAccept(t *testing.T) {
	rec := costRecommendation{Status: "detected", Lifecycle: "detected"}
	if _, err := transitionCostReview(rec, costReviewAction{Action: "link", ChangeNumber: "CHG0000001"}); err == nil {
		t.Fatal("must accept before linking a change")
	}
}

func TestCostVerifiedOverlapCountsOnce(t *testing.T) {
	capped := capGroupSavings(
		costMoneyView("complete", "40.000000", "USD", "actual"),
		costMoneyView("complete", "40.000000", "USD", "actual"),
		"USD", "actual",
	)
	if capped["amount"] != "40.000000" {
		t.Fatalf("overlapping verified savings must not be summed: %+v", capped)
	}
}

func TestCostK8sReadinessNeverHealthy(t *testing.T) {
	if costK8sLamp("healthy") != "unknown" || costK8sLamp("ok") != "unknown" {
		t.Fatal("missing inventory must stay Unknown, never Healthy")
	}
	if costK8sLamp("ready") != "ready" {
		t.Fatal("ready stays ready when the source exists")
	}
	if costK8sCollectorHealth("failed") != "unknown" || costK8sCollectorHealth("healthy") != "unknown" {
		t.Fatal("collector failure is Unknown, never Healthy")
	}
}

func TestCostK8sLampsStayIndependent(t *testing.T) {
	item := costK8sBinding{InventoryReadiness: "ready", MetricsReadiness: "unknown", AllocationReadiness: "unknown", BillingReconciled: "unknown", CollectorHealth: "failed"}
	decorateCostK8sBinding(&item, nil)
	if item.InventoryReadiness != "ready" || item.MetricsReadiness != "unknown" || item.AllocationReadiness != "unknown" || item.BillingReconciled != "unknown" {
		t.Fatalf("lamps must stay independent: %+v", item)
	}
	if item.CollectorHealth != "unknown" || item.InstallsOpenCost || item.WorkerCanEdit || item.AddedToCloudTotal {
		t.Fatalf("collector and action flags: %+v", item)
	}
}

func TestCostK8sLeastPrivilegeFixture(t *testing.T) {
	if err := costK8sFixtureIsLeastPrivilege(costK8sLeastPrivilegeYAML); err != nil {
		t.Fatal(err)
	}
	if err := costK8sFixtureIsLeastPrivilege("kind: ClusterRole\nverbs: [\"create\", \"get\"]"); err == nil {
		t.Fatal("write verbs must be rejected")
	}
	if err := costK8sFixtureIsLeastPrivilege("kind: ClusterRole\nhelm install opencost\nverbs: [\"get\", \"list\", \"watch\"]"); err == nil {
		t.Fatal("OpenCost install must be rejected")
	}
}

func TestCostK8sDoesNotInstallOpenCost(t *testing.T) {
	contract := defaultCostK8sCollectorContract()
	if contract.InstallsOpenCost || contract.WorkerCanEdit || contract.PublicScrape || contract.DockerSocket {
		t.Fatalf("collector contract: %+v", contract)
	}
	if !strings.Contains(strings.ToLower(costK8sLeastPrivilegeYAML), "does not install opencost") {
		t.Fatal("fixture must say this product does not install OpenCost")
	}
}

func TestCostK8sNotAddedToCloudTotal(t *testing.T) {
	if !kubernetesSpendIsBreakdown() {
		t.Fatal("kubernetes spend is a breakdown")
	}
	if combineCloudAndKubernetesTotal("410.250000", "88.000000") != "410.250000" {
		t.Fatal("cluster figures must not be added to the cloud total")
	}
	card := buildCostKubernetesCard(0)
	spend, _ := card["spend"].(map[string]any)
	if spend["display"] != "Unknown" || spend["amount"] != nil || card["added_to_cloud_total"] != false {
		t.Fatalf("unmapped cluster spend must stay Unknown and off the cloud total: %+v", card)
	}
}

func TestCostK8sBindRejectsDemoAndEmpty(t *testing.T) {
	if err := costK8sBindError(nil, nil); err == nil {
		t.Fatal("missing cluster must be rejected")
	}
	if err := costK8sBindError(&k8sConnectionRecord{ID: 1}, nil); err == nil {
		t.Fatal("cluster name is required")
	}
	err := costK8sBindError(
		&k8sConnectionRecord{ID: 1, ClusterName: "nonprod-a", Environment: "nonprod"},
		&costConnection{AccountID: "111122223333"},
	)
	if err == nil {
		t.Fatal("demo cloud accounts cannot be used for Cost")
	}
	if err := costK8sBindError(&k8sConnectionRecord{ID: 1, ClusterName: "prod-a", Environment: "prod"}, nil); err == nil {
		t.Fatal("production is outside the Kubernetes Cost pilot")
	}
}

func TestCostKubernetesPageGrant(t *testing.T) {
	if pageForPath("/api/cost/kubernetes/clusters") != "cost" {
		t.Fatal("kubernetes cost APIs need the cost page grant")
	}
	if sectionForPath("/api/cost/kubernetes/clusters") != "cost" {
		t.Fatal("kubernetes cost stays under Cost")
	}
	if pageForPath("/api/cost/collector/snapshots") != "cost" {
		t.Fatal("collector upload stays on the cost grant")
	}
}

func sampleK8sSnapshotRaw() map[string]any {
	return map[string]any{
		"cluster_uid":  "cluster-nonprod-a",
		"window_start": "2026-10-24T00:00:00Z",
		"window_end":   "2026-10-25T00:00:00Z",
		"complete":     true,
		"collected_at": "2026-10-25T01:00:00Z",
		"inventory": map[string]any{
			"nodes": []any{map[string]any{"name": "ip-10-0-1-10", "provider_id": "aws:///us-east-1a/i-0costk2node01"}},
			"pods": []any{
				map[string]any{
					"uid": "pod-uid-live", "name": "api-abc", "namespace": "payments",
					"controller_kind": "Deployment", "controller_name": "api",
					"cpu_usage": "80m", "deleted": false,
					"managed_by": "Helm", "hpa": "api", "vpa": "api", "pdb": "api",
					"labels": map[string]any{"team": "payments"},
				},
				map[string]any{
					"uid": "pod-uid-gone", "name": "api-abc", "namespace": "payments",
					"controller_kind": "Deployment", "controller_name": "api",
					"deleted": true, "ended_at": "2026-10-24T18:00:00Z",
				},
			},
		},
		"opencost": map[string]any{
			"data": []any{
				map[string]any{"properties": map[string]any{"pod_uid": "pod-uid-live", "namespace": "payments", "pod": "api-abc"}, "totalCost": "4.20"},
			},
		},
	}
}

func TestCostK8sDeletedPodKeepsUID(t *testing.T) {
	doc, err := parseCostK8sSnapshot(sampleK8sSnapshotRaw(), time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Identities) != 2 {
		t.Fatalf("identities = %d", len(doc.Identities))
	}
	byUID := map[string]costK8sIdentity{}
	for _, item := range doc.Identities {
		byUID[item.PodUID] = item
	}
	if !byUID["pod-uid-gone"].Deleted || byUID["pod-uid-live"].Deleted {
		t.Fatalf("deleted pod must keep a distinct UID: %+v", byUID)
	}
	if byUID["pod-uid-gone"].PodName != byUID["pod-uid-live"].PodName {
		t.Fatal("name reuse must still keep both UIDs")
	}
}

func TestCostK8sMissingUsageIsNeedsMoreData(t *testing.T) {
	if costK8sMetricView(nil)["display"] != "Needs more data" || costK8sMetricView(nil)["amount"] != nil {
		t.Fatal("missing usage must not become zero")
	}
	zero := "0"
	if costK8sMetricView(&zero)["display"] != "0" {
		t.Fatal("sampled zero usage is allowed")
	}
	amount := "4.20"
	if costK8sEstimatedView(&amount, false)["display"] != "Needs more data" {
		t.Fatal("partial windows cannot claim estimated spend")
	}
	if costK8sEstimatedView(nil, true)["display"] != "Needs more data" {
		t.Fatal("missing allocation is Needs more data, not $0")
	}
}

func TestCostK8sSnapshotRejectsSecretsAndKeepsHashStable(t *testing.T) {
	raw := sampleK8sSnapshotRaw()
	raw["kubeconfig"] = "apiVersion: v1"
	if _, err := parseCostK8sSnapshot(raw, time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("kubeconfig must be rejected")
	}
	doc, err := parseCostK8sSnapshot(sampleK8sSnapshotRaw(), time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if costK8sSnapshotHash(doc) != costK8sSnapshotHash(doc) {
		t.Fatal("content hash must be stable")
	}
	doc.Identities[0].CPUUsage = nil
	if costK8sSnapshotHash(doc) == costK8sSnapshotHash(&costK8sSnapshotDoc{ClusterUID: doc.ClusterUID, WindowStart: doc.WindowStart, WindowEnd: doc.WindowEnd, Complete: true}) {
		t.Fatal("identity changes must change the hash")
	}
}

func TestCostK8sOlderSnapshotIsStale(t *testing.T) {
	older := time.Date(2026, 10, 25, 1, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC)
	if !costK8sSnapshotIsStale(older, newer) {
		t.Fatal("older collected_at cannot overwrite newer")
	}
	if costK8sSnapshotIsStale(newer, older) {
		t.Fatal("newer collected_at must be accepted")
	}
}

func TestCostK8sUnattributedAllocationWithoutUID(t *testing.T) {
	raw := sampleK8sSnapshotRaw()
	raw["opencost"] = map[string]any{
		"data": []any{
			map[string]any{"properties": map[string]any{"namespace": "payments", "pod": "api-abc"}, "totalCost": "9.99"},
		},
	}
	doc, err := parseCostK8sSnapshot(raw, time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Unattributed == 0 {
		t.Fatal("name reuse without UID must stay unattributed, not a second identity")
	}
	for _, item := range doc.Identities {
		if item.AllocationTotal != nil {
			t.Fatalf("ambiguous name must not attach spend: %+v", item)
		}
	}
}

func TestCostK8sInstanceIDFromProvider(t *testing.T) {
	if extractCostK8sInstanceID("aws:///us-east-1a/i-0costk2node01") != "i-0costk2node01" {
		t.Fatal("AWS provider ID must yield the instance id")
	}
	if extractCostK8sInstanceID("i-abc") == "i-abc" {
		t.Fatal("short instance ids must not map")
	}
}

func TestCostK8sBilledMappingStaysOnParent(t *testing.T) {
	nodes := []costK8sNode{{ProviderID: "aws:///us-east-1a/i-0costk2node01", InstanceID: "i-0costk2node01"}}
	lines := []costLineRow{
		{ResourceID: "i-0costk2node01", Service: "Amazon Elastic Compute Cloud", Actual: "10.000000", Currency: "USD"},
		{ResourceID: "cost-c1-logs", Service: "Amazon Simple Storage Service", Actual: "5.000000", Currency: "USD"},
		{ResourceID: "i-0costk2node01", Service: "Amazon Elastic GPU", Actual: "2.000000", Currency: "USD"},
	}
	mapped, unmapped, mappedLines, _, gaps := splitCostK8sBilled(lines, nodes, "actual")
	if mapped != "12.000000" || unmapped != "5.000000" {
		t.Fatalf("mapped=%s unmapped=%s", mapped, unmapped)
	}
	if len(mappedLines) != 2 {
		t.Fatalf("mapped lines = %d", len(mappedLines))
	}
	if gaps["gpu"] == "" {
		t.Fatal("mapped GPU must stay a visible coverage gap")
	}
	total := addCostAmounts(mapped, unmapped)
	if combineCloudAndKubernetesTotal(total, mapped) != total {
		t.Fatal("mapped cluster billed must not be added to the cloud total")
	}
}

func TestCostK8sIdleRedistributePreservesTotal(t *testing.T) {
	w, i, s, u, total := distributeCostK8sIdle("4.200000", "1.000000", "0.500000", "0.300000", false)
	if total != "6.000000" || i != "1.000000" {
		t.Fatalf("exclusive buckets %s %s %s %s %s", w, i, s, u, total)
	}
	w2, i2, s2, u2, total2 := distributeCostK8sIdle(w, i, s, u, true)
	if total2 != total || i2 != "0.000000" || w2 != "5.200000" || s2 != s || u2 != u {
		t.Fatalf("distribute must move idle without changing the total: %s %s %s %s %s", w2, i2, s2, u2, total2)
	}
}

func TestCostK8sReconciliationResidualNeedsLikeForLike(t *testing.T) {
	workload := "4.200000"
	idle := "2.000000"
	nodes := []costK8sNode{{InstanceID: "i-0costk2node01"}}
	identities := []costK8sIdentity{{Namespace: "payments", ControllerKind: "Deployment", AllocationTotal: &workload}}
	lines := []costLineRow{{ResourceID: "i-0costk2node01", Service: "Amazon Elastic Compute Cloud", Actual: "10.000000"}}
	result := reconcileCostK8s(nodes, identities, &idle, nil, nil, lines, "complete", "actual", "USD", "2026-10-01", "2026-10-31", "2026-10-24T00:00:00Z", "2026-10-25T00:00:00Z", true, false)
	if result["like_for_like"] != false {
		t.Fatal("daily snapshot vs monthly CUR is not like-for-like")
	}
	residual, _ := result["residual"].(map[string]any)
	if residual["display"] != "Unknown" || residual["amount"] != nil {
		t.Fatalf("unlike windows cannot claim residual: %+v", residual)
	}
	if result["added_to_cloud_total"] != false || result["billing_reconciled"] != "unknown" {
		t.Fatalf("must not mark billing reconciled without a matched window: %+v", result)
	}
	matched := reconcileCostK8s(nodes, identities, &idle, nil, nil, lines, "complete", "actual", "USD", "2026-10-24", "2026-10-25", "2026-10-24T00:00:00Z", "2026-10-25T00:00:00Z", true, false)
	if matched["billing_reconciled"] != "ready" {
		t.Fatalf("like-for-like mapped nodes should reconcile: %+v", matched)
	}
	est, _ := matched["estimated_total"].(map[string]any)
	if !strings.Contains(fmt.Sprint(est["display"]), "Estimated") {
		t.Fatalf("list-price must stay labelled Estimated: %+v", est)
	}
}

func TestCostK8sWorkloadGapIsNeedsMoreData(t *testing.T) {
	usage := "80m"
	amount := "4.200000"
	rows := aggregateCostK8sWorkloads([]costK8sIdentity{
		{PodUID: "live", Namespace: "payments", ControllerKind: "Deployment", ControllerName: "api", WorkloadKey: "payments|deployment|api", CPUUsage: &usage, AllocationTotal: &amount},
		{PodUID: "gone", Namespace: "payments", ControllerKind: "Deployment", ControllerName: "api", WorkloadKey: "payments|deployment|api", Deleted: true},
	}, true)
	if len(rows) != 1 || rows[0].DeletedCount != 1 || rows[0].PodCount != 2 {
		t.Fatalf("workload rollup: %+v", rows)
	}
	if rows[0].CPUUsage["display"] != "Needs more data" || rows[0].AllocationTotal["display"] != "Needs more data" {
		t.Fatalf("a missing member must not zero-fill the workload: %+v", rows[0])
	}
	if rows[0].AddedToCloudTotal {
		t.Fatal("kubernetes allocation is not added to the cloud bill")
	}
}

func TestCostK8sConstraintsAreVisible(t *testing.T) {
	doc, err := parseCostK8sSnapshot(sampleK8sSnapshotRaw(), time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	views := costK8sIdentityViews(doc.Identities, true)
	live := costK8sIdentityView{}
	gone := costK8sIdentityView{}
	for _, item := range views {
		if item.PodUID == "pod-uid-live" {
			live = item
		}
		if item.PodUID == "pod-uid-gone" {
			gone = item
		}
	}
	if live.ManagedBy != "Helm" || live.HPA != "api" || live.VPA != "api" || live.PDB != "api" {
		t.Fatalf("live constraints must be visible: %+v", live)
	}
	if gone.ManagedBy != "Unknown" || gone.HPA != "Unknown" || gone.VPA != "Unknown" || gone.PDB != "Unknown" {
		t.Fatalf("missing constraints stay Unknown, never blank: %+v", gone)
	}
	if live.Owner != "payments" || gone.Owner != "Unknown" {
		t.Fatalf("owner visibility: live=%s gone=%s", live.Owner, gone.Owner)
	}
}

func TestCostK8sAllocationMissingOwnership(t *testing.T) {
	amount := "4.200000"
	rows := groupCostK8sAllocations([]costK8sIdentity{
		{PodUID: "live", Namespace: "payments", ControllerKind: "Deployment", ControllerName: "api", WorkloadKey: "payments|deployment|api", AllocationTotal: &amount, Owner: "payments", ManagedBy: "Helm"},
		{PodUID: "job", Namespace: "payments", ControllerKind: "Job", ControllerName: "settle", WorkloadKey: "payments|job|settle"},
	}, "controller", true)
	if len(rows) != 2 {
		t.Fatalf("groups = %+v", rows)
	}
	missing := costK8sMissingOwnership([]costK8sIdentity{
		{WorkloadKey: "payments|job|settle", Namespace: "payments", ControllerName: "settle"},
		{WorkloadKey: "payments|deployment|api", Namespace: "payments", ControllerName: "api", Owner: "payments"},
	})
	if len(missing) != 1 || missing[0]["owner"] != "Unknown" {
		t.Fatalf("missing ownership queue: %+v", missing)
	}
	labelled := rows[0].AllocationTotal["display"] == "Estimated USD 4.20" || rows[1].AllocationTotal["display"] == "Estimated USD 4.20"
	if !labelled {
		t.Fatalf("list-price must stay labelled Estimated: %+v", rows)
	}
}

func TestCostK8sOptimizationBlockedByConstraints(t *testing.T) {
	usage := "80m"
	amount := "4.200000"
	recs := costK8sOptimizationFromWorkloads([]costK8sWorkloadView{
		{
			WorkloadKey: "payments|deployment|api", Namespace: "payments", ControllerName: "api",
			CPURequest: "200m", CPUUsage: costK8sMetricView(&usage), AllocationTotal: costK8sEstimatedView(&amount, true),
			ManagedBy: "Helm", HPA: "api", VPA: "api", PDB: "api",
		},
		{
			WorkloadKey: "payments|job|settle", Namespace: "payments", ControllerName: "settle",
			CPUUsage: costK8sMetricView(nil), AllocationTotal: costK8sEstimatedView(nil, true),
		},
	}, nil, true)
	if len(recs) != 2 {
		t.Fatalf("recs = %d", len(recs))
	}
	if recs[0].Executes || recs[1].Executes || recs[0].WorkerCanEdit {
		t.Fatal("optimization cannot execute or edit workloads")
	}
	if recs[0].Status != "blocked" || recs[0].HPA != "api" || recs[0].VPA != "api" || recs[0].PDB != "api" || recs[0].ManagedBy != "Helm" {
		t.Fatalf("constraints must block and stay visible: %+v", recs[0])
	}
	if recs[1].Status != "blocked" || recs[1].HPA != "Unknown" {
		t.Fatalf("missing metrics and constraints stay visible: %+v", recs[1])
	}
	if recs[0].BillReduction["display"] != "Unknown" || recs[0].Savings["display"] != "Unknown" {
		t.Fatalf("k8s optimization must not invent billed savings: %+v", recs[0].BillReduction)
	}
	if !strings.Contains(fmt.Sprint(recs[0].AllocationTotal["display"]), "Estimated") {
		t.Fatalf("list-price must stay labelled Estimated: %+v", recs[0].AllocationTotal)
	}
}

func TestCostK8sRequestOnlyReportsCapacityNotCash(t *testing.T) {
	usage := "80m"
	memUse := "128Mi"
	amount := "4.200000"
	recs := costK8sOptimizationFromWorkloads([]costK8sWorkloadView{{
		WorkloadKey: "payments|deployment|api", Namespace: "payments", ControllerName: "api",
		CPURequest: "200m", MemoryRequest: "256Mi",
		CPUUsage: costK8sMetricView(&usage), MemoryUsage: costK8sMetricView(&memUse),
		AllocationTotal: costK8sEstimatedView(&amount, true),
	}}, nil, true)
	if len(recs) != 1 {
		t.Fatalf("recs = %d", len(recs))
	}
	rec := recs[0]
	if rec.ChangeKind != "request_only" || rec.InventsSKU || rec.CandidateSKU != "" {
		t.Fatalf("request-only must not invent a SKU: %+v", rec)
	}
	if rec.CapacityReleased.Display != "120m CPU · 128Mi memory" {
		t.Fatalf("capacity released = %s", rec.CapacityReleased.Display)
	}
	if rec.AllocationReduction["display"] != "Estimated USD 2.52" {
		t.Fatalf("allocated reduction is estimated unused request share: %+v", rec.AllocationReduction)
	}
	if rec.BillReduction["display"] != "Unknown" {
		t.Fatalf("request-only must not report cash: %+v", rec.BillReduction)
	}
	if !strings.HasPrefix(rec.CalcID, "CALC-COST-") {
		t.Fatalf("copilot must be able to cite a calculation ID: %s", rec.CalcID)
	}
	if !strings.Contains(rec.Calculation, "capacity, not cash") || strings.Contains(strings.ToLower(rec.Calculation), "m5.") {
		t.Fatalf("calculation must not invent a SKU: %s", rec.Calculation)
	}
}

func TestCostK8sMissingUsageKeepsCashUnknown(t *testing.T) {
	kind, capacity, allocated, billed := costK8sRequestOnlySplit("200m", "", "256Mi", "", nil, true)
	if kind != "needs_more_data" || capacity.Display != "Unknown" {
		t.Fatalf("missing usage: kind=%s capacity=%s", kind, capacity.Display)
	}
	if allocated["display"] != "Needs more data" || billed["display"] != "Unknown" {
		t.Fatalf("missing usage cannot become $0 cash: alloc=%v bill=%v", allocated, billed)
	}
}

func TestCostK8sIdleIsNotBillSavings(t *testing.T) {
	idle := "2.000000"
	capacity, allocated, billed := costK8sIdleSplit(&idle, true)
	if capacity.Display != "Unknown" {
		t.Fatalf("idle must not invent nodes to drain: %+v", capacity)
	}
	if allocated["display"] != "Estimated USD 2.00" {
		t.Fatalf("idle allocated reduction stays estimated: %+v", allocated)
	}
	if billed["display"] != "Unknown" {
		t.Fatalf("idle list-price is not a billed saving: %+v", billed)
	}
}

func TestCostK8sDoesNotSumCapacityAndCash(t *testing.T) {
	usage := "80m"
	amount := "4.200000"
	recs := costK8sOptimizationFromWorkloads([]costK8sWorkloadView{{
		WorkloadKey: "payments|deployment|api", CPURequest: "200m",
		CPUUsage: costK8sMetricView(&usage), AllocationTotal: costK8sEstimatedView(&amount, true),
	}}, nil, true)
	alloc := costK8sViewAmount(recs[0].AllocationReduction)
	bill := costK8sViewAmount(recs[0].BillReduction)
	if alloc == nil || bill != nil {
		t.Fatalf("cash and estimated allocation must stay distinct: alloc=%v bill=%v", alloc, bill)
	}
	if strings.Contains(recs[0].CapacityReleased.Display, "USD") {
		t.Fatal("capacity released is not money")
	}
}

func TestCostK8sPilotRejectsProductionAndSecondCluster(t *testing.T) {
	if costK8sEnvironmentIsNonprod("prod") || costK8sEnvironmentIsNonprod("production") || costK8sEnvironmentIsNonprod("nonprod-a") {
		t.Fatal("production and unknown names stay outside the pilot; nonprod-a is a cluster name, not an environment")
	}
	if !costK8sEnvironmentIsNonprod("nonprod") || !costK8sEnvironmentIsNonprod("staging") {
		t.Fatal("nonprod and staging are in the pilot")
	}
	if err := costK8sPilotBindLimit([]costK8sBinding{{K8sConnectionID: 2, Environment: "nonprod"}}, 9); err == nil {
		t.Fatal("a second cluster is outside the one-cluster pilot")
	}
	if err := costK8sPilotBindLimit([]costK8sBinding{{K8sConnectionID: 2, Environment: "nonprod"}}, 2); err != nil {
		t.Fatal("rebinding the same cluster is allowed")
	}
}

func TestCostK8sPilotCollectorRestartIsUnknown(t *testing.T) {
	if costK8sCollectorHealthAfterRestart("healthy", nil) != "unknown" {
		t.Fatal("collector restart without ingest is Unknown, never Healthy")
	}
	if costK8sCollectorHealthAfterRestart("failed", nil) != "unknown" {
		t.Fatal("collector failure is Unknown, never Healthy")
	}
	recent := time.Now().UTC()
	if costK8sCollectorHealthAfterRestart("current", &recent) != "current" {
		t.Fatal("a current ingest after a successful upload stays Current")
	}
}

func TestCostK8sPilotWorkerCannotEditOrRestart(t *testing.T) {
	if costK8sWorkerActionAllowed("restart") || costK8sWorkerActionAllowed("scale") || costK8sWorkerActionAllowed("drain") {
		t.Fatal("the Cost worker cannot restart, scale, or drain")
	}
	if costK8sWorkerCanEditForAccess("write") {
		t.Fatal("Kubernetes write is not Cost edit")
	}
	overhead := costK8sPilotOverhead()
	if overhead["display"] != "Unknown" || overhead["status"] != "unknown" || overhead["installs_opencost"] != false {
		t.Fatalf("overhead stays Unknown and does not install OpenCost: %+v", overhead)
	}
	pilot := buildCostK8sPilot(&costK8sBinding{Environment: "nonprod", CollectorHealth: "failed"})
	restart, _ := pilot["restart"].(map[string]any)
	access, _ := pilot["access"].(map[string]any)
	if restart["collector_health"] != "unknown" || restart["workloads_restarted"] != false {
		t.Fatalf("restart check: %+v", restart)
	}
	if access["page_grant"] != "cost" || access["section"] != "cost" || access["worker_can_edit"] != false {
		t.Fatalf("access check: %+v", access)
	}
	if pageForPath("/api/cost/kubernetes/clusters") != "cost" {
		t.Fatal("pilot access stays on the cost grant")
	}
}

func TestCostTreeGroupsProjectThenCloudThenAccount(t *testing.T) {
	tree := groupCostTree([]costConnection{
		{ID: 1, ProjectID: 10, ProjectName: "Payments", ProjectCode: "PAY", Provider: "aws", DisplayName: "pay-prod", AccountID: "123456789012", Freshness: "current"},
		{ID: 2, ProjectID: 10, ProjectName: "Payments", ProjectCode: "PAY", Provider: "aws", DisplayName: "pay-logs", AccountID: "123456789013", Freshness: "current"},
		{ID: 3, ProjectID: 11, ProjectName: "Platform", ProjectCode: "PLT", Provider: "gcp", DisplayName: "plt-dev", AccountID: "222233334444", Freshness: "unknown"},
	}, []costLineRow{
		{AccountID: "123456789012", Service: "Amazon Elastic Compute Cloud", Actual: "100.000000", Currency: "USD", UsageDate: "2026-09-01"},
		{AccountID: "123456789013", Service: "Amazon Simple Storage Service", Actual: "12.500000", Currency: "USD", UsageDate: "2026-09-01"},
		{AccountID: "222233334444", Service: "Compute Engine", Actual: "8.000000", Currency: "USD", UsageDate: "2026-09-02"},
	}, "complete", "USD", "actual", map[int]bool{1: true})
	if len(tree) != 2 {
		t.Fatalf("projects = %d", len(tree))
	}
	payments, _ := tree[0]["name"].(string)
	if payments != "Payments" {
		t.Fatalf("first project = %v", tree[0]["name"])
	}
	clouds, _ := tree[0]["clouds"].([]map[string]any)
	if len(clouds) != 1 || clouds[0]["provider"] != "AWS" {
		t.Fatalf("payments clouds = %+v", clouds)
	}
	accounts, _ := clouds[0]["accounts"].([]map[string]any)
	if len(accounts) != 2 {
		t.Fatalf("payments accounts = %d", len(accounts))
	}
	if accounts[0]["display_name"] != "pay-logs" || accounts[1]["display_name"] != "pay-prod" {
		t.Fatalf("accounts sort = %+v", accounts)
	}
	href, _ := accounts[1]["href"].(string)
	if href != "/cost/accounts/1" {
		t.Fatalf("account href = %s", href)
	}
}

func TestCostProjectRBACDropsUnassignedAndForeign(t *testing.T) {
	filtered := filterCostConnectionsByProject([]costConnection{
		{ID: 1, ProjectID: 10, DisplayName: "mine"},
		{ID: 2, ProjectID: 0, DisplayName: "unassigned"},
		{ID: 3, ProjectID: 99, DisplayName: "foreign"},
	}, map[int]struct{}{10: {}})
	if len(filtered) != 1 || filtered[0].ID != 1 {
		t.Fatalf("project RBAC leaked: %+v", filtered)
	}
}

func TestCostIncompleteGraphIsEmpty(t *testing.T) {
	lines := []costLineRow{{AccountID: "123456789012", Service: "Amazon Elastic Compute Cloud", Actual: "100.000000", Currency: "USD", UsageDate: "2026-09-01"}}
	if len(costServiceSeries(lines, "incomplete", "USD", "actual")) != 0 {
		t.Fatal("incomplete mix must stay empty, never a fake $0 bar")
	}
	if len(costDaySeries(lines, "none", "USD", "actual")) != 0 {
		t.Fatal("missing coverage must not graph as zero")
	}
	mix := costServiceSeries(lines, "complete", "USD", "actual")
	if len(mix) != 1 || mix[0].Label != "Compute" || mix[0].Percent != 100 {
		t.Fatalf("complete mix = %+v", mix)
	}
}

func TestCostDashboardSuggestionsOmitAccountAndResource(t *testing.T) {
	out := costDashboardSuggestions([]costRecommendation{{
		CalcID:         "CALC-COST-AAAA1111",
		AccountID:      "123456789012",
		ResourceID:     "i-0costc2api01",
		Service:        "Amazon Elastic Compute Cloud",
		FindingType:    "idle",
		SavingsHigh:    costMoneyView("complete", "10.000000", "USD", "actual"),
		ProposedAction: "Review idle compute",
	}}, "123456789012")
	raw, _ := json.Marshal(out)
	blob := string(raw)
	if strings.Contains(blob, "123456789012") || strings.Contains(blob, "i-0costc2api01") {
		t.Fatalf("dashboard suggestions leaked identity: %s", blob)
	}
	if !strings.Contains(blob, "CALC-COST-AAAA1111") {
		t.Fatal("CALC-COST IDs stay on the dashboard")
	}
}

func TestCostAIRedactsAccountRolePassword(t *testing.T) {
	got := redactSensitiveForAI("account 123456789012 role_arn=arn:aws:iam::123456789012:role/CostReader password=hunter2 token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb email=ops@example.com resource i-0costc2api01")
	for _, leak := range []string{"123456789012", "CostReader", "hunter2", "ops@example.com", "i-0costc2api01", "eyJ"} {
		if strings.Contains(got, leak) {
			t.Fatalf("redaction missed %s in %s", leak, got)
		}
	}
}

func TestCostCopilotModelPayloadOmitsSecrets(t *testing.T) {
	content := copilotModelUserContent(copilotRequest{
		Query:  "Why is account 123456789012 expensive? password=s3cret role_arn=arn:aws:iam::123456789012:role/Billing",
		Path:   "/cost/accounts/1",
		Title:  "Account spend",
		Portal: "devops",
		Context: map[string]interface{}{
			"account_id": "123456789012",
			"role_arn":   "arn:aws:iam::123456789012:role/Billing",
			"password":   "s3cret",
			"citations": []any{map[string]any{
				"number":  "CALC-COST-AABBCCDD",
				"service": "i-0costc2api01",
				"title":   "rightsizing",
			}},
		},
	})
	for _, leak := range []string{"123456789012", "s3cret", "Billing", "i-0costc2api01", "role_arn", "password"} {
		if strings.Contains(content, leak) {
			t.Fatalf("model payload leaked %s: %s", leak, content)
		}
	}
	if !strings.Contains(content, "CALC-COST-AABBCCDD") {
		t.Fatal("CALC-COST IDs must still reach the model")
	}
}

func TestCostInsightSourcesDoNotSendResourceIDs(t *testing.T) {
	source := costAISafeSource(costCalculation{
		CalcID:     "CALC-COST-DEADBEEF",
		Kind:       "rightsizing",
		ResourceID: "i-0costc2api01",
		Coverage:   "complete",
		Amount:     "10.000000",
		Note:       "account 123456789012 role_arn=arn:aws:iam::123456789012:role/CostReader",
	})
	if costAISafeSourceLeaks(source) {
		t.Fatalf("safe source still looks sensitive: %+v", source)
	}
	blob := source.Service + " " + source.Body + " " + source.Title
	if strings.Contains(blob, "i-0") || strings.Contains(blob, "123456789012") || strings.Contains(blob, "CostReader") {
		t.Fatalf("AI source leaked identity: %s", blob)
	}
	if !strings.Contains(source.Body, "CALC-COST-DEADBEEF") {
		t.Fatal("AI source must keep the calculation ID")
	}
}

func TestCostAccessViewIsBelowOperate(t *testing.T) {
	if normalizeCostAccess("view") != "view" {
		t.Fatal("view stays view")
	}
	if normalizeCostAccess("none") != "operate" || normalizeCostAccess("") != "operate" {
		t.Fatal("Cost has no none role; existing members keep operate")
	}
	if costAccessRank("view") >= costAccessRank("operate") {
		t.Fatal("operate outranks view")
	}
	if userCanOperateCost(0, 1) {
		t.Fatal("anonymous is not Cost operate")
	}
	if errCostOperateRequired == nil || !strings.Contains(errCostOperateRequired.Error(), "operate") {
		t.Fatal("operate denial must stay explicit")
	}
}

func TestCostNonAWSTreeRowIsNotImported(t *testing.T) {
	conn := costConnection{Provider: "gcp", DisplayName: "plt-dev", CloudAccountID: 9, AccountID: "222233334444"}
	if costImportStatus(conn) != "not_imported" {
		t.Fatal("unenabled GCP stays Not imported")
	}
	if costAccountHref(conn) != "/cost/cloud/9" {
		t.Fatalf("cloud href = %s", costAccountHref(conn))
	}
	sources := costImportableSources(conn, false)
	if len(sources) != 1 || sources[0]["status"] != "not_imported" {
		t.Fatalf("non-AWS importable = %+v", sources)
	}
	view := costTreeAccountView(conn, costMoneyView("none", "", "USD", "actual"), false)
	if _, ok := view["account_id"]; ok {
		t.Fatal("tree JSON must not include account_id")
	}
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "222233334444") {
		t.Fatalf("tree leaked a cloud account number: %s", raw)
	}
}

func TestCostEnvironmentNeverInferredFromName(t *testing.T) {
	if costEnvironmentDisplay(nil) != "Unknown" {
		t.Fatal("empty environments stay Unknown")
	}
	if costEnvironmentDisplay([]string{}) != "Unknown" {
		t.Fatal("blank environments stay Unknown")
	}
	conn := costConnection{DisplayName: "pay-prod"}
	if costEnvironmentDisplay(conn.Environments) == "prod" || strings.Contains(strings.ToLower(costEnvironmentDisplay(conn.Environments)), "prod") {
		t.Fatal("must not infer environment from the display name")
	}
	if costEnvironmentDisplay([]string{"nonprod"}) != "nonprod" {
		t.Fatal("stored environment is shown as stored")
	}
}

func TestCostStaleHintLinksImportWithoutAutoImport(t *testing.T) {
	if costStaleHint("current") != nil || costStaleHint("unknown") != nil {
		t.Fatal("only stale freshness shows a hint")
	}
	hint := costStaleHint("stale")
	if hint["href"] != "/cost/configuration" || hint["status"] != "stale" {
		t.Fatalf("stale hint = %+v", hint)
	}
}

func TestCostWindowCompareIncompleteIsUnknown(t *testing.T) {
	current := costMoneyView("incomplete", "100.000000", "USD", "actual")
	prior := costMoneyView("complete", "80.000000", "USD", "actual")
	got := costWindowCompare(current, prior, "2026-08-01", "2026-08-31", "complete")
	if got["like_for_like"] != false {
		t.Fatal("incomplete cannot be like-for-like")
	}
	delta, _ := got["delta"].(map[string]any)
	if delta["display"] != "Unknown" || delta["amount"] != nil {
		t.Fatalf("incomplete compare delta = %+v", delta)
	}
}

func TestCostAIProofStoresCountsNotSecrets(t *testing.T) {
	proof := costAIProofFromRequest(copilotRequest{
		Query: "Why is account 123456789012 expensive? password=s3cret",
		Path:  "/cost/accounts/1",
		Title: "Account spend",
		Context: map[string]interface{}{
			"account_id": "123456789012",
			"password":   "s3cret",
			"role_arn":   "arn:aws:iam::123456789012:role/Billing",
		},
	})
	if !proof.CostPath {
		t.Fatal("Cost pages must record a proof")
	}
	if proof.Status != "blocked" {
		t.Fatalf("secrets must mark the proof blocked, got %s", proof.Status)
	}
	if proof.DroppedKeyCount == 0 && proof.RedactedCount == 0 {
		t.Fatal("proof must record a dropped key or redaction")
	}
	raw, _ := json.Marshal(proof)
	blob := string(raw)
	for _, leak := range []string{"123456789012", "s3cret", "Billing", "password", "role_arn", "account_id"} {
		if strings.Contains(blob, leak) {
			t.Fatalf("proof stored %s: %s", leak, blob)
		}
	}
	summary := costAIProofSummary([]costAIProof{proof})
	note, _ := summary["note"].(string)
	if !strings.Contains(note, "never saved") {
		t.Fatalf("summary note = %s", note)
	}
	sumRaw, _ := json.Marshal(summary)
	if strings.Contains(string(sumRaw), "123456789012") || strings.Contains(string(sumRaw), "s3cret") {
		t.Fatalf("summary leaked secrets: %s", sumRaw)
	}
}

func TestCostAccountExportHrefOmitsAccountNumber(t *testing.T) {
	conn := costConnection{ID: 7, AccountID: "123456789012"}
	href := fmt.Sprintf("/api/cost/connections/%d/export", conn.ID)
	if href != "/api/cost/connections/7/export" {
		t.Fatalf("export href = %s", href)
	}
	if strings.Contains(href, conn.AccountID) || strings.Contains(href, "account=") {
		t.Fatal("CSV must not put the account number in the URL")
	}
	if pageForPath(href) != "cost" {
		t.Fatal("CSV export stays on the cost page grant")
	}
}

func TestFilterAllocatedCostLinesFamilyAndUnallocated(t *testing.T) {
	lines := []costLineRow{
		{Service: "Amazon Elastic Compute Cloud", TeamSlug: "platform-team", Actual: "10.000000"},
		{Service: "Amazon Simple Storage Service", TeamSlug: "", Actual: "4.000000"},
		{Service: "Amazon Relational Database Service", TeamSlug: "data-team", Actual: "8.000000"},
	}
	compute := filterAllocatedCostLines(lines, costLineQuery{Family: "Compute"})
	if len(compute) != 1 || compute[0].Service != "Amazon Elastic Compute Cloud" {
		t.Fatalf("compute family = %+v", compute)
	}
	unallocated := filterAllocatedCostLines(lines, costLineQuery{Team: "unallocated"})
	if len(unallocated) != 1 || strings.TrimSpace(unallocated[0].TeamSlug) != "" {
		t.Fatalf("unallocated = %+v", unallocated)
	}
}
