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
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("auth response encode failed: %v", err)
	}
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	var req SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		return
	}

	// Validate input
	if strings.TrimSpace(req.Username) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "username is required",
			"status": "error",
		})
		return
	}

	if strings.TrimSpace(req.Email) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "email is required",
			"status": "error",
		})
		return
	}

	if len(req.Password) < 6 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "password must be at least 6 characters",
			"status": "error",
		})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "failed to process password",
			"status": "error",
		})
		return
	}

	// Check if username or email already exists
	var existingID int
	err = DB.QueryRow("SELECT id FROM users WHERE username = $1 OR email = $2", req.Username, req.Email).Scan(&existingID)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "username or email already exists",
			"status": "error",
		})
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking existing user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		return
	}

	// Generate 6-digit OTP for verification
	otpBytes := make([]byte, 6)
	if _, err := rand.Read(otpBytes); err != nil {
		log.Printf("Error generating OTP: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to create user", "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to create user", "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		return
	}

	// Load full user (verified, role, totp_enabled) for response
	if fullUser, err := GetUserByID(user.ID); err == nil && fullUser != nil {
		user.Verified = fullUser.Verified
		user.Role = fullUser.Role
		user.TotpEnabled = fullUser.TotpEnabled
	} else {
		user.Verified = false
		user.Role = "viewer"
	}

	// 2FA: if totp_enabled, require OTP before issuing token
	if user.TotpEnabled {
		otpBytes := make([]byte, 6)
		if _, err := rand.Read(otpBytes); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var otp string
		for _, b := range otpBytes {
			otp += fmt.Sprintf("%d", b%10)
		}
		otpExpires := time.Now().Add(10 * time.Minute)
		if err := SetUserVerificationToken(user.ID, otp, otpExpires); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		pendingBytes := make([]byte, 32)
		if _, err := rand.Read(pendingBytes); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "missing or invalid authorization",
			"status": "error",
		})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		})
		return
	}

	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "user not found",
			"status": "error",
		})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	teams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to get teams", "status": "error"})
		return
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	if strings.HasPrefix(token, APIKeyPrefix) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "use session login to manage API keys", "status": "error"})
		return
	}
	userID, err := validateToken(token)
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	if r.Method == "GET" {
		keys, err := ListAPIKeysForUser(userID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAuthJSON(w, map[string]interface{}{"error": "failed to list API keys", "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "name is required", "status": "error"})
		return
	}
	scopes := strings.TrimSpace(body.Scopes)
	rawKey, rec, err := CreateAPIKey(userID, name, scopes)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/api-keys/")
	idStr := strings.Split(path, "/")[0]
	keyID, _ := strconv.Atoi(idStr)
	if keyID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid key id", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	if strings.HasPrefix(token, APIKeyPrefix) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "use session login to revoke API keys", "status": "error"})
		return
	}
	userID, err := validateToken(token)
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if err := RevokeAPIKey(keyID, userID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if r.Method == "GET" {
		prefs, err := GetUserNotificationPreferences(userID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAuthJSON(w, map[string]interface{}{"error": "failed to get preferences", "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to update preferences", "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid token", "status": "error"})
		return
	}
	teams, err := GetPortalTeamsManagedByUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid team id", "status": "error"})
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid token", "status": "error"})
		return
	}
	if !CanUserManagePortalTeam(userID, teamID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "you cannot manage this team", "status": "error"})
		return
	}
	if r.Method == "GET" {
		members, err := GetTeamMembers(teamID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"members": members, "status": "ok"})
		return
	}
	if r.Method == "DELETE" && len(parts) >= 3 {
		targetUserID, _ := strconv.Atoi(parts[2])
		if targetUserID <= 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAuthJSON(w, map[string]interface{}{"error": "invalid user id", "status": "error"})
			return
		}
		if err := RemoveTeamMember(teamID, targetUserID); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"status": "ok", "message": "member removed"})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	emailOrUsername := strings.TrimSpace(body.Email)
	if emailOrUsername == "" {
		emailOrUsername = strings.TrimSpace(body.Username)
	}
	if emailOrUsername == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "email or username required", "status": "error"})
		return
	}
	role := strings.TrimSpace(body.Role)
	if role == "" {
		role = "developer"
	}
	if !ValidPortalRole(role) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid role; use developer, senior_developer, lead, or manager", "status": "error"})
		return
	}
	targetUser, err := GetUserByEmailOrUsername(emailOrUsername)
	if err != nil || targetUser == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeAuthJSON(w, map[string]interface{}{"error": "user not found", "status": "error"})
		return
	}
	member, err := AddTeamMember(teamID, targetUser.ID, role)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	list, _ := ListUserNotificationsFiltered(userID, limit, offset, unreadOnly, kind)
	unreadCount, _ := CountUserNotifications(userID, true, "")
	totalCount, _ := CountUserNotifications(userID, unreadOnly, kind)
	countsByKind, _ := CountUserNotificationsByKind(userID)
	sinceStr := r.URL.Query().Get("since")
	resp := map[string]interface{}{
		"notifications":  list,
		"unread_count":   unreadCount,
		"total_count":    totalCount,
		"counts_by_kind": countsByKind,
		"offset":         offset,
		"limit":          limit,
		"status":         "ok",
	}
	if sinceStr != "" {
		if t, err := time.Parse(time.RFC3339, sinceStr); err == nil {
			count, _ := GetUserRequestsUpdatedSince(userID, t)
			resp["updated_count"] = count
		}
	}
	encodeAuthJSON(w, resp)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "missing or invalid authorization",
			"status": "error",
		})
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		})
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		return
	}
	if strings.TrimSpace(req.NewPassword) == "" || len(req.NewPassword) < 6 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "new password must be at least 6 characters",
			"status": "error",
		})
		return
	}

	var hashedPassword string
	err = DB.QueryRow("SELECT password FROM users WHERE id = $1", userID).Scan(&hashedPassword)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "user not found",
			"status": "error",
		})
		return
	}
	if err != nil {
		log.Printf("Error querying user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "current password is incorrect",
			"status": "error",
		})
		return
	}

	newHashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing new password: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "failed to update password",
			"status": "error",
		})
		return
	}
	if err := UpdateUserPassword(userID, string(newHashed)); err != nil {
		log.Printf("Error updating password: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "failed to update password",
			"status": "error",
		})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "missing token",
			"status": "error",
		})
		return
	}
	userID, err := GetUserByVerificationToken(token)
	if err != nil || userID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "invalid or expired verification link",
			"status": "error",
		})
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{
			"error":  "failed to verify",
			"status": "error",
		})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	var req VerifyOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	email := strings.TrimSpace(req.Email)
	otp := strings.TrimSpace(req.OTP)
	if email == "" || otp == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "email and otp required", "status": "error"})
		return
	}
	userID, err := GetUserIDByEmailAndOTP(email, otp)
	if err != nil || userID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid or expired OTP", "status": "error"})
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to verify", "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		PendingToken string `json:"pending_2fa_token"`
		OTP          string `json:"otp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	token := strings.TrimSpace(req.PendingToken)
	otp := strings.TrimSpace(req.OTP)
	if token == "" || otp == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "pending_2fa_token and otp required", "status": "error"})
		return
	}
	var userID int
	err := DB.QueryRow(
		"SELECT user_id FROM pending_2fa WHERE token = $1 AND expires_at > NOW()",
		token,
	).Scan(&userID)
	if err == sql.ErrNoRows || userID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid or expired 2FA token", "status": "error"})
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	verifiedID, err := GetUserIDByIDAndOTP(userID, otp)
	if err != nil || verifiedID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid or expired OTP", "status": "error"})
		return
	}
	_, _ = DB.Exec("DELETE FROM pending_2fa WHERE token = $1", token)
	user, _ := GetUserByID(verifiedID)
	if user == nil {
		w.WriteHeader(http.StatusInternalServerError)
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
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid token", "status": "error"})
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
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"message": "2FA enabled. You will receive an email OTP on each login.", "status": "ok"})
		return
	case "DELETE":
		if err := UpdateUserTotpEnabled(userID, false); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAuthJSON(w, map[string]interface{}{"message": "2FA disabled", "status": "ok"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeAuthJSON(w, map[string]interface{}{"error": "user not found", "status": "error"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to generate token", "status": "error"})
		return
	}
	verifyToken := hex.EncodeToString(verifyBytes)
	verifyExpires := time.Now().Add(24 * time.Hour)
	if err := SetUserVerificationToken(userID, verifyToken, verifyExpires); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to resend", "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	adminSecret := os.Getenv("ADMIN_SECRET")
	if adminSecret == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "admin API not configured", "status": "error"})
		return
	}
	if r.Header.Get("X-Admin-Secret") != adminSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "forbidden", "status": "error"})
		return
	}
	// Parse user ID from path: /api/users/123/role
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/role")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "user id required", "status": "error"})
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid user id", "status": "error"})
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "role required (viewer, contributor, admin)", "status": "error"})
		return
	}
	if err := UpdateUserRole(targetID, body.Role); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	adminSecret := os.Getenv("ADMIN_SECRET")
	if adminSecret == "" || r.Header.Get("X-Admin-Secret") != adminSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "forbidden", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/verify")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "user id required", "status": "error"})
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid user id", "status": "error"})
		return
	}
	if err := SetUserVerified(targetID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to set verified", "status": "error"})
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Email  string `json:"email"`
		Portal string `json:"portal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	email := strings.TrimSpace(body.Email)
	if email == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "email required", "status": "error"})
		return
	}
	user, err := GetUserByEmailOrUsername(email)
	if err != nil {
		log.Printf("[Auth] Forgot-password: GetUserByEmailOrUsername failed for %q: %v", email, err)
		if err == sql.ErrNoRows {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			encodeAuthJSON(w, map[string]interface{}{"error": "No account found with that email", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "Something went wrong. Please try again.", "status": "error"})
		return
	}
	if user == nil || user.Email == "" {
		log.Printf("[Auth] Forgot-password: no user found for email/username %q - not sending email", email)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeAuthJSON(w, map[string]interface{}{"error": "No account found with that email", "status": "error"})
		return
	}
	log.Printf("[Auth] Forgot-password: user found id=%d email=%s - sending reset link", user.ID, user.Email)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	token := hex.EncodeToString(tokenBytes)
	if err := SavePasswordResetToken(user.ID, token); err != nil {
		log.Printf("[Auth] SavePasswordResetToken: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Token           string `json:"token"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	token := strings.TrimSpace(body.Token)
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "token required", "status": "error"})
		return
	}
	if len(body.NewPassword) < 6 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "password must be at least 6 characters", "status": "error"})
		return
	}
	if body.ConfirmPassword == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "confirm password is required", "status": "error"})
		return
	}
	if body.NewPassword != body.ConfirmPassword {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "passwords do not match", "status": "error"})
		return
	}
	userID, err := GetUserIDByPasswordResetToken(token)
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid or expired token", "status": "error"})
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if err := UpdateUserPassword(userID, string(hashed)); err != nil {
		log.Printf("[Auth] Reset-password: UpdateUserPassword failed userID=%d: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	_ = ConsumePasswordResetToken(token)
	log.Printf("[Auth] Reset-password: password updated successfully for userID=%d", userID)
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{"status": "ok", "message": "Password updated. You can now sign in."})
}
