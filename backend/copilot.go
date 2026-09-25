package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type copilotMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type copilotRequest struct {
	Query   string                 `json:"query"`
	Path    string                 `json:"path"`
	Title   string                 `json:"title"`
	Portal  string                 `json:"portal"`
	Context map[string]interface{} `json:"context"`
}

func copilotHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	var body copilotRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	answer := answerGroundedCopilot(body, userID, body.Portal)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"reply":     answer.Reply,
		"source":    answer.Source,
		"citations": answer.Citations,
		"rollback":  answer.Rollback,
	})
}

func answerCopilot(body copilotRequest) (string, string) {
	if reply, ok := callCopilotModel(body); ok {
		return reply, "model"
	}
	return fallbackCopilotReply(body), "fallback"
}

func fallbackCopilotReply(body copilotRequest) string {
	query := strings.ToLower(strings.TrimSpace(body.Query))
	if impact, ok := body.Context["impact"].(map[string]interface{}); ok {
		summary, _ := impact["summary"].(string)
		action, _ := impact["recommended_action"].(string)
		if summary != "" && (strings.Contains(query, "pr") || strings.Contains(query, "risk") || strings.Contains(query, "impact") || query == "") {
			return strings.TrimSpace(summary + "\n\n" + action)
		}
	}
	if strings.Contains(query, "gate") || strings.Contains(query, "blocked") {
		return "A promotion is blocked when an environment has open incidents, failed checks, or a freeze. Open the environment pipeline, read the blocking check, then either fix it or acknowledge a high-risk PR brief."
	}
	if strings.Contains(query, "rollback") {
		return "Use Rollback from the DevOps portal. Confirm the workload, environment, and previous revision before applying. If this PR is high risk, treat rollback as the default recovery path."
	}
	if strings.Contains(query, "incident") {
		return "Open the incident, assign an owner, capture the timeline, and link the related request or PR. After mitigation, write the next three steps in the incident workspace."
	}
	if strings.Contains(query, "freeze") {
		reason := activeFreezeReason()
		if reason != "" {
			return "A production freeze is currently active: " + reason
		}
		return "No freeze is active. DevOps can start one from promotions or by the ChatOps freeze command."
	}
	if body.Title != "" {
		return "You are on " + body.Title + ". Ask about this page, a PR impact score, a blocked gate, or the next operational step."
	}
	return "Ask about PR production impact, blocked promotions, incidents, or the current page."
}

func callCopilotModel(body copilotRequest) (string, bool) {
	apiKey := strings.TrimSpace(os.Getenv("COPILOT_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	}
	if apiKey == "" {
		return "", false
	}
	endpoint := strings.TrimSpace(os.Getenv("COPILOT_API_URL"))
	if endpoint == "" {
		endpoint = "https://api.openai.com/v1/chat/completions"
	}
	model := strings.TrimSpace(os.Getenv("COPILOT_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}
	contextJSON, _ := json.Marshal(body.Context)
	payload := map[string]interface{}{
		"model": model,
		"messages": []copilotMessage{
			{Role: "system", Content: "You are the SetuOps ops copilot. Answer only from the provided Change, Incident, and runbook citations. Name those IDs. Suggest a previous SHA when present. Never apply Terraform, Helm, or cluster changes."},
			{Role: "user", Content: fmt.Sprintf("Portal: %s\nPage: %s %s\nQuestion: %s\nContext: %s", body.Portal, body.Title, body.Path, body.Query, string(contextJSON))},
		},
		"temperature": 0.2,
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", false
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", false
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return "", false
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", false
	}
	var parsed struct {
		Choices []struct {
			Message copilotMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", false
	}
	reply := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if reply == "" {
		return "", false
	}
	return reply, true
}
