package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// githubWebhookHandler POST /api/webhooks/github - receives GitHub webhook events
func githubWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// GitHub sends X-GitHub-Event header
	eventType := r.Header.Get("X-GitHub-Event")
	if eventType == "" {
		eventType = "ping"
	}
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	// Log the event
	details, _ := json.Marshal(payload)
	if len(details) > 2000 {
		details = details[:2000]
	}
	AppendGitHubLog("webhook_"+eventType, "GitHub webhook received", string(details))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "event": eventType})
	log.Printf("GitHub webhook: %s", eventType)
}
