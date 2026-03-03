package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const (
	defaultDBHost                = "postgres"
	defaultDBPort                = "5432"
	defaultDBName                = "infra_portal"
	defaultDBSSLMode             = "disable"
	defaultDBPingTimeoutSeconds  = 5
	defaultDBMaxOpenConns        = 25
	defaultDBMaxIdleConns        = 5
	defaultDBConnMaxLifetimeMins = 5
	defaultDBConnMaxIdleMins     = 2
)

const requestApplicationIDChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
const teamApplicationIDChars = "abcdefghijklmnopqrstuvwxyz0123456789"

func generateUniqueID(length int, charset string, existsFn func(string) (bool, error)) (string, error) {
	for i := 0; i < 100; i++ {
		b := make([]byte, length)
		if _, err := rand.Read(b); err != nil {
			return "", err
		}
		for j := range b {
			b[j] = charset[int(b[j])%len(charset)]
		}
		id := string(b)
		if existsFn == nil || DB == nil {
			return id, nil
		}
		exists, err := existsFn(id)
		if err != nil {
			return "", err
		}
		if !exists {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not generate unique id after 100 attempts")
}

// GenerateApplicationID returns a unique 10-char alphanumeric ID for requests.
func GenerateApplicationID() (string, error) {
	return generateUniqueID(10, requestApplicationIDChars, func(id string) (bool, error) {
		var exists int
		err := DB.QueryRow("SELECT 1 FROM pr_requests WHERE application_id = $1 LIMIT 1", id).Scan(&exists)
		if err == sql.ErrNoRows {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	})
}

// GenerateTeamApplicationID returns a unique 12-char lowercase alphanumeric ID for team groups.
func GenerateTeamApplicationID() (string, error) {
	return generateUniqueID(12, teamApplicationIDChars, func(id string) (bool, error) {
		var exists int
		err := DB.QueryRow("SELECT 1 FROM teams WHERE application_id = $1 LIMIT 1", id).Scan(&exists)
		if err == sql.ErrNoRows {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	})
}

func normalizeTeamSlug(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "team"
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	normalized := strings.Trim(b.String(), "-")
	if normalized == "" {
		return "team"
	}
	return normalized
}

func ResolveTeamPathKey(teamNameOrSlug string) string {
	trimmed := strings.TrimSpace(teamNameOrSlug)
	if trimmed == "" {
		return "team"
	}
	if DB != nil {
		if team, err := GetTeamByNameOrSlug(trimmed); err == nil && team != nil {
			if team.ApplicationID != "" {
				return team.ApplicationID
			}
			if team.Slug != "" {
				return normalizeTeamSlug(team.Slug)
			}
		}
	}
	return normalizeTeamSlug(trimmed)
}

func BuildRequestGitArtifacts(teamNameOrSlug, env, requestApplicationID string) (filePath string, branchName string) {
	teamPathKey := ResolveTeamPathKey(teamNameOrSlug)
	filePath = fmt.Sprintf("%s/envs/%s/request.json", teamPathKey, env)
	branchName = fmt.Sprintf("%s/%s/%s", teamPathKey, env, requestApplicationID)
	return filePath, branchName
}

func getEnvTrimmed(key string) string {
	return strings.TrimSpace(os.Getenv(key))
}

func getEnvOrDefault(key, fallback string) string {
	if value := getEnvTrimmed(key); value != "" {
		return value
	}
	return fallback
}

func getEnvIntOrDefault(key string, fallback int) int {
	value := getEnvTrimmed(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func buildDatabaseDSN() (dsn string, redacted string, err error) {
	if databaseURL := getEnvTrimmed("DATABASE_URL"); databaseURL != "" {
		return databaseURL, "DATABASE_URL", nil
	}

	dbHost := getEnvOrDefault("DB_HOST", defaultDBHost)
	dbPort := getEnvOrDefault("DB_PORT", defaultDBPort)
	dbUser := getEnvTrimmed("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")
	dbName := getEnvOrDefault("DB_NAME", defaultDBName)
	dbSSLMode := getEnvOrDefault("DB_SSLMODE", defaultDBSSLMode)
	connectTimeout := getEnvIntOrDefault("DB_CONNECT_TIMEOUT_SECONDS", defaultDBPingTimeoutSeconds)

	if dbUser == "" {
		return "", "", fmt.Errorf("DB_USER is required when DATABASE_URL is not set")
	}
	if dbPassword == "" {
		return "", "", fmt.Errorf("DB_PASSWORD is required when DATABASE_URL is not set")
	}

	dsn = fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=%d",
		dbHost, dbPort, dbUser, dbPassword, dbName, dbSSLMode, connectTimeout,
	)
	redacted = fmt.Sprintf(
		"host=%s port=%s user=%s dbname=%s sslmode=%s",
		dbHost, dbPort, dbUser, dbName, dbSSLMode,
	)
	return dsn, redacted, nil
}

var DB *sql.DB

type PRRequest struct {
	ID                  int        `json:"id"`
	ProjectID           *int       `json:"project_id,omitempty"`
	ProjectName         string     `json:"project_name,omitempty"`
	ProjectCode         string     `json:"project_code,omitempty"`
	Team                string     `json:"team"`
	Env                 string     `json:"env"`
	Cloud               string     `json:"cloud"`
	Service             string     `json:"service"`
	ClientName          string     `json:"client_name"`
	ApplicationID       string     `json:"application_id"` // unique 10-char alphanumeric, used in branch/PR
	Priority            string     `json:"priority"`       // low, medium, high, critical
	DueDate             *time.Time `json:"due_date"`
	PRURL               string     `json:"pr_url"`
	Branch              string     `json:"branch"`
	FilePath            string     `json:"file_path"`
	Status              string     `json:"status"` // draft, pending_user_manager_approval, pending_devops_approval, pending_approval, in_progress, completed, rejected
	RejectReason        string     `json:"reject_reason"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	CreatedBy           *int       `json:"created_by"`
	CreatedByUsername   string     `json:"created_by_username,omitempty"` // set in history for "who raised" when view=team
	AssignedTo          *int       `json:"assigned_to"`                   // DevOps user assigned after PR creation (by priority)
	Config              string     `json:"config"`
	TerraformPlanOutput string     `json:"terraform_plan_output,omitempty"` // Terraform plan/apply output from CI (display in UI)
	JiraTicketID        string     `json:"jira_ticket_id,omitempty"`        // Jira/ticketing integration
}

// RequestComment is a comment on a PR request
type RequestComment struct {
	ID        int       `json:"id"`
	RequestID int       `json:"request_id"`
	UserID    int       `json:"user_id"`
	Username  string    `json:"username"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type User struct {
	ID              int       `json:"id"`
	Username        string    `json:"username"`
	Email           string    `json:"email"`
	Password        string    `json:"-"` // Don't return password in JSON
	Verified        bool      `json:"verified"`
	Role            string    `json:"role"`              // viewer | contributor | admin
	UserType        string    `json:"user_type"`         // portal_user | devops_user
	ManagerID       *int      `json:"manager_id"`        // portal user's manager (for two-step approval)
	IsPortalManager bool      `json:"is_portal_manager"` // portal user designated as group manager (same UX as DevOps manager)
	TotpEnabled     bool      `json:"totp_enabled"`      // 2FA enabled (email OTP on login)
	CreatedAt       time.Time `json:"created_at"`
}

// DevopsProfile holds DevOps-specific fields for users with user_type = devops_user
type DevopsProfile struct {
	UserID      int     `json:"user_id"`
	IsManager   bool    `json:"is_manager"`
	Position    string  `json:"position"`
	OnboardDate *string `json:"onboard_date"` // YYYY-MM-DD
	Level       string  `json:"level"`        // L1, L2, L3, L4
}

// Team is a group created by admin (for admin frontend). team_type: portal (user portal group) | devops (DevOps team)
type Team struct {
	ID            int       `json:"id"`
	Name          string    `json:"name"`
	Slug          string    `json:"slug"`
	ApplicationID string    `json:"application_id"`
	TeamType      string    `json:"team_type"`               // portal | devops
	DefaultEnv    string    `json:"default_env,omitempty"`   // e.g. dev, prod; prefill when user from this team creates request
	DefaultCloud  string    `json:"default_cloud,omitempty"` // e.g. aws; optional prefill
	CreatedAt     time.Time `json:"created_at"`
	CreatedBy     *int      `json:"created_by"`
}

// TeamMember links a user to a team. For portal teams: role is developer | senior_developer | lead | manager. For devops: member | lead.
type TeamMember struct {
	ID        int       `json:"id"`
	TeamID    int       `json:"team_id"`
	UserID    int       `json:"user_id"`
	Role      string    `json:"role"` // developer, senior_developer, lead, manager (portal) | member, lead (devops)
	CreatedAt time.Time `json:"created_at"`
}

// OutboundWebhook is admin-configured URL to POST on request state change
type OutboundWebhook struct {
	ID        int       `json:"id"`
	URL       string    `json:"url"`
	Secret    string    `json:"-"`      // never returned in list
	Events    string    `json:"events"` // comma-separated: approved, pr_created, rejected, assigned
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetOutboundWebhooks returns all webhooks (for admin list)
func GetOutboundWebhooks() ([]OutboundWebhook, error) {
	rows, err := DB.Query(`SELECT id, url, COALESCE(secret,''), events, enabled, created_at, updated_at FROM outbound_webhooks ORDER BY id`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []OutboundWebhook{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	var out []OutboundWebhook
	for rows.Next() {
		var w OutboundWebhook
		if err := rows.Scan(&w.ID, &w.URL, &w.Secret, &w.Events, &w.Enabled, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, nil
}

// GetEnabledOutboundWebhooksForEvent returns webhooks that are enabled and subscribe to the event
func GetEnabledOutboundWebhooksForEvent(event string) ([]OutboundWebhook, error) {
	rows, err := DB.Query(`SELECT id, url, COALESCE(secret,''), events FROM outbound_webhooks WHERE enabled = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutboundWebhook
	for rows.Next() {
		var w OutboundWebhook
		if err := rows.Scan(&w.ID, &w.URL, &w.Secret, &w.Events); err != nil {
			return nil, err
		}
		for _, e := range strings.Split(w.Events, ",") {
			if strings.TrimSpace(e) == event {
				out = append(out, w)
				break
			}
		}
	}
	return out, nil
}

// CreateOutboundWebhook inserts a new webhook
func CreateOutboundWebhook(url, secret, events string) (*OutboundWebhook, error) {
	if events == "" {
		events = "approved,pr_created,rejected"
	}
	var w OutboundWebhook
	err := DB.QueryRow(
		`INSERT INTO outbound_webhooks (url, secret, events) VALUES ($1, $2, $3)
		 RETURNING id, url, events, enabled, created_at, updated_at`,
		strings.TrimSpace(url), strings.TrimSpace(secret), strings.TrimSpace(events),
	).Scan(&w.ID, &w.URL, &w.Events, &w.Enabled, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// UpdateOutboundWebhook updates url, secret, events, enabled
func UpdateOutboundWebhook(id int, url, secret, events string, enabled bool) error {
	if secret == "" {
		_, err := DB.Exec(
			`UPDATE outbound_webhooks SET url = $1, events = $2, enabled = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
			strings.TrimSpace(url), strings.TrimSpace(events), enabled, id,
		)
		return err
	}
	_, err := DB.Exec(
		`UPDATE outbound_webhooks SET url = $1, secret = $2, events = $3, enabled = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
		strings.TrimSpace(url), strings.TrimSpace(secret), strings.TrimSpace(events), enabled, id,
	)
	return err
}

// DeleteOutboundWebhook removes a webhook
func DeleteOutboundWebhook(id int) error {
	_, err := DB.Exec("DELETE FROM outbound_webhooks WHERE id = $1", id)
	return err
}

// APIKey is a scoped, revocable key for automation (create request, get history without browser login).
const APIKeyPrefix = "ip_"

type APIKeyRecord struct {
	ID         int        `json:"id"`
	UserID     int        `json:"user_id"`
	Name       string     `json:"name"`
	KeyHash    string     `json:"-"` // never returned
	Scopes     string     `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// RequestTemplate is an admin-defined preset (e.g. "AWS prod EKS")
type RequestTemplate struct {
	ID           int              `json:"id"`
	Name         string           `json:"name"`
	Description  string           `json:"description"`
	Cloud        string           `json:"cloud"`
	Env          string           `json:"env"`
	Service      string           `json:"service"`
	Config       string           `json:"config"`
	CreatedBy    *int             `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	Teams        []Team           `json:"teams,omitempty"`
	Projects     []ProjectSummary `json:"projects,omitempty"`
	VisibleToAll bool             `json:"visible_to_all"`
}

// UserSavedConfig is a user's saved/favorite configuration
type UserSavedConfig struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	Name      string    `json:"name"`
	Config    string    `json:"config"`
	Cloud     string    `json:"cloud"`
	Env       string    `json:"env"`
	Service   string    `json:"service"`
	CreatedAt time.Time `json:"created_at"`
}

// InitDB initializes the PostgreSQL database connection
func InitDB() error {
	dsn, redactedDSN, err := buildDatabaseDSN()
	if err != nil {
		return fmt.Errorf("database configuration invalid: %w", err)
	}

	DB, err = sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	pingTimeout := time.Duration(getEnvIntOrDefault("DB_PING_TIMEOUT_SECONDS", defaultDBPingTimeoutSeconds)) * time.Second
	pingCtx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()
	if err := DB.PingContext(pingCtx); err != nil {
		_ = DB.Close()
		DB = nil
		return fmt.Errorf("failed to ping database: %w", err)
	}

	DB.SetMaxOpenConns(getEnvIntOrDefault("DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns))
	DB.SetMaxIdleConns(getEnvIntOrDefault("DB_MAX_IDLE_CONNS", defaultDBMaxIdleConns))
	DB.SetConnMaxLifetime(time.Duration(getEnvIntOrDefault("DB_CONN_MAX_LIFETIME_MINUTES", defaultDBConnMaxLifetimeMins)) * time.Minute)
	DB.SetConnMaxIdleTime(time.Duration(getEnvIntOrDefault("DB_CONN_MAX_IDLE_TIME_MINUTES", defaultDBConnMaxIdleMins)) * time.Minute)

	log.Printf("Database connection established (%s)", redactedDSN)

	// Create tables
	if err := createTables(); err != nil {
		_ = DB.Close()
		DB = nil
		return fmt.Errorf("failed to create tables: %w", err)
	}

	return nil
}

// createTables creates the necessary database tables
func createTables() error {
	// Users table
	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		username VARCHAR(100) UNIQUE NOT NULL,
		email VARCHAR(255) UNIQUE NOT NULL,
		password VARCHAR(255) NOT NULL,
		verified BOOLEAN DEFAULT FALSE,
		verification_token VARCHAR(255),
		verification_token_expires_at TIMESTAMP,
		role VARCHAR(50) DEFAULT 'viewer',
		user_type VARCHAR(50) DEFAULT 'portal_user',
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`

	// PR requests table
	prRequestsTable := `
	CREATE TABLE IF NOT EXISTS pr_requests (
		id SERIAL PRIMARY KEY,
		team VARCHAR(100) NOT NULL,
		env VARCHAR(50) NOT NULL,
		cloud VARCHAR(50) NOT NULL,
		service VARCHAR(100) NOT NULL,
		pr_url TEXT NOT NULL,
		branch VARCHAR(255) NOT NULL,
		file_path TEXT NOT NULL,
		status VARCHAR(50) DEFAULT 'pending',
		config TEXT NOT NULL,
		created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`

	// GitHub logs table (for activity stream)
	githubLogsTable := `
	CREATE TABLE IF NOT EXISTS github_logs (
		id SERIAL PRIMARY KEY,
		event_type VARCHAR(100) NOT NULL,
		message TEXT NOT NULL,
		details TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`

	// Admin: teams table (for admin frontend - teams/groups)
	teamsTable := `
	CREATE TABLE IF NOT EXISTS teams (
		id SERIAL PRIMARY KEY,
		name VARCHAR(200) NOT NULL,
		slug VARCHAR(100) UNIQUE NOT NULL,
		application_id VARCHAR(12) UNIQUE,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
	);`

	// Admin: team_members table
	teamMembersTable := `
	CREATE TABLE IF NOT EXISTS team_members (
		id SERIAL PRIMARY KEY,
		team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		role VARCHAR(50) DEFAULT 'member',
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(team_id, user_id)
	);`

	// Create indexes
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_team ON pr_requests(team);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_env ON pr_requests(env);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_cloud ON pr_requests(cloud);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_created_by ON pr_requests(created_by);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_created_at ON pr_requests(created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_github_logs_created_at ON github_logs(created_at DESC);",
		"CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug);",
		"CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);",
		"CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);",
	}

	if _, err := DB.Exec(usersTable); err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	if _, err := DB.Exec(prRequestsTable); err != nil {
		return fmt.Errorf("failed to create pr_requests table: %w", err)
	}

	if _, err := DB.Exec(githubLogsTable); err != nil {
		return fmt.Errorf("failed to create github_logs table: %w", err)
	}
	if _, err := DB.Exec(teamsTable); err != nil {
		return fmt.Errorf("failed to create teams table: %w", err)
	}
	if _, err := DB.Exec(teamMembersTable); err != nil {
		return fmt.Errorf("failed to create team_members table: %w", err)
	}

	for _, index := range indexes {
		if _, err := DB.Exec(index); err != nil {
			log.Printf("Warning: failed to create index: %v", err)
		}
	}

	// Migration: add client_name to pr_requests if not present
	if _, err := DB.Exec("ALTER TABLE pr_requests ADD COLUMN client_name VARCHAR(255) DEFAULT ''"); err != nil {
		if !strings.Contains(err.Error(), "already exists") && !strings.Contains(err.Error(), "duplicate column") {
			log.Printf("Note: pr_requests client_name column: %v", err)
		}
	}
	if _, err := DB.Exec("ALTER TABLE pr_requests ADD COLUMN priority VARCHAR(50) DEFAULT 'medium'"); err != nil {
		if !strings.Contains(err.Error(), "already exists") && !strings.Contains(err.Error(), "duplicate column") {
			log.Printf("Note: pr_requests priority column: %v", err)
		}
	}
	if _, err := DB.Exec("ALTER TABLE pr_requests ADD COLUMN due_date TIMESTAMP NULL"); err != nil {
		if !strings.Contains(err.Error(), "already exists") && !strings.Contains(err.Error(), "duplicate column") {
			log.Printf("Note: pr_requests due_date column: %v", err)
		}
	}
	if _, err := DB.Exec("ALTER TABLE pr_requests ADD COLUMN reject_reason TEXT DEFAULT ''"); err != nil {
		if !strings.Contains(err.Error(), "already exists") && !strings.Contains(err.Error(), "duplicate column") {
			log.Printf("Note: pr_requests reject_reason column: %v", err)
		}
	}

	// request_comments: comments on requests (user and admin)
	_, errComments := DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_comments (
			id SERIAL PRIMARY KEY,
			request_id INTEGER NOT NULL REFERENCES pr_requests(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id),
			body TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if errComments != nil {
		return fmt.Errorf("create request_comments: %w", errComments)
	}

	// admin_audit_log: log admin actions for accountability
	_, errAudit := DB.Exec(`
		CREATE TABLE IF NOT EXISTS admin_audit_log (
			id SERIAL PRIMARY KEY,
			admin_user_id INTEGER REFERENCES users(id),
			action VARCHAR(100) NOT NULL,
			resource_type VARCHAR(50) NOT NULL,
			resource_id VARCHAR(50),
			details TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if errAudit != nil {
		return fmt.Errorf("create admin_audit_log: %w", errAudit)
	}

	// credential_audit_log: who created AWS access keys, GCP service account keys, etc. (via approved requests)
	_, errCredAudit := DB.Exec(`
		CREATE TABLE IF NOT EXISTS credential_audit_log (
			id SERIAL PRIMARY KEY,
			request_id INTEGER REFERENCES pr_requests(id) ON DELETE SET NULL,
			cloud VARCHAR(20) NOT NULL,
			credential_type VARCHAR(100) NOT NULL,
			team VARCHAR(255) DEFAULT '',
			env VARCHAR(100) DEFAULT '',
			created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if errCredAudit != nil {
		return fmt.Errorf("create credential_audit_log: %w", errCredAudit)
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_credential_audit_request_id ON credential_audit_log(request_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_credential_audit_created_at ON credential_audit_log(created_at DESC)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_credential_audit_cloud ON credential_audit_log(cloud)")

	// user_activity: log user actions (create, submit, comment, etc.) for admin activity feed
	_, errUserActivity := DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_activity (
			id SERIAL PRIMARY KEY,
			user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			action VARCHAR(100) NOT NULL,
			resource_type VARCHAR(50) NOT NULL,
			resource_id VARCHAR(50),
			details TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if errUserActivity != nil {
		return fmt.Errorf("create user_activity: %w", errUserActivity)
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC)")

	log.Println("Database tables created/verified")
	return nil
}

// SavePRRequest saves a PR request to the database (pr_url may be "" for pending_approval or draft)
func SavePRRequest(req *PRRequest) error {
	query := `
		INSERT INTO pr_requests (project_id, team, env, cloud, service, client_name, application_id, priority, due_date, pr_url, branch, file_path, status, config, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING id, created_at, updated_at
	`
	err := queryRowContext(
		query,
		req.ProjectID, req.Team, req.Env, req.Cloud, req.Service, req.ClientName,
		req.ApplicationID, req.Priority, req.DueDate, req.PRURL, req.Branch, req.FilePath, req.Status,
		req.Config, req.CreatedBy,
	).Scan(&req.ID, &req.CreatedAt, &req.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to save PR request: %w", err)
	}
	_ = SaveRequestConfigHistory(req.ID, req.Config, "initial")
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	refreshRequestSummaryViewAsync()
	return nil
}

// UpdatePRRequestStatus sets status and updated_at for a request
func UpdatePRRequestStatus(id int, status string) error {
	_, err := execContext(
		"UPDATE pr_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		status, id,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
		refreshRequestSummaryViewAsync()
	}
	return err
}

// UpdatePRRequestReject sets status to rejected and optional reject_reason
func UpdatePRRequestReject(id int, reason string) error {
	_, err := execContext(
		"UPDATE pr_requests SET status = 'rejected', reject_reason = COALESCE(NULLIF(TRIM($1),''), reject_reason), updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		reason, id,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
		refreshRequestSummaryViewAsync()
	}
	return err
}

// UpdatePRRequestWithPR sets pr_url and status to in_progress after PR is created
func UpdatePRRequestWithPR(id int, prURL string) error {
	_, err := execContext(
		"UPDATE pr_requests SET pr_url = $1, status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		prURL, id,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
		refreshRequestSummaryViewAsync()
	}
	return err
}

// UpdatePRRequestAssignedTo sets assigned_to for a request (used after PR creation)
func UpdatePRRequestAssignedTo(requestID, userID int) error {
	_, err := execContext(
		"UPDATE pr_requests SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		userID, requestID,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
		refreshRequestSummaryViewAsync()
	}
	return err
}

// PriorityToLevel maps request priority to DevOps level for assignment (Critical->L4, High->L3, Medium->L2, Low->L1)
func PriorityToLevel(priority string) string {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "critical":
		return "L4"
	case "high":
		return "L3"
	case "medium":
		return "L2"
	case "low":
		return "L1"
	default:
		return "L2"
	}
}

// AssignRequestByPriority assigns the request to a DevOps user by priority (L4 for critical, L3 high, L2 medium, L1 low). Picks a non-manager devops user with that level (least assigned first).
func AssignRequestByPriority(requestID int) error {
	req, err := GetPRRequestByID(requestID)
	if err != nil || req == nil {
		return fmt.Errorf("request not found")
	}
	level := PriorityToLevel(req.Priority)
	var assigneeID int
	// Pick a devops user with this level (is_manager = false), order by fewest assigned tickets
	err = DB.QueryRow(`
		SELECT u.id FROM users u
		INNER JOIN devops_profiles d ON d.user_id = u.id AND d.level = $1 AND COALESCE(d.is_manager, false) = false
		WHERE COALESCE(u.user_type, 'portal_user') = 'devops_user'
		ORDER BY (SELECT COUNT(*) FROM pr_requests p WHERE p.assigned_to = u.id) ASC
		LIMIT 1
	`, level).Scan(&assigneeID)
	if err == sql.ErrNoRows || err != nil {
		return nil // no assignee found, leave unassigned
	}
	return UpdatePRRequestAssignedTo(requestID, assigneeID)
}

// AppendGitHubLog writes a GitHub activity log entry (no-op if DB is nil)
func AppendGitHubLog(eventType, message, details string) {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(
		"INSERT INTO github_logs (event_type, message, details) VALUES ($1, $2, $3)",
		eventType, message, details,
	)
}

// GitHubLogEntry is a single GitHub activity log row
type GitHubLogEntry struct {
	ID        int       `json:"id"`
	EventType string    `json:"event_type"`
	Message   string    `json:"message"`
	Details   string    `json:"details"`
	CreatedAt time.Time `json:"created_at"`
}

// GetGitHubLogs returns recent GitHub log entries, newest first
func GetGitHubLogs(limit int) ([]GitHubLogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := DB.Query(
		"SELECT id, event_type, message, COALESCE(details,''), created_at FROM github_logs ORDER BY created_at DESC LIMIT $1",
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GitHubLogEntry
	for rows.Next() {
		var e GitHubLogEntry
		if err := rows.Scan(&e.ID, &e.EventType, &e.Message, &e.Details, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

// UserNotification is a single in-app notification row
type UserNotification struct {
	ID          int        `json:"id"`
	UserID      int        `json:"user_id"`
	RequestID   *int       `json:"request_id"`
	ProjectID   *int       `json:"project_id,omitempty"`
	ProjectName string     `json:"project_name,omitempty"`
	ProjectCode string     `json:"project_code,omitempty"`
	Kind        string     `json:"kind"`
	Message     string     `json:"message"`
	ReadAt      *time.Time `json:"read_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// InsertUserNotification creates an in-app notification for a user
func InsertUserNotification(userID int, requestID *int, kind, message string) error {
	if DB == nil {
		return nil
	}
	_, err := execContext(
		"INSERT INTO user_notifications (user_id, request_id, kind, message) VALUES ($1, $2, $3, $4)",
		userID, requestID, kind, message,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceNotify)
	}
	return err
}

// ListUserNotifications returns notifications for a user, newest first
func ListUserNotifications(userID int, limit, offset int, unreadOnly bool) ([]UserNotification, error) {
	return ListUserNotificationsFiltered(userID, limit, offset, unreadOnly, "")
}

// ListUserNotificationsFiltered returns notifications for a user, optionally filtered by kind.
func ListUserNotificationsFiltered(userID int, limit, offset int, unreadOnly bool, kind string) ([]UserNotification, error) {
	if DB == nil {
		return nil, nil
	}
	q := `
		SELECT n.id, n.user_id, n.request_id,
		       r.project_id, COALESCE(p.name,''), COALESCE(p.code,''),
		       n.kind, n.message, n.read_at, n.created_at
		FROM user_notifications n
		LEFT JOIN pr_requests r ON r.id = n.request_id
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE n.user_id = $1
	`
	args := []interface{}{userID}
	argPos := 2
	if strings.TrimSpace(kind) != "" {
		q += fmt.Sprintf(" AND n.kind = $%d", argPos)
		args = append(args, strings.TrimSpace(kind))
		argPos++
	}
	if unreadOnly {
		q += " AND n.read_at IS NULL"
	}
	q += " ORDER BY n.created_at DESC"
	if limit > 0 {
		q += fmt.Sprintf(" LIMIT $%d", argPos)
		args = append(args, limit)
		argPos++
	}
	if offset > 0 {
		q += fmt.Sprintf(" OFFSET $%d", argPos)
		args = append(args, offset)
		argPos++
	}
	rows, err := DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserNotification
	for rows.Next() {
		var n UserNotification
		var reqID, projectID sql.NullInt64
		var readAt sql.NullTime
		if err := rows.Scan(&n.ID, &n.UserID, &reqID, &projectID, &n.ProjectName, &n.ProjectCode, &n.Kind, &n.Message, &readAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		if reqID.Valid {
			v := int(reqID.Int64)
			n.RequestID = &v
		}
		if projectID.Valid {
			v := int(projectID.Int64)
			n.ProjectID = &v
		}
		if readAt.Valid {
			n.ReadAt = &readAt.Time
		}
		out = append(out, n)
	}
	return out, nil
}

// CountUserNotifications returns the count of notifications for a user, optionally filtered by kind and unread state.
func CountUserNotifications(userID int, unreadOnly bool, kind string) (int, error) {
	if DB == nil {
		return 0, nil
	}
	return cacheJSON[int](cacheNamespaceNotify, 30*time.Second, []string{strconv.Itoa(userID), strconv.FormatBool(unreadOnly), strings.TrimSpace(kind)}, func() (int, error) {
		q := "SELECT COUNT(*) FROM user_notifications WHERE user_id = $1"
		args := []interface{}{userID}
		argPos := 2
		if strings.TrimSpace(kind) != "" {
			q += fmt.Sprintf(" AND kind = $%d", argPos)
			args = append(args, strings.TrimSpace(kind))
			argPos++
		}
		if unreadOnly {
			q += " AND read_at IS NULL"
		}
		var count int
		if err := queryRowContext(q, args...).Scan(&count); err != nil {
			return 0, err
		}
		return count, nil
	})
}

// CountUserNotificationsByKind returns counts per kind and overall totals for a user.
func CountUserNotificationsByKind(userID int) (map[string]int, error) {
	if DB == nil {
		return map[string]int{}, nil
	}
	return cacheJSON[map[string]int](cacheNamespaceNotify, 30*time.Second, []string{strconv.Itoa(userID), "by_kind"}, func() (map[string]int, error) {
		rows, cancel, err := queryRowsWithTimeout(`SELECT kind, COUNT(*) FROM user_notifications WHERE user_id = $1 GROUP BY kind`, userID)
		if err != nil {
			return nil, err
		}
		defer cancel()
		defer rows.Close()
		out := map[string]int{}
		total := 0
		for rows.Next() {
			var kind string
			var count int
			if err := rows.Scan(&kind, &count); err != nil {
				return nil, err
			}
			out[kind] = count
			total += count
		}
		out["all"] = total
		return out, nil
	})
}

// UserNotificationPreferences holds email on/off per notification type
type UserNotificationPreferences struct {
	UserID         int  `json:"user_id"`
	EmailApproved  bool `json:"email_approved"`
	EmailRejected  bool `json:"email_rejected"`
	EmailPRCreated bool `json:"email_pr_created"`
	EmailAssigned  bool `json:"email_assigned"`
	EmailSLABreach bool `json:"email_sla_breach"`
}

// GetUserNotificationPreferences returns preferences for a user (defaults to true if not set)
func GetUserNotificationPreferences(userID int) (*UserNotificationPreferences, error) {
	if DB == nil {
		return nil, nil
	}
	var p UserNotificationPreferences
	err := DB.QueryRow(
		`SELECT user_id, COALESCE(email_approved, true), COALESCE(email_rejected, true), COALESCE(email_pr_created, true), COALESCE(email_assigned, true), COALESCE(email_sla_breach, true)
		 FROM user_notification_preferences WHERE user_id = $1`,
		userID,
	).Scan(&p.UserID, &p.EmailApproved, &p.EmailRejected, &p.EmailPRCreated, &p.EmailAssigned, &p.EmailSLABreach)
	if err == sql.ErrNoRows {
		return &UserNotificationPreferences{UserID: userID, EmailApproved: true, EmailRejected: true, EmailPRCreated: true, EmailAssigned: true, EmailSLABreach: true}, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdateUserNotificationPreferences upserts notification preferences
func UpdateUserNotificationPreferences(p *UserNotificationPreferences) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(
		`INSERT INTO user_notification_preferences (user_id, email_approved, email_rejected, email_pr_created, email_assigned, email_sla_breach, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
		 ON CONFLICT (user_id) DO UPDATE SET
		   email_approved = EXCLUDED.email_approved,
		   email_rejected = EXCLUDED.email_rejected,
		   email_pr_created = EXCLUDED.email_pr_created,
		   email_assigned = EXCLUDED.email_assigned,
		   email_sla_breach = EXCLUDED.email_sla_breach,
		   updated_at = CURRENT_TIMESTAMP`,
		p.UserID, p.EmailApproved, p.EmailRejected, p.EmailPRCreated, p.EmailAssigned, p.EmailSLABreach,
	)
	return err
}

// AddRequestDependency adds a dependency: request_id depends on depends_on_request_id
func AddRequestDependency(requestID, dependsOnRequestID int) error {
	if DB == nil {
		return nil
	}
	if requestID == dependsOnRequestID {
		return fmt.Errorf("request cannot depend on itself")
	}
	_, err := DB.Exec(
		"INSERT INTO request_dependencies (request_id, depends_on_request_id) VALUES ($1, $2) ON CONFLICT (request_id, depends_on_request_id) DO NOTHING",
		requestID, dependsOnRequestID,
	)
	return err
}

// RemoveRequestDependency removes a dependency
func RemoveRequestDependency(requestID, dependsOnRequestID int) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(
		"DELETE FROM request_dependencies WHERE request_id = $1 AND depends_on_request_id = $2",
		requestID, dependsOnRequestID,
	)
	return err
}

// GetRequestDependencies returns request IDs that this request depends on
func GetRequestDependencies(requestID int) ([]int, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query("SELECT depends_on_request_id FROM request_dependencies WHERE request_id = $1 ORDER BY depends_on_request_id", requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

// GetRequestsThatDependOn returns request IDs that depend on this request
func GetRequestsThatDependOn(requestID int) ([]int, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query("SELECT request_id FROM request_dependencies WHERE depends_on_request_id = $1 ORDER BY request_id", requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

// BlockedByItem holds id and status for requests that depend on another
type BlockedByItem struct {
	ID     int    `json:"id"`
	Status string `json:"status"`
}

// GetBlockedByWithStatus returns requests that depend on this one, with their status (for dependency warning on approve)
func GetBlockedByWithStatus(requestID int) ([]BlockedByItem, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT p.id, COALESCE(p.status,'') FROM pr_requests p
		INNER JOIN request_dependencies rd ON rd.request_id = p.id AND rd.depends_on_request_id = $1
		ORDER BY p.id
	`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BlockedByItem
	for rows.Next() {
		var item BlockedByItem
		if err := rows.Scan(&item.ID, &item.Status); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

// UserWantsEmailForKind returns true if user has not disabled email for this notification kind
func UserWantsEmailForKind(userID int, kind string) bool {
	prefs, err := GetUserNotificationPreferences(userID)
	if err != nil || prefs == nil {
		return true
	}
	switch kind {
	case "approved":
		return prefs.EmailApproved
	case "rejected":
		return prefs.EmailRejected
	case "pr_created":
		return prefs.EmailPRCreated
	case "assigned":
		return prefs.EmailAssigned
	case "sla_breach":
		return prefs.EmailSLABreach
	default:
		return true
	}
}

// MarkUserNotificationsRead marks notifications as read (ids empty = mark all for user)
func MarkUserNotificationsRead(userID int, ids []int) error {
	if DB == nil {
		return nil
	}
	if len(ids) == 0 {
		_, err := execContext("UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL", userID)
		if err == nil {
			invalidateCacheNamespaces(cacheNamespaceNotify)
		}
		return err
	}
	placeholders := make([]string, len(ids))
	args := []interface{}{userID}
	for i := range ids {
		args = append(args, ids[i])
		placeholders[i] = fmt.Sprintf("$%d", len(args))
	}
	_, err := execContext("UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND id IN ("+strings.Join(placeholders, ",")+")", args...)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceNotify)
	}
	return err
}

// GetPortalTeamMemberUserIDs returns user IDs of all members in portal team(s) where the given user has role=manager (for "manager sees all group tickets").
func GetPortalTeamMemberUserIDs(managerUserID int) ([]int, error) {
	rows, err := DB.Query(`
		SELECT DISTINCT m1.user_id FROM team_members m1
		INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal'
		INNER JOIN team_members m2 ON m2.team_id = t.id AND m2.role = 'manager' AND m2.user_id = $1
		WHERE m1.user_id != $1
		UNION
		SELECT $1
	`, managerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetReporteeUserIDs returns user IDs of users who have manager_id = managerUserID (direct reportees).
func GetReporteeUserIDs(managerUserID int) ([]int, error) {
	rows, err := DB.Query(`SELECT id FROM users WHERE manager_id = $1`, managerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetPortalTeamMemberUserIDsForPortalManager returns all user IDs in any portal team that the given user is a member of (any role). Used when user has is_portal_manager so they see all tickets from their team groups.
func GetPortalTeamMemberUserIDsForPortalManager(userID int) ([]int, error) {
	rows, err := DB.Query(`
		SELECT DISTINCT m2.user_id FROM team_members m1
		INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal'
		INNER JOIN team_members m2 ON m2.team_id = t.id
		WHERE m1.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetTeamMemberUserIDsForManager returns all user IDs the manager should see in "Group tickets": portal team members (where user has role=manager) + direct reportees (manager_id) + if user has is_portal_manager, all members of any portal team they belong to. Includes manager themselves.
func GetTeamMemberUserIDsForManager(managerUserID int) ([]int, error) {
	seen := make(map[int]bool)
	seen[managerUserID] = true
	portal, _ := GetPortalTeamMemberUserIDs(managerUserID)
	for _, id := range portal {
		seen[id] = true
	}
	reportees, _ := GetReporteeUserIDs(managerUserID)
	for _, id := range reportees {
		seen[id] = true
	}
	// If user is designated as portal manager (is_portal_manager), include all members of every portal team they belong to
	u, _ := GetUserByID(managerUserID)
	if u != nil && u.IsPortalManager {
		portalAny, _ := GetPortalTeamMemberUserIDsForPortalManager(managerUserID)
		for _, id := range portalAny {
			seen[id] = true
		}
	}
	out := make([]int, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	return out, nil
}

// GetUsernamesByUserIDs returns a map of user_id -> username for the given IDs (for "Raised by" in history).
func GetUsernamesByUserIDs(userIDs []int) (map[int]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	seen := make(map[int]bool)
	var unique []int
	for _, id := range userIDs {
		if id > 0 && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(unique))
	args := make([]interface{}, len(unique))
	for i, id := range unique {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf("SELECT id, username FROM users WHERE id IN (%s)", strings.Join(placeholders, ","))
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int]string)
	for rows.Next() {
		var id int
		var username string
		if err := rows.Scan(&id, &username); err != nil {
			continue
		}
		out[id] = username
	}
	return out, nil
}

// GetPRRequestsForHistory is like GetPRRequests but adds fromDate, toDate, applicationID for user history.
func GetPRRequestsForHistory(team, env, cloud string, projectID int, statusFilter, search string, prID int, applicationID, fromDate, toDate string, userIDInt int, createdByIn []int, limit, offset int) ([]PRRequest, error) {
	s := search
	if applicationID != "" {
		if s != "" {
			s = s + " " + applicationID
		} else {
			s = applicationID
		}
	}
	return GetPRRequests(team, env, cloud, projectID, statusFilter, "", s, prID, userIDInt, createdByIn, limit, offset, "created_at", "desc", false, fromDate, toDate)
}

// GetTotalCountForHistory is like GetTotalCount but for history filters.
func GetTotalCountForHistory(team, env, cloud string, projectID int, statusFilter, search string, prID int, applicationID, fromDate, toDate string, userIDInt int, createdByIn []int) (int, error) {
	s := search
	if applicationID != "" {
		if s != "" {
			s = s + " " + applicationID
		} else {
			s = applicationID
		}
	}
	return GetTotalCount(team, env, cloud, projectID, statusFilter, "", s, prID, userIDInt, createdByIn, false, fromDate, toDate)
}

// GetPRRequests retrieves PR requests with optional filters. fromDate, toDate: YYYY-MM-DD for created_at range.
func GetPRRequests(team, env, cloud string, projectID int, statusFilter, priorityFilter, search string, prID int, userIDInt int, createdByIn []int, limit, offset int, sortBy, sortOrder string, atRiskOnly bool, fromDate, toDate string) ([]PRRequest, error) {
	query := `
		SELECT r.id, r.team, r.env, r.cloud, r.service, COALESCE(r.client_name,'') AS client_name, COALESCE(r.application_id,'') AS application_id,
		       COALESCE(r.priority,'medium') AS priority, r.due_date, r.pr_url, r.branch, r.file_path, r.status,
		       COALESCE(r.reject_reason,'') AS reject_reason, r.config, r.created_by, r.assigned_to, r.created_at, r.updated_at,
		       r.project_id, COALESCE(p.name,''), COALESCE(p.code,'')
		FROM pr_requests r
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

	if search != "" {
		searchVal := "%" + search + "%"
		query += fmt.Sprintf(` AND (r.team ILIKE $%d OR r.env ILIKE $%d OR r.cloud ILIKE $%d OR r.service ILIKE $%d OR COALESCE(r.client_name,'') ILIKE $%d OR COALESCE(r.application_id,'') ILIKE $%d OR r.branch ILIKE $%d OR COALESCE(r.config,'')::text ILIKE $%d OR COALESCE(p.name,'') ILIKE $%d OR COALESCE(p.code,'') ILIKE $%d)`,
			argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos)
		args = append(args, searchVal)
		argPos++
	}

	if prID > 0 {
		query += fmt.Sprintf(" AND r.id = $%d", argPos)
		args = append(args, prID)
		argPos++
	}

	if team != "" {
		query += fmt.Sprintf(" AND r.team ILIKE $%d", argPos)
		args = append(args, "%"+team+"%")
		argPos++
	}

	if env != "" {
		query += fmt.Sprintf(" AND r.env ILIKE $%d", argPos)
		args = append(args, "%"+env+"%")
		argPos++
	}

	if cloud != "" {
		query += fmt.Sprintf(" AND r.cloud ILIKE $%d", argPos)
		args = append(args, "%"+cloud+"%")
		argPos++
	}

	if projectID > 0 {
		query += fmt.Sprintf(" AND r.project_id = $%d", argPos)
		args = append(args, projectID)
		argPos++
	}

	if statusFilter != "" {
		if statusFilter == "pending_any" {
			query += " AND r.status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')"
		} else {
			query += fmt.Sprintf(" AND r.status = $%d", argPos)
			args = append(args, statusFilter)
			argPos++
		}
	}

	if priorityFilter != "" {
		query += fmt.Sprintf(" AND COALESCE(r.priority,'medium') = $%d", argPos)
		args = append(args, priorityFilter)
		argPos++
	}

	if len(createdByIn) > 0 {
		placeholders := make([]string, len(createdByIn))
		for i := range createdByIn {
			placeholders[i] = fmt.Sprintf("$%d", argPos)
			args = append(args, createdByIn[i])
			argPos++
		}
		query += " AND r.created_by IN (" + strings.Join(placeholders, ",") + ")"
	} else if userIDInt > 0 {
		query += fmt.Sprintf(" AND r.created_by = $%d", argPos)
		args = append(args, userIDInt)
		argPos++
	}
	if atRiskOnly {
		query += " AND r.due_date IS NOT NULL AND (r.due_date < NOW() OR r.due_date < NOW() + INTERVAL '24 hours')"
	}
	if fromDate != "" {
		query += fmt.Sprintf(" AND r.created_at >= $%d::date", argPos)
		args = append(args, fromDate)
		argPos++
	}
	if toDate != "" {
		query += fmt.Sprintf(" AND r.created_at < ($%d::date + interval '1 day')", argPos)
		args = append(args, toDate)
		argPos++
	}
	orderCol := "created_at"
	switch sortBy {
	case "updated_at":
		orderCol = "r.updated_at"
	case "priority":
		orderCol = "COALESCE(r.priority,'medium')"
	case "due_date":
		orderCol = "r.due_date"
	default:
		orderCol = "r.created_at"
	}
	orderDir := "DESC"
	if strings.ToLower(sortOrder) == "asc" {
		orderDir = "ASC"
	}
	if orderCol == "due_date" {
		query += " ORDER BY due_date NULLS LAST " + orderDir
	} else {
		query += " ORDER BY " + orderCol + " " + orderDir
	}

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", argPos)
		args = append(args, limit)
		argPos++
	}

	if offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", argPos)
		args = append(args, offset)
		argPos++
	}

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query PR requests: %w", err)
	}
	defer rows.Close()

	var requests []PRRequest
	for rows.Next() {
		var req PRRequest
		var createdBy, assignedTo, projectID sql.NullInt64
		var dueDate sql.NullTime
		err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt, &projectID, &req.ProjectName, &req.ProjectCode,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan PR request: %w", err)
		}
		if createdBy.Valid {
			val := int(createdBy.Int64)
			req.CreatedBy = &val
		} else {
			req.CreatedBy = nil
		}
		if assignedTo.Valid && assignedTo.Int64 > 0 {
			val := int(assignedTo.Int64)
			req.AssignedTo = &val
		} else {
			req.AssignedTo = nil
		}
		if projectID.Valid && projectID.Int64 > 0 {
			val := int(projectID.Int64)
			req.ProjectID = &val
		}
		if dueDate.Valid {
			req.DueDate = &dueDate.Time
		}
		requests = append(requests, req)
	}

	return requests, nil
}

// GetPRRequestByApplicationID retrieves a request by application_id (most recent if multiple)
func GetPRRequestByApplicationID(appID string) *PRRequest {
	if appID == "" || DB == nil {
		return nil
	}
	query := `
		SELECT r.id, r.team, r.env, r.cloud, r.service, COALESCE(r.client_name,'') AS client_name, COALESCE(r.application_id,'') AS application_id,
		       COALESCE(r.priority,'medium') AS priority, r.due_date, r.pr_url, r.branch, r.file_path, r.status,
		       COALESCE(r.reject_reason,'') AS reject_reason, r.config, r.created_by, r.assigned_to, r.created_at, r.updated_at,
		       COALESCE(r.terraform_plan_output,'') AS terraform_plan_output, r.project_id, COALESCE(p.name,''), COALESCE(p.code,'')
		FROM pr_requests r
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE r.application_id = $1 ORDER BY r.created_at DESC LIMIT 1
	`
	var r PRRequest
	var createdBy, assignedTo, projectID sql.NullInt64
	var dueDate sql.NullTime
	err := DB.QueryRow(query, appID).Scan(
		&r.ID, &r.Team, &r.Env, &r.Cloud, &r.Service, &r.ClientName,
		&r.ApplicationID, &r.Priority, &dueDate, &r.PRURL, &r.Branch, &r.FilePath, &r.Status,
		&r.RejectReason, &r.Config, &createdBy, &assignedTo, &r.CreatedAt, &r.UpdatedAt, &r.TerraformPlanOutput, &projectID, &r.ProjectName, &r.ProjectCode,
	)
	if err != nil || r.ID == 0 {
		return nil
	}
	if createdBy.Valid {
		val := int(createdBy.Int64)
		r.CreatedBy = &val
	}
	if assignedTo.Valid && assignedTo.Int64 > 0 {
		val := int(assignedTo.Int64)
		r.AssignedTo = &val
	}
	if projectID.Valid && projectID.Int64 > 0 {
		val := int(projectID.Int64)
		r.ProjectID = &val
	}
	if dueDate.Valid {
		r.DueDate = &dueDate.Time
	}
	return &r
}

// GetPRRequestByID retrieves a single PR request by ID
func GetPRRequestByID(id int) (*PRRequest, error) {
	query := `
		SELECT r.id, r.team, r.env, r.cloud, r.service, COALESCE(r.client_name,'') AS client_name, COALESCE(r.application_id,'') AS application_id,
		       COALESCE(r.priority,'medium') AS priority, r.due_date, r.pr_url, r.branch, r.file_path, r.status,
		       COALESCE(r.reject_reason,'') AS reject_reason, r.config, r.created_by, r.assigned_to, r.created_at, r.updated_at,
		       COALESCE(r.terraform_plan_output,'') AS terraform_plan_output, COALESCE(r.jira_ticket_id,'') AS jira_ticket_id,
		       r.project_id, COALESCE(p.name,''), COALESCE(p.code,'')
		FROM pr_requests r
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE r.id = $1
	`
	var req PRRequest
	var createdBy, assignedTo, projectID sql.NullInt64
	var dueDate sql.NullTime
	err := DB.QueryRow(query, id).Scan(
		&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
		&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
		&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt, &req.TerraformPlanOutput, &req.JiraTicketID, &projectID, &req.ProjectName, &req.ProjectCode,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get PR request: %w", err)
	}
	if createdBy.Valid {
		val := int(createdBy.Int64)
		req.CreatedBy = &val
	}
	if assignedTo.Valid && assignedTo.Int64 > 0 {
		val := int(assignedTo.Int64)
		req.AssignedTo = &val
	}
	if projectID.Valid && projectID.Int64 > 0 {
		val := int(projectID.Int64)
		req.ProjectID = &val
	}
	if dueDate.Valid {
		req.DueDate = &dueDate.Time
	}
	return &req, nil
}

// GetPRRequestsByAssignedTo returns PR requests assigned to the given user (for DevOps "my tickets")
func GetPRRequestsByAssignedTo(assigneeID int, limit, offset int) ([]PRRequest, error) {
	query := `
		SELECT r.id, r.team, r.env, r.cloud, r.service, COALESCE(r.client_name,'') AS client_name, COALESCE(r.application_id,'') AS application_id,
		       COALESCE(r.priority,'medium') AS priority, r.due_date, r.pr_url, r.branch, r.file_path, r.status,
		       COALESCE(r.reject_reason,'') AS reject_reason, r.config, r.created_by, r.assigned_to, r.created_at, r.updated_at,
		       r.project_id, COALESCE(p.name,''), COALESCE(p.code,'')
		FROM pr_requests r
		LEFT JOIN projects p ON p.id = r.project_id
		WHERE r.assigned_to = $1
		ORDER BY r.updated_at DESC
	`
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}
	if offset > 0 {
		query += fmt.Sprintf(" OFFSET %d", offset)
	}
	rows, err := DB.Query(query, assigneeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var requests []PRRequest
	for rows.Next() {
		var req PRRequest
		var createdBy, assignedTo, projectID sql.NullInt64
		var dueDate sql.NullTime
		if err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt, &projectID, &req.ProjectName, &req.ProjectCode,
		); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			v := int(createdBy.Int64)
			req.CreatedBy = &v
		}
		if assignedTo.Valid && assignedTo.Int64 > 0 {
			v := int(assignedTo.Int64)
			req.AssignedTo = &v
		}
		if projectID.Valid && projectID.Int64 > 0 {
			v := int(projectID.Int64)
			req.ProjectID = &v
		}
		if dueDate.Valid {
			req.DueDate = &dueDate.Time
		}
		requests = append(requests, req)
	}
	return requests, nil
}

// WorkloadItem is a request with assignee info for the DevOps manager workload view
type WorkloadItem struct {
	Request          PRRequest `json:"request"`
	AssigneeID       int       `json:"assignee_id"`
	AssigneeUsername string    `json:"assignee_username"`
}

// GetWorkloadAssignedRequests returns all requests that have an assignee (for DevOps manager workload view)
func GetWorkloadAssignedRequests() ([]WorkloadItem, error) {
	return getWorkloadInProgress(false)
}

// GetWorkloadAllInProgress returns all in_progress requests for DevOps manager (assigned and unassigned). Unassigned have assignee_id 0 and assignee_username "—".
func GetWorkloadAllInProgress() ([]WorkloadItem, error) {
	return getWorkloadInProgress(true)
}

func getWorkloadInProgress(includeUnassigned bool) ([]WorkloadItem, error) {
	query := `
		SELECT p.id, p.team, p.env, p.cloud, p.service, COALESCE(p.client_name,'') AS client_name, COALESCE(p.application_id,'') AS application_id, COALESCE(p.priority,'medium') AS priority, p.due_date, p.pr_url, p.branch, p.file_path, p.status, COALESCE(p.reject_reason,'') AS reject_reason, p.config, p.created_by, p.assigned_to, p.created_at, p.updated_at, COALESCE(u.username, '—') AS assignee_username
		       , p.project_id
		FROM pr_requests p
		LEFT JOIN users u ON u.id = p.assigned_to
		WHERE p.status = 'in_progress'
		ORDER BY p.updated_at DESC
	`
	if !includeUnassigned {
		query = `
		SELECT p.id, p.team, p.env, p.cloud, p.service, COALESCE(p.client_name,'') AS client_name, COALESCE(p.application_id,'') AS application_id, COALESCE(p.priority,'medium') AS priority, p.due_date, p.pr_url, p.branch, p.file_path, p.status, COALESCE(p.reject_reason,'') AS reject_reason, p.config, p.created_by, p.assigned_to, p.created_at, p.updated_at, u.username AS assignee_username, p.project_id
		FROM pr_requests p
		INNER JOIN users u ON u.id = p.assigned_to
		WHERE p.assigned_to IS NOT NULL
		ORDER BY p.updated_at DESC
		`
	}
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkloadItem
	for rows.Next() {
		var req PRRequest
		var createdBy, assignedTo, projectID sql.NullInt64
		var dueDate sql.NullTime
		var assigneeUsername string
		if err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt,
			&assigneeUsername, &projectID,
		); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			v := int(createdBy.Int64)
			req.CreatedBy = &v
		}
		if assignedTo.Valid && assignedTo.Int64 > 0 {
			v := int(assignedTo.Int64)
			req.AssignedTo = &v
		}
		if projectID.Valid && projectID.Int64 > 0 {
			v := int(projectID.Int64)
			req.ProjectID = &v
		}
		if assigneeUsername == "" {
			assigneeUsername = "—"
		}
		item := WorkloadItem{Request: req, AssigneeUsername: assigneeUsername}
		if req.AssignedTo != nil {
			item.AssigneeID = *req.AssignedTo
		}
		out = append(out, item)
	}
	return out, nil
}

// WorkloadSummaryRow is one row for workload capacity view (by team or by person)
type WorkloadSummaryRow struct {
	Key               string `json:"key"`                 // team name or username
	Open              int    `json:"open"`                // pending_* + in_progress
	InProgress        int    `json:"in_progress"`         // status = in_progress
	CompletedThisWeek int    `json:"completed_this_week"` // status = completed and updated_at in current week
}

// GetWorkloadSummaryByTeam returns per-team open, in_progress, completed_this_week
func GetWorkloadSummaryByTeam() ([]WorkloadSummaryRow, error) {
	if DB == nil {
		return nil, nil
	}
	query := `
		SELECT team AS key,
			COUNT(*) FILTER (WHERE status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval', 'in_progress')) AS open,
			COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
			COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= date_trunc('week', CURRENT_DATE)) AS completed_this_week
		FROM pr_requests
		WHERE status NOT IN ('draft', 'rejected', 'cancelled')
		GROUP BY team
		ORDER BY open DESC, in_progress DESC
	`
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkloadSummaryRow
	for rows.Next() {
		var r WorkloadSummaryRow
		if err := rows.Scan(&r.Key, &r.Open, &r.InProgress, &r.CompletedThisWeek); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// GetWorkloadSummaryByPerson returns per-assignee open, in_progress, completed_this_week (assignee_username as key)
func GetWorkloadSummaryByPerson() ([]WorkloadSummaryRow, error) {
	if DB == nil {
		return nil, nil
	}
	query := `
		SELECT COALESCE(u.username, 'Unassigned') AS key,
			COUNT(*) FILTER (WHERE p.status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval', 'in_progress')) AS open,
			COUNT(*) FILTER (WHERE p.status = 'in_progress') AS in_progress,
			COUNT(*) FILTER (WHERE p.status = 'completed' AND p.updated_at >= date_trunc('week', CURRENT_DATE)) AS completed_this_week
		FROM pr_requests p
		LEFT JOIN users u ON u.id = p.assigned_to
		WHERE p.status NOT IN ('draft', 'rejected', 'cancelled')
		GROUP BY p.assigned_to, u.username
		ORDER BY open DESC, in_progress DESC
	`
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkloadSummaryRow
	for rows.Next() {
		var r WorkloadSummaryRow
		if err := rows.Scan(&r.Key, &r.Open, &r.InProgress, &r.CompletedThisWeek); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// SaveRequestConfigHistory appends a config snapshot for rollback
func SaveRequestConfigHistory(requestID int, config, note string) error {
	if DB == nil || requestID <= 0 {
		return nil
	}
	_, err := DB.Exec(
		"INSERT INTO request_config_history (request_id, config, note) VALUES ($1, $2, $3)",
		requestID, config, note,
	)
	return err
}

// GetRequestConfigHistory returns config snapshots for a request (newest first)
func GetRequestConfigHistory(requestID int, limit int) ([]struct {
	ID        int
	Config    string
	CreatedAt time.Time
	Note      string
}, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := DB.Query(
		"SELECT id, config, created_at, COALESCE(note,'') FROM request_config_history WHERE request_id = $1 ORDER BY created_at DESC LIMIT $2",
		requestID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID        int
		Config    string
		CreatedAt time.Time
		Note      string
	}
	for rows.Next() {
		var r struct {
			ID        int
			Config    string
			CreatedAt time.Time
			Note      string
		}
		if err := rows.Scan(&r.ID, &r.Config, &r.CreatedAt, &r.Note); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

// UpdatePRRequestConfig updates config for a request (used by rollback)
func UpdatePRRequestConfig(id int, config string) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		config, id,
	)
	return err
}

// UpdatePRRequestTerraformPlanOutput sets terraform_plan_output for a request (from CI or admin)
func UpdatePRRequestTerraformPlanOutput(id int, output string) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET terraform_plan_output = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		output, id,
	)
	return err
}

// UpdatePRRequestFull updates a draft request (config, priority, due_date, status). Only for draft requests.
func UpdatePRRequestFull(id int, config string, priority string, dueDate *time.Time, status string) error {
	// Save config to history before update (for rollback)
	_ = SaveRequestConfigHistory(id, config, "draft update")
	if dueDate == nil {
		_, err := DB.Exec(
			"UPDATE pr_requests SET config = $1, priority = $2, due_date = NULL, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
			config, priority, status, id,
		)
		return err
	}
	_, err := DB.Exec(
		"UPDATE pr_requests SET config = $1, priority = $2, due_date = $3, status = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5",
		config, priority, dueDate, status, id,
	)
	return err
}

// GetRequestComments returns comments for a request (newest first)
func GetRequestComments(requestID int) ([]RequestComment, error) {
	query := `
		SELECT c.id, c.request_id, c.user_id, COALESCE(u.username,'') AS username, c.body, c.created_at
		FROM request_comments c
		LEFT JOIN users u ON u.id = c.user_id
		WHERE c.request_id = $1
		ORDER BY c.created_at ASC
	`
	rows, err := DB.Query(query, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RequestComment
	for rows.Next() {
		var c RequestComment
		if err := rows.Scan(&c.ID, &c.RequestID, &c.UserID, &c.Username, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// AddRequestComment adds a comment to a request
func AddRequestComment(requestID, userID int, body string) error {
	_, err := DB.Exec(
		"INSERT INTO request_comments (request_id, user_id, body) VALUES ($1, $2, $3)",
		requestID, userID, body,
	)
	return err
}

// TimelineEntry is a single event in the request audit trail
type TimelineEntry struct {
	ID        int       `json:"id"`
	Kind      string    `json:"kind"`   // "user_activity" | "admin_audit" | "comment"
	Action    string    `json:"action"` // e.g. request_create, request_comment, request_approve
	Username  string    `json:"username"`
	Details   string    `json:"details"`
	Body      string    `json:"body,omitempty"` // for comments
	CreatedAt time.Time `json:"created_at"`
}

// GetRequestTimeline returns a merged timeline of user activity, admin audit, and comments for a request
func GetRequestTimeline(requestID int) ([]TimelineEntry, error) {
	if DB == nil {
		return nil, nil
	}
	rid := strconv.Itoa(requestID)
	var out []TimelineEntry

	// User activity
	rowsUA, err := DB.Query(`
		SELECT ua.id, ua.action, ua.details, ua.created_at, COALESCE(u.username, '') AS username
		FROM user_activity ua
		LEFT JOIN users u ON u.id = ua.user_id
		WHERE ua.resource_type = 'pr_request' AND ua.resource_id = $1
		ORDER BY ua.created_at ASC
	`, rid)
	if err == nil {
		defer rowsUA.Close()
		for rowsUA.Next() {
			var e TimelineEntry
			if err := rowsUA.Scan(&e.ID, &e.Action, &e.Details, &e.CreatedAt, &e.Username); err != nil {
				continue
			}
			e.Kind = "user_activity"
			out = append(out, e)
		}
	}

	// Admin audit log
	rowsAL, err := DB.Query(`
		SELECT a.id, a.action, COALESCE(a.details,''), a.created_at, COALESCE(u.username, '') AS username
		FROM admin_audit_log a
		LEFT JOIN users u ON u.id = a.admin_user_id
		WHERE a.resource_type = 'pr_request' AND a.resource_id = $1
		ORDER BY a.created_at ASC
	`, rid)
	if err == nil {
		defer rowsAL.Close()
		for rowsAL.Next() {
			var e TimelineEntry
			if err := rowsAL.Scan(&e.ID, &e.Action, &e.Details, &e.CreatedAt, &e.Username); err != nil {
				continue
			}
			e.Kind = "admin_audit"
			out = append(out, e)
		}
	}

	// Comments
	rowsC, err := DB.Query(`
		SELECT c.id, c.body, c.created_at, COALESCE(u.username, '') AS username
		FROM request_comments c
		LEFT JOIN users u ON u.id = c.user_id
		WHERE c.request_id = $1
		ORDER BY c.created_at ASC
	`, requestID)
	if err == nil {
		defer rowsC.Close()
		for rowsC.Next() {
			var e TimelineEntry
			if err := rowsC.Scan(&e.ID, &e.Body, &e.CreatedAt, &e.Username); err != nil {
				continue
			}
			e.Kind = "comment"
			e.Action = "request_comment"
			out = append(out, e)
		}
	}

	// Sort by created_at ASC
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

// GetUserByID retrieves a user by ID (without password). UserType and devops profile are loaded separately when needed.
func GetUserByID(id int) (*User, error) {
	var user User
	var verified sql.NullBool
	var role sql.NullString
	var userType sql.NullString
	var managerID sql.NullInt64
	var isPortalManager sql.NullBool
	var totpEnabled sql.NullBool
	err := DB.QueryRow(
		"SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), COALESCE(user_type, 'portal_user'), manager_id, COALESCE(is_portal_manager, false), COALESCE(totp_enabled, false), created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &verified, &role, &userType, &managerID, &isPortalManager, &totpEnabled, &user.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		// Fallback if totp_enabled column doesn't exist yet
		err2 := DB.QueryRow(
			"SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), COALESCE(user_type, 'portal_user'), manager_id, COALESCE(is_portal_manager, false), created_at FROM users WHERE id = $1",
			id,
		).Scan(&user.ID, &user.Username, &user.Email, &verified, &role, &userType, &managerID, &isPortalManager, &user.CreatedAt)
		if err2 != nil {
			if err2 == sql.ErrNoRows {
				return nil, nil
			}
			return nil, fmt.Errorf("failed to get user: %w", err2)
		}
		totpEnabled = sql.NullBool{}
	}
	user.Verified = verified.Valid && verified.Bool
	user.Role = "viewer"
	if role.Valid && role.String != "" {
		user.Role = role.String
	}
	user.UserType = "portal_user"
	if userType.Valid && (userType.String == "portal_user" || userType.String == "devops_user") {
		user.UserType = userType.String
	}
	if managerID.Valid && managerID.Int64 > 0 {
		m := int(managerID.Int64)
		user.ManagerID = &m
	}
	user.IsPortalManager = isPortalManager.Valid && isPortalManager.Bool
	user.TotpEnabled = totpEnabled.Valid && totpEnabled.Bool
	return &user, nil
}

// DevopsUserListItem is a minimal user for DevOps manager filter dropdown
type DevopsUserListItem struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

// GetDevopsUsers returns all users with user_type = devops_user (for manager workload filter)
func GetDevopsUsers() ([]DevopsUserListItem, error) {
	rows, err := DB.Query(
		`SELECT id, username FROM users WHERE COALESCE(user_type, 'portal_user') = 'devops_user' ORDER BY username`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DevopsUserListItem
	for rows.Next() {
		var u DevopsUserListItem
		if err := rows.Scan(&u.ID, &u.Username); err != nil {
			continue
		}
		out = append(out, u)
	}
	return out, nil
}

// GetDevopsProfile returns the DevOps profile for a user, or nil if none
func GetDevopsProfile(userID int) (*DevopsProfile, error) {
	var p DevopsProfile
	var onboardDate sql.NullString
	err := DB.QueryRow(
		`SELECT user_id, COALESCE(is_manager, false), COALESCE(position,''), onboard_date, COALESCE(level,'L1')
		 FROM devops_profiles WHERE user_id = $1`,
		userID,
	).Scan(&p.UserID, &p.IsManager, &p.Position, &onboardDate, &p.Level)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if onboardDate.Valid && onboardDate.String != "" {
		p.OnboardDate = &onboardDate.String
	}
	if p.Level != "L1" && p.Level != "L2" && p.Level != "L3" && p.Level != "L4" {
		p.Level = "L1"
	}
	return &p, nil
}

// CreateDevopsProfile inserts a DevOps profile for a user
func CreateDevopsProfile(userID int, isManager bool, position, onboardDate, level string) error {
	if level != "L1" && level != "L2" && level != "L3" && level != "L4" {
		level = "L1"
	}
	var onboard interface{}
	if onboardDate != "" {
		onboard = onboardDate
	} else {
		onboard = nil
	}
	_, err := DB.Exec(
		`INSERT INTO devops_profiles (user_id, is_manager, position, onboard_date, level) VALUES ($1, $2, $3, $4, $5)`,
		userID, isManager, position, onboard, level,
	)
	return err
}

// UpdateDevopsProfile updates the DevOps profile for a user (creates if missing)
func UpdateDevopsProfile(userID int, isManager bool, position, onboardDate, level string) error {
	if level != "L1" && level != "L2" && level != "L3" && level != "L4" {
		level = "L1"
	}
	var onboard interface{}
	if onboardDate != "" {
		onboard = onboardDate
	} else {
		onboard = nil
	}
	_, err := DB.Exec(
		`INSERT INTO devops_profiles (user_id, is_manager, position, onboard_date, level)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id) DO UPDATE SET is_manager = $2, position = $3, onboard_date = $4, level = $5`,
		userID, isManager, position, onboard, level,
	)
	return err
}

// UpdateUserPassword updates a user's password by ID
func UpdateUserPassword(userID int, hashedPassword string) error {
	_, err := DB.Exec("UPDATE users SET password = $1 WHERE id = $2", hashedPassword, userID)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}
	return nil
}

// SavePasswordResetToken creates a password reset token for user (1 hour expiry)
func SavePasswordResetToken(userID int, token string) error {
	_, err := DB.Exec(
		"INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
		token, userID,
	)
	return err
}

// GetUserIDByPasswordResetToken returns user ID if token is valid and not expired
func GetUserIDByPasswordResetToken(token string) (int, error) {
	var userID int
	err := DB.QueryRow(
		"SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()",
		token,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return userID, nil
}

// ConsumePasswordResetToken deletes the token after use (one-time use)
func ConsumePasswordResetToken(token string) error {
	_, err := DB.Exec("DELETE FROM password_reset_tokens WHERE token = $1", token)
	return err
}

// GetUserByVerificationToken returns user ID if token is valid and not expired
func GetUserByVerificationToken(token string) (int, error) {
	var userID int
	err := DB.QueryRow(
		"SELECT id FROM users WHERE verification_token = $1 AND verification_token_expires_at > NOW()",
		token,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return userID, nil
}

// GetUserIDByIDAndOTP returns user ID if user exists and OTP matches and is not expired (for 2FA)
func GetUserIDByIDAndOTP(userID int, otp string) (int, error) {
	if userID <= 0 || otp == "" {
		return 0, nil
	}
	var id int
	err := DB.QueryRow(
		"SELECT id FROM users WHERE id = $1 AND verification_token = $2 AND verification_token_expires_at > NOW()",
		userID, otp,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

// GetUserIDByEmailAndOTP returns user ID if email and OTP match and are not expired
func GetUserIDByEmailAndOTP(email, otp string) (int, error) {
	var userID int
	err := DB.QueryRow(
		"SELECT id FROM users WHERE email = $1 AND verification_token = $2 AND verification_token_expires_at > NOW()",
		email, otp,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return userID, nil
}

// SetUserVerified sets verified=true and clears verification token for user ID
func SetUserVerified(userID int) error {
	_, err := DB.Exec(
		"UPDATE users SET verified = TRUE, verification_token = NULL, verification_token_expires_at = NULL WHERE id = $1",
		userID,
	)
	return err
}

// UpdateUserTotpEnabled sets totp_enabled for user (2FA via email OTP)
func UpdateUserTotpEnabled(userID int, enabled bool) error {
	_, err := DB.Exec("UPDATE users SET totp_enabled = $1 WHERE id = $2", enabled, userID)
	return err
}

// SetUserVerificationToken sets verification token and expiry for user ID
func SetUserVerificationToken(userID int, token string, expiresAt time.Time) error {
	_, err := DB.Exec(
		"UPDATE users SET verification_token = $1, verification_token_expires_at = $2 WHERE id = $3",
		token, expiresAt, userID,
	)
	return err
}

// UpdateUserRole sets role for user ID (caller must enforce admin auth)
func UpdateUserRole(userID int, role string) error {
	if role != "viewer" && role != "contributor" && role != "admin" {
		return fmt.Errorf("invalid role: %s", role)
	}
	_, err := DB.Exec("UPDATE users SET role = $1 WHERE id = $2", role, userID)
	return err
}

// UpdateUserProfile updates username, email, role, verified for a user (caller must enforce admin auth)
func UpdateUserProfile(userID int, username, email, role string, verified bool) error {
	if username == "" || email == "" {
		return fmt.Errorf("username and email are required")
	}
	if role != "viewer" && role != "contributor" && role != "admin" {
		return fmt.Errorf("invalid role: %s", role)
	}
	var exists int
	if err := DB.QueryRow("SELECT id FROM users WHERE username = $1 AND id != $2", username, userID).Scan(&exists); err == nil {
		return fmt.Errorf("username already exists")
	}
	if err := DB.QueryRow("SELECT id FROM users WHERE email = $1 AND id != $2", email, userID).Scan(&exists); err == nil {
		return fmt.Errorf("email already exists")
	}
	_, err := DB.Exec(
		"UPDATE users SET username = $1, email = $2, role = $3, verified = $4 WHERE id = $5",
		username, email, role, verified, userID,
	)
	return err
}

// UpdateUserType sets user_type for a user (portal_user | devops_user)
func UpdateUserType(userID int, userType string) error {
	if userType != "portal_user" && userType != "devops_user" {
		userType = "portal_user"
	}
	_, err := DB.Exec("UPDATE users SET user_type = $1 WHERE id = $2", userType, userID)
	return err
}

// UpdateUserManagerID sets manager_id for a portal user (for two-step approval)
func UpdateUserManagerID(userID int, managerID *int) error {
	if managerID != nil && *managerID == userID {
		return fmt.Errorf("user cannot be their own manager")
	}
	_, err := DB.Exec("UPDATE users SET manager_id = $1 WHERE id = $2", managerID, userID)
	return err
}

// DeleteUser removes a user by ID (admin only). Cleans request_comments and audit log references, then deletes user (team_members CASCADE).
func DeleteUser(userID int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Remove comments by this user (request_comments has no ON DELETE)
	if _, err := tx.Exec("DELETE FROM request_comments WHERE user_id = $1", userID); err != nil {
		return err
	}
	// Null out audit log admin reference so we keep the log
	if _, err := tx.Exec("UPDATE admin_audit_log SET admin_user_id = NULL WHERE admin_user_id = $1", userID); err != nil {
		return err
	}
	result, err := tx.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("user not found")
	}
	return tx.Commit()
}

// Stats holds aggregate counts for the dashboard
type Stats struct {
	TotalRequests int            `json:"total_requests"`
	ByCloud       map[string]int `json:"by_cloud"`
	ByStatus      map[string]int `json:"by_status"`
	ByEnv         map[string]int `json:"by_env"`
}

// GetStats returns aggregate statistics for PR requests
func GetStats(userIDInt int) (*Stats, error) {
	stats := &Stats{
		ByCloud:  make(map[string]int),
		ByStatus: make(map[string]int),
		ByEnv:    make(map[string]int),
	}

	whereClause := ""
	args := []interface{}{}
	if userIDInt > 0 {
		whereClause = " WHERE created_by = $1"
		args = append(args, userIDInt)
	}

	// Total count
	var total int
	err := DB.QueryRow("SELECT COUNT(*) FROM pr_requests"+whereClause, args...).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("failed to get total count: %w", err)
	}
	stats.TotalRequests = total

	// By cloud
	rows, err := DB.Query("SELECT cloud, COUNT(*) FROM pr_requests"+whereClause+" GROUP BY cloud", args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get by cloud: %w", err)
	}
	for rows.Next() {
		var cloud string
		var count int
		if err := rows.Scan(&cloud, &count); err != nil {
			rows.Close()
			return nil, err
		}
		stats.ByCloud[cloud] = count
	}
	rows.Close()

	// By status
	rows, err = DB.Query("SELECT status, COUNT(*) FROM pr_requests"+whereClause+" GROUP BY status", args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get by status: %w", err)
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return nil, err
		}
		stats.ByStatus[status] = count
	}
	rows.Close()

	// By env
	rows, err = DB.Query("SELECT env, COUNT(*) FROM pr_requests"+whereClause+" GROUP BY env", args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get by env: %w", err)
	}
	for rows.Next() {
		var env string
		var count int
		if err := rows.Scan(&env, &count); err != nil {
			rows.Close()
			return nil, err
		}
		stats.ByEnv[env] = count
	}
	rows.Close()

	return stats, nil
}

// GetTotalCount returns total count of PR requests (for pagination). Same filters as GetPRRequests. fromDate, toDate optional.
func GetTotalCount(team, env, cloud string, projectID int, statusFilter, priorityFilter, search string, prID int, userIDInt int, createdByIn []int, atRiskOnly bool, fromDate, toDate string) (int, error) {
	query := "SELECT COUNT(*) FROM pr_requests r LEFT JOIN projects p ON p.id = r.project_id WHERE 1=1"
	args := []interface{}{}
	argPos := 1

	if search != "" {
		searchVal := "%" + search + "%"
		query += fmt.Sprintf(` AND (r.team ILIKE $%d OR r.env ILIKE $%d OR r.cloud ILIKE $%d OR r.service ILIKE $%d OR COALESCE(r.client_name,'') ILIKE $%d OR COALESCE(r.application_id,'') ILIKE $%d OR r.branch ILIKE $%d OR COALESCE(r.config,'')::text ILIKE $%d OR COALESCE(p.name,'') ILIKE $%d OR COALESCE(p.code,'') ILIKE $%d)`,
			argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos, argPos)
		args = append(args, searchVal)
		argPos++
	}

	if prID > 0 {
		query += fmt.Sprintf(" AND r.id = $%d", argPos)
		args = append(args, prID)
		argPos++
	}
	if team != "" {
		query += fmt.Sprintf(" AND r.team ILIKE $%d", argPos)
		args = append(args, "%"+team+"%")
		argPos++
	}
	if env != "" {
		query += fmt.Sprintf(" AND r.env ILIKE $%d", argPos)
		args = append(args, "%"+env+"%")
		argPos++
	}
	if cloud != "" {
		query += fmt.Sprintf(" AND r.cloud ILIKE $%d", argPos)
		args = append(args, "%"+cloud+"%")
		argPos++
	}
	if projectID > 0 {
		query += fmt.Sprintf(" AND r.project_id = $%d", argPos)
		args = append(args, projectID)
		argPos++
	}
	if statusFilter != "" {
		if statusFilter == "pending_any" {
			query += " AND r.status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')"
		} else {
			query += fmt.Sprintf(" AND r.status = $%d", argPos)
			args = append(args, statusFilter)
			argPos++
		}
	}
	if priorityFilter != "" {
		query += fmt.Sprintf(" AND COALESCE(r.priority,'medium') = $%d", argPos)
		args = append(args, priorityFilter)
		argPos++
	}
	if len(createdByIn) > 0 {
		placeholders := make([]string, len(createdByIn))
		for i := range createdByIn {
			placeholders[i] = fmt.Sprintf("$%d", argPos)
			args = append(args, createdByIn[i])
			argPos++
		}
		query += " AND r.created_by IN (" + strings.Join(placeholders, ",") + ")"
	} else if userIDInt > 0 {
		query += fmt.Sprintf(" AND r.created_by = $%d", argPos)
		args = append(args, userIDInt)
		argPos++
	}
	if atRiskOnly {
		query += " AND r.due_date IS NOT NULL AND (r.due_date < NOW() OR r.due_date < NOW() + INTERVAL '24 hours')"
	}
	if fromDate != "" {
		query += fmt.Sprintf(" AND r.created_at >= $%d::date", argPos)
		args = append(args, fromDate)
		argPos++
	}
	if toDate != "" {
		query += fmt.Sprintf(" AND r.created_at < ($%d::date + interval '1 day')", argPos)
		args = append(args, toDate)
		argPos++
	}

	var count int
	err := DB.QueryRow(query, args...).Scan(&count)
	return count, err
}

// GetAtRiskCount returns the number of requests with due_date overdue or due in 24h (for SLA tracking)
func GetAtRiskCount() (int, error) {
	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM pr_requests WHERE due_date IS NOT NULL AND status NOT IN ('completed', 'rejected', 'cancelled') AND (due_date < NOW() OR due_date < NOW() + INTERVAL '24 hours')",
	).Scan(&count)
	return count, err
}

// GetAtRiskRequestsForSLABreach returns at-risk requests that haven't been notified in the last 24h (for SLA breach alerts)
func GetAtRiskRequestsForSLABreach(limit int) ([]PRRequest, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, team, env, cloud, service, COALESCE(client_name,'') AS client_name, COALESCE(application_id,'') AS application_id, COALESCE(priority,'medium') AS priority, due_date, pr_url, branch, file_path, status, COALESCE(reject_reason,'') AS reject_reason, config, created_by, assigned_to, created_at, updated_at
		FROM pr_requests
		WHERE due_date IS NOT NULL AND status NOT IN ('completed', 'rejected', 'cancelled')
		  AND (due_date < NOW() OR due_date < NOW() + INTERVAL '24 hours')
		  AND (sla_breach_notified_at IS NULL OR sla_breach_notified_at < NOW() - INTERVAL '24 hours')
		ORDER BY due_date ASC
		LIMIT $1
	`
	rows, err := DB.Query(query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reqs []PRRequest
	for rows.Next() {
		var r PRRequest
		var dueDate sql.NullTime
		var createdBy, assignedTo sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Team, &r.Env, &r.Cloud, &r.Service, &r.ClientName, &r.ApplicationID, &r.Priority, &dueDate, &r.PRURL, &r.Branch, &r.FilePath, &r.Status, &r.RejectReason, &r.Config, &createdBy, &assignedTo, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		if dueDate.Valid {
			r.DueDate = &dueDate.Time
		}
		if createdBy.Valid {
			id := int(createdBy.Int64)
			r.CreatedBy = &id
		}
		if assignedTo.Valid {
			id := int(assignedTo.Int64)
			r.AssignedTo = &id
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

// UpdateSLABreachNotified sets sla_breach_notified_at for a request (after sending SLA breach alert)
func UpdateSLABreachNotified(requestID int) error {
	_, err := DB.Exec("UPDATE pr_requests SET sla_breach_notified_at = NOW() WHERE id = $1", requestID)
	return err
}

// GetPendingApprovalCount returns the number of requests pending any approval (user manager, devops, or legacy pending_approval)
func GetPendingApprovalCount() (int, error) {
	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM pr_requests WHERE status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')",
	).Scan(&count)
	return count, err
}

// GetPendingDevopsApprovalCount returns the number of requests pending DevOps manager approval (for DevOps portal notification badge)
func GetPendingDevopsApprovalCount() (int, error) {
	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM pr_requests WHERE status = 'pending_devops_approval'",
	).Scan(&count)
	return count, err
}

// AuditLogEntry is a single admin audit log row
type AuditLogEntry struct {
	ID            int       `json:"id"`
	AdminUserID   *int      `json:"admin_user_id"`
	AdminUsername string    `json:"admin_username,omitempty"`
	Action        string    `json:"action"`
	ResourceType  string    `json:"resource_type"`
	ResourceID    string    `json:"resource_id"`
	Details       string    `json:"details"`
	ProjectID     *int      `json:"project_id,omitempty"`
	ProjectName   string    `json:"project_name,omitempty"`
	ProjectCode   string    `json:"project_code,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// AppendAuditLog records an admin action (no-op if DB is nil)
func AppendAuditLog(adminUserID *int, action, resourceType, resourceID, details string) {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(
		"INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)",
		adminUserID, action, resourceType, resourceID, details,
	)
}

// GetAuditLogs returns recent audit log entries with optional filters (action, date range from/to YYYY-MM-DD)
func GetAuditLogs(limit, offset int, actionFilter, fromDate, toDate string, projectIDFilter int) ([]AuditLogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT a.id, a.admin_user_id, a.action, a.resource_type, COALESCE(a.resource_id,''), COALESCE(a.details,''), a.created_at,
		       u.username,
		       COALESCE(direct_project.id, request_project.id),
		       COALESCE(direct_project.name, request_project.name, ''),
		       COALESCE(direct_project.code, request_project.code, '')
		FROM admin_audit_log a
		LEFT JOIN users u ON u.id = a.admin_user_id
		LEFT JOIN pr_requests request_ref
		  ON a.resource_type = 'pr_request'
		 AND a.resource_id ~ '^[0-9]+$'
		 AND request_ref.id = a.resource_id::int
		LEFT JOIN projects request_project ON request_project.id = request_ref.project_id
		LEFT JOIN projects direct_project
		  ON a.resource_type = 'project'
		 AND a.resource_id ~ '^[0-9]+$'
		 AND direct_project.id = a.resource_id::int
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1
	if actionFilter != "" {
		query += fmt.Sprintf(" AND a.action = $%d", argPos)
		args = append(args, actionFilter)
		argPos++
	}
	if fromDate != "" {
		query += fmt.Sprintf(" AND a.created_at >= $%d::date", argPos)
		args = append(args, fromDate)
		argPos++
	}
	if toDate != "" {
		query += fmt.Sprintf(" AND a.created_at < ($%d::date + interval '1 day')", argPos)
		args = append(args, toDate)
		argPos++
	}
	if projectIDFilter > 0 {
		query += fmt.Sprintf(" AND COALESCE(direct_project.id, request_project.id) = $%d", argPos)
		args = append(args, projectIDFilter)
		argPos++
	}
	query += " ORDER BY a.created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argPos, argPos+1)
	args = append(args, limit, offset)
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditLogEntry
	for rows.Next() {
		var e AuditLogEntry
		var adminID, projectID sql.NullInt64
		var username sql.NullString
		if err := rows.Scan(&e.ID, &adminID, &e.Action, &e.ResourceType, &e.ResourceID, &e.Details, &e.CreatedAt, &username, &projectID, &e.ProjectName, &e.ProjectCode); err != nil {
			return nil, err
		}
		if adminID.Valid {
			id := int(adminID.Int64)
			e.AdminUserID = &id
		}
		if projectID.Valid {
			id := int(projectID.Int64)
			e.ProjectID = &id
		}
		if username.Valid {
			e.AdminUsername = username.String
		}
		out = append(out, e)
	}
	return out, nil
}

// CredentialAuditEntry is a single credential audit log row
type CredentialAuditEntry struct {
	ID                 int       `json:"id"`
	RequestID          *int      `json:"request_id"`
	Cloud              string    `json:"cloud"`
	CredentialType     string    `json:"credential_type"`
	Team               string    `json:"team"`
	Env                string    `json:"env"`
	CreatedByUserID    *int      `json:"created_by_user_id"`
	CreatedByUsername  string    `json:"created_by_username,omitempty"`
	ApprovedByUserID   *int      `json:"approved_by_user_id"`
	ApprovedByUsername string    `json:"approved_by_username,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

// InsertCredentialAuditLog inserts a credential audit entry
func InsertCredentialAuditLog(requestID int, cloud, credentialType, team, env string, createdBy, approvedBy *int) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(
		`INSERT INTO credential_audit_log (request_id, cloud, credential_type, team, env, created_by_user_id, approved_by_user_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		requestID, cloud, credentialType, team, env, createdBy, approvedBy,
	)
	return err
}

// GetCredentialAuditLogs returns credential audit entries with optional filters
func GetCredentialAuditLogs(limit, offset int, cloudFilter, fromDate, toDate string) ([]CredentialAuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT c.id, c.request_id, c.cloud, c.credential_type, COALESCE(c.team,''), COALESCE(c.env,''),
		       c.created_by_user_id, c.approved_by_user_id, c.created_at,
		       u1.username AS created_by_username, u2.username AS approved_by_username
		FROM credential_audit_log c
		LEFT JOIN users u1 ON u1.id = c.created_by_user_id
		LEFT JOIN users u2 ON u2.id = c.approved_by_user_id
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1
	if cloudFilter != "" {
		query += fmt.Sprintf(" AND c.cloud = $%d", argPos)
		args = append(args, cloudFilter)
		argPos++
	}
	if fromDate != "" {
		query += fmt.Sprintf(" AND c.created_at >= $%d::date", argPos)
		args = append(args, fromDate)
		argPos++
	}
	if toDate != "" {
		query += fmt.Sprintf(" AND c.created_at < ($%d::date + interval '1 day')", argPos)
		args = append(args, toDate)
		argPos++
	}
	query += " ORDER BY c.created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argPos, argPos+1)
	args = append(args, limit, offset)
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CredentialAuditEntry
	for rows.Next() {
		var e CredentialAuditEntry
		var reqID sql.NullInt64
		var createdBy, approvedBy sql.NullInt64
		var createdByUser, approvedByUser sql.NullString
		if err := rows.Scan(&e.ID, &reqID, &e.Cloud, &e.CredentialType, &e.Team, &e.Env,
			&createdBy, &approvedBy, &e.CreatedAt, &createdByUser, &approvedByUser); err != nil {
			return nil, err
		}
		if reqID.Valid {
			id := int(reqID.Int64)
			e.RequestID = &id
		}
		if createdBy.Valid {
			id := int(createdBy.Int64)
			e.CreatedByUserID = &id
		}
		if approvedBy.Valid {
			id := int(approvedBy.Int64)
			e.ApprovedByUserID = &id
		}
		if createdByUser.Valid {
			e.CreatedByUsername = createdByUser.String
		}
		if approvedByUser.Valid {
			e.ApprovedByUsername = approvedByUser.String
		}
		out = append(out, e)
	}
	return out, nil
}

// DashboardStats holds counts for admin dashboard
type DashboardStats struct {
	TotalUsers       int `json:"total_users"`
	TotalTeams       int `json:"total_teams"`
	UnverifiedUsers  int `json:"unverified_users"`
	RequestsThisWeek int `json:"requests_this_week"`
	PendingApproval  int `json:"pending_approval"`
}

// GetDashboardStats returns counts for admin dashboard
func GetDashboardStats() (DashboardStats, error) {
	var s DashboardStats
	if DB == nil {
		return s, nil
	}
	_ = queryRowContext("SELECT COUNT(*) FROM users").Scan(&s.TotalUsers)
	_ = queryRowContext("SELECT COUNT(*) FROM teams").Scan(&s.TotalTeams)
	_ = queryRowContext("SELECT COUNT(*) FROM users WHERE COALESCE(verified, false) = false").Scan(&s.UnverifiedUsers)
	_ = queryRowContext("SELECT COUNT(*) FROM pr_requests WHERE created_at >= NOW() - INTERVAL '7 days'").Scan(&s.RequestsThisWeek)
	_ = queryRowContext("SELECT COUNT(*) FROM pr_requests WHERE status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')").Scan(&s.PendingApproval)
	return s, nil
}

// DateRangeStats holds request counts by status for a date range
type DateRangeStats struct {
	From     string         `json:"from"`
	To       string         `json:"to"`
	Total    int            `json:"total"`
	ByStatus map[string]int `json:"by_status"`
}

// GetRequestsByStatusInDateRange returns total and per-status counts for requests created in the date range (inclusive)
func GetRequestsByStatusInDateRange(from, to time.Time) (DateRangeStats, error) {
	var s DateRangeStats
	s.ByStatus = make(map[string]int)
	if DB == nil {
		return s, nil
	}
	s.From = from.Format("2006-01-02")
	s.To = to.Format("2006-01-02")
	fromStr := from.Format("2006-01-02")
	toStr := to.Format("2006-01-02")

	// Total in range (date inclusive)
	_ = queryRowContext(
		`SELECT COUNT(*) FROM pr_requests WHERE created_at::date >= $1::date AND created_at::date <= $2::date`,
		fromStr, toStr,
	).Scan(&s.Total)

	// Per status
	rows, cancel, err := queryRowsWithTimeout(
		`SELECT status, COUNT(*) FROM pr_requests 
		 WHERE created_at::date >= $1::date AND created_at::date <= $2::date 
		 GROUP BY status`,
		fromStr, toStr,
	)
	if err != nil {
		return s, err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return s, err
		}
		s.ByStatus[status] = count
	}
	return s, nil
}

// GetUserRequestsUpdatedSince returns count of requests created by userID with updated_at > since (for user notifications)
func GetUserRequestsUpdatedSince(userID int, since time.Time) (int, error) {
	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM pr_requests WHERE created_by = $1 AND updated_at > $2",
		userID, since,
	).Scan(&count)
	return count, err
}

// GetPendingManagerApprovalCount returns how many requests are pending_user_manager_approval that the given user can approve (as group manager for request's team or as creator's manager_id). Used for portal manager notification badge.
func GetPendingManagerApprovalCount(managerUserID int) (int, error) {
	var count int
	err := DB.QueryRow(`
		SELECT COUNT(DISTINCT r.id) FROM pr_requests r
		WHERE r.status = 'pending_user_manager_approval'
		AND r.created_by IS NOT NULL
		AND (
			EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by AND u.manager_id = $1)
			OR EXISTS (
				SELECT 1 FROM team_members m1
				INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal' AND (t.name = r.team OR t.slug = r.team)
				INNER JOIN team_members m2 ON m2.team_id = t.id AND m2.role = 'manager' AND m2.user_id = $1
				WHERE m1.user_id = r.created_by
			)
		)
	`, managerUserID).Scan(&count)
	return count, err
}

// CreateTeam creates a new team (admin only). teamType: "portal" | "devops". defaultEnv, defaultCloud optional.
func CreateTeam(name, slug, teamType string, createdBy *int, defaultEnv, defaultCloud string) (*Team, error) {
	if slug == "" {
		slug = normalizeTeamSlug(name)
	} else {
		slug = normalizeTeamSlug(slug)
	}
	if teamType != "devops" && teamType != "portal" {
		teamType = "portal"
	}
	groupID, err := GenerateTeamApplicationID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate team application id: %w", err)
	}
	var t Team
	err = queryRowContext(
		`INSERT INTO teams (name, slug, application_id, team_type, created_by, default_env, default_cloud) VALUES ($1, $2, $3, $4, $5, NULLIF(TRIM($6),''), NULLIF(TRIM($7),''))
		 RETURNING id, name, slug, COALESCE(application_id,''), COALESCE(team_type,'portal'), COALESCE(default_env,''), COALESCE(default_cloud,''), created_at, created_by`,
		name, slug, groupID, teamType, createdBy, defaultEnv, defaultCloud,
	).Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.DefaultEnv, &t.DefaultCloud, &t.CreatedAt, &t.CreatedBy)
	if err != nil {
		return nil, err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	return &t, nil
}

// UpdateTeamDefaults updates default_env and default_cloud for a team
func UpdateTeamDefaults(teamID int, defaultEnv, defaultCloud string) error {
	_, err := execContext(
		`UPDATE teams SET default_env = NULLIF(TRIM($1),''), default_cloud = NULLIF(TRIM($2),'') WHERE id = $3`,
		defaultEnv, defaultCloud, teamID,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	}
	return err
}

// CreateAPIKey creates an API key for the user; returns the raw key (shown once) and record. Scopes: comma-separated e.g. "request:create,history:read"
func CreateAPIKey(userID int, name, scopes string) (rawKey string, rec *APIKeyRecord, err error) {
	if scopes == "" {
		scopes = "request:create,history:read"
	}
	scopes = strings.TrimSpace(strings.ReplaceAll(scopes, " ", ""))
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, err
	}
	raw := hex.EncodeToString(bytes)
	rawKey = APIKeyPrefix + raw
	hash := sha256.Sum256([]byte(rawKey))
	hashStr := hex.EncodeToString(hash[:])
	var id int
	var createdAt time.Time
	err = DB.QueryRow(
		`INSERT INTO api_keys (user_id, name, key_hash, scopes) VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at`, userID, strings.TrimSpace(name), hashStr, scopes,
	).Scan(&id, &createdAt)
	if err != nil {
		return "", nil, err
	}
	rec = &APIKeyRecord{ID: id, UserID: userID, Name: strings.TrimSpace(name), Scopes: scopes, CreatedAt: createdAt}
	return rawKey, rec, nil
}

// GetUserIDAndScopesByAPIKey returns userID and scopes for a raw API key (prefix ip_xxx), or error if invalid/revoked
func GetUserIDAndScopesByAPIKey(rawKey string) (userID int, scopes string, keyID int, err error) {
	if rawKey == "" || !strings.HasPrefix(rawKey, APIKeyPrefix) {
		return 0, "", 0, fmt.Errorf("invalid api key format")
	}
	hash := sha256.Sum256([]byte(rawKey))
	hashStr := hex.EncodeToString(hash[:])
	var uid int
	var s string
	err = DB.QueryRow(
		`SELECT id, user_id, COALESCE(scopes,'') FROM api_keys WHERE key_hash = $1`, hashStr,
	).Scan(&keyID, &uid, &s)
	if err == sql.ErrNoRows {
		return 0, "", 0, fmt.Errorf("api key not found or revoked")
	}
	if err != nil {
		return 0, "", 0, err
	}
	return uid, s, keyID, nil
}

// UpdateAPIKeyLastUsed sets last_used_at for the key
func UpdateAPIKeyLastUsed(keyID int) {
	_, _ = DB.Exec("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1", keyID)
}

// ListAPIKeysForUser returns all API keys for the user (without key value)
func ListAPIKeysForUser(userID int) ([]APIKeyRecord, error) {
	rows, err := DB.Query(
		`SELECT id, user_id, name, scopes, last_used_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKeyRecord
	for rows.Next() {
		var r APIKeyRecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.Name, &r.Scopes, &r.LastUsedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// RevokeAPIKey deletes the API key if it belongs to the user
func RevokeAPIKey(keyID, userID int) error {
	res, err := DB.Exec("DELETE FROM api_keys WHERE id = $1 AND user_id = $2", keyID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("api key not found or access denied")
	}
	return nil
}

// GetTeams returns all teams
func GetTeams() ([]Team, error) {
	rows, err := DB.Query(`SELECT id, name, slug, COALESCE(application_id,''), COALESCE(team_type,'portal'), COALESCE(default_env,''), COALESCE(default_cloud,''), created_at, created_by FROM teams ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.DefaultEnv, &t.DefaultCloud, &t.CreatedAt, &t.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// GetTeamByID returns a team by ID
func GetTeamByID(id int) (*Team, error) {
	var t Team
	err := DB.QueryRow(
		`SELECT id, name, slug, COALESCE(application_id,''), COALESCE(team_type,'portal'), COALESCE(default_env,''), COALESCE(default_cloud,''), created_at, created_by FROM teams WHERE id = $1`, id,
	).Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.DefaultEnv, &t.DefaultCloud, &t.CreatedAt, &t.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func GetTeamByNameOrSlug(teamNameOrSlug string) (*Team, error) {
	if DB == nil {
		return nil, nil
	}
	var t Team
	err := DB.QueryRow(
		`SELECT id, name, slug, COALESCE(application_id,''), COALESCE(team_type,'portal'), COALESCE(default_env,''), COALESCE(default_cloud,''), created_at, created_by
		 FROM teams WHERE name = $1 OR slug = $1 ORDER BY id ASC LIMIT 1`,
		teamNameOrSlug,
	).Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.DefaultEnv, &t.DefaultCloud, &t.CreatedAt, &t.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// AddTeamMember adds a user to a team
func AddTeamMember(teamID, userID int, role string) (*TeamMember, error) {
	if role == "" {
		role = "member"
	}
	var m TeamMember
	err := queryRowContext(
		`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)
		 RETURNING id, team_id, user_id, role, created_at`,
		teamID, userID, role,
	).Scan(&m.ID, &m.TeamID, &m.UserID, &m.Role, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	return &m, nil
}

// RemoveTeamMember removes a user from a team
func RemoveTeamMember(teamID, userID int) error {
	_, err := execContext(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, teamID, userID)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	}
	return err
}

// ValidPortalRole returns true for portal team member roles
func ValidPortalRole(role string) bool {
	switch role {
	case "developer", "senior_developer", "lead", "manager":
		return true
	}
	return false
}

// ValidDevopsRole returns true for devops team member roles
func ValidDevopsRole(role string) bool {
	return role == "member" || role == "lead"
}

// UpdateTeamMemberRole sets the role for a team member. Portal: developer, senior_developer, lead, manager. DevOps: member, lead.
func UpdateTeamMemberRole(teamID, userID int, role string) error {
	team, _ := GetTeamByID(teamID)
	if team != nil && team.TeamType == "devops" {
		if !ValidDevopsRole(role) {
			role = "member"
		}
	} else {
		if !ValidPortalRole(role) {
			role = "developer"
		}
	}
	result, err := execContext(`UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3`, role, teamID, userID)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("team member not found")
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	return nil
}

// DeleteTeam deletes a team and cascades to team_members (ON DELETE CASCADE)
func DeleteTeam(teamID int) error {
	_, err := execContext(`DELETE FROM teams WHERE id = $1`, teamID)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam, cacheNamespaceOnboard)
	}
	return err
}

// GetTeamMembers returns all members of a team (with user info)
func GetTeamMembers(teamID int) ([]struct {
	TeamMember
	Username string `json:"username"`
	Email    string `json:"email"`
}, error) {
	rows, err := DB.Query(
		`SELECT m.id, m.team_id, m.user_id, m.role, m.created_at, u.username, u.email
		 FROM team_members m JOIN users u ON u.id = m.user_id
		 WHERE m.team_id = $1 ORDER BY m.created_at`,
		teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		TeamMember
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	for rows.Next() {
		var m struct {
			TeamMember
			Username string `json:"username"`
			Email    string `json:"email"`
		}
		m.TeamMember = TeamMember{}
		if err := rows.Scan(&m.ID, &m.TeamID, &m.UserID, &m.Role, &m.CreatedAt, &m.Username, &m.Email); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// GetTeamsForUser returns team IDs the user belongs to
func GetTeamsForUser(userID int) ([]int, error) {
	rows, err := DB.Query(`SELECT team_id FROM team_members WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetGroupManagerForUser returns the user ID of the "manager" role in the user's portal team(s). If user is in multiple portal teams, returns the first team's manager. Returns 0 if none.
func GetGroupManagerForUser(userID int) int {
	var managerID int
	err := DB.QueryRow(`
		SELECT m2.user_id FROM team_members m1
		INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal'
		INNER JOIN team_members m2 ON m2.team_id = t.id AND m2.role = 'manager' AND m2.user_id != $1
		WHERE m1.user_id = $1
		LIMIT 1
	`, userID).Scan(&managerID)
	if err != nil || managerID == 0 {
		return 0
	}
	return managerID
}

// GetGroupManagerForUserInTeam returns the user ID of the "manager" role in the portal team that matches teamNameOrSlug and that the user belongs to. If not found or no manager, returns 0.
// teamNameOrSlug is the request's team field (name or slug). Use this so group manager approval uses the same team the request is for.
func GetGroupManagerForUserInTeam(userID int, teamNameOrSlug string) int {
	if teamNameOrSlug == "" {
		return GetGroupManagerForUser(userID)
	}
	var managerID int
	err := DB.QueryRow(`
		SELECT m2.user_id FROM team_members m1
		INNER JOIN teams t ON t.id = m1.team_id AND COALESCE(t.team_type,'portal') = 'portal'
		  AND (t.name = $2 OR t.slug = $2)
		INNER JOIN team_members m2 ON m2.team_id = t.id AND m2.role = 'manager' AND m2.user_id != $1
		WHERE m1.user_id = $1
		LIMIT 1
	`, userID, teamNameOrSlug).Scan(&managerID)
	if err != nil || managerID == 0 {
		return 0
	}
	return managerID
}

// GetTeamsForUserWithDetails returns team details (id, name, slug, team_type, default_env, default_cloud) for a user
func GetTeamsForUserWithDetails(userID int) ([]Team, error) {
	rows, err := DB.Query(
		`SELECT t.id, t.name, t.slug, COALESCE(t.application_id,''), COALESCE(t.team_type,'portal'), COALESCE(t.default_env,''), COALESCE(t.default_cloud,''), t.created_at, t.created_by
		 FROM teams t INNER JOIN team_members m ON m.team_id = t.id
		 WHERE m.user_id = $1 ORDER BY t.name`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.DefaultEnv, &t.DefaultCloud, &t.CreatedAt, &t.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// GetPortalTeamsManagedByUser returns portal teams that the user can manage: teams where they have role=manager, or (is_portal_manager and they are a member).
func GetPortalTeamsManagedByUser(userID int) ([]Team, error) {
	u, err := GetUserByID(userID)
	if err != nil || u == nil {
		return nil, err
	}
	seen := make(map[int]bool)
	var out []Team
	// Teams where I have role=manager
	rows, err := DB.Query(
		`SELECT t.id, t.name, t.slug, COALESCE(t.application_id,''), COALESCE(t.team_type,'portal'), t.created_at, t.created_by
		 FROM teams t INNER JOIN team_members m ON m.team_id = t.id AND m.user_id = $1 AND m.role = 'manager'
		 WHERE COALESCE(t.team_type,'portal') = 'portal' ORDER BY t.name`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.CreatedAt, &t.CreatedBy); err != nil {
			continue
		}
		if !seen[t.ID] {
			seen[t.ID] = true
			out = append(out, t)
		}
	}
	rows.Close()
	if u.IsPortalManager {
		// Also include any portal team I'm a member of (any role)
		rows2, err2 := DB.Query(
			`SELECT t.id, t.name, t.slug, COALESCE(t.application_id,''), COALESCE(t.team_type,'portal'), t.created_at, t.created_by
			 FROM teams t INNER JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
			 WHERE COALESCE(t.team_type,'portal') = 'portal' ORDER BY t.name`,
			userID,
		)
		if err2 == nil {
			for rows2.Next() {
				var t Team
				if err := rows2.Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.CreatedAt, &t.CreatedBy); err != nil {
					continue
				}
				if !seen[t.ID] {
					seen[t.ID] = true
					out = append(out, t)
				}
			}
			rows2.Close()
		}
	}
	return out, nil
}

// CanUserManagePortalTeam returns true if the user can add/remove members in this portal team (role=manager in team, or is_portal_manager and in team).
func CanUserManagePortalTeam(userID, teamID int) bool {
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil || team.TeamType != "portal" {
		return false
	}
	var hasManagerRole bool
	_ = DB.QueryRow(`SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'manager'`, teamID, userID).Scan(&hasManagerRole)
	if hasManagerRole {
		return true
	}
	u, _ := GetUserByID(userID)
	if u != nil && u.IsPortalManager {
		var inTeam bool
		_ = DB.QueryRow(`SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`, teamID, userID).Scan(&inTeam)
		return inTeam
	}
	return false
}

// GetDevopsTeamsForUser returns devops teams the user belongs to (for DevOps portal).
func GetDevopsTeamsForUser(userID int) ([]Team, error) {
	rows, err := DB.Query(
		`SELECT t.id, t.name, t.slug, COALESCE(t.application_id,''), COALESCE(t.team_type,'portal'), t.created_at, t.created_by
		 FROM teams t INNER JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
		 WHERE COALESCE(t.team_type,'portal') = 'devops' ORDER BY t.name`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.ApplicationID, &t.TeamType, &t.CreatedAt, &t.CreatedBy); err != nil {
			continue
		}
		out = append(out, t)
	}
	return out, nil
}

// CanUserManageDevopsTeam returns true if the user is a DevOps manager and is a member of this devops team.
func CanUserManageDevopsTeam(userID, teamID int) bool {
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil || team.TeamType != "devops" {
		return false
	}
	prof, err := GetDevopsProfile(userID)
	if err != nil || prof == nil || !prof.IsManager {
		return false
	}
	var inTeam bool
	_ = DB.QueryRow(`SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`, teamID, userID).Scan(&inTeam)
	return inTeam
}

// GetUserByEmailOrUsername returns a user by email or username (for add-member by email/username).
func GetUserByEmailOrUsername(emailOrUsername string) (*User, error) {
	emailOrUsername = strings.TrimSpace(emailOrUsername)
	if emailOrUsername == "" {
		return nil, fmt.Errorf("email or username required")
	}
	var u User
	var verified sql.NullBool
	var role, userType sql.NullString
	var managerID sql.NullInt64
	var isPortalManager sql.NullBool
	err := DB.QueryRow(
		`SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), COALESCE(user_type, 'portal_user'), manager_id, COALESCE(is_portal_manager, false), created_at FROM users WHERE email = $1 OR username = $1`,
		emailOrUsername,
	).Scan(&u.ID, &u.Username, &u.Email, &verified, &role, &userType, &managerID, &isPortalManager, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.Verified = verified.Bool
	u.Role = role.String
	u.UserType = userType.String
	if managerID.Valid && managerID.Int64 > 0 {
		m := int(managerID.Int64)
		u.ManagerID = &m
	}
	u.IsPortalManager = isPortalManager.Bool
	return &u, nil
}

// --- Request templates (admin-defined presets) ---
func ListRequestTemplates() ([]RequestTemplate, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`SELECT id, COALESCE(name,''), COALESCE(description,''), cloud, env, COALESCE(service,''), COALESCE(config,'{}'), created_by, created_at FROM request_templates ORDER BY name`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []RequestTemplate{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	var out []RequestTemplate
	for rows.Next() {
		var t RequestTemplate
		var createdBy sql.NullInt64
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.Cloud, &t.Env, &t.Service, &t.Config, &createdBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		if createdBy.Valid && createdBy.Int64 > 0 {
			id := int(createdBy.Int64)
			t.CreatedBy = &id
		}
		t.VisibleToAll = true
		out = append(out, t)
	}
	if err := hydrateRequestTemplatesWithScope(out); err != nil {
		return nil, err
	}
	return out, nil
}

func ListRequestTemplatesForUser(userID int) ([]RequestTemplate, error) {
	templates, err := ListRequestTemplates()
	if err != nil {
		return nil, err
	}
	if len(templates) == 0 {
		return templates, nil
	}
	allowedTeams, err := getPortalTeamIDSetForUser(userID)
	if err != nil {
		return nil, err
	}
	allowedProjects, err := getVisibleProjectIDSetForUser(userID)
	if err != nil {
		return nil, err
	}
	filtered := make([]RequestTemplate, 0, len(templates))
	for _, template := range templates {
		teamAllowed := len(template.Teams) == 0 || templateAccessibleToPortalTeams(template.Teams, allowedTeams)
		projectAllowed := len(template.Projects) == 0 || templateAccessibleToProjects(template.Projects, allowedProjects)
		if teamAllowed && projectAllowed {
			filtered = append(filtered, template)
		}
	}
	return filtered, nil
}

func GetRequestTemplateByID(id int) (*RequestTemplate, error) {
	if DB == nil {
		return nil, nil
	}
	var t RequestTemplate
	var createdBy sql.NullInt64
	err := DB.QueryRow(
		`SELECT id, COALESCE(name,''), COALESCE(description,''), cloud, env, COALESCE(service,''), COALESCE(config,'{}'), created_by, created_at FROM request_templates WHERE id = $1`,
		id,
	).Scan(&t.ID, &t.Name, &t.Description, &t.Cloud, &t.Env, &t.Service, &t.Config, &createdBy, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	if createdBy.Valid && createdBy.Int64 > 0 {
		id := int(createdBy.Int64)
		t.CreatedBy = &id
	}
	t.VisibleToAll = true
	if err := hydrateRequestTemplateWithScope(&t); err != nil {
		return nil, err
	}
	return &t, nil
}

func GetRequestTemplateForUser(id, userID int) (*RequestTemplate, error) {
	template, err := GetRequestTemplateByID(id)
	if err != nil || template == nil {
		return template, err
	}
	allowedTeams, err := getPortalTeamIDSetForUser(userID)
	if err != nil {
		return nil, err
	}
	allowedProjects, err := getVisibleProjectIDSetForUser(userID)
	if err != nil {
		return nil, err
	}
	teamAllowed := len(template.Teams) == 0 || templateAccessibleToPortalTeams(template.Teams, allowedTeams)
	projectAllowed := len(template.Projects) == 0 || templateAccessibleToProjects(template.Projects, allowedProjects)
	if teamAllowed && projectAllowed {
		return template, nil
	}
	return nil, sql.ErrNoRows
}

func CreateRequestTemplate(name, description, cloud, env, service, config string, createdBy *int) (*RequestTemplate, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	var t RequestTemplate
	var createdByValue sql.NullInt64
	err := queryRowContext(
		`INSERT INTO request_templates (name, description, cloud, env, service, config, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, name, description, cloud, env, service, config, created_by, created_at`,
		name, description, cloud, env, service, config, createdBy,
	).Scan(&t.ID, &t.Name, &t.Description, &t.Cloud, &t.Env, &t.Service, &t.Config, &createdByValue, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	if createdByValue.Valid && createdByValue.Int64 > 0 {
		id := int(createdByValue.Int64)
		t.CreatedBy = &id
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam)
	return &t, nil
}

func UpdateRequestTemplate(id int, name, description, cloud, env, service, config string) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := execContext(
		`UPDATE request_templates SET name = $1, description = $2, cloud = $3, env = $4, service = $5, config = $6 WHERE id = $7`,
		name, description, cloud, env, service, config, id,
	)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam)
	}
	return err
}

func DeleteRequestTemplate(id int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := execContext("DELETE FROM request_templates WHERE id = $1", id)
	if err == nil {
		invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam)
	}
	return err
}

func normalizeTeamIDs(teamIDs []int) []int {
	if len(teamIDs) == 0 {
		return nil
	}
	seen := make(map[int]bool, len(teamIDs))
	out := make([]int, 0, len(teamIDs))
	for _, teamID := range teamIDs {
		if teamID <= 0 || seen[teamID] {
			continue
		}
		seen[teamID] = true
		out = append(out, teamID)
	}
	sort.Ints(out)
	return out
}

func ValidatePortalTemplateTeamIDs(teamIDs []int) ([]int, error) {
	normalized := normalizeTeamIDs(teamIDs)
	for _, teamID := range normalized {
		team, err := GetTeamByID(teamID)
		if err != nil {
			return nil, err
		}
		if team == nil {
			return nil, fmt.Errorf("team %d not found", teamID)
		}
		if strings.TrimSpace(strings.ToLower(team.TeamType)) != "" && strings.TrimSpace(strings.ToLower(team.TeamType)) != "portal" {
			return nil, fmt.Errorf("team %s is not a portal team", team.Name)
		}
	}
	return normalized, nil
}

func SetRequestTemplateTeams(templateID int, teamIDs []int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	normalized, err := ValidatePortalTemplateTeamIDs(teamIDs)
	if err != nil {
		return err
	}
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM request_template_teams WHERE template_id = $1`, templateID); err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		return err
	}
	for _, teamID := range normalized {
		if _, err := tx.Exec(
			`INSERT INTO request_template_teams (template_id, team_id) VALUES ($1, $2) ON CONFLICT (template_id, team_id) DO NOTHING`,
			templateID,
			teamID,
		); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam)
	return nil
}

func ValidateTemplateProjectIDs(projectIDs []int) ([]int, error) {
	normalized := normalizeTeamIDs(projectIDs)
	for _, projectID := range normalized {
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			return nil, err
		}
		if project == nil {
			return nil, fmt.Errorf("project %d not found", projectID)
		}
	}
	return normalized, nil
}

func SetRequestTemplateProjects(templateID int, projectIDs []int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	normalized, err := ValidateTemplateProjectIDs(projectIDs)
	if err != nil {
		return err
	}
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM request_template_projects WHERE template_id = $1`, templateID); err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		return err
	}
	for _, projectID := range normalized {
		if _, err := tx.Exec(
			`INSERT INTO request_template_projects (template_id, project_id) VALUES ($1, $2) ON CONFLICT (template_id, project_id) DO NOTHING`,
			templateID,
			projectID,
		); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	invalidateCacheNamespaces(cacheNamespaceAdmin, cacheNamespaceTeam)
	return nil
}

func GetRequestTemplateProjects(templateID int) ([]ProjectSummary, error) {
	if DB == nil {
		return []ProjectSummary{}, nil
	}
	rows, err := DB.Query(
		`SELECT p.id, COALESCE(p.name,''), COALESCE(p.code,''), COALESCE(p.status,'active')
		 FROM request_template_projects rtp
		 INNER JOIN projects p ON p.id = rtp.project_id
		 WHERE rtp.template_id = $1
		 ORDER BY p.name`,
		templateID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []ProjectSummary{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := make([]ProjectSummary, 0)
	for rows.Next() {
		var project ProjectSummary
		if err := rows.Scan(&project.ID, &project.Name, &project.Code, &project.Status); err != nil {
			return nil, err
		}
		out = append(out, project)
	}
	return out, nil
}

func GetRequestTemplateTeams(templateID int) ([]Team, error) {
	if DB == nil {
		return []Team{}, nil
	}
	rows, err := DB.Query(
		`SELECT t.id, t.name, t.slug, COALESCE(t.application_id,''), COALESCE(t.team_type,'portal'), COALESCE(t.default_env,''), COALESCE(t.default_cloud,''), t.created_at, t.created_by
		 FROM request_template_teams rtt
		 INNER JOIN teams t ON t.id = rtt.team_id
		 WHERE rtt.template_id = $1 AND COALESCE(t.team_type,'portal') = 'portal'
		 ORDER BY t.name`,
		templateID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []Team{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := make([]Team, 0)
	for rows.Next() {
		var team Team
		if err := rows.Scan(&team.ID, &team.Name, &team.Slug, &team.ApplicationID, &team.TeamType, &team.DefaultEnv, &team.DefaultCloud, &team.CreatedAt, &team.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, team)
	}
	return out, nil
}

func hydrateRequestTemplateWithScope(template *RequestTemplate) error {
	if template == nil {
		return nil
	}
	teams, err := GetRequestTemplateTeams(template.ID)
	if err != nil {
		return err
	}
	projects, err := GetRequestTemplateProjects(template.ID)
	if err != nil {
		return err
	}
	template.Teams = teams
	template.Projects = projects
	template.VisibleToAll = len(teams) == 0 && len(projects) == 0
	return nil
}

func hydrateRequestTemplatesWithScope(templates []RequestTemplate) error {
	for i := range templates {
		if err := hydrateRequestTemplateWithScope(&templates[i]); err != nil {
			return err
		}
	}
	return nil
}

func getPortalTeamIDSetForUser(userID int) (map[int]bool, error) {
	teams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return nil, err
	}
	out := make(map[int]bool, len(teams))
	for _, team := range teams {
		if strings.TrimSpace(strings.ToLower(team.TeamType)) == "devops" {
			continue
		}
		out[team.ID] = true
	}
	return out, nil
}

func templateAccessibleToPortalTeams(templateTeams []Team, allowedTeams map[int]bool) bool {
	for _, team := range templateTeams {
		if allowedTeams[team.ID] {
			return true
		}
	}
	return false
}

func templateAccessibleToProjects(templateProjects []ProjectSummary, allowedProjects map[int]bool) bool {
	for _, project := range templateProjects {
		if allowedProjects[project.ID] {
			return true
		}
	}
	return false
}

// --- User saved configs (favorites) ---
func ListUserSavedConfigs(userID int) ([]UserSavedConfig, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(
		`SELECT id, user_id, COALESCE(name,''), COALESCE(config,'{}'), COALESCE(cloud,''), COALESCE(env,''), COALESCE(service,''), created_at FROM user_saved_configs WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserSavedConfig
	for rows.Next() {
		var c UserSavedConfig
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.Config, &c.Cloud, &c.Env, &c.Service, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func GetUserSavedConfigByID(id, userID int) (*UserSavedConfig, error) {
	if DB == nil {
		return nil, nil
	}
	var c UserSavedConfig
	err := DB.QueryRow(
		`SELECT id, user_id, COALESCE(name,''), COALESCE(config,'{}'), COALESCE(cloud,''), COALESCE(env,''), COALESCE(service,''), created_at FROM user_saved_configs WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&c.ID, &c.UserID, &c.Name, &c.Config, &c.Cloud, &c.Env, &c.Service, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func CreateUserSavedConfig(userID int, name, config, cloud, env, service string) (*UserSavedConfig, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	var c UserSavedConfig
	err := DB.QueryRow(
		`INSERT INTO user_saved_configs (user_id, name, config, cloud, env, service) VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, user_id, name, config, cloud, env, service, created_at`,
		userID, name, config, cloud, env, service,
	).Scan(&c.ID, &c.UserID, &c.Name, &c.Config, &c.Cloud, &c.Env, &c.Service, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func DeleteUserSavedConfig(id, userID int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	res, err := DB.Exec("DELETE FROM user_saved_configs WHERE id = $1 AND user_id = $2", id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}
