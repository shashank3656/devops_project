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
	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_activity (
			id SERIAL PRIMARY KEY,
			user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			action VARCHAR(100) NOT NULL,
			resource_type VARCHAR(50) NOT NULL,
			resource_id VARCHAR(50),
			details TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("user_activity table creation: %w", err)
	}
	if _, err := DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)"); err != nil {
		log.Printf("warning: idx_user_activity_user_id: %v", err)
	}
	if _, err := DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC)"); err != nil {
		log.Printf("warning: idx_user_activity_created_at: %v", err)
	}

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

	// Migration 10: teams.team_type (portal | devops), portal team member roles (developer, senior_developer, lead, manager)
	var teamTypeCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'teams' AND column_name = 'team_type'").Scan(&teamTypeCount)
	if teamTypeCount == 0 {
		log.Println("Migrating database: adding teams.team_type...")
		_, _ = DB.Exec("ALTER TABLE teams ADD COLUMN team_type VARCHAR(50) DEFAULT 'portal'")
		_, _ = DB.Exec("UPDATE teams SET team_type = 'portal' WHERE team_type IS NULL")
		log.Println("Database migration (team_type) completed")
	}
	// team_members.role already VARCHAR(50); allow developer, senior_developer, lead, manager (no schema change, just validation in code)

	// Migration 11: users.is_portal_manager (portal user can be designated as group manager, same UX as DevOps manager)
	var portalManagerCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_portal_manager'").Scan(&portalManagerCount)
	if portalManagerCount == 0 {
		log.Println("Migrating database: adding users.is_portal_manager...")
		_, _ = DB.Exec("ALTER TABLE users ADD COLUMN is_portal_manager BOOLEAN DEFAULT FALSE")
		log.Println("Database migration (is_portal_manager) completed")
	}

	// Migration 12: request_templates (admin-defined presets) and user_saved_configs (user favorites)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_templates (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			description TEXT,
			cloud VARCHAR(50) NOT NULL,
			env VARCHAR(50) NOT NULL,
			service VARCHAR(100) NOT NULL,
			config TEXT DEFAULT '{}',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_templates_cloud ON request_templates(cloud)")
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_saved_configs (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			config TEXT NOT NULL DEFAULT '{}',
			cloud VARCHAR(50) DEFAULT '',
			env VARCHAR(50) DEFAULT '',
			service VARCHAR(100) DEFAULT '',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_saved_configs_user_id ON user_saved_configs(user_id)")

	// Migration 13: user_notifications (in-app notifications for request approved/rejected/PR created/assigned)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_notifications (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			request_id INTEGER REFERENCES pr_requests(id) ON DELETE SET NULL,
			kind VARCHAR(50) NOT NULL,
			message TEXT NOT NULL,
			read_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_notifications_read_at ON user_notifications(read_at)")

	// Migration 14: teams.default_env, teams.default_cloud (per-team defaults for request creation)
	for _, col := range []string{"default_env", "default_cloud"} {
		var count int
		_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'teams' AND column_name = $1", col).Scan(&count)
		if count == 0 {
			log.Printf("Migrating database: adding teams.%s...", col)
			_, _ = DB.Exec("ALTER TABLE teams ADD COLUMN " + col + " VARCHAR(100)")
		}
	}

	// Migration 15: repo_config (global and per-team GitHub repo/branch/base path override)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS repo_config (
			id SERIAL PRIMARY KEY,
			scope VARCHAR(20) NOT NULL DEFAULT 'global',
			team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
			repo_owner VARCHAR(200),
			repo_name VARCHAR(200),
			base_branch VARCHAR(200),
			base_path VARCHAR(500),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(team_id)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_repo_config_scope_team ON repo_config(scope, team_id)")

	// Migration 16: api_keys.scopes (request:create, history:read)
	var scopesCol int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name = 'scopes'").Scan(&scopesCol)
	if scopesCol == 0 {
		log.Println("Migrating database: adding api_keys.scopes...")
		_, _ = DB.Exec("ALTER TABLE api_keys ADD COLUMN scopes VARCHAR(200) DEFAULT 'request:create,history:read'")
		_, _ = DB.Exec("UPDATE api_keys SET scopes = 'request:create,history:read' WHERE scopes IS NULL OR scopes = ''")
		log.Println("Database migration (api_keys.scopes) completed")
	}

	// Migration 17: outbound_webhooks (admin-configured URL, secret, events)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS outbound_webhooks (
			id SERIAL PRIMARY KEY,
			url VARCHAR(2048) NOT NULL,
			secret VARCHAR(255) DEFAULT '',
			events VARCHAR(500) NOT NULL DEFAULT 'approved,pr_created,rejected',
			enabled BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_enabled ON outbound_webhooks(enabled)")

	// Migration 18: db_connections (admin-configured DBs for query UI)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS db_connections (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) DEFAULT '',
			db_type VARCHAR(20) NOT NULL DEFAULT 'postgres',
			project VARCHAR(100) DEFAULT '',
			connection_string TEXT,
			mongo_database VARCHAR(100) DEFAULT '',
			mongo_collection VARCHAR(100) DEFAULT '',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	// Add any missing columns (handles tables created with minimal/different schema)
	dbConnCols := []struct{ name, def string }{
		{"name", "VARCHAR(200) DEFAULT ''"},
		{"alias", "VARCHAR(200) DEFAULT ''"},
		{"project", "VARCHAR(100) DEFAULT ''"},
		{"connection_string", "TEXT"},
		{"mongo_database", "VARCHAR(100) DEFAULT ''"},
		{"mongo_collection", "VARCHAR(100) DEFAULT ''"},
		{"created_by", "INTEGER"},
		{"created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"},
	}
	for _, col := range dbConnCols {
		var count int
		_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'db_connections' AND column_name = $1", col.name).Scan(&count)
		if count == 0 {
			log.Printf("Migrating database: adding db_connections.%s...", col.name)
			_, _ = DB.Exec("ALTER TABLE db_connections ADD COLUMN " + col.name + " " + col.def)
		}
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_db_connections_project ON db_connections(project)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_db_connections_db_type ON db_connections(db_type)")

	// Migration 19: db_query_requests (approval workflow)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS db_query_requests (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
			query TEXT NOT NULL,
			requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
			approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			approved_at TIMESTAMP,
			executed_at TIMESTAMP,
			result_rows INTEGER,
			error_message TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_db_query_requests_status ON db_query_requests(status)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_db_query_requests_requested_by ON db_query_requests(requested_by)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_db_query_requests_created_at ON db_query_requests(created_at DESC)")

	// Migration 20: db_connections separate fields (host, port, username, password, database, database_name, ssl_mode)
	for _, col := range []string{"host", "port", "username", "password", "database", "database_name", "ssl_mode"} {
		var count int
		_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'db_connections' AND column_name = $1", col).Scan(&count)
		if count == 0 {
			log.Printf("Migrating database: adding db_connections.%s...", col)
			var alter string
			switch col {
			case "host":
				alter = "ALTER TABLE db_connections ADD COLUMN host VARCHAR(255) DEFAULT ''"
			case "port":
				alter = "ALTER TABLE db_connections ADD COLUMN port VARCHAR(20) DEFAULT ''"
			case "username":
				alter = "ALTER TABLE db_connections ADD COLUMN username VARCHAR(255) DEFAULT ''"
			case "password":
				alter = "ALTER TABLE db_connections ADD COLUMN password TEXT DEFAULT ''"
			case "database":
				alter = "ALTER TABLE db_connections ADD COLUMN database VARCHAR(255) DEFAULT ''"
			case "database_name":
				alter = "ALTER TABLE db_connections ADD COLUMN database_name VARCHAR(255) DEFAULT ''"
			case "ssl_mode":
				alter = "ALTER TABLE db_connections ADD COLUMN ssl_mode VARCHAR(50) DEFAULT 'disable'"
			default:
				continue
			}
			_, _ = DB.Exec(alter)
		}
	}
	// Make connection_string nullable for backward compat with legacy rows
	_, _ = DB.Exec("ALTER TABLE db_connections ALTER COLUMN connection_string DROP NOT NULL")

	// Make alias, database_name nullable if they exist (for tables where they were NOT NULL)
	for _, col := range []string{"alias", "database_name"} {
		var c int
		_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'db_connections' AND column_name = $1", col).Scan(&c)
		if c > 0 {
			_, _ = DB.Exec("ALTER TABLE db_connections ALTER COLUMN " + col + " DROP NOT NULL")
		}
	}

	// Seed default connection if empty (using separate fields)
	var connCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM db_connections").Scan(&connCount)
	if connCount == 0 {
		dbName := getEnv("DB_NAME", "infra_portal")
		_, _ = DB.Exec(`INSERT INTO db_connections (name, alias, db_type, project, host, port, username, password, database, database_name, ssl_mode) VALUES ($1, $2, 'postgres', 'default', $3, $4, $5, $6, $7, $7, 'disable')`,
			"InfraGate (main)", "InfraGate (main)",
			getEnv("DB_HOST", "postgres"), getEnv("DB_PORT", "5432"),
			getEnv("DB_USER", "postgres"), getEnv("DB_PASSWORD", "postgres"),
			dbName)
		log.Println("Seeded default db_connection")
	}

	log.Println("Database schema is up to date")
	return nil
}
