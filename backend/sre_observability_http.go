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

type observabilityConnector struct {
	ID                   int     `json:"id"`
	ProjectID            *int    `json:"project_id,omitempty"`
	Name                 string  `json:"name"`
	SourceType           string  `json:"source_type"`
	GrafanaDatasourceUID string  `json:"grafana_datasource_uid,omitempty"`
	BaseURL              string  `json:"base_url,omitempty"`
	HasCredential        bool    `json:"has_credential"`
	Enabled              bool    `json:"enabled"`
	Status               string  `json:"status"`
	LastTestedAt         *string `json:"last_tested_at,omitempty"`
	LastError            string  `json:"last_error,omitempty"`
	IngestDelayMinutes   int     `json:"ingest_delay_minutes,omitempty"`
	TimeoutSeconds       int     `json:"timeout_seconds,omitempty"`
}

type serviceMonitorView struct {
	ID                 int          `json:"id"`
	ServiceID          int          `json:"service_id"`
	ProjectID          *int         `json:"project_id,omitempty"`
	Environment        string       `json:"environment"`
	Name               string       `json:"name"`
	MeasurementType    string       `json:"measurement_type"`
	ConnectorID        *int         `json:"connector_id,omitempty"`
	SourceType         string       `json:"source_type,omitempty"`
	Enabled            bool         `json:"enabled"`
	CurrentVersion     int          `json:"current_version"`
	LastKnownGood      int          `json:"last_known_good_version,omitempty"`
	ScheduleMinutes    int          `json:"schedule_minutes,omitempty"`
	IngestDelayMinutes int          `json:"ingest_delay_minutes,omitempty"`
	Owner              string       `json:"owner,omitempty"`
	QueryText          string       `json:"query_text"`
	QueryLanguage      string       `json:"query_language"`
	GoodField          string       `json:"good_field"`
	TotalField         string       `json:"total_field"`
	LatencyThreshold   float64      `json:"latency_threshold_ms,omitempty"`
	TargetBPS          int          `json:"target_bps"`
	WindowMinutes      int          `json:"window_minutes"`
	MinSamples         int          `json:"min_samples"`
	MinCoverageBPS     int          `json:"min_coverage_bps"`
	FreshnessMinutes   int          `json:"freshness_minutes"`
	WarningRule        findingRule  `json:"warning_rule"`
	CriticalRule       findingRule  `json:"critical_rule"`
	CalculationMode    string       `json:"calculation_mode"`
	Latest             *evalRunView `json:"latest,omitempty"`
}

type evalRunView struct {
	ID          int            `json:"id"`
	BatchID     int            `json:"batch_id"`
	MonitorID   int            `json:"monitor_id"`
	Version     int            `json:"version"`
	State       string         `json:"state"`
	Quality     string         `json:"quality"`
	Measurement sliMeasurement `json:"measurement"`
	SourceError string         `json:"source_error,omitempty"`
	EvaluatedAt *string        `json:"evaluated_at,omitempty"`
}

type evalBatchView struct {
	ID          int           `json:"id"`
	ServiceID   int           `json:"service_id"`
	Environment string        `json:"environment"`
	State       string        `json:"state"`
	AnchorAt    string        `json:"anchor_at"`
	Runs        []evalRunView `json:"runs"`
	Error       string        `json:"error,omitempty"`
	Mode        string        `json:"mode"`
}

type monitorFindingView struct {
	ID            int     `json:"id"`
	ServiceID     int     `json:"service_id"`
	MonitorID     int     `json:"monitor_id"`
	Environment   string  `json:"environment"`
	Severity      string  `json:"severity"`
	Lifecycle     string  `json:"lifecycle"`
	Title         string  `json:"title"`
	Explanation   string  `json:"explanation"`
	Observed      string  `json:"observed"`
	Expected      string  `json:"expected"`
	SourceType    string  `json:"source_type"`
	QueryVersion  int     `json:"query_version"`
	Owner         string  `json:"owner,omitempty"`
	AckNote       string  `json:"ack_note,omitempty"`
	FirstSeenAt   string  `json:"first_seen_at"`
	LastSeenAt    string  `json:"last_seen_at"`
	IncidentID    int     `json:"incident_id,omitempty"`
	EpisodeID     int     `json:"episode_id,omitempty"`
	LastEvaluated *string `json:"last_evaluated_at,omitempty"`
}

func parseServiceMonitoringPath(path string) (id int, rest []string, err error) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/devops/services/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 {
		return 0, nil, fmt.Errorf("invalid service id")
	}
	id, err = strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		return 0, nil, fmt.Errorf("invalid service id")
	}
	return id, parts[1:], nil
}

func loadVisibleService(w http.ResponseWriter, r *http.Request, userID, serviceID int) (*serviceMapEntry, bool) {
	item, err := getServiceMapByID(serviceID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "service not found", err)
		return nil, false
	}
	visible, visErr := projectPointerVisible(userID, item.ProjectID)
	if visErr != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load service", visErr)
		return nil, false
	}
	if !visible {
		writeAPIError(w, r, http.StatusNotFound, "service not found", nil)
		return nil, false
	}
	return item, true
}

func connectorPublic(id int, projectID *int, name, sourceType, datasource, baseURL, secretRef, status, lastErr string, lastTest *time.Time, delay, timeout int, enabled bool) observabilityConnector {
	item := observabilityConnector{
		ID: id, ProjectID: projectID, Name: name, SourceType: sourceType,
		GrafanaDatasourceUID: datasource, BaseURL: baseURL, HasCredential: strings.TrimSpace(secretRef) != "",
		Enabled: enabled, Status: status, LastError: lastErr, IngestDelayMinutes: delay, TimeoutSeconds: timeout,
	}
	if lastTest != nil && !lastTest.IsZero() {
		stamp := lastTest.UTC().Format(time.RFC3339)
		item.LastTestedAt = &stamp
	}
	return item
}

func listObservabilityConnectors(projectID int) ([]observabilityConnector, error) {
	if DB == nil {
		return []observabilityConnector{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, project_id, name, source_type, grafana_datasource_uid, COALESCE(base_url,''), secret_ref, status, last_tested_at, last_error,
		       COALESCE(ingest_delay_minutes,0), COALESCE(timeout_seconds,15), COALESCE(enabled, TRUE)
		FROM observability_connectors
		WHERE ($1 = 0 OR project_id = $1 OR project_id IS NULL)
		ORDER BY name, id
	`, projectID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []observabilityConnector{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []observabilityConnector{}
	for rows.Next() {
		var id int
		var project sql.NullInt64
		var name, sourceType, datasource, baseURL, secretRef, status, lastErr string
		var lastTest sql.NullTime
		var delay, timeout int
		var enabled bool
		if err := rows.Scan(&id, &project, &name, &sourceType, &datasource, &baseURL, &secretRef, &status, &lastTest, &lastErr, &delay, &timeout, &enabled); err != nil {
			return nil, err
		}
		var projectPtr *int
		if project.Valid {
			value := int(project.Int64)
			projectPtr = &value
		}
		var tested *time.Time
		if lastTest.Valid {
			tested = &lastTest.Time
		}
		out = append(out, connectorPublic(id, projectPtr, name, sourceType, datasource, baseURL, secretRef, status, lastErr, tested, delay, timeout, enabled))
	}
	return out, nil
}

func devopsObservabilityConnectorsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		items, err := listObservabilityConnectors(projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list connectors", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"connectors": items, "status": "ok"})
	case http.MethodPost:
		if _, ok = requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			ProjectID            int    `json:"project_id"`
			Name                 string `json:"name"`
			SourceType           string `json:"source_type"`
			GrafanaDatasourceUID string `json:"grafana_datasource_uid"`
			BaseURL              string `json:"base_url"`
			SecretRef            string `json:"secret_ref"`
			IngestDelayMinutes   int    `json:"ingest_delay_minutes"`
			TimeoutSeconds       int    `json:"timeout_seconds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		name := strings.TrimSpace(body.Name)
		source := strings.ToLower(strings.TrimSpace(body.SourceType))
		if name == "" || !supportedMonitorSource(source) {
			writeAPIError(w, r, http.StatusBadRequest, "name and a supported source type are required", nil)
			return
		}
		if body.ProjectID > 0 && !ensureProjectVisible(w, r, userID, body.ProjectID) {
			return
		}
		secretRef := strings.TrimSpace(body.SecretRef)
		if source != sourceFixture && secretRef != "" && !validSecretRef(secretRef) {
			writeAPIError(w, r, http.StatusBadRequest, "store a secret reference name, not the credential", nil)
			return
		}
		var projectAny any
		if body.ProjectID > 0 {
			projectAny = body.ProjectID
		}
		var id int
		timeout := body.TimeoutSeconds
		if timeout <= 0 {
			timeout = 15
		}
		if timeout > 30 {
			timeout = 30
		}
		delay := body.IngestDelayMinutes
		if delay < 0 {
			delay = 0
		}
		err := queryRowContext(`
			INSERT INTO observability_connectors (project_id, name, source_type, grafana_datasource_uid, base_url, secret_ref, ingest_delay_minutes, timeout_seconds, status, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'untested', $9)
			RETURNING id
		`, projectAny, name, source, strings.TrimSpace(body.GrafanaDatasourceUID), strings.TrimSpace(body.BaseURL), secretRef, delay, timeout, userID).Scan(&id)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save connector", err)
			return
		}
		items, _ := listObservabilityConnectors(body.ProjectID)
		for _, item := range items {
			if item.ID == id {
				_ = writeJSONResponse(w, http.StatusCreated, map[string]any{"connector": item, "status": "ok"})
				return
			}
		}
		_ = writeJSONResponse(w, http.StatusCreated, map[string]any{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsObservabilityConnectorDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/observability/connectors/"), "/")
	parts := strings.Split(rest, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid connector id", err)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPatch {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		saved, err := updateObservabilityConnector(id, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"connector": saved, "status": "ok"})
		return
	}
	if len(parts) == 2 && parts[1] == "test" && r.Method == http.MethodPost {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var source, secretRef, baseURL, datasource string
		var enabled bool
		if err := queryRowContext(`
			SELECT source_type, secret_ref, COALESCE(base_url,''), COALESCE(grafana_datasource_uid,''), COALESCE(enabled, TRUE)
			FROM observability_connectors WHERE id = $1
		`, id).Scan(&source, &secretRef, &baseURL, &datasource, &enabled); err != nil {
			writeAPIError(w, r, http.StatusNotFound, "connector not found", err)
			return
		}
		status := "ready"
		lastErr := ""
		if !enabled {
			status = "failed"
			lastErr = "connector is disabled"
		} else if source == sourceFixture {
			status = "ready"
		} else {
			_, _, execErr := executeConnectorQuery(connectorQuery{
				SourceType: source, SecretRef: secretRef, BaseURL: baseURL, DatasourceUID: datasource,
				Query: connectorProbeQuery(source), ConnectorID: id, GoodField: "good", TotalField: "total",
			})
			if execErr != nil {
				status = "failed"
				lastErr = execErr.Error()
			}
		}
		_, _ = execContext(`UPDATE observability_connectors SET status = $2, last_error = $3, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, status, lastErr)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"status": status, "error": lastErr, "has_credential": strings.TrimSpace(secretRef) != ""})
		return
	}
	writeMethodNotAllowed(w, r)
}

func updateObservabilityConnector(id int, r *http.Request) (*observabilityConnector, error) {
	var body struct {
		Name                 string `json:"name"`
		SourceType           string `json:"source_type"`
		GrafanaDatasourceUID string `json:"grafana_datasource_uid"`
		BaseURL              string `json:"base_url"`
		SecretRef            string `json:"secret_ref"`
		IngestDelayMinutes   int    `json:"ingest_delay_minutes"`
		Enabled              *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	var currentName, currentSource, currentUID, currentBase, currentSecret, currentStatus, currentErr string
	var currentDelay, currentTimeout int
	var currentEnabled bool
	var project sql.NullInt64
	var lastTest sql.NullTime
	if err := queryRowContext(`
		SELECT project_id, name, source_type, grafana_datasource_uid, COALESCE(base_url,''), secret_ref, status, last_error,
		       COALESCE(ingest_delay_minutes,0), COALESCE(timeout_seconds,15), COALESCE(enabled, TRUE), last_tested_at
		FROM observability_connectors WHERE id = $1
	`, id).Scan(&project, &currentName, &currentSource, &currentUID, &currentBase, &currentSecret, &currentStatus, &currentErr, &currentDelay, &currentTimeout, &currentEnabled, &lastTest); err != nil {
		return nil, fmt.Errorf("connector not found")
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = currentName
	}
	source := strings.ToLower(strings.TrimSpace(body.SourceType))
	if source == "" {
		source = currentSource
	}
	if !supportedMonitorSource(source) {
		return nil, fmt.Errorf("unsupported source type")
	}
	secretRef := strings.TrimSpace(body.SecretRef)
	if secretRef != "" && !validSecretRef(secretRef) {
		return nil, fmt.Errorf("store a secret reference name, not the credential")
	}
	if secretRef == "" {
		secretRef = currentSecret
	}
	enabled := currentEnabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	delay := body.IngestDelayMinutes
	if delay < 0 {
		delay = 0
	}
	_, err := execContext(`
		UPDATE observability_connectors
		SET name = $2, source_type = $3, grafana_datasource_uid = $4, base_url = $5, secret_ref = $6,
		    ingest_delay_minutes = $7, enabled = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, name, source, strings.TrimSpace(body.GrafanaDatasourceUID), strings.TrimSpace(body.BaseURL), secretRef, delay, enabled)
	if err != nil {
		return nil, err
	}
	var projectPtr *int
	if project.Valid {
		value := int(project.Int64)
		projectPtr = &value
	}
	var tested *time.Time
	if lastTest.Valid {
		tested = &lastTest.Time
	}
	item := connectorPublic(id, projectPtr, name, source, strings.TrimSpace(body.GrafanaDatasourceUID), strings.TrimSpace(body.BaseURL), secretRef, currentStatus, currentErr, tested, delay, currentTimeout, enabled)
	return &item, nil
}

func devopsMonitoringTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"templates": monitoringQueryTemplates(), "status": "ok"})
}

func handleServiceMonitoringRoutes(w http.ResponseWriter, r *http.Request, userID, serviceID int, rest []string) {
	item, ok := loadVisibleService(w, r, userID, serviceID)
	if !ok {
		return
	}
	if len(rest) == 0 {
		return
	}
	switch rest[0] {
	case "monitors":
		handleServiceMonitors(w, r, userID, item, rest[1:])
	case "monitoring":
		handleServiceMonitoringActions(w, r, userID, item, rest[1:])
	case "reliability":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		serveServiceReliability(w, r, item)
	case "guardrail":
		handleServiceGuardrail(w, r, userID, item, rest[1:])
	case "routing":
		handleServiceRouting(w, r, userID, item)
	case "environments":
		serveServiceEnvironmentMatrix(w, r, item)
	case "activity":
		serveServiceActivityTimeline(w, r, item)
	default:
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	}
}

func handleServiceMonitors(w http.ResponseWriter, r *http.Request, userID int, service *serviceMapEntry, rest []string) {
	if len(rest) == 0 {
		switch r.Method {
		case http.MethodGet:
			items, err := listServiceMonitors(service.ID, strings.TrimSpace(r.URL.Query().Get("environment")))
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to list monitors", err)
				return
			}
			_ = writeJSONResponse(w, http.StatusOK, map[string]any{"monitors": items, "mode": "on_demand", "status": "ok"})
		case http.MethodPost:
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			saved, err := saveServiceMonitor(userID, service, r)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			_ = writeJSONResponse(w, http.StatusCreated, map[string]any{"monitor": saved, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r)
		}
		return
	}
	if rest[0] == "preview" && r.Method == http.MethodPost {
		result, err := previewUnsavedMonitorQuery(service, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, result)
		return
	}
	monitorID, err := strconv.Atoi(rest[0])
	if err != nil || monitorID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid monitor id", err)
		return
	}
	if len(rest) == 1 && r.Method == http.MethodPatch {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		saved, err := updateServiceMonitor(userID, service, monitorID, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"monitor": saved, "status": "ok"})
		return
	}
	if len(rest) == 2 && rest[1] == "test" && r.Method == http.MethodPost {
		result, err := testServiceMonitor(service, monitorID, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, result)
		return
	}
	if len(rest) == 2 && rest[1] == "history" && r.Method == http.MethodGet {
		items, err := listMonitorHistory(monitorID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list history", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"history": items, "status": "ok"})
		return
	}
	if len(rest) == 2 && rest[1] == "versions" && r.Method == http.MethodGet {
		items, err := listMonitorVersions(monitorID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list versions", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"versions": items, "diff": diffMonitorVersions(items), "status": "ok"})
		return
	}
	if len(rest) == 2 && rest[1] == "rollback" && r.Method == http.MethodPost {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		saved, err := rollbackServiceMonitor(userID, service, monitorID, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"monitor": saved, "status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r)
}

func handleServiceMonitoringActions(w http.ResponseWriter, r *http.Request, userID int, service *serviceMapEntry, rest []string) {
	if len(rest) == 1 && rest[0] == "refresh" && r.Method == http.MethodPost {
		batch, status, err := enqueueMonitorRefresh(userID, service, r)
		if err != nil {
			writeAPIError(w, r, status, err.Error(), err)
			return
		}
		mode := "on_demand"
		if batch != nil && batch.Mode != "" {
			mode = batch.Mode
		}
		_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"evaluation": batch, "status": "accepted", "mode": mode})
		return
	}
	if len(rest) == 1 && rest[0] == "simulate" && r.Method == http.MethodPost {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		result, err := simulateServiceMonitorPolicy(service, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, result)
		return
	}
	if len(rest) == 1 && rest[0] == "episodes" && r.Method == http.MethodGet {
		items := listMonitorAlertEpisodes(service.ID, strings.TrimSpace(r.URL.Query().Get("environment")))
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"episodes": items, "status": "ok"})
		return
	}
	if len(rest) == 1 && rest[0] == "context" && r.Method == http.MethodGet {
		items := overlappingServiceChanges(service, r.URL.Query().Get("since"))
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"changes": items, "note": "Overlapping changes are a possible lead, not a proven cause.", "status": "ok"})
		return
	}
	if len(rest) == 1 && rest[0] == "findings" && r.Method == http.MethodGet {
		items, err := listMonitorFindings(service.ID, r.URL.Query().Get("environment"), r.URL.Query().Get("severity"), r.URL.Query().Get("lifecycle"))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list findings", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"findings": items, "status": "ok"})
		return
	}
	if len(rest) == 2 && rest[0] == "findings" && r.Method == http.MethodPatch {
		id, err := strconv.Atoi(rest[1])
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid finding id", err)
			return
		}
		item, err := acknowledgeMonitorFinding(userID, service.ID, id, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"finding": item, "status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r)
}

type monitorWriteBody struct {
	Name             string      `json:"name"`
	MeasurementType  string      `json:"measurement_type"`
	Environment      string      `json:"environment"`
	ConnectorID      int         `json:"connector_id"`
	Owner            string      `json:"owner"`
	Enabled          *bool       `json:"enabled"`
	QueryText        string      `json:"query_text"`
	QueryLanguage    string      `json:"query_language"`
	GoodField        string      `json:"good_field"`
	TotalField       string      `json:"total_field"`
	LatencyThreshold float64     `json:"latency_threshold_ms"`
	TargetBPS        int         `json:"target_bps"`
	WindowMinutes    int         `json:"window_minutes"`
	MinSamples       int         `json:"min_samples"`
	MinCoverageBPS   int         `json:"min_coverage_bps"`
	FreshnessMinutes int         `json:"freshness_minutes"`
	WarningRule      findingRule `json:"warning_rule"`
	CriticalRule     findingRule `json:"critical_rule"`
	CalculationMode  string      `json:"calculation_mode"`
	ExpectedVersion  int         `json:"expected_version"`
	ScheduleMinutes  int         `json:"schedule_minutes"`
	RollbackTo       int         `json:"rollback_to_version"`
}

func decodeMonitorBody(r *http.Request) (monitorWriteBody, error) {
	var body monitorWriteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return body, fmt.Errorf("invalid json")
	}
	return body, nil
}

func saveServiceMonitor(userID int, service *serviceMapEntry, r *http.Request) (*serviceMonitorView, error) {
	body, err := decodeMonitorBody(r)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(body.Name)
	measure := strings.TrimSpace(body.MeasurementType)
	if name == "" || measure == "" {
		return nil, fmt.Errorf("name and measurement type are required")
	}
	env := strings.TrimSpace(body.Environment)
	if env == "" {
		env = service.Environment
	}
	mode := strings.TrimSpace(body.CalculationMode)
	if mode == "" {
		mode = calcLocal
	}
	var id int
	err = queryRowContext(`
		INSERT INTO service_monitors (service_id, project_id, environment, name, measurement_type, connector_id, enabled, current_version, owner, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), FALSE, 1, $7, $8, $8)
		RETURNING id
	`, service.ID, nullableProject(service), env, name, measure, body.ConnectorID, strings.TrimSpace(body.Owner), userID).Scan(&id)
	if err != nil {
		return nil, err
	}
	if err := insertMonitorVersion(id, 1, userID, body); err != nil {
		return nil, err
	}
	if body.ScheduleMinutes > 0 {
		_, _ = execContext(`UPDATE service_monitors SET schedule_minutes = $2 WHERE id = $1`, id, body.ScheduleMinutes)
	}
	if body.Enabled != nil && *body.Enabled {
		if err := enableMonitorIfValid(id, body); err != nil {
			return nil, err
		}
	}
	return getServiceMonitor(id)
}

func updateServiceMonitor(userID int, service *serviceMapEntry, monitorID int, r *http.Request) (*serviceMonitorView, error) {
	current, err := getServiceMonitor(monitorID)
	if err != nil {
		return nil, err
	}
	if current.ServiceID != service.ID {
		return nil, fmt.Errorf("monitor not found")
	}
	body, err := decodeMonitorBody(r)
	if err != nil {
		return nil, err
	}
	if body.ExpectedVersion > 0 && body.ExpectedVersion != current.CurrentVersion {
		return nil, fmt.Errorf("this monitor was updated by someone else; reload and try again")
	}
	next := current.CurrentVersion + 1
	if err := insertMonitorVersion(monitorID, next, userID, body); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = current.Name
	}
	enabled := current.Enabled
	if body.Enabled != nil {
		if *body.Enabled {
			if err := enableMonitorIfValid(monitorID, body); err != nil {
				return nil, err
			}
			enabled = true
		} else {
			enabled = false
			_, _ = execContext(`UPDATE service_monitors SET enabled = FALSE WHERE id = $1`, monitorID)
		}
	}
	_, err = execContext(`
		UPDATE service_monitors
		SET name = $2, measurement_type = COALESCE(NULLIF($3, ''), measurement_type), connector_id = NULLIF($4, 0),
		    current_version = $5, owner = $6, enabled = $7, schedule_minutes = $8, updated_by = $9, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, monitorID, name, strings.TrimSpace(body.MeasurementType), body.ConnectorID, next, strings.TrimSpace(body.Owner), enabled, body.ScheduleMinutes, userID)
	if err != nil {
		return nil, err
	}
	return getServiceMonitor(monitorID)
}

func insertMonitorVersion(monitorID, version, userID int, body monitorWriteBody) error {
	warn, _ := json.Marshal(body.WarningRule)
	crit, _ := json.Marshal(body.CriticalRule)
	mode := strings.TrimSpace(body.CalculationMode)
	if mode == "" {
		mode = calcLocal
	}
	_, err := execContext(`
		INSERT INTO service_monitor_versions (
			monitor_id, version, query_text, query_language, good_field, total_field, latency_field, latency_unit,
			target_bps, window_minutes, latency_threshold_ms, min_samples, min_coverage_bps, freshness_minutes,
			warning_rule, critical_rule, calculation_mode, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'ms',$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17)
	`, monitorID, version, body.QueryText, body.QueryLanguage, body.GoodField, body.TotalField, body.GoodField,
		body.TargetBPS, body.WindowMinutes, body.LatencyThreshold, body.MinSamples, body.MinCoverageBPS, body.FreshnessMinutes,
		string(warn), string(crit), mode, userID)
	return err
}

func enableMonitorIfValid(monitorID int, body monitorWriteBody) error {
	if strings.TrimSpace(body.QueryText) == "" || strings.TrimSpace(body.GoodField) == "" || strings.TrimSpace(body.TotalField) == "" {
		return fmt.Errorf("enable requires a query and mapped good/total fields")
	}
	if body.MeasurementType == measureAvailability || body.MeasurementType == measureLatencySLI {
		if body.TargetBPS <= 0 || body.WindowMinutes <= 0 {
			return fmt.Errorf("enable requires an SLO target and reporting window")
		}
	}
	_, err := execContext(`UPDATE service_monitors SET enabled = TRUE WHERE id = $1`, monitorID)
	return err
}

func nullableProject(service *serviceMapEntry) any {
	if service.ProjectID != nil && *service.ProjectID > 0 {
		return *service.ProjectID
	}
	return nil
}

func listServiceMonitors(serviceID int, environment string) ([]serviceMonitorView, error) {
	if DB == nil {
		return []serviceMonitorView{}, nil
	}
	items := []serviceMonitorView{}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT m.id FROM service_monitors m
		WHERE m.service_id = $1 AND ($2 = '' OR LOWER(m.environment) = LOWER($2))
		ORDER BY m.name, m.id
	`, serviceID, environment)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return items, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	for _, id := range ids {
		item, err := getServiceMonitor(id)
		if err != nil {
			continue
		}
		items = append(items, *item)
	}
	return items, nil
}

func getServiceMonitor(id int) (*serviceMonitorView, error) {
	var item serviceMonitorView
	var project sql.NullInt64
	var connector sql.NullInt64
	var source sql.NullString
	var warnRaw, critRaw []byte
	err := queryRowContext(`
		SELECT m.id, m.service_id, m.project_id, m.environment, m.name, m.measurement_type, m.connector_id,
		       COALESCE(c.source_type, ''), m.enabled, m.current_version, COALESCE(m.last_known_good_version,0), COALESCE(m.schedule_minutes,0), COALESCE(m.ingest_delay_minutes,0), m.owner,
		       COALESCE(v.query_text,''), COALESCE(v.query_language,''), COALESCE(v.good_field,''), COALESCE(v.total_field,''),
		       COALESCE(v.latency_threshold_ms,0), COALESCE(v.target_bps,0), COALESCE(v.window_minutes,0),
		       COALESCE(v.min_samples,0), COALESCE(v.min_coverage_bps,0), COALESCE(v.freshness_minutes,0),
		       COALESCE(v.warning_rule, '{}'::jsonb), COALESCE(v.critical_rule, '{}'::jsonb), COALESCE(v.calculation_mode,'local')
		FROM service_monitors m
		LEFT JOIN observability_connectors c ON c.id = m.connector_id
		LEFT JOIN service_monitor_versions v ON v.monitor_id = m.id AND v.version = m.current_version
		WHERE m.id = $1
	`, id).Scan(&item.ID, &item.ServiceID, &project, &item.Environment, &item.Name, &item.MeasurementType, &connector,
		&source, &item.Enabled, &item.CurrentVersion, &item.LastKnownGood, &item.ScheduleMinutes, &item.IngestDelayMinutes, &item.Owner, &item.QueryText, &item.QueryLanguage, &item.GoodField, &item.TotalField,
		&item.LatencyThreshold, &item.TargetBPS, &item.WindowMinutes, &item.MinSamples, &item.MinCoverageBPS, &item.FreshnessMinutes,
		&warnRaw, &critRaw, &item.CalculationMode)
	if err != nil {
		return nil, fmt.Errorf("monitor not found")
	}
	if project.Valid {
		value := int(project.Int64)
		item.ProjectID = &value
	}
	if connector.Valid {
		value := int(connector.Int64)
		item.ConnectorID = &value
	}
	item.SourceType = source.String
	_ = json.Unmarshal(warnRaw, &item.WarningRule)
	_ = json.Unmarshal(critRaw, &item.CriticalRule)
	if latest := latestMonitorRun(id); latest != nil {
		item.Latest = latest
	}
	return &item, nil
}

func latestMonitorRun(monitorID int) *evalRunView {
	var run evalRunView
	var evaluated sql.NullTime
	var avail, budget, burn, cover int
	var good, total, bad, samples int64
	var window, covered int
	var observed sql.NullTime
	var reason, quality, state string
	err := queryRowContext(`
		SELECT id, batch_id, monitor_id, version, state, quality, good_count, total_count, bad_count,
		       availability_bps, budget_remaining_bps, burn_rate_milli, coverage_bps, sample_count,
		       window_minutes, covered_minutes, observed_at, evaluated_at, reason, source_error
		FROM monitor_evaluation_runs
		WHERE monitor_id = $1
		ORDER BY COALESCE(evaluated_at, created_at) DESC, id DESC
		LIMIT 1
	`, monitorID).Scan(&run.ID, &run.BatchID, &run.MonitorID, &run.Version, &state, &quality, &good, &total, &bad,
		&avail, &budget, &burn, &cover, &samples, &window, &covered, &observed, &evaluated, &reason, &run.SourceError)
	if err != nil {
		return nil
	}
	run.State = state
	run.Quality = quality
	run.Measurement = sliMeasurement{
		State: state, Quality: quality, Good: good, Total: total, Bad: bad,
		AvailabilityBPS: avail, BudgetRemainBPS: budget, BurnRateMilli: burn, CoverageBPS: cover,
		SampleCount: samples, WindowMinutes: window, CoveredMinutes: covered, Reason: reason,
	}
	if observed.Valid {
		run.Measurement.ObservedAt = observed.Time.UTC().Format(time.RFC3339)
	}
	if evaluated.Valid {
		stamp := evaluated.Time.UTC().Format(time.RFC3339)
		run.EvaluatedAt = &stamp
	}
	return &run
}

func testServiceMonitor(service *serviceMapEntry, monitorID int, r *http.Request) (map[string]any, error) {
	current, err := getServiceMonitor(monitorID)
	if err != nil || current.ServiceID != service.ID {
		return nil, fmt.Errorf("monitor not found")
	}
	var body struct {
		QueryText string `json:"query_text"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	query := strings.TrimSpace(body.QueryText)
	if query == "" {
		query = current.QueryText
	}
	exec := connectorQuery{SourceType: current.SourceType, Query: query, GoodField: current.GoodField, TotalField: current.TotalField, ServiceID: service.ID, Environment: current.Environment}
	if exec.SourceType == "" {
		exec.SourceType = sourceFixture
	}
	if current.ConnectorID != nil {
		exec.ConnectorID = *current.ConnectorID
		_ = queryRowContext(`SELECT COALESCE(secret_ref,''), COALESCE(base_url,''), COALESCE(grafana_datasource_uid,'') FROM observability_connectors WHERE id = $1`, *current.ConnectorID).Scan(&exec.SecretRef, &exec.BaseURL, &exec.DatasourceUID)
	}
	started := time.Now()
	sample, failState, execErr := executeConnectorQuery(exec)
	durationMS := time.Since(started).Milliseconds()
	if execErr != nil {
		return map[string]any{
			"status": failState, "error": execErr.Error(), "duration_ms": durationMS,
			"incidents_activated": false, "guardrails_activated": false,
		}, nil
	}
	measurement := computeAvailabilitySLI(sample, current.TargetBPS, current.WindowMinutes, current.MinSamples, current.MinCoverageBPS)
	if current.MeasurementType == measureLatencySLI {
		measurement = computeLatencySLI(sample, current.TargetBPS, current.LatencyThreshold, current.WindowMinutes, current.MinSamples)
	}
	preview := previewFindingOutcome(float64(measurement.BudgetRemainBPS)/100, current.WarningRule, current.CriticalRule)
	if current.MeasurementType == measureLatencySLI {
		preview = previewFindingOutcome(sample.LatencyMS, current.WarningRule, current.CriticalRule)
	}
	return map[string]any{
		"status": "succeeded", "duration_ms": durationMS, "measurement": measurement,
		"sample":          map[string]any{"good": sample.Good, "total": sample.Total, "bad": sample.Bad},
		"finding_preview": preview, "incidents_activated": false, "guardrails_activated": false,
		"mode": "on_demand",
	}, nil
}

func previewUnsavedMonitorQuery(service *serviceMapEntry, r *http.Request) (map[string]any, error) {
	var body struct {
		ConnectorID int    `json:"connector_id"`
		QueryText   string `json:"query_text"`
		GoodField   string `json:"good_field"`
		TotalField  string `json:"total_field"`
		SourceType  string `json:"source_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	query := strings.TrimSpace(body.QueryText)
	if query == "" {
		return nil, fmt.Errorf("query text is required")
	}
	exec := connectorQuery{SourceType: strings.TrimSpace(body.SourceType), Query: query, GoodField: body.GoodField, TotalField: body.TotalField, ServiceID: service.ID, Environment: service.Environment, ConnectorID: body.ConnectorID}
	if exec.SourceType == "" {
		exec.SourceType = sourceFixture
	}
	if body.ConnectorID > 0 {
		_ = queryRowContext(`SELECT COALESCE(secret_ref,''), COALESCE(base_url,''), COALESCE(grafana_datasource_uid,''), COALESCE(source_type,'') FROM observability_connectors WHERE id = $1`, body.ConnectorID).Scan(&exec.SecretRef, &exec.BaseURL, &exec.DatasourceUID, &exec.SourceType)
	}
	started := time.Now()
	sample, failState, execErr := executeConnectorQuery(exec)
	durationMS := time.Since(started).Milliseconds()
	if execErr != nil {
		return map[string]any{"status": failState, "error": execErr.Error(), "duration_ms": durationMS, "incidents_activated": false, "guardrails_activated": false}, nil
	}
	return map[string]any{
		"status": "succeeded", "duration_ms": durationMS,
		"sample":              map[string]any{"good": sample.Good, "total": sample.Total, "bad": sample.Bad},
		"incidents_activated": false, "guardrails_activated": false, "mode": "preview",
	}, nil
}

func simulateServiceMonitorPolicy(service *serviceMapEntry, r *http.Request) (map[string]any, error) {
	var body struct {
		MonitorID    int         `json:"monitor_id"`
		WarningRule  findingRule `json:"warning_rule"`
		CriticalRule findingRule `json:"critical_rule"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	if body.MonitorID <= 0 {
		return nil, fmt.Errorf("monitor_id is required")
	}
	monitor, err := getServiceMonitor(body.MonitorID)
	if err != nil || monitor.ServiceID != service.ID {
		return nil, fmt.Errorf("monitor not found")
	}
	warning := body.WarningRule
	if warning.Comparator == "" {
		warning = monitor.WarningRule
	}
	critical := body.CriticalRule
	if critical.Comparator == "" {
		critical = monitor.CriticalRule
	}
	history, _ := listMonitorHistory(body.MonitorID)
	runs := make([]sliMeasurement, 0, len(history))
	for _, item := range history {
		runs = append(runs, item.Measurement)
	}
	sim := simulateFindingHistory(runs, warning, critical)
	return map[string]any{"simulation": sim, "previews": sampleRulePreviews(warning, critical), "status": "ok"}, nil
}

func enqueueMonitorRefresh(userID int, service *serviceMapEntry, r *http.Request) (*evalBatchView, int, error) {
	var body struct {
		MonitorIDs  []int  `json:"monitor_ids"`
		Environment string `json:"environment"`
		RetryFailed bool   `json:"retry_failed"`
		BatchID     int    `json:"batch_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err.Error() != "EOF" {
		return nil, http.StatusBadRequest, fmt.Errorf("invalid json")
	}
	env := strings.TrimSpace(body.Environment)
	if env == "" {
		env = service.Environment
	}
	monitors, err := listServiceMonitors(service.ID, env)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	selected := []serviceMonitorView{}
	allow := map[int]bool{}
	for _, id := range body.MonitorIDs {
		allow[id] = true
	}
	failed := map[int]bool{}
	reuseAnchor := time.Time{}
	if body.RetryFailed {
		if body.BatchID > 0 {
			if batch, err := getEvalBatch(body.BatchID); err == nil && batch != nil {
				if parsed, err := time.Parse(time.RFC3339, batch.AnchorAt); err == nil {
					reuseAnchor = parsed
				}
				for _, run := range batch.Runs {
					if run.State == measureQueryFailed || run.Quality == qualityInvalid {
						failed[run.MonitorID] = true
					}
				}
			}
		} else {
			for _, monitor := range monitors {
				if monitor.Latest != nil && (monitor.Latest.State == measureQueryFailed || monitor.Latest.Measurement.State == measureQueryFailed) {
					failed[monitor.ID] = true
				}
			}
		}
	}
	for _, monitor := range monitors {
		if !monitor.Enabled {
			continue
		}
		if body.RetryFailed && !failed[monitor.ID] {
			continue
		}
		if !body.RetryFailed && len(allow) > 0 && !allow[monitor.ID] {
			continue
		}
		selected = append(selected, monitor)
	}
	mode := "on_demand"
	if body.RetryFailed {
		mode = "retry"
	}
	return enqueueSavedMonitorsAt(userID, service, env, selected, mode, reuseAnchor)
}

func runMonitorBatch(batchID int, monitors []serviceMonitorView) {
	key := ""
	defer func() {
		if key != "" {
			monitorEvalGate.done(key)
		}
	}()
	_ = queryRowContext(`SELECT coalesce_key FROM monitor_evaluation_batches WHERE id = $1`, batchID).Scan(&key)
	var anchor time.Time
	_ = queryRowContext(`SELECT COALESCE(anchor_at, CURRENT_TIMESTAMP) FROM monitor_evaluation_batches WHERE id = $1`, batchID).Scan(&anchor)
	if anchor.IsZero() {
		anchor = time.Now().UTC()
	}
	_, _ = execContext(`UPDATE monitor_evaluation_batches SET state = 'running', started_at = CURRENT_TIMESTAMP WHERE id = $1`, batchID)
	failed := 0
	for _, monitor := range monitors {
		state := "completed"
		sourceErr := ""
		query := connectorQuery{SourceType: monitor.SourceType, Query: monitor.QueryText, GoodField: monitor.GoodField, TotalField: monitor.TotalField, ServiceID: monitor.ServiceID, Environment: monitor.Environment}
		if query.SourceType == "" {
			query.SourceType = sourceFixture
		}
		delay := monitor.IngestDelayMinutes
		connectorEnabled := true
		if monitor.ConnectorID != nil {
			query.ConnectorID = *monitor.ConnectorID
			var connectorDelay int
			_ = queryRowContext(`SELECT COALESCE(secret_ref,''), COALESCE(base_url,''), COALESCE(grafana_datasource_uid,''), COALESCE(ingest_delay_minutes,0), COALESCE(enabled, TRUE) FROM observability_connectors WHERE id = $1`, *monitor.ConnectorID).Scan(&query.SecretRef, &query.BaseURL, &query.DatasourceUID, &connectorDelay, &connectorEnabled)
			if delay <= 0 {
				delay = connectorDelay
			}
		}
		if latest := latestMonitorRun(monitor.ID); latest != nil && latest.EvaluatedAt != nil {
			if existing, err := time.Parse(time.RFC3339, *latest.EvaluatedAt); err == nil && !newerResultWins(existing, anchor) {
				continue
			}
		}
		var sample mappedSample
		var failState string
		var execErr error
		if !connectorEnabled {
			failState = measureQueryFailed
			execErr = fmt.Errorf("connector is disabled")
		} else {
			sample, failState, execErr = executeConnectorQuery(query)
		}
		measurement := sliMeasurement{State: measureUnknown, Quality: qualityInvalid, Reason: "Not evaluated."}
		if execErr != nil {
			state = "failed"
			sourceErr = execErr.Error()
			measurement.State = failState
			if measurement.State == "" {
				measurement.State = measureQueryFailed
			}
			measurement.Reason = sourceErr
			failed++
		} else {
			measurement = measureMonitor(monitor, sample)
			if measurement.Quality == qualityValid {
				_, _ = execContext(`UPDATE service_monitors SET last_known_good_version = current_version WHERE id = $1`, monitor.ID)
			}
		}
		if through := evaluatedThrough(anchor, delay); !through.IsZero() {
			measurement.ObservedAt = through.UTC().Format(time.RFC3339)
		}
		var runID int
		_ = queryRowContext(`
			INSERT INTO monitor_evaluation_runs (
				batch_id, monitor_id, version, state, quality, measurement_state, good_count, total_count, bad_count,
				availability_bps, budget_remaining_bps, burn_rate_milli, coverage_bps, sample_count, window_minutes, covered_minutes,
				observed_at, evaluated_at, reason, source_error
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NULLIF($17,'')::timestamptz, $20, $18, $19)
			RETURNING id
		`, batchID, monitor.ID, monitor.CurrentVersion, measurement.State, measurement.Quality, measurement.State,
			measurement.Good, measurement.Total, measurement.Bad, measurement.AvailabilityBPS, measurement.BudgetRemainBPS,
			measurement.BurnRateMilli, measurement.CoverageBPS, measurement.SampleCount, measurement.WindowMinutes, measurement.CoveredMinutes,
			measurement.ObservedAt, measurement.Reason, sourceErr, anchor.UTC()).Scan(&runID)
		upsertMonitorFinding(monitor, runID, measurement, sample)
		_ = state
	}
	final := "completed"
	if failed == len(monitors) {
		final = "failed"
	} else if failed > 0 {
		final = "partial"
	}
	_, _ = execContext(`UPDATE monitor_evaluation_batches SET state = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`, batchID, final)
}

func upsertMonitorFinding(monitor serviceMonitorView, runID int, measurement sliMeasurement, sample mappedSample) {
	metric := float64(measurement.BudgetRemainBPS) / 100
	if monitor.MeasurementType == measureLatencySLI {
		metric = sample.LatencyMS
	}
	severity, title, explanation := evaluateFindingRules(measurement.State, metric, monitor.WarningRule, monitor.CriticalRule)
	identity := fmt.Sprintf("monitor:%d:%s", monitor.ID, monitor.MeasurementType)
	if severity == "" {
		_, _ = execContext(`
			UPDATE monitor_findings
			SET lifecycle = CASE WHEN lifecycle = 'resolved' THEN lifecycle ELSE 'resolved' END,
			    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
			    last_evaluated_at = CURRENT_TIMESTAMP
			WHERE monitor_id = $1 AND identity_key = $2 AND lifecycle <> 'resolved'
		`, monitor.ID, identity)
		return
	}
	observed := fmt.Sprintf("%d good / %d total (%.2f%%)", measurement.Good, measurement.Total, float64(measurement.AvailabilityBPS)/100)
	expected := fmt.Sprintf("target %.2f%% over %d minutes", float64(monitor.TargetBPS)/100, monitor.WindowMinutes)
	if explanation == "" {
		explanation = measurement.Reason
	}
	_, _ = execContext(`
		INSERT INTO monitor_findings (
			service_id, monitor_id, environment, identity_key, severity, lifecycle, title, explanation,
			observed, expected, source_type, query_version, evaluation_run_id, last_evaluated_at
		) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12, CURRENT_TIMESTAMP)
		ON CONFLICT (service_id, identity_key) DO UPDATE SET
			severity = EXCLUDED.severity,
			title = EXCLUDED.title,
			explanation = EXCLUDED.explanation,
			observed = EXCLUDED.observed,
			expected = EXCLUDED.expected,
			query_version = EXCLUDED.query_version,
			evaluation_run_id = EXCLUDED.evaluation_run_id,
			last_seen_at = CURRENT_TIMESTAMP,
			last_evaluated_at = CURRENT_TIMESTAMP,
			lifecycle = CASE WHEN monitor_findings.lifecycle = 'acknowledged' THEN 'acknowledged' ELSE 'open' END,
			resolved_at = NULL
	`, monitor.ServiceID, monitor.ID, monitor.Environment, identity, severity, title, explanation, observed, expected, monitor.SourceType, monitor.CurrentVersion, runID)
}

func getEvalBatch(id int) (*evalBatchView, error) {
	var item evalBatchView
	var finished sql.NullTime
	var anchor time.Time
	err := queryRowContext(`
		SELECT id, service_id, environment, state, anchor_at, error FROM monitor_evaluation_batches WHERE id = $1
	`, id).Scan(&item.ID, &item.ServiceID, &item.Environment, &item.State, &anchor, &item.Error)
	if err != nil {
		return nil, err
	}
	item.AnchorAt = anchor.UTC().Format(time.RFC3339)
	item.Mode = "on_demand"
	_ = finished
	rows, cancel, err := queryRowsWithTimeout(`SELECT id FROM monitor_evaluation_runs WHERE batch_id = $1 ORDER BY id`, id)
	if err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var runID int
			if rows.Scan(&runID) == nil {
				if latest := runViewByID(runID); latest != nil {
					item.Runs = append(item.Runs, *latest)
				}
			}
		}
	}
	return &item, nil
}

func runViewByID(id int) *evalRunView {
	var run evalRunView
	var evaluated sql.NullTime
	var avail, budget, burn, cover int
	var good, total, bad, samples int64
	var window, covered int
	var observed sql.NullTime
	var reason, quality, state string
	err := queryRowContext(`
		SELECT id, batch_id, monitor_id, version, state, quality, good_count, total_count, bad_count,
		       availability_bps, budget_remaining_bps, burn_rate_milli, coverage_bps, sample_count,
		       window_minutes, covered_minutes, observed_at, evaluated_at, reason, source_error
		FROM monitor_evaluation_runs
		WHERE id = $1
	`, id).Scan(&run.ID, &run.BatchID, &run.MonitorID, &run.Version, &state, &quality, &good, &total, &bad,
		&avail, &budget, &burn, &cover, &samples, &window, &covered, &observed, &evaluated, &reason, &run.SourceError)
	if err != nil {
		return nil
	}
	run.State = state
	run.Quality = quality
	run.Measurement = sliMeasurement{
		State: state, Quality: quality, Good: good, Total: total, Bad: bad,
		AvailabilityBPS: avail, BudgetRemainBPS: budget, BurnRateMilli: burn, CoverageBPS: cover,
		SampleCount: samples, WindowMinutes: window, CoveredMinutes: covered, Reason: reason,
	}
	if observed.Valid {
		run.Measurement.ObservedAt = observed.Time.UTC().Format(time.RFC3339)
	}
	if evaluated.Valid {
		stamp := evaluated.Time.UTC().Format(time.RFC3339)
		run.EvaluatedAt = &stamp
	}
	return &run
}

func devopsMonitoringEvaluationHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	id, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/monitoring/evaluations/"), "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid evaluation id", err)
		return
	}
	view, err := getEvalBatch(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "evaluation not found", err)
		return
	}
	if _, ok := loadVisibleService(w, r, userID, view.ServiceID); !ok {
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"evaluation": view, "status": "ok"})
}

func listMonitorFindings(serviceID int, environment, severity, lifecycle string) ([]monitorFindingView, error) {
	if DB == nil {
		return []monitorFindingView{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, service_id, monitor_id, environment, severity, lifecycle, title, explanation, observed, expected,
		       source_type, query_version, owner, ack_note, first_seen_at, last_seen_at, last_evaluated_at, COALESCE(incident_id,0), COALESCE(episode_id,0)
		FROM monitor_findings
		WHERE service_id = $1
		  AND ($2 = '' OR LOWER(environment) = LOWER($2))
		  AND ($3 = '' OR severity = $3)
		  AND ($4 = '' OR lifecycle = $4)
		ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC, id DESC
	`, serviceID, environment, severity, lifecycle)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []monitorFindingView{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []monitorFindingView{}
	for rows.Next() {
		var item monitorFindingView
		var first, last time.Time
		var evaluated sql.NullTime
		var monitorID sql.NullInt64
		if err := rows.Scan(&item.ID, &item.ServiceID, &monitorID, &item.Environment, &item.Severity, &item.Lifecycle, &item.Title, &item.Explanation, &item.Observed, &item.Expected, &item.SourceType, &item.QueryVersion, &item.Owner, &item.AckNote, &first, &last, &evaluated, &item.IncidentID, &item.EpisodeID); err != nil {
			return nil, err
		}
		if monitorID.Valid {
			item.MonitorID = int(monitorID.Int64)
		}
		item.FirstSeenAt = first.UTC().Format(time.RFC3339)
		item.LastSeenAt = last.UTC().Format(time.RFC3339)
		if evaluated.Valid {
			stamp := evaluated.Time.UTC().Format(time.RFC3339)
			item.LastEvaluated = &stamp
		}
		out = append(out, item)
	}
	return out, nil
}

type monitorFindingListItem struct {
	ID            int     `json:"id"`
	ServiceID     int     `json:"service_id"`
	Service       string  `json:"service"`
	ProjectID     *int    `json:"project_id,omitempty"`
	ProjectName   string  `json:"project_name,omitempty"`
	MonitorID     int     `json:"monitor_id,omitempty"`
	Environment   string  `json:"environment"`
	Severity      string  `json:"severity"`
	Lifecycle     string  `json:"lifecycle"`
	Title         string  `json:"title"`
	Explanation   string  `json:"explanation"`
	Observed      string  `json:"observed"`
	Expected      string  `json:"expected"`
	SourceType    string  `json:"source_type"`
	FirstSeenAt   string  `json:"first_seen_at"`
	LastSeenAt    string  `json:"last_seen_at"`
	LastEvaluated *string `json:"last_evaluated_at,omitempty"`
	IncidentID    int     `json:"incident_id,omitempty"`
}

func listVisibleMonitorFindings(userID int, severity, lifecycle, environment string) ([]monitorFindingListItem, error) {
	if DB == nil {
		return []monitorFindingListItem{}, nil
	}
	severity = strings.ToLower(strings.TrimSpace(severity))
	lifecycle = strings.ToLower(strings.TrimSpace(lifecycle))
	environment = strings.TrimSpace(environment)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT f.id, f.service_id, COALESCE(s.service,''), s.project_id, COALESCE(p.name,''), f.monitor_id, COALESCE(f.environment,''),
		       COALESCE(f.severity,''), COALESCE(f.lifecycle,''), COALESCE(f.title,''), COALESCE(f.explanation,''), COALESCE(f.observed,''),
		       COALESCE(f.expected,''), COALESCE(f.source_type,''), f.first_seen_at, f.last_seen_at, f.last_evaluated_at, COALESCE(f.incident_id,0)
		FROM monitor_findings f
		JOIN service_map s ON s.id = f.service_id
		LEFT JOIN projects p ON p.id = s.project_id
		WHERE ($1 = '' OR LOWER(f.severity) = $1)
		  AND ($2 = '' OR LOWER(f.lifecycle) = $2)
		  AND ($3 = '' OR LOWER(f.environment) = LOWER($3))
		ORDER BY CASE LOWER(f.severity) WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.last_seen_at DESC, f.id DESC
		LIMIT 200
	`, severity, lifecycle, environment)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []monitorFindingListItem{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	seeAll := callerSeesEveryProject(userID)
	visible := map[int]bool{}
	if !seeAll {
		set, visErr := getVisibleProjectIDSetForUser(userID)
		if visErr != nil {
			return nil, visErr
		}
		visible = set
	}
	out := []monitorFindingListItem{}
	for rows.Next() {
		var item monitorFindingListItem
		var projectID sql.NullInt64
		var monitorID sql.NullInt64
		var first, last time.Time
		var evaluated sql.NullTime
		if err := rows.Scan(&item.ID, &item.ServiceID, &item.Service, &projectID, &item.ProjectName, &monitorID, &item.Environment, &item.Severity, &item.Lifecycle, &item.Title, &item.Explanation, &item.Observed, &item.Expected, &item.SourceType, &first, &last, &evaluated, &item.IncidentID); err != nil {
			return nil, err
		}
		if projectID.Valid {
			pid := int(projectID.Int64)
			item.ProjectID = &pid
			if !seeAll && !visible[pid] {
				continue
			}
		} else if !seeAll {
			continue
		}
		if monitorID.Valid {
			item.MonitorID = int(monitorID.Int64)
		}
		item.FirstSeenAt = first.UTC().Format(time.RFC3339)
		item.LastSeenAt = last.UTC().Format(time.RFC3339)
		if evaluated.Valid {
			stamp := evaluated.Time.UTC().Format(time.RFC3339)
			item.LastEvaluated = &stamp
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func devopsMonitorFindingsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	lifecycle := strings.TrimSpace(r.URL.Query().Get("lifecycle"))
	if lifecycle == "" && r.URL.Query().Get("open") == "1" {
		lifecycle = lifecycleOpen
	}
	items, err := listVisibleMonitorFindings(userID, r.URL.Query().Get("severity"), lifecycle, r.URL.Query().Get("environment"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list findings", err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"findings": items, "status": "ok"})
}

func findingIncidentLink(current, next int) int {
	if next <= 0 || current > 0 {
		return current
	}
	return next
}

func attachIncidentToMonitorFinding(userID, findingID, incidentID int) {
	if DB == nil || findingID <= 0 || incidentID <= 0 {
		return
	}
	var serviceID, current int
	if err := queryRowContext(`SELECT service_id, COALESCE(incident_id, 0) FROM monitor_findings WHERE id = $1`, findingID).Scan(&serviceID, &current); err != nil {
		return
	}
	if findingIncidentLink(current, incidentID) == current {
		return
	}
	item, err := getServiceMapByID(serviceID)
	if err != nil || item == nil {
		return
	}
	visible, visErr := projectPointerVisible(userID, item.ProjectID)
	if visErr != nil || !visible {
		return
	}
	_, _ = execContext(`UPDATE monitor_findings SET incident_id = $2 WHERE id = $1 AND COALESCE(incident_id, 0) = 0`, findingID, incidentID)
}

func acknowledgeMonitorFinding(userID, serviceID, findingID int, r *http.Request) (*monitorFindingView, error) {
	var body struct {
		Owner      string `json:"owner"`
		Note       string `json:"note"`
		Ack        bool   `json:"acknowledge"`
		Resolve    bool   `json:"resolve"`
		IncidentID int    `json:"incident_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	if body.Resolve {
		_, err := execContext(`
			UPDATE monitor_findings
			SET lifecycle = 'resolved',
			    owner = COALESCE(NULLIF($3, ''), owner),
			    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
			WHERE id = $1 AND service_id = $2 AND lifecycle <> 'resolved'
		`, findingID, serviceID, strings.TrimSpace(body.Owner))
		if err != nil {
			return nil, err
		}
	} else if body.Ack {
		_, err := execContext(`
			UPDATE monitor_findings
			SET lifecycle = CASE WHEN lifecycle = 'resolved' THEN lifecycle ELSE 'acknowledged' END,
			    owner = COALESCE(NULLIF($3, ''), owner),
			    ack_note = $4,
			    acked_by = $5,
			    acked_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND service_id = $2
		`, findingID, serviceID, strings.TrimSpace(body.Owner), strings.TrimSpace(body.Note), userID)
		if err != nil {
			return nil, err
		}
	} else if strings.TrimSpace(body.Owner) != "" {
		_, err := execContext(`UPDATE monitor_findings SET owner = $3 WHERE id = $1 AND service_id = $2`, findingID, serviceID, strings.TrimSpace(body.Owner))
		if err != nil {
			return nil, err
		}
	}
	if body.IncidentID > 0 {
		_, err := execContext(`
			UPDATE monitor_findings
			SET incident_id = $3
			WHERE id = $1 AND service_id = $2 AND COALESCE(incident_id, 0) = 0
		`, findingID, serviceID, body.IncidentID)
		if err != nil {
			return nil, err
		}
	}
	items, err := listMonitorFindings(serviceID, "", "", "")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == findingID {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("finding not found")
}

func serveServiceReliability(w http.ResponseWriter, r *http.Request, service *serviceMapEntry) {
	env := strings.TrimSpace(r.URL.Query().Get("environment"))
	monitors, _ := listServiceMonitors(service.ID, env)
	findings, _ := listMonitorFindings(service.ID, env, "", lifecycleOpen)
	cards := map[string]any{}
	for _, monitor := range monitors {
		if monitor.Latest == nil {
			cards[monitor.MeasurementType] = map[string]any{"state": measureUnknown, "reason": "Not evaluated yet.", "monitor_id": monitor.ID}
			continue
		}
		cards[monitor.MeasurementType] = monitor.Latest.Measurement
	}
	critical, warning := 0, 0
	for _, finding := range findings {
		if finding.Lifecycle == lifecycleResolved {
			continue
		}
		if finding.Severity == findingCritical {
			critical++
		}
		if finding.Severity == findingWarning {
			warning++
		}
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"service_id":    service.ID,
		"environment":   service.Environment,
		"criticality":   service.Criticality,
		"mode":          "on_demand",
		"scorecards":    cards,
		"open_critical": critical,
		"open_warning":  warning,
		"monitors":      monitors,
		"status":        "ok",
	})
}

func findingCountsForServices(ids []int) map[int][2]int {
	out := map[int][2]int{}
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
		SELECT service_id,
		       COUNT(*) FILTER (WHERE lifecycle <> 'resolved' AND severity = 'critical'),
		       COUNT(*) FILTER (WHERE lifecycle <> 'resolved' AND severity = 'warning')
		FROM monitor_findings
		WHERE service_id IN (`+strings.Join(placeholders, ",")+`)
		GROUP BY service_id
	`, args...)
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, crit, warn int
		if rows.Scan(&id, &crit, &warn) == nil {
			out[id] = [2]int{crit, warn}
		}
	}
	return out
}

func measureMonitor(monitor serviceMonitorView, sample mappedSample) sliMeasurement {
	switch monitor.MeasurementType {
	case measureLatencySLI:
		return computeLatencySLI(sample, monitor.TargetBPS, monitor.LatencyThreshold, monitor.WindowMinutes, monitor.MinSamples)
	case measurePercentiles:
		return computePercentileView(sample, monitor.LatencyThreshold)
	case measureProvider:
		return computeProviderSLI(sample, monitor.TargetBPS, monitor.WindowMinutes)
	default:
		return computeAvailabilitySLI(sample, monitor.TargetBPS, monitor.WindowMinutes, monitor.MinSamples, monitor.MinCoverageBPS)
	}
}

type monitorVersionView struct {
	Version         int    `json:"version"`
	QueryText       string `json:"query_text"`
	QueryLanguage   string `json:"query_language"`
	GoodField       string `json:"good_field"`
	TotalField      string `json:"total_field"`
	TargetBPS       int    `json:"target_bps"`
	WindowMinutes   int    `json:"window_minutes"`
	CalculationMode string `json:"calculation_mode"`
	CreatedAt       string `json:"created_at"`
}

func listMonitorVersions(monitorID int) ([]monitorVersionView, error) {
	if DB == nil {
		return []monitorVersionView{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT version, COALESCE(query_text,''), COALESCE(query_language,''), COALESCE(good_field,''), COALESCE(total_field,''),
		       COALESCE(target_bps,0), COALESCE(window_minutes,0), COALESCE(calculation_mode,'local'), created_at
		FROM service_monitor_versions WHERE monitor_id = $1 ORDER BY version DESC
	`, monitorID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []monitorVersionView{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []monitorVersionView{}
	for rows.Next() {
		var item monitorVersionView
		var created time.Time
		if err := rows.Scan(&item.Version, &item.QueryText, &item.QueryLanguage, &item.GoodField, &item.TotalField, &item.TargetBPS, &item.WindowMinutes, &item.CalculationMode, &created); err != nil {
			return nil, err
		}
		item.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, item)
	}
	return out, nil
}

func diffMonitorVersions(items []monitorVersionView) []string {
	if len(items) < 2 {
		return []string{"No previous version to compare."}
	}
	current, previous := items[0], items[1]
	changes := []string{}
	if current.QueryText != previous.QueryText {
		changes = append(changes, "Query text changed.")
	}
	if current.GoodField != previous.GoodField || current.TotalField != previous.TotalField {
		changes = append(changes, "Field mapping changed.")
	}
	if current.TargetBPS != previous.TargetBPS {
		changes = append(changes, fmt.Sprintf("Target changed from %d to %d bps.", previous.TargetBPS, current.TargetBPS))
	}
	if current.WindowMinutes != previous.WindowMinutes {
		changes = append(changes, "Reporting window changed.")
	}
	if current.CalculationMode != previous.CalculationMode {
		changes = append(changes, "Calculation mode changed.")
	}
	if len(changes) == 0 {
		return []string{"No material query or objective changes between the latest two versions."}
	}
	return changes
}

func overlappingServiceChanges(service *serviceMapEntry, since string) []map[string]any {
	out := []map[string]any{}
	if service == nil {
		return out
	}
	cutoff := time.Now().UTC().Add(-30 * 24 * time.Hour)
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(since)); err == nil {
		cutoff = parsed
	}
	projectID := 0
	if service.ProjectID != nil {
		projectID = *service.ProjectID
	}
	items, err := listChangeRequests(projectID, service.Environment, "", "")
	if err != nil {
		return out
	}
	for _, item := range items {
		if !strings.EqualFold(item.Service, service.Service) && item.Service != "" {
			continue
		}
		if item.CreatedAt.Before(cutoff) {
			continue
		}
		out = append(out, map[string]any{
			"id":            item.ID,
			"change_number": item.ChangeNumber,
			"title":         item.Title,
			"sha":           item.SHA,
			"status":        item.Status,
			"created_at":    item.CreatedAt.UTC().Format(time.RFC3339),
		})
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func listMonitorHistory(monitorID int) ([]evalRunView, error) {
	if DB == nil {
		return []evalRunView{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT id FROM monitor_evaluation_runs WHERE monitor_id = $1 ORDER BY COALESCE(evaluated_at, created_at) DESC, id DESC LIMIT 50`, monitorID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []evalRunView{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []evalRunView{}
	for rows.Next() {
		var id int
		if rows.Scan(&id) != nil {
			continue
		}
		if item := runViewByID(id); item != nil {
			out = append(out, *item)
		}
	}
	return out, nil
}

func rollbackServiceMonitor(userID int, service *serviceMapEntry, monitorID int, r *http.Request) (*serviceMonitorView, error) {
	current, err := getServiceMonitor(monitorID)
	if err != nil || current.ServiceID != service.ID {
		return nil, fmt.Errorf("monitor not found")
	}
	var body monitorWriteBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	version := body.RollbackTo
	if version <= 0 {
		version = current.LastKnownGood
	}
	if version <= 0 {
		return nil, fmt.Errorf("no last-known-good version to restore")
	}
	var queryText, language, goodField, totalField, mode string
	var target, window, minSamples, minCoverage, fresh int
	var latency float64
	var warnRaw, critRaw []byte
	err = queryRowContext(`
		SELECT query_text, query_language, good_field, total_field, target_bps, window_minutes, latency_threshold_ms,
		       min_samples, min_coverage_bps, freshness_minutes, warning_rule, critical_rule, calculation_mode
		FROM service_monitor_versions WHERE monitor_id = $1 AND version = $2
	`, monitorID, version).Scan(&queryText, &language, &goodField, &totalField, &target, &window, &latency, &minSamples, &minCoverage, &fresh, &warnRaw, &critRaw, &mode)
	if err != nil {
		return nil, fmt.Errorf("version not found")
	}
	restored := monitorWriteBody{
		Name: current.Name, MeasurementType: current.MeasurementType, QueryText: queryText, QueryLanguage: language,
		GoodField: goodField, TotalField: totalField, TargetBPS: target, WindowMinutes: window, LatencyThreshold: latency,
		MinSamples: minSamples, MinCoverageBPS: minCoverage, FreshnessMinutes: fresh, CalculationMode: mode,
	}
	_ = json.Unmarshal(warnRaw, &restored.WarningRule)
	_ = json.Unmarshal(critRaw, &restored.CriticalRule)
	next := current.CurrentVersion + 1
	if err := insertMonitorVersion(monitorID, next, userID, restored); err != nil {
		return nil, err
	}
	_, err = execContext(`UPDATE service_monitors SET current_version = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, monitorID, next, userID)
	if err != nil {
		return nil, err
	}
	return getServiceMonitor(monitorID)
}

func handleServiceGuardrail(w http.ResponseWriter, r *http.Request, userID int, service *serviceMapEntry, rest []string) {
	if len(rest) > 0 {
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
		return
	}
	switch r.Method {
	case http.MethodGet:
		policy := loadGuardrailPolicy(service.ID, service.Environment)
		preview := evaluateServiceGuardrail(service, "")
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"policy": policy, "preview": preview, "latest": latestServiceGuardrailDecision(service.ID, service.Environment), "status": "ok"})
	case http.MethodPatch, http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body monitorGuardrailPolicy
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		saved := saveGuardrailPolicy(userID, service, body)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"policy": saved, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func handleServiceRouting(w http.ResponseWriter, r *http.Request, userID int, service *serviceMapEntry) {
	switch r.Method {
	case http.MethodGet:
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"routing": loadMonitorRouting(service.ID, service.Environment), "status": "ok"})
	case http.MethodPatch, http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body monitorRoutingPolicy
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		saved := saveMonitorRouting(userID, service, body)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"routing": saved, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}
