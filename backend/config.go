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
)

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
