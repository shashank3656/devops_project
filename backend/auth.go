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
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

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
	Token    string    `json:"token"`
	User     User      `json:"user"`
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		return
	}

	// Validate input
	if strings.TrimSpace(req.Username) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "username is required",
			"status": "error",
		})
		return
	}

	if strings.TrimSpace(req.Email) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "email is required",
			"status": "error",
		})
		return
	}

	if len(req.Password) < 6 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "username or email already exists",
			"status": "error",
		})
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking existing user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create user", "status": "error"})
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create user", "status": "error"})
		return
	}
	user.Verified = false
	user.Role = "viewer"

	// TODO: send OTP via email in production; for now return in response for testing
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":        "Account created. Verify with OTP sent to your email.",
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
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		return
	}

	// Load full user (verified, role) for response
	if fullUser, err := GetUserByID(user.ID); err == nil && fullUser != nil {
		user.Verified = fullUser.Verified
		user.Role = fullUser.Role
	} else {
		user.Verified = false
		user.Role = "viewer"
	}

	// Generate token
	token := generateToken(user.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		Token:     token,
		User:      user,
		ExpiresAt: time.Now().Add(24 * time.Hour),
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

	// Check if token is expired (24 hours)
	if time.Now().Unix()-timestamp > 24*3600 {
		return 0, fmt.Errorf("token expired")
	}

	return userID, nil
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
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		})
		return
	}

	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "user not found",
			"status": "error",
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": user,
	})
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
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		})
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		return
	}
	if strings.TrimSpace(req.NewPassword) == "" || len(req.NewPassword) < 6 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "user not found",
			"status": "error",
		})
		return
	}
	if err != nil {
		log.Printf("Error querying user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.CurrentPassword)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to update password",
			"status": "error",
		})
		return
	}
	if err := UpdateUserPassword(userID, string(newHashed)); err != nil {
		log.Printf("Error updating password: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to update password",
			"status": "error",
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "missing token",
			"status": "error",
		})
		return
	}
	userID, err := GetUserByVerificationToken(token)
	if err != nil || userID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid or expired verification link",
			"status": "error",
		})
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to verify",
			"status": "error",
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	email := strings.TrimSpace(req.Email)
	otp := strings.TrimSpace(req.OTP)
	if email == "" || otp == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "email and otp required", "status": "error"})
		return
	}
	userID, err := GetUserIDByEmailAndOTP(email, otp)
	if err != nil || userID == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid or expired OTP", "status": "error"})
		return
	}
	if err := SetUserVerified(userID); err != nil {
		log.Printf("Error setting user verified: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to verify", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "Email verified successfully. You can now log in.", "status": "ok"})
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user not found", "status": "error"})
		return
	}
	if user.Verified {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "email already verified",
			"status":  "ok",
		})
		return
	}
	verifyBytes := make([]byte, 32)
	if _, err := rand.Read(verifyBytes); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to generate token", "status": "error"})
		return
	}
	verifyToken := hex.EncodeToString(verifyBytes)
	verifyExpires := time.Now().Add(24 * time.Hour)
	if err := SetUserVerificationToken(userID, verifyToken, verifyExpires); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to resend", "status": "error"})
		return
	}
	// TODO: send verification email with link containing verifyToken
	_ = verifyToken
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "admin API not configured", "status": "error"})
		return
	}
	if r.Header.Get("X-Admin-Secret") != adminSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "forbidden", "status": "error"})
		return
	}
	// Parse user ID from path: /api/users/123/role
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/role")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user id required", "status": "error"})
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid user id", "status": "error"})
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "role required (viewer, contributor, admin)", "status": "error"})
		return
	}
	if err := UpdateUserRole(targetID, body.Role); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
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
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "forbidden", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.TrimSuffix(path, "/verify")
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user id required", "status": "error"})
		return
	}
	var targetID int
	if _, err := fmt.Sscanf(path, "%d", &targetID); err != nil || targetID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid user id", "status": "error"})
		return
	}
	if err := SetUserVerified(targetID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to set verified", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "user verified", "status": "ok"})
}
