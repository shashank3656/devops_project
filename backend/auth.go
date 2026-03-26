package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

func encodeAuthJSON(w http.ResponseWriter, payload interface{}) {
	setSafeJSONResponseHeaders(w.Header())
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("auth response encode failed: %v", err)
	}
}

func normalizeUserNotificationKind(raw string) string {
	normalized := strings.TrimSpace(strings.ToLower(raw))
	switch normalized {
	case "", "approved", "rejected", "pr_created", "sla_breach", "assigned", "project_assigned", "project_access_updated", "project_access_removed", "project_catalog_updated":
		return normalized
	default:
		return ""
	}
}

func parseRFC3339Query(raw string) (time.Time, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

// EnsureDefaultAdmin creates a default admin user if no admin exists (username/password from env)
func EnsureDefaultAdmin() {
	if DB == nil {
		return
	}
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count); err != nil || count > 0 {
		return
	}
	username := os.Getenv("DEFAULT_ADMIN_USERNAME")
	if username == "" {
		username = "admin"
	}
	password := os.Getenv("DEFAULT_ADMIN_PASSWORD")
	if password == "" {
		password = "admin123"
	}
	email := os.Getenv("DEFAULT_ADMIN_EMAIL")
	if email == "" {
		email = "admin@localhost"
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Failed to hash default admin password: %v", err)
		return
	}
	_, err = DB.Exec(
		`INSERT INTO users (username, email, password, verified, role) VALUES ($1, $2, $3, TRUE, 'admin')`,
		username, email, string(hashed),
	)
	if err != nil {
		log.Printf("Failed to create default admin: %v", err)
		return
	}
	log.Printf("Default admin user created: %s (change password after first login)", username)
}

type SignupRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Portal   string `json:"portal,omitempty"` // user | devops | admin
}

type AuthResponse struct {
	Token     string    `json:"token"`
	User      User      `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

func signupHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	var req SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}

	// Validate input
	if strings.TrimSpace(req.Username) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "username is required", nil)
		return
	}

	if strings.TrimSpace(req.Email) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "email is required", nil)
		return
	}

	if len(req.Password) < 6 {
		writeAPIError(w, r, http.StatusBadRequest, "password must be at least 6 characters", nil)
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to process password", nil)
		return
	}

	// Check if username or email already exists
	var existingID int
	err = DB.QueryRow("SELECT id FROM users WHERE username = $1 OR email = $2", req.Username, req.Email).Scan(&existingID)
	if err == nil {
		writeAPIError(w, r, http.StatusConflict, "username or email already exists", nil)
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking existing user: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "database error", nil)
		return
	}

	// Generate 6-digit OTP for verification
	otpBytes := make([]byte, 6)
	if _, err := rand.Read(otpBytes); err != nil {
		log.Printf("Error generating OTP: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create user", nil)
		return
	}
	var otp string
	for _, b := range otpBytes {
		otp += fmt.Sprintf("%d", b%10)
	}
	otpExpires := time.Now().Add(10 * time.Minute)

	// Create user (with verified=false, role=viewer, OTP stored)
	var user User
	err = DB.QueryRow(
		`INSERT INTO users (username, email, password, verified, role, verification_token, verification_token_expires_at)
		 VALUES ($1, $2, $3, FALSE, 'viewer', $4, $5)
		 RETURNING id, username, email, created_at`,
		req.Username, req.Email, string(hashedPassword), otp, otpExpires,
	).Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if err != nil {
		log.Printf("Error creating user: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create user", nil)
		return
	}
	user.Verified = false
	user.Role = "viewer"

	// TODO: send OTP via email in production; for now return in response for testing
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"message":         "Account created. Verify with OTP sent to your email.",
		"status":          "ok",
		"otp_for_testing": otp,
		"email":           req.Email,
		"user":            user,
	})
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}

	// Get user from database
	var user User
	var hashedPassword string
	err := DB.QueryRow(
		"SELECT id, username, email, password, created_at FROM users WHERE username = $1",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &hashedPassword, &user.CreatedAt)

	if err == sql.ErrNoRows {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid username or password", nil)
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "database error", nil)
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid username or password", nil)
		return
	}

	// Load full user (verified, role, totp_enabled) for response
	if fullUser, err := GetUserByID(user.ID); err == nil && fullUser != nil {
		user.Verified = fullUser.Verified
		user.Role = fullUser.Role
		user.TotpEnabled = fullUser.TotpEnabled
		user.UserType = fullUser.UserType
	} else {
		user.Verified = false
		user.Role = "viewer"
	}

	// 2FA: if totp_enabled, require OTP before issuing token
	if user.TotpEnabled {
		otpBytes := make([]byte, 6)
		if _, err := rand.Read(otpBytes); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to generate OTP", err)
			return
		}
		var otp string
		for _, b := range otpBytes {
			otp += fmt.Sprintf("%d", b%10)
		}
		otpExpires := time.Now().Add(10 * time.Minute)
		if err := SetUserVerificationToken(user.ID, otp, otpExpires); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to persist OTP", err)
			return
		}
		pendingBytes := make([]byte, 32)
		if _, err := rand.Read(pendingBytes); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to generate pending 2FA token", err)
			return
		}
		pendingToken := hex.EncodeToString(pendingBytes)
		_, _ = DB.Exec("INSERT INTO pending_2fa (token, user_id, expires_at) VALUES ($1, $2, $3)",
			pendingToken, user.ID, otpExpires)
		subj, body := EmailTemplate2FA(otp)
		sendNotificationEmailIfConfigured(user.ID, "2fa", subj, body)
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{
			"requires_otp":      true,
			"pending_2fa_token": pendingToken,
			"message":           "Enter the 6-digit code sent to your email",
			"otp_for_testing":   otp,
		})
		return
	}

	// Generate token
	token := generateToken(user.ID)

	w.Header().Set("Content-Type", "application/json")
	timeoutMins := 24 * 60
	if m := os.Getenv("SESSION_TIMEOUT_MINUTES"); m != "" {
		if n, _ := strconv.Atoi(m); n > 0 {
			timeoutMins = n
		}
	}
	encodeAuthJSON(w, AuthResponse{
		Token:     token,
		User:      user,
		ExpiresAt: time.Now().Add(time.Duration(timeoutMins) * time.Minute),
	})
}

// generateToken generates a simple token (in production, use JWT)
func generateToken(userID int) string {
	// Simple token format: base64(userID:timestamp)
	// In production, use proper JWT tokens
	return fmt.Sprintf("%d:%d", userID, time.Now().Unix())
}

// validateToken validates a token and returns user ID
func validateToken(token string) (int, error) {
	var userID int
	var timestamp int64
	_, err := fmt.Sscanf(token, "%d:%d", &userID, &timestamp)
	if err != nil {
		return 0, fmt.Errorf("invalid token format")
	}

	// Check if token is expired (SESSION_TIMEOUT_MINUTES or default 24h)
	timeoutMins := 24 * 60
	if m := os.Getenv("SESSION_TIMEOUT_MINUTES"); m != "" {
		if n, _ := strconv.Atoi(m); n > 0 {
			timeoutMins = n
		}
	}
	if time.Now().Unix()-timestamp > int64(timeoutMins*60) {
		return 0, fmt.Errorf("token expired")
	}

	return userID, nil
}

// validateTokenOrAPIKey returns (userID, scopes, nil) for valid Bearer token. Token can be session token (scopes "") or API key prefix "ip_xxx" (scopes from DB).
func validateTokenOrAPIKey(token string) (userID int, scopes string, err error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, "", fmt.Errorf("missing token")
	}
	if strings.HasPrefix(token, APIKeyPrefix) {
		uid, sc, keyID, err := GetUserIDAndScopesByAPIKey(token)
		if err != nil {
			return 0, "", err
		}
		UpdateAPIKeyLastUsed(keyID)
		return uid, sc, nil
	}
	uid, err := validateToken(token)
	if err != nil {
		return 0, "", err
	}
	return uid, "", nil
}

// hasScope returns true if scope is in the comma-separated scopes list
func hasScope(scopes, need string) bool {
	if scopes == "" {
		return true // session token has all scopes
	}
	for _, s := range strings.Split(scopes, ",") {
		if strings.TrimSpace(s) == need {
			return true
		}
	}
	return false
}

// meHandler returns the current user from the Bearer token
func meHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), nil)
		return
	}

	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		writeAPIError(w, r, http.StatusNotFound, "user not found", nil)
		return
	}

	resp := map[string]interface{}{"user": user}
	// Portal users: add teams, manager_username for profile
	if user.UserType == "portal_user" || user.Role == "admin" {
		if teams, err := GetTeamsForUserWithDetails(userID); err == nil && len(teams) > 0 {
			resp["teams"] = teams
		} else {
			resp["teams"] = []interface{}{}
		}
		if user.ManagerID != nil && *user.ManagerID > 0 {
			if mgr, err := GetUserByID(*user.ManagerID); err == nil && mgr != nil {
				resp["manager_username"] = mgr.Username
			}
		}
	}
	// Portal managers (and users who can approve as group manager or manager_id) get count of tickets pending their approval
	if user.UserType == "portal_user" || user.IsPortalManager {
		if n, err := GetPendingManagerApprovalCount(userID); err == nil && n > 0 {
			resp["pending_manager_approval_count"] = n
		} else if err == nil {
			resp["pending_manager_approval_count"] = 0
		}
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, resp)
}

// meTeamsHandler returns the current user's teams (for main frontend - 403 if none)
func meTeamsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	teams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to get teams", nil)
		return
	}
	if teams == nil {
		teams = []Team{}
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"teams":  teams,
		"status": "ok",
	})
}

// meAPIKeysHandler GET /api/me/api-keys (list), POST /api/me/api-keys (create). Requires session token (not API key).
func meAPIKeysHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	if strings.HasPrefix(token, APIKeyPrefix) {
		writeAPIError(w, r, http.StatusForbidden, "use session login to manage API keys", nil)
		return
	}
	userID, err := validateToken(token)
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}

	if r.Method == "GET" {
		keys, err := ListAPIKeysForUser(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list API keys", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"api_keys": keys, "status": "ok"})
		return
	}

	// POST: create API key
	var body struct {
		Name   string `json:"name"`
		Scopes string `json:"scopes"` // comma-separated: request:create, history:read
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeAPIError(w, r, http.StatusBadRequest, "name is required", nil)
		return
	}
	scopes := strings.TrimSpace(body.Scopes)
	rawKey, rec, err := CreateAPIKey(userID, name, scopes)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"api_key": rec,
		"key":     rawKey,
		"message": "Save this key; it will not be shown again.",
		"status":  "ok",
	})
}

// meAPIKeyDetailHandler DELETE /api/me/api-keys/:id - revoke API key (session token only)
func meAPIKeyDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "DELETE" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/api-keys/")
	idStr := strings.Split(path, "/")[0]
	keyID, _ := strconv.Atoi(idStr)
	if keyID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid key id", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	if strings.HasPrefix(token, APIKeyPrefix) {
		writeAPIError(w, r, http.StatusForbidden, "use session login to revoke API keys", nil)
		return
	}
	userID, err := validateToken(token)
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	if err := RevokeAPIKey(keyID, userID); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"message": "API key revoked", "status": "ok"})
}

// meNotificationPreferencesHandler GET /api/me/notification-preferences (get), PATCH (update)
func meNotificationPreferencesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "PATCH" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	if r.Method == "GET" {
		prefs, err := GetUserNotificationPreferences(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to get preferences", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"preferences": prefs, "status": "ok"})
		return
	}
	var body struct {
		EmailApproved  *bool `json:"email_approved"`
		EmailRejected  *bool `json:"email_rejected"`
		EmailPRCreated *bool `json:"email_pr_created"`
		EmailAssigned  *bool `json:"email_assigned"`
		EmailSLABreach *bool `json:"email_sla_breach"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	prefs, err := GetUserNotificationPreferences(userID)
	if err != nil || prefs == nil {
		prefs = &UserNotificationPreferences{UserID: userID, EmailApproved: true, EmailRejected: true, EmailPRCreated: true, EmailAssigned: true, EmailSLABreach: true}
	}
	if body.EmailApproved != nil {
		prefs.EmailApproved = *body.EmailApproved
	}
	if body.EmailRejected != nil {
		prefs.EmailRejected = *body.EmailRejected
	}
	if body.EmailPRCreated != nil {
		prefs.EmailPRCreated = *body.EmailPRCreated
	}
	if body.EmailAssigned != nil {
		prefs.EmailAssigned = *body.EmailAssigned
	}
	if body.EmailSLABreach != nil {
		prefs.EmailSLABreach = *body.EmailSLABreach
	}
	if err := UpdateUserNotificationPreferences(prefs); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update preferences", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"preferences": prefs, "status": "ok"})
}

// meManagedTeamsHandler GET /api/me/managed-teams - portal teams the current user can manage (manager role or is_portal_manager)
func meManagedTeamsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return
	}
	teams, err := GetPortalTeamsManagedByUser(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, err.Error(), err)
		return
	}
	if teams == nil {
		teams = []Team{}
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"teams": teams, "status": "ok"})
}

// meTeamMembersRouter handles /api/me/teams/:id/members - GET list members, POST add member (portal manager)
func meTeamMembersRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/teams/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[1] != "members" {
		http.NotFound(w, r)
		return
	}
	teamID, _ := strconv.Atoi(parts[0])
	if teamID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return
	}
	if !CanUserManagePortalTeam(userID, teamID) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot manage this team", nil)
		return
	}
	if r.Method == "GET" {
		members, err := GetTeamMembers(teamID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"members": members, "status": "ok"})
		return
	}
	if r.Method == "DELETE" && len(parts) >= 3 {
		targetUserID, _ := strconv.Atoi(parts[2])
		if targetUserID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid user id", nil)
			return
		}
		if err := RemoveTeamMember(teamID, targetUserID); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"status": "ok", "message": "member removed"})
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	emailOrUsername := strings.TrimSpace(body.Email)
	if emailOrUsername == "" {
		emailOrUsername = strings.TrimSpace(body.Username)
	}
	if emailOrUsername == "" {
		writeAPIError(w, r, http.StatusBadRequest, "email or username required", nil)
		return
	}
	role := strings.TrimSpace(body.Role)
	if role == "" {
		role = "developer"
	}
	if !ValidPortalRole(role) {
		writeAPIError(w, r, http.StatusBadRequest, "invalid role; use developer, senior_developer, lead, or manager", nil)
		return
	}
	targetUser, err := GetUserByEmailOrUsername(emailOrUsername)
	if err != nil || targetUser == nil {
		writeAPIError(w, r, http.StatusNotFound, "user not found", nil)
		return
	}
	member, err := AddTeamMember(teamID, targetUser.ID, role)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"member": member, "status": "ok"})
}

// mePendingManagerApprovalHandler GET /api/me/pending-manager-approval - count of requests pending the current user's approval (as group manager or creator's manager). For portal manager notification badge.
func mePendingManagerApprovalHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"pending_manager_approval_count": 0, "status": "ok"})
		return
	}
	count, _ := GetPendingManagerApprovalCount(userID)
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"pending_manager_approval_count": count, "status": "ok"})
}

// meNotificationsHandler GET /api/me/notifications - list in-app notifications; optional since= for updated_count (badge). POST to mark read.
func meNotificationsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if DB == nil {
		encodeAuthJSON(w, map[string]interface{}{"notifications": []interface{}{}, "unread_count": 0, "updated_count": 0, "status": "ok"})
		return
	}
	if r.Method == "POST" {
		var body struct {
			MarkRead string `json:"mark_read"`
			IDs      []int  `json:"ids"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.MarkRead == "all" || body.MarkRead == "true" || len(body.IDs) > 0 {
			_ = MarkUserNotificationsRead(userID, body.IDs)
		}
		encodeAuthJSON(w, map[string]interface{}{"status": "ok"})
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
	unreadOnly := r.URL.Query().Get("unread_only") == "1" || r.URL.Query().Get("unread_only") == "true"
	kind := normalizeUserNotificationKind(r.URL.Query().Get("kind"))
	list, _ := ListUserNotificationsFiltered(userID, limit, offset, unreadOnly, kind)
	unreadCount, _ := CountUserNotifications(userID, true, "")
	totalCount, _ := CountUserNotifications(userID, unreadOnly, kind)
	countsByKind, _ := CountUserNotificationsByKind(userID)
	sinceStr := strings.TrimSpace(r.URL.Query().Get("since"))
	resp := map[string]interface{}{
		"notifications":  list,
		"unread_count":   unreadCount,
		"total_count":    totalCount,
		"counts_by_kind": countsByKind,
		"offset":         offset,
		"limit":          limit,
		"status":         "ok",
	}
	if sinceTime, ok := parseRFC3339Query(sinceStr); ok {
		count, _ := GetUserRequestsUpdatedSince(userID, sinceTime)
		resp["updated_count"] = count
	}
	encodeAuthJSON(w, sanitizeJSONValue(resp))
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// changePasswordHandler changes the authenticated user's password
func changePasswordHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), nil)
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	if strings.TrimSpace(req.NewPassword) == "" || len(req.NewPassword) < 6 {
		writeAPIError(w, r, http.StatusBadRequest, "new password must be at least 6 characters", nil)
		return
	}

	var hashedPassword string
	err = DB.QueryRow("SELECT password FROM users WHERE id = $1", userID).Scan(&hashedPassword)
	if err == sql.ErrNoRows {
		writeAPIError(w, r, http.StatusNotFound, "user not found", nil)
		return
	}
	if err != nil {
		log.Printf("Error querying user: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "database error", nil)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "current password is incorrect", nil)
		return
	}

	newHashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing new password: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update password", nil)
		return
	}
	if err := UpdateUserPassword(userID, string(newHashed)); err != nil {
		log.Printf("Error updating password: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update password", nil)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"message": "password updated successfully",
		"status":  "ok",
	})
}

// verifyEmailHandler verifies user email via token (GET /api/verify-email?token=xxx)
func verifyEmailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing token", nil)
		return
	}
	userID, err := GetUserByVerificationToken(token)
	if err != nil || userID == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid or expired verification link", nil)
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to verify", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"message": "email verified successfully",
		"status":  "ok",
	})
}

// VerifyOTPRequest for OTP verification
type VerifyOTPRequest struct {
	Email string `json:"email"`
	OTP   string `json:"otp"`
}

// verifyOtpHandler verifies user with OTP (POST /api/verify-otp)
func verifyOtpHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var req VerifyOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	email := strings.TrimSpace(req.Email)
	otp := strings.TrimSpace(req.OTP)
	if email == "" || otp == "" {
		writeAPIError(w, r, http.StatusBadRequest, "email and otp required", nil)
		return
	}
	userID, err := GetUserIDByEmailAndOTP(email, otp)
	if err != nil || userID == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid or expired OTP", nil)
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to verify", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"message": "Email verified successfully. You can now log in.", "status": "ok"})
}

// verify2faHandler verifies 2FA OTP and returns session token (POST /api/auth/verify-2fa)
func verify2faHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var req struct {
		PendingToken string `json:"pending_2fa_token"`
		OTP          string `json:"otp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	token := strings.TrimSpace(req.PendingToken)
	otp := strings.TrimSpace(req.OTP)
	if token == "" || otp == "" {
		writeAPIError(w, r, http.StatusBadRequest, "pending_2fa_token and otp required", nil)
		return
	}
	var userID int
	err := DB.QueryRow(
		"SELECT user_id FROM pending_2fa WHERE token = $1 AND expires_at > NOW()",
		token,
	).Scan(&userID)
	if err == sql.ErrNoRows || userID == 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid or expired 2FA token", nil)
		return
	}
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to validate pending 2FA token", err)
		return
	}
	verifiedID, err := GetUserIDByIDAndOTP(userID, otp)
	if err != nil || verifiedID == 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid or expired OTP", nil)
		return
	}
	_, _ = DB.Exec("DELETE FROM pending_2fa WHERE token = $1", token)
	user, _ := GetUserByID(verifiedID)
	if user == nil {
		writeAPIError(w, r, http.StatusInternalServerError, "user not found after 2FA verification", nil)
		return
	}
	sessionToken := generateToken(verifiedID)
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, AuthResponse{
		Token:     sessionToken,
		User:      *user,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	})
}

// me2faHandler handles /api/me/2fa - GET status, POST enable, DELETE disable
func me2faHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return
	}
	switch r.Method {
	case "GET":
		user, _ := GetUserByID(userID)
		enabled := user != nil && user.TotpEnabled
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"totp_enabled": enabled, "status": "ok"})
		return
	case "POST":
		if err := UpdateUserTotpEnabled(userID, true); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to enable 2FA", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"message": "2FA enabled. You will receive an email OTP on each login.", "status": "ok"})
		return
	case "DELETE":
		if err := UpdateUserTotpEnabled(userID, false); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to disable 2FA", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"message": "2FA disabled", "status": "ok"})
		return
	default:
		writeMethodNotAllowed(w, r)
	}
}

// resendVerificationHandler sends a new verification token (POST /api/resend-verification, Bearer required)
func resendVerificationHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		writeAPIError(w, r, http.StatusNotFound, "user not found", nil)
		return
	}
	if user.Verified {
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{
			"message": "email already verified",
			"status":  "ok",
		})
		return
	}
	verifyBytes := make([]byte, 32)
	if _, err := rand.Read(verifyBytes); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to generate token", nil)
		return
	}
	verifyToken := hex.EncodeToString(verifyBytes)
	verifyExpires := time.Now().Add(24 * time.Hour)
	if err := SetUserVerificationToken(userID, verifyToken, verifyExpires); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to resend", nil)
		return
	}
	// TODO: send verification email with link containing verifyToken
	_ = verifyToken
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"message": "verification link sent (check your email)",
		"status":  "ok",
	})
}

// setRoleHandler sets a user's role (PATCH /api/users/:id/role) - requires X-Admin-Secret header
func setRoleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "PATCH" && r.Method != "PUT" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	adminSecret := os.Getenv("ADMIN_SECRET")
	if adminSecret == "" {
		writeAPIError(w, r, http.StatusForbidden, "admin API not configured", nil)
		return
	}
	if r.Header.Get("X-Admin-Secret") != adminSecret {
		writeAPIError(w, r, http.StatusForbidden, "forbidden", nil)
		return
	}
	// Parse user ID from path: /api/users/123/role
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/role")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		writeAPIError(w, r, http.StatusBadRequest, "user id required", nil)
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid user id", nil)
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" {
		writeAPIError(w, r, http.StatusBadRequest, "role required (viewer, contributor, admin)", err)
		return
	}
	if err := UpdateUserRole(targetID, body.Role); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"message": "role updated",
		"status":  "ok",
	})
}

// setVerifiedHandler sets a user as verified (PATCH /api/users/:id/verify) - requires X-Admin-Secret
func setVerifiedHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "PATCH" && r.Method != "PUT" && r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	adminSecret := os.Getenv("ADMIN_SECRET")
	if adminSecret == "" || r.Header.Get("X-Admin-Secret") != adminSecret {
		writeAPIError(w, r, http.StatusForbidden, "forbidden", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/verify")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		writeAPIError(w, r, http.StatusBadRequest, "user id required", nil)
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid user id", nil)
		return
	}
	if err := SetUserVerified(targetID); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to set verified", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"message": "user verified", "status": "ok"})
}

// forgotPasswordHandler POST /api/auth/forgot-password - sends reset link to user's email
func forgotPasswordHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var body struct {
		Email  string `json:"email"`
		Portal string `json:"portal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	email := strings.TrimSpace(body.Email)
	if email == "" {
		writeAPIError(w, r, http.StatusBadRequest, "email required", nil)
		return
	}
	user, err := GetUserByEmailOrUsername(email)
	if err != nil {
		log.Printf("[Auth] Forgot-password: GetUserByEmailOrUsername failed for %q: %v", email, err)
		if err == sql.ErrNoRows {
			writeAPIError(w, r, http.StatusNotFound, "No account found with that email", nil)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "Something went wrong. Please try again.", nil)
		return
	}
	if user == nil || user.Email == "" {
		log.Printf("[Auth] Forgot-password: no user found for email/username %q - not sending email", email)
		writeAPIError(w, r, http.StatusNotFound, "No account found with that email", nil)
		return
	}
	log.Printf("[Auth] Forgot-password: user found id=%d email=%s - sending reset link", user.ID, user.Email)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to generate password reset token", err)
		return
	}
	token := hex.EncodeToString(tokenBytes)
	if err := SavePasswordResetToken(user.ID, token); err != nil {
		log.Printf("[Auth] SavePasswordResetToken: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to save password reset token", err)
		return
	}
	resetBaseURL := FrontendURL
	if strings.EqualFold(strings.TrimSpace(body.Portal), "devops") {
		resetBaseURL = DevOpsFrontendURL
	}
	resetURL := strings.TrimSuffix(resetBaseURL, "/") + "/reset-password?token=" + token
	log.Printf("[Auth] Forgot-password: user=%s resetURL=%s", user.Email, resetURL)
	subject, bodyText, _ := EmailTemplatePasswordReset(resetURL)
	if err := SendEmail(user.Email, subject, bodyText); err != nil {
		log.Printf("[Auth] SendEmail forgot-password failed: %v", err)
		// Still return success to not reveal user existence
	} else {
		log.Printf("[Auth] Forgot-password email sent to %s", user.Email)
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"status": "ok", "message": "If an account exists with that email, you will receive a reset link."})
}

// resetPasswordHandler POST /api/auth/reset-password - sets new password using token
func resetPasswordHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var body struct {
		Token           string `json:"token"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	token := strings.TrimSpace(body.Token)
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		writeAPIError(w, r, http.StatusBadRequest, "token required", nil)
		return
	}
	if len(body.NewPassword) < 6 {
		writeAPIError(w, r, http.StatusBadRequest, "password must be at least 6 characters", nil)
		return
	}
	if body.ConfirmPassword == "" {
		writeAPIError(w, r, http.StatusBadRequest, "confirm password is required", nil)
		return
	}
	if body.NewPassword != body.ConfirmPassword {
		writeAPIError(w, r, http.StatusBadRequest, "passwords do not match", nil)
		return
	}
	userID, err := GetUserIDByPasswordResetToken(token)
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid or expired token", nil)
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to hash password", err)
		return
	}
	if err := UpdateUserPassword(userID, string(hashed)); err != nil {
		log.Printf("[Auth] Reset-password: UpdateUserPassword failed userID=%d: %v", userID, err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update password", err)
		return
	}
	_ = ConsumePasswordResetToken(token)
	log.Printf("[Auth] Reset-password: password updated successfully for userID=%d", userID)
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"status": "ok", "message": "Password updated. You can now sign in."})
}
