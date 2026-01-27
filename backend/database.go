package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type RequestHistory struct {
	ID          int64     `json:"id"`
	Team        string    `json:"team"`
	Env         string    `json:"env"`
	Cloud       string    `json:"cloud"`
	Service     string    `json:"service"`
	Payload     string    `json:"payload"` // JSON string
	PrURL       string    `json:"pr_url"`
	Branch      string    `json:"branch"`
	FilePath    string    `json:"file_path"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

var db *sql.DB

// InitDB initializes the SQLite database
func InitDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./requests.db")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Create table if it doesn't exist
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS request_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		team TEXT NOT NULL,
		env TEXT NOT NULL,
		cloud TEXT NOT NULL,
		service TEXT NOT NULL,
		payload TEXT NOT NULL,
		pr_url TEXT,
		branch TEXT NOT NULL,
		file_path TEXT NOT NULL,
		status TEXT DEFAULT 'pending',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_team_env ON request_history(team, env);
	CREATE INDEX IF NOT EXISTS idx_created_at ON request_history(created_at);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create table: %w", err)
	}

	log.Println("Database initialized successfully")
	return nil
}

// SaveRequest saves a request to the database
func SaveRequest(team, env, cloud, service, branch, filePath, prURL string, payload map[string]interface{}) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	status := "pending"
	if prURL != "" {
		status = "pr_created"
	}

	query := `
	INSERT INTO request_history (team, env, cloud, service, payload, pr_url, branch, file_path, status)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err = db.Exec(query, team, env, cloud, service, string(payloadJSON), prURL, branch, filePath, status)
	if err != nil {
		return fmt.Errorf("failed to insert request: %w", err)
	}

	log.Printf("Saved request to database: team=%s, env=%s, cloud=%s, service=%s", team, env, cloud, service)
	return nil
}

// GetRequestHistory retrieves request history with optional filters
func GetRequestHistory(team, env string, limit int) ([]RequestHistory, error) {
	var rows *sql.Rows
	var err error

	if team != "" && env != "" {
		query := `
		SELECT id, team, env, cloud, service, payload, pr_url, branch, file_path, status, created_at, updated_at
		FROM request_history
		WHERE team = ? AND env = ?
		ORDER BY created_at DESC
		LIMIT ?
		`
		rows, err = db.Query(query, team, env, limit)
	} else if team != "" {
		query := `
		SELECT id, team, env, cloud, service, payload, pr_url, branch, file_path, status, created_at, updated_at
		FROM request_history
		WHERE team = ?
		ORDER BY created_at DESC
		LIMIT ?
		`
		rows, err = db.Query(query, team, limit)
	} else {
		query := `
		SELECT id, team, env, cloud, service, payload, pr_url, branch, file_path, status, created_at, updated_at
		FROM request_history
		ORDER BY created_at DESC
		LIMIT ?
		`
		rows, err = db.Query(query, limit)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []RequestHistory
	for rows.Next() {
		var req RequestHistory
		err := rows.Scan(
			&req.ID, &req.Team, &req.Env, &req.Cloud, &req.Service,
			&req.Payload, &req.PrURL, &req.Branch, &req.FilePath, &req.Status,
			&req.CreatedAt, &req.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		requests = append(requests, req)
	}

	return requests, nil
}

// CloseDB closes the database connection
func CloseDB() error {
	if db != nil {
		return db.Close()
	}
	return nil
}
