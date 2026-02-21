package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

// SendTeamsNotification sends a message to Microsoft Teams if TEAMS_WEBHOOK_URL is configured.
// Uses Adaptive Card format for Teams incoming webhooks.
func SendTeamsNotification(text string) {
	if TeamsWebhookURL == "" {
		return
	}
	payload := map[string]interface{}{
		"type": "message",
		"attachments": []map[string]interface{}{
			{
				"contentType": "application/vnd.microsoft.card.adaptive",
				"content": map[string]interface{}{
					"type":    "AdaptiveCard",
					"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
					"version": "1.0",
					"body": []map[string]interface{}{
						{
							"type": "TextBlock",
							"text": text,
							"wrap": true,
						},
					},
				},
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Teams] marshal: %v", err)
		return
	}
	resp, err := http.Post(TeamsWebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[Teams] POST: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("[Teams] status %d", resp.StatusCode)
	}
}

// NotifyTeamsRequestApproved sends Teams notification when request is approved
func NotifyTeamsRequestApproved(req *PRRequest, prURL string) {
	if req == nil {
		return
	}
	text := "✅ **Request approved**\n\nRequest #" + strconv.Itoa(req.ID) + "\nTeam: " + req.Team + " | Env: " + req.Env + "\n" + req.Cloud + " " + req.Service
	if prURL != "" {
		text += "\n\nPR: " + prURL
	}
	SendTeamsNotification(text)
}

// NotifyTeamsRequestRejected sends Teams notification when request is rejected
func NotifyTeamsRequestRejected(req *PRRequest, reason string) {
	if req == nil {
		return
	}
	text := "❌ **Request rejected**\n\nRequest #" + strconv.Itoa(req.ID) + "\nTeam: " + req.Team + " | Env: " + req.Env + "\n" + req.Cloud + " " + req.Service
	if reason != "" {
		text += "\n\nReason: " + reason
	}
	SendTeamsNotification(text)
}

// NotifyTeamsPRCreated sends Teams notification when PR is created
func NotifyTeamsPRCreated(req *PRRequest, prURL string) {
	if req == nil || prURL == "" {
		return
	}
	text := "🔀 **PR created**\n\nRequest #" + strconv.Itoa(req.ID) + "\nTeam: " + req.Team + " | " + req.Cloud + " " + req.Service + "\n\nPR: " + prURL
	SendTeamsNotification(text)
}

// NotifyTeamsSLABreach sends Teams notification when request exceeds SLA (overdue)
func NotifyTeamsSLABreach(req *PRRequest, _ int) {
	if req == nil {
		return
	}
	text := "⚠️ **SLA breach**\n\nRequest #" + strconv.Itoa(req.ID) + " is overdue or due within 24h.\nTeam: " + req.Team + " | Env: " + req.Env + "\n" + req.Cloud + " " + req.Service
	if req.Priority != "" {
		text += "\nPriority: " + req.Priority
	}
	SendTeamsNotification(text)
}
