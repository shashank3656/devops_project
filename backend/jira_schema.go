package main

func migrateJiraIntegrationSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_connections (
			id SERIAL PRIMARY KEY,
			tenant_key TEXT NOT NULL DEFAULT 'default',
			name TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT 'jira_cloud',
			cloud_id TEXT NOT NULL DEFAULT '',
			site_url TEXT NOT NULL DEFAULT '',
			site_name TEXT NOT NULL DEFAULT '',
			owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			scopes TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT 'draft',
			auth_health TEXT NOT NULL DEFAULT 'not_configured',
			sync_health TEXT NOT NULL DEFAULT 'not_configured',
			enabled BOOLEAN NOT NULL DEFAULT FALSE,
			last_success_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_connections_owner ON jira_connections(owner_user_id)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_connections_cloud ON jira_connections(cloud_id)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_connection_secrets (
			connection_id INTEGER PRIMARY KEY REFERENCES jira_connections(id) ON DELETE CASCADE,
			access_token_enc TEXT NOT NULL DEFAULT '',
			refresh_token_enc TEXT NOT NULL DEFAULT '',
			token_type TEXT NOT NULL DEFAULT '',
			token_expiry TIMESTAMP,
			webhook_secret_enc TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_oauth_states (
			state TEXT PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at TIMESTAMP NOT NULL
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_spaces (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
			jira_project_id TEXT NOT NULL DEFAULT '',
			jira_project_key TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL DEFAULT '',
			style TEXT NOT NULL DEFAULT '',
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			sync_health TEXT NOT NULL DEFAULT 'not_configured',
			last_success_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(connection_id, jira_project_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_spaces_key ON jira_spaces(connection_id, jira_project_key)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_space_access (
			id SERIAL PRIMARY KEY,
			space_id INTEGER NOT NULL REFERENCES jira_spaces(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			can_view BOOLEAN NOT NULL DEFAULT TRUE,
			can_link BOOLEAN NOT NULL DEFAULT FALSE,
			can_create BOOLEAN NOT NULL DEFAULT FALSE,
			can_administer BOOLEAN NOT NULL DEFAULT FALSE,
			UNIQUE(space_id, team_id)
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_mappings (
			id SERIAL PRIMARY KEY,
			space_id INTEGER NOT NULL REFERENCES jira_spaces(id) ON DELETE CASCADE,
			portal_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
			portal_service TEXT NOT NULL DEFAULT '',
			issue_type_id TEXT NOT NULL DEFAULT '',
			issue_type_name TEXT NOT NULL DEFAULT '',
			default_relationship TEXT NOT NULL DEFAULT 'related',
			field_defaults_json TEXT NOT NULL DEFAULT '{}',
			version INTEGER NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_issues (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			issue_key TEXT NOT NULL DEFAULT '',
			space_id INTEGER REFERENCES jira_spaces(id) ON DELETE SET NULL,
			summary TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			status_category TEXT NOT NULL DEFAULT '',
			priority TEXT NOT NULL DEFAULT '',
			assignee_account_id TEXT NOT NULL DEFAULT '',
			assignee_display TEXT NOT NULL DEFAULT '',
			issue_type TEXT NOT NULL DEFAULT '',
			security_level TEXT NOT NULL DEFAULT '',
			browse_url TEXT NOT NULL DEFAULT '',
			restricted BOOLEAN NOT NULL DEFAULT FALSE,
			last_success_at TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(cloud_id, issue_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_issues_key ON jira_issues(cloud_id, issue_key)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_issue_links (
			id SERIAL PRIMARY KEY,
			source_type TEXT NOT NULL,
			source_id INTEGER NOT NULL DEFAULT 0,
			source_key TEXT NOT NULL DEFAULT '',
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			relationship TEXT NOT NULL DEFAULT 'related',
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_type, source_id, source_key, cloud_id, issue_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_issue_links_source ON jira_issue_links(source_type, source_id, source_key)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_issue_links_issue ON jira_issue_links(cloud_id, issue_id)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_sync_operations (
			id SERIAL PRIMARY KEY,
			operation_id TEXT NOT NULL UNIQUE,
			connection_id INTEGER REFERENCES jira_connections(id) ON DELETE SET NULL,
			kind TEXT NOT NULL DEFAULT '',
			source_type TEXT NOT NULL DEFAULT '',
			source_id INTEGER NOT NULL DEFAULT 0,
			source_key TEXT NOT NULL DEFAULT '',
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT 'queued',
			attempts INTEGER NOT NULL DEFAULT 0,
			max_attempts INTEGER NOT NULL DEFAULT 8,
			last_error TEXT NOT NULL DEFAULT '',
			next_attempt_at TIMESTAMP,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_ops_state ON jira_sync_operations(state, next_attempt_at)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_webhook_registrations (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
			provider_id TEXT NOT NULL DEFAULT '',
			expiration TIMESTAMP,
			renewal_status TEXT NOT NULL DEFAULT 'missing',
			last_error TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_audit_events (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER,
			actor_user_id INTEGER,
			action TEXT NOT NULL DEFAULT '',
			source_type TEXT NOT NULL DEFAULT '',
			source_id INTEGER NOT NULL DEFAULT 0,
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_audit_created ON jira_audit_events(created_at DESC)`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_processed_events (
			event_id TEXT PRIMARY KEY,
			processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_oauth_apps (
			tenant_key TEXT PRIMARY KEY DEFAULT 'default',
			client_id TEXT NOT NULL DEFAULT '',
			client_secret_enc TEXT NOT NULL DEFAULT '',
			redirect_url TEXT NOT NULL DEFAULT '',
			scopes TEXT NOT NULL DEFAULT '',
			updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_suggestion_dismissals (
			source_type TEXT NOT NULL,
			source_id INTEGER NOT NULL DEFAULT 0,
			source_key TEXT NOT NULL DEFAULT '',
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_type, source_id, source_key, cloud_id, issue_id)
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_comment_posts (
			operation_id TEXT PRIMARY KEY,
			cloud_id TEXT NOT NULL DEFAULT '',
			issue_id TEXT NOT NULL DEFAULT '',
			jira_comment_id TEXT NOT NULL DEFAULT '',
			origin TEXT NOT NULL DEFAULT 'opstrellis',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)

	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jira_remediation_rules (
			id SERIAL PRIMARY KEY,
			space_id INTEGER NOT NULL REFERENCES jira_spaces(id) ON DELETE CASCADE,
			source_type TEXT NOT NULL DEFAULT 'security_finding',
			match_text TEXT NOT NULL DEFAULT '',
			issue_type_id TEXT NOT NULL DEFAULT '',
			issue_type_name TEXT NOT NULL DEFAULT '',
			relationship TEXT NOT NULL DEFAULT 'remediates',
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			auto_create BOOLEAN NOT NULL DEFAULT FALSE,
			daily_limit INTEGER NOT NULL DEFAULT 10,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jira_remediation_source ON jira_remediation_rules(source_type, enabled)`)
	_, _ = DB.Exec(`ALTER TABLE jira_connections ADD COLUMN IF NOT EXISTS owner_account_id TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE jira_connections ADD COLUMN IF NOT EXISTS sync_policy_json TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE jira_issues ADD COLUMN IF NOT EXISTS remote_updated_at TIMESTAMP`)
}
