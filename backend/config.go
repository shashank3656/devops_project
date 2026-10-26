package main

import (
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

var (
	// GitHubOwner can be your GitHub username (personal account) or organization name
	// Example: "your-username" or "your-org-name"
	GitHubOwner = getEnv("GITHUB_OWNER", "YOUR_GITHUB_USERNAME_OR_ORG")
	GitHubRepo  = getEnv("GITHUB_REPO", "infra-live")
	GitHubToken = getEnv("GITHUB_TOKEN", "") // GitHub Personal Access Token
	BaseBranch  = getEnv("BASE_BRANCH", "main")

	// CIWebhookSecret - secret for CI to authenticate when posting pipeline status
	CIWebhookSecret = getEnv("CI_WEBHOOK_SECRET", "")
	// ChangeWebhookSecret - optional dedicated secret for POST /api/webhooks/change
	ChangeWebhookSecret = getEnv("CHANGE_WEBHOOK_SECRET", "")
	// AlertWebhookSecret - optional dedicated secret for POST /api/webhooks/alerts
	AlertWebhookSecret = getEnv("ALERT_WEBHOOK_SECRET", "")

	// SlackWebhookURL - optional Slack incoming webhook for notifications
	SlackWebhookURL = getEnv("SLACK_WEBHOOK_URL", "")

	// TeamsWebhookURL - optional Microsoft Teams incoming webhook for notifications
	TeamsWebhookURL = getEnv("TEAMS_WEBHOOK_URL", "")

	// OpsNotificationWebhookURL - optional generic webhook for ops notifications
	OpsNotificationWebhookURL = getEnv("OPS_NOTIFICATION_WEBHOOK_URL", "")

	// FrontendURL - base URL for user frontend (for password reset links). Default: http://localhost:3000
	FrontendURL = getEnv("FRONTEND_URL", "http://localhost:3000")

	// AdminFrontendURL - base URL for admin frontend.
	AdminFrontendURL = getEnv("ADMIN_FRONTEND_URL", "http://localhost:3001")

	// DevOpsFrontendURL - base URL for DevOps frontend (for DevOps password reset links). Default: http://localhost:3002
	DevOpsFrontendURL = getEnv("DEVOPS_FRONTEND_URL", "http://localhost:3002")

	// WebhookApproveURL - optional URL to POST when request is approved
	WebhookApproveURL = getEnv("WEBHOOK_APPROVE_URL", "")

	// Redis / runtime reliability
	RedisAddr           = getEnv("REDIS_ADDR", "")
	RedisPassword       = getEnv("REDIS_PASSWORD", "")
	RedisDB             = getEnvInt("REDIS_DB", 0)
	RedisCacheTTL       = getEnvDurationSeconds("REDIS_CACHE_TTL_SECONDS", 90*time.Second)
	RedisQueueName      = getEnv("REDIS_QUEUE_NAME", "infra:jobs")
	RedisJobPollTimeout = getEnvDurationSeconds("REDIS_JOB_POLL_TIMEOUT_SECONDS", 5*time.Second)
	DBQueryTimeout      = getEnvDurationSeconds("DB_QUERY_TIMEOUT_SECONDS", 5*time.Second)
	// DBTxTimeout applies to multi-statement transactions (e.g. project catalog create/update).
	// Keep higher than DBQueryTimeout when using remote Postgres / poolers.
	DBTxTimeout             = getEnvDurationSeconds("DB_TX_TIMEOUT_SECONDS", 30*time.Second)
	SlowQueryThreshold      = getEnvDurationMilliseconds("DB_SLOW_QUERY_MS", 750*time.Millisecond)
	RequestLogSlowThreshold = getEnvDurationMilliseconds("REQUEST_LOG_SLOW_MS", 500*time.Millisecond)

	// OpenTelemetry
	OpenTelemetryEnabled       = getEnvBool("OTEL_ENABLED", true)
	OpenTelemetryServiceName   = getEnv("OTEL_SERVICE_NAME", "infra-backend")
	OpenTelemetryServiceEnv    = getEnv("OTEL_SERVICE_ENV", getEnv("APP_ENV", "local"))
	OpenTelemetryServiceVer    = getEnv("OTEL_SERVICE_VERSION", getEnv("APP_VERSION", "dev"))
	OpenTelemetryEndpoint      = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	OpenTelemetryInsecure      = getEnvBool("OTEL_EXPORTER_OTLP_INSECURE", true)
	OpenTelemetrySampleRatio   = getEnvFloat("OTEL_TRACES_SAMPLER_RATIO", 1.0)
	OpenTelemetryMetricSeconds = getEnvDurationSeconds("OTEL_METRICS_EXPORT_INTERVAL_SECONDS", 30*time.Second)

	// RecordDocsS3Bucket stores incident, change, and problem files. Postgres holds metadata only.
	RecordDocsS3Bucket = getEnv("RECORD_DOCS_S3_BUCKET", "")
	RecordDocsS3Prefix = getEnv("RECORD_DOCS_S3_PREFIX", "Incidents")
)

func init() {
	applyRedisURLFromEnv()
}

func reloadConfigFromEnv() {
	GitHubOwner = getEnv("GITHUB_OWNER", "YOUR_GITHUB_USERNAME_OR_ORG")
	GitHubRepo = getEnv("GITHUB_REPO", "infra-live")
	GitHubToken = getEnv("GITHUB_TOKEN", "")
	BaseBranch = getEnv("BASE_BRANCH", "main")
	CIWebhookSecret = getEnv("CI_WEBHOOK_SECRET", "")
	ChangeWebhookSecret = getEnv("CHANGE_WEBHOOK_SECRET", "")
	AlertWebhookSecret = getEnv("ALERT_WEBHOOK_SECRET", "")
	SlackWebhookURL = getEnv("SLACK_WEBHOOK_URL", "")
	TeamsWebhookURL = getEnv("TEAMS_WEBHOOK_URL", "")
	OpsNotificationWebhookURL = getEnv("OPS_NOTIFICATION_WEBHOOK_URL", "")
	FrontendURL = getEnv("FRONTEND_URL", "http://localhost:3000")
	AdminFrontendURL = getEnv("ADMIN_FRONTEND_URL", "http://localhost:3001")
	DevOpsFrontendURL = getEnv("DEVOPS_FRONTEND_URL", "http://localhost:3002")
	WebhookApproveURL = getEnv("WEBHOOK_APPROVE_URL", "")
	RedisAddr = getEnv("REDIS_ADDR", "")
	RedisPassword = getEnv("REDIS_PASSWORD", "")
	RedisDB = getEnvInt("REDIS_DB", 0)
	applyRedisURLFromEnv()
	RedisCacheTTL = getEnvDurationSeconds("REDIS_CACHE_TTL_SECONDS", 90*time.Second)
	RedisQueueName = getEnv("REDIS_QUEUE_NAME", "infra:jobs")
	RedisJobPollTimeout = getEnvDurationSeconds("REDIS_JOB_POLL_TIMEOUT_SECONDS", 5*time.Second)
	DBQueryTimeout = getEnvDurationSeconds("DB_QUERY_TIMEOUT_SECONDS", 5*time.Second)
	DBTxTimeout = getEnvDurationSeconds("DB_TX_TIMEOUT_SECONDS", 30*time.Second)
	SlowQueryThreshold = getEnvDurationMilliseconds("DB_SLOW_QUERY_MS", 750*time.Millisecond)
	RequestLogSlowThreshold = getEnvDurationMilliseconds("REQUEST_LOG_SLOW_MS", 500*time.Millisecond)
	OpenTelemetryEnabled = getEnvBool("OTEL_ENABLED", true)
	OpenTelemetryServiceName = getEnv("OTEL_SERVICE_NAME", "infra-backend")
	OpenTelemetryServiceEnv = getEnv("OTEL_SERVICE_ENV", getEnv("APP_ENV", "local"))
	OpenTelemetryServiceVer = getEnv("OTEL_SERVICE_VERSION", getEnv("APP_VERSION", "dev"))
	OpenTelemetryEndpoint = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	OpenTelemetryInsecure = getEnvBool("OTEL_EXPORTER_OTLP_INSECURE", true)
	OpenTelemetrySampleRatio = getEnvFloat("OTEL_TRACES_SAMPLER_RATIO", 1.0)
	OpenTelemetryMetricSeconds = getEnvDurationSeconds("OTEL_METRICS_EXPORT_INTERVAL_SECONDS", 30*time.Second)
	RecordDocsS3Bucket = getEnv("RECORD_DOCS_S3_BUCKET", "")
	RecordDocsS3Prefix = getEnv("RECORD_DOCS_S3_PREFIX", "Incidents")
}

func applyRedisURLFromEnv() {
	raw := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("REDIS_PRIVATE_URL"))
	}
	if raw == "" {
		return
	}
	parsed, err := url.Parse(raw)
	if err != nil || strings.TrimSpace(parsed.Host) == "" {
		log.Printf("[Redis] ignoring invalid REDIS_URL: %v", err)
		return
	}
	RedisAddr = parsed.Host
	if parsed.User != nil {
		if password, ok := parsed.User.Password(); ok {
			RedisPassword = password
		}
	}
	if dbPath := strings.TrimPrefix(parsed.Path, "/"); dbPath != "" {
		if db, convErr := strconv.Atoi(dbPath); convErr == nil {
			RedisDB = db
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return parsed
}

func getEnvBool(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return defaultValue
	}
	return parsed
}

func getEnvFloat(key string, defaultValue float64) float64 {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return defaultValue
	}
	return parsed
}

func getEnvDurationSeconds(key string, defaultValue time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return time.Duration(parsed) * time.Second
}

func getEnvDurationMilliseconds(key string, defaultValue time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return time.Duration(parsed) * time.Millisecond
}
