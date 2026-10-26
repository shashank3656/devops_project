package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func encodeAdminTeamJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("admin teams response encode failed: %v", err)
	}
}

func adminBreakGlassUserID(r *http.Request) (int, bool) {
	secret := strings.TrimSpace(os.Getenv("ADMIN_SECRET"))
	if secret == "" || r.Header.Get("X-Admin-Secret") != secret {
		return 0, false
	}
	if isProductionRuntime() {
		log.Printf("admin break-glass rejected (disabled in production) path=%s", r.URL.Path)
		return 0, false
	}
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
		log.Printf("admin break-glass rejected (browser Origin) origin=%s path=%s", origin, r.URL.Path)
		return 0, false
	}
	id, err := strconv.Atoi(strings.TrimSpace(os.Getenv("ADMIN_BREAKGLASS_USER_ID")))
	if err != nil || id <= 0 {
		log.Printf("admin break-glass rejected (ADMIN_BREAKGLASS_USER_ID unset) path=%s remote=%s", r.URL.Path, r.RemoteAddr)
		return 0, false
	}
	log.Printf("admin break-glass used user_id=%d path=%s remote=%s", id, r.URL.Path, r.RemoteAddr)
	AppendAuditLog(&id, "admin_break_glass", "auth", r.URL.Path, r.RemoteAddr)
	return id, true
}

// requireAdmin returns true if the request is from an admin (Bearer token with role=admin or audited break-glass).
func requireAdmin(w http.ResponseWriter, r *http.Request) (userID int, ok bool) {
	if id, allowed := adminBreakGlassUserID(r); allowed {
		return id, true
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return 0, false
	}
	id, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", err)
		return 0, false
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil || user.Role != "admin" {
		writeAPIError(w, r, http.StatusForbidden, "admin role required", err)
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
	writeMethodNotAllowed(w, r)
}

// adminUsersListHandler GET /api/admin/users - list users for adding to teams
func adminUsersListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	// Only present user credentials (exclude admin accounts) in admin console; include user_type/devops_profile + SSO source metadata.
	rows, err := DB.Query(`
		SELECT
			id,
			username,
			email,
			COALESCE(role,'viewer'),
			COALESCE(verified,false),
			COALESCE(user_type,'portal_user'),
			COALESCE(auth_source,'local'),
			COALESCE(sso_provider,''),
			COALESCE(sso_active, TRUE),
			last_sso_sync_at,
			COALESCE(must_set_password, FALSE)
		FROM users
		WHERE role != 'admin' OR role IS NULL
		ORDER BY username
	`)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list users", err)
		return
	}
	defer rows.Close()
	var users []map[string]interface{}
	for rows.Next() {
		var id int
		var username, email, role, userType, authSource, ssoProvider string
		var verified bool
		var ssoActive bool
		var mustSetPassword bool
		var lastSyncAt sql.NullTime
		if err := rows.Scan(&id, &username, &email, &role, &verified, &userType, &authSource, &ssoProvider, &ssoActive, &lastSyncAt, &mustSetPassword); err != nil {
			continue
		}
		if userType != "devops_user" && userType != "portal_user" {
			userType = "portal_user"
		}
		u := map[string]interface{}{
			"id":          id,
			"username":    username,
			"email":       email,
			"role":        role,
			"verified":    verified,
			"user_type":   userType,
			"auth_source": strings.TrimSpace(strings.ToLower(authSource)),
			"sso_provider": func() string {
				return strings.TrimSpace(strings.ToLower(ssoProvider))
			}(),
			"sso_active":        ssoActive,
			"must_set_password": mustSetPassword,
			"activation": func() string {
				if mustSetPassword {
					return "pending"
				}
				return "active"
			}(),
		}
		if lastSyncAt.Valid {
			u["last_sso_sync_at"] = lastSyncAt.Time
		}
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
		if _, err := w.Write([]byte(csvLine("id", "username", "email", "role", "verified", "user_type", "auth_source", "sso_provider", "sso_active", "last_sso_sync_at") + "\n")); err != nil {
			return
		}
		for _, usr := range users {
			username, _ := usr["username"].(string)
			email, _ := usr["email"].(string)
			role, _ := usr["role"].(string)
			verified := "false"
			if v, _ := usr["verified"].(bool); v {
				verified = "true"
			}
			userType, _ := usr["user_type"].(string)
			authSource, _ := usr["auth_source"].(string)
			ssoProvider, _ := usr["sso_provider"].(string)
			ssoActive := "true"
			if v, ok := usr["sso_active"].(bool); ok && !v {
				ssoActive = "false"
			}
			lastSync := ""
			if ts, ok := usr["last_sso_sync_at"].(time.Time); ok {
				lastSync = ts.Format(time.RFC3339)
			}
			idStr := fmt.Sprint(usr["id"])
			if _, err := w.Write([]byte(csvLine(idStr, username, email, role, verified, userType, authSource, ssoProvider, ssoActive, lastSync) + "\n")); err != nil {
				return
			}
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"users": users, "status": "ok"})
}

// adminUsersCreateHandler POST /api/admin/users - create a new user (admin only)
func adminUsersCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
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
		Invite      bool   `json:"invite"`
		Role        string `json:"role"`         // viewer | contributor; default viewer
		UserType    string `json:"user_type"`    // portal_user | devops_user
		IsManager   bool   `json:"is_manager"`   // for devops_user
		Position    string `json:"position"`     // for devops_user
		OnboardDate string `json:"onboard_date"` // YYYY-MM-DD for devops_user
		DevopsLevel string `json:"level"`        // L1..L4 for devops_user
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	if req.Username == "" || req.Email == "" || (!req.Invite && strings.TrimSpace(req.Password) == "") {
		writeAPIError(w, r, http.StatusBadRequest, "username, email and password are required", nil)
		return
	}
	if req.Invite {
		generated, err := randomInvitePassword()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to create user", err)
			return
		}
		req.Password = generated
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
		writeAPIError(w, r, http.StatusConflict, "username already exists", nil)
		return
	}
	if err := DB.QueryRow(`SELECT 1 FROM users WHERE email = $1`, req.Email).Scan(&exists); err == nil {
		writeAPIError(w, r, http.StatusConflict, "email already exists", nil)
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Admin create user: bcrypt error: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create user", err)
		return
	}
	var userID int
	var createdAt interface{}
	err = DB.QueryRow(
		`INSERT INTO users (username, email, password, verified, role, user_type, must_set_password) VALUES ($1, $2, $3, TRUE, $4, $5, $6)
		 RETURNING id, created_at`,
		req.Username, req.Email, string(hashed), req.Role, userType, req.Invite,
	).Scan(&userID, &createdAt)
	if err != nil {
		log.Printf("Admin create user: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create user", err)
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
	activation := "active"
	emailSent := false
	if req.Invite {
		emailSent = sendSetPasswordInvite(userID, req.Email)
		if !emailSent {
			removeUnsentInvite(userID)
			writeAPIError(w, r, http.StatusBadRequest, "The set-password email was not sent, so the account was not created. Set a temporary password, or configure mail and try again.", nil)
			return
		}
		activation = "pending"
	} else {
		emailSent = sendAccountCreatedEmail(req.Email, req.Username)
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
	encodeAdminTeamJSON(w, map[string]interface{}{"user": userResp, "status": "ok", "email_sent": emailSent, "activation": activation})
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
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
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
		writeAPIError(w, r, http.StatusBadRequest, "invalid user id", err)
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
		writeAPIError(w, r, http.StatusNotFound, "user not found", err)
		return
	}
	switch r.Method {
	case "GET":
		userResp := map[string]interface{}{
			"id": user.ID, "username": user.Username, "email": user.Email,
			"role": user.Role, "verified": user.Verified, "created_at": user.CreatedAt,
			"user_type": user.UserType, "manager_id": user.ManagerID, "is_portal_manager": user.IsPortalManager,
		}
		var mustSetPassword bool
		if err := DB.QueryRow(`SELECT COALESCE(must_set_password, FALSE) FROM users WHERE id = $1`, user.ID).Scan(&mustSetPassword); err == nil {
			userResp["must_set_password"] = mustSetPassword
			if mustSetPassword {
				userResp["activation"] = "pending"
			} else {
				userResp["activation"] = "active"
			}
		}
		var authSource, ssoProvider string
		var ssoActive bool
		var lastSyncAt sql.NullTime
		_ = DB.QueryRow(
			`SELECT COALESCE(auth_source,'local'), COALESCE(sso_provider,''), COALESCE(sso_active, TRUE), last_sso_sync_at FROM users WHERE id = $1`,
			id,
		).Scan(&authSource, &ssoProvider, &ssoActive, &lastSyncAt)
		userResp["auth_source"] = strings.TrimSpace(strings.ToLower(authSource))
		userResp["sso_provider"] = strings.TrimSpace(strings.ToLower(ssoProvider))
		userResp["sso_active"] = ssoActive
		if lastSyncAt.Valid {
			userResp["last_sso_sync_at"] = lastSyncAt.Time
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
		encodeAdminTeamJSON(w, map[string]interface{}{"user": userResp, "status": "ok"})
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
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
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
			writeAPIError(w, r, http.StatusBadRequest, "failed to update user profile", err)
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
		var authSource, ssoProvider string
		var ssoActive bool
		var lastSyncAt sql.NullTime
		_ = DB.QueryRow(
			`SELECT COALESCE(auth_source,'local'), COALESCE(sso_provider,''), COALESCE(sso_active, TRUE), last_sso_sync_at FROM users WHERE id = $1`,
			id,
		).Scan(&authSource, &ssoProvider, &ssoActive, &lastSyncAt)
		respUser["auth_source"] = strings.TrimSpace(strings.ToLower(authSource))
		respUser["sso_provider"] = strings.TrimSpace(strings.ToLower(ssoProvider))
		respUser["sso_active"] = ssoActive
		if lastSyncAt.Valid {
			respUser["last_sso_sync_at"] = lastSyncAt.Time
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
		encodeAdminTeamJSON(w, map[string]interface{}{"user": respUser, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteUser(id); err != nil {
			if err.Error() == "user not found" {
				writeAPIError(w, r, http.StatusNotFound, "user not found", err)
			} else {
				writeAPIError(w, r, http.StatusBadRequest, "failed to delete user", err)
			}
			return
		}
		AppendAuditLog(adminIDPtr, "user_delete", "user", strconv.Itoa(id), user.Username)
		w.Header().Set("Content-Type", "application/json")
		encodeAdminTeamJSON(w, map[string]interface{}{"status": "ok", "message": "user deleted"})
		return
	}
	writeMethodNotAllowed(w, r)
}

// adminTeamsListHandler GET /api/admin/teams
func adminTeamsListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	teams, err := GetTeams()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list teams", err)
		return
	}
	if teams == nil {
		teams = []Team{}
	}
	saved, _ := loadSavedSectionGrants()
	views := make([]map[string]interface{}, 0, len(teams))
	for _, team := range teams {
		grants, custom := saved[team.ID]
		if !custom {
			grants = defaultSectionGrants(team.TeamType)
		}
		views = append(views, map[string]interface{}{
			"id":           team.ID,
			"name":         team.Name,
			"slug":         team.Slug,
			"team_type":    team.TeamType,
			"grants":       grants,
			"grants_saved": custom,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"teams": views, "status": "ok"})
}

// adminTeamsCreateHandler POST /api/admin/teams
func adminTeamsCreateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
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
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "name is required", nil)
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
		writeAPIError(w, r, http.StatusBadRequest, "failed to create team", err)
		return
	}
	AppendAuditLog(createdBy, "team_create", "team", strconv.Itoa(team.ID), team.Name)
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"team": team, "status": "ok"})
}

// adminTeamDetailHandler GET /api/admin/teams/:id
func adminTeamDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	id, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	team, err := GetTeamByID(id)
	if err != nil || team == nil {
		writeAPIError(w, r, http.StatusNotFound, "team not found", err)
		return
	}
	members, _ := GetTeamMembers(id)
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"team": team, "members": members, "status": "ok"})
}

// adminTeamUpdateHandler PATCH /api/admin/teams/:id - update default_env, default_cloud
func adminTeamUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	id, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	var body struct {
		DefaultEnv   string `json:"default_env"`
		DefaultCloud string `json:"default_cloud"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	team, err := GetTeamByID(id)
	if err != nil || team == nil {
		writeAPIError(w, r, http.StatusNotFound, "team not found", err)
		return
	}
	if err := UpdateTeamDefaults(id, strings.TrimSpace(body.DefaultEnv), strings.TrimSpace(body.DefaultCloud)); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update team defaults", err)
		return
	}
	team, _ = GetTeamByID(id)
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"team": team, "status": "ok"})
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
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	path = strings.TrimSuffix(path, "/")
	teamID, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if teamID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil {
		writeAPIError(w, r, http.StatusNotFound, "team not found", err)
		return
	}
	if err := DeleteTeam(teamID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to delete team", err)
		return
	}
	AppendAuditLog(adminIDPtr, "team_delete", "team", strconv.Itoa(teamID), fmt.Sprintf("name=%s", team.Name))
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"message": "team deleted", "status": "ok"})
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
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	path = strings.TrimSuffix(path, "/members")
	teamID, _ := strconv.Atoi(path)
	if teamID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	var body struct {
		UserID  int    `json:"user_id"`
		UserIDs []int  `json:"user_ids"`
		Role    string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
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
		writeAPIError(w, r, http.StatusBadRequest, "user_id or user_ids required", nil)
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
		encodeAdminTeamJSON(w, map[string]interface{}{"member": added[0], "status": "ok"})
	} else {
		encodeAdminTeamJSON(w, map[string]interface{}{"added": added, "failed": failed, "status": "ok"})
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
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid path", nil)
		return
	}
	teamID, _ := strconv.Atoi(parts[0])
	userID, _ := strconv.Atoi(parts[2])
	if teamID <= 0 || userID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id or user id", nil)
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if err := UpdateTeamMemberRole(teamID, userID, body.Role); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "failed to update member role", err)
		return
	}
	AppendAuditLog(adminIDPtr, "team_member_role_update", "team", strconv.Itoa(teamID), fmt.Sprintf("user_id=%d,role=%s", userID, body.Role))
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"message": "role updated", "status": "ok"})
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
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	// Path: /api/admin/teams/1/members/2
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid path", nil)
		return
	}
	teamID, _ := strconv.Atoi(parts[0])
	userID, _ := strconv.Atoi(parts[2])
	if teamID <= 0 || userID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id or user id", nil)
		return
	}
	if err := RemoveTeamMember(teamID, userID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to remove team member", err)
		return
	}
	AppendAuditLog(adminIDPtr, "team_member_remove", "team", strconv.Itoa(teamID), fmt.Sprintf("user_id=%d", userID))
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{"message": "member removed", "status": "ok"})
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
		writeMethodNotAllowed(w, r)
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
		writeMethodNotAllowed(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "grants" {
		adminTeamGrantsHandler(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "k8s-access" {
		adminTeamK8sAccessHandler(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "cost-access" {
		adminTeamCostAccessHandler(w, r)
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
		writeMethodNotAllowed(w, r)
		return
	}
	http.NotFound(w, r)
}
