package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type InfraRequest map[string]interface{}

// enableCORS adds CORS headers to allow frontend requests
func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

// handleOptions handles preflight CORS requests
func handleOptions(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.WriteHeader(http.StatusOK)
}

// validatePayload checks if required fields are present
func validatePayload(payload InfraRequest) error {
	required := []string{"team", "env", "cloud", "service"}
	for _, field := range required {
		val, ok := payload[field]
		if !ok || val == nil {
			return fmt.Errorf("missing required field: %s", field)
		}
		str, ok := val.(string)
		if !ok || strings.TrimSpace(str) == "" {
			return fmt.Errorf("field %s must be a non-empty string", field)
		}
	}
	return nil
}

func createPRHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		log.Printf("Error decoding JSON: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  fmt.Sprintf("invalid json: %v", err),
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Validate required fields
	if err := validatePayload(payload); err != nil {
		log.Printf("Validation error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Safely extract fields with type checking
	team, ok := payload["team"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "team must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	env, ok := payload["env"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "env must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	cloud, ok := payload["cloud"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "cloud must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	service, ok := payload["service"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "service must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Create file path: <team-id>/envs/<env>/request.json
	filePath := fmt.Sprintf(
		"%s/envs/%s/request.json",
		team, env,
	)

	// Marshal payload with indentation for readability
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "error processing request",
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	log.Printf("Creating PR for: team=%s, env=%s, cloud=%s, service=%s", team, env, cloud, service)

	// Branch name format: <team-name>/<env>
	branchName := fmt.Sprintf("%s/%s", team, env)
	
	prURL, err := CreateGitHubPR(branchName, filePath, content)
	if err != nil {
		log.Printf("Error creating PR: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  fmt.Sprintf("failed to create PR: %v", err),
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Save to database
	userID := r.Header.Get("X-User-ID")
	var userIDPtr *int
	if userID != "" {
		if id, err := strconv.Atoi(userID); err == nil && id > 0 {
			userIDPtr = &id
		}
	}

	prRequest := &PRRequest{
		Team:      team,
		Env:       env,
		Cloud:     cloud,
		Service:   service,
		PRURL:     prURL,
		Branch:    branchName,
		FilePath:  filePath,
		Status:    "pending",
		Config:    string(content),
		CreatedBy: userIDPtr, // Use pointer - will be NULL if no valid user ID
	}

	if err := SavePRRequest(prRequest); err != nil {
		log.Printf("Warning: failed to save PR request to database: %v", err)
		// Don't fail the request, just log the warning
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"pr_url": prURL,
		"status": "created",
		"branch": branchName,
		"id":     prRequest.ID,
	}
	
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "error encoding response", http.StatusInternalServerError)
		return
	}
}

func main() {
	// Initialize database
	if err := InitDB(); err != nil {
		log.Printf("Warning: Database initialization failed: %v", err)
		log.Println("Continuing without database - history features will not work")
	} else {
		// Run migration to update schema if needed
		if err := MigrateDatabase(); err != nil {
			log.Printf("Warning: Database migration failed: %v", err)
			log.Println("Continuing - some features may not work correctly")
		}
	}

	// API endpoints
	http.HandleFunc("/create-pr", createPRHandler)
	http.HandleFunc("/api/history", historyHandler)
	http.HandleFunc("/api/history/", historyDetailHandler)
	http.HandleFunc("/api/stats", statsHandler)
	http.HandleFunc("/api/auth/signup", signupHandler)
	http.HandleFunc("/api/auth/login", loginHandler)
	http.HandleFunc("/api/me", meHandler)
	http.HandleFunc("/api/change-password", changePasswordHandler)
	http.HandleFunc("/health", healthHandler)
	
	// Swagger/OpenAPI endpoint (will be served from static files or generated)
	http.HandleFunc("/swagger.json", swaggerHandler)
	http.HandleFunc("/api-docs", swaggerUIHandler)
	
	log.Println("Backend server starting on :8080")
	log.Println("Endpoints:")
	log.Println("  POST /create-pr      - Create infrastructure PR")
	log.Println("  GET  /api/history     - Get PR request history")
	log.Println("  GET  /api/history/:id - Get single PR request details")
	log.Println("  GET  /api/stats       - Get dashboard statistics")
	log.Println("  POST /api/auth/signup - User signup")
	log.Println("  POST /api/auth/login  - User login")
	log.Println("  GET  /api/me         - Current user (auth required)")
	log.Println("  POST /api/change-password - Change password (auth required)")
	log.Println("  GET  /health         - Health check")
	log.Println("  GET  /swagger.json    - OpenAPI spec")
	log.Println("  GET  /api-docs       - Swagger UI")
	
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	status := map[string]interface{}{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	}
	
	// Check database connection
	if DB != nil {
		if err := DB.Ping(); err == nil {
			status["database"] = "connected"
		} else {
			status["database"] = "disconnected"
		}
	} else {
		status["database"] = "not_initialized"
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
