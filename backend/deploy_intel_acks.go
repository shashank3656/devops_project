package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type deployIntelAck struct {
	ID        int       `json:"id"`
	RepoOwner string    `json:"repo_owner"`
	RepoName  string    `json:"repo_name"`
	PRNumber  int       `json:"pr_number"`
	UserID    int       `json:"user_id"`
	Username  string    `json:"username,omitempty"`
	Reasons   []string  `json:"reasons"`
	CreatedAt time.Time `json:"created_at"`
}

func normalizeAckReasons(reasons []string) []string {
	out := make([]string, 0, len(reasons))
	seen := map[string]struct{}{}
	for _, reason := range reasons {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			continue
		}
		key := strings.ToLower(reason)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, reason)
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func defaultAckReasons(reasons []string, brief *deployIntelChangeBrief) []string {
	out := normalizeAckReasons(reasons)
	if len(out) > 0 {
		return out
	}
	if brief != nil {
		out = normalizeAckReasons(brief.RiskBecause)
	}
	if len(out) == 0 {
		out = []string{"Acknowledged high-risk change brief"}
	}
	return out
}

func lookupDeployIntelAck(owner, repo string, prNumber int) *deployIntelAck {
	if DB == nil || prNumber <= 0 {
		return nil
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	if owner == "" || repo == "" {
		return nil
	}
	var item deployIntelAck
	var raw string
	err := DB.QueryRow(`
		SELECT id, repo_owner, repo_name, pr_number, user_id, reasons, created_at
		  FROM deploy_intel_acks
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2) AND pr_number = $3
		 ORDER BY created_at DESC
		 LIMIT 1
	`, owner, repo, prNumber).Scan(&item.ID, &item.RepoOwner, &item.RepoName, &item.PRNumber, &item.UserID, &raw, &item.CreatedAt)
	if err != nil {
		return nil
	}
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &item.Reasons)
	}
	item.Reasons = normalizeAckReasons(item.Reasons)
	if user, _ := GetUserByID(item.UserID); user != nil {
		item.Username = user.Username
	}
	return &item
}

func hasDeployIntelAck(owner, repo string, prNumber int) bool {
	return lookupDeployIntelAck(owner, repo, prNumber) != nil
}

func persistDeployIntelAck(owner, repo string, prNumber, userID int, reasons []string) (*deployIntelAck, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not available")
	}
	owner, repo = normalizeRepoIdentity(owner, repo)
	if owner == "" || repo == "" || prNumber <= 0 || userID <= 0 {
		return nil, fmt.Errorf("repository, pull request, and user are required")
	}
	reasons = normalizeAckReasons(reasons)
	if len(reasons) == 0 {
		return nil, fmt.Errorf("at least one acknowledgement reason is required")
	}
	payload, err := json.Marshal(reasons)
	if err != nil {
		return nil, err
	}
	item := deployIntelAck{
		RepoOwner: owner,
		RepoName:  repo,
		PRNumber:  prNumber,
		UserID:    userID,
		Reasons:   reasons,
		CreatedAt: time.Now().UTC(),
	}
	err = DB.QueryRow(`
		INSERT INTO deploy_intel_acks (repo_owner, repo_name, pr_number, user_id, reasons)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (repo_owner, repo_name, pr_number, user_id) DO UPDATE SET
			reasons = EXCLUDED.reasons,
			created_at = CURRENT_TIMESTAMP
		RETURNING id, created_at
	`, owner, repo, prNumber, userID, string(payload)).Scan(&item.ID, &item.CreatedAt)
	if err != nil {
		return nil, err
	}
	if user, _ := GetUserByID(userID); user != nil {
		item.Username = user.Username
	}
	return &item, nil
}

func persistAckForGate(req *PRRequest, gate highRiskMergeGateResult, userID int, reasons []string) *deployIntelAck {
	owner, repo, prNumber := "", "", 0
	if gate.Event != nil {
		owner, repo, prNumber = gate.Event.RepoOwner, gate.Event.RepoName, gate.Event.PRNumber
	}
	if prNumber <= 0 && req != nil {
		owner, repo, prNumber, _ = parseGitHubPRURL(req.PRURL)
	}
	if prNumber <= 0 || userID <= 0 {
		return nil
	}
	ack, err := persistDeployIntelAck(owner, repo, prNumber, userID, defaultAckReasons(reasons, gate.ChangeBrief))
	if err != nil {
		return nil
	}
	return ack
}

func persistAckForRequest(req *PRRequest, userID int, reasons []string) *deployIntelAck {
	if req == nil {
		return nil
	}
	return persistAckForGate(req, evaluateHighRiskMergeContext(req), userID, reasons)
}
