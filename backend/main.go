package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type InfraRequest map[string]interface{}

// enableCORS adds CORS headers to allow frontend requests
func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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

	// Create file path: <team-id>/<env>/<cloud>-<service>.json
	filePath := fmt.Sprintf(
		"%s/%s/%s-%s.json",
		team, env, cloud, service,
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

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"pr_url": prURL,
		"status": "created",
		"branch": branchName,
	}
	
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "error encoding response", http.StatusInternalServerError)
		return
	}
}

func main() {
	http.HandleFunc("/create-pr", createPRHandler)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	
	log.Println("Backend server starting on :8080")
	log.Println("Endpoints:")
	log.Println("  POST /create-pr - Create infrastructure PR")
	log.Println("  GET  /health    - Health check")
	
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
