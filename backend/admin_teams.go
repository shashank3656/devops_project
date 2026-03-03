package main

import (
	"encoding/json"
	"fmt"
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
	// Only present user credentials (exclude admin accounts) in admin console; include user_type and devops_profile
	rows, err := DB.Query(`SELECT id, username, email, COALESCE(role,'viewer'), COALESCE(verified,false), COALESCE(user_type,'portal_user') FROM users WHERE role != 'admin' OR role IS NULL ORDER BY username`)
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
		var username, email, role, userType string
		var verified bool
		if err := rows.Scan(&id, &username, &email, &role, &verified, &userType); err != nil {
			continue
		}
		if userType != "devops_user" && userType != "portal_user" {
			userType = "portal_user"
		}
		u := map[string]interface{}{"id": id, "username": username, "email": email, "role": role, "verified": verified, "user_type": userType}
		if userType == "devops_user" {
			if prof, _ := GetDevopsProfile(id); prof != nil {
				u["devops_profile"] = map[string]interface{}{
					"is_manager":   prof.IsManager,
					"position":     prof.Position,
					"onboard_date": prof.OnboardDate,
					"level":        prof.Level,
				}
			}
		}
		users = append(users, u)
	}
	format := r.URL.Query().Get("format")
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=users.csv")
		csvLine := func(ss ...string) string {
			for i, s := range ss {
				if strings.Contains(s, ",") || strings.Contains(s, "\"") || strings.Contains(s, "\n") {
					ss[i] = "\"" + strings.ReplaceAll(strings.ReplaceAll(s, "\"", "\"\""), "\n", " ") + "\""
				}
			}
			return strings.Join(ss, ",")
		}
		w.Write([]byte(csvLine("id", "username", "email", "role", "verified", "user_type") + "\n"))
		for _, usr := range users {
			username, _ := usr["username"].(string)
			email, _ := usr["email"].(string)
			role, _ := usr["role"].(string)
			verified := "false"
			if v, _ := usr["verified"].(bool); v {
				verified = "true"
			}
			userType, _ := usr["user_type"].(string)
			idStr := fmt.Sprint(usr["id"])
			w.Write([]byte(csvLine(idStr, username, email, role, verified, userType) + "\n"))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"users": users, "status": "ok"})
}

// adminUsersCreateHandler POST /api/admin/users - create a new user (admin only)
func adminUsersCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	var req struct {
		Username    string `json:"username"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		Role        string `json:"role"`         // viewer | contributor; default viewer
		UserType    string `json:"user_type"`    // portal_user | devops_user
		IsManager   bool   `json:"is_manager"`   // for devops_user
		Position    string `json:"position"`     // for devops_user
		OnboardDate string `json:"onboard_date"` // YYYY-MM-DD for devops_user
		DevopsLevel string `json:"level"`        // L1..L4 for devops_user
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
	userType := strings.TrimSpace(req.UserType)
	if userType != "devops_user" && userType != "portal_user" {
		userType = "portal_user"
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
		`INSERT INTO users (username, email, password, verified, role, user_type) VALUES ($1, $2, $3, TRUE, $4, $5)
		 RETURNING id, created_at`,
		req.Username, req.Email, string(hashed), req.Role, userType,
	).Scan(&userID, &createdAt)
	if err != nil {
		log.Printf("Admin create user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create user", "status": "error"})
		return
	}
	if userType == "devops_user" {
		if err := CreateDevopsProfile(userID, req.IsManager, strings.TrimSpace(req.Position), strings.TrimSpace(req.OnboardDate), strings.TrimSpace(req.DevopsLevel)); err != nil {
			log.Printf("Admin create user: devops profile: %v", err)
		}
	}
	if userType == "portal_user" && req.IsManager {
		if _, err := DB.Exec("UPDATE users SET is_portal_manager = TRUE WHERE id = $1", userID); err != nil {
			log.Printf("Admin create user: is_portal_manager: %v", err)
		}
	}
	AppendAuditLog(adminIDPtr, "user_create", "user", strconv.Itoa(userID), req.Username)
	userResp := map[string]interface{}{"id": userID, "username": req.Username, "email": req.Email, "role": req.Role, "verified": true, "user_type": userType}
	if userType == "portal_user" {
		if u, _ := GetUserByID(userID); u != nil {
			userResp["is_portal_manager"] = u.IsPortalManager
		}
	}
	if userType == "devops_user" {
		if prof, _ := GetDevopsProfile(userID); prof != nil {
			userResp["devops_profile"] = map[string]interface{}{
				"is_manager": prof.IsManager, "position": prof.Position,
				"onboard_date": prof.OnboardDate, "level": prof.Level,
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"user": userResp, "status": "ok"})
}

// adminUserDetailHandler handles GET and PATCH /api/admin/users/:id (admin only)
func adminUserDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid user id", "status": "error"})
		return
	}
	if len(parts) > 1 {
		switch parts[1] {
		case "onboarding-progress":
			adminUserOnboardingProgressHandler(w, r, id)
			return
		default:
			http.NotFound(w, r)
			return
		}
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user not found", "status": "error"})
		return
	}
	switch r.Method {
	case "GET":
		userResp := map[string]interface{}{
			"id": user.ID, "username": user.Username, "email": user.Email,
			"role": user.Role, "verified": user.Verified, "created_at": user.CreatedAt,
			"user_type": user.UserType, "manager_id": user.ManagerID, "is_portal_manager": user.IsPortalManager,
		}
		if user.UserType == "devops_user" {
			if prof, _ := GetDevopsProfile(id); prof != nil {
				userResp["devops_profile"] = map[string]interface{}{
					"is_manager": prof.IsManager, "position": prof.Position,
					"onboard_date": prof.OnboardDate, "level": prof.Level,
				}
			}
		}
		teams, _ := GetTeamsForUserWithDetails(id)
		if len(teams) > 0 {
			userResp["teams"] = teams
		} else {
			userResp["teams"] = []interface{}{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"user": userResp, "status": "ok"})
		return
	case "PATCH", "PUT":
		var req struct {
			Username        string `json:"username"`
			Email           string `json:"email"`
			Role            string `json:"role"`
			Verified        *bool  `json:"verified"`
			UserType        string `json:"user_type"`
			ManagerID       *int   `json:"manager_id"`        // portal user's manager (for two-step approval)
			IsPortalManager *bool  `json:"is_portal_manager"` // portal user as group manager (same as DevOps manager checkbox)
			IsManager       *bool  `json:"is_manager"`
			Position        string `json:"position"`
			OnboardDate     string `json:"onboard_date"`
			Level           string `json:"level"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		username := strings.TrimSpace(req.Username)
		email := strings.TrimSpace(req.Email)
		if username == "" {
			username = user.Username
		}
		if email == "" {
			email = user.Email
		}
		role := req.Role
		if role != "viewer" && role != "contributor" && role != "admin" {
			role = user.Role
		}
		verified := user.Verified
		if req.Verified != nil {
			verified = *req.Verified
		}
		if err := UpdateUserProfile(id, username, email, role, verified); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		userType := strings.TrimSpace(req.UserType)
		if userType == "portal_user" || userType == "devops_user" {
			_ = UpdateUserType(id, userType)
			if userType == "devops_user" {
				isManager := false
				if req.IsManager != nil {
					isManager = *req.IsManager
				}
				_ = UpdateDevopsProfile(id, isManager, strings.TrimSpace(req.Position), strings.TrimSpace(req.OnboardDate), strings.TrimSpace(req.Level))
			}
		}
		if userType == "portal_user" {
			_ = UpdateUserManagerID(id, req.ManagerID)
			if req.IsPortalManager != nil {
				val := 0
				if *req.IsPortalManager {
					val = 1
				}
				_, _ = DB.Exec("UPDATE users SET is_portal_manager = $1 WHERE id = $2", val == 1, id)
			}
		}
		AppendAuditLog(adminIDPtr, "user_update", "user", strconv.Itoa(id), username)
		updated, _ := GetUserByID(id)
		if updated == nil {
			updated = user
		}
		respUser := map[string]interface{}{
			"id": updated.ID, "username": updated.Username, "email": updated.Email,
			"role": updated.Role, "verified": updated.Verified, "user_type": updated.UserType, "manager_id": updated.ManagerID, "is_portal_manager": updated.IsPortalManager,
		}
		if updated.UserType == "devops_user" {
			if prof, _ := GetDevopsProfile(id); prof != nil {
				respUser["devops_profile"] = map[string]interface{}{
					"is_manager": prof.IsManager, "position": prof.Position,
					"onboard_date": prof.OnboardDate, "level": prof.Level,
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"user": respUser, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteUser(id); err != nil {
			w.Header().Set("Content-Type", "application/json")
			if err.Error() == "user not found" {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusBadRequest)
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		AppendAuditLog(adminIDPtr, "user_delete", "user", strconv.Itoa(id), user.Username)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "user deleted"})
		return
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		Name         string `json:"name"`
		Slug         string `json:"slug"`
		TeamType     string `json:"team_type"`     // "portal" | "devops"
		DefaultEnv   string `json:"default_env"`   // e.g. dev, stage, prod
		DefaultCloud string `json:"default_cloud"` // optional default cloud
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
	teamType := strings.TrimSpace(strings.ToLower(body.TeamType))
	if teamType != "devops" && teamType != "portal" {
		teamType = "portal"
	}
	var createdBy *int
	if userID > 0 {
		createdBy = &userID
	}
	team, err := CreateTeam(strings.TrimSpace(body.Name), strings.TrimSpace(body.Slug), teamType, createdBy, strings.TrimSpace(body.DefaultEnv), strings.TrimSpace(body.DefaultCloud))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	AppendAuditLog(createdBy, "team_create", "team", strconv.Itoa(team.ID), team.Name)
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

// adminTeamUpdateHandler PATCH /api/admin/teams/:id - update default_env, default_cloud
func adminTeamUpdateHandler(w http.ResponseWriter, r *http.Request) {
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
	var body struct {
		DefaultEnv   string `json:"default_env"`
		DefaultCloud string `json:"default_cloud"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	team, err := GetTeamByID(id)
	if err != nil || team == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team not found", "status": "error"})
		return
	}
	if err := UpdateTeamDefaults(id, strings.TrimSpace(body.DefaultEnv), strings.TrimSpace(body.DefaultCloud)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	team, _ = GetTeamByID(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"team": team, "status": "ok"})
}

// adminTeamDeleteHandler DELETE /api/admin/teams/:id
func adminTeamDeleteHandler(w http.ResponseWriter, r *http.Request) {
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	path = strings.TrimSuffix(path, "/")
	teamID, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if teamID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid team id", "status": "error"})
		return
	}
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "team not found", "status": "error"})
		return
	}
	if err := DeleteTeam(teamID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to delete team", "status": "error"})
		return
	}
	AppendAuditLog(adminIDPtr, "team_delete", "team", strconv.Itoa(teamID), fmt.Sprintf("name=%s", team.Name))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "team deleted", "status": "ok"})
}

// adminTeamMembersAddHandler POST /api/admin/teams/:id/members
func adminTeamMembersAddHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
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
		UserID  int    `json:"user_id"`
		UserIDs []int  `json:"user_ids"`
		Role    string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	role := body.Role
	if role == "" {
		role = "member"
	}
	var idsToAdd []int
	if len(body.UserIDs) > 0 {
		for _, uid := range body.UserIDs {
			if uid > 0 {
				idsToAdd = append(idsToAdd, uid)
			}
		}
	} else if body.UserID > 0 {
		idsToAdd = []int{body.UserID}
	}
	if len(idsToAdd) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user_id or user_ids required", "status": "error"})
		return
	}
	var added []interface{}
	var failed []int
	for _, uid := range idsToAdd {
		member, err := AddTeamMember(teamID, uid, role)
		if err != nil {
			failed = append(failed, uid)
			continue
		}
		added = append(added, member)
		AppendAuditLog(adminIDPtr, "team_member_add", "team", strconv.Itoa(teamID), fmt.Sprintf("user_id=%d", uid))
	}
	w.Header().Set("Content-Type", "application/json")
	if len(added) == 1 && len(failed) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{"member": added[0], "status": "ok"})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{"added": added, "failed": failed, "status": "ok"})
	}
}

// adminTeamMemberUpdateRoleHandler PATCH /api/admin/teams/:id/members/:user_id - update member role (admin only)
func adminTeamMemberUpdateRoleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	if r.Method != "PATCH" && r.Method != "PUT" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
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
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if err := UpdateTeamMemberRole(teamID, userID, body.Role); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	AppendAuditLog(adminIDPtr, "team_member_role_update", "team", strconv.Itoa(teamID), fmt.Sprintf("user_id=%d,role=%s", userID, body.Role))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "role updated", "status": "ok"})
}

// adminTeamMembersRemoveHandler DELETE /api/admin/teams/:id/members/:user_id
func adminTeamMembersRemoveHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	if r.Method != "DELETE" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
	AppendAuditLog(adminIDPtr, "team_member_remove", "team", strconv.Itoa(teamID), fmt.Sprintf("user_id=%d", userID))
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
		switch r.Method {
		case "GET":
			adminTeamDetailHandler(w, r)
			return
		case "PATCH":
			adminTeamUpdateHandler(w, r)
			return
		case "DELETE":
			adminTeamDeleteHandler(w, r)
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
		if len(parts) == 3 {
			if r.Method == "PATCH" || r.Method == "PUT" {
				adminTeamMemberUpdateRoleHandler(w, r)
				return
			}
			if r.Method == "DELETE" {
				adminTeamMembersRemoveHandler(w, r)
				return
			}
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.NotFound(w, r)
}
