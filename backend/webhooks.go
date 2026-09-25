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
		writeMethodNotAllowed(w, r)
		return
	}
	// GitHub sends X-GitHub-Event header
	eventType := r.Header.Get("X-GitHub-Event")
	if eventType == "" {
		eventType = "ping"
	}
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json payload", err)
		return
	}
	// Log the event
	details, _ := json.Marshal(payload)
	if len(details) > 2000 {
		details = details[:2000]
	}
	AppendGitHubLog("webhook_"+eventType, "GitHub webhook received", string(details))
	if eventType == "pull_request" {
		handleGitHubPullRequestEvent(payload)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	encodeJSON(w, map[string]interface{}{"status": "ok", "event": eventType})
	log.Printf("GitHub webhook: %s", eventType)
}

// FireWebhookApproveURL POSTs to WEBHOOK_APPROVE_URL when event is approved or pr_created (Phase 6)
func FireWebhookApproveURL(event string, payload map[string]interface{}) {
	if WebhookApproveURL == "" {
		return
	}
	if event != "approved" && event != "pr_created" {
		return
	}
	if payload == nil {
		payload = make(map[string]interface{})
	}
	payload["event"] = event
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = body
	enqueueJob("webhook", WebhookJob{
		URL:     WebhookApproveURL,
		Event:   event,
		Payload: payload,
	})
}

// FireOutboundWebhooks sends a POST request to each enabled webhook subscribed to the event (approved, pr_created, rejected, assigned).
// Payload should include at least request_id, event, and request summary. Called after Notify* in admin/devops handlers.
func FireOutboundWebhooks(event string, payload map[string]interface{}) {
	FireWebhookApproveURL(event, payload)
	if payload == nil {
		payload = make(map[string]interface{})
	}
	payload["event"] = event
	if event == "pr_created" {
		if id := intFromAny(payload["request_id"]); id > 0 {
			if req, err := GetPRRequestByID(id); err == nil && req != nil {
				go evaluateAndPublishRequestPolicy(req)
			}
		}
	}
	webhooks, err := GetEnabledOutboundWebhooksForEvent(event)
	if err != nil || len(webhooks) == 0 {
		return
	}
	for _, w := range webhooks {
		enqueueJob("webhook", WebhookJob{
			URL:     w.URL,
			Event:   event,
			Secret:  w.Secret,
			Payload: payload,
		})
	}
}

// RequestPayloadForWebhook builds a minimal JSON-safe map from PRRequest for outbound webhooks
func RequestPayloadForWebhook(req *PRRequest) map[string]interface{} {
	if req == nil {
		return map[string]interface{}{}
	}
	m := map[string]interface{}{
		"request_id":     req.ID,
		"team":           req.Team,
		"env":            req.Env,
		"cloud":          req.Cloud,
		"service":        req.Service,
		"status":         req.Status,
		"pr_url":         req.PRURL,
		"branch":         req.Branch,
		"application_id": req.ApplicationID,
		"created_at":     req.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		"updated_at":     req.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
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
