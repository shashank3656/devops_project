package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type serviceMapEntry struct {
	ID                  int     `json:"id"`
	ProjectID           *int    `json:"project_id,omitempty"`
	ProjectName         string  `json:"project_name,omitempty"`
	ProjectCode         string  `json:"project_code,omitempty"`
	Service             string  `json:"service"`
	Repo                string  `json:"repo"`
	Environment         string  `json:"environment"`
	GrafanaUID          string  `json:"grafana_uid,omitempty"`
	PromQL              string  `json:"promql,omitempty"`
	DashboardURL        string  `json:"dashboard_url,omitempty"`
	MetricsURL          string  `json:"metrics_url,omitempty"`
	Team                string  `json:"team,omitempty"`
	Criticality         string  `json:"criticality"`
	SupportTeam         string  `json:"support_team,omitempty"`
	EscalationRoute     string  `json:"escalation_route,omitempty"`
	RunbookURL          string  `json:"runbook_url,omitempty"`
	OpenCritical        int     `json:"open_critical,omitempty"`
	OpenWarning         int     `json:"open_warning,omitempty"`
	LastEvaluatedAt     *string `json:"last_evaluated_at,omitempty"`
	ScheduleMinutes     int     `json:"schedule_minutes,omitempty"`
	LastAvailabilityBPS *int    `json:"last_availability_bps,omitempty"`
	LastSLIState        string  `json:"last_sli_state,omitempty"`
}

const serviceMapSelectCols = `s.id, s.project_id, COALESCE(p.name,''), COALESCE(p.code,''), COALESCE(s.service,''), COALESCE(s.repo,''),
		       COALESCE(s.environment,''), COALESCE(s.grafana_uid,''), COALESCE(s.promql,''), COALESCE(s.dashboard_url,''), COALESCE(s.metrics_url,''), COALESCE(s.team,''),
		       COALESCE(NULLIF(s.criticality,''),'unclassified'), COALESCE(s.support_team,''), COALESCE(s.escalation_route,''), COALESCE(s.runbook_url,'')`

func listServiceMap(projectID int, environment, query string) ([]serviceMapEntry, error) {
	if DB == nil {
		return []serviceMapEntry{}, nil
	}
	sqlQuery := `
		SELECT ` + serviceMapSelectCols + `
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
	attachServiceFindingCounts(out)
	attachServiceEvalMeta(out)
	return out, nil
}

func attachServiceFindingCounts(items []serviceMapEntry) {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	counts := findingCountsForServices(ids)
	for i := range items {
		pair := counts[items[i].ID]
		items[i].OpenCritical = pair[0]
		items[i].OpenWarning = pair[1]
	}
}

func isMonitoredServiceEnvironment(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "prod", "production":
		return true
	default:
		return false
	}
}

func requestMonitoredInventory(r *http.Request) bool {
	return strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("monitored")), "1")
}

func serviceMapConditions(projectID int, environment, query, team string, visible []int, restrict, monitored bool) (string, []any) {
	args := []any{}
	where := []string{}
	if restrict {
		if len(visible) == 0 {
			where = append(where, "FALSE")
		} else {
			placeholders := make([]string, len(visible))
			for index, id := range visible {
				args = append(args, id)
				placeholders[index] = fmt.Sprintf("$%d", len(args))
			}
			where = append(where, fmt.Sprintf("s.project_id IN (%s)", strings.Join(placeholders, ", ")))
		}
	}
	if projectID > 0 {
		args = append(args, projectID)
		where = append(where, fmt.Sprintf("s.project_id = $%d", len(args)))
	}
	if monitored {
		where = append(where, "(s.environment = '' OR LOWER(s.environment) IN ('prod', 'production'))")
	} else if trimmed := strings.TrimSpace(environment); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("(s.environment = '' OR LOWER(s.environment) = $%d)", len(args)))
	}
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("(LOWER(s.service) LIKE $%d OR LOWER(s.repo) LIKE $%d OR LOWER(s.team) LIKE $%d)", len(args), len(args), len(args)))
	}
	if trimmed := strings.TrimSpace(team); trimmed != "" {
		names := strings.Split(trimmed, "|")
		parts := []string{}
		for _, name := range names {
			name = strings.ToLower(strings.TrimSpace(name))
			if name == "" {
				continue
			}
			args = append(args, name)
			parts = append(parts, fmt.Sprintf("LOWER(COALESCE(s.team, '')) = $%d", len(args)))
		}
		if len(parts) > 0 {
			where = append(where, "("+strings.Join(parts, " OR ")+")")
		}
	}
	if len(where) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(where, " AND "), args
}

func visibleServiceProjectIDs(userID int) (bool, []int, error) {
	if callerSeesEveryProject(userID) {
		return true, nil, nil
	}
	set, err := getVisibleProjectIDSetForUser(userID)
	if err != nil {
		return false, nil, err
	}
	ids := make([]int, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return false, ids, nil
}

type serviceFolderCount struct {
	ProjectID   int    `json:"project_id"`
	ProjectName string `json:"project_name"`
	Environment string `json:"environment"`
	Count       int    `json:"count"`
}

func listServiceMapSummary(projectID int, visible []int, restrict, monitored bool) ([]serviceFolderCount, int, int, *serviceMapEntry, error) {
	where, args := serviceMapConditions(projectID, "", "", "", visible, restrict, monitored)
	selectSQL := `SELECT COALESCE(s.project_id, 0), COALESCE(p.name, ''), COALESCE(s.environment, ''), COUNT(*)`
	groupBy := "GROUP BY 1, 2, 3 ORDER BY 2, 3"
	if monitored {
		selectSQL = `SELECT COALESCE(s.project_id, 0), COALESCE(p.name, ''), 'production', COUNT(*)`
		groupBy = "GROUP BY 1, 2 ORDER BY 2"
	}
	rows, cancel, err := queryRowsWithTimeout(`
		`+selectSQL+`
		FROM service_map s
		LEFT JOIN projects p ON p.id = s.project_id`+where+`
		`+groupBy+`
	`, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceFolderCount{}, 0, 0, nil, nil
		}
		return nil, 0, 0, nil, err
	}
	defer cancel()
	defer rows.Close()
	folders := []serviceFolderCount{}
	total := 0
	for rows.Next() {
		var folder serviceFolderCount
		if err := rows.Scan(&folder.ProjectID, &folder.ProjectName, &folder.Environment, &folder.Count); err != nil {
			return nil, 0, 0, nil, err
		}
		total += folder.Count
		folders = append(folders, folder)
	}
	incompleteWhere, incompleteArgs := serviceMapConditions(projectID, "", "", "", visible, restrict, monitored)
	incompleteSQL := `SELECT COUNT(*) FROM service_map s LEFT JOIN projects p ON p.id = s.project_id` + incompleteWhere
	incompleteClause := "(COALESCE(s.repo,'') = '' OR COALESCE(s.team,'') = '')"
	if incompleteWhere == "" {
		incompleteSQL += " WHERE " + incompleteClause
	} else {
		incompleteSQL += " AND " + incompleteClause
	}
	var incomplete int
	if err := queryRowContext(incompleteSQL, incompleteArgs...).Scan(&incomplete); err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return folders, total, 0, nil, nil
		}
		return nil, 0, 0, nil, err
	}
	setupWhere, setupArgs := serviceMapConditions(projectID, "", "", "", visible, restrict, monitored)
	setupSQL := `
		SELECT ` + serviceMapSelectCols + `
		FROM service_map s
		LEFT JOIN projects p ON p.id = s.project_id` + setupWhere
	if setupWhere == "" {
		setupSQL += " WHERE (COALESCE(s.repo,'') = '' OR COALESCE(s.team,'') = '')"
	} else {
		setupSQL += " AND (COALESCE(s.repo,'') = '' OR COALESCE(s.team,'') = '')"
	}
	setupSQL += " ORDER BY s.id LIMIT 1"
	setupRows, setupCancel, err := queryRowsWithTimeout(setupSQL, setupArgs...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return folders, total, incomplete, nil, nil
		}
		return nil, 0, 0, nil, err
	}
	defer setupCancel()
	defer setupRows.Close()
	if !setupRows.Next() {
		return folders, total, incomplete, nil, nil
	}
	setup, err := scanServiceMap(setupRows)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	return folders, total, incomplete, setup, nil
}

func listServiceMapPage(projectID int, environment, query, team string, visible []int, restrict, monitored bool, limit, offset int) ([]serviceMapEntry, int, error) {
	where, args := serviceMapConditions(projectID, environment, query, team, visible, restrict, monitored)
	var total int
	if err := queryRowContext(`SELECT COUNT(*) FROM service_map s LEFT JOIN projects p ON p.id = s.project_id`+where, args...).Scan(&total); err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceMapEntry{}, 0, nil
		}
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 50 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	pageArgs := append([]any{}, args...)
	pageArgs = append(pageArgs, limit, offset)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT `+serviceMapSelectCols+`
		FROM service_map s
		LEFT JOIN projects p ON p.id = s.project_id`+where+fmt.Sprintf(`
		ORDER BY s.service, s.environment, s.id
		LIMIT $%d OFFSET $%d
	`, len(args)+1, len(args)+2), pageArgs...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []serviceMapEntry{}, 0, nil
		}
		return nil, 0, err
	}
	defer cancel()
	defer rows.Close()
	out := []serviceMapEntry{}
	for rows.Next() {
		item, err := scanServiceMap(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *item)
	}
	attachServiceFindingCounts(out)
	attachServiceEvalMeta(out)
	return out, total, nil
}

func attachServiceEvalMeta(items []serviceMapEntry) {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	meta := serviceEvalMetaForServices(ids)
	for i := range items {
		if row, ok := meta[items[i].ID]; ok {
			items[i].LastEvaluatedAt = row.lastEval
			items[i].ScheduleMinutes = row.schedule
			items[i].LastSLIState = row.sliState
			if row.hasSLI {
				bps := row.availabilityBPS
				items[i].LastAvailabilityBPS = &bps
			}
		}
	}
}

type serviceEvalMeta struct {
	lastEval        *string
	schedule        int
	availabilityBPS int
	sliState        string
	hasSLI          bool
}

func serviceEvalMetaForServices(ids []int) map[int]serviceEvalMeta {
	out := map[int]serviceEvalMeta{}
	if DB == nil || len(ids) == 0 {
		return out
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT m.service_id,
		       MAX(r.evaluated_at),
		       COALESCE(MAX(CASE WHEN m.enabled THEN m.schedule_minutes ELSE 0 END), 0)
		FROM service_monitors m
		LEFT JOIN monitor_evaluation_runs r ON r.monitor_id = m.id
		WHERE m.service_id IN (`+strings.Join(placeholders, ",")+`)
		GROUP BY m.service_id
	`, args...)
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, schedule int
		var evaluated sql.NullTime
		if rows.Scan(&id, &evaluated, &schedule) != nil {
			continue
		}
		row := serviceEvalMeta{schedule: schedule}
		if evaluated.Valid {
			stamp := evaluated.Time.UTC().Format(time.RFC3339)
			row.lastEval = &stamp
		}
		out[id] = row
	}
	attachAvailabilitySLI(out, ids, placeholders, args)
	return out
}

func attachAvailabilitySLI(out map[int]serviceEvalMeta, ids []int, placeholders []string, args []any) {
	if DB == nil || len(ids) == 0 {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT DISTINCT ON (m.service_id)
		       m.service_id, COALESCE(r.availability_bps, 0), COALESCE(r.state, '')
		FROM service_monitors m
		INNER JOIN monitor_evaluation_runs r ON r.monitor_id = m.id
		WHERE m.service_id IN (`+strings.Join(placeholders, ",")+`)
		  AND m.measurement_type = 'availability_sli'
		ORDER BY m.service_id, COALESCE(r.evaluated_at, r.created_at) DESC, r.id DESC
	`, args...)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, bps int
		var state string
		if rows.Scan(&id, &bps, &state) != nil {
			continue
		}
		row := out[id]
		row.availabilityBPS = bps
		row.sliState = state
		row.hasSLI = true
		out[id] = row
	}
}

func scanServiceMap(scanner interface {
	Scan(dest ...any) error
}) (*serviceMapEntry, error) {
	var item serviceMapEntry
	var projectID sql.NullInt64
	if err := scanner.Scan(&item.ID, &projectID, &item.ProjectName, &item.ProjectCode, &item.Service, &item.Repo, &item.Environment, &item.GrafanaUID, &item.PromQL, &item.DashboardURL, &item.MetricsURL, &item.Team, &item.Criticality, &item.SupportTeam, &item.EscalationRoute, &item.RunbookURL); err != nil {
		return nil, err
	}
	if projectID.Valid {
		value := int(projectID.Int64)
		item.ProjectID = &value
	}
	item.Criticality = normalizeServiceCriticality(item.Criticality)
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
	if item.Environment == "" {
		item.Environment = "production"
	}
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
			SET repo = $2, grafana_uid = $3, promql = $4, dashboard_url = $5, metrics_url = $6, team = $7,
			    criticality = $8, support_team = $9, escalation_route = $10, runbook_url = $11, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, item.Repo, item.GrafanaUID, item.PromQL, item.DashboardURL, item.MetricsURL, item.Team,
			normalizeServiceCriticality(item.Criticality), strings.TrimSpace(item.SupportTeam), strings.TrimSpace(item.EscalationRoute), strings.TrimSpace(item.RunbookURL)); err != nil {
			return nil, err
		}
		return getServiceMapByID(existingID)
	}
	err = queryRowContext(`
		INSERT INTO service_map (project_id, service, repo, environment, grafana_uid, promql, dashboard_url, metrics_url, team, criticality, support_team, escalation_route, runbook_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id
	`, projectAny, item.Service, item.Repo, item.Environment, item.GrafanaUID, item.PromQL, item.DashboardURL, item.MetricsURL, item.Team,
		normalizeServiceCriticality(item.Criticality), strings.TrimSpace(item.SupportTeam), strings.TrimSpace(item.EscalationRoute), strings.TrimSpace(item.RunbookURL)).Scan(&existingID)
	if err != nil {
		return nil, err
	}
	return getServiceMapByID(existingID)
}

func updateServiceMapByID(id int, item serviceMapEntry) (*serviceMapEntry, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	if id <= 0 {
		return nil, fmt.Errorf("invalid service id")
	}
	current, err := getServiceMapByID(id)
	if err != nil {
		return nil, err
	}
	item.Service = strings.TrimSpace(item.Service)
	item.Repo = strings.TrimSpace(item.Repo)
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	item.Team = strings.TrimSpace(item.Team)
	item.GrafanaUID = strings.TrimSpace(item.GrafanaUID)
	item.PromQL = strings.TrimSpace(item.PromQL)
	item.DashboardURL = strings.TrimSpace(item.DashboardURL)
	item.MetricsURL = strings.TrimSpace(item.MetricsURL)
	if item.Service == "" {
		return nil, fmt.Errorf("service name is required")
	}
	if item.Environment == "" {
		item.Environment = current.Environment
	}
	var projectAny any
	if item.ProjectID != nil && *item.ProjectID > 0 {
		projectAny = *item.ProjectID
	}
	if item.Criticality == "" {
		item.Criticality = current.Criticality
	}
	if _, err := execContext(`
		UPDATE service_map
		SET project_id = $2, service = $3, repo = $4, environment = $5, grafana_uid = $6, promql = $7, dashboard_url = $8, metrics_url = $9, team = $10,
		    criticality = $11, support_team = $12, escalation_route = $13, runbook_url = $14, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, projectAny, item.Service, item.Repo, item.Environment, item.GrafanaUID, item.PromQL, item.DashboardURL, item.MetricsURL, item.Team,
		normalizeServiceCriticality(item.Criticality), strings.TrimSpace(item.SupportTeam), strings.TrimSpace(item.EscalationRoute), strings.TrimSpace(item.RunbookURL)); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, fmt.Errorf("a service with that name already exists in this environment")
		}
		return nil, err
	}
	return getServiceMapByID(id)
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

func filterServicesVisible(userID int, items []serviceMapEntry) ([]serviceMapEntry, error) {
	if callerSeesEveryProject(userID) {
		return items, nil
	}
	visible, err := getVisibleProjectIDSetForUser(userID)
	if err != nil {
		return nil, err
	}
	kept := make([]serviceMapEntry, 0, len(items))
	for _, item := range items {
		if item.ProjectID != nil && visible[*item.ProjectID] {
			kept = append(kept, item)
		}
	}
	return kept, nil
}

func devopsServiceMapHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	switch r.Method {
	case "GET":
		if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		seeAll, visibleIDs, err := visibleServiceProjectIDs(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		monitored := requestMonitoredInventory(r)
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("view")), "summary") {
			folders, total, incomplete, setup, err := listServiceMapSummary(projectID, visibleIDs, !seeAll, monitored)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"folders": folders, "total": total, "incomplete": incomplete, "setup": setup, "status": "ok"})
			return
		}
		if strings.TrimSpace(r.URL.Query().Get("limit")) != "" {
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			envFilter := r.URL.Query().Get("environment")
			if monitored {
				envFilter = ""
			}
			items, total, err := listServiceMapPage(projectID, envFilter, r.URL.Query().Get("q"), r.URL.Query().Get("team"), visibleIDs, !seeAll, monitored, limit, offset)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"services": items, "total": total, "limit": 50, "offset": offset, "status": "ok"})
			return
		}
		envFilter := r.URL.Query().Get("environment")
		if monitored {
			envFilter = ""
		}
		items, err := listServiceMap(projectID, envFilter, r.URL.Query().Get("q"))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		if monitored {
			filtered := make([]serviceMapEntry, 0, len(items))
			for _, item := range items {
				if isMonitoredServiceEnvironment(item.Environment) {
					filtered = append(filtered, item)
				}
			}
			items = filtered
		}
		items, err = filterServicesVisible(userID, items)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"services": items, "status": "ok"})
	case "POST":
		userID, ok = requireDevopsManager(w, r)
		if !ok {
			return
		}
		capture, finish, handled := beginIdempotentPost(w, r, userID, "service")
		if handled {
			return
		}
		defer finish()
		w = capture
		var body serviceMapEntry
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.ProjectID != nil && !ensureProjectVisible(w, r, userID, *body.ProjectID) {
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
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	id, rest, err := parseServiceMonitoringPath(r.URL.Path)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid service id", err)
		return
	}
	if len(rest) > 0 {
		handleServiceMonitoringRoutes(w, r, userID, id, rest)
		return
	}
	switch r.Method {
	case "GET":
		item, err := getServiceMapByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "service not found", err)
			return
		}
		visible, err := projectPointerVisible(userID, item.ProjectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		if !visible {
			writeAPIError(w, r, http.StatusNotFound, "service not found", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"service": item, "status": "ok"})
	case "PATCH":
		userID, ok = requireDevopsManager(w, r)
		if !ok {
			return
		}
		current, err := getServiceMapByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "service not found", err)
			return
		}
		visible, visErr := projectPointerVisible(userID, current.ProjectID)
		if visErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", visErr)
			return
		}
		if !visible {
			writeAPIError(w, r, http.StatusNotFound, "service not found", nil)
			return
		}
		var body serviceMapEntry
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.ProjectID != nil && !ensureProjectVisible(w, r, userID, *body.ProjectID) {
			return
		}
		item, err := updateServiceMapByID(id, body)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			writeAPIError(w, r, status, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"service": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}
