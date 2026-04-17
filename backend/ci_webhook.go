package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func encodeCIWebhookJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("ci webhook response encode failed: %v", err)
	}
}

// ciWebhookHandler POST /api/webhooks/ci - receives CI pipeline status updates (terraform plan, infracost, merge/apply success, etc.)
// Auth: X-CI-Secret header must match CI_WEBHOOK_SECRET
// Body: { "request_id": 123, "application_id": "abc123", "status": "plan_success"|"plan_failed"|"cost_ready"|"merge_success"|"apply_success", "plan_output": "...", "cost_estimate": "..." }
func ciWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if CIWebhookSecret != "" {
		secret := r.Header.Get("X-CI-Secret")
		if secret != CIWebhookSecret {
			log.Printf("[CI Webhook] invalid or missing secret")
			writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
			return
		}
	}
	var payload struct {
		RequestID     int    `json:"request_id"`
		ApplicationID string `json:"application_id"`
		Status        string `json:"status"` // plan_success, plan_failed, cost_ready, merge_success, apply_success, apply_failed
		PlanOutput    string `json:"plan_output"`
		CostEstimate  string `json:"cost_estimate"`
		Details       string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	var req *PRRequest
	if payload.RequestID > 0 {
		req, _ = GetPRRequestByID(payload.RequestID)
	} else if payload.ApplicationID != "" {
		req = GetPRRequestByApplicationID(payload.ApplicationID)
	}
	if req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", nil)
		return
	}
	// Update terraform plan output if provided
	if payload.PlanOutput != "" {
		_ = UpdatePRRequestTerraformPlanOutput(req.ID, payload.PlanOutput)
	}
	// Log the CI event
	AppendGitHubLog("ci_"+payload.Status, "CI pipeline: "+payload.Status, payload.Details)
	normalizedStatus := normalizeCIWebhookStatus(payload.Status)
	markedCompleted := false
	if shouldMarkRequestCompletedFromCIStatus(normalizedStatus) && req.Status != "completed" {
		if err := UpdatePRRequestStatus(req.ID, "completed"); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to mark request completed", err)
			return
		}
		markedCompleted = true
		AppendUserActivity(req.CreatedBy, "request_completed_by_pipeline", "pr_request", strconv.Itoa(req.ID), "ci_status="+normalizedStatus)
		if req.CreatedBy != nil {
			message := fmt.Sprintf("Request #%d is completed after %s.", req.ID, strings.ReplaceAll(normalizedStatus, "_", " "))
			_ = InsertUserNotification(*req.CreatedBy, &req.ID, req.ProjectID, "request_completed", message)
		}
	}
	log.Printf("[CI Webhook] request_id=%d status=%s normalized=%s completed=%t", req.ID, payload.Status, normalizedStatus, markedCompleted)
	w.Header().Set("Content-Type", "application/json")
	encodeCIWebhookJSON(w, map[string]interface{}{
		"status":            "ok",
		"request_id":        req.ID,
		"updated":           payload.PlanOutput != "" || markedCompleted,
		"marked_completed":  markedCompleted,
		"normalized_status": normalizedStatus,
	})
}

func normalizeCIWebhookStatus(status string) string {
	normalized := strings.TrimSpace(strings.ToLower(status))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	for strings.Contains(normalized, "__") {
		normalized = strings.ReplaceAll(normalized, "__", "_")
	}
	return strings.Trim(normalized, "_")
}

func shouldMarkRequestCompletedFromCIStatus(status string) bool {
	switch normalizeCIWebhookStatus(status) {
	case "apply_success", "apply_completed", "merge_success", "merge_pipeline_success", "merge_succeeded", "deploy_success", "deployment_success", "pipeline_success", "completed", "complete":
		return true
	default:
		return false
	}
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
