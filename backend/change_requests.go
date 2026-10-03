package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type changeRequestRecord struct {
	ID                    int                 `json:"id"`
	ChangeNumber          string              `json:"change_number"`
	ProjectID             *int                `json:"project_id,omitempty"`
	ProjectName           string              `json:"project_name,omitempty"`
	ProjectCode           string              `json:"project_code,omitempty"`
	Service               string              `json:"service"`
	Environment           string              `json:"environment"`
	Repo                  string              `json:"repo"`
	PRNumber              int                 `json:"pr_number"`
	PRURL                 string              `json:"pr_url,omitempty"`
	SHA                   string              `json:"sha"`
	PreviousSHA           string              `json:"previous_sha,omitempty"`
	Title                 string              `json:"title"`
	Author                string              `json:"author,omitempty"`
	Summary               string              `json:"summary,omitempty"`
	Files                 []string            `json:"files"`
	PipelineURL           string              `json:"pipeline_url,omitempty"`
	ChangeType            string              `json:"change_type"`
	Status                string              `json:"status"`
	WatchMinutes          int                 `json:"watch_minutes"`
	WatchStartedAt        *time.Time          `json:"watch_started_at,omitempty"`
	WatchUntil            *time.Time          `json:"watch_until,omitempty"`
	RequestID             *int                `json:"request_id,omitempty"`
	LinkedIncidents       int                 `json:"linked_incidents"`
	Baseline              *serviceMetrics     `json:"baseline,omitempty"`
	LatestMetrics         *serviceMetrics     `json:"latest_metrics,omitempty"`
	WatchRemainingMinutes int                 `json:"watch_remaining_minutes"`
	RollbackHint          string              `json:"rollback_hint,omitempty"`
	RollbackPlan          *changeRollbackPlan `json:"rollback_plan,omitempty"`
	CABStatus             string              `json:"cab_status,omitempty"`
	CABWindowStart        *time.Time          `json:"cab_window_start,omitempty"`
	CABWindowEnd          *time.Time          `json:"cab_window_end,omitempty"`
	LinkedIncidentID      *int                `json:"linked_incident_id,omitempty"`
	LinkedIncidentNumber  string              `json:"linked_incident_number,omitempty"`
	CABApprovedAt         *time.Time          `json:"cab_approved_at,omitempty"`
	CABApprovedBy         *int                `json:"cab_approved_by,omitempty"`
	CABApprovedByUsername string              `json:"cab_approved_by_username,omitempty"`
	WatchResult           string              `json:"watch_result,omitempty"`
	AssigneeUserID        *int                `json:"assignee_user_id,omitempty"`
	AssigneeUsername      string              `json:"assignee_username,omitempty"`
	Priority              string              `json:"priority,omitempty"`
	RiskLevel             string              `json:"risk_level,omitempty"`
	Impact                string              `json:"impact,omitempty"`
	BackoutPlan           string              `json:"backout_plan,omitempty"`
	SbomURL               string              `json:"sbom_url,omitempty"`
	AttestationURL        string              `json:"attestation_url,omitempty"`
	ImageDigest           string              `json:"image_digest,omitempty"`
	ProvenanceJSON        string              `json:"provenance_json,omitempty"`
	ProvenanceSigned      bool                `json:"provenance_signed"`
	RolloutStage          string              `json:"rollout_stage,omitempty"`
	RolloutPercent        int                 `json:"rollout_percent"`
	RolloutHalted         bool                `json:"rollout_halted"`
	RolloutNote           string              `json:"rollout_note,omitempty"`
	CostDeltaUSD          float64             `json:"cost_delta_usd"`
	CostMonthlyAfter      float64             `json:"cost_monthly_after"`
	CostCurrency          string              `json:"cost_currency,omitempty"`
	PolicyStatus          string              `json:"policy_status,omitempty"`
	PolicyReasons         []string            `json:"policy_reasons,omitempty"`
	Drift                 *liveChangeDrift    `json:"drift,omitempty"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
}

func formatChangeNumber(id int) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("CHG%07d", id)
}

func lookupProjectID(projectID int, projectCode string) *int {
	if projectID > 0 {
		if project, err := getProjectCatalogByID(projectID); err == nil && project != nil {
			value := projectID
			return &value
		}
		return nil
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

func resolveChangeProjectID(payload *parsedChangeWebhook) *int {
	if payload == nil {
		return nil
	}
	if id := lookupProjectID(payload.ProjectID, payload.ProjectCode); id != nil {
		return id
	}
	mapped := lookupServiceMap(payload.Service, payload.Repo, payload.Environment)
	if mapped == nil {
		return nil
	}
	if payload.Service == "" {
		payload.Service = mapped.Service
	}
	if mapped.ProjectID == nil {
		return nil
	}
	return lookupProjectID(*mapped.ProjectID, "")
}

func isDBForeignKeyViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "foreign key") ||
		strings.Contains(msg, "violates foreign key constraint") ||
		strings.Contains(msg, "23503")
}

func writeChangeUpsertError(w http.ResponseWriter, r *http.Request, message string, err error) {
	if err == nil {
		writeAPIError(w, r, http.StatusInternalServerError, message, nil)
		return
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "planned end") {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	if isDBForeignKeyViolation(err) {
		writeAPIError(w, r, http.StatusBadRequest, "invalid project, assignee, or linked incident reference", err)
		return
	}
	if isChangeUniqueViolation(err) {
		writeAPIError(w, r, http.StatusConflict, "a change already exists for this repo, commit, and environment", err)
		return
	}
	writeAPIError(w, r, http.StatusInternalServerError, message, err)
}

func optionalChangeRequestID(id int) any {
	return optionalChangeRequestSQL(id)
}

func optionalChangeRequestSQL(id int) sql.NullInt64 {
	if id <= 0 || DB == nil {
		return sql.NullInt64{}
	}
	if req, err := GetPRRequestByID(id); err == nil && req != nil {
		return sql.NullInt64{Int64: int64(id), Valid: true}
	}
	return sql.NullInt64{}
}

func optionalChangeAssigneeUserID(id int) any {
	return optionalChangeAssigneeSQL(id)
}

func optionalChangeAssigneeSQL(id int) sql.NullInt64 {
	if id <= 0 || DB == nil {
		return sql.NullInt64{}
	}
	if portalUserExists(id) {
		return sql.NullInt64{Int64: int64(id), Valid: true}
	}
	return sql.NullInt64{}
}

func optionalLinkedIncidentID(id int) any {
	return optionalLinkedIncidentSQL(id)
}

func optionalLinkedIncidentSQL(id int) sql.NullInt64 {
	if id <= 0 || DB == nil {
		return sql.NullInt64{}
	}
	if item, err := getRequestIncidentByID(id); err == nil && item != nil {
		return sql.NullInt64{Int64: int64(id), Valid: true}
	}
	return sql.NullInt64{}
}

func projectIDSQL(id *int) sql.NullInt64 {
	if id == nil || *id <= 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*id), Valid: true}
}

func isChangeUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "idx_change_requests")
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

func normalizeChangePriority(value string) string {
	return itsmPriorityToSeverity(value)
}

func normalizeChangeRisk(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low":
		return "low"
	case "high":
		return "high"
	default:
		return "medium"
	}
}

func parseChangeWindowTime(value string) *time.Time {
	parsed := parseFlexibleTime(value)
	if parsed.IsZero() {
		return nil
	}
	return &parsed
}

func changeWindowTimes(payload parsedChangeWebhook) (*time.Time, *time.Time, error) {
	start := parseChangeWindowTime(firstNonEmpty(payload.PlannedStart, payload.CABWindowStart))
	end := parseChangeWindowTime(firstNonEmpty(payload.PlannedEnd, payload.CABWindowEnd))
	if start != nil && end != nil && end.Before(*start) {
		return nil, nil, fmt.Errorf("planned end must be after planned start")
	}
	return start, end, nil
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
	return upsertChangeRequestWithRetry(payload, false)
}

func upsertChangeRequestWithRetry(payload parsedChangeWebhook, retried bool) (*changeRequestRecord, bool, error) {
	if DB == nil {
		return nil, false, fmt.Errorf("database not available")
	}
	projectID := resolveChangeProjectID(&payload)
	payload.ChangeType = normalizeChangeType(payload.ChangeType)
	payload.Priority = normalizeChangePriority(payload.Priority)
	payload.RiskLevel = normalizeChangeRisk(payload.RiskLevel)
	payload.Impact = strings.TrimSpace(payload.Impact)
	payload.BackoutPlan = strings.TrimSpace(payload.BackoutPlan)
	windowStart, windowEnd, err := changeWindowTimes(payload)
	if err != nil {
		return nil, false, err
	}
	var windowStartAny, windowEndAny any
	if windowStart != nil {
		windowStartAny = *windowStart
	}
	if windowEnd != nil {
		windowEndAny = *windowEnd
	}
	linkedIncidentSQL := optionalLinkedIncidentSQL(resolveLinkedIncidentID(payload.LinkedIncidentID, payload.LinkedIncidentNumber))
	cabStatus := ""
	if changeRequiresCAB(payload.ChangeType, payload.Environment) {
		cabStatus = "pending"
		if payload.Status != "cancelled" && payload.Status != "failed" {
			payload.Status = "new"
		}
	}
	projectSQL := projectIDSQL(projectID)
	requestSQL := optionalChangeRequestSQL(payload.RequestID)
	assigneeSQL := optionalChangeAssigneeSQL(payload.AssigneeUserID)
	watchStatus := payload.Status
	filesJSON := encodeChangeFiles(payload.Files)
	var existingID int
	var existingStatus string
	err = queryRowContext(`
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
			    assignee_user_id = COALESCE($17, assignee_user_id),
			    priority = CASE WHEN COALESCE(priority,'') IN ('', 'medium') AND $18 <> '' THEN $18 ELSE priority END,
			    risk_level = CASE WHEN COALESCE(risk_level,'') IN ('', 'medium') AND $19 <> '' THEN $19 ELSE risk_level END,
			    impact = CASE WHEN COALESCE(impact,'') = '' THEN $20 ELSE impact END,
			    backout_plan = CASE WHEN COALESCE(backout_plan,'') = '' THEN $21 ELSE backout_plan END,
			    cab_window_start = COALESCE(cab_window_start, $22),
			    cab_window_end = COALESCE(cab_window_end, $23),
			    cab_status = CASE WHEN COALESCE(cab_status,'') = 'approved' THEN cab_status ELSE $16 END,
			    status = $13,
			    watch_minutes = $14,
			    watch_started_at = CASE
			        WHEN $24 IN ('implemented', 'monitoring') AND watch_started_at IS NULL THEN CURRENT_TIMESTAMP
			        ELSE watch_started_at
			    END,
			    watch_until = CASE
			        WHEN $24 IN ('implemented', 'monitoring') AND watch_until IS NULL THEN CURRENT_TIMESTAMP + ($25 * INTERVAL '1 minute')
			        ELSE watch_until
			    END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, payload.Title, payload.Author, payload.Summary, filesJSON, payload.PipelineURL, payload.PRNumber, payload.PRURL, payload.PreviousSHA, payload.Service, projectSQL, requestSQL, nextStatus, payload.WatchMinutes, linkedIncidentSQL, cabStatus, assigneeSQL, payload.Priority, payload.RiskLevel, payload.Impact, payload.BackoutPlan, windowStartAny, windowEndAny, nextStatus, payload.WatchMinutes)
		if err != nil {
			return nil, false, err
		}
		if payload.Metrics != nil {
			_ = recordWatchSample(existingID, *payload.Metrics, true)
		}
		persistChangeProvenance(existingID, payload)
		persistChangeRollout(existingID, payload)
		persistChangeCost(existingID, payload)
		applyChangePolicies(existingID, payload)
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
			linked_incident_id, cab_status, assignee_user_id, priority, risk_level, impact, backout_plan,
			cab_window_start, cab_window_end, watch_started_at, watch_until
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			$9, $10, $11, $12, $13, $14, $15, $16, $17,
			$18, $19, $20, $21, $22, $23, $24,
			$25, $26,
			CASE WHEN $27 IN ('implemented', 'monitoring') THEN CURRENT_TIMESTAMP ELSE NULL END,
			CASE WHEN $27 IN ('implemented', 'monitoring') THEN CURRENT_TIMESTAMP + ($28 * INTERVAL '1 minute') ELSE NULL END
		)
		RETURNING id
	`, projectSQL, payload.Service, payload.Environment, payload.Repo, payload.PRNumber, payload.PRURL, payload.SHA, payload.PreviousSHA,
		payload.Title, payload.Author, payload.Summary, filesJSON, payload.PipelineURL, payload.ChangeType, payload.Status, payload.WatchMinutes, requestSQL,
		linkedIncidentSQL, cabStatus, assigneeSQL, payload.Priority, payload.RiskLevel, payload.Impact, payload.BackoutPlan,
		windowStartAny, windowEndAny, watchStatus, payload.WatchMinutes,
	).Scan(&id)
	if err != nil {
		if !retried && isChangeUniqueViolation(err) {
			return upsertChangeRequestWithRetry(payload, true)
		}
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
	persistChangeProvenance(id, payload)
	persistChangeRollout(id, payload)
	persistChangeCost(id, payload)
	applyChangePolicies(id, payload)
	item, getErr := getChangeRequestByID(id)
	if getErr != nil {
		log.Printf("[Change] created id=%d but reload failed: %v", id, getErr)
		item = &changeRequestRecord{
			ID:           id,
			ChangeNumber: formatChangeNumber(id),
			ProjectID:    projectID,
			Service:      payload.Service,
			Environment:  payload.Environment,
			Repo:         payload.Repo,
			SHA:          payload.SHA,
			Title:        payload.Title,
			Author:       payload.Author,
			Summary:      payload.Summary,
			ChangeType:   payload.ChangeType,
			Status:       payload.Status,
			WatchMinutes: payload.WatchMinutes,
			Priority:     payload.Priority,
			RiskLevel:    payload.RiskLevel,
			Impact:       payload.Impact,
			BackoutPlan:  payload.BackoutPlan,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		}
		getErr = nil
	}
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
		       COALESCE(c.cab_status,''), c.cab_window_start, c.cab_window_end, c.linked_incident_id, COALESCE(inc.incident_number,''), c.cab_approved_at,
		       c.assignee_user_id, COALESCE(assignee.username,''),
		       COALESCE(c.priority,'medium'), COALESCE(c.risk_level,'medium'), COALESCE(c.impact,''), COALESCE(c.backout_plan,''),
		       COALESCE(c.sbom_url,''), COALESCE(c.attestation_url,''), COALESCE(c.image_digest,''), COALESCE(c.provenance_json,''),
		       COALESCE(c.rollout_stage,''), COALESCE(c.rollout_percent,100), COALESCE(c.rollout_halted,false), COALESCE(c.rollout_note,''),
		       COALESCE(c.cost_delta_usd,0), COALESCE(c.cost_monthly_after,0), COALESCE(c.cost_currency,'USD'),
		       COALESCE(c.policy_status,''), COALESCE(c.policy_reasons_json,'[]'),
		       c.cab_approved_by, COALESCE(cab_approver.username,'')
		FROM change_requests c
		LEFT JOIN projects p ON p.id = c.project_id
		LEFT JOIN request_incidents inc ON inc.id = c.linked_incident_id
		LEFT JOIN users assignee ON assignee.id = c.assignee_user_id
		LEFT JOIN users cab_approver ON cab_approver.id = c.cab_approved_by
	`
}

func scanChangeRequest(scanner interface {
	Scan(dest ...any) error
}) (*changeRequestRecord, error) {
	var item changeRequestRecord
	var projectID, requestID, linkedIncidentID, assigneeUserID, cabApprovedBy sql.NullInt64
	var watchStarted, watchUntil, cabStart, cabEnd, cabApproved sql.NullTime
	var filesJSON, baselineJSON, latestJSON, policyReasonsJSON string
	if err := scanner.Scan(
		&item.ID, &item.ChangeNumber, &projectID, &item.ProjectName, &item.ProjectCode,
		&item.Service, &item.Environment, &item.Repo, &item.PRNumber, &item.PRURL,
		&item.SHA, &item.PreviousSHA, &item.Title, &item.Author, &item.Summary,
		&filesJSON, &item.PipelineURL, &item.ChangeType, &item.Status,
		&item.WatchMinutes, &watchStarted, &watchUntil, &requestID,
		&item.LinkedIncidents, &item.CreatedAt, &item.UpdatedAt, &baselineJSON, &latestJSON,
		&item.CABStatus, &cabStart, &cabEnd, &linkedIncidentID, &item.LinkedIncidentNumber, &cabApproved,
		&assigneeUserID, &item.AssigneeUsername,
		&item.Priority, &item.RiskLevel, &item.Impact, &item.BackoutPlan,
		&item.SbomURL, &item.AttestationURL, &item.ImageDigest, &item.ProvenanceJSON,
		&item.RolloutStage, &item.RolloutPercent, &item.RolloutHalted, &item.RolloutNote,
		&item.CostDeltaUSD, &item.CostMonthlyAfter, &item.CostCurrency,
		&item.PolicyStatus, &policyReasonsJSON,
		&cabApprovedBy, &item.CABApprovedByUsername,
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
	if assigneeUserID.Valid && assigneeUserID.Int64 > 0 {
		value := int(assigneeUserID.Int64)
		item.AssigneeUserID = &value
	}
	if cabApprovedBy.Valid && cabApprovedBy.Int64 > 0 {
		value := int(cabApprovedBy.Int64)
		item.CABApprovedBy = &value
	}
	item.Files = decodeChangeFiles(filesJSON)
	item.Baseline = decodeServiceMetrics(baselineJSON)
	item.LatestMetrics = decodeServiceMetrics(latestJSON)
	item.WatchRemainingMinutes = watchRemainingMinutes(item, time.Now())
	item.RollbackHint = changeRollbackHint(item)
	if strings.TrimSpace(item.ChangeNumber) == "" {
		item.ChangeNumber = formatChangeNumber(item.ID)
	}
	item.ProvenanceSigned = changeProvenanceSigned(item)
	item.PolicyReasons = decodeStringList(policyReasonsJSON)
	item.WatchResult = changeWatchResult(item)
	return &item, nil
}

func changeWatchResult(item changeRequestRecord) string {
	switch normalizeChangeStatus(item.Status) {
	case "resolved", "closed":
		if item.LinkedIncidents > 0 {
			return "resolved_with_incidents"
		}
		return "clean"
	case "failed":
		return "failed"
	case "cancelled":
		return "cancelled"
	case "implemented", "monitoring":
		return "watching"
	default:
		return firstNonEmpty(item.Status, "open")
	}
}

func decodeStringList(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" {
		return nil
	}
	var out []string
	if json.Unmarshal([]byte(trimmed), &out) != nil {
		return nil
	}
	return out
}

func changeProvenanceSigned(item changeRequestRecord) bool {
	return strings.TrimSpace(item.AttestationURL) != "" || strings.Contains(strings.ToLower(item.ProvenanceJSON), `"signed":true`)
}

func persistChangeProvenance(id int, payload parsedChangeWebhook) {
	if id <= 0 || DB == nil {
		return
	}
	_, _ = execContext(`
		UPDATE change_requests
		SET sbom_url = CASE WHEN COALESCE($2,'') = '' THEN sbom_url ELSE $2 END,
		    attestation_url = CASE WHEN COALESCE($3,'') = '' THEN attestation_url ELSE $3 END,
		    image_digest = CASE WHEN COALESCE($4,'') = '' THEN image_digest ELSE $4 END,
		    provenance_json = CASE WHEN COALESCE($5,'') = '' THEN provenance_json ELSE $5 END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, payload.SbomURL, payload.AttestationURL, payload.ImageDigest, payload.ProvenanceJSON)
}

func getChangeRequestByID(id int) (*changeRequestRecord, error) {
	item, err := scanChangeRequest(queryRowContext(changeRequestSelect()+` WHERE c.id = $1`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("change not found")
	}
	return item, err
}

func listChangeRequests(projectID int, environment, status, query string) ([]changeRequestRecord, error) {
	if DB == nil {
		return []changeRequestRecord{}, nil
	}
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

func prepareManualChange(payload parsedChangeWebhook, author string) (parsedChangeWebhook, error) {
	payload.Title = strings.TrimSpace(payload.Title)
	payload.Environment = normalizeChangeEnvironment(payload.Environment)
	payload.Repo = strings.TrimSpace(payload.Repo)
	payload.SHA = strings.TrimSpace(payload.SHA)
	payload.Service = strings.TrimSpace(payload.Service)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.Author = strings.TrimSpace(payload.Author)
	payload.ChangeType = normalizeChangeType(payload.ChangeType)
	payload.Status = normalizeChangeStatus(payload.Status)
	payload.Priority = normalizeChangePriority(payload.Priority)
	payload.RiskLevel = normalizeChangeRisk(payload.RiskLevel)
	payload.Impact = strings.TrimSpace(payload.Impact)
	payload.BackoutPlan = strings.TrimSpace(payload.BackoutPlan)
	if payload.Title == "" {
		return payload, fmt.Errorf("title is required")
	}
	if payload.Environment == "" || payload.Environment == "unspecified" {
		if mapped := lookupServiceMap(payload.Service, payload.Repo, ""); mapped != nil && strings.TrimSpace(mapped.Environment) != "" {
			payload.Environment = mapped.Environment
		} else {
			payload.Environment = "unspecified"
		}
	}
	if payload.Repo == "" {
		if mapped := lookupServiceMap(payload.Service, "", payload.Environment); mapped != nil && strings.TrimSpace(mapped.Repo) != "" {
			payload.Repo = mapped.Repo
		} else {
			payload.Repo = "manual"
		}
	}
	if payload.SHA == "" {
		payload.SHA = fmt.Sprintf("manual-%d", time.Now().UnixNano())
	}
	if payload.Author == "" {
		payload.Author = strings.TrimSpace(author)
	}
	if payload.WatchMinutes <= 0 {
		payload.WatchMinutes = 120
	}
	if payload.Status == "" {
		payload.Status = "new"
	}
	if payload.ProjectID > 0 && lookupProjectID(payload.ProjectID, "") == nil {
		return payload, fmt.Errorf("selected project is not valid")
	}
	if payload.ProjectID <= 0 && (payload.Service != "" || payload.Repo != "") {
		if mapped := lookupServiceMap(payload.Service, payload.Repo, payload.Environment); mapped != nil && mapped.ProjectID != nil {
			if validated := lookupProjectID(*mapped.ProjectID, ""); validated != nil {
				payload.ProjectID = *validated
			}
		}
	}
	if payload.AssigneeUserID > 0 && DB != nil && !portalUserExists(payload.AssigneeUserID) {
		return payload, fmt.Errorf("assigned user must be a portal user")
	}
	if emergencyRequiresIncident(payload.ChangeType, payload.LinkedIncidentID, payload.LinkedIncidentNumber) {
		return payload, fmt.Errorf("emergency changes must link an incident")
	}
	if _, _, err := changeWindowTimes(payload); err != nil {
		return payload, err
	}
	return payload, nil
}

func portalUserExists(id int) bool {
	if id <= 0 || DB == nil {
		return false
	}
	var found int
	err := queryRowContext(`SELECT id FROM users WHERE id = $1 AND COALESCE(user_type, 'portal_user') = 'portal_user'`, id).Scan(&found)
	return err == nil && found == id
}

func devopsChangesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("mode")), "preview") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"change_number": formatChangeNumber(nextChangeRequestID()),
				"status":        "ok",
			})
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
	case "POST":
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("mode")), "bulk") ||
			strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Change-Bulk")), "1") {
			var body struct {
				IDs    []int  `json:"ids"`
				Action string `json:"action"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
				return
			}
			if len(body.IDs) == 0 || strings.TrimSpace(body.Action) == "" {
				writeAPIError(w, r, http.StatusBadRequest, "ids and action are required", nil)
				return
			}
			updated := []changeRequestRecord{}
			errors := []string{}
			for _, changeID := range body.IDs {
				if changeID <= 0 {
					continue
				}
				item, err := applyChangePortalAction(changeID, userID, body.Action)
				if err != nil {
					errors = append(errors, fmt.Sprintf("%d: %s", changeID, err.Error()))
					continue
				}
				if item != nil {
					updated = append(updated, *item)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"changes": updated,
				"errors":  errors,
				"status":  "ok",
			})
			return
		}
		var payload parsedChangeWebhook
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		author := ""
		if user, err := GetUserByID(userID); err == nil && user != nil {
			author = user.Username
		}
		prepared, err := prepareManualChange(payload, author)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		item, created, err := upsertChangeRequest(prepared)
		if err != nil {
			writeChangeUpsertError(w, r, "failed to create change", err)
			return
		}
		if created {
			go FireOutboundWebhooks("change.created", map[string]interface{}{
				"change_number": item.ChangeNumber,
				"id":            item.ID,
				"repo":          item.Repo,
				"sha":           item.SHA,
				"pr_number":     item.PRNumber,
				"environment":   item.Environment,
				"service":       item.Service,
				"source":        "manual",
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"change":  item,
			"created": created,
			"status":  "ok",
		})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func nextChangeRequestID() int {
	if DB == nil {
		return 0
	}
	var last int
	if err := queryRowContext(`SELECT COALESCE(MAX(id), 0) FROM change_requests`).Scan(&last); err != nil {
		return 0
	}
	return last + 1
}

func changeIsInWatchWindow(item changeRequestRecord, now time.Time) bool {
	status := strings.ToLower(strings.TrimSpace(item.Status))
	if changeIsFinished(status) {
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
	userID, ok := requireDevopsUser(w, r)
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
	if len(parts) == 2 {
		action := strings.ToLower(strings.TrimSpace(parts[1]))
		if action == "rollback" {
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r)
				return
			}
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			item, plan, err := executeChangeSHARollback(userID, 0, id)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "rollback": plan, "status": "ok"})
			return
		}
		if action == "rollout" {
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r)
				return
			}
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			var body struct {
				Stage string `json:"stage"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
				return
			}
			item, err := setChangeRollout(id, body.Stage)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
			return
		}
		if action == "schedule" {
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r)
				return
			}
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			item, err := scheduleChangeRequest(id, userID)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
			return
		}
		if action == "implement" {
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r)
				return
			}
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			item, err := startChangeImplementation(id, userID)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
			return
		}
		if action == "resolve" || action == "close" || action == "fail" || action == "cancel" || action == "reopen" {
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r)
				return
			}
			if _, ok := requireDevopsManager(w, r); !ok {
				return
			}
			next := action
			if action == "fail" {
				next = "failed"
			}
			if action == "cancel" {
				next = "cancelled"
			}
			item, err := transitionChangeStatus(id, next)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
			return
		}
	}
	if r.Method == "PATCH" && len(parts) == 1 {
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		item, err := transitionChangeStatus(id, body.Status)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
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
		if !userCanAuthorizeChange(userID) {
			writeAPIError(w, r, http.StatusForbidden, "not authorized to approve changes", nil)
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
	attachChangeRollbackPlan(item)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"change":           item,
		"change_brief":     changeBriefFromChangeRequest(*item),
		"linked_incidents": listIncidentsForChange(item.ID),
		"blast_radius":     blastRadiusForChange(*item),
		"drift":            detectServiceDrift(item.Service, item.Environment, item.SHA, item.ImageDigest),
		"delivery":         buildChangeDeliveryVisibility(item),
		"status":           "ok",
	})
}
