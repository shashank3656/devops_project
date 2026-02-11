package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"
)

const (
	maxQueryLength  = 10000
	maxResultRows   = 500
	queryTimeoutSec = 30
)

// allowOnlySelect validates SQL to be read-only (SELECT only)
var selectOnlyRe = regexp.MustCompile(`(?is)^\s*(?:with\s+.+\s+)?select\s+`)

func allowOnlySelect(q string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(q))
	if selectOnlyRe.MatchString(trimmed) {
		return true
	}
	return false
}

// DbConnection represents a configured DB connection (credentials never sent to client)
type DbConnection struct {
	ID           int    `json:"id"`
	Alias        string `json:"alias"`
	DbType       string `json:"db_type"`
	Host         string `json:"-"`
	Port         int    `json:"-"`
	DatabaseName string `json:"-"`
	Username     string `json:"-"`
	Password     string `json:"-"`
	Enabled      bool   `json:"enabled"`
}

// ListDbConnections returns enabled connections (alias, db_type only) for user selection
func ListDbConnections() ([]map[string]interface{}, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, alias, db_type FROM db_connections WHERE enabled = TRUE ORDER BY alias
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var id int
		var alias, dbType string
		if err := rows.Scan(&id, &alias, &dbType); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{"id": id, "alias": alias, "db_type": dbType})
	}
	return out, nil
}

// GetDbConnectionByID returns full connection (for execution only, never exposed)
func GetDbConnectionByID(id int) (*DbConnection, error) {
	if DB == nil {
		return nil, nil
	}
	var c DbConnection
	err := DB.QueryRow(`
		SELECT id, alias, db_type, host, port, database_name, username, password, enabled
		FROM db_connections WHERE id = $1 AND enabled = TRUE
	`, id).Scan(&c.ID, &c.Alias, &c.DbType, &c.Host, &c.Port, &c.DatabaseName, &c.Username, &c.Password, &c.Enabled)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// QueryRequest represents a submitted query request
type QueryRequest struct {
	ID             int        `json:"id"`
	UserID         int        `json:"user_id"`
	ConnectionID   int        `json:"connection_id"`
	ConnectionAlias string    `json:"connection_alias"`
	DbType         string    `json:"db_type"`
	QueryText      string    `json:"query_text"`
	Status         string    `json:"status"`
	ApprovedBy     *int      `json:"approved_by"`
	SubmittedAt    time.Time `json:"submitted_at"`
	ApprovedAt     *time.Time `json:"approved_at"`
	ExecutedAt     *time.Time `json:"executed_at"`
	ResultSummary  string    `json:"result_summary"`
	ResultRows     string    `json:"result_rows"`
	ErrorMessage   string    `json:"error_message"`
}

// CreateQueryRequest inserts a new pending query request
func CreateQueryRequest(userID, connectionID int, connectionAlias, dbType, queryText string) (int, error) {
	var id int
	err := DB.QueryRow(`
		INSERT INTO query_requests (user_id, connection_id, connection_alias, db_type, query_text, status)
		VALUES ($1, $2, $3, $4, $5, 'pending_approval')
		RETURNING id
	`, userID, connectionID, connectionAlias, dbType, queryText).Scan(&id)
	return id, err
}

// GetQueryRequestByID fetches a single query request
func GetQueryRequestByID(id int) (*QueryRequest, error) {
	var q QueryRequest
	err := DB.QueryRow(`
		SELECT id, user_id, connection_id, connection_alias, db_type, query_text, status,
		       approved_by, submitted_at, approved_at, executed_at,
		       COALESCE(result_summary,''), COALESCE(result_rows,''), COALESCE(error_message,'')
		FROM query_requests WHERE id = $1
	`, id).Scan(&q.ID, &q.UserID, &q.ConnectionID, &q.ConnectionAlias, &q.DbType, &q.QueryText, &q.Status,
		&q.ApprovedBy, &q.SubmittedAt, &q.ApprovedAt, &q.ExecutedAt, &q.ResultSummary, &q.ResultRows, &q.ErrorMessage)
	if err != nil {
		return nil, err
	}
	return &q, nil
}

// GetPendingQueryCount returns count of pending_approval query requests
func GetPendingQueryCount() (int, error) {
	if DB == nil {
		return 0, nil
	}
	var n int
	err := DB.QueryRow("SELECT COUNT(*) FROM query_requests WHERE status = 'pending_approval'").Scan(&n)
	return n, err
}

// GetPendingQueryRequests returns all pending_approval queries
func GetPendingQueryRequests(limit, offset int) ([]*QueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := DB.Query(`
		SELECT id, user_id, connection_id, connection_alias, db_type, query_text, status,
		       approved_by, submitted_at, approved_at, executed_at,
		       COALESCE(result_summary,''), COALESCE(result_rows,''), COALESCE(error_message,'')
		FROM query_requests WHERE status = 'pending_approval'
		ORDER BY submitted_at ASC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*QueryRequest
	for rows.Next() {
		var q QueryRequest
		if err := rows.Scan(&q.ID, &q.UserID, &q.ConnectionID, &q.ConnectionAlias, &q.DbType, &q.QueryText, &q.Status,
			&q.ApprovedBy, &q.SubmittedAt, &q.ApprovedAt, &q.ExecutedAt, &q.ResultSummary, &q.ResultRows, &q.ErrorMessage); err != nil {
			return nil, err
		}
		out = append(out, &q)
	}
	return out, nil
}

// GetQueryRequestsByUserID returns query requests for a user
func GetQueryRequestsByUserID(userID, limit, offset int) ([]*QueryRequest, error) {
	if DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := DB.Query(`
		SELECT id, user_id, connection_id, connection_alias, db_type, query_text, status,
		       approved_by, submitted_at, approved_at, executed_at,
		       COALESCE(result_summary,''), COALESCE(result_rows,''), COALESCE(error_message,'')
		FROM query_requests WHERE user_id = $1
		ORDER BY submitted_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*QueryRequest
	for rows.Next() {
		var q QueryRequest
		if err := rows.Scan(&q.ID, &q.UserID, &q.ConnectionID, &q.ConnectionAlias, &q.DbType, &q.QueryText, &q.Status,
			&q.ApprovedBy, &q.SubmittedAt, &q.ApprovedAt, &q.ExecutedAt, &q.ResultSummary, &q.ResultRows, &q.ErrorMessage); err != nil {
			return nil, err
		}
		out = append(out, &q)
	}
	return out, nil
}

// GetQueryAudit returns all query requests for audit (DevOps)
func GetQueryAudit(limit, offset int) ([]map[string]interface{}, error) {
	if DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := DB.Query(`
		SELECT q.id, q.user_id, u1.username as submitter, q.connection_alias, q.db_type, q.query_text, q.status,
		       q.approved_by, u2.username as approver, q.submitted_at, q.approved_at, q.executed_at,
		       COALESCE(q.result_summary,''), COALESCE(q.error_message,'')
		FROM query_requests q
		LEFT JOIN users u1 ON u1.id = q.user_id
		LEFT JOIN users u2 ON u2.id = q.approved_by
		ORDER BY q.submitted_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var id, userID int
		var submitter, connectionAlias, dbType, queryText, status string
		var approvedBy sql.NullInt64
		var approver sql.NullString
		var submittedAt time.Time
		var approvedAt, executedAt sql.NullTime
		var resultSummary, errorMessage string
		if err := rows.Scan(&id, &userID, &submitter, &connectionAlias, &dbType, &queryText, &status,
			&approvedBy, &approver, &submittedAt, &approvedAt, &executedAt, &resultSummary, &errorMessage); err != nil {
			return nil, err
		}
		m := map[string]interface{}{
			"id":                id,
			"user_id":           userID,
			"submitter":         submitter,
			"connection_alias":  connectionAlias,
			"db_type":           dbType,
			"query_text":        queryText,
			"status":            status,
			"submitted_at":      submittedAt.Format(time.RFC3339),
			"result_summary":    resultSummary,
			"error_message":     errorMessage,
		}
		if approvedBy.Valid {
			m["approved_by"] = int(approvedBy.Int64)
		} else {
			m["approved_by"] = nil
		}
		if approver.Valid {
			m["approver"] = approver.String
		} else {
			m["approver"] = ""
		}
		if approvedAt.Valid {
			m["approved_at"] = approvedAt.Time.Format(time.RFC3339)
		} else {
			m["approved_at"] = ""
		}
		if executedAt.Valid {
			m["executed_at"] = executedAt.Time.Format(time.RFC3339)
		} else {
			m["executed_at"] = ""
		}
		out = append(out, m)
	}
	return out, nil
}

// UpdateQueryStatus updates status and optionally approved_by, approved_at
func UpdateQueryStatus(id int, status string, approvedBy *int, approvedAt *time.Time) error {
	if approvedBy != nil && approvedAt != nil {
		_, err := DB.Exec(`
			UPDATE query_requests SET status = $1, approved_by = $2, approved_at = $3 WHERE id = $4
		`, status, *approvedBy, *approvedAt, id)
		return err
	}
	_, err := DB.Exec(`UPDATE query_requests SET status = $1 WHERE id = $2`, status, id)
	return err
}

// UpdateQueryResult updates executed_at, result_summary, result_rows, error_message
func UpdateQueryResult(id int, resultSummary, resultRows, errorMessage string) error {
	_, err := DB.Exec(`
		UPDATE query_requests
		SET executed_at = CURRENT_TIMESTAMP, result_summary = $1, result_rows = $2, error_message = $3, status = 'executed'
		WHERE id = $4
	`, resultSummary, resultRows, errorMessage, id)
	return err
}

// ExecuteQuery runs the query against the configured DB (Postgres or MySQL only for now)
func ExecuteQuery(conn *DbConnection, queryText string) (summary string, rowsJSON string, err error) {
	if conn.DbType == "postgres" {
		return executePostgresQuery(conn, queryText)
	}
	if conn.DbType == "mysql" {
		return executeMySQLQuery(conn, queryText)
	}
	return "", "", nil
}

func executePostgresQuery(conn *DbConnection, queryText string) (summary string, rowsJSON string, err error) {
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		conn.Host, conn.Port, conn.Username, conn.Password, conn.DatabaseName)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return "", "", err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	return runSelectQuery(db, queryText)
}

func executeMySQLQuery(conn *DbConnection, queryText string) (summary string, rowsJSON string, err error) {
	dsn := conn.Username + ":" + conn.Password + "@tcp(" + conn.Host + ":" + strconv.Itoa(conn.Port) + ")/" + conn.DatabaseName + "?charset=utf8"
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return "", "", err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	return runSelectQuery(db, queryText)
}

func runSelectQuery(db *sql.DB, queryText string) (summary string, rowsJSON string, err error) {
	if !allowOnlySelect(queryText) {
		return "", "", nil
	}
	rows, err := db.Query(queryText)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var result [][]interface{}
	count := 0
	for rows.Next() && count < maxResultRows {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return "", "", err
		}
		row := make([]interface{}, len(cols))
		for i, v := range vals {
			switch x := v.(type) {
			case []byte:
				row[i] = string(x)
			default:
				row[i] = v
			}
		}
		result = append(result, row)
		count++
	}
	summary = strconv.Itoa(len(result)) + " row(s)"
	if count >= maxResultRows {
		summary += " (truncated at " + strconv.Itoa(maxResultRows) + ")"
	}
	out := map[string]interface{}{"columns": cols, "rows": result}
	b, _ := json.Marshal(out)
	return summary, string(b), nil
}

// --- HTTP Handlers ---

// adminDbConnectionsRouter routes GET/POST /api/admin/db-connections
func adminDbConnectionsRouter(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		adminDbConnectionsListHandler(w, r)
		return
	}
	if r.Method == "POST" {
		adminDbConnectionsCreateHandler(w, r)
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

// adminDbConnectionsListHandler GET /api/admin/db-connections - list all (admin)
func adminDbConnectionsListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"connections": []interface{}{}, "status": "ok"})
		return
	}
	rows, err := DB.Query(`SELECT id, alias, db_type, host, port, database_name, username, enabled FROM db_connections ORDER BY alias`)
	if err != nil {
		log.Printf("[db-query] admin list: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var id, port int
		var alias, dbType, host, dbName, username string
		var enabled bool
		if err := rows.Scan(&id, &alias, &dbType, &host, &port, &dbName, &username, &enabled); err != nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"id": id, "alias": alias, "db_type": dbType, "host": host, "port": port,
			"database_name": dbName, "username": username, "enabled": enabled,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": out, "status": "ok"})
}

// adminDbConnectionsCreateHandler POST /api/admin/db-connections - create (admin)
func adminDbConnectionsCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Alias        string `json:"alias"`
		DbType       string `json:"db_type"`
		Host         string `json:"host"`
		Port         int    `json:"port"`
		DatabaseName string `json:"database_name"`
		Username     string `json:"username"`
		Password     string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	body.Alias = strings.TrimSpace(body.Alias)
	body.DbType = strings.ToLower(strings.TrimSpace(body.DbType))
	if body.Alias == "" || body.DbType == "" || body.Host == "" || body.DatabaseName == "" || body.Username == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "alias, db_type, host, database_name, username required", "status": "error"})
		return
	}
	if body.DbType != "postgres" && body.DbType != "mysql" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "db_type must be postgres or mysql", "status": "error"})
		return
	}
	if body.Port <= 0 {
		if body.DbType == "mysql" {
			body.Port = 3306
		} else {
			body.Port = 5432
		}
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO db_connections (alias, db_type, host, port, database_name, username, password, enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
		RETURNING id
	`, body.Alias, body.DbType, body.Host, body.Port, body.DatabaseName, body.Username, body.Password).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "alias already exists", "status": "error"})
			return
		}
		log.Printf("[db-query] admin create: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "ok", "message": "Connection added"})
}

// dbQueryConnectionsHandler GET /api/db-query/connections - list available connections (user)
func dbQueryConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requirePortalUser(w, r)
	if !ok {
		return
	}
	_ = userID
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"connections": []interface{}{}, "status": "ok"})
		return
	}
	conns, err := ListDbConnections()
	if err != nil {
		log.Printf("[db-query] list connections: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": conns, "status": "ok"})
}

// requirePortalUser validates Bearer token and returns userID for portal users
func requirePortalUser(w http.ResponseWriter, r *http.Request) (userID int, ok bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return 0, false
	}
	token := authHeader[7:]
	uid, err := validateToken(token)
	if err != nil || uid <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid or expired token", "status": "error"})
		return 0, false
	}
	return uid, true
}

// dbQuerySubmitHandler POST /api/db-query/submit - submit query (user)
func dbQuerySubmitHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requirePortalUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	var body struct {
		ConnectionID int    `json:"connection_id"`
		QueryText    string `json:"query_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.ConnectionID <= 0 || strings.TrimSpace(body.QueryText) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection_id and query_text required", "status": "error"})
		return
	}
	if len(body.QueryText) > maxQueryLength {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "query too long", "status": "error"})
		return
	}
	conn, err := GetDbConnectionByID(body.ConnectionID)
	if err != nil || conn == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection not found or disabled", "status": "error"})
		return
	}
	if conn.DbType != "postgres" && conn.DbType != "mysql" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only postgres and mysql supported for SQL queries", "status": "error"})
		return
	}
	if !allowOnlySelect(body.QueryText) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "only SELECT queries are allowed", "status": "error"})
		return
	}
	id, err := CreateQueryRequest(userID, body.ConnectionID, conn.Alias, conn.DbType, body.QueryText)
	if err != nil {
		log.Printf("[db-query] create request: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	AppendUserActivity(&userID, "query_submit", "query_request", strconv.Itoa(id), "pending approval")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "status": "ok", "message": "Query submitted for DevOps manager approval"})
}

// dbQueryMyRequestsHandler GET /api/db-query/my-requests - user's query requests
func dbQueryMyRequestsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requirePortalUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"requests": []interface{}{}, "status": "ok"})
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
	reqs, err := GetQueryRequestsByUserID(userID, limit, offset)
	if err != nil {
		log.Printf("[db-query] my requests: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	out := make([]map[string]interface{}, len(reqs))
	for i, q := range reqs {
		out[i] = map[string]interface{}{
			"id":               q.ID,
			"connection_alias": q.ConnectionAlias,
			"db_type":          q.DbType,
			"query_text":       q.QueryText,
			"status":           q.Status,
			"submitted_at":     q.SubmittedAt.Format(time.RFC3339),
			"result_summary":   q.ResultSummary,
			"result_rows":      q.ResultRows,
			"error_message":    q.ErrorMessage,
		}
		if q.ApprovedAt != nil {
			out[i]["approved_at"] = q.ApprovedAt.Format(time.RFC3339)
		}
		if q.ExecutedAt != nil {
			out[i]["executed_at"] = q.ExecutedAt.Format(time.RFC3339)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"requests": out, "status": "ok"})
}

// dbQueryPendingHandler GET /api/devops/db-query/pending - pending approvals (DevOps manager)
func dbQueryPendingHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"requests": []interface{}{}, "status": "ok"})
		return
	}
	reqs, err := GetPendingQueryRequests(50, 0)
	if err != nil {
		log.Printf("[db-query] pending: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	usernames, _ := GetUsernamesByUserIDs(userIDsFromQueryRequests(reqs))
	out := make([]map[string]interface{}, len(reqs))
	for i, q := range reqs {
		out[i] = map[string]interface{}{
			"id":               q.ID,
			"user_id":          q.UserID,
			"submitter":        usernames[q.UserID],
			"connection_alias": q.ConnectionAlias,
			"db_type":          q.DbType,
			"query_text":       q.QueryText,
			"submitted_at":     q.SubmittedAt.Format(time.RFC3339),
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"requests": out, "status": "ok"})
}

func userIDsFromQueryRequests(reqs []*QueryRequest) []int {
	var ids []int
	seen := make(map[int]bool)
	for _, q := range reqs {
		if !seen[q.UserID] {
			ids = append(ids, q.UserID)
			seen[q.UserID] = true
		}
	}
	return ids
}

// dbQueryApproveHandler POST /api/devops/db-query/:id/approve - approve and execute
func dbQueryApproveHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	id := parseIDFromPath(r.URL.Path, "/api/devops/db-query/", "/approve")
	if id <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	qr, err := GetQueryRequestByID(id)
	if err != nil || qr == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if qr.Status != "pending_approval" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request is not pending approval", "status": "error"})
		return
	}
	conn, err := GetDbConnectionByID(qr.ConnectionID)
	if err != nil || conn == nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	now := time.Now()
	if err := UpdateQueryStatus(id, "approved", &managerID, &now); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	summary, rowsJSON, execErr := ExecuteQuery(conn, qr.QueryText)
	var errMsg string
	if execErr != nil {
		errMsg = execErr.Error()
		if err := UpdateQueryStatus(id, "failed", nil, nil); err == nil {
			_, _ = DB.Exec(`UPDATE query_requests SET error_message = $1, executed_at = CURRENT_TIMESTAMP WHERE id = $2`, errMsg, id)
		}
	} else {
		_ = UpdateQueryResult(id, summary, rowsJSON, "")
	}
	AppendUserActivity(&managerID, "query_approve", "query_request", strconv.Itoa(id), "approved and executed")
	w.Header().Set("Content-Type", "application/json")
	if execErr != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Approved but execution failed", "error": errMsg})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Approved and executed", "result_summary": summary})
}

// dbQueryRejectHandler POST /api/devops/db-query/:id/reject - reject
func dbQueryRejectHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if DB == nil {
		return
	}
	id := parseIDFromPath(r.URL.Path, "/api/devops/db-query/", "/reject")
	if id <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	qr, err := GetQueryRequestByID(id)
	if err != nil || qr == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if qr.Status != "pending_approval" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request is not pending approval", "status": "error"})
		return
	}
	now := time.Now()
	_ = UpdateQueryStatus(id, "rejected", &managerID, &now)
	AppendUserActivity(&managerID, "query_reject", "query_request", strconv.Itoa(id), "rejected")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Query rejected"})
}

func parseIDFromPath(path, prefix, suffix string) int {
	path = strings.TrimPrefix(path, prefix)
	path = strings.TrimSuffix(path, suffix)
	path = strings.Trim(path, "/")
	id, _ := strconv.Atoi(path)
	return id
}

// dbQueryActionRouter routes /api/devops/db-query/:id/approve and /reject
func dbQueryActionRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/db-query/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	id, _ := strconv.Atoi(parts[0])
	if id <= 0 {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "approve":
		r.URL.Path = "/api/devops/db-query/" + parts[0] + "/approve"
		dbQueryApproveHandler(w, r)
	case "reject":
		r.URL.Path = "/api/devops/db-query/" + parts[0] + "/reject"
		dbQueryRejectHandler(w, r)
	default:
		http.NotFound(w, r)
	}
}

// dbQueryAuditHandler GET /api/devops/db-query/audit - full audit (DevOps)
func dbQueryAuditHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"entries": []interface{}{}, "status": "ok"})
		return
	}
	limit := 100
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
	entries, err := GetQueryAudit(limit, offset)
	if err != nil {
		log.Printf("[db-query] audit: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"entries": entries, "status": "ok"})
}
