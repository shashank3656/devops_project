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

type changeRequestRecord struct {
	ID                    int             `json:"id"`
	ChangeNumber          string          `json:"change_number"`
	ProjectID             *int            `json:"project_id,omitempty"`
	ProjectName           string          `json:"project_name,omitempty"`
	ProjectCode           string          `json:"project_code,omitempty"`
	Service               string          `json:"service"`
	Environment           string          `json:"environment"`
	Repo                  string          `json:"repo"`
	PRNumber              int             `json:"pr_number"`
	PRURL                 string          `json:"pr_url,omitempty"`
	SHA                   string          `json:"sha"`
	PreviousSHA           string          `json:"previous_sha,omitempty"`
	Title                 string          `json:"title"`
	Author                string          `json:"author,omitempty"`
	Summary               string          `json:"summary,omitempty"`
	Files                 []string        `json:"files"`
	PipelineURL           string          `json:"pipeline_url,omitempty"`
	ChangeType            string          `json:"change_type"`
	Status                string          `json:"status"`
	WatchMinutes          int             `json:"watch_minutes"`
	WatchStartedAt        *time.Time      `json:"watch_started_at,omitempty"`
	WatchUntil            *time.Time      `json:"watch_until,omitempty"`
	RequestID             *int            `json:"request_id,omitempty"`
	LinkedIncidents       int             `json:"linked_incidents"`
	Baseline              *serviceMetrics `json:"baseline,omitempty"`
	LatestMetrics         *serviceMetrics `json:"latest_metrics,omitempty"`
	WatchRemainingMinutes int             `json:"watch_remaining_minutes"`
	RollbackHint          string          `json:"rollback_hint,omitempty"`
	CABStatus             string          `json:"cab_status,omitempty"`
	CABWindowStart        *time.Time      `json:"cab_window_start,omitempty"`
	CABWindowEnd          *time.Time      `json:"cab_window_end,omitempty"`
	LinkedIncidentID      *int            `json:"linked_incident_id,omitempty"`
	LinkedIncidentNumber  string          `json:"linked_incident_number,omitempty"`
	CABApprovedAt         *time.Time      `json:"cab_approved_at,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
}

func formatChangeNumber(id int) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("CHG%07d", id)
}

func lookupProjectID(projectID int, projectCode string) *int {
	if projectID > 0 {
		value := projectID
		return &value
	}
	code := strings.TrimSpace(projectCode)
	if code == "" || DB == nil {
		return nil
	}
	projects, err := getProjectCatalogsByFilter("WHERE LOWER(p.code) = LOWER($1)", code)
	if err != nil || len(projects) == 0 {
		return nil
	}
	value := projects[0].ID
	return &value
}

func encodeChangeFiles(files []string) string {
	if len(files) == 0 {
		return "[]"
	}
	body, err := json.Marshal(files)
	if err != nil {
		return "[]"
	}
	return string(body)
}

func decodeChangeFiles(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" {
		return []string{}
	}
	var files []string
	if err := json.Unmarshal([]byte(trimmed), &files); err != nil {
		return []string{}
	}
	return files
}

func upsertChangeRequest(payload parsedChangeWebhook) (*changeRequestRecord, bool, error) {
	if DB == nil {
		return nil, false, fmt.Errorf("database not available")
	}
	projectID := lookupProjectID(payload.ProjectID, payload.ProjectCode)
	if projectID == nil {
		if mapped := lookupServiceMap(payload.Service, payload.Repo, payload.Environment); mapped != nil {
			projectID = mapped.ProjectID
			if payload.Service == "" {
				payload.Service = mapped.Service
			}
		}
	}
	payload.ChangeType = normalizeChangeType(payload.ChangeType)
	linkedIncidentID := resolveLinkedIncidentID(payload.LinkedIncidentID, payload.LinkedIncidentNumber)
	var linkedAny any
	if linkedIncidentID > 0 {
		linkedAny = linkedIncidentID
	}
	cabStatus := ""
	if changeRequiresCAB(payload.ChangeType, payload.Environment) {
		cabStatus = "pending"
		if payload.Status != "cancelled" && payload.Status != "failed" {
			payload.Status = "new"
		}
	}
	var projectAny any
	if projectID != nil {
		projectAny = *projectID
	}
	var requestAny any
	if payload.RequestID > 0 {
		requestAny = payload.RequestID
	}
	filesJSON := encodeChangeFiles(payload.Files)
	var existingID int
	var existingStatus string
	err := queryRowContext(`
		SELECT id, status FROM change_requests
		WHERE LOWER(repo) = LOWER($1) AND LOWER(sha) = LOWER($2) AND LOWER(environment) = LOWER($3)
	`, payload.Repo, payload.SHA, payload.Environment).Scan(&existingID, &existingStatus)
	if err != nil && err != sql.ErrNoRows {
		return nil, false, err
	}
	if existingID > 0 {
		nextStatus := existingStatus
		existingCAB := ""
		_ = queryRowContext(`SELECT COALESCE(cab_status,'') FROM change_requests WHERE id = $1`, existingID).Scan(&existingCAB)
		if changeRequiresCAB(payload.ChangeType, payload.Environment) && existingCAB != "approved" {
			if payload.Status != "cancelled" && payload.Status != "failed" {
				payload.Status = "new"
			}
			cabStatus = "pending"
		} else if existingCAB == "approved" {
			cabStatus = "approved"
		}
		if changeStatusRank(payload.Status) > changeStatusRank(existingStatus) || payload.Status == "failed" || payload.Status == "cancelled" {
			nextStatus = payload.Status
		}
		_, err = execContext(`
			UPDATE change_requests
			SET title = CASE WHEN COALESCE(title,'') = '' THEN $2 ELSE title END,
			    author = CASE WHEN COALESCE(author,'') = '' THEN $3 ELSE author END,
			    summary = CASE WHEN COALESCE(summary,'') = '' THEN $4 ELSE summary END,
			    files_json = CASE WHEN COALESCE(files_json,'') IN ('', '[]') THEN $5 ELSE files_json END,
			    pipeline_url = CASE WHEN COALESCE(pipeline_url,'') = '' THEN $6 ELSE pipeline_url END,
			    pr_number = CASE WHEN pr_number = 0 THEN $7 ELSE pr_number END,
			    pr_url = CASE WHEN COALESCE(pr_url,'') = '' THEN $8 ELSE pr_url END,
			    previous_sha = CASE WHEN COALESCE(previous_sha,'') = '' THEN $9 ELSE previous_sha END,
			    service = CASE WHEN COALESCE(service,'') = '' THEN $10 ELSE service END,
			    project_id = COALESCE(project_id, $11),
			    request_id = COALESCE(request_id, $12),
			    linked_incident_id = COALESCE(linked_incident_id, $15),
			    cab_status = CASE WHEN COALESCE(cab_status,'') = 'approved' THEN cab_status ELSE $16 END,
			    status = $13,
			    watch_minutes = $14,
			    watch_started_at = CASE
			        WHEN $13 IN ('implemented', 'monitoring') AND watch_started_at IS NULL THEN CURRENT_TIMESTAMP
			        ELSE watch_started_at
			    END,
			    watch_until = CASE
			        WHEN $13 IN ('implemented', 'monitoring') AND watch_until IS NULL THEN CURRENT_TIMESTAMP + ($14 * INTERVAL '1 minute')
			        ELSE watch_until
			    END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, payload.Title, payload.Author, payload.Summary, filesJSON, payload.PipelineURL, payload.PRNumber, payload.PRURL, payload.PreviousSHA, payload.Service, projectAny, requestAny, nextStatus, payload.WatchMinutes, linkedAny, cabStatus)
		if err != nil {
			return nil, false, err
		}
		if payload.Metrics != nil {
			_ = recordWatchSample(existingID, *payload.Metrics, true)
		}
		item, getErr := getChangeRequestByID(existingID)
		if getErr == nil && item != nil && nextStatus != existingStatus {
			go FireOutboundWebhooks("change.updated", map[string]interface{}{
				"change_id":     item.ID,
				"change_number": item.ChangeNumber,
				"repo":          item.Repo,
				"sha":           item.SHA,
				"environment":   item.Environment,
				"status":        item.Status,
			})
		}
		return item, false, getErr
	}
	var id int
	err = queryRowContext(`
		INSERT INTO change_requests (
			project_id, service, environment, repo, pr_number, pr_url, sha, previous_sha,
			title, author, summary, files_json, pipeline_url, change_type, status, watch_minutes, request_id,
			linked_incident_id, cab_status, watch_started_at, watch_until
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			$9, $10, $11, $12, $13, $14, $15, $16, $17,
			$18, $19,
			CASE WHEN $15 IN ('implemented', 'monitoring') THEN CURRENT_TIMESTAMP ELSE NULL END,
			CASE WHEN $15 IN ('implemented', 'monitoring') THEN CURRENT_TIMESTAMP + ($16 * INTERVAL '1 minute') ELSE NULL END
		)
		RETURNING id
	`, projectAny, payload.Service, payload.Environment, payload.Repo, payload.PRNumber, payload.PRURL, payload.SHA, payload.PreviousSHA,
		payload.Title, payload.Author, payload.Summary, filesJSON, payload.PipelineURL, payload.ChangeType, payload.Status, payload.WatchMinutes, requestAny,
		linkedAny, cabStatus,
	).Scan(&id)
	if err != nil {
		return nil, false, err
	}
	if _, err := execContext(`
		UPDATE change_requests
		SET change_number = $2
		WHERE id = $1 AND COALESCE(change_number, '') = ''
	`, id, formatChangeNumber(id)); err != nil {
		return nil, false, err
	}
	if payload.Metrics != nil {
		_ = recordWatchSample(id, *payload.Metrics, true)
	}
	item, getErr := getChangeRequestByID(id)
	return item, true, getErr
}

func changeRequestSelect() string {
	return `
		SELECT c.id, COALESCE(c.change_number,''), c.project_id, COALESCE(p.name,''), COALESCE(p.code,''),
		       COALESCE(c.service,''), COALESCE(c.environment,''), c.repo, c.pr_number, COALESCE(c.pr_url,''),
		       c.sha, COALESCE(c.previous_sha,''), COALESCE(c.title,''), COALESCE(c.author,''), COALESCE(c.summary,''),
		       COALESCE(c.files_json,'[]'), COALESCE(c.pipeline_url,''), COALESCE(c.change_type,'standard'), COALESCE(c.status,'implementing'),
		       c.watch_minutes, c.watch_started_at, c.watch_until, c.request_id,
		       (SELECT COUNT(*) FROM request_incidents i WHERE i.suspected_change_id = c.id),
		       c.created_at, c.updated_at, COALESCE(c.baseline_json,''), COALESCE(c.latest_metrics_json,''),
		       COALESCE(c.cab_status,''), c.cab_window_start, c.cab_window_end, c.linked_incident_id, COALESCE(inc.incident_number,''), c.cab_approved_at
		FROM change_requests c
		LEFT JOIN projects p ON p.id = c.project_id
		LEFT JOIN request_incidents inc ON inc.id = c.linked_incident_id
	`
}

func scanChangeRequest(scanner interface {
	Scan(dest ...any) error
}) (*changeRequestRecord, error) {
	var item changeRequestRecord
	var projectID, requestID, linkedIncidentID sql.NullInt64
	var watchStarted, watchUntil, cabStart, cabEnd, cabApproved sql.NullTime
	var filesJSON, baselineJSON, latestJSON string
	if err := scanner.Scan(
		&item.ID, &item.ChangeNumber, &projectID, &item.ProjectName, &item.ProjectCode,
		&item.Service, &item.Environment, &item.Repo, &item.PRNumber, &item.PRURL,
		&item.SHA, &item.PreviousSHA, &item.Title, &item.Author, &item.Summary,
		&filesJSON, &item.PipelineURL, &item.ChangeType, &item.Status,
		&item.WatchMinutes, &watchStarted, &watchUntil, &requestID,
		&item.LinkedIncidents, &item.CreatedAt, &item.UpdatedAt, &baselineJSON, &latestJSON,
		&item.CABStatus, &cabStart, &cabEnd, &linkedIncidentID, &item.LinkedIncidentNumber, &cabApproved,
	); err != nil {
		return nil, err
	}
	if projectID.Valid {
		value := int(projectID.Int64)
		item.ProjectID = &value
	}
	if requestID.Valid {
		value := int(requestID.Int64)
		item.RequestID = &value
	}
	if watchStarted.Valid {
		item.WatchStartedAt = &watchStarted.Time
	}
	if watchUntil.Valid {
		item.WatchUntil = &watchUntil.Time
	}
	if cabStart.Valid {
		item.CABWindowStart = &cabStart.Time
	}
	if cabEnd.Valid {
		item.CABWindowEnd = &cabEnd.Time
	}
	if linkedIncidentID.Valid {
		value := int(linkedIncidentID.Int64)
		item.LinkedIncidentID = &value
	}
	if cabApproved.Valid {
		item.CABApprovedAt = &cabApproved.Time
	}
	item.Files = decodeChangeFiles(filesJSON)
	item.Baseline = decodeServiceMetrics(baselineJSON)
	item.LatestMetrics = decodeServiceMetrics(latestJSON)
	item.WatchRemainingMinutes = watchRemainingMinutes(item, time.Now())
	item.RollbackHint = changeRollbackHint(item)
	if strings.TrimSpace(item.ChangeNumber) == "" {
		item.ChangeNumber = formatChangeNumber(item.ID)
	}
	return &item, nil
}

func getChangeRequestByID(id int) (*changeRequestRecord, error) {
	item, err := scanChangeRequest(queryRowContext(changeRequestSelect()+` WHERE c.id = $1`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("change not found")
	}
	return item, err
}

func listChangeRequests(projectID int, environment, status, query string) ([]changeRequestRecord, error) {
	sqlQuery := changeRequestSelect()
	args := []any{}
	where := []string{}
	if projectID > 0 {
		args = append(args, projectID)
		where = append(where, fmt.Sprintf("c.project_id = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(environment); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("LOWER(c.environment) = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("LOWER(c.status) = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("(LOWER(c.repo) LIKE $%d OR LOWER(c.title) LIKE $%d OR LOWER(c.change_number) LIKE $%d OR LOWER(c.sha) LIKE $%d OR CAST(c.pr_number AS TEXT) LIKE $%d)", len(args), len(args), len(args), len(args), len(args)))
	}
	if len(where) > 0 {
		sqlQuery += " WHERE " + strings.Join(where, " AND ")
	}
	sqlQuery += " ORDER BY c.created_at DESC, c.id DESC LIMIT 200"
	rows, cancel, err := queryRowsWithTimeout(sqlQuery, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []changeRequestRecord{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []changeRequestRecord{}
	for rows.Next() {
		item, err := scanChangeRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func devopsChangesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	items, err := listChangeRequests(projectID, r.URL.Query().Get("environment"), r.URL.Query().Get("status"), r.URL.Query().Get("q"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list changes", err)
		return
	}
	if needle := normalizeChangeType(r.URL.Query().Get("change_type")); r.URL.Query().Get("change_type") != "" {
		filtered := items[:0]
		for _, item := range items {
			if normalizeChangeType(item.ChangeType) == needle {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"changes": items,
		"status":  "ok",
	})
}

func changeIsInWatchWindow(item changeRequestRecord, now time.Time) bool {
	status := strings.ToLower(strings.TrimSpace(item.Status))
	if status == "closed" || status == "cancelled" || status == "canceled" || status == "failed" {
		return false
	}
	if item.WatchUntil != nil {
		return !now.After(*item.WatchUntil)
	}
	minutes := item.WatchMinutes
	if minutes <= 0 {
		minutes = 120
	}
	return now.Sub(item.CreatedAt) <= time.Duration(minutes)*time.Minute
}

func suspectedChangeScore(item changeRequestRecord, service, environment string, projectID *int) int {
	score := 0
	if service != "" && strings.EqualFold(item.Service, service) {
		score += 8
	}
	if environment != "" && !strings.EqualFold(environment, "unspecified") && strings.EqualFold(item.Environment, environment) {
		score += 6
	}
	if projectID != nil && item.ProjectID != nil && *item.ProjectID == *projectID {
		score += 4
	}
	return score
}

func pickSuspectedChange(candidates []changeRequestRecord, service, environment string, projectID *int, now time.Time) *changeRequestRecord {
	var best *changeRequestRecord
	bestScore := 0
	for i := range candidates {
		item := candidates[i]
		if !changeIsInWatchWindow(item, now) {
			continue
		}
		score := suspectedChangeScore(item, service, environment, projectID)
		if score < 6 {
			continue
		}
		if best == nil || score > bestScore || (score == bestScore && item.CreatedAt.After(best.CreatedAt)) {
			copy := item
			best = &copy
			bestScore = score
		}
	}
	return best
}

func findSuspectedChange(service, environment string, projectID *int) *changeRequestRecord {
	if DB == nil {
		return nil
	}
	items, err := listChangeRequests(0, "", "", "")
	if err != nil {
		return nil
	}
	return pickSuspectedChange(items, service, environment, projectID, time.Now())
}

func listWatchingChanges(projectID int, environment string, now time.Time) ([]changeRequestRecord, error) {
	items, err := listChangeRequests(projectID, environment, "", "")
	if err != nil {
		return nil, err
	}
	out := []changeRequestRecord{}
	for _, item := range items {
		if changeIsInWatchWindow(item, now) {
			out = append(out, item)
		}
	}
	return out, nil
}

func devopsChangeDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/changes/"), "/")
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid change id", err)
		return
	}
	if len(parts) == 2 && parts[1] == "close" {
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		item, err := closeChangeRequest(id)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to close change", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
		return
	}
	if len(parts) == 2 && parts[1] == "cab-approve" {
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		item, err := approveChangeCAB(id, userID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	item, err := getChangeRequestByID(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "change not found", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"change":           item,
		"change_brief":     changeBriefFromChangeRequest(*item),
		"linked_incidents": listIncidentsForChange(item.ID),
		"status":           "ok",
	})
}
