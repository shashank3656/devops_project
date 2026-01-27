package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Validate input
	if strings.TrimSpace(req.Username) == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "username is required",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.Email) == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "email is required",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if len(req.Password) < 6 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "password must be at least 6 characters",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to process password",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Check if username or email already exists
	var existingID int
	err = DB.QueryRow("SELECT id FROM users WHERE username = $1 OR email = $2", req.Username, req.Email).Scan(&existingID)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "username or email already exists",
			"status": "error",
		})
		w.WriteHeader(http.StatusConflict)
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking existing user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Create user
	var user User
	err = DB.QueryRow(
		"INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at",
		req.Username, req.Email, string(hashedPassword),
	).Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)

	if err != nil {
		log.Printf("Error creating user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "failed to create user",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Generate simple token (in production, use JWT)
	token := generateToken(user.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		Token:     token,
		User:      user,
		ExpiresAt: time.Now().Add(24 * time.Hour),
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid json",
			"status": "error",
		})
		w.WriteHeader(http.StatusBadRequest)
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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		w.WriteHeader(http.StatusUnauthorized)
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "database error",
			"status": "error",
		})
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "invalid username or password",
			"status": "error",
		})
		w.WriteHeader(http.StatusUnauthorized)
		return
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
