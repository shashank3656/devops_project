package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

func jiraWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	cloudID := strings.TrimSpace(r.Header.Get("X-Atlassian-Cloud-Id"))
	if cloudID == "" {
		var peek struct {
			CloudID string `json:"cloudId"`
		}
		_ = json.Unmarshal(body, &peek)
		cloudID = peek.CloudID
	}
	if cloudID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing Jira site identifier", nil)
		return
	}
	conn, err := findJiraConnectionByCloud(cloudID)
	if err != nil || !conn.Enabled {
		writeAPIError(w, r, http.StatusUnauthorized, "unknown Jira connection", nil)
		return
	}
	if !jiraWebhookSignatureOK(r, body, conn.ID) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid webhook signature", nil)
		return
	}
	var payload struct {
		WebhookEvent string `json:"webhookEvent"`
		Timestamp    int64  `json:"timestamp"`
		Issue        struct {
			ID  string `json:"id"`
			Key string `json:"key"`
		} `json:"issue"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Issue.ID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "invalid Jira webhook payload", err)
		return
	}
	eventID := strings.TrimSpace(r.Header.Get("X-Atlassian-Webhook-Identifier"))
	if eventID == "" {
		eventID = payload.WebhookEvent + ":" + cloudID + ":" + payload.Issue.ID + ":" + strings.TrimSpace(r.Header.Get("X-Atlassian-Webhook-Retry"))
	}
	if jiraEventAlreadyProcessed(eventID) {
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "duplicate": true})
		return
	}
	if !jiraIssueIsLinked(cloudID, payload.Issue.ID) {
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "ignored": true, "note": "Unlinked issues are not imported."})
		return
	}
	if jiraWebhookIsStale(payload.Timestamp, jiraIssueRemoteUpdated(cloudID, payload.Issue.ID)) {
		_ = markJiraEventProcessed(eventID)
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "ignored": true, "note": "Older Jira event was skipped."})
		return
	}
	_ = markJiraEventProcessed(eventID)
	_, _ = enqueueJiraIssueRefresh(conn.ID, 0, cloudID, payload.Issue.ID, "jira_webhook")
	insertJiraAudit(conn.ID, 0, "webhook", "", 0, cloudID, payload.Issue.ID, "queued", payload.WebhookEvent)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "ok"})
}

func jiraWebhookIsStale(eventUnixMilli int64, remoteUpdated time.Time) bool {
	if eventUnixMilli <= 0 || remoteUpdated.IsZero() {
		return false
	}
	return time.UnixMilli(eventUnixMilli).Before(remoteUpdated)
}

func jiraWebhookSignatureOK(r *http.Request, body []byte, connectionID int) bool {
	secretEnc := ""
	_ = DB.QueryRow(`SELECT webhook_secret_enc FROM jira_connection_secrets WHERE connection_id = $1`, connectionID).Scan(&secretEnc)
	secret, err := decryptJiraSecret(secretEnc)
	if err != nil || strings.TrimSpace(secret) == "" {
		return true
	}
	sig := strings.TrimSpace(r.Header.Get("X-Hub-Signature"))
	if sig == "" {
		sig = strings.TrimSpace(r.Header.Get("X-Hub-Signature-256"))
	}
	sig = strings.TrimPrefix(sig, "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(strings.ToLower(sig)), []byte(strings.ToLower(expected)))
}

func jiraEventAlreadyProcessed(eventID string) bool {
	if strings.TrimSpace(eventID) == "" || DB == nil {
		return false
	}
	var n int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM jira_processed_events WHERE event_id = $1`, eventID).Scan(&n)
	return n > 0
}

func markJiraEventProcessed(eventID string) error {
	if strings.TrimSpace(eventID) == "" || DB == nil {
		return nil
	}
	_, err := DB.Exec(`INSERT INTO jira_processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING`, eventID)
	return err
}
