package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// ciWebhookHandler POST /api/webhooks/ci - receives CI pipeline status updates (terraform plan, infracost, etc.)
// Auth: X-CI-Secret header must match CI_WEBHOOK_SECRET
// Body: { "request_id": 123, "application_id": "abc123", "status": "plan_success"|"plan_failed"|"cost_ready", "plan_output": "...", "cost_estimate": "..." }
func ciWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if CIWebhookSecret != "" {
		secret := r.Header.Get("X-CI-Secret")
		if secret != CIWebhookSecret {
			log.Printf("[CI Webhook] invalid or missing secret")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid secret", "status": "error"})
			return
		}
	}
	var payload struct {
		RequestID    int    `json:"request_id"`
		ApplicationID string `json:"application_id"`
		Status       string `json:"status"` // plan_success, plan_failed, cost_ready, apply_success, apply_failed
		PlanOutput   string `json:"plan_output"`
		CostEstimate string `json:"cost_estimate"`
		Details      string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	var req *PRRequest
	if payload.RequestID > 0 {
		req, _ = GetPRRequestByID(payload.RequestID)
	} else if payload.ApplicationID != "" {
		req = GetPRRequestByApplicationID(payload.ApplicationID)
	}
	if req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request not found", "status": "error"})
		return
	}
	// Update terraform plan output if provided
	if payload.PlanOutput != "" {
		_ = UpdatePRRequestTerraformPlanOutput(req.ID, payload.PlanOutput)
	}
	// Log the CI event
	AppendGitHubLog("ci_"+payload.Status, "CI pipeline: "+payload.Status, payload.Details)
	log.Printf("[CI Webhook] request_id=%d status=%s", req.ID, payload.Status)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "ok",
		"request_id": req.ID,
		"updated":    payload.PlanOutput != "",
	})
}

// VerifyCIWebhookSignature validates HMAC-SHA256 of body using CI_WEBHOOK_SECRET (alternative to X-CI-Secret)
func VerifyCIWebhookSignature(body []byte, signature string) bool {
	if CIWebhookSecret == "" || signature == "" {
		return false
	}
	sig := strings.TrimPrefix(signature, "sha256=")
	expected := hmac.New(sha256.New, []byte(CIWebhookSecret))
	expected.Write(body)
	return hmac.Equal([]byte(hex.EncodeToString(expected.Sum(nil))), []byte(sig))
}
