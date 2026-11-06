package main

import (
	"fmt"
	"strconv"
	"strings"
)

type costReviewAction struct {
	Action       string
	ChangeNumber string
	Reason       string
	ReviewBy     string
	Confounders  string
	Result       string
}

type costVerificationResult struct {
	Outcome             string
	AllocationReduction map[string]any
	BillReduction       map[string]any
	CostAvoidance       map[string]any
	Confounders         string
	Note                string
}

func costNormalizeLifecycle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "new":
		return "detected"
	case "investigating", "reviewing":
		return "under_review"
	case "approved":
		return "accepted"
	case "under_review", "accepted", "change_linked", "implemented", "measuring", "verified", "inconclusive", "regressed", "dismissed", "blocked":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "detected"
	}
}

func countCostWaiting(recs []costRecommendation) int {
	count := 0
	for _, rec := range recs {
		if strings.TrimSpace(rec.WaitingFor) != "" {
			count++
		}
	}
	return count
}

func costWaitingFor(lifecycle string) string {
	switch costNormalizeLifecycle(lifecycle) {
	case "under_review":
		return "Waiting for approval"
	case "accepted":
		return "Waiting for a linked change"
	case "change_linked":
		return "Waiting to record implementation"
	case "implemented", "measuring":
		return "Waiting for a complete comparison window"
	default:
		return ""
	}
}

func parseCostChangeID(raw string) (int, error) {
	value := strings.ToUpper(strings.TrimSpace(raw))
	if strings.Contains(value, "@") {
		return 0, fmt.Errorf("change reference cannot include an email")
	}
	if value == "" {
		return 0, fmt.Errorf("change number is required")
	}
	value = strings.TrimPrefix(value, "CHG")
	value = strings.TrimLeft(value, "0")
	if value == "" {
		return 0, fmt.Errorf("unknown change")
	}
	id, err := strconv.Atoi(value)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("unknown change")
	}
	return id, nil
}

func lookupCostLinkedChange(raw string) (int, string, error) {
	id, err := parseCostChangeID(raw)
	if err != nil {
		return 0, "", err
	}
	item, err := getChangeRequestByID(id)
	if err != nil || item == nil {
		return 0, "", fmt.Errorf("change not found")
	}
	return item.ID, firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)), nil
}

func transitionCostReview(rec costRecommendation, action costReviewAction) (costRecommendation, error) {
	actionName := strings.ToLower(strings.TrimSpace(action.Action))
	lifecycle := costNormalizeLifecycle(rec.Lifecycle)
	if lifecycle == "" || lifecycle == "detected" {
		if rec.Status == "blocked" && actionName != "dismiss" {
			return rec, fmt.Errorf("blocked recommendations cannot be accepted")
		}
		if rec.Lifecycle == "" {
			lifecycle = rec.Status
			if lifecycle != "blocked" {
				lifecycle = "detected"
			}
		}
	}
	if rec.Status == "blocked" && (actionName == "accept" || actionName == "link" || actionName == "implement" || actionName == "verify" || actionName == "measure") {
		return rec, fmt.Errorf("blocked recommendations cannot be accepted")
	}
	rec.Executes = false
	rec.PausesWorkloads = false
	switch actionName {
	case "review":
		if lifecycle != "detected" && lifecycle != "under_review" {
			return rec, fmt.Errorf("this recommendation is past review")
		}
		rec.Lifecycle = "under_review"
		rec.Status = "under_review"
	case "accept":
		if lifecycle != "detected" && lifecycle != "under_review" && lifecycle != "accepted" {
			return rec, fmt.Errorf("this recommendation cannot be accepted")
		}
		rec.Lifecycle = "accepted"
		rec.Status = "accepted"
		rec.Note = "Accepted for review. This is not permission to change infrastructure."
	case "dismiss":
		reason := strings.TrimSpace(action.Reason)
		if strings.Contains(reason, "@") || strings.Contains(action.ReviewBy, "@") {
			return rec, fmt.Errorf("dismissal cannot include an email")
		}
		if reason == "" || strings.TrimSpace(action.ReviewBy) == "" {
			return rec, fmt.Errorf("dismissal needs a reason and a review date")
		}
		if _, err := costParseDate(action.ReviewBy); err != nil {
			return rec, fmt.Errorf("review date must be YYYY-MM-DD")
		}
		rec.Lifecycle = "dismissed"
		rec.Status = "dismissed"
		rec.DismissReason = reason
		rec.ReviewBy = strings.TrimSpace(action.ReviewBy)
	case "link":
		if lifecycle != "accepted" && lifecycle != "change_linked" && lifecycle != "implemented" {
			return rec, fmt.Errorf("accept the recommendation before linking a change")
		}
		id, number, err := lookupCostLinkedChange(action.ChangeNumber)
		if err != nil {
			return rec, err
		}
		rec.ChangeID = id
		rec.ChangeNumber = number
		rec.ChangeHref = "/changes/" + strconv.Itoa(id)
		rec.Lifecycle = "change_linked"
		rec.Status = "change_linked"
		rec.Note = "Linked to " + number + ". Existing CHG approvals govern the change. This product will not apply it."
	case "implement":
		if lifecycle != "change_linked" && lifecycle != "implemented" {
			return rec, fmt.Errorf("link a change before recording implementation")
		}
		rec.Lifecycle = "implemented"
		rec.Status = "implemented"
		rec.Note = "Recorded as implemented. This product did not apply the change. Measured savings stay separate from the estimate."
	case "measure", "verify":
		if rec.ChangeID <= 0 {
			return rec, fmt.Errorf("link a change before measuring savings")
		}
		result := evaluateCostVerification(action.Result, rec.BillReduction, rec.AllocationReduction, rec.CostAvoidance, action.Confounders)
		rec.Lifecycle = result.Outcome
		rec.Status = result.Outcome
		rec.Verification = result.Outcome
		rec.AllocationReduction = result.AllocationReduction
		rec.BillReduction = result.BillReduction
		rec.CostAvoidance = result.CostAvoidance
		rec.Confounders = result.Confounders
		rec.Note = result.Note
	default:
		return rec, fmt.Errorf("unknown review action")
	}
	rec.WaitingFor = costWaitingFor(rec.Lifecycle)
	rec.Executes = false
	rec.PausesWorkloads = false
	return rec, nil
}

func evaluateCostVerification(requested string, bill, allocation, avoidance map[string]any, confounders string) costVerificationResult {
	requested = strings.ToLower(strings.TrimSpace(requested))
	confounders = strings.TrimSpace(confounders)
	if strings.Contains(confounders, "@") {
		confounders = ""
	}
	unknown := func() map[string]any {
		return costMoneyView("incomplete", "", "USD", "actual")
	}
	result := costVerificationResult{
		Outcome:             "inconclusive",
		AllocationReduction: unknown(),
		BillReduction:       unknown(),
		CostAvoidance:       unknown(),
		Confounders:         confounders,
		Note:                "Verification can be Inconclusive. Allocation reduction, bill reduction, and cost avoidance stay separate and are not summed.",
	}
	if requested == "verified" {
		if _, ok := completeCostAmount(bill); !ok {
			requested = "inconclusive"
		}
	}
	switch requested {
	case "verified", "inconclusive", "regressed":
		result.Outcome = requested
	default:
		if confounders != "" {
			result.Outcome = "inconclusive"
			result.Note = "Confounders were recorded, so this stays Inconclusive. A before/after spend change is not a causal claim."
		} else {
			billAmount, billOK := completeCostAmount(bill)
			if !billOK {
				result.Outcome = "inconclusive"
				result.Note = "Comparable complete windows are missing, so verification is Inconclusive. Incomplete coverage stays Unknown, never $0 saved."
				return result
			}
			if strings.HasPrefix(billAmount, "-") && billAmount != "0."+strings.Repeat("0", costMoneyScale) {
				result.Outcome = "regressed"
				result.BillReduction = bill
				result.Note = "Observed bill increased versus the baseline window. Negative savings are retained. This is not a causal claim."
			} else if billAmount == "0."+strings.Repeat("0", costMoneyScale) {
				result.Outcome = "inconclusive"
				result.BillReduction = bill
			} else {
				result.Outcome = "verified"
				result.BillReduction = bill
				result.Note = "Observed bill reduction versus the baseline window. Allocation reduction and cost avoidance stay Unknown unless measured separately."
			}
		}
	}
	if result.Outcome == "verified" || result.Outcome == "regressed" {
		if amount, ok := completeCostAmount(bill); ok {
			result.BillReduction = costMoneyView("complete", amount, "USD", "actual")
		}
		if amount, ok := completeCostAmount(allocation); ok {
			result.AllocationReduction = costMoneyView("complete", amount, "USD", "actual")
		}
		if amount, ok := completeCostAmount(avoidance); ok {
			result.CostAvoidance = costMoneyView("complete", amount, "USD", "actual")
		}
	}
	if result.Outcome == "inconclusive" {
		result.AllocationReduction = unknown()
		result.BillReduction = unknown()
		result.CostAvoidance = unknown()
	}
	return result
}

func observeResourceBillDelta(current, prior *costWindowSlice, resourceID, currency, basis string) map[string]any {
	if current == nil || prior == nil || current.Coverage != "complete" || prior.Coverage != "complete" {
		return costMoneyView("incomplete", "", currency, basis)
	}
	currentAmt, currentOK := resourceAmount(current.Lines, resourceID, basis)
	priorAmt, priorOK := resourceAmount(prior.Lines, resourceID, basis)
	if !currentOK || !priorOK {
		return costMoneyView("incomplete", "", currency, basis)
	}
	return costMoneyView("complete", subCostAmounts(priorAmt, currentAmt), currency, basis)
}

func resourceAmount(lines []costLineRow, resourceID, basis string) (string, bool) {
	want := strings.ToLower(strings.TrimSpace(resourceID))
	found := false
	total := "0." + strings.Repeat("0", costMoneyScale)
	for _, line := range lines {
		if strings.ToLower(strings.TrimSpace(line.ResourceID)) != want {
			continue
		}
		found = true
		amount := line.Amount
		if amount == "" {
			if normalizeCostBasis(basis) == "amortized" {
				amount = line.Amortized
			} else {
				amount = line.Actual
			}
		}
		total = addCostAmounts(total, amount)
	}
	return total, found
}

func overlayCostReviews(recs []costRecommendation) ([]costRecommendation, error) {
	reviews, err := listCostReviews()
	if err != nil {
		return recs, err
	}
	byCalc := map[string]costRecommendation{}
	for _, review := range reviews {
		byCalc[strings.ToUpper(review.CalcID)] = review
	}
	for i, rec := range recs {
		stored, ok := byCalc[strings.ToUpper(rec.CalcID)]
		if !ok {
			rec.Lifecycle = rec.Status
			if rec.Lifecycle == "" {
				rec.Lifecycle = "detected"
			}
			rec.WaitingFor = costWaitingFor(rec.Lifecycle)
			recs[i] = rec
			continue
		}
		if rec.Status == "blocked" && stored.Lifecycle != "dismissed" {
			rec.Lifecycle = "blocked"
			rec.WaitingFor = ""
			rec.ChangeID = stored.ChangeID
			rec.ChangeNumber = stored.ChangeNumber
			rec.ChangeHref = stored.ChangeHref
			recs[i] = rec
			continue
		}
		stored.SavingsLow = rec.SavingsLow
		stored.SavingsHigh = rec.SavingsHigh
		stored.FindingType = rec.FindingType
		stored.Impact = rec.Impact
		stored.Risk = rec.Risk
		stored.Effort = rec.Effort
		stored.Confidence = rec.Confidence
		stored.Evidence = rec.Evidence
		stored.Calculation = rec.Calculation
		stored.ProposedAction = rec.ProposedAction
		stored.MetricsReady = rec.MetricsReady
		stored.HasUtilization = rec.HasUtilization
		stored.BlockedReason = rec.BlockedReason
		stored.GroupID = rec.GroupID
		stored.ResourceID = rec.ResourceID
		stored.Service = rec.Service
		stored.AccountID = rec.AccountID
		stored.Executes = false
		stored.PausesWorkloads = false
		if stored.Status == "" {
			stored.Status = stored.Lifecycle
		}
		stored.WaitingFor = costWaitingFor(stored.Lifecycle)
		recs[i] = stored
		delete(byCalc, strings.ToUpper(rec.CalcID))
	}
	return recs, nil
}

func listCostReviews() ([]costRecommendation, error) {
	if DB == nil {
		return []costRecommendation{}, nil
	}
	rows, err := DB.Query(`
		SELECT calc_id, group_id, resource_id, lifecycle, change_id, change_number,
		       dismiss_reason, COALESCE(to_char(review_by, 'YYYY-MM-DD'), ''),
		       COALESCE(allocation_reduction::text, ''), COALESCE(bill_reduction::text, ''),
		       COALESCE(cost_avoidance::text, ''), verification, confounders, note
		  FROM cost_recommendation_reviews
		 ORDER BY updated_at DESC
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_recommendation_reviews") {
			return []costRecommendation{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costRecommendation{}
	for rows.Next() {
		var rec costRecommendation
		var alloc, bill, avoid string
		if err := rows.Scan(&rec.CalcID, &rec.GroupID, &rec.ResourceID, &rec.Lifecycle, &rec.ChangeID, &rec.ChangeNumber,
			&rec.DismissReason, &rec.ReviewBy, &alloc, &bill, &avoid, &rec.Verification, &rec.Confounders, &rec.Note); err != nil {
			return nil, err
		}
		rec.Lifecycle = costNormalizeLifecycle(rec.Lifecycle)
		rec.Status = rec.Lifecycle
		rec.Executes = false
		rec.PausesWorkloads = false
		if rec.ChangeID > 0 {
			rec.ChangeHref = "/changes/" + strconv.Itoa(rec.ChangeID)
		}
		rec.AllocationReduction = moneyOrUnknown(alloc)
		rec.BillReduction = moneyOrUnknown(bill)
		rec.CostAvoidance = moneyOrUnknown(avoid)
		rec.WaitingFor = costWaitingFor(rec.Lifecycle)
		out = append(out, rec)
	}
	return out, nil
}

func moneyOrUnknown(amount string) map[string]any {
	amount = strings.TrimSpace(amount)
	if amount == "" {
		return costMoneyView("incomplete", "", "USD", "actual")
	}
	return costMoneyView("complete", amount, "USD", "actual")
}

func saveCostReview(userID int, rec costRecommendation) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	alloc, _ := completeCostAmount(rec.AllocationReduction)
	bill, _ := completeCostAmount(rec.BillReduction)
	avoid, _ := completeCostAmount(rec.CostAvoidance)
	var reviewBy interface{}
	if strings.TrimSpace(rec.ReviewBy) != "" {
		if parsed, err := costParseDate(rec.ReviewBy); err == nil {
			reviewBy = parsed
		}
	}
	_, err := DB.Exec(`
		INSERT INTO cost_recommendation_reviews (
			calc_id, group_id, resource_id, lifecycle, change_id, change_number,
			dismiss_reason, review_by, allocation_reduction, bill_reduction, cost_avoidance,
			verification, confounders, note, created_by, updated_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP
		)
		ON CONFLICT (calc_id) DO UPDATE SET
			group_id = EXCLUDED.group_id,
			resource_id = EXCLUDED.resource_id,
			lifecycle = EXCLUDED.lifecycle,
			change_id = EXCLUDED.change_id,
			change_number = EXCLUDED.change_number,
			dismiss_reason = EXCLUDED.dismiss_reason,
			review_by = EXCLUDED.review_by,
			allocation_reduction = EXCLUDED.allocation_reduction,
			bill_reduction = EXCLUDED.bill_reduction,
			cost_avoidance = EXCLUDED.cost_avoidance,
			verification = EXCLUDED.verification,
			confounders = EXCLUDED.confounders,
			note = EXCLUDED.note,
			updated_at = CURRENT_TIMESTAMP
	`, rec.CalcID, rec.GroupID, rec.ResourceID, costNormalizeLifecycle(rec.Lifecycle), rec.ChangeID, rec.ChangeNumber,
		rec.DismissReason, reviewBy, nullCostAmount(alloc), nullCostAmount(bill), nullCostAmount(avoid),
		rec.Verification, rec.Confounders, rec.Note, userID)
	return err
}

func nullCostAmount(amount string) interface{} {
	if strings.TrimSpace(amount) == "" {
		return nil
	}
	return amount
}

func applyCostReviewAction(userID int, rec costRecommendation, action costReviewAction, current, prior *costWindowSlice) (costRecommendation, error) {
	if strings.EqualFold(action.Action, "verify") || strings.EqualFold(action.Action, "measure") {
		observed := observeResourceBillDelta(current, prior, rec.ResourceID, "USD", "actual")
		action.Result = strings.TrimSpace(action.Result)
		if action.Result == "" && strings.TrimSpace(action.Confounders) == "" {
			if _, ok := completeCostAmount(observed); !ok {
				action.Result = "inconclusive"
			}
		}
		rec.BillReduction = observed
	}
	next, err := transitionCostReview(rec, action)
	if err != nil {
		return rec, err
	}
	if err := saveCostReview(userID, next); err != nil {
		return rec, err
	}
	return next, nil
}

func costReviewByCalc(calcID string) (*costRecommendation, error) {
	reviews, err := listCostReviews()
	if err != nil {
		return nil, err
	}
	want := strings.ToUpper(strings.TrimSpace(calcID))
	for i := range reviews {
		if strings.ToUpper(reviews[i].CalcID) == want {
			return &reviews[i], nil
		}
	}
	return nil, nil
}

func buildCostSavings(userID int, basis, currency, fromRaw, toRaw string) (map[string]any, error) {
	insights, err := buildCostInsights(userID, basis, currency, fromRaw, toRaw, costMetricsContext{})
	if err != nil {
		return nil, err
	}
	reviews, err := listCostReviews()
	if err != nil {
		return nil, err
	}
	waiting := []costRecommendation{}
	for _, rec := range insights.Recommendations {
		if strings.TrimSpace(rec.WaitingFor) != "" {
			waiting = append(waiting, rec)
		}
	}
	verified := []costRecommendation{}
	for _, rec := range reviews {
		if rec.Lifecycle == "verified" || rec.Lifecycle == "inconclusive" || rec.Lifecycle == "regressed" {
			verified = append(verified, rec)
		}
	}
	groups := []costOpportunityGroup{}
	for _, rec := range verified {
		if rec.Lifecycle != "verified" {
			continue
		}
		groups = append(groups, costOpportunityGroup{
			GroupID:    firstNonEmpty(rec.GroupID, rec.ResourceID),
			ResourceID: rec.ResourceID,
			CalcIDs:    []string{rec.CalcID},
			Savings:    rec.BillReduction,
			Note:       "Verified bill reduction only. Allocation reduction and cost avoidance are not added here.",
		})
	}
	capped := map[string]costOpportunityGroup{}
	for _, group := range groups {
		existing, ok := capped[group.GroupID]
		if !ok {
			capped[group.GroupID] = group
			continue
		}
		existing.CalcIDs = append(existing.CalcIDs, group.CalcIDs...)
		existing.Savings = capGroupSavings(existing.Savings, group.Savings, currency, basis)
		capped[group.GroupID] = existing
	}
	cappedList := []costOpportunityGroup{}
	for _, group := range capped {
		cappedList = append(cappedList, group)
	}
	return map[string]any{
		"status":                  "ok",
		"basis":                   basis,
		"currency":                currency,
		"waiting":                 waiting,
		"outcomes":                verified,
		"estimated_savings":       insights.NonOverlapping,
		"verified_bill_reduction": sumNonOverlappingSavings(cappedList, currency, basis),
		"released_capacity": map[string]any{
			"display":  "Unknown",
			"coverage": "incomplete",
			"note":     "Released capacity is a Kubernetes estimate and is never added to verified bill reduction.",
		},
		"pauses_workloads": false,
		"executes":         false,
		"note":             "Acceptance is not permission to execute. Verification can be Inconclusive. Overlapping verified savings on one resource count once. Estimated savings, verified bill reduction, and released capacity stay separate.",
	}, nil
}
