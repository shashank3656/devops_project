package main

import "os"

var (
	// GitHubOwner can be your GitHub username (personal account) or organization name
	// Example: "your-username" or "your-org-name"
	GitHubOwner = getEnv("GITHUB_OWNER", "YOUR_GITHUB_USERNAME_OR_ORG")
	GitHubRepo  = getEnv("GITHUB_REPO", "infra-live")
	GitHubToken = getEnv("GITHUB_TOKEN", "") // GitHub Personal Access Token
	BaseBranch  = getEnv("BASE_BRANCH", "main")

	// CIWebhookSecret - secret for CI to authenticate when posting pipeline status
	CIWebhookSecret = getEnv("CI_WEBHOOK_SECRET", "")

	// SlackWebhookURL - optional Slack incoming webhook for notifications
	SlackWebhookURL = getEnv("SLACK_WEBHOOK_URL", "")

	// FrontendURL - base URL for user frontend (for password reset links). Default: http://localhost:3000
	FrontendURL = getEnv("FRONTEND_URL", "http://localhost:3000")

	// WebhookApproveURL - optional URL to POST when request is approved
	WebhookApproveURL = getEnv("WEBHOOK_APPROVE_URL", "")
)

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
