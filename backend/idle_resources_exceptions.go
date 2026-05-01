package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// IdleException is a manual whitelist: a (account_id, resource_id) pair that
// future scans should ignore. Optional expiry lets temporary exemptions
// auto-clear without admin action.
type IdleException struct {
	ID         int        `json:"id"`
	AccountID  int        `json:"account_id"`
	ResourceID string     `json:"resource_id"`
	Reason     string     `json:"reason"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedBy  *int       `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func listExceptions(ctx context.Context, accountID int) ([]IdleException, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT id, account_id, resource_id, COALESCE(reason, ''), expires_at, created_by, created_at
		FROM idle_resource_exceptions
		WHERE account_id = $1
		ORDER BY created_at DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleException{}
	for rows.Next() {
		var (
			e         IdleException
			expiresAt sql.NullTime
			createdBy sql.NullInt64
		)
		if err := rows.Scan(&e.ID, &e.AccountID, &e.ResourceID, &e.Reason, &expiresAt, &createdBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			t := expiresAt.Time
			e.ExpiresAt = &t
		}
		if createdBy.Valid {
			v := int(createdBy.Int64)
			e.CreatedBy = &v
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func createException(ctx context.Context, accountID int, resourceID, reason string, expiresAt *time.Time, actorID int) (IdleException, error) {
	var e IdleException
	if DB == nil {
		return e, fmt.Errorf("database not initialised")
	}
	row := DB.QueryRowContext(ctx, `
		INSERT INTO idle_resource_exceptions (account_id, resource_id, reason, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (account_id, resource_id) DO UPDATE SET
			reason = EXCLUDED.reason,
			expires_at = EXCLUDED.expires_at,
			created_by = EXCLUDED.created_by
		RETURNING id, account_id, resource_id, COALESCE(reason, ''), expires_at, created_by, created_at
	`, accountID, strings.TrimSpace(resourceID), strings.TrimSpace(reason), expiresAt, actorID)
	var (
		exp       sql.NullTime
		createdBy sql.NullInt64
	)
	if err := row.Scan(&e.ID, &e.AccountID, &e.ResourceID, &e.Reason, &exp, &createdBy, &e.CreatedAt); err != nil {
		return e, err
	}
	if exp.Valid {
		t := exp.Time
		e.ExpiresAt = &t
	}
	if createdBy.Valid {
		v := int(createdBy.Int64)
		e.CreatedBy = &v
	}
	return e, nil
}

func deleteException(ctx context.Context, id int) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `DELETE FROM idle_resource_exceptions WHERE id = $1`, id)
	return err
}

// loadExceptionSet returns a set of resource IDs to skip, dropping any whose
// expires_at has elapsed (those will be cleaned up by a future delete call,
// but skipping them in-memory keeps scans honest).
func loadExceptionSet(ctx context.Context, accountID int) (map[string]struct{}, error) {
	out := map[string]struct{}{}
	if DB == nil {
		return out, nil
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT resource_id FROM idle_resource_exceptions
		WHERE account_id = $1
		  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
	`, accountID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var rid string
		if err := rows.Scan(&rid); err != nil {
			return out, err
		}
		out[rid] = struct{}{}
	}
	return out, rows.Err()
}

// applyExceptionsFilter strips resources from the slice if their resource_id
// is on the exception list. The worker calls this right before persisting.
func applyExceptionsFilter(resources []IdleResource, except map[string]struct{}) []IdleResource {
	if len(except) == 0 {
		return resources
	}
	out := make([]IdleResource, 0, len(resources))
	for _, r := range resources {
		if _, skip := except[r.ResourceID]; skip {
			continue
		}
		out = append(out, r)
	}
	return out
}

// listAuditLog returns the last `limit` audit entries with optional account
// filter. Used by the audit-log UI page.
func listAuditLog(ctx context.Context, accountID int, limit int) ([]map[string]any, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	args := []interface{}{}
	where := ""
	if accountID > 0 {
		where = "WHERE l.account_id = $1"
		args = append(args, accountID)
	}
	args = append(args, limit)
	q := fmt.Sprintf(`
		SELECT l.id, l.account_id, l.scan_id, l.actor_id,
			COALESCE(u.username, '') AS actor_username,
			COALESCE(a.name, '') AS account_name,
			l.action, l.details::text, l.created_at
		FROM idle_audit_log l
		LEFT JOIN users u ON u.id = l.actor_id
		LEFT JOIN cloud_accounts a ON a.id = l.account_id
		%s
		ORDER BY l.created_at DESC
		LIMIT $%d
	`, where, len(args))
	rows, err := DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id           int64
			accountIDVal sql.NullInt64
			scanIDVal    sql.NullInt64
			actorIDVal   sql.NullInt64
			actor        string
			accountName  string
			action       string
			details      string
			createdAt    time.Time
		)
		if err := rows.Scan(&id, &accountIDVal, &scanIDVal, &actorIDVal, &actor, &accountName, &action, &details, &createdAt); err != nil {
			return nil, err
		}
		var detailsJSON json.RawMessage
		if strings.TrimSpace(details) == "" {
			detailsJSON = json.RawMessage("{}")
		} else {
			detailsJSON = json.RawMessage(details)
		}
		row := map[string]any{
			"id":             id,
			"action":         action,
			"actor_username": actor,
			"account_name":   accountName,
			"created_at":     createdAt,
			"details":        detailsJSON,
		}
		if accountIDVal.Valid {
			row["account_id"] = accountIDVal.Int64
		}
		if scanIDVal.Valid {
			row["scan_id"] = scanIDVal.Int64
		}
		if actorIDVal.Valid {
			row["actor_id"] = actorIDVal.Int64
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
