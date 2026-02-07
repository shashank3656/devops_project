package main

import (
	"database/sql"
	"fmt"
	"log"
)

// MigrateDatabase updates the database schema (created_by nullable, users verification/role)
func MigrateDatabase() error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}

	// Migration 1: pr_requests.created_by nullable
	var isNullable string
	err := DB.QueryRow(`
		SELECT is_nullable 
		FROM information_schema.columns 
		WHERE table_name = 'pr_requests' 
		AND column_name = 'created_by'
	`).Scan(&isNullable)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("failed to check column: %w", err)
	}
	if isNullable == "NO" {
		log.Println("Migrating database: allowing NULL for created_by column...")
		_, _ = DB.Exec(`ALTER TABLE pr_requests DROP CONSTRAINT IF EXISTS pr_requests_created_by_fkey`)
		_, err = DB.Exec(`ALTER TABLE pr_requests ALTER COLUMN created_by DROP NOT NULL`)
		if err != nil {
			return fmt.Errorf("failed to make column nullable: %w", err)
		}
		_, _ = DB.Exec(`
			ALTER TABLE pr_requests 
			ADD CONSTRAINT pr_requests_created_by_fkey 
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
		`)
		log.Println("Database migration (created_by) completed")
	}

	// Migration 2: users.verified, verification_token, verification_token_expires_at, role
	for _, col := range []string{"verified", "verification_token", "verification_token_expires_at", "role"} {
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*) FROM information_schema.columns 
			WHERE table_name = 'users' AND column_name = $1
		`, col).Scan(&count)
		if err != nil {
			return fmt.Errorf("failed to check users column %s: %w", col, err)
		}
		if count == 0 {
			log.Printf("Migrating database: adding users.%s...", col)
			var alter string
			switch col {
			case "verified":
				alter = "ALTER TABLE users ADD COLUMN verified BOOLEAN DEFAULT FALSE"
			case "verification_token":
				alter = "ALTER TABLE users ADD COLUMN verification_token VARCHAR(255)"
			case "verification_token_expires_at":
				alter = "ALTER TABLE users ADD COLUMN verification_token_expires_at TIMESTAMP"
			case "role":
				alter = "ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'viewer'"
			default:
				continue
			}
			if _, err := DB.Exec(alter); err != nil {
				return fmt.Errorf("failed to add users.%s: %w", col, err)
			}
		}
	}
	// Migration 3: request_tags table (tags on PR requests)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_tags (
			id SERIAL PRIMARY KEY,
			request_id INTEGER NOT NULL REFERENCES pr_requests(id) ON DELETE CASCADE,
			tag VARCHAR(100) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(request_id, tag)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_tags_request_id ON request_tags(request_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_tags_tag ON request_tags(tag)")

	// Migration 4: user_activity table (user actions for activity feed)
	_, _ = DB.Exec(`
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
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC)")

	// Migration 5: api_keys table (for programmatic access)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			key_hash VARCHAR(64) NOT NULL UNIQUE,
			last_used_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)

	// Migration 6: application_id on pr_requests (unique 10-char alphanumeric per request)
	var appIdCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'application_id'").Scan(&appIdCount)
	if appIdCount == 0 {
		log.Println("Migrating database: adding pr_requests.application_id...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN application_id VARCHAR(10) DEFAULT ''")
		_, _ = DB.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_requests_application_id ON pr_requests(application_id) WHERE application_id != ''")
		log.Println("Database migration (application_id) completed")
	}

	// Migration 7: saved_filter_views (admin saved filters)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS saved_filter_views (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			filters JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)

	// Migration 8: user_type (portal_user | devops_user) and devops_profiles
	var userTypeCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'user_type'").Scan(&userTypeCount)
	if userTypeCount == 0 {
		log.Println("Migrating database: adding users.user_type...")
		_, _ = DB.Exec("ALTER TABLE users ADD COLUMN user_type VARCHAR(50) DEFAULT 'portal_user'")
		_, _ = DB.Exec("UPDATE users SET user_type = 'portal_user' WHERE user_type IS NULL")
		log.Println("Database migration (user_type) completed")
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS devops_profiles (
			user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			is_manager BOOLEAN DEFAULT FALSE,
			position VARCHAR(200) DEFAULT '',
			onboard_date DATE,
			level VARCHAR(10) DEFAULT 'L1'
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_devops_profiles_level ON devops_profiles(level)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_devops_profiles_is_manager ON devops_profiles(is_manager)")

	// Migration 9: users.manager_id (portal user's manager for two-step approval), pr_requests.assigned_to
	var managerIDCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'manager_id'").Scan(&managerIDCount)
	if managerIDCount == 0 {
		log.Println("Migrating database: adding users.manager_id...")
		_, _ = DB.Exec("ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
		log.Println("Database migration (manager_id) completed")
	}
	var assignedToCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'assigned_to'").Scan(&assignedToCount)
	if assignedToCount == 0 {
		log.Println("Migrating database: adding pr_requests.assigned_to...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL")
		_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_assigned_to ON pr_requests(assigned_to)")
		log.Println("Database migration (assigned_to) completed")
	}

	log.Println("Database schema is up to date")
	return nil
}
