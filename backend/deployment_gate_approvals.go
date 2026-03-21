package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type deploymentGateApprovalRecord struct {
	ID                     int        `json:"id"`
	RequestID              int        `json:"request_id"`
	ProjectID              *int       `json:"project_id,omitempty"`
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

func getActiveDeploymentGateApproval(requestID int, targetEnvironment string, sourceRequestUpdatedAt time.Time) (*deploymentGateApprovalRecord, error) {
	targetEnvironment = strings.ToLower(strings.TrimSpace(targetEnvironment))
	if requestID <= 0 || targetEnvironment == "" {
		return nil, nil
	}

	var record deploymentGateApprovalRecord
	var projectID sql.NullInt64
	var expiresAt sql.NullTime
	var revokedAt sql.NullTime
	var revokedBy sql.NullInt64
	err := queryRowContext(`
		SELECT a.id,
		       a.request_id,
		       a.project_id,
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
		LEFT JOIN users u ON u.id = a.approved_by
		LEFT JOIN users revoker ON revoker.id = a.revoked_by
		WHERE a.request_id = $1
		  AND LOWER(COALESCE(a.target_environment, '')) = $2
		  AND a.source_request_updated_at = $3
		  AND a.revoked_at IS NULL
		  AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
		ORDER BY a.approved_at DESC
		LIMIT 1
	`, requestID, targetEnvironment, sourceRequestUpdatedAt).Scan(
		&record.ID,
		&record.RequestID,
		&projectID,
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
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return nil, nil
		}
		return nil, err
	}
	if projectID.Valid {
		value := int(projectID.Int64)
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
	record.State = "active"
	return &record, nil
}

func listDeploymentGateApprovals(requestID int, targetEnvironment string, sourceRequestUpdatedAt time.Time) ([]deploymentGateApprovalRecord, error) {
	targetEnvironment = strings.ToLower(strings.TrimSpace(targetEnvironment))
	if requestID <= 0 || targetEnvironment == "" {
		return []deploymentGateApprovalRecord{}, nil
	}

	rows, cancel, err := queryRowsWithTimeout(`
		SELECT a.id,
		       a.request_id,
		       a.project_id,
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
		LEFT JOIN users u ON u.id = a.approved_by
		LEFT JOIN users revoker ON revoker.id = a.revoked_by
		WHERE a.request_id = $1
		  AND LOWER(COALESCE(a.target_environment, '')) = $2
		  AND a.source_request_updated_at = $3
		ORDER BY a.approved_at DESC, a.id DESC
	`, requestID, targetEnvironment, sourceRequestUpdatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return []deploymentGateApprovalRecord{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	now := time.Now()
	out := make([]deploymentGateApprovalRecord, 0)
	for rows.Next() {
		var record deploymentGateApprovalRecord
		var projectID sql.NullInt64
		var expiresAt sql.NullTime
		var revokedAt sql.NullTime
		var revokedBy sql.NullInt64
		if err := rows.Scan(
			&record.ID,
			&record.RequestID,
			&projectID,
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
			return nil, err
		}
		if projectID.Valid {
			value := int(projectID.Int64)
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
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func createDeploymentGateApproval(req *PRRequest, decision *promotionGateDecision, approvedBy int, note string, expiresAt *time.Time) (*deploymentGateApprovalRecord, error) {
	if req == nil {
		return nil, fmt.Errorf("request not found")
	}
	if decision == nil {
		return nil, fmt.Errorf("deployment gate decision not available")
	}
	if approvedBy <= 0 {
		return nil, fmt.Errorf("approver is required")
	}

	targetEnvironment := strings.ToLower(strings.TrimSpace(decision.TargetEnvironment))
	if targetEnvironment == "" {
		return nil, fmt.Errorf("target environment is required")
	}

	if existing, err := getActiveDeploymentGateApproval(req.ID, targetEnvironment, req.UpdatedAt); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	trimmedNote := strings.TrimSpace(note)
	if len(trimmedNote) > 500 {
		trimmedNote = trimmedNote[:500]
	}

	var projectID any
	if req.ProjectID != nil && *req.ProjectID > 0 {
		projectID = *req.ProjectID
	}
	var expiresAtValue any
	if expiresAt != nil && !expiresAt.IsZero() {
		expiresAtValue = *expiresAt
	}

	var record deploymentGateApprovalRecord
	var insertedProjectID sql.NullInt64
	var insertedExpiresAt sql.NullTime
	err := queryRowContext(`
		INSERT INTO deployment_gate_approvals (
			request_id,
			project_id,
			source_environment,
			target_environment,
			gate_status,
			summary,
			note,
			approved_by,
			source_request_updated_at,
			expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, request_id, project_id, source_environment, target_environment, gate_status, summary, note, approved_by, source_request_updated_at, approved_at, expires_at
	`, req.ID, projectID, strings.ToLower(strings.TrimSpace(req.Env)), targetEnvironment, strings.ToLower(strings.TrimSpace(decision.Status)), strings.TrimSpace(decision.Summary), trimmedNote, approvedBy, req.UpdatedAt, expiresAtValue).Scan(
		&record.ID,
		&record.RequestID,
		&insertedProjectID,
		&record.SourceEnvironment,
		&record.TargetEnvironment,
		&record.GateStatus,
		&record.Summary,
		&record.Note,
		&record.ApprovedBy,
		&record.SourceRequestUpdatedAt,
		&record.ApprovedAt,
		&insertedExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	if insertedProjectID.Valid {
		value := int(insertedProjectID.Int64)
		record.ProjectID = &value
	}
	if insertedExpiresAt.Valid {
		record.ExpiresAt = &insertedExpiresAt.Time
	}
	if user, err := GetUserByID(approvedBy); err == nil && user != nil {
		record.ApprovedByUsername = user.Username
	}
	record.State = "active"
	return &record, nil
}

func revokeDeploymentGateApproval(requestID int, targetEnvironment string, sourceRequestUpdatedAt time.Time, revokedBy int, note string) (*deploymentGateApprovalRecord, error) {
	if revokedBy <= 0 {
		return nil, fmt.Errorf("revoker is required")
	}
	active, err := getActiveDeploymentGateApproval(requestID, targetEnvironment, sourceRequestUpdatedAt)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, fmt.Errorf("active deployment gate approval not found")
	}
	trimmedNote := strings.TrimSpace(note)
	if len(trimmedNote) > 500 {
		trimmedNote = trimmedNote[:500]
	}
	if _, err := execContext(`
		UPDATE deployment_gate_approvals
		SET revoked_at = CURRENT_TIMESTAMP,
		    revoked_by = $2,
		    revoke_note = $3
		WHERE id = $1
		  AND revoked_at IS NULL
	`, active.ID, revokedBy, trimmedNote); err != nil {
		return nil, err
	}
	history, err := listDeploymentGateApprovals(requestID, targetEnvironment, sourceRequestUpdatedAt)
	if err != nil {
		return nil, err
	}
	for _, item := range history {
		if item.ID == active.ID {
			return &item, nil
		}
	}
	return nil, fmt.Errorf("revoked deployment gate approval not found")
}
