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
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"` // Don't return password in JSON
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
func GetPRRequests(team, env string, userIDInt int, limit, offset int) ([]PRRequest, error) {
	query := `
		SELECT id, team, env, cloud, service, pr_url, branch, file_path, status, config, created_by, created_at, updated_at
		FROM pr_requests
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

	if team != "" {
		query += fmt.Sprintf(" AND team = $%d", argPos)
		args = append(args, team)
		argPos++
	}

	if env != "" {
		query += fmt.Sprintf(" AND env = $%d", argPos)
		args = append(args, env)
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
