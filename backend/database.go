package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

var DB *sql.DB

type PRRequest struct {
	ID          int       `json:"id"`
	Team        string    `json:"team"`
	Env         string    `json:"env"`
	Cloud       string    `json:"cloud"`
	Service     string    `json:"service"`
	PRURL       string    `json:"pr_url"`
	Branch      string    `json:"branch"`
	FilePath    string    `json:"file_path"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	CreatedBy   *int      `json:"created_by"` // Use pointer to allow NULL
	Config      string    `json:"config"` // JSON string of the full config
}

type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	Password     string    `json:"-"` // Don't return password in JSON
	Verified     bool      `json:"verified"`
	Role         string    `json:"role"` // viewer | contributor | admin
	CreatedAt    time.Time `json:"created_at"`
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

	// Create indexes
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_team ON pr_requests(team);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_env ON pr_requests(env);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_created_by ON pr_requests(created_by);",
		"CREATE INDEX IF NOT EXISTS idx_pr_requests_created_at ON pr_requests(created_at DESC);",
	}

	if _, err := DB.Exec(usersTable); err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	if _, err := DB.Exec(prRequestsTable); err != nil {
		return fmt.Errorf("failed to create pr_requests table: %w", err)
	}

	for _, index := range indexes {
		if _, err := DB.Exec(index); err != nil {
			log.Printf("Warning: failed to create index: %v", err)
		}
	}

	log.Println("Database tables created/verified")
	return nil
}

// SavePRRequest saves a PR request to the database
func SavePRRequest(req *PRRequest) error {
	query := `
		INSERT INTO pr_requests (team, env, cloud, service, pr_url, branch, file_path, status, config, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at
	`
	err := DB.QueryRow(
		query,
		req.Team, req.Env, req.Cloud, req.Service,
		req.PRURL, req.Branch, req.FilePath, req.Status,
		req.Config, req.CreatedBy, // Will be NULL if CreatedBy is nil
	).Scan(&req.ID, &req.CreatedAt, &req.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to save PR request: %w", err)
	}

	return nil
}

// GetPRRequests retrieves PR requests with optional filters
func GetPRRequests(team, env, cloud string, prID int, userIDInt int, limit, offset int) ([]PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, pr_url, branch, file_path, status, config, created_by, created_at, updated_at
		FROM pr_requests
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

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

	if userIDInt > 0 {
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
		var createdBy sql.NullInt64
		err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service,
			&req.PRURL, &req.Branch, &req.FilePath, &req.Status,
			&req.Config, &createdBy, &req.CreatedAt, &req.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan PR request: %w", err)
		}
		// Convert sql.NullInt64 to *int
		if createdBy.Valid {
			val := int(createdBy.Int64)
			req.CreatedBy = &val
		} else {
			req.CreatedBy = nil
		}
		requests = append(requests, req)
	}

	return requests, nil
}

// GetPRRequestByID retrieves a single PR request by ID
func GetPRRequestByID(id int) (*PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, pr_url, branch, file_path, status, config, created_by, created_at, updated_at
		FROM pr_requests WHERE id = $1
	`
	var req PRRequest
	var createdBy sql.NullInt64
	err := DB.QueryRow(query, id).Scan(
		&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service,
		&req.PRURL, &req.Branch, &req.FilePath, &req.Status,
		&req.Config, &createdBy, &req.CreatedAt, &req.UpdatedAt,
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
	return &req, nil
}

// GetUserByID retrieves a user by ID (without password)
func GetUserByID(id int) (*User, error) {
	var user User
	var verified sql.NullBool
	var role sql.NullString
	err := DB.QueryRow(
		"SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &verified, &role, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	user.Verified = verified.Valid && verified.Bool
	user.Role = "viewer"
	if role.Valid && role.String != "" {
		user.Role = role.String
	}
	return &user, nil
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

// GetTotalCount returns total count of PR requests (for pagination)
func GetTotalCount(team, env, cloud string, prID int, userIDInt int) (int, error) {
	query := "SELECT COUNT(*) FROM pr_requests WHERE 1=1"
	args := []interface{}{}
	argPos := 1

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
	if userIDInt > 0 {
		query += fmt.Sprintf(" AND created_by = $%d", argPos)
		args = append(args, userIDInt)
		argPos++
	}

	var count int
	err := DB.QueryRow(query, args...).Scan(&count)
	return count, err
}
