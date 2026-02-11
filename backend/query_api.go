package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
	_ "github.com/go-sql-driver/mysql"
)

const (
	queryStatusPendingApproval = "pending_approval"
	queryStatusApproved        = "approved"
	queryStatusRejected        = "rejected"
	queryStatusExecuted        = "executed"
	queryStatusFailed          = "failed"
)

type DBConnection struct {
	ID               int    `json:"id"`
	Name             string `json:"name"`
	DBType           string `json:"db_type"`
	ConnectionString string `json:"-"` // never expose to client
	TeamID           *int   `json:"team_id"`
}

type QueryRequest struct {
	ID               int       `json:"id"`
	UserID           int       `json:"user_id"`
	ApproverID       *int      `json:"approver_id"`
	DBConnectionID   int       `json:"db_connection_id"`
	DBConnectionName string    `json:"db_connection_name"`
	QueryText        string    `json:"query_text"`
	Status           string    `json:"status"`
	ResultPreview    string    `json:"result_preview"`
	ErrorMessage     string    `json:"error_message"`
	SubmittedAt      time.Time `json:"submitted_at"`
	ApprovedAt       *time.Time `json:"approved_at"`
	RejectedAt       *time.Time `json:"rejected_at"`
	ExecutedAt       *time.Time `json:"executed_at"`
	Username         string    `json:"username"`
	ApproverUsername string    `json:"approver_username"`
}

func GetDBConnectionsForUser(userID int) ([]DBConnection, error) {
	if DB == nil {
		return nil, nil
	}
	teamIDs, err := GetTeamIDsForUser(userID)
	if err != nil {
		return nil, err
	}
	whereClause := "WHERE team_id IS NULL"
	var args []interface{}
	if len(teamIDs) > 0 {
		ph := make([]string, len(teamIDs))
		for i, tid := range teamIDs {
			ph[i] = fmt.Sprintf("$%d", i+1)
			args = append(args, tid)
		}
		whereClause += " OR team_id IN (" + strings.Join(ph, ",") + ")"
	}
	query := fmt.Sprintf(`
		SELECT id, name, db_type, team_id FROM db_connections %s ORDER BY name
	`, whereClause)
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBConnection
	for rows.Next() {
		var c DBConnection
		var teamID *int
		if err := rows.Scan(&c.ID, &c.Name, &c.DBType, &teamID); err != nil {
			return nil, err
		}
		c.TeamID = teamID
		out = append(out, c)
	}
	return out, nil
}

func GetDBConnectionByID(id int) (*DBConnection, error) {
	if DB == nil {
		return nil, nil
	}
	var c DBConnection
	var teamID *int
	err := DB.QueryRow(`
		SELECT id, name, db_type, connection_string, team_id FROM db_connections WHERE id = $1
	`, id).Scan(&c.ID, &c.Name, &c.DBType, &c.ConnectionString, &teamID)
	if err != nil {
		return nil, err
	}
	c.TeamID = teamID
	return &c, nil
}

func GetTeamIDsForUser(userID int) ([]int, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT team_id FROM team_members WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var tid int
		if err := rows.Scan(&tid); err != nil {
			return nil, err
		}
		ids = append(ids, tid)
	}
	return ids, nil
}

func SaveQueryRequest(userID int, dbConnectionID int, queryText string) (int, error) {
	if DB == nil {
		return 0, fmt.Errorf("database not available")
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO query_requests (user_id, db_connection_id, query_text, status)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, userID, dbConnectionID, queryText, queryStatusPendingApproval).Scan(&id)
	return id, err
}

func GetQueryRequestByID(id int) (*QueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	var q QueryRequest
	var approverID *int
	var approvedAt, rejectedAt, executedAt pq.NullTime
	err := DB.QueryRow(`
		SELECT qr.id, qr.user_id, qr.approver_id, qr.db_connection_id, dc.name, qr.query_text, qr.status,
		       COALESCE(qr.result_preview,''), COALESCE(qr.error_message,''), qr.submitted_at,
		       qr.approved_at, qr.rejected_at, qr.executed_at,
		       COALESCE(u.username,’'), COALESCE(au.username,'')
		FROM query_requests qr
		LEFT JOIN db_connections dc ON dc.id = qr.db_connection_id
		LEFT JOIN users u ON u.id = qr.user_id
		LEFT JOIN users au ON au.id = qr.approver_id
		WHERE qr.id = $1
	`, id).Scan(&q.ID, &q.UserID, &approverID, &q.DBConnectionID, &q.DBConnectionName, &q.QueryText, &q.Status,
		&q.ResultPreview, &q.ErrorMessage, &q.SubmittedAt, &approvedAt, &rejectedAt, &executedAt,
		&q.Username, &q.ApproverUsername)
	if err != nil {
		return nil, err
	}
	q.ApproverID = approverID
	if approvedAt.Valid {
		q.ApprovedAt = &approvedAt.Time
	}
	if rejectedAt.Valid {
		q.RejectedAt = &rejectedAt.Time
	}
	if executedAt.Valid {
		q.ExecutedAt = &executedAt.Time
	}
	return &q, nil
}

func GetQueryRequestsForUser(userID int, limit, offset int) ([]QueryRequest, int, error) {
	if DB == nil {
		return nil, 0, nil
	}
	var total int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM query_requests WHERE user_id = $1`, userID).Scan(&total)

	rows, err := DB.Query(`
		SELECT qr.id, qr.user_id, qr.approver_id, qr.db_connection_id, dc.name, qr.query_text, qr.status,
		       COALESCE(qr.result_preview,''), COALESCE(qr.error_message,''), qr.submitted_at,
		       qr.approved_at, qr.rejected_at, qr.executed_at,
		       COALESCE(u.username,''), COALESCE(au.username,'')
		FROM query_requests qr
		LEFT JOIN db_connections dc ON dc.id = qr.db_connection_id
		LEFT JOIN users u ON u.id = qr.user_id
		LEFT JOIN users au ON au.id = qr.approver_id
		WHERE qr.user_id = $1
		ORDER BY qr.submitted_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []QueryRequest
	for rows.Next() {
		var q QueryRequest
		var approverID *int
		var approvedAt, rejectedAt, executedAt pq.NullTime
		if err := rows.Scan(&q.ID, &q.UserID, &approverID, &q.DBConnectionID, &q.DBConnectionName, &q.QueryText, &q.Status,
			&q.ResultPreview, &q.ErrorMessage, &q.SubmittedAt, &approvedAt, &rejectedAt, &executedAt,
			&q.Username, &q.ApproverUsername); err != nil {
			return nil, 0, err
		}
		q.ApproverID = approverID
		if approvedAt.Valid {
			q.ApprovedAt = &approvedAt.Time
		}
		if rejectedAt.Valid {
			q.RejectedAt = &rejectedAt.Time
		}
		if executedAt.Valid {
			q.ExecutedAt = &executedAt.Time
		}
		list = append(list, q)
	}
	return list, total, nil
}

func GetPendingQueryApprovals(limit, offset int) ([]QueryRequest, int, error) {
	if DB == nil {
		return nil, 0, nil
	}
	var total int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM query_requests WHERE status = $1`, queryStatusPendingApproval).Scan(&total)

	rows, err := DB.Query(`
		SELECT qr.id, qr.user_id, qr.approver_id, qr.db_connection_id, dc.name, qr.query_text, qr.status,
		       COALESCE(qr.result_preview,''), COALESCE(qr.error_message,''), qr.submitted_at,
		       qr.approved_at, qr.rejected_at, qr.executed_at,
		       COALESCE(u.username,''), COALESCE(au.username,'')
		FROM query_requests qr
		LEFT JOIN db_connections dc ON dc.id = qr.db_connection_id
		LEFT JOIN users u ON u.id = qr.user_id
		LEFT JOIN users au ON au.id = qr.approver_id
		WHERE qr.status = $1
		ORDER BY qr.submitted_at ASC
		LIMIT $2 OFFSET $3
	`, queryStatusPendingApproval, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []QueryRequest
	for rows.Next() {
		var q QueryRequest
		var approverID *int
		var approvedAt, rejectedAt, executedAt pq.NullTime
		if err := rows.Scan(&q.ID, &q.UserID, &approverID, &q.DBConnectionID, &q.DBConnectionName, &q.QueryText, &q.Status,
			&q.ResultPreview, &q.ErrorMessage, &q.SubmittedAt, &approvedAt, &rejectedAt, &executedAt,
			&q.Username, &q.ApproverUsername); err != nil {
			return nil, 0, err
		}
		q.ApproverID = approverID
		if approvedAt.Valid {
			q.ApprovedAt = &approvedAt.Time
		}
		if rejectedAt.Valid {
			q.RejectedAt = &rejectedAt.Time
		}
		if executedAt.Valid {
			q.ExecutedAt = &executedAt.Time
		}
		list = append(list, q)
	}
	return list, total, nil
}

func GetQueryAudit(limit, offset int, statusFilter string) ([]QueryRequest, int, error) {
	if DB == nil {
		return nil, 0, nil
	}
	where := "WHERE 1=1"
	var args []interface{}
	argPos := 1
	if statusFilter != "" {
		where += fmt.Sprintf(" AND qr.status = $%d", argPos)
		args = append(args, statusFilter)
		argPos++
	}
	var total int
	countQuery := "SELECT COUNT(*) FROM query_requests qr " + where
	if err := DB.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	query := fmt.Sprintf(`
		SELECT qr.id, qr.user_id, qr.approver_id, qr.db_connection_id, dc.name, qr.query_text, qr.status,
		       COALESCE(qr.result_preview,''), COALESCE(qr.error_message,''), qr.submitted_at,
		       qr.approved_at, qr.rejected_at, qr.executed_at,
		       COALESCE(u.username,''), COALESCE(au.username,'')
		FROM query_requests qr
		LEFT JOIN db_connections dc ON dc.id = qr.db_connection_id
		LEFT JOIN users u ON u.id = qr.user_id
		LEFT JOIN users au ON au.id = qr.approver_id
		%s
		ORDER BY qr.submitted_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argPos, argPos+1)
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []QueryRequest
	for rows.Next() {
		var q QueryRequest
		var approverID *int
		var approvedAt, rejectedAt, executedAt pq.NullTime
		if err := rows.Scan(&q.ID, &q.UserID, &approverID, &q.DBConnectionID, &q.DBConnectionName, &q.QueryText, &q.Status,
			&q.ResultPreview, &q.ErrorMessage, &q.SubmittedAt, &approvedAt, &rejectedAt, &executedAt,
			&q.Username, &q.ApproverUsername); err != nil {
			return nil, 0, err
		}
		q.ApproverID = approverID
		if approvedAt.Valid {
			q.ApprovedAt = &approvedAt.Time
		}
		if rejectedAt.Valid {
			q.RejectedAt = &rejectedAt.Time
		}
		if executedAt.Valid {
			q.ExecutedAt = &executedAt.Time
		}
		list = append(list, q)
	}
	return list, total, nil
}

func ApproveQueryRequest(id int, approverID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	now := time.Now()
	_, err := DB.Exec(`
		UPDATE query_requests SET status = $1, approver_id = $2, approved_at = $3 WHERE id = $4 AND status = $5
	`, queryStatusApproved, approverID, now, id, queryStatusPendingApproval)
	return err
}

func RejectQueryRequest(id int, approverID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	now := time.Now()
	_, err := DB.Exec(`
		UPDATE query_requests SET status = $1, approver_id = $2, rejected_at = $3 WHERE id = $4 AND status = $5
	`, queryStatusRejected, approverID, now, id, queryStatusPendingApproval)
	return err
}

func ExecuteQueryAndUpdate(id int) error {
	qr, err := GetQueryRequestByID(id)
	if err != nil || qr == nil {
		return err
	}
	if qr.Status != queryStatusApproved {
		return fmt.Errorf("query must be approved first")
	}
	conn, err := GetDBConnectionByID(qr.DBConnectionID)
	if err != nil || conn == nil {
		return fmt.Errorf("db connection not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var resultPreview string
	var execErr error
	switch conn.DBType {
	case "postgres":
		resultPreview, execErr = executePostgresQuery(ctx, conn.ConnectionString, qr.QueryText)
	case "mysql":
		resultPreview, execErr = executeMySQLQuery(ctx, conn.ConnectionString, qr.QueryText)
	case "mongodb":
		resultPreview, execErr = executeMongoQuery(ctx, conn.ConnectionString, qr.QueryText)
	default:
		execErr = fmt.Errorf("unsupported db_type: %s", conn.DBType)
	}

	now := time.Now()
	if execErr != nil {
		_, _ = DB.Exec(`
			UPDATE query_requests SET status = $1, error_message = $2, executed_at = $3 WHERE id = $4
		`, queryStatusFailed, execErr.Error(), now, id)
		return execErr
	}
	_, err = DB.Exec(`
		UPDATE query_requests SET status = $1, result_preview = $2, executed_at = $3 WHERE id = $4
	`, queryStatusExecuted, truncatePreview(resultPreview, 5000), now, id)
	return err
}

func truncatePreview(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "\n... (truncated)"
}

func queryHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		myQueriesHandler(w, r)
	case "POST":
		submitQueryHandler(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func adminDBConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"connections": []interface{}{}, "status": "ok"})
		return
	}
	switch r.Method {
	case "GET":
		rows, err := DB.Query(`
			SELECT id, name, db_type, connection_string, team_id, created_at FROM db_connections ORDER BY name
		`)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var list []map[string]interface{}
		for rows.Next() {
			var id int
			var name, dbType, connStr string
			var teamID *int
			var createdAt time.Time
			if err := rows.Scan(&id, &name, &dbType, &connStr, &teamID, &createdAt); err != nil {
				continue
			}
			list = append(list, map[string]interface{}{
				"id": id, "name": name, "db_type": dbType,
				"connection_string": connStr, "team_id": teamID,
				"created_at": createdAt.Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"connections": list, "status": "ok"})
	case "POST":
		var body struct {
			Name             string `json:"name"`
			DBType           string `json:"db_type"`
			ConnectionString string `json:"connection_string"`
			TeamID           *int   `json:"team_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		if strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.DBType) == "" || strings.TrimSpace(body.ConnectionString) == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "name, db_type and connection_string required", "status": "error"})
			return
		}
		dbType := strings.ToLower(body.DBType)
		if dbType != "postgres" && dbType != "mysql" && dbType != "mongodb" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "db_type must be postgres, mysql or mongodb", "status": "error"})
			return
		}
		var id int
		err := DB.QueryRow(`
			INSERT INTO db_connections (name, db_type, connection_string, team_id) VALUES ($1, $2, $3, $4) RETURNING id
		`, strings.TrimSpace(body.Name), dbType, body.ConnectionString, body.TeamID).Scan(&id)
		if err != nil {
			log.Printf("Insert db_connection error: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "ok", "message": "Connection added"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func getDBConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := checkCanCreatePR(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "authentication required", "status": "error"})
		return
	}
	connections, err := GetDBConnectionsForUser(userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": connections, "status": "ok"})
}

func submitQueryHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := checkCanCreatePR(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "authentication required", "status": "error"})
		return
	}
	var body struct {
		DBConnectionID int    `json:"db_connection_id"`
		QueryText      string `json:"query_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.DBConnectionID <= 0 || strings.TrimSpace(body.QueryText) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "db_connection_id and query_text required", "status": "error"})
		return
	}
	// Verify user has access to this connection
	conns, err := GetDBConnectionsForUser(userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	allowed := false
	for _, c := range conns {
		if c.ID == body.DBConnectionID {
			allowed = true
			break
		}
	}
	if !allowed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access denied to this database", "status": "error"})
		return
	}
	id, err := SaveQueryRequest(userID, body.DBConnectionID, strings.TrimSpace(body.QueryText))
	if err != nil {
		log.Printf("SaveQueryRequest error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(&userID, "query_submit", "query_request", strconv.Itoa(id), "pending approval")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "ok", "message": "Query submitted for approval"})
}

func myQueriesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := checkCanCreatePR(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "authentication required", "status": "error"})
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	list, total, err := GetQueryRequestsForUser(userID, limit, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"queries": list, "total_count": total, "status": "ok"})
}

func devopsPendingQueryApprovalsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	_ = userID
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	list, total, err := GetPendingQueryApprovals(limit, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"queries": list, "total_count": total, "status": "ok"})
}

func devopsApproveQueryHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/query/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request id", "status": "error"})
		return
	}
	qr, err := GetQueryRequestByID(id)
	if err != nil || qr == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err := ApproveQueryRequest(id, userID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	userIDPtr := &qr.UserID
	AppendUserActivity(userIDPtr, "query_approved", "query_request", strconv.Itoa(id), "approved by DevOps manager")
	// Execute the query
	go func() {
		if execErr := ExecuteQueryAndUpdate(id); execErr != nil {
			log.Printf("[query] execute failed for id=%d: %v", id, execErr)
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Query approved and executed"})
}

func devopsQueryRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/query/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) >= 2 {
		id, _ := strconv.Atoi(parts[0])
		if id > 0 {
			switch parts[1] {
			case "approve":
				devopsApproveQueryHandler(w, r)
				return
			case "reject":
				devopsRejectQueryHandler(w, r)
				return
			}
		}
	}
	http.NotFound(w, r)
}

func devopsRejectQueryHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/query/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request id", "status": "error"})
		return
	}
	if err := RejectQueryRequest(id, userID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(&userID, "query_reject", "query_request", strconv.Itoa(id), "rejected by DevOps manager")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Query rejected"})
}

func devopsQueryAuditHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	statusFilter := r.URL.Query().Get("status")
	list, total, err := GetQueryAudit(limit, offset, statusFilter)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"queries": list, "total_count": total, "status": "ok"})
}
