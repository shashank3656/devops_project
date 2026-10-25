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
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_assets_type ON expiry_assets(asset_type, assessment, state)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_expiry_assets_project ON expiry_assets(project_id, environment)`)
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
}
