package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func costAPIHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/cost/"), "/")
	parts := strings.Split(rest, "/")
	if rest == "" || parts[0] == "" {
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
		return
	}
	switch parts[0] {
	case "overview":
		serveCostOverview(w, r, userID)
	case "tree":
		serveCostTree(w, r, userID)
	case "projects":
		serveCostProjects(w, r, userID, parts[1:])
	case "cloud-accounts":
		serveCostCloudAccounts(w, r, userID, parts[1:])
	case "ai-proof":
		serveCostAIProof(w, r, userID)
	case "explorer":
		serveCostExplorer(w, r, userID)
	case "export":
		serveCostExport(w, r, userID)
	case "service":
		serveCostService(w, r, userID)
	case "allocation-rules":
		serveCostAllocationRules(w, r, userID, parts[1:])
	case "budgets":
		serveCostBudgets(w, r, userID, parts[1:])
	case "anomalies":
		serveCostAnomalies(w, r, userID)
	case "recommendations":
		serveCostRecommendations(w, r, userID, parts[1:])
	case "savings":
		serveCostSavings(w, r, userID)
	case "calculations":
		serveCostCalculations(w, r, userID, parts[1:])
	case "configuration":
		serveCostConfiguration(w, r, userID)
	case "connections":
		serveCostConnections(w, r, userID, parts[1:])
	case "kubernetes":
		serveCostKubernetes(w, r, userID, parts[1:])
	default:
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
	}
}

func costQueryFromRequest(r *http.Request) (basis, currency, fromRaw, toRaw string, filter costLineQuery) {
	q := r.URL.Query()
	return q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"), costLineQuery{
		Service:       q.Get("service"),
		Region:        q.Get("region"),
		Account:       q.Get("account"),
		Team:          q.Get("team"),
		PortalService: q.Get("portal_service"),
	}
}

func serveCostOverview(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	q := r.URL.Query()
	payload, err := buildCostOverview(userID, q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost overview could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostTree(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	q := r.URL.Query()
	payload, err := buildCostTree(userID, q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost tree could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostAccountDashboard(w http.ResponseWriter, r *http.Request, userID, id int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	q := r.URL.Query()
	payload, err := buildCostAccountDashboard(userID, id, q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost account not found.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostProjects(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	if len(parts) == 0 {
		serveCostTree(w, r, userID)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown Cost project.", nil)
		return
	}
	q := r.URL.Query()
	payload, dashErr := buildCostProjectDashboard(userID, id, q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if dashErr != nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost project not found.", dashErr)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostCloudAccounts(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	if len(parts) < 2 || parts[1] != "dashboard" {
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown cloud account.", nil)
		return
	}
	q := r.URL.Query()
	payload, dashErr := buildCostCloudDashboard(userID, id, q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if dashErr != nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost account not found.", dashErr)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostAIProof(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, costAIProofSummary(listCostAIProofs(userID)))
}

func serveCostAccountExport(w http.ResponseWriter, r *http.Request, userID, id int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	conn, err := getCostConnection(userID, id)
	if err != nil || conn == nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost connection not found.", err)
		return
	}
	basis, currency, fromRaw, toRaw, _ := costQueryFromRequest(r)
	body, csvErr := buildCostExplorerCSV(userID, basis, currency, fromRaw, toRaw, costLineQuery{Account: conn.AccountID})
	if csvErr != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost export could not be loaded.", csvErr)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="cost-account.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

func serveCostExplorer(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	basis, currency, fromRaw, toRaw, filter := costQueryFromRequest(r)
	payload, err := buildCostExplorer(userID, basis, currency, fromRaw, toRaw, filter)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost explorer could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostExport(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	basis, currency, fromRaw, toRaw, filter := costQueryFromRequest(r)
	body, err := buildCostExplorerCSV(userID, basis, currency, fromRaw, toRaw, filter)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost export could not be loaded.", err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="cost-explorer.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

func serveCostService(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	q := r.URL.Query()
	payload, err := buildCostServiceStrip(userID, q.Get("name"), q.Get("basis"), q.Get("currency"), q.Get("from"), q.Get("to"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Service cost could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostAllocationRules(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			rules, err := listCostAllocationRules()
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Allocation rules could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "rules": rules})
		case http.MethodPost:
			if !userHasCostOperateAnywhere(userID) {
				writeCostOperateDenied(w, r)
				return
			}
			var body struct {
				MatchType   string `json:"match_type"`
				MatchValue  string `json:"match_value"`
				TeamSlug    string `json:"team_slug"`
				ServiceName string `json:"service_name"`
				Priority    int    `json:"priority"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			rule, err := createCostAllocationRule(userID, body.MatchType, body.MatchValue, body.TeamSlug, body.ServiceName, body.Priority)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			AppendAuditLog(&userID, "cost_allocation_rule_create", "cost_allocation_rule", strconv.Itoa(rule.ID), rule.MatchType)
			writeJSON(w, http.StatusCreated, map[string]any{"status": "ok", "rule": rule})
		default:
			writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		}
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown allocation rule.", nil)
		return
	}
	if r.Method != http.MethodDelete {
		writeMethodNotAllowed(w, r, http.MethodDelete)
		return
	}
	if !userHasCostOperateAnywhere(userID) {
		writeCostOperateDenied(w, r)
		return
	}
	if err := deleteCostAllocationRule(id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Allocation rule could not be removed.", err)
		return
	}
	AppendAuditLog(&userID, "cost_allocation_rule_delete", "cost_allocation_rule", strconv.Itoa(id), "")
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func serveCostBudgets(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			basis, currency, fromRaw, toRaw, _ := costQueryFromRequest(r)
			payload, err := buildCostBudgets(userID, basis, currency, fromRaw, toRaw)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Cost budgets could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, payload)
		case http.MethodPost:
			if !userHasCostOperateAnywhere(userID) {
				writeCostOperateDenied(w, r)
				return
			}
			var body struct {
				Name       string `json:"name"`
				ScopeType  string `json:"scope_type"`
				ScopeValue string `json:"scope_value"`
				Amount     string `json:"amount"`
				Currency   string `json:"currency"`
				Basis      string `json:"basis"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			budget, err := createCostBudget(userID, body.Name, body.ScopeType, body.ScopeValue, body.Amount, body.Currency, body.Basis)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			AppendAuditLog(&userID, "cost_budget_create", "cost_budget", strconv.Itoa(budget.ID), budget.ScopeType)
			writeJSON(w, http.StatusCreated, map[string]any{"status": "ok", "budget": budget, "pauses_workloads": false})
		default:
			writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		}
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown budget.", nil)
		return
	}
	if r.Method != http.MethodDelete {
		writeMethodNotAllowed(w, r, http.MethodDelete)
		return
	}
	if !userHasCostOperateAnywhere(userID) {
		writeCostOperateDenied(w, r)
		return
	}
	if err := deleteCostBudget(id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Budget could not be removed.", err)
		return
	}
	AppendAuditLog(&userID, "cost_budget_delete", "cost_budget", strconv.Itoa(id), "")
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "pauses_workloads": false})
}

func serveCostInsightsPayload(userID int, r *http.Request) (*costInsights, string, string, error) {
	basis, currency, fromRaw, toRaw, _ := costQueryFromRequest(r)
	insights, err := buildCostInsights(userID, basis, currency, fromRaw, toRaw, costMetricsContext{})
	return insights, basis, currency, err
}

func serveCostAnomalies(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	insights, basis, currency, err := serveCostInsightsPayload(userID, r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost anomalies could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"basis":              basis,
		"currency":           currency,
		"anomalies":          insights.Anomalies,
		"prior_window_start": insights.PriorWindowStart,
		"prior_window_end":   insights.PriorWindowEnd,
		"prior_coverage":     insights.PriorCoverage,
		"notify_cost":        insights.NotifyCost,
		"pauses_workloads":   false,
		"note":               "Like-for-like anomalies need two complete windows. Incomplete coverage stays Unknown, never a drop to $0.",
	})
}

func serveCostRecommendations(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if len(parts) > 0 {
		serveCostRecommendationAction(w, r, userID, parts[0])
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	insights, basis, currency, err := serveCostInsightsPayload(userID, r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost recommendations could not be loaded.", err)
		return
	}
	calc := strings.TrimSpace(r.URL.Query().Get("calc"))
	recs := insights.Recommendations
	if calc != "" {
		filtered := []costRecommendation{}
		for _, rec := range recs {
			if strings.EqualFold(rec.CalcID, calc) {
				filtered = append(filtered, rec)
			}
		}
		recs = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":                 "ok",
		"basis":                  basis,
		"currency":               currency,
		"recommendations":        recs,
		"opportunity_groups":     insights.Groups,
		"nonoverlapping_savings": insights.NonOverlapping,
		"pauses_workloads":       false,
		"executes":               false,
		"can_operate":            userHasCostOperateAnywhere(userID),
		"metrics_ready":          insights.MetricsReady,
		"calculations":           insights.Calculations,
		"note":                   "Missing metrics block rightsizing claims. Overlapping savings are not summed. Acceptance is not permission to execute.",
	})
}

func serveCostRecommendationAction(w http.ResponseWriter, r *http.Request, userID int, calcID string) {
	calcID = strings.TrimSpace(calcID)
	if calcID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "Calculation ID is required.", nil)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	var body struct {
		Action       string `json:"action"`
		ChangeNumber string `json:"change_number"`
		Reason       string `json:"reason"`
		ReviewBy     string `json:"review_by"`
		Confounders  string `json:"confounders"`
		Result       string `json:"result"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	insights, _, _, err := serveCostInsightsPayload(userID, r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost recommendation could not be loaded.", err)
		return
	}
	var rec *costRecommendation
	for i := range insights.Recommendations {
		if strings.EqualFold(insights.Recommendations[i].CalcID, calcID) {
			rec = &insights.Recommendations[i]
			break
		}
	}
	if rec == nil {
		writeAPIError(w, r, http.StatusNotFound, "Unknown calculation ID.", nil)
		return
	}
	if conn := costConnectionForAccount(userID, rec.AccountID); conn == nil || !userCanOperateCost(userID, conn.ProjectID) {
		writeCostOperateDenied(w, r)
		return
	}
	basis, currency, fromRaw, toRaw, _ := costQueryFromRequest(r)
	current, err := loadCostWindowSlice(userID, basis, currency, fromRaw, toRaw, costLineQuery{})
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost window could not be loaded.", err)
		return
	}
	prior := &costWindowSlice{Coverage: "none", Currency: current.Currency, Basis: current.Basis}
	if current.WindowStart != "" && current.WindowEnd != "" {
		start, startErr := costParseDate(current.WindowStart)
		end, endErr := costParseDate(current.WindowEnd)
		if startErr == nil && endErr == nil {
			priorStart, priorEnd := priorLikeForLikeWindow(start, end)
			if loaded, priorErr := loadCostWindowSlice(userID, current.Basis, current.Currency, priorStart.Format("2006-01-02"), priorEnd.Format("2006-01-02"), costLineQuery{}); priorErr == nil {
				prior = loaded
			}
		}
	}
	next, err := applyCostReviewAction(userID, *rec, costReviewAction{
		Action:       body.Action,
		ChangeNumber: body.ChangeNumber,
		Reason:       body.Reason,
		ReviewBy:     body.ReviewBy,
		Confounders:  body.Confounders,
		Result:       body.Result,
	}, current, prior)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	AppendAuditLog(&userID, "cost_recommendation_"+strings.ToLower(strings.TrimSpace(body.Action)), "cost_recommendation", next.CalcID, next.Lifecycle)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"recommendation":   next,
		"executes":         false,
		"pauses_workloads": false,
		"note":             "Acceptance is not permission to execute. Verification can be Inconclusive.",
	})
}

func serveCostSavings(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	basis, currency, fromRaw, toRaw, _ := costQueryFromRequest(r)
	payload, err := buildCostSavings(userID, basis, currency, fromRaw, toRaw)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost savings could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func serveCostCalculations(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "Calculation ID is required.", nil)
		return
	}
	insights, _, _, err := serveCostInsightsPayload(userID, r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost calculation could not be loaded.", err)
		return
	}
	item := findCostCalculation(insights, parts[0])
	if item == nil {
		writeAPIError(w, r, http.StatusNotFound, "Unknown calculation ID.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"calculation": item,
		"note":        "Copilot may only cite stored calculation IDs. This ID is not permission to change infrastructure.",
	})
}

func serveCostConfiguration(w http.ResponseWriter, r *http.Request, userID int) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	connections, err := listCostConnections(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost connections could not be loaded.", err)
		return
	}
	eligible, err := listEligibleCostAccounts(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cloud accounts could not be loaded.", err)
		return
	}
	batches, err := listCostBatches(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost ingest history could not be loaded.", err)
		return
	}
	rules, err := listCostAllocationRules()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Allocation rules could not be loaded.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"connections": connections,
		"eligible":    eligible,
		"batches":     batches,
		"rules":       rules,
		"pilot":       "AWS CUR 2.0",
		"rbac":        "project",
		"can_operate": userHasCostOperateAnywhere(userID),
		"ai":          costAIPolicy(),
		"ai_proof":    costAIProofSummary(listCostAIProofs(userID)),
		"note":        "Enable Cost on an existing AWS account that already belongs to a project you can see. Cost visibility is project membership plus the Cost page grant. Import a labelled AWS CUR 2.0 export. Replay keeps one billed total. Demo inventory accounts are ignored. Allocation is applied at query time. Copilot never receives account IDs, passwords, or role names.",
	})
}

func serveCostConnections(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			items, err := listCostConnections(userID)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Cost connections could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "connections": items})
		case http.MethodPost:
			var body struct {
				CloudAccountID int `json:"cloud_account_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			item, err := enableCostConnection(userID, body.CloudAccountID)
			if errors.Is(err, errCostOperateRequired) {
				writeCostOperateDenied(w, r)
				return
			}
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			AppendAuditLog(&userID, "cost_connection_enable", "cost_connection", strconv.Itoa(item.ID), item.Provider+":"+item.AccountID)
			writeJSON(w, http.StatusCreated, map[string]any{"status": "ok", "connection": item})
		default:
			writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		}
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown Cost connection.", nil)
		return
	}
	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		item, getErr := getCostConnection(userID, id)
		if getErr != nil {
			writeAPIError(w, r, http.StatusNotFound, "Cost connection not found.", getErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "connection": item})
		return
	}
	switch parts[1] {
	case "dashboard":
		serveCostAccountDashboard(w, r, userID, id)
		return
	case "export":
		serveCostAccountExport(w, r, userID, id)
		return
	case "batches":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		batches, listErr := listCostBatches(userID)
		if listErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Cost ingest history could not be loaded.", listErr)
			return
		}
		filtered := []costBatchRow{}
		for _, batch := range batches {
			if batch.ConnectionID == id {
				filtered = append(filtered, batch)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "batches": filtered})
	case "fixture":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r, http.MethodPost)
			return
		}
		if !requireCostOperateOnConnection(w, r, userID, id) {
			return
		}
		complete := true
		if r.Body != nil {
			var body struct {
				Complete *bool `json:"complete"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.Complete != nil {
				complete = *body.Complete
			}
		}
		result, fixtureErr := importCostFixture(userID, id, complete)
		if fixtureErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Fixture could not be imported.", fixtureErr)
			return
		}
		AppendAuditLog(&userID, "cost_fixture_import", "cost_connection", strconv.Itoa(id), result.Revision)
		writeJSON(w, http.StatusAccepted, map[string]any{
			"status":     "ok",
			"import":     result,
			"connection": result.Connection,
			"duplicate":  result.Duplicate,
			"complete":   complete,
			"note":       costImportNote(result),
		})
	case "import":
		serveCostImport(w, r, userID, id)
	default:
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
	}
}

func serveCostImport(w http.ResponseWriter, r *http.Request, userID, id int) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	if !requireCostOperateOnConnection(w, r, userID, id) {
		return
	}
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	var body struct {
		Label        string           `json:"label"`
		Kind         string           `json:"kind"`
		Complete     *bool            `json:"complete"`
		WindowStart  string           `json:"window_start"`
		WindowEnd    string           `json:"window_end"`
		Lines        []map[string]any `json:"lines"`
		PrivateKey   string           `json:"private_key"`
		PEM          string           `json:"pem"`
		AWSSecretKey string           `json:"aws_secret_access_key"`
	}
	if err := dec.Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if strings.TrimSpace(body.PrivateKey) != "" || strings.TrimSpace(body.PEM) != "" || strings.TrimSpace(body.AWSSecretKey) != "" {
		writeAPIError(w, r, http.StatusBadRequest, "CUR export cannot include secrets.", nil)
		return
	}
	conn, err := getCostConnection(userID, id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost connection not found.", err)
		return
	}
	lines, err := mapCUR2Lines(body.Lines, conn.AccountID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	start, err := costParseDate(body.WindowStart)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "window_start must be YYYY-MM-DD.", err)
		return
	}
	end, err := costParseDate(body.WindowEnd)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "window_end must be YYYY-MM-DD.", err)
		return
	}
	complete := true
	if body.Complete != nil {
		complete = *body.Complete
	}
	result, err := persistCostExport(costExportIn{
		UserID:       userID,
		ConnectionID: id,
		Source:       "aws_cur_2",
		Kind:         body.Kind,
		Label:        body.Label,
		WindowStart:  start,
		WindowEnd:    end,
		Complete:     complete,
		Lines:        lines,
	})
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "CUR export could not be imported.", err)
		return
	}
	AppendAuditLog(&userID, "cost_cur_import", "cost_connection", strconv.Itoa(id), result.Kind+":"+result.Revision)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":     "ok",
		"import":     result,
		"connection": result.Connection,
		"duplicate":  result.Duplicate,
		"correction": result.Correction,
		"note":       costImportNote(result),
	})
}

func costImportNote(result *costExportResult) string {
	if result == nil {
		return "CUR export stored."
	}
	if result.Duplicate {
		return "This export was already stored. The billed total was not doubled."
	}
	if result.Correction {
		return "This export replaces the previous revision for the same window. Earlier revisions stay in history."
	}
	if !result.Complete {
		return "Incomplete window stored. Overview stays Unknown until a complete revision exists."
	}
	return "CUR 2.0 export stored. Actual and amortized stay on separate columns."
}

func serveCostKubernetes(w http.ResponseWriter, r *http.Request, userID int, parts []string) {
	if len(parts) == 0 || parts[0] == "clusters" && len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			payload, err := buildCostKubernetesCatalog(userID)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes cost bindings could not be loaded.", err)
				return
			}
			writeJSON(w, http.StatusOK, payload)
		case http.MethodPost:
			if len(parts) == 0 {
				writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
				return
			}
			var body struct {
				K8sConnectionID  int `json:"k8s_connection_id"`
				CostConnectionID int `json:"cost_connection_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			item, err := bindCostK8sCluster(userID, body.K8sConnectionID, body.CostConnectionID)
			if err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, errCostOperateRequired) || strings.Contains(err.Error(), "not included") {
					status = http.StatusForbidden
				}
				writeAPIError(w, r, status, err.Error(), err)
				return
			}
			AppendAuditLog(&userID, "cost_k8s_bind", "cost_k8s_binding", strconv.Itoa(item.ID), item.ClusterName)
			writeJSON(w, http.StatusCreated, map[string]any{
				"status":  "ok",
				"cluster": item,
				"note":    item.Note,
			})
		default:
			writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		}
		return
	}
	if parts[0] != "clusters" || len(parts) < 2 {
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
		return
	}
	id, err := strconv.Atoi(parts[1])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Unknown cluster cost binding.", nil)
		return
	}
	item, getErr := getCostK8sBinding(userID, id)
	if getErr != nil {
		writeAPIError(w, r, http.StatusNotFound, "Cluster cost binding not found.", getErr)
		return
	}
	if len(parts) == 2 {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "cluster": item, "pilot": buildCostK8sPilot(item), "worker_can_edit": false})
		return
	}
	switch parts[2] {
	case "restart", "scale", "resume", "drain", "delete":
		writeAPIError(w, r, http.StatusForbidden, "This worker cannot edit workloads.", nil)
		return
	case "snapshots":
		serveCostK8sSnapshots(w, r, userID, item)
	case "workloads", "allocations":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		payload, workErr := buildCostK8sClusterViews(item.ID, r.URL.Query().Get("group"))
		if workErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes workloads could not be loaded.", workErr)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case "optimization":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		payload, optErr := buildCostK8sOptimization(item.ID)
		if optErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes optimization could not be loaded.", optErr)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case "reconciliation":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		basis := r.URL.Query().Get("basis")
		distribute := r.URL.Query().Get("distribute_idle") == "1" || r.URL.Query().Get("distribute_idle") == "true"
		payload, reconErr := buildCostK8sReconciliation(userID, item.ID, basis, distribute)
		if reconErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes reconciliation could not be loaded.", reconErr)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case "collection-health":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, buildCostK8sCollectionHealth(item))
	case "validate":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r, http.MethodPost)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":               "ok",
			"cluster":              item,
			"inventory_readiness":  item.InventoryReadiness,
			"metrics_readiness":    item.MetricsReadiness,
			"allocation_readiness": item.AllocationReadiness,
			"billing_reconciled":   item.BillingReconciled,
			"collector_health":     item.CollectorHealth,
			"capability_gaps":      item.Gaps,
			"installs_opencost":    false,
			"worker_can_edit":      false,
			"note":                 "Readiness lamps stay independent. Missing stays Unknown, never Healthy. Validation does not install OpenCost or edit workloads.",
		})
	case "sync":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r, http.MethodPost)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"status":  "accepted",
			"cluster": item,
			"note":    "This worker does not pull OpenCost. Upload a snapshot or use the private collector. This product does not install OpenCost and cannot edit workloads.",
		})
	case "fixture":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r, http.MethodPost)
			return
		}
		if !requireCostOperateOnProject(w, r, userID, item.ProjectID) {
			return
		}
		next, token, fixtureErr := issueCostK8sFixture(userID, id)
		if fixtureErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Least-privilege fixture could not be issued.", fixtureErr)
			return
		}
		AppendAuditLog(&userID, "cost_k8s_fixture", "cost_k8s_binding", strconv.Itoa(id), next.ClusterName)
		writeJSON(w, http.StatusAccepted, map[string]any{
			"status":            "ok",
			"cluster":           next,
			"token":             token,
			"rbac_yaml":         next.RBACYAML,
			"installs_opencost": false,
			"worker_can_edit":   false,
			"note":              "This bootstrap token is shown once. The API stores only a hash. Apply the ClusterRole through the normal cluster-admin workflow. This product does not install OpenCost.",
		})
	default:
		writeAPIError(w, r, http.StatusNotFound, "Unknown Cost route.", nil)
	}
}

func serveCostK8sSnapshots(w http.ResponseWriter, r *http.Request, userID int, item *costK8sBinding) {
	switch r.Method {
	case http.MethodGet:
		rows, err := listCostK8sSnapshots(item.ID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes snapshots could not be loaded.", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":               "ok",
			"snapshots":            rows,
			"installs_opencost":    false,
			"worker_can_edit":      false,
			"added_to_cloud_total": false,
			"note":                 "Private collector upload. Replay keeps one identity set. Missing history is Needs more data, not zero usage.",
		})
	case http.MethodPost:
		if !requireCostOperateOnProject(w, r, userID, item.ProjectID) {
			return
		}
		result, err := decodeAndPersistCostK8sSnapshot(r, item.ID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&userID, "cost_k8s_snapshot", "cost_k8s_binding", strconv.Itoa(item.ID), result.ContentHash)
		status := http.StatusAccepted
		if result.Duplicate || result.IgnoredStale {
			status = http.StatusOK
		}
		writeJSON(w, status, map[string]any{
			"status":   "ok",
			"snapshot": result,
			"cluster":  mustCostK8sBinding(userID, item.ID),
			"note":     result.Note,
		})
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
	}
}

func decodeAndPersistCostK8sSnapshot(r *http.Request, bindingID int) (*costK8sSnapshotRow, error) {
	dec := json.NewDecoder(io.LimitReader(r.Body, 8<<20))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	doc, err := parseCostK8sSnapshot(raw, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return persistCostK8sSnapshot(bindingID, doc)
}

func mustCostK8sBinding(userID, id int) *costK8sBinding {
	item, err := getCostK8sBinding(userID, id)
	if err != nil {
		item, _ = getCostK8sBindingRecord(id)
	}
	return item
}

func costK8sCollectorHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || !strings.HasPrefix(header, "Bearer ") {
		writeAPIError(w, r, http.StatusUnauthorized, "collector identity required", nil)
		return
	}
	item, err := lookupCostK8sBindingByToken(token)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusUnauthorized, "collector identity required", err)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/cost/collector/"), "/")
	if path != "snapshots" {
		writeAPIError(w, r, http.StatusNotFound, "Unknown collector route.", nil)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	result, persistErr := decodeAndPersistCostK8sSnapshot(r, item.ID)
	if persistErr != nil {
		writeAPIError(w, r, http.StatusBadRequest, persistErr.Error(), persistErr)
		return
	}
	status := http.StatusAccepted
	if result.Duplicate || result.IgnoredStale {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{
		"status":            "ok",
		"snapshot":          result,
		"installs_opencost": false,
		"worker_can_edit":   false,
		"note":              result.Note,
	})
}
