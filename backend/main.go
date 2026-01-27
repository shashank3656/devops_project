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
		if val, ok := payload[field]; !ok || val == nil {
			return fmt.Errorf("missing required field: %s", field)
		}
		if str, ok := val.(string); !ok || strings.TrimSpace(str) == "" {
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
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}

	// Validate required fields
	if err := validatePayload(payload); err != nil {
		log.Printf("Validation error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Safely extract fields with type checking
	team, ok := payload["team"].(string)
	if !ok {
		http.Error(w, "team must be a string", http.StatusBadRequest)
		return
	}
	env, ok := payload["env"].(string)
	if !ok {
		http.Error(w, "env must be a string", http.StatusBadRequest)
		return
	}
	cloud, ok := payload["cloud"].(string)
	if !ok {
		http.Error(w, "cloud must be a string", http.StatusBadRequest)
		return
	}
	service, ok := payload["service"].(string)
	if !ok {
		http.Error(w, "service must be a string", http.StatusBadRequest)
		return
	}

	// Create file path: configs/<team>/<env>/<cloud>-<service>.json
	filePath := fmt.Sprintf(
		"configs/%s/%s/%s-%s.json",
		team, env, cloud, service,
	)

	// Marshal payload with indentation for readability
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		http.Error(w, "error processing request", http.StatusInternalServerError)
		return
	}

	log.Printf("Creating PR for: team=%s, env=%s, cloud=%s, service=%s", team, env, cloud, service)

	prURL, err := CreateGitHubPR(filePath, content)
	if err != nil {
		log.Printf("Error creating PR: %v", err)
		http.Error(w, fmt.Sprintf("failed to create PR: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"pr_url": prURL,
		"status": "created",
		"branch": fmt.Sprintf("infra-%s-%s-%s-%s", team, env, cloud, service),
	}
	
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
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
