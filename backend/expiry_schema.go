package main

func migrateExpiryAssetSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_assets (
			id SERIAL PRIMARY KEY,
			asset_type TEXT NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			hostname TEXT NOT NULL DEFAULT '',
			port INTEGER NOT NULL DEFAULT 443,
			registered_domain TEXT NOT NULL DEFAULT '',
			original_input TEXT NOT NULL DEFAULT '',
			project_id INTEGER NOT NULL DEFAULT 0,
			service_name TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT '',
			team_id INTEGER NOT NULL DEFAULT 0,
			owner_name TEXT NOT NULL DEFAULT '',
			runbook_url TEXT NOT NULL DEFAULT '',
			warn_days TEXT NOT NULL DEFAULT '30,14,7,3,1',
			check_every_minutes INTEGER NOT NULL DEFAULT 360,
			collector TEXT NOT NULL DEFAULT 'hosted',
			state TEXT NOT NULL DEFAULT 'open',
			assessment TEXT NOT NULL DEFAULT 'unknown',
			renewal_state TEXT NOT NULL DEFAULT 'open',
			version INTEGER NOT NULL DEFAULT 1,
			archived_reason TEXT NOT NULL DEFAULT '',
			last_checked_at TIMESTAMP,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE expiry_assets ADD COLUMN IF NOT EXISTS owner_user_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE expiry_assets ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`ALTER TABLE expiry_assets ADD COLUMN IF NOT EXISTS paused_reason TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_assets_type ON expiry_assets(asset_type, assessment, state)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_assets_project ON expiry_assets(project_id, environment)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_assets_owner ON expiry_assets(owner_user_id, team_id)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_observations (
			id SERIAL PRIMARY KEY,
			asset_id INTEGER NOT NULL REFERENCES expiry_assets(id) ON DELETE CASCADE,
			source TEXT NOT NULL,
			observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			observation_point TEXT NOT NULL DEFAULT 'hosted',
			leaf_fingerprint TEXT NOT NULL DEFAULT '',
			issuer TEXT NOT NULL DEFAULT '',
			sans TEXT NOT NULL DEFAULT '',
			not_before TIMESTAMP,
			not_after TIMESTAMP,
			chain_not_after TIMESTAMP,
			hostname_ok BOOLEAN NOT NULL DEFAULT FALSE,
			chain_ok BOOLEAN NOT NULL DEFAULT FALSE,
			assessment TEXT NOT NULL DEFAULT 'unknown',
			error_class TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			registrar_expires_at TIMESTAMP,
			registry_expires_at TIMESTAMP,
			auto_renew BOOLEAN,
			manual BOOLEAN NOT NULL DEFAULT FALSE,
			raw_summary TEXT NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_observations_asset ON expiry_observations(asset_id, observed_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_renewal_cases (
			id SERIAL PRIMARY KEY,
			asset_id INTEGER NOT NULL REFERENCES expiry_assets(id) ON DELETE CASCADE,
			state TEXT NOT NULL DEFAULT 'open',
			change_ref TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			verified_observation_id INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_check_jobs (
			id SERIAL PRIMARY KEY,
			asset_id INTEGER NOT NULL REFERENCES expiry_assets(id) ON DELETE CASCADE,
			state TEXT NOT NULL DEFAULT 'queued',
			error_message TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			started_at TIMESTAMP,
			finished_at TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_check_jobs_state ON expiry_check_jobs(state, created_at)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_alert_episodes (
			asset_id INTEGER NOT NULL,
			threshold_key TEXT NOT NULL,
			last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (asset_id, threshold_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_collectors (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			project_id INTEGER NOT NULL DEFAULT 0,
			token_hash TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			last_seen_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_collectors_token ON expiry_collectors(token_hash)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_collectors_project ON expiry_collectors(project_id, status)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS expiry_dns_proposals (
			id SERIAL PRIMARY KEY,
			asset_id INTEGER NOT NULL REFERENCES expiry_assets(id) ON DELETE CASCADE,
			records_json TEXT NOT NULL DEFAULT '[]',
			change_ref TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT 'proposed',
			note TEXT NOT NULL DEFAULT '',
			live_write BOOLEAN NOT NULL DEFAULT FALSE,
			created_by INTEGER NOT NULL DEFAULT 0,
			confirmed_by INTEGER NOT NULL DEFAULT 0,
			confirmed_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_dns_proposals_asset ON expiry_dns_proposals(asset_id, created_at DESC)`)
}
