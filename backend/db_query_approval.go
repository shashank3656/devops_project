package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type DBQueryRequest struct {
	ID             int        `json:"id"`
	ConnectionID   int        `json:"connection_id"`
	ConnectionName string     `json:"connection_name"`
	Project        string     `json:"project"`
	Query          string     `json:"query"`
	RequestedBy    int        `json:"requested_by"`
	RequesterName  string     `json:"requester_name"`
	Status         string     `json:"status"`
	ApprovedBy     *int       `json:"approved_by"`
	ApprovedByName string     `json:"approved_by_name"`
	ApprovedAt     *time.Time `json:"approved_at"`
	ExecutedAt     *time.Time `json:"executed_at"`
	ResultRows     *int       `json:"result_rows"`
	ErrorMessage   string     `json:"error_message"`
	CreatedAt      time.Time  `json:"created_at"`
}

func CreateDBQueryRequest(connectionID int, query string, userID int) (*DBQueryRequest, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	conn, err := GetDBConnectionByID(connectionID)
	if err != nil || conn == nil {
		return nil, fmt.Errorf("connection not found")
	}
	var req DBQueryRequest
	err = DB.QueryRow(`INSERT INTO db_query_requests (connection_id, query, requested_by, status)
		VALUES ($1, $2, $3, 'pending_approval') RETURNING id, connection_id, query, requested_by, status, created_at`,
		connectionID, query, userID).
		Scan(&req.ID, &req.ConnectionID, &req.Query, &req.RequestedBy, &req.Status, &req.CreatedAt)
	if err != nil {
		return nil, err
	}
	req.ConnectionName = conn.Name
	req.Project = conn.Project
	return &req, nil
}

// GetDBQueryRequestMinimal gets only id, connection_id, query, status - no JOINs, works with any schema
func GetDBQueryRequestMinimal(id int) (*DBQueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	var req DBQueryRequest
	err := DB.QueryRow(`SELECT id, connection_id, query, status FROM db_query_requests WHERE id = $1`, id).
		Scan(&req.ID, &req.ConnectionID, &req.Query, &req.Status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func GetDBQueryRequestByID(id int) (*DBQueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	var req DBQueryRequest

	// Try 1: full query with COALESCE(name, alias)
	err := DB.QueryRow(`
		SELECT q.id, q.connection_id, COALESCE(NULLIF(TRIM(c.name),''), c.alias, '') as conn_name, COALESCE(c.project,''), q.query, q.requested_by, u1.username,
			q.status, q.approved_by, u2.username, q.approved_at, q.executed_at, q.result_rows, COALESCE(q.error_message,''), q.created_at
		FROM db_query_requests q
		JOIN db_connections c ON c.id = q.connection_id
		JOIN users u1 ON u1.id = q.requested_by
		LEFT JOIN users u2 ON u2.id = q.approved_by
		WHERE q.id = $1
	`, id).Scan(&req.ID, &req.ConnectionID, &req.ConnectionName, &req.Project, &req.Query, &req.RequestedBy, &req.RequesterName,
		&req.Status, &req.ApprovedBy, &req.ApprovedByName, &req.ApprovedAt, &req.ExecutedAt, &req.ResultRows, &req.ErrorMessage, &req.CreatedAt)
	if err == nil {
		return &req, nil
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}

	// Try 2: without alias
	err = DB.QueryRow(`
		SELECT q.id, q.connection_id, COALESCE(c.name,''), COALESCE(c.project,''), q.query, q.requested_by, u1.username,
			q.status, q.approved_by, u2.username, q.approved_at, q.executed_at, q.result_rows, COALESCE(q.error_message,''), q.created_at
		FROM db_query_requests q
		JOIN db_connections c ON c.id = q.connection_id
		JOIN users u1 ON u1.id = q.requested_by
		LEFT JOIN users u2 ON u2.id = q.approved_by
		WHERE q.id = $1
	`, id).Scan(&req.ID, &req.ConnectionID, &req.ConnectionName, &req.Project, &req.Query, &req.RequestedBy, &req.RequesterName,
		&req.Status, &req.ApprovedBy, &req.ApprovedByName, &req.ApprovedAt, &req.ExecutedAt, &req.ResultRows, &req.ErrorMessage, &req.CreatedAt)
	if err == nil {
		return &req, nil
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}

	// Try 3: minimal - no JOIN to db_connections (in case JOIN fails due to schema)
	err = DB.QueryRow(`
		SELECT q.id, q.connection_id, q.query, q.requested_by, u1.username, q.status, q.approved_by, u2.username, q.approved_at, q.executed_at, q.result_rows, COALESCE(q.error_message,''), q.created_at
		FROM db_query_requests q
		JOIN users u1 ON u1.id = q.requested_by
		LEFT JOIN users u2 ON u2.id = q.approved_by
		WHERE q.id = $1
	`, id).Scan(&req.ID, &req.ConnectionID, &req.Query, &req.RequestedBy, &req.RequesterName,
		&req.Status, &req.ApprovedBy, &req.ApprovedByName, &req.ApprovedAt, &req.ExecutedAt, &req.ResultRows, &req.ErrorMessage, &req.CreatedAt)
	if err == nil {
		req.ConnectionName = ""
		req.Project = ""
		// Fetch connection name from db_connections if possible
		if conn, _ := GetDBConnectionByID(req.ConnectionID); conn != nil {
			req.ConnectionName = conn.Name
			if req.ConnectionName == "" {
				req.ConnectionName = fmt.Sprintf("Connection #%d", req.ConnectionID)
			}
			req.Project = conn.Project
		}
		return &req, nil
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return nil, err
}

func ListDBQueryRequestsPending() ([]DBQueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	// Use COALESCE(name, alias) for connection name - schema may use alias
	rows, err := DB.Query(`
		SELECT q.id, q.connection_id, COALESCE(NULLIF(TRIM(c.name),''), c.alias, '') as conn_name, COALESCE(c.project,''), q.query, q.requested_by, u1.username, q.status, q.created_at
		FROM db_query_requests q
		JOIN db_connections c ON c.id = q.connection_id
		JOIN users u1 ON u1.id = q.requested_by
		WHERE q.status = 'pending_approval'
		ORDER BY q.created_at ASC
	`)
	if err != nil && (strings.Contains(err.Error(), "alias") || strings.Contains(err.Error(), "does not exist")) {
		rows, err = DB.Query(`
			SELECT q.id, q.connection_id, COALESCE(c.name,''), COALESCE(c.project,''), q.query, q.requested_by, u1.username, q.status, q.created_at
			FROM db_query_requests q
			JOIN db_connections c ON c.id = q.connection_id
			JOIN users u1 ON u1.id = q.requested_by
			WHERE q.status = 'pending_approval'
			ORDER BY q.created_at ASC
		`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBQueryRequest
	for rows.Next() {
		var req DBQueryRequest
		if err := rows.Scan(&req.ID, &req.ConnectionID, &req.ConnectionName, &req.Project, &req.Query, &req.RequestedBy, &req.RequesterName, &req.Status, &req.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, nil
}

func ListDBQueryRequestsByUser(userID int) ([]DBQueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT q.id, q.connection_id, c.name, c.project, LEFT(q.query, 200) as query, q.requested_by, u1.username,
			q.status, q.approved_by, u2.username, q.approved_at, q.executed_at, q.result_rows, q.created_at
		FROM db_query_requests q
		JOIN db_connections c ON c.id = q.connection_id
		JOIN users u1 ON u1.id = q.requested_by
		LEFT JOIN users u2 ON u2.id = q.approved_by
		WHERE q.requested_by = $1
		ORDER BY q.created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBQueryRequest
	for rows.Next() {
		var req DBQueryRequest
		var queryPreview string
		if err := rows.Scan(&req.ID, &req.ConnectionID, &req.ConnectionName, &req.Project, &queryPreview, &req.RequestedBy, &req.RequesterName,
			&req.Status, &req.ApprovedBy, &req.ApprovedByName, &req.ApprovedAt, &req.ExecutedAt, &req.ResultRows, &req.CreatedAt); err != nil {
			return nil, err
		}
		req.Query = queryPreview
		out = append(out, req)
	}
	return out, nil
}

func ApproveDBQueryRequest(id int, approverID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`UPDATE db_query_requests SET status='approved', approved_by=$1, approved_at=CURRENT_TIMESTAMP WHERE id=$2 AND status='pending_approval'`, approverID, id)
	return err
}

func RejectDBQueryRequest(id int, approverID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`UPDATE db_query_requests SET status='rejected', approved_by=$1, approved_at=CURRENT_TIMESTAMP WHERE id=$2 AND status='pending_approval'`, approverID, id)
	return err
}

func SetDBQueryRequestExecuted(id int, resultRows int, errMsg string) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	var err error
	if errMsg != "" {
		_, err = DB.Exec(`UPDATE db_query_requests SET status='executed', executed_at=CURRENT_TIMESTAMP, result_rows=$1, error_message=$2 WHERE id=$3`, resultRows, errMsg, id)
	} else {
		_, err = DB.Exec(`UPDATE db_query_requests SET status='executed', executed_at=CURRENT_TIMESTAMP, result_rows=$1 WHERE id=$2`, resultRows, id)
	}
	return err
}
