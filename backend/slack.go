package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

// SendSlackNotification sends a message to Slack if SLACK_WEBHOOK_URL is configured
func SendSlackNotification(text string, blocks []map[string]interface{}) {
	if SlackWebhookURL == "" {
		return
	}
	payload := map[string]interface{}{"text": text}
	if len(blocks) > 0 {
		payload["blocks"] = blocks
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Slack] marshal: %v", err)
		return
	}
	resp, err := http.Post(SlackWebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[Slack] POST: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("[Slack] status %d", resp.StatusCode)
	}
}

// NotifySlackRequestApproved sends Slack notification when request is approved
func NotifySlackRequestApproved(req *PRRequest, prURL string) {
	if req == nil {
		return
	}
	text := "✅ Request #" + strconv.Itoa(req.ID) + " approved"
	if prURL != "" {
		text += " | PR: " + prURL
	}
	SendSlackNotification(text, []map[string]interface{}{
		{
			"type": "section",
			"text": map[string]interface{}{
				"type": "mrkdwn",
				"text": "*Request approved*\nTeam: " + req.Team + " | Env: " + req.Env + " | " + req.Cloud + " " + req.Service + "\n" + text,
			},
		},
	})
}

// NotifySlackRequestRejected sends Slack notification when request is rejected
func NotifySlackRequestRejected(req *PRRequest, reason string) {
	if req == nil {
		return
	}
	text := "❌ Request #" + strconv.Itoa(req.ID) + " rejected"
	if reason != "" {
		text += ": " + reason
	}
	SendSlackNotification(text, []map[string]interface{}{
		{
			"type": "section",
			"text": map[string]interface{}{
				"type": "mrkdwn",
				"text": "*Request rejected*\nTeam: " + req.Team + " | Env: " + req.Env + " | " + req.Cloud + " " + req.Service + "\n" + text,
			},
		},
	})
}

// NotifySlackPRCreated sends Slack notification when PR is created
func NotifySlackPRCreated(req *PRRequest, prURL string) {
	if req == nil || prURL == "" {
		return
	}
	SendSlackNotification("🔀 PR created for Request #"+strconv.Itoa(req.ID)+": "+prURL, []map[string]interface{}{
		{
			"type": "section",
			"text": map[string]interface{}{
				"type": "mrkdwn",
				"text": "*PR Created*\n<" + prURL + "|View PR>\nTeam: " + req.Team + " | " + req.Cloud + " " + req.Service,
			},
		},
	})
}
