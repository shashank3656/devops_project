package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const (
	dbQueryMaxRows   = 1000
	dbQueryTimeout   = 30 * time.Second
	dbQueryMaxLength = 10000
)

// dbQueryConnection represents a database connection for the query UI
type dbQueryConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	DSN  string `json:"-"`
}

// getDBQueryConnections returns configured database connections
func getDBQueryConnections() []dbQueryConnection {
	conns := []dbQueryConnection{}

	// Main app DB (always available)
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("DB_HOST", "postgres"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "postgres"),
		getEnv("DB_NAME", "infra_portal"),
	)
	conns = append(conns, dbQueryConnection{
		ID:   "main",
		Name: "InfraGate (main)",
		DSN:  dsn,
	})

	// Additional connections from env: DB_QUERY_1_NAME, DB_QUERY_1_DSN, etc.
	for i := 1; i <= 5; i++ {
		name := os.Getenv(fmt.Sprintf("DB_QUERY_%d_NAME", i))
		dsn := os.Getenv(fmt.Sprintf("DB_QUERY_%d_DSN", i))
		if name != "" && dsn != "" {
			conns = append(conns, dbQueryConnection{
				ID:   fmt.Sprintf("extra_%d", i),
				Name: name,
				DSN:  dsn,
			})
		}
	}

	return conns
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

var dangerousSQL = regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b`)

// isReadOnlyQuery checks that the query is a safe SELECT-only query
func isReadOnlyQuery(q string) bool {
	trimmed := strings.TrimSpace(q)
	if len(trimmed) == 0 {
		return false
	}
	if len(trimmed) > dbQueryMaxLength {
		return false
	}
	// Must start with SELECT (allow WITH for CTEs)
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT") && !strings.HasPrefix(upper, "WITH") {
		return false
	}
	// Reject known dangerous keywords
	if dangerousSQL.MatchString(trimmed) {
		return false
	}
	return true
}

// dbQueryConnectionsHandler GET /api/admin/db-connections - list available DB connections
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
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	conns := getDBQueryConnections()
	list := make([]map[string]string, len(conns))
	for i, c := range conns {
		list[i] = map[string]string{"id": c.ID, "name": c.Name}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": list, "status": "ok"})
}

// dbQueryExecuteHandler POST /api/admin/db-query - execute read-only query
func dbQueryExecuteHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}

	var body struct {
		ConnectionID string `json:"connection_id"`
		Query        string `json:"query"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if !isReadOnlyQuery(body.Query) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "only SELECT queries are allowed. No INSERT, UPDATE, DELETE, DROP, etc.",
			"status": "error",
		})
		return
	}

	conns := getDBQueryConnections()
	var dsn string
	for _, c := range conns {
		if c.ID == body.ConnectionID {
			dsn = c.DSN
			break
		}
	}
	if dsn == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid connection_id", "status": "error"})
		return
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("[db-query] open connection: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to connect to database", "status": "error"})
		return
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx, body.Query)
	if err != nil {
		log.Printf("[db-query] query error (admin=%d): %v", adminID, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "query failed: " + err.Error(),
			"status": "error",
		})
		return
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to get columns", "status": "error"})
		return
	}

	// Scan rows into []map[string]interface{}
	result := []map[string]interface{}{}
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	rowCount := 0
	for rows.Next() {
		if rowCount >= dbQueryMaxRows {
			break
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			log.Printf("[db-query] scan error: %v", err)
			break
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			switch v := val.(type) {
			case []byte:
				row[col] = string(v)
			case nil:
				row[col] = nil
			default:
				row[col] = val
			}
		}
		result = append(result, row)
		rowCount++
	}
	if err := rows.Err(); err != nil {
		log.Printf("[db-query] rows error: %v", err)
	}

	// Audit log
	if adminID > 0 && DB != nil {
		AppendAuditLog(&adminID, "db_query", "db_query", body.ConnectionID, fmt.Sprintf("rows=%d", len(result)))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"columns": columns,
		"rows":    result,
		"count":   len(result),
		"status":  "ok",
	})
}
