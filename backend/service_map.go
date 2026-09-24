package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type serviceMapEntry struct {
	ID           int    `json:"id"`
	ProjectID    *int   `json:"project_id,omitempty"`
	ProjectName  string `json:"project_name,omitempty"`
	ProjectCode  string `json:"project_code,omitempty"`
	Service      string `json:"service"`
	Repo         string `json:"repo"`
	Environment  string `json:"environment"`
	GrafanaUID   string `json:"grafana_uid,omitempty"`
	PromQL       string `json:"promql,omitempty"`
	DashboardURL string `json:"dashboard_url,omitempty"`
	MetricsURL   string `json:"metrics_url,omitempty"`
	Team         string `json:"team,omitempty"`
}

func listServiceMap(projectID int, environment, query string) ([]serviceMapEntry, error) {
	if DB == nil {
		return []serviceMapEntry{}, nil
	}
	sqlQuery := `
		SELECT s.id, s.project_id, COALESCE(p.name,''), COALESCE(p.code,''), COALESCE(s.service,''), COALESCE(s.repo,''),
		       COALESCE(s.environment,''), COALESCE(s.grafana_uid,''), COALESCE(s.promql,''), COALESCE(s.dashboard_url,''), COALESCE(s.metrics_url,''), COALESCE(s.team,'')
		FROM service_map s
		LEFT JOIN projects p ON p.id = s.project_id
	`
	args := []any{}
	where := []string{}
	if projectID > 0 {
		args = append(args, projectID)
		where = append(where, fmt.Sprintf("s.project_id = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(environment); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("(s.environment = '' OR LOWER(s.environment) = $%d)", len(args)))
	}
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("(LOWER(s.service) LIKE $%d OR LOWER(s.repo) LIKE $%d OR LOWER(s.team) LIKE $%d)", len(args), len(args), len(args)))
	}
	if len(where) > 0 {
		sqlQuery += " WHERE " + strings.Join(where, " AND ")
	}
	sqlQuery += " ORDER BY s.service, s.environment, s.id"
	rows, cancel, err := queryRowsWithTimeout(sqlQuery, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceMapEntry{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []serviceMapEntry{}
	for rows.Next() {
		item, err := scanServiceMap(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func scanServiceMap(scanner interface {
	Scan(dest ...any) error
}) (*serviceMapEntry, error) {
	var item serviceMapEntry
	var projectID sql.NullInt64
	if err := scanner.Scan(&item.ID, &projectID, &item.ProjectName, &item.ProjectCode, &item.Service, &item.Repo, &item.Environment, &item.GrafanaUID, &item.PromQL, &item.DashboardURL, &item.MetricsURL, &item.Team); err != nil {
		return nil, err
	}
	if projectID.Valid {
		value := int(projectID.Int64)
		item.ProjectID = &value
	}
	return &item, nil
}

func lookupServiceMap(service, repo, environment string) *serviceMapEntry {
	items, err := listServiceMap(0, environment, "")
	if err != nil {
		return nil
	}
	service = strings.ToLower(strings.TrimSpace(service))
	repo = strings.ToLower(strings.TrimSpace(repo))
	environment = strings.ToLower(strings.TrimSpace(environment))
	var fallback *serviceMapEntry
	for i := range items {
		item := items[i]
		if repo != "" && strings.EqualFold(item.Repo, repo) {
			copy := item
			return &copy
		}
		if service != "" && strings.EqualFold(item.Service, service) {
			copy := item
			if item.Environment == "" || strings.EqualFold(item.Environment, environment) {
				return &copy
			}
			fallback = &copy
		}
	}
	return fallback
}

func upsertServiceMap(item serviceMapEntry) (*serviceMapEntry, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	item.Service = strings.TrimSpace(item.Service)
	item.Repo = strings.TrimSpace(item.Repo)
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	if item.Service == "" && item.Repo == "" {
		return nil, fmt.Errorf("service or repo is required")
	}
	var projectAny any
	if item.ProjectID != nil && *item.ProjectID > 0 {
		projectAny = *item.ProjectID
	}
	var existingID int
	err := queryRowContext(`
		SELECT id FROM service_map
		WHERE LOWER(service) = LOWER($1)
		  AND LOWER(environment) = LOWER($2)
		  AND COALESCE(project_id, 0) = COALESCE($3, 0)
	`, item.Service, item.Environment, projectAny).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingID > 0 {
		if _, err := execContext(`
			UPDATE service_map
			SET repo = $2, grafana_uid = $3, promql = $4, dashboard_url = $5, metrics_url = $6, team = $7, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, item.Repo, item.GrafanaUID, item.PromQL, item.DashboardURL, item.MetricsURL, item.Team); err != nil {
			return nil, err
		}
		return getServiceMapByID(existingID)
	}
	err = queryRowContext(`
		INSERT INTO service_map (project_id, service, repo, environment, grafana_uid, promql, dashboard_url, metrics_url, team)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`, projectAny, item.Service, item.Repo, item.Environment, item.GrafanaUID, item.PromQL, item.DashboardURL, item.MetricsURL, item.Team).Scan(&existingID)
	if err != nil {
		return nil, err
	}
	return getServiceMapByID(existingID)
}

func getServiceMapByID(id int) (*serviceMapEntry, error) {
	items, err := listServiceMap(0, "", "")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("service not found")
}

func devopsServiceMapHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	switch r.Method {
	case "GET":
		items, err := listServiceMap(projectID, r.URL.Query().Get("environment"), r.URL.Query().Get("q"))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"services": items, "status": "ok"})
	case "POST":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body serviceMapEntry
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, err := upsertServiceMap(body)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"service": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsServiceMapDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	id, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/services/"), "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid service id", err)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	item, err := getServiceMapByID(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "service not found", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"service": item, "status": "ok"})
}
