package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type deploymentGateApprovalAuditRecord struct {
	ID                     int        `json:"id"`
	RequestID              int        `json:"request_id"`
	ProjectID              *int       `json:"project_id,omitempty"`
	ProjectName            string     `json:"project_name,omitempty"`
	ProjectCode            string     `json:"project_code,omitempty"`
	Team                   string     `json:"team,omitempty"`
	Cloud                  string     `json:"cloud,omitempty"`
	Service                string     `json:"service,omitempty"`
	RequestStatus          string     `json:"request_status,omitempty"`
	SourceEnvironment      string     `json:"source_environment"`
	TargetEnvironment      string     `json:"target_environment"`
	GateStatus             string     `json:"gate_status"`
	Summary                string     `json:"summary"`
	Note                   string     `json:"note"`
	ApprovedBy             int        `json:"approved_by"`
	ApprovedByUsername     string     `json:"approved_by_username"`
	SourceRequestUpdatedAt time.Time  `json:"source_request_updated_at"`
	ApprovedAt             time.Time  `json:"approved_at"`
	ExpiresAt              *time.Time `json:"expires_at,omitempty"`
	RevokedAt              *time.Time `json:"revoked_at,omitempty"`
	RevokedBy              *int       `json:"revoked_by,omitempty"`
	RevokedByUsername      string     `json:"revoked_by_username,omitempty"`
	RevokeNote             string     `json:"revoke_note,omitempty"`
	State                  string     `json:"state"`
}

type deploymentGateApprovalAuditSummary struct {
	TotalCount      int `json:"total_count"`
	ActiveCount     int `json:"active_count"`
	ExpiredCount    int `json:"expired_count"`
	RevokedCount    int `json:"revoked_count"`
	ProductionCount int `json:"production_count"`
}

func normalizeDeploymentGateApprovalStateFilter(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "active", "expired", "revoked":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return ""
	}
}

func deriveDeploymentGateApprovalState(expiresAt, revokedAt *time.Time, now time.Time) string {
	switch {
	case revokedAt != nil:
		return "revoked"
	case expiresAt != nil && expiresAt.Before(now):
		return "expired"
	default:
		return "active"
	}
}

func listDeploymentGateApprovalAuditRecords(limit, offset, projectID int, targetEnvironment, state, approver, fromDate, toDate string) ([]deploymentGateApprovalAuditRecord, deploymentGateApprovalAuditSummary, error) {
	records := make([]deploymentGateApprovalAuditRecord, 0)
	summary := deploymentGateApprovalAuditSummary{}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}

	var fromTime time.Time
	var toTime time.Time
	var hasFrom bool
	var hasTo bool
	if _, parsedFrom, ok := normalizeDateOnlyQuery(fromDate); ok {
		fromTime = parsedFrom
		hasFrom = true
	}
	if _, parsedTo, ok := normalizeDateOnlyQuery(toDate); ok {
		toTime = parsedTo.Add(24*time.Hour - time.Nanosecond)
		hasTo = true
	}

	args := make([]interface{}, 0, 8)
	whereParts := []string{"1=1"}
	addArg := func(value interface{}) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	if projectID > 0 {
		whereParts = append(whereParts, fmt.Sprintf("a.project_id = %s", addArg(projectID)))
	}
	if normalizedTarget := strings.ToLower(strings.TrimSpace(targetEnvironment)); normalizedTarget != "" {
		whereParts = append(whereParts, fmt.Sprintf("LOWER(COALESCE(a.target_environment, '')) = %s", addArg(normalizedTarget)))
	}
	if normalizedApprover := strings.ToLower(strings.TrimSpace(approver)); normalizedApprover != "" {
		whereParts = append(whereParts, fmt.Sprintf("LOWER(COALESCE(u.username, '')) LIKE %s", addArg("%"+normalizedApprover+"%")))
	}
	if hasFrom {
		whereParts = append(whereParts, fmt.Sprintf("a.approved_at >= %s", addArg(fromTime)))
	}
	if hasTo {
		whereParts = append(whereParts, fmt.Sprintf("a.approved_at <= %s", addArg(toTime)))
	}
	switch normalizeDeploymentGateApprovalStateFilter(state) {
	case "active":
		whereParts = append(whereParts, "a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)")
	case "expired":
		whereParts = append(whereParts, "a.revoked_at IS NULL AND a.expires_at IS NOT NULL AND a.expires_at <= CURRENT_TIMESTAMP")
	case "revoked":
		whereParts = append(whereParts, "a.revoked_at IS NOT NULL")
	}

	whereClause := strings.Join(whereParts, " AND ")
	summaryQuery := fmt.Sprintf(`
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN a.revoked_at IS NULL AND a.expires_at IS NOT NULL AND a.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN a.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN LOWER(COALESCE(a.target_environment, '')) = 'prod' THEN 1 ELSE 0 END), 0)
		FROM deployment_gate_approvals a
		LEFT JOIN users u ON u.id = a.approved_by
		WHERE %s
	`, whereClause)
	if err := queryRowContext(summaryQuery, args...).Scan(
		&summary.TotalCount,
		&summary.ActiveCount,
		&summary.ExpiredCount,
		&summary.RevokedCount,
		&summary.ProductionCount,
	); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return records, summary, nil
		}
		return nil, summary, err
	}

	queryArgs := append(append([]interface{}{}, args...), limit, offset)
	rows, cancel, err := queryRowsWithTimeout(fmt.Sprintf(`
		SELECT a.id,
		       a.request_id,
		       a.project_id,
		       COALESCE(p.name, ''),
		       COALESCE(p.code, ''),
		       COALESCE(r.team, ''),
		       COALESCE(r.cloud, ''),
		       COALESCE(r.service, ''),
		       COALESCE(r.status, ''),
		       COALESCE(a.source_environment, ''),
		       COALESCE(a.target_environment, ''),
		       COALESCE(a.gate_status, ''),
		       COALESCE(a.summary, ''),
		       COALESCE(a.note, ''),
		       a.approved_by,
		       COALESCE(u.username, ''),
		       a.source_request_updated_at,
		       a.approved_at,
		       a.expires_at,
		       a.revoked_at,
		       a.revoked_by,
		       COALESCE(revoker.username, ''),
		       COALESCE(a.revoke_note, '')
		FROM deployment_gate_approvals a
		LEFT JOIN pr_requests r ON r.id = a.request_id
		LEFT JOIN projects p ON p.id = a.project_id
		LEFT JOIN users u ON u.id = a.approved_by
		LEFT JOIN users revoker ON revoker.id = a.revoked_by
		WHERE %s
		ORDER BY a.approved_at DESC, a.id DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, len(args)+1, len(args)+2), queryArgs...)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return records, summary, nil
		}
		return nil, summary, err
	}
	defer cancel()
	defer rows.Close()

	now := time.Now()
	for rows.Next() {
		var record deploymentGateApprovalAuditRecord
		var projectIDValue sql.NullInt64
		var expiresAt sql.NullTime
		var revokedAt sql.NullTime
		var revokedBy sql.NullInt64
		if err := rows.Scan(
			&record.ID,
			&record.RequestID,
			&projectIDValue,
			&record.ProjectName,
			&record.ProjectCode,
			&record.Team,
			&record.Cloud,
			&record.Service,
			&record.RequestStatus,
			&record.SourceEnvironment,
			&record.TargetEnvironment,
			&record.GateStatus,
			&record.Summary,
			&record.Note,
			&record.ApprovedBy,
			&record.ApprovedByUsername,
			&record.SourceRequestUpdatedAt,
			&record.ApprovedAt,
			&expiresAt,
			&revokedAt,
			&revokedBy,
			&record.RevokedByUsername,
			&record.RevokeNote,
		); err != nil {
			return nil, summary, err
		}
		if projectIDValue.Valid {
			value := int(projectIDValue.Int64)
			record.ProjectID = &value
		}
		if expiresAt.Valid {
			record.ExpiresAt = &expiresAt.Time
		}
		if revokedAt.Valid {
			record.RevokedAt = &revokedAt.Time
		}
		if revokedBy.Valid {
			value := int(revokedBy.Int64)
			record.RevokedBy = &value
		}
		record.State = deriveDeploymentGateApprovalState(record.ExpiresAt, record.RevokedAt, now)
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, summary, err
	}
	return records, summary, nil
}

func devopsDeploymentGateApprovalsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}

	query := r.URL.Query()
	limit, _ := strconv.Atoi(strings.TrimSpace(query.Get("limit")))
	offset, _ := strconv.Atoi(strings.TrimSpace(query.Get("offset")))
	projectID, _ := strconv.Atoi(strings.TrimSpace(query.Get("project_id")))
	stateRaw := strings.TrimSpace(query.Get("state"))
	state := normalizeDeploymentGateApprovalStateFilter(stateRaw)
	if stateRaw != "" && state == "" {
		writeAPIError(w, r, http.StatusBadRequest, "state must be one of active, expired, or revoked", nil)
		return
	}

	records, summary, err := listDeploymentGateApprovalAuditRecords(
		limit,
		offset,
		projectID,
		query.Get("target_environment"),
		state,
		query.Get("approver"),
		query.Get("from"),
		query.Get("to"),
	)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load deployment gate approvals", err)
		return
	}

	if err := writeJSONResponse(w, http.StatusOK, map[string]any{
		"approvals": records,
		"summary":   summary,
		"status":    "ok",
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write deployment gate approvals response", err)
	}
}
