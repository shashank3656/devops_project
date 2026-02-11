package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// dbQueryConnectionsHandler GET /api/admin/db-connections - list DB connections (admin)
func dbQueryConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	conns, projects, err := listDBConnectionsHelper(w, r, true, "")
	if err != nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": conns, "projects": projects, "status": "ok"})
}

// meDbConnectionsHandler GET /api/me/db-connections?project=X - list for user
func meDbConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	conns, projects, err := listDBConnectionsHelper(w, r, false, r.URL.Query().Get("project"))
	if err != nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": conns, "projects": projects, "status": "ok"})
}

func listDBConnectionsHelper(w http.ResponseWriter, r *http.Request, admin bool, project string) ([]map[string]interface{}, []string, error) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return nil, nil, fmt.Errorf("options")
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return nil, nil, fmt.Errorf("method")
	}
	if admin {
		if _, ok := requireAdmin(w, r); !ok {
			return nil, nil, fmt.Errorf("auth")
		}
	} else {
		userID, err := validateBearerToken(w, r)
		if err != nil || userID <= 0 {
			return nil, nil, fmt.Errorf("auth")
		}
		_ = userID
	}

	conns, err := ListDBConnections(project)
	if err != nil {
		log.Printf("[db-query] list connections: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list connections", "status": "error"})
		return nil, nil, fmt.Errorf("list")
	}
	projects, _ := ListDBProjects()

	list := make([]map[string]interface{}, len(conns))
	for i, c := range conns {
		list[i] = map[string]interface{}{
			"id":      c.ID,
			"name":    c.Name,
			"db_type": c.DBType,
			"project": c.Project,
		}
	}
	return list, projects, nil
}

// dbQueryExecuteHandler POST /api/admin/db-query - admin direct execute (no approval)
func dbQueryExecuteHandler(w http.ResponseWriter, r *http.Request) {
	executeDBQuery(w, r, true)
}

// dbQuerySubmitHandler POST /api/me/db-query - user submit for approval
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
	userID, err := validateBearerToken(w, r)
	if err != nil || userID <= 0 {
		return
	}

	var body struct {
		ConnectionID int    `json:"connection_id"`
		Query        string `json:"query"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.ConnectionID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection_id required", "status": "error"})
		return
	}
	conn, err := GetDBConnectionByID(body.ConnectionID)
	if err != nil || conn == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection not found", "status": "error"})
		return
	}
	if conn.DBType == "mongodb" {
		// MongoDB: query is filter JSON - allow empty (find all)
		if strings.TrimSpace(body.Query) != "" {
			// Validate JSON
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(body.Query), &m); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "MongoDB filter must be valid JSON", "status": "error"})
				return
			}
		}
	} else {
		if !isReadOnlyQuery(body.Query) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":  "only SELECT queries allowed",
				"status": "error",
			})
			return
		}
	}

	req, err := CreateDBQueryRequest(body.ConnectionID, body.Query, userID)
	if err != nil {
		log.Printf("[db-query] create request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to submit", "status": "error"})
		return
	}
	if userID > 0 && DB != nil {
		upu := userID
		AppendUserActivity(&upu, "db_query_request", "db_query_request", strconv.Itoa(req.ID), "pending approval")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      req.ID,
		"status":  "ok",
		"message": "Query submitted. A DevOps manager will approve it.",
	})
}

// dbQueryMyRequestsHandler GET /api/me/db-query-requests - user's query history
func dbQueryMyRequestsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, err := validateBearerToken(w, r)
	if err != nil || userID <= 0 {
		return
	}
	list, err := ListDBQueryRequestsByUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"requests": list, "status": "ok"})
}

// dbQueryPendingHandler GET /api/devops/db-query-pending - pending approvals (DevOps manager)
func dbQueryPendingHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	list, err := ListDBQueryRequestsPending()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"requests": list, "status": "ok"})
}

// dbQueryApproveHandler POST /api/devops/db-query/:id/approve - DevOps manager approve & execute
func dbQueryApproveHandler(w http.ResponseWriter, r *http.Request, id int) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	req, err := GetDBQueryRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found", "status": "error"})
		return
	}
	if req.Status != "pending_approval" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request already processed", "status": "error"})
		return
	}
	if err := ApproveDBQueryRequest(id, managerID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to approve", "status": "error"})
		return
	}
	// Execute the query
	conn, _ := GetDBConnectionByID(req.ConnectionID)
	if conn == nil {
		SetDBQueryRequestExecuted(id, 0, "connection not found")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Approved but execution failed: connection not found"})
		return
	}
	columns, rows, count, execErr := executeQueryForConnection(conn, req.Query)
	if execErr != nil {
		SetDBQueryRequestExecuted(id, 0, execErr.Error())
		AppendAuditLog(&managerID, "db_query_approve", "db_query_request", strconv.Itoa(id), "executed with error: "+execErr.Error())
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok", "message": "Approved", "executed": true, "error": execErr.Error(),
			"columns": columns, "rows": rows, "count": 0,
		})
		return
	}
	SetDBQueryRequestExecuted(id, count, "")
	AppendAuditLog(&managerID, "db_query_approve", "db_query_request", strconv.Itoa(id), fmt.Sprintf("approved and executed, rows=%d", count))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "message": "Approved and executed",
		"columns": columns, "rows": rows, "count": count,
	})
}

// dbQueryRejectHandler POST /api/devops/db-query/:id/reject
func dbQueryRejectHandler(w http.ResponseWriter, r *http.Request, id int) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if err := RejectDBQueryRequest(id, managerID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to reject", "status": "error"})
		return
	}
	AppendAuditLog(&managerID, "db_query_reject", "db_query_request", strconv.Itoa(id), "rejected")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Rejected"})
}

// devopsDbQueryRouter handles /api/devops/db-query/:id/approve and /api/devops/db-query/:id/reject
func devopsDbQueryRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/db-query/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "approve":
		dbQueryApproveHandler(w, r, id)
	case "reject":
		dbQueryRejectHandler(w, r, id)
	default:
		http.NotFound(w, r)
	}
}

// dbQueryResultHandler GET /api/me/db-query-requests/:id - get result for executed query
func dbQueryResultHandler(w http.ResponseWriter, r *http.Request, id int) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, err := validateBearerToken(w, r)
	if err != nil || userID <= 0 {
		return
	}
	req, err := GetDBQueryRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found", "status": "error"})
		return
	}
	if req.RequestedBy != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "access denied", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"request": req,
		"status":  "ok",
	})
}

func executeQueryForConnection(conn *DBConnection, query string) ([]string, []map[string]interface{}, int, error) {
	switch conn.DBType {
	case "postgres", "postgresql":
		return executeSQLQuery("postgres", conn.ConnectionString, query)
	case "mysql":
		return executeSQLQuery("mysql", conn.ConnectionString, query)
	case "mongodb":
		db := conn.MongoDatabase
		coll := conn.MongoCollection
		if db == "" || coll == "" {
			return nil, nil, 0, fmt.Errorf("MongoDB connection requires database and collection")
		}
		return executeMongoQuery(conn.ConnectionString, db, coll, query)
	default:
		return nil, nil, 0, fmt.Errorf("unsupported db_type: %s", conn.DBType)
	}
}

func executeDBQuery(w http.ResponseWriter, r *http.Request, adminBypass bool) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var authID int
	if adminBypass {
		var ok bool
		authID, ok = requireAdmin(w, r)
		if !ok {
			return
		}
	} else {
		var err error
		authID, err = validateBearerToken(w, r)
		if err != nil || authID <= 0 {
			return
		}
	}

	var body struct {
		ConnectionID int    `json:"connection_id"`
		Query        string `json:"query"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.ConnectionID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection_id required", "status": "error"})
		return
	}
	conn, err := GetDBConnectionByID(body.ConnectionID)
	if err != nil || conn == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "connection not found", "status": "error"})
		return
	}
	if conn.DBType == "mongodb" {
		// MongoDB: query is filter JSON
		if body.Query != "" {
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(body.Query), &m); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "MongoDB filter must be valid JSON", "status": "error"})
				return
			}
		}
	} else {
		if !isReadOnlyQuery(body.Query) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":  "only SELECT queries allowed",
				"status": "error",
			})
			return
		}
	}

	columns, rows, count, execErr := executeQueryForConnection(conn, body.Query)
	if execErr != nil {
		log.Printf("[db-query] execute error (user=%d): %v", authID, execErr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "query failed: " + execErr.Error(),
			"status": "error",
		})
		return
	}
	if authID > 0 && DB != nil {
		AppendAuditLog(&authID, "db_query", "db_query", strconv.Itoa(body.ConnectionID), fmt.Sprintf("rows=%d", count))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"columns": columns,
		"rows":    rows,
		"count":   count,
		"status":  "ok",
	})
}
