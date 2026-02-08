package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

// FireOutboundWebhooks sends a POST request to each enabled webhook subscribed to the event (approved, pr_created, rejected, assigned).
// Payload should include at least request_id, event, and request summary. Called after Notify* in admin/devops handlers.
func FireOutboundWebhooks(event string, payload map[string]interface{}) {
	if payload == nil {
		payload = make(map[string]interface{})
	}
	payload["event"] = event
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Webhook] marshal payload: %v", err)
		return
	}
	webhooks, err := GetEnabledOutboundWebhooksForEvent(event)
	if err != nil || len(webhooks) == 0 {
		return
	}
	for _, w := range webhooks {
		go func(url, secret string, body []byte) {
			req, err := http.NewRequest("POST", url, bytes.NewReader(body))
			if err != nil {
				log.Printf("[Webhook] new request %s: %v", url, err)
				return
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Webhook-Event", event)
			if secret != "" {
				mac := hmac.New(sha256.New, []byte(secret))
				mac.Write(body)
				req.Header.Set("X-Webhook-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				log.Printf("[Webhook] POST %s: %v", url, err)
				return
			}
			resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				log.Printf("[Webhook] POST %s status %d", url, resp.StatusCode)
			}
		}(w.URL, w.Secret, body)
	}
}

// RequestPayloadForWebhook builds a minimal JSON-safe map from PRRequest for outbound webhooks
func RequestPayloadForWebhook(req *PRRequest) map[string]interface{} {
	if req == nil {
		return map[string]interface{}{}
	}
	m := map[string]interface{}{
		"request_id":   req.ID,
		"team":         req.Team,
		"env":          req.Env,
		"cloud":        req.Cloud,
		"service":      req.Service,
		"status":       req.Status,
		"pr_url":       req.PRURL,
		"branch":       req.Branch,
		"application_id": req.ApplicationID,
		"created_at":   req.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		"updated_at":   req.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if req.CreatedBy != nil {
		m["created_by"] = *req.CreatedBy
	}
	if req.AssignedTo != nil {
		m["assigned_to"] = *req.AssignedTo
	}
	if req.RejectReason != "" {
		m["reject_reason"] = req.RejectReason
	}
	return m
}
