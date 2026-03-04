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
	var projectIDColCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'project_id'").Scan(&projectIDColCount)
	if projectIDColCount == 0 {
		_, _ = DB.Exec("ALTER TABLE user_notifications ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL")
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_user_notifications_project_id ON user_notifications(project_id)")
	_, _ = DB.Exec(`
		UPDATE user_notifications n
		SET project_id = r.project_id
		FROM pr_requests r
		WHERE n.request_id = r.id
		  AND n.project_id IS NULL
		  AND r.project_id IS NOT NULL
	`)

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

	// Migration 15b: gitops project catalog and environment-scoped visibility
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS gitops_projects (
			id SERIAL PRIMARY KEY,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			slug VARCHAR(200) NOT NULL,
			repo_root VARCHAR(500) NOT NULL,
			base_branch VARCHAR(200) NOT NULL DEFAULT 'main',
			default_cloud VARCHAR(100) DEFAULT '',
			environments JSONB NOT NULL DEFAULT '[]',
			components JSONB NOT NULL DEFAULT '[]',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(team_id, slug)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_gitops_projects_team_id ON gitops_projects(team_id)")
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS gitops_project_access (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES gitops_projects(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			environment VARCHAR(100) NOT NULL,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(project_id, user_id, environment)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_gitops_project_access_project_id ON gitops_project_access(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_gitops_project_access_user_id ON gitops_project_access(user_id)")
	var gitopsAccessPermissionCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'gitops_project_access' AND column_name = 'permission'").Scan(&gitopsAccessPermissionCount)
	if gitopsAccessPermissionCount == 0 {
		log.Println("Migrating database: adding gitops_project_access.permission...")
		_, _ = DB.Exec("ALTER TABLE gitops_project_access ADD COLUMN permission VARCHAR(20) NOT NULL DEFAULT 'read'")
		_, _ = DB.Exec("UPDATE gitops_project_access SET permission = 'read' WHERE permission IS NULL OR permission = ''")
	}

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

	// Migration 18: pr_requests.terraform_plan_output (store Terraform plan/apply output from CI for display in UI)
	var planOutputCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'terraform_plan_output'").Scan(&planOutputCount)
	if planOutputCount == 0 {
		log.Println("Migrating database: adding pr_requests.terraform_plan_output...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN terraform_plan_output TEXT")
		log.Println("Database migration (terraform_plan_output) completed")
	}

	// Migration 19: request_config_history (for rollback - store config snapshots)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_config_history (
			id SERIAL PRIMARY KEY,
			request_id INTEGER NOT NULL REFERENCES pr_requests(id) ON DELETE CASCADE,
			config TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			note VARCHAR(255) DEFAULT ''
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_config_history_request_id ON request_config_history(request_id)")

	// Migration 20: pr_requests.linked_request_id (for environment promotion - link dev→staging→prod)
	var linkedReqCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'linked_request_id'").Scan(&linkedReqCount)
	if linkedReqCount == 0 {
		log.Println("Migrating database: adding pr_requests.linked_request_id...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN linked_request_id INTEGER REFERENCES pr_requests(id) ON DELETE SET NULL")
		_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_linked_request_id ON pr_requests(linked_request_id)")
		log.Println("Database migration (linked_request_id) completed")
	}

	// Migration 22: pending_2fa (temporary tokens for 2FA flow)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pending_2fa (
			token VARCHAR(64) PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TIMESTAMP NOT NULL
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pending_2fa_expires ON pending_2fa(expires_at)")

	// Migration 21: users.totp_secret, users.totp_enabled (for 2FA)
	for _, col := range []string{"totp_secret", "totp_enabled"} {
		var c int
		_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = $1", col).Scan(&c)
		if c == 0 {
			log.Printf("Migrating database: adding users.%s...", col)
			if col == "totp_secret" {
				_, _ = DB.Exec("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)")
			} else {
				_, _ = DB.Exec("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE")
			}
			log.Printf("Database migration (users.%s) completed", col)
		}
	}

	// Migration 23: password_reset_tokens (for forgot password flow)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS password_reset_tokens (
			token VARCHAR(64) PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)")

	// Migration 24: pr_requests.sla_breach_notified_at (for SLA breach alerts - avoid duplicate notifications)
	var slaNotifiedCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'sla_breach_notified_at'").Scan(&slaNotifiedCount)
	if slaNotifiedCount == 0 {
		log.Println("Migrating database: adding pr_requests.sla_breach_notified_at...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN sla_breach_notified_at TIMESTAMP")
		log.Println("Database migration (sla_breach_notified_at) completed")
	}

	// Migration 25: user_notification_preferences (email on/off per type)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_notification_preferences (
			user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			email_approved BOOLEAN DEFAULT TRUE,
			email_rejected BOOLEAN DEFAULT TRUE,
			email_pr_created BOOLEAN DEFAULT TRUE,
			email_assigned BOOLEAN DEFAULT TRUE,
			email_sla_breach BOOLEAN DEFAULT TRUE,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)

	// Migration 26: request_dependencies (request_id, depends_on_request_id)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_dependencies (
			id SERIAL PRIMARY KEY,
			request_id INTEGER NOT NULL REFERENCES pr_requests(id) ON DELETE CASCADE,
			depends_on_request_id INTEGER NOT NULL REFERENCES pr_requests(id) ON DELETE CASCADE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(request_id, depends_on_request_id),
			CHECK (request_id != depends_on_request_id)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_dependencies_request ON request_dependencies(request_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_dependencies_depends ON request_dependencies(depends_on_request_id)")

	// Migration 27: pr_requests.jira_ticket_id (Jira/ticketing integration)
	var jiraCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'jira_ticket_id'").Scan(&jiraCount)
	if jiraCount == 0 {
		log.Println("Migrating database: adding pr_requests.jira_ticket_id...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN jira_ticket_id VARCHAR(100)")
		_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_jira_ticket_id ON pr_requests(jira_ticket_id) WHERE jira_ticket_id IS NOT NULL AND jira_ticket_id != ''")
	}

	// Migration 28: request_templates.version (template versioning)
	var versionCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'request_templates' AND column_name = 'version'").Scan(&versionCount)
	if versionCount == 0 {
		log.Println("Migrating database: adding request_templates.version...")
		_, _ = DB.Exec("ALTER TABLE request_templates ADD COLUMN version INTEGER DEFAULT 1")
	}

	// Migration 29: teams.application_id (12-char lowercase alphanumeric group ID used in Git/PR paths)
	var teamAppIDCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'teams' AND column_name = 'application_id'").Scan(&teamAppIDCount)
	if teamAppIDCount == 0 {
		log.Println("Migrating database: adding teams.application_id...")
		_, _ = DB.Exec("ALTER TABLE teams ADD COLUMN application_id VARCHAR(12)")
	}
	_, _ = DB.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_application_id ON teams(application_id) WHERE application_id IS NOT NULL AND application_id != ''")
	rows, err := DB.Query("SELECT id FROM teams WHERE COALESCE(application_id,'') = '' ORDER BY id")
	if err == nil {
		var teamIDs []int
		for rows.Next() {
			var teamID int
			if scanErr := rows.Scan(&teamID); scanErr == nil {
				teamIDs = append(teamIDs, teamID)
			}
		}
		rows.Close()
		for _, teamID := range teamIDs {
			groupID, genErr := GenerateTeamApplicationID()
			if genErr != nil {
				log.Printf("warning: failed to backfill teams.application_id for team %d: %v", teamID, genErr)
				continue
			}
			if _, execErr := DB.Exec("UPDATE teams SET application_id = $1 WHERE id = $2", groupID, teamID); execErr != nil {
				log.Printf("warning: failed to persist teams.application_id for team %d: %v", teamID, execErr)
			}
		}
	}

	// Migration 30: request_template_teams (optional portal-team scoping for templates)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_template_teams (
			id SERIAL PRIMARY KEY,
			template_id INTEGER NOT NULL REFERENCES request_templates(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(template_id, team_id)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_template_teams_template_id ON request_template_teams(template_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_template_teams_team_id ON request_template_teams(team_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_team_status_created_at ON pr_requests(team, status, created_at DESC)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_created_by_created_at ON pr_requests(created_by, created_at DESC)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_team_env_cloud_status ON pr_requests(team, env, cloud, status)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_team_members_team_role ON team_members(team_id, role)")

	// Migration 31: lightweight materialized summary for request status reporting
	_, _ = DB.Exec(`
		CREATE MATERIALIZED VIEW IF NOT EXISTS mv_request_status_summary AS
		SELECT
			COALESCE(team, '') AS team,
			COALESCE(status, '') AS status,
			COUNT(*) AS request_count,
			MAX(updated_at) AS last_updated_at
		FROM pr_requests
		GROUP BY COALESCE(team, ''), COALESCE(status, '')
	`)
	_, _ = DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_request_status_summary_team_status ON mv_request_status_summary(team, status)`)

	// Migration 32: project catalog for project-first onboarding and request governance
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			code VARCHAR(120) NOT NULL UNIQUE,
			description TEXT DEFAULT '',
			status VARCHAR(30) NOT NULL DEFAULT 'active',
			owner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_projects_owner_team_id ON projects(owner_team_id)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_environments (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL,
			UNIQUE(project_id, environment)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_environments_project_id ON project_environments(project_id)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_clouds (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			cloud VARCHAR(80) NOT NULL,
			UNIQUE(project_id, cloud)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_clouds_project_id ON project_clouds(project_id)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_services (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			cloud VARCHAR(80) NOT NULL,
			service VARCHAR(120) NOT NULL,
			UNIQUE(project_id, cloud, service)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_services_project_id ON project_services(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_services_project_cloud ON project_services(project_id, cloud)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_team_access (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			UNIQUE(project_id, team_id)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_team_access_project_id ON project_team_access(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_team_access_team_id ON project_team_access(team_id)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_team_environment_access (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL,
			UNIQUE(project_id, team_id, environment)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_team_environment_access_project_team ON project_team_environment_access(project_id, team_id)")

	var prProjectIDCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pr_requests' AND column_name = 'project_id'").Scan(&prProjectIDCount)
	if prProjectIDCount == 0 {
		log.Println("Migrating database: adding pr_requests.project_id...")
		_, _ = DB.Exec("ALTER TABLE pr_requests ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL")
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_project_id ON pr_requests(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_pr_requests_project_team_status_created_at ON pr_requests(project_id, team, status, created_at DESC)")

	// Migration 33: project approval rules and project-scoped template visibility
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_approval_rules (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL,
			require_manager_approval BOOLEAN NOT NULL DEFAULT FALSE,
			require_devops_approval BOOLEAN NOT NULL DEFAULT TRUE,
			UNIQUE(project_id, environment)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_approval_rules_project_id ON project_approval_rules(project_id)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_template_projects (
			id SERIAL PRIMARY KEY,
			template_id INTEGER NOT NULL REFERENCES request_templates(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(template_id, project_id)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_template_projects_template_id ON request_template_projects(template_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_template_projects_project_id ON request_template_projects(project_id)")

	// Migration 34: template governance workflow
	var templateStatusCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'request_templates' AND column_name = 'status'").Scan(&templateStatusCount)
	if templateStatusCount == 0 {
		log.Println("Migrating database: adding request_templates.status...")
		_, _ = DB.Exec("ALTER TABLE request_templates ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'draft'")
		_, _ = DB.Exec("UPDATE request_templates SET status = 'published' WHERE created_at IS NOT NULL")
	}
	var templateUpdatedAtCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'request_templates' AND column_name = 'updated_at'").Scan(&templateUpdatedAtCount)
	if templateUpdatedAtCount == 0 {
		log.Println("Migrating database: adding request_templates.updated_at...")
		_, _ = DB.Exec("ALTER TABLE request_templates ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
		_, _ = DB.Exec("UPDATE request_templates SET updated_at = created_at WHERE updated_at IS NULL")
	}
	var templatePublishedAtCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'request_templates' AND column_name = 'published_at'").Scan(&templatePublishedAtCount)
	if templatePublishedAtCount == 0 {
		log.Println("Migrating database: adding request_templates.published_at...")
		_, _ = DB.Exec("ALTER TABLE request_templates ADD COLUMN published_at TIMESTAMP")
		_, _ = DB.Exec("UPDATE request_templates SET published_at = created_at WHERE status = 'published' AND published_at IS NULL")
	}
	var templatePublishedByCount int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'request_templates' AND column_name = 'published_by'").Scan(&templatePublishedByCount)
	if templatePublishedByCount == 0 {
		log.Println("Migrating database: adding request_templates.published_by...")
		_, _ = DB.Exec("ALTER TABLE request_templates ADD COLUMN published_by INTEGER REFERENCES users(id) ON DELETE SET NULL")
		_, _ = DB.Exec("UPDATE request_templates SET published_by = created_by WHERE status = 'published' AND published_by IS NULL")
	}
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_templates_status ON request_templates(status)")

	// Migration 35: DevOps control center features (runbooks, incidents, access overrides, retryable delivery failures)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_runbooks (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			service VARCHAR(120) DEFAULT '',
			title VARCHAR(200) NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			link_url TEXT DEFAULT '',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_runbooks_project_id ON project_runbooks(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_runbooks_project_service ON project_runbooks(project_id, service)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS request_incidents (
			id SERIAL PRIMARY KEY,
			request_id INTEGER NOT NULL UNIQUE REFERENCES pr_requests(id) ON DELETE CASCADE,
			project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
			severity VARCHAR(20) NOT NULL DEFAULT 'medium',
			status VARCHAR(30) NOT NULL DEFAULT 'open',
			escalation_level VARCHAR(30) NOT NULL DEFAULT 'monitoring',
			owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			summary TEXT NOT NULL DEFAULT '',
			notes TEXT NOT NULL DEFAULT '',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_incidents_project_id ON request_incidents(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_incidents_status ON request_incidents(status)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_request_incidents_severity ON request_incidents(severity)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_access_overrides (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			environments TEXT NOT NULL DEFAULT '',
			permission VARCHAR(20) NOT NULL DEFAULT 'write',
			reason TEXT NOT NULL DEFAULT '',
			expires_at TIMESTAMP NOT NULL,
			revoked_at TIMESTAMP,
			revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_access_overrides_project_id ON project_access_overrides(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_access_overrides_user_id ON project_access_overrides(user_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_access_overrides_expires_at ON project_access_overrides(expires_at)")

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS ops_delivery_failures (
			id SERIAL PRIMARY KEY,
			job_type VARCHAR(40) NOT NULL,
			target TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT 'open',
			retry_count INTEGER NOT NULL DEFAULT 0,
			last_retry_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_ops_delivery_failures_status ON ops_delivery_failures(status)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_ops_delivery_failures_job_type ON ops_delivery_failures(job_type)")

	// Migration 36: project_k8s_connections (project-wise Kubernetes onboarding registry)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_k8s_connections (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			cloud VARCHAR(40) NOT NULL DEFAULT '',
			cluster_name VARCHAR(160) NOT NULL,
			cluster_endpoint TEXT NOT NULL DEFAULT '',
			environment VARCHAR(40) NOT NULL DEFAULT '',
			namespace VARCHAR(160) NOT NULL DEFAULT '',
			auth_mode VARCHAR(40) NOT NULL DEFAULT 'service_account',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(project_id, cluster_name, environment)
		)
	`)
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_k8s_connections_project_id ON project_k8s_connections(project_id)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_k8s_connections_cluster_name ON project_k8s_connections(cluster_name)")
	_, _ = DB.Exec("CREATE INDEX IF NOT EXISTS idx_project_k8s_connections_environment ON project_k8s_connections(environment)")

	log.Println("Database schema is up to date")
	return nil
}
