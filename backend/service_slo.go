package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type serviceSLO struct {
	ID             int     `json:"id"`
	ProjectID      *int    `json:"project_id,omitempty"`
	Service        string  `json:"service"`
	Environment    string  `json:"environment"`
	LatencyP95Ms   float64 `json:"latency_p95_ms"`
	ErrorRatio     float64 `json:"error_ratio"`
	Saturation     float64 `json:"saturation"`
	WindowDays     int     `json:"window_days"`
	FreezeOnBudget bool    `json:"freeze_on_budget"`
}

type serviceSLOBudget struct {
	serviceSLO
	Samples         int     `json:"samples"`
	Breaching       int     `json:"breaching"`
	BudgetRemaining float64 `json:"budget_remaining"`
	Burned          bool    `json:"burned"`
	FreezeReason    string  `json:"freeze_reason,omitempty"`
}

func findServiceSLO(service, environment string, projectID *int) *serviceSLO {
	items, err := listServiceSLOs(0, environment)
	if err != nil {
		return nil
	}
	service = strings.ToLower(strings.TrimSpace(service))
	environment = strings.ToLower(strings.TrimSpace(environment))
	var fallback *serviceSLO
	for i := range items {
		item := items[i]
		if !strings.EqualFold(item.Service, service) {
			continue
		}
		if projectID != nil && item.ProjectID != nil && *item.ProjectID != *projectID {
			continue
		}
		if strings.EqualFold(item.Environment, environment) || item.Environment == "" {
			copy := item
			if strings.EqualFold(item.Environment, environment) {
				return &copy
			}
			fallback = &copy
		}
	}
	return fallback
}

func listServiceSLOs(projectID int, environment string) ([]serviceSLO, error) {
	if DB == nil {
		return []serviceSLO{}, nil
	}
	query := `
		SELECT id, project_id, COALESCE(service,''), COALESCE(environment,''), latency_p95_ms, error_ratio, saturation, window_days, freeze_on_budget
		FROM service_slos
	`
	args := []any{}
	where := []string{}
	if projectID > 0 {
		args = append(args, projectID)
		where = append(where, fmt.Sprintf("project_id = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(environment); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("(environment = '' OR LOWER(environment) = $%d)", len(args)))
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY service, environment, id"
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceSLO{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []serviceSLO{}
	for rows.Next() {
		var item serviceSLO
		var project sql.NullInt64
		if err := rows.Scan(&item.ID, &project, &item.Service, &item.Environment, &item.LatencyP95Ms, &item.ErrorRatio, &item.Saturation, &item.WindowDays, &item.FreezeOnBudget); err != nil {
			return nil, err
		}
		if project.Valid {
			value := int(project.Int64)
			item.ProjectID = &value
		}
		item.ErrorRatio = normalizeRatio(item.ErrorRatio)
		item.Saturation = normalizeRatio(item.Saturation)
		if item.WindowDays <= 0 {
			item.WindowDays = 30
		}
		out = append(out, item)
	}
	return out, nil
}

func upsertServiceSLO(item serviceSLO) (*serviceSLO, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	item.Service = strings.TrimSpace(item.Service)
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	if item.Service == "" {
		return nil, fmt.Errorf("service is required")
	}
	item.ErrorRatio = normalizeRatio(item.ErrorRatio)
	item.Saturation = normalizeRatio(item.Saturation)
	if item.WindowDays <= 0 {
		item.WindowDays = 30
	}
	var projectAny any
	if item.ProjectID != nil && *item.ProjectID > 0 {
		projectAny = *item.ProjectID
	}
	var existingID int
	err := queryRowContext(`
		SELECT id FROM service_slos
		WHERE LOWER(service) = LOWER($1)
		  AND LOWER(environment) = LOWER($2)
		  AND COALESCE(project_id, 0) = COALESCE($3, 0)
	`, item.Service, item.Environment, projectAny).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingID > 0 {
		if _, err := execContext(`
			UPDATE service_slos
			SET latency_p95_ms = $2, error_ratio = $3, saturation = $4, window_days = $5, freeze_on_budget = $6, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, item.LatencyP95Ms, item.ErrorRatio, item.Saturation, item.WindowDays, item.FreezeOnBudget); err != nil {
			return nil, err
		}
		item.ID = existingID
		return &item, nil
	}
	err = queryRowContext(`
		INSERT INTO service_slos (project_id, service, environment, latency_p95_ms, error_ratio, saturation, window_days, freeze_on_budget)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, projectAny, item.Service, item.Environment, item.LatencyP95Ms, item.ErrorRatio, item.Saturation, item.WindowDays, item.FreezeOnBudget).Scan(&existingID)
	if err != nil {
		return nil, err
	}
	item.ID = existingID
	return &item, nil
}

func computeErrorBudget(slo serviceSLO, samples []serviceMetrics) serviceSLOBudget {
	budget := serviceSLOBudget{serviceSLO: slo, BudgetRemaining: 1}
	budget.Samples = len(samples)
	if slo.ErrorRatio <= 0 && slo.LatencyP95Ms <= 0 {
		return budget
	}
	for _, sample := range samples {
		breach := false
		if slo.ErrorRatio > 0 && sample.ErrorRatio > slo.ErrorRatio {
			breach = true
		}
		if slo.LatencyP95Ms > 0 && sample.P95Ms > slo.LatencyP95Ms {
			breach = true
		}
		if breach {
			budget.Breaching++
		}
	}
	if budget.Samples > 0 {
		budget.BudgetRemaining = 1 - (float64(budget.Breaching) / float64(budget.Samples))
		if budget.BudgetRemaining < 0 {
			budget.BudgetRemaining = 0
		}
	}
	budget.Burned = slo.FreezeOnBudget && budget.Samples >= 3 && budget.BudgetRemaining <= 0
	if budget.Burned {
		budget.FreezeReason = fmt.Sprintf("Error budget burned for %s in %s", firstNonEmpty(slo.Service, "service"), firstNonEmpty(slo.Environment, "all envs"))
	}
	return budget
}

func listServiceSLOBudgets(projectID int, environment string) ([]serviceSLOBudget, error) {
	items, err := listServiceSLOs(projectID, environment)
	if err != nil {
		return nil, err
	}
	out := make([]serviceSLOBudget, 0, len(items))
	now := time.Now()
	for _, item := range items {
		days := item.WindowDays
		if days <= 0 {
			days = 30
		}
		samples, _ := listWatchSamplesForService(item.Service, item.Environment, now.AddDate(0, 0, -days))
		out = append(out, computeErrorBudget(item, samples))
	}
	return out, nil
}

func sloBudgetFreezeReason(environment string) string {
	budgets, err := listServiceSLOBudgets(0, environment)
	if err != nil {
		return ""
	}
	env := strings.ToLower(strings.TrimSpace(environment))
	for _, item := range budgets {
		if !item.Burned {
			continue
		}
		if env != "" && item.Environment != "" && !strings.EqualFold(item.Environment, env) {
			continue
		}
		return item.FreezeReason
	}
	return ""
}

func devopsSLOsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	environment := r.URL.Query().Get("environment")
	switch r.Method {
	case "GET":
		items, err := listServiceSLOBudgets(projectID, environment)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list SLOs", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"slos": items, "status": "ok"})
	case "POST":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body serviceSLO
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if projectID > 0 && body.ProjectID == nil {
			body.ProjectID = &projectID
		}
		item, err := upsertServiceSLO(body)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save SLO", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"slo": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}
