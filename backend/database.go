package main

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const applicationIDChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// GenerateApplicationID returns a unique 10-char alphanumeric ID (no special chars)
func GenerateApplicationID() (string, error) {
	for i := 0; i < 100; i++ {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return "", err
		}
		for j := range b {
			b[j] = applicationIDChars[int(b[j])%len(applicationIDChars)]
		}
		id := string(b)
		if DB == nil {
			return id, nil
		}
		var exists int
		err := DB.QueryRow("SELECT 1 FROM pr_requests WHERE application_id = $1 LIMIT 1", id).Scan(&exists)
		if err == sql.ErrNoRows {
			return id, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("could not generate unique application_id after 100 attempts")
}

var DB *sql.DB

type PRRequest struct {
	ID            int        `json:"id"`
	Team          string     `json:"team"`
	Env           string     `json:"env"`
	Cloud         string     `json:"cloud"`
	Service       string     `json:"service"`
	ClientName    string     `json:"client_name"`
	ApplicationID string     `json:"application_id"` // unique 10-char alphanumeric, used in branch/PR
	Priority      string     `json:"priority"`      // low, medium, high, urgent
	DueDate       *time.Time `json:"due_date"`
	PRURL         string     `json:"pr_url"`
	Branch        string     `json:"branch"`
	FilePath      string     `json:"file_path"`
	Status       string     `json:"status"` // draft, pending_user_manager_approval, pending_devops_approval, pending_approval, in_progress, completed, rejected
	RejectReason string     `json:"reject_reason"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	CreatedBy    *int       `json:"created_by"`
	AssignedTo   *int       `json:"assigned_to"` // DevOps user assigned after PR creation (by priority)
	Config       string     `json:"config"`
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
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	Password     string    `json:"-"` // Don't return password in JSON
	Verified     bool      `json:"verified"`
	Role         string    `json:"role"` // viewer | contributor | admin
	UserType     string    `json:"user_type"` // portal_user | devops_user
	ManagerID    *int      `json:"manager_id"` // portal user's manager (for two-step approval)
	CreatedAt    time.Time `json:"created_at"`
}

// DevopsProfile holds DevOps-specific fields for users with user_type = devops_user
type DevopsProfile struct {
	UserID      int       `json:"user_id"`
	IsManager   bool      `json:"is_manager"`
	Position    string    `json:"position"`
	OnboardDate *string   `json:"onboard_date"` // YYYY-MM-DD
	Level       string    `json:"level"`       // L1, L2, L3, L4
}

// Team is a group created by admin (for admin frontend). team_type: portal (user portal group) | devops (DevOps team)
type Team struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	TeamType  string    `json:"team_type"` // portal | devops
	CreatedAt time.Time `json:"created_at"`
	CreatedBy *int      `json:"created_by"`
}

// TeamMember links a user to a team. For portal teams: role is developer | senior_developer | lead | manager. For devops: member | lead.
type TeamMember struct {
	ID        int       `json:"id"`
	TeamID    int       `json:"team_id"`
	UserID    int       `json:"user_id"`
	Role      string    `json:"role"` // developer, senior_developer, lead, manager (portal) | member, lead (devops)
	CreatedAt time.Time `json:"created_at"`
}

// InitDB initializes the PostgreSQL database connection
func InitDB() error {
	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "postgres"
	}
	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" {
		dbUser = "postgres"
	}
	dbPassword := os.Getenv("DB_PASSWORD")
	if dbPassword == "" {
		dbPassword = "postgres"
	}
	dbName := os.Getenv("DB_NAME")
	if dbName == "" {
		dbName = "infra_portal"
	}

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	var err error
	DB, err = sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Set connection pool settings
	DB.SetMaxOpenConns(25)                 // Maximum number of open connections
	DB.SetMaxIdleConns(5)                   // Maximum number of idle connections
	DB.SetConnMaxLifetime(5 * time.Minute) // Maximum connection lifetime

	log.Println("Database connection established with connection pooling")

	// Create tables
	if err := createTables(); err != nil {
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

	log.Println("Database tables created/verified")
	return nil
}

// SavePRRequest saves a PR request to the database (pr_url may be "" for pending_approval or draft)
func SavePRRequest(req *PRRequest) error {
	query := `
		INSERT INTO pr_requests (team, env, cloud, service, client_name, application_id, priority, due_date, pr_url, branch, file_path, status, config, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id, created_at, updated_at
	`
	err := DB.QueryRow(
		query,
		req.Team, req.Env, req.Cloud, req.Service, req.ClientName,
		req.ApplicationID, req.Priority, req.DueDate, req.PRURL, req.Branch, req.FilePath, req.Status,
		req.Config, req.CreatedBy,
	).Scan(&req.ID, &req.CreatedAt, &req.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to save PR request: %w", err)
	}

	return nil
}

// UpdatePRRequestStatus sets status and updated_at for a request
func UpdatePRRequestStatus(id int, status string) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		status, id,
	)
	return err
}

// UpdatePRRequestReject sets status to rejected and optional reject_reason
func UpdatePRRequestReject(id int, reason string) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET status = 'rejected', reject_reason = COALESCE(NULLIF(TRIM($1),''), reject_reason), updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		reason, id,
	)
	return err
}

// UpdatePRRequestWithPR sets pr_url and status to in_progress after PR is created
func UpdatePRRequestWithPR(id int, prURL string) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET pr_url = $1, status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		prURL, id,
	)
	return err
}

// UpdatePRRequestAssignedTo sets assigned_to for a request (used after PR creation)
func UpdatePRRequestAssignedTo(requestID, userID int) error {
	_, err := DB.Exec(
		"UPDATE pr_requests SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		userID, requestID,
	)
	return err
}

// PriorityToLevel maps request priority to DevOps level for assignment (Critical/urgent->L4, High->L3, Medium->L2, Low->L1)
func PriorityToLevel(priority string) string {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "urgent", "critical":
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

// AssignRequestByPriority assigns the request to a DevOps user by priority (L4 for critical/urgent, L3 high, L2 medium, L1 low). Picks a non-manager devops user with that level (least assigned first).
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

// GetPRRequests retrieves PR requests with optional filters. If createdByIn is non-empty, filter by created_by IN (createdByIn); else if userIDInt > 0, filter by created_by = userIDInt.
func GetPRRequests(team, env, cloud, statusFilter, priorityFilter, search string, prID int, userIDInt int, createdByIn []int, limit, offset int) ([]PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, COALESCE(client_name,'') AS client_name, COALESCE(application_id,'') AS application_id, COALESCE(priority,'medium') AS priority, due_date, pr_url, branch, file_path, status, COALESCE(reject_reason,'') AS reject_reason, config, created_by, assigned_to, created_at, updated_at
		FROM pr_requests
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

	if search != "" {
		searchVal := "%" + search + "%"
		query += fmt.Sprintf(` AND (team ILIKE $%d OR env ILIKE $%d OR cloud ILIKE $%d OR service ILIKE $%d OR COALESCE(client_name,'') ILIKE $%d OR branch ILIKE $%d OR COALESCE(config,'')::text ILIKE $%d)`,
			argPos, argPos, argPos, argPos, argPos, argPos, argPos)
		args = append(args, searchVal)
		argPos++
	}

	if prID > 0 {
		query += fmt.Sprintf(" AND id = $%d", argPos)
		args = append(args, prID)
		argPos++
	}

	if team != "" {
		query += fmt.Sprintf(" AND team ILIKE $%d", argPos)
		args = append(args, "%"+team+"%")
		argPos++
	}

	if env != "" {
		query += fmt.Sprintf(" AND env ILIKE $%d", argPos)
		args = append(args, "%"+env+"%")
		argPos++
	}

	if cloud != "" {
		query += fmt.Sprintf(" AND cloud ILIKE $%d", argPos)
		args = append(args, "%"+cloud+"%")
		argPos++
	}

	if statusFilter != "" {
		query += fmt.Sprintf(" AND status = $%d", argPos)
		args = append(args, statusFilter)
		argPos++
	}

	if priorityFilter != "" {
		query += fmt.Sprintf(" AND COALESCE(priority,'medium') = $%d", argPos)
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
		query += " AND created_by IN (" + strings.Join(placeholders, ",") + ")"
	} else if userIDInt > 0 {
		query += fmt.Sprintf(" AND created_by = $%d", argPos)
		args = append(args, userIDInt)
		argPos++
	}

	query += " ORDER BY created_at DESC"

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
		var createdBy, assignedTo sql.NullInt64
		var dueDate sql.NullTime
		err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt,
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
		if dueDate.Valid {
			req.DueDate = &dueDate.Time
		}
		requests = append(requests, req)
	}

	return requests, nil
}

// GetPRRequestByID retrieves a single PR request by ID
func GetPRRequestByID(id int) (*PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, COALESCE(client_name,'') AS client_name, COALESCE(application_id,'') AS application_id, COALESCE(priority,'medium') AS priority, due_date, pr_url, branch, file_path, status, COALESCE(reject_reason,'') AS reject_reason, config, created_by, assigned_to, created_at, updated_at
		FROM pr_requests WHERE id = $1
	`
	var req PRRequest
	var createdBy, assignedTo sql.NullInt64
	var dueDate sql.NullTime
	err := DB.QueryRow(query, id).Scan(
		&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
		&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
		&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt,
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
	if dueDate.Valid {
		req.DueDate = &dueDate.Time
	}
	return &req, nil
}

// GetPRRequestsByAssignedTo returns PR requests assigned to the given user (for DevOps "my tickets")
func GetPRRequestsByAssignedTo(assigneeID int, limit, offset int) ([]PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, COALESCE(client_name,'') AS client_name, COALESCE(application_id,'') AS application_id, COALESCE(priority,'medium') AS priority, due_date, pr_url, branch, file_path, status, COALESCE(reject_reason,'') AS reject_reason, config, created_by, assigned_to, created_at, updated_at
		FROM pr_requests WHERE assigned_to = $1
		ORDER BY updated_at DESC
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
		var createdBy, assignedTo sql.NullInt64
		var dueDate sql.NullTime
		if err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt,
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
		if dueDate.Valid {
			req.DueDate = &dueDate.Time
		}
		requests = append(requests, req)
	}
	return requests, nil
}

// WorkloadItem is a request with assignee info for the DevOps manager workload view
type WorkloadItem struct {
	Request         PRRequest `json:"request"`
	AssigneeID      int       `json:"assignee_id"`
	AssigneeUsername string   `json:"assignee_username"`
}

// GetWorkloadAssignedRequests returns all requests that have an assignee (for DevOps manager workload view)
func GetWorkloadAssignedRequests() ([]WorkloadItem, error) {
	query := `
		SELECT p.id, p.team, p.env, p.cloud, p.service, COALESCE(p.client_name,'') AS client_name, COALESCE(p.application_id,'') AS application_id, COALESCE(p.priority,'medium') AS priority, p.due_date, p.pr_url, p.branch, p.file_path, p.status, COALESCE(p.reject_reason,'') AS reject_reason, p.config, p.created_by, p.assigned_to, p.created_at, p.updated_at, u.username AS assignee_username
		FROM pr_requests p
		INNER JOIN users u ON u.id = p.assigned_to
		WHERE p.assigned_to IS NOT NULL
		ORDER BY p.updated_at DESC
	`
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkloadItem
	for rows.Next() {
		var req PRRequest
		var createdBy, assignedTo sql.NullInt64
		var dueDate sql.NullTime
		var assigneeUsername string
		if err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service, &req.ClientName,
			&req.ApplicationID, &req.Priority, &dueDate, &req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.RejectReason, &req.Config, &createdBy, &assignedTo, &req.CreatedAt, &req.UpdatedAt,
			&assigneeUsername,
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
		if dueDate.Valid {
			req.DueDate = &dueDate.Time
		}
		item := WorkloadItem{Request: req, AssigneeUsername: assigneeUsername}
		if req.AssignedTo != nil {
			item.AssigneeID = *req.AssignedTo
		}
		out = append(out, item)
	}
	return out, nil
}

// UpdatePRRequestFull updates a draft request (config, priority, due_date, status). Only for draft requests.
func UpdatePRRequestFull(id int, config string, priority string, dueDate *time.Time, status string) error {
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

// GetUserByID retrieves a user by ID (without password). UserType and devops profile are loaded separately when needed.
func GetUserByID(id int) (*User, error) {
	var user User
	var verified sql.NullBool
	var role sql.NullString
	var userType sql.NullString
	var managerID sql.NullInt64
	err := DB.QueryRow(
		"SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), COALESCE(user_type, 'portal_user'), manager_id, created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &verified, &role, &userType, &managerID, &user.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
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
	return &user, nil
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

// GetTotalCount returns total count of PR requests (for pagination). Same createdByIn/userIDInt logic as GetPRRequests.
func GetTotalCount(team, env, cloud, statusFilter, priorityFilter, search string, prID int, userIDInt int, createdByIn []int) (int, error) {
	query := "SELECT COUNT(*) FROM pr_requests WHERE 1=1"
	args := []interface{}{}
	argPos := 1

	if search != "" {
		searchVal := "%" + search + "%"
		query += fmt.Sprintf(` AND (team ILIKE $%d OR env ILIKE $%d OR cloud ILIKE $%d OR service ILIKE $%d OR COALESCE(client_name,'') ILIKE $%d OR branch ILIKE $%d OR COALESCE(config,'')::text ILIKE $%d)`,
			argPos, argPos, argPos, argPos, argPos, argPos, argPos)
		args = append(args, searchVal)
		argPos++
	}

	if prID > 0 {
		query += fmt.Sprintf(" AND id = $%d", argPos)
		args = append(args, prID)
		argPos++
	}
	if team != "" {
		query += fmt.Sprintf(" AND team ILIKE $%d", argPos)
		args = append(args, "%"+team+"%")
		argPos++
	}
	if env != "" {
		query += fmt.Sprintf(" AND env ILIKE $%d", argPos)
		args = append(args, "%"+env+"%")
		argPos++
	}
	if cloud != "" {
		query += fmt.Sprintf(" AND cloud ILIKE $%d", argPos)
		args = append(args, "%"+cloud+"%")
		argPos++
	}
	if statusFilter != "" {
		query += fmt.Sprintf(" AND status = $%d", argPos)
		args = append(args, statusFilter)
		argPos++
	}
	if priorityFilter != "" {
		query += fmt.Sprintf(" AND COALESCE(priority,'medium') = $%d", argPos)
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
		query += " AND created_by IN (" + strings.Join(placeholders, ",") + ")"
	} else if userIDInt > 0 {
		query += fmt.Sprintf(" AND created_by = $%d", argPos)
		args = append(args, userIDInt)
		argPos++
	}

	var count int
	err := DB.QueryRow(query, args...).Scan(&count)
	return count, err
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
	ID           int       `json:"id"`
	AdminUserID  *int      `json:"admin_user_id"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resource_type"`
	ResourceID   string    `json:"resource_id"`
	Details      string    `json:"details"`
	CreatedAt    time.Time `json:"created_at"`
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

// GetAuditLogs returns recent audit log entries with optional filters
func GetAuditLogs(limit, offset int, actionFilter string) ([]AuditLogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, admin_user_id, action, resource_type, COALESCE(resource_id,''), COALESCE(details,''), created_at
		FROM admin_audit_log
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1
	if actionFilter != "" {
		query += fmt.Sprintf(" AND action = $%d", argPos)
		args = append(args, actionFilter)
		argPos++
	}
	query += " ORDER BY created_at DESC"
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
		var adminID sql.NullInt64
		if err := rows.Scan(&e.ID, &adminID, &e.Action, &e.ResourceType, &e.ResourceID, &e.Details, &e.CreatedAt); err != nil {
			return nil, err
		}
		if adminID.Valid {
			id := int(adminID.Int64)
			e.AdminUserID = &id
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
	_ = DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&s.TotalUsers)
	_ = DB.QueryRow("SELECT COUNT(*) FROM teams").Scan(&s.TotalTeams)
	_ = DB.QueryRow("SELECT COUNT(*) FROM users WHERE COALESCE(verified, false) = false").Scan(&s.UnverifiedUsers)
	_ = DB.QueryRow("SELECT COUNT(*) FROM pr_requests WHERE created_at >= NOW() - INTERVAL '7 days'").Scan(&s.RequestsThisWeek)
	_ = DB.QueryRow("SELECT COUNT(*) FROM pr_requests WHERE status IN ('pending_approval', 'pending_devops_approval', 'pending_user_manager_approval')").Scan(&s.PendingApproval)
	return s, nil
}

// DateRangeStats holds request counts by status for a date range
type DateRangeStats struct {
	From      string            `json:"from"`
	To        string            `json:"to"`
	Total     int               `json:"total"`
	ByStatus  map[string]int    `json:"by_status"`
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
	_ = DB.QueryRow(
		`SELECT COUNT(*) FROM pr_requests WHERE created_at::date >= $1::date AND created_at::date <= $2::date`,
		fromStr, toStr,
	).Scan(&s.Total)

	// Per status
	rows, err := DB.Query(
		`SELECT status, COUNT(*) FROM pr_requests 
		 WHERE created_at::date >= $1::date AND created_at::date <= $2::date 
		 GROUP BY status`,
		fromStr, toStr,
	)
	if err != nil {
		return s, err
	}
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

// CreateTeam creates a new team (admin only). teamType: "portal" | "devops"
func CreateTeam(name, slug, teamType string, createdBy *int) (*Team, error) {
	if slug == "" {
		slug = strings.ToLower(strings.ReplaceAll(name, " ", "-"))
	}
	if teamType != "devops" && teamType != "portal" {
		teamType = "portal"
	}
	var t Team
	err := DB.QueryRow(
		`INSERT INTO teams (name, slug, team_type, created_by) VALUES ($1, $2, $3, $4)
		 RETURNING id, name, slug, COALESCE(team_type,'portal'), created_at, created_by`,
		name, slug, teamType, createdBy,
	).Scan(&t.ID, &t.Name, &t.Slug, &t.TeamType, &t.CreatedAt, &t.CreatedBy)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTeams returns all teams
func GetTeams() ([]Team, error) {
	rows, err := DB.Query(`SELECT id, name, slug, COALESCE(team_type,'portal'), created_at, created_by FROM teams ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.TeamType, &t.CreatedAt, &t.CreatedBy); err != nil {
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
		`SELECT id, name, slug, COALESCE(team_type,'portal'), created_at, created_by FROM teams WHERE id = $1`, id,
	).Scan(&t.ID, &t.Name, &t.Slug, &t.TeamType, &t.CreatedAt, &t.CreatedBy)
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
	err := DB.QueryRow(
		`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)
		 RETURNING id, team_id, user_id, role, created_at`,
		teamID, userID, role,
	).Scan(&m.ID, &m.TeamID, &m.UserID, &m.Role, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// RemoveTeamMember removes a user from a team
func RemoveTeamMember(teamID, userID int) error {
	_, err := DB.Exec(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, teamID, userID)
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
	result, err := DB.Exec(`UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3`, role, teamID, userID)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("team member not found")
	}
	return nil
}

// DeleteTeam deletes a team and cascades to team_members (ON DELETE CASCADE)
func DeleteTeam(teamID int) error {
	_, err := DB.Exec(`DELETE FROM teams WHERE id = $1`, teamID)
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

// GetTeamsForUserWithDetails returns team details (id, name, slug, team_type) for a user
func GetTeamsForUserWithDetails(userID int) ([]Team, error) {
	rows, err := DB.Query(
		`SELECT t.id, t.name, t.slug, COALESCE(t.team_type,'portal'), t.created_at, t.created_by
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
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.TeamType, &t.CreatedAt, &t.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}
