package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func adminDbConnectionsRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/db-connections")
	path = strings.Trim(path, "/")
	if path == "" {
		switch r.Method {
		case "GET":
			adminDbConnectionsList(w, r)
		case "POST":
			adminDbConnectionsCreate(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	id, err := strconv.Atoi(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case "GET":
		adminDbConnectionGet(w, r, id)
	case "PATCH":
		adminDbConnectionUpdate(w, r, id)
	case "DELETE":
		adminDbConnectionDelete(w, r, id)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func adminDbConnectionsList(w http.ResponseWriter, r *http.Request) {
	// requireAdmin already called by router
	project := r.URL.Query().Get("project")
	conns, err := ListDBConnections(project)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list", "status": "error"})
		return
	}
	projects, _ := ListDBProjects()
	list := make([]map[string]interface{}, len(conns))
	for i, c := range conns {
		name := c.Name
		if name == "" {
			name = fmt.Sprintf("Connection #%d", c.ID)
		}
		project := c.Project
		if project == "" {
			project = "default"
		}
		list[i] = map[string]interface{}{
			"id":         c.ID,
			"name":       name,
			"db_type":    c.DBType,
			"project":    project,
			"created_at": c.CreatedAt,
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"connections": list, "projects": projects, "status": "ok"})
}

func adminDbConnectionsCreate(w http.ResponseWriter, r *http.Request) {
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		Name            string `json:"name"`
		DBType          string `json:"db_type"`
		Project         string `json:"project"`
		Host            string `json:"host"`
		Port            string `json:"port"`
		Username        string `json:"username"`
		Password        string `json:"password"`
		Database        string `json:"database"`
		SSLMode         string `json:"ssl_mode"`
		MongoDatabase   string `json:"mongo_database"`
		MongoCollection string `json:"mongo_collection"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.DBType == "" || body.Host == "" || body.Port == "" || body.Database == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "db_type, host, port, database required", "status": "error"})
		return
	}
	if body.DBType == "mongodb" && body.MongoCollection == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "mongo_collection required for MongoDB", "status": "error"})
		return
	}
	sslMode := body.SSLMode
	if sslMode != "disable" && sslMode != "required" && sslMode != "require" {
		sslMode = "disable"
	}
	c := &DBConnection{
		Name:            body.Name,
		DBType:          body.DBType,
		Project:         body.Project,
		Host:            body.Host,
		Port:            body.Port,
		Username:        body.Username,
		Password:        body.Password,
		Database:        body.Database,
		SSLMode:         sslMode,
		MongoDatabase:   body.MongoDatabase,
		MongoCollection: body.MongoCollection,
		CreatedBy:       &adminID,
	}
	if err := CreateDBConnection(c); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	AppendAuditLog(&adminID, "db_connection_create", "db_connection", strconv.Itoa(c.ID), c.Name)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": c.ID, "status": "ok"})
}

func adminDbConnectionGet(w http.ResponseWriter, r *http.Request, id int) {
	conn, err := GetDBConnectionByID(id)
	if err != nil || conn == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connection": map[string]interface{}{
			"id":               conn.ID,
			"name":             conn.Name,
			"db_type":          conn.DBType,
			"project":          conn.Project,
			"host":             conn.Host,
			"port":             conn.Port,
			"username":         conn.Username,
			"password":         conn.Password,
			"database":         conn.Database,
			"ssl_mode":         conn.SSLMode,
			"mongo_database":   conn.MongoDatabase,
			"mongo_collection": conn.MongoCollection,
			"created_at":       conn.CreatedAt,
		},
		"status": "ok",
	})
}

func adminDbConnectionUpdate(w http.ResponseWriter, r *http.Request, id int) {
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	conn, err := GetDBConnectionByID(id)
	if err != nil || conn == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found", "status": "error"})
		return
	}
	var body struct {
		Name            *string `json:"name"`
		DBType          *string `json:"db_type"`
		Project         *string `json:"project"`
		Host            *string `json:"host"`
		Port            *string `json:"port"`
		Username        *string `json:"username"`
		Password        *string `json:"password"`
		Database        *string `json:"database"`
		SSLMode         *string `json:"ssl_mode"`
		MongoDatabase   *string `json:"mongo_database"`
		MongoCollection *string `json:"mongo_collection"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.Name != nil {
		conn.Name = *body.Name
	}
	if body.DBType != nil {
		conn.DBType = *body.DBType
	}
	if body.Project != nil {
		conn.Project = *body.Project
	}
	if body.Host != nil {
		conn.Host = *body.Host
	}
	if body.Port != nil {
		conn.Port = *body.Port
	}
	if body.Username != nil {
		conn.Username = *body.Username
	}
	if body.Password != nil {
		conn.Password = *body.Password
	}
	if body.Database != nil {
		conn.Database = *body.Database
	}
	if body.SSLMode != nil {
		s := *body.SSLMode
		if s == "disable" || s == "required" || s == "require" {
			conn.SSLMode = s
		}
	}
	if body.MongoDatabase != nil {
		conn.MongoDatabase = *body.MongoDatabase
	}
	if body.MongoCollection != nil {
		conn.MongoCollection = *body.MongoCollection
	}
	if err := UpdateDBConnection(conn); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	AppendAuditLog(&adminID, "db_connection_update", "db_connection", strconv.Itoa(id), conn.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func adminDbConnectionDelete(w http.ResponseWriter, r *http.Request, id int) {
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	conn, _ := GetDBConnectionByID(id)
	if err := DeleteDBConnection(id); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	name := "unknown"
	if conn != nil {
		name = conn.Name
	}
	AppendAuditLog(&adminID, "db_connection_delete", "db_connection", strconv.Itoa(id), name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}
