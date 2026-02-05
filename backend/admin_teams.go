package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// requireAdmin returns true if the request is from an admin (Bearer token with role=admin or X-Admin-Secret)
func requireAdmin(w http.ResponseWriter, r *http.Request) (userID int, ok bool) {
	if adminSecret := os.Getenv("ADMIN_SECRET"); adminSecret != "" && r.Header.Get("X-Admin-Secret") == adminSecret {
		return 0, true
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return 0, false
	}
	id, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid token", "status": "error"})
		return 0, false
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil || user.Role != "admin" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "admin role required", "status": "error"})
		return 0, false
	}
	return id, true
}

// adminUsersRouter dispatches GET (list) and POST (create) for /api/admin/users
func adminUsersRouter(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	switch r.Method {
	case "GET":
		adminUsersListHandler(w, r)
		return
	case "POST":
		adminUsersCreateHandler(w, r)
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

// adminUsersListHandler GET /api/admin/users - list users for adding to teams
func adminUsersListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	// Only present user credentials (exclude admin accounts) in admin console
	rows, err := DB.Query(`SELECT id, username, email, COALESCE(role,'viewer'), COALESCE(verified,false) FROM users WHERE role != 'admin' OR role IS NULL ORDER BY username`)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	defer rows.Close()
	var users []map[string]interface{}
	for rows.Next() {
		var id int
		var username, email, role string
		var verified bool
		if err := rows.Scan(&id, &username, &email, &role, &verified); err != nil {
			continue
		}
		users = append(users, map[string]interface{}{"id": id, "username": username, "email": email, "role": role, "verified": verified})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"users": users, "status": "ok"})
}

// adminUsersCreateHandler POST /api/admin/users - create a new user (admin only)
func adminUsersCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"` // viewer | contributor; default viewer
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	if req.Username == "" || req.Email == "" || req.Password == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "username, email and password are required", "status": "error"})
		return
	}
	if req.Role != "contributor" && req.Role != "viewer" {
		req.Role = "viewer"
	}
	var exists int
	if err := DB.QueryRow(`SELECT 1 FROM users WHERE username = $1`, req.Username).Scan(&exists); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "username already exists", "status": "error"})
		return
	}
	if err := DB.QueryRow(`SELECT 1 FROM users WHERE email = $1`, req.Email).Scan(&exists); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "email already exists", "status": "error"})
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Admin create user: bcrypt error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create user", "status": "error"})
		return
	}
	var userID int
	var createdAt interface{}
	err = DB.QueryRow(
		`INSERT INTO users (username, email, password, verified, role) VALUES ($1, $2, $3, TRUE, $4)
		 RETURNING id, created_at`,
		req.Username, req.Email, string(hashed), req.Role,
	).Scan(&userID, &createdAt)
	if err != nil {
		log.Printf("Admin create user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create user", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":   map[string]interface{}{"id": userID, "username": req.Username, "email": req.Email, "role": req.Role, "verified": true},
		"status": "ok",
	})
}

// adminTeamsListHandler GET /api/admin/teams
func adminTeamsListHandler(w http.ResponseWriter, r *http.Request) {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	teams, err := GetTeams()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"teams": teams, "status": "ok"})
}

// adminTeamsCreateHandler POST /api/admin/teams
func adminTeamsCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireAdmin(w, r)
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
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "name is required", "status": "error"})
		return
	}
	var createdBy *int
	if userID > 0 {
		createdBy = &userID
	}
	team, err := CreateTeam(strings.TrimSpace(body.Name), strings.TrimSpace(body.Slug), createdBy)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"team": team, "status": "ok"})
}

// adminTeamDetailHandler GET /api/admin/teams/:id
func adminTeamDetailHandler(w http.ResponseWriter, r *http.Request) {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	id, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid team id", "status": "error"})
		return
	}
	team, err := GetTeamByID(id)
	if err != nil || team == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team not found", "status": "error"})
		return
	}
	members, _ := GetTeamMembers(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"team": team, "members": members, "status": "ok"})
}

// adminTeamMembersAddHandler POST /api/admin/teams/:id/members
func adminTeamMembersAddHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	path = strings.TrimSuffix(path, "/members")
	teamID, _ := strconv.Atoi(path)
	if teamID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid team id", "status": "error"})
		return
	}
	var body struct {
		UserID int    `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if body.UserID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user_id is required", "status": "error"})
		return
	}
	member, err := AddTeamMember(teamID, body.UserID, body.Role)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"member": member, "status": "ok"})
}

// adminTeamMembersRemoveHandler DELETE /api/admin/teams/:id/members/:user_id
func adminTeamMembersRemoveHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "DELETE" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	// Path: /api/admin/teams/1/members/2
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid path", "status": "error"})
		return
	}
	teamID, _ := strconv.Atoi(parts[0])
	userID, _ := strconv.Atoi(parts[2])
	if teamID <= 0 || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid team id or user id", "status": "error"})
		return
	}
	if err := RemoveTeamMember(teamID, userID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "member removed", "status": "ok"})
}

// adminTeamsRouter dispatches /api/admin/teams, /api/admin/teams/:id, /api/admin/teams/:id/members
func adminTeamsRouter(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		switch r.Method {
		case "GET":
			adminTeamsListHandler(w, r)
			return
		case "POST":
			adminTeamsCreateHandler(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// path is /:id or /:id/members or /:id/members/:user_id
	parts := strings.Split(path[1:], "/") // [ "123" ] or [ "123", "members" ] or [ "123", "members", "456" ]
	if len(parts) == 1 {
		if r.Method == "GET" {
			adminTeamDetailHandler(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if len(parts) >= 2 && parts[1] == "members" {
		if r.Method == "POST" {
			adminTeamMembersAddHandler(w, r)
			return
		}
		if r.Method == "DELETE" && len(parts) == 3 {
			adminTeamMembersRemoveHandler(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.NotFound(w, r)
}
