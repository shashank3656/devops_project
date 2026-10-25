package main

func migrateSecurityVulnSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_intelligence_sources (
			id SERIAL PRIMARY KEY,
			provider VARCHAR(40) NOT NULL UNIQUE,
			status VARCHAR(40) NOT NULL DEFAULT 'idle',
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			last_success_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			latest_revision VARCHAR(200) NOT NULL DEFAULT '',
			fetched_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		INSERT INTO vuln_intelligence_sources (provider, status, enabled)
		VALUES
			('github', 'idle', TRUE),
			('cisa_kev', 'idle', TRUE),
			('osv', 'paused', FALSE),
			('nvd', 'paused', FALSE),
			('epss', 'paused', FALSE)
		ON CONFLICT (provider) DO NOTHING
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_advisories (
			id SERIAL PRIMARY KEY,
			canonical_id VARCHAR(80) NOT NULL UNIQUE,
			title TEXT NOT NULL DEFAULT '',
			summary TEXT NOT NULL DEFAULT '',
			severity VARCHAR(20) NOT NULL DEFAULT 'unknown',
			cvss_score DOUBLE PRECISION,
			cvss_vector TEXT NOT NULL DEFAULT '',
			cvss_provider VARCHAR(40) NOT NULL DEFAULT '',
			ecosystem VARCHAR(40) NOT NULL DEFAULT '',
			package_name VARCHAR(400) NOT NULL DEFAULT '',
			affected_json TEXT NOT NULL DEFAULT '[]',
			first_fixed_version VARCHAR(80) NOT NULL DEFAULT '',
			kev BOOLEAN NOT NULL DEFAULT FALSE,
			epss DOUBLE PRECISION,
			source VARCHAR(40) NOT NULL DEFAULT '',
			source_url TEXT NOT NULL DEFAULT '',
			published_at TIMESTAMP,
			modified_at TIMESTAMP,
			fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
			revision VARCHAR(80) NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_advisories_severity ON vuln_advisories (severity)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_advisories_package ON vuln_advisories (ecosystem, package_name)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_advisory_aliases (
			id SERIAL PRIMARY KEY,
			advisory_id INTEGER NOT NULL REFERENCES vuln_advisories(id) ON DELETE CASCADE,
			alias VARCHAR(80) NOT NULL UNIQUE
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_repositories (
			id SERIAL PRIMARY KEY,
			project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
			provider VARCHAR(40) NOT NULL DEFAULT 'github',
			owner VARCHAR(200) NOT NULL,
			name VARCHAR(200) NOT NULL,
			branch VARCHAR(200) NOT NULL DEFAULT 'main',
			monorepo_path VARCHAR(400) NOT NULL DEFAULT '',
			owner_team VARCHAR(200) NOT NULL DEFAULT '',
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (provider, owner, name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_service_repos (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			module_path VARCHAR(400) NOT NULL DEFAULT '',
			UNIQUE (service_id, repo_id, module_path)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_scan_jobs (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			service_id INTEGER,
			project_id INTEGER,
			trigger VARCHAR(40) NOT NULL DEFAULT 'manual',
			state VARCHAR(40) NOT NULL DEFAULT 'queued',
			stage VARCHAR(40) NOT NULL DEFAULT 'queued',
			commit_sha VARCHAR(64) NOT NULL DEFAULT '',
			idempotency_key VARCHAR(120) NOT NULL DEFAULT '',
			error TEXT NOT NULL DEFAULT '',
			coverage_json TEXT NOT NULL DEFAULT '[]',
			discovered_modules INTEGER NOT NULL DEFAULT 0,
			assessed_modules INTEGER NOT NULL DEFAULT 0,
			attempt INTEGER NOT NULL DEFAULT 1,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			started_at TIMESTAMP,
			finished_at TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_scan_jobs_state ON vuln_scan_jobs (state, id)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_inventories (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			scan_id INTEGER REFERENCES vuln_scan_jobs(id) ON DELETE SET NULL,
			commit_sha VARCHAR(64) NOT NULL,
			collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			fresh BOOLEAN NOT NULL DEFAULT TRUE,
			coverage_json TEXT NOT NULL DEFAULT '[]',
			component_count INTEGER NOT NULL DEFAULT 0
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_inventories_repo ON vuln_inventories (repo_id, collected_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_components (
			id SERIAL PRIMARY KEY,
			inventory_id INTEGER NOT NULL REFERENCES vuln_inventories(id) ON DELETE CASCADE,
			ecosystem VARCHAR(40) NOT NULL,
			package_name VARCHAR(400) NOT NULL,
			version VARCHAR(120) NOT NULL DEFAULT '',
			purl TEXT NOT NULL DEFAULT '',
			path VARCHAR(500) NOT NULL DEFAULT '',
			module_path VARCHAR(400) NOT NULL DEFAULT '',
			direct BOOLEAN NOT NULL DEFAULT FALSE,
			dev BOOLEAN NOT NULL DEFAULT FALSE,
			resolved BOOLEAN NOT NULL DEFAULT TRUE,
			parent_package VARCHAR(400) NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_components_pkg ON vuln_components (ecosystem, package_name)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_findings (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			project_id INTEGER,
			service_id INTEGER,
			advisory_id INTEGER NOT NULL REFERENCES vuln_advisories(id) ON DELETE CASCADE,
			canonical_id VARCHAR(80) NOT NULL,
			ecosystem VARCHAR(40) NOT NULL,
			package_name VARCHAR(400) NOT NULL,
			installed_version VARCHAR(120) NOT NULL DEFAULT '',
			module_path VARCHAR(400) NOT NULL DEFAULT '',
			path VARCHAR(500) NOT NULL DEFAULT '',
			branch VARCHAR(200) NOT NULL DEFAULT 'main',
			confidence VARCHAR(40) NOT NULL DEFAULT 'confirmed',
			lifecycle VARCHAR(40) NOT NULL DEFAULT 'open',
			patch_state VARCHAR(40) NOT NULL DEFAULT 'unknown',
			first_fixed_version VARCHAR(80) NOT NULL DEFAULT '',
			recommended_version VARCHAR(80) NOT NULL DEFAULT '',
			parent_package VARCHAR(400) NOT NULL DEFAULT '',
			priority VARCHAR(40) NOT NULL DEFAULT 'review',
			priority_reason TEXT NOT NULL DEFAULT '',
			owner VARCHAR(200) NOT NULL DEFAULT '',
			episode INTEGER NOT NULL DEFAULT 1,
			first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			due_at TIMESTAMP,
			pr_url TEXT NOT NULL DEFAULT '',
			change_ref TEXT NOT NULL DEFAULT '',
			last_scan_id INTEGER,
			UNIQUE (repo_id, branch, module_path, ecosystem, package_name, canonical_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_findings_lifecycle ON vuln_findings (lifecycle, priority)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_finding_events (
			id SERIAL PRIMARY KEY,
			finding_id INTEGER NOT NULL REFERENCES vuln_findings(id) ON DELETE CASCADE,
			kind VARCHAR(40) NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			actor_id INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_exceptions (
			id SERIAL PRIMARY KEY,
			finding_id INTEGER NOT NULL REFERENCES vuln_findings(id) ON DELETE CASCADE,
			reason TEXT NOT NULL,
			evidence TEXT NOT NULL DEFAULT '',
			approver_id INTEGER NOT NULL DEFAULT 0,
			expires_at TIMESTAMP NOT NULL,
			status VARCHAR(40) NOT NULL DEFAULT 'active',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_patch_plans (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			module_path VARCHAR(400) NOT NULL DEFAULT '',
			ecosystem VARCHAR(40) NOT NULL,
			package_name VARCHAR(400) NOT NULL,
			current_version VARCHAR(120) NOT NULL DEFAULT '',
			target_version VARCHAR(120) NOT NULL DEFAULT '',
			action VARCHAR(40) NOT NULL DEFAULT 'direct_upgrade',
			status VARCHAR(40) NOT NULL DEFAULT 'tests_required',
			finding_ids TEXT NOT NULL DEFAULT '[]',
			estimated BOOLEAN NOT NULL DEFAULT TRUE,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_vuln_patch_plans_key
		ON vuln_patch_plans (repo_id, module_path, ecosystem, package_name, target_version)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_intel_runs (
			id SERIAL PRIMARY KEY,
			state VARCHAR(40) NOT NULL DEFAULT 'queued',
			fetched INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			finished_at TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`UPDATE vuln_intelligence_sources SET enabled = TRUE, status = CASE WHEN status = 'paused' THEN 'idle' ELSE status END WHERE provider IN ('osv','nvd','epss')`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS collection_mode VARCHAR(40) NOT NULL DEFAULT 'hosted'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS schedule_minutes INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS alert_min_severity VARCHAR(20) NOT NULL DEFAULT 'high'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS exclusions TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS allow_fork_prs BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`ALTER TABLE vuln_scan_jobs ADD COLUMN IF NOT EXISTS collection_mode VARCHAR(40) NOT NULL DEFAULT 'hosted'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_components ADD COLUMN IF NOT EXISTS usage VARCHAR(40) NOT NULL DEFAULT 'dependency'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_advisories ADD COLUMN IF NOT EXISTS epss_percentile DOUBLE PRECISION`)
	_, _ = DB.Exec(`ALTER TABLE vuln_exceptions ADD COLUMN IF NOT EXISTS kind VARCHAR(40) NOT NULL DEFAULT 'exception'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_exceptions ADD COLUMN IF NOT EXISTS issuer VARCHAR(200) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS enforce_pr_gate BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`ALTER TABLE vuln_components ADD COLUMN IF NOT EXISTS reachability VARCHAR(40) NOT NULL DEFAULT 'unknown'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_findings ADD COLUMN IF NOT EXISTS reachability VARCHAR(40) NOT NULL DEFAULT 'unknown'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_findings ADD COLUMN IF NOT EXISTS match_source VARCHAR(40) NOT NULL DEFAULT 'scan'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_intel_runs ADD COLUMN IF NOT EXISTS matched INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE vuln_intel_runs ADD COLUMN IF NOT EXISTS repos_assessed INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS access_state VARCHAR(40) NOT NULL DEFAULT 'unknown'`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS access_detail TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS access_checked_at TIMESTAMP`)
	_, _ = DB.Exec(`ALTER TABLE vuln_repositories ADD COLUMN IF NOT EXISTS last_scheduled_at TIMESTAMP`)
	_, _ = DB.Exec(`ALTER TABLE vuln_findings ADD COLUMN IF NOT EXISTS direct BOOLEAN NOT NULL DEFAULT TRUE`)
	_, _ = DB.Exec(`ALTER TABLE vuln_findings ADD COLUMN IF NOT EXISTS dev BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_scan_events (
			id SERIAL PRIMARY KEY,
			scan_id INTEGER NOT NULL REFERENCES vuln_scan_jobs(id) ON DELETE CASCADE,
			stage VARCHAR(40) NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_vuln_scan_events_scan ON vuln_scan_events (scan_id, id)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_agents (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
			token_hash VARCHAR(64) NOT NULL UNIQUE,
			status VARCHAR(40) NOT NULL DEFAULT 'pending',
			version VARCHAR(80) NOT NULL DEFAULT '',
			capabilities TEXT NOT NULL DEFAULT 'lockfiles,sbom',
			last_heartbeat_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_agent_bootstraps (
			id SERIAL PRIMARY KEY,
			agent_id INTEGER NOT NULL REFERENCES vuln_agents(id) ON DELETE CASCADE,
			token_hash VARCHAR(64) NOT NULL UNIQUE,
			expires_at TIMESTAMP NOT NULL,
			used_at TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_runtime_observations (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			kind VARCHAR(40) NOT NULL,
			value VARCHAR(200) NOT NULL,
			provenance VARCHAR(40) NOT NULL DEFAULT 'declared',
			path VARCHAR(500) NOT NULL DEFAULT '',
			commit_sha VARCHAR(64) NOT NULL DEFAULT '',
			collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_pr_comparisons (
			id SERIAL PRIMARY KEY,
			repo_id INTEGER NOT NULL REFERENCES vuln_repositories(id) ON DELETE CASCADE,
			project_id INTEGER,
			pr_number INTEGER NOT NULL DEFAULT 0,
			base_sha VARCHAR(64) NOT NULL,
			head_sha VARCHAR(64) NOT NULL,
			state VARCHAR(40) NOT NULL DEFAULT 'queued',
			coverage VARCHAR(40) NOT NULL DEFAULT 'unknown',
			introduced_critical INTEGER NOT NULL DEFAULT 0,
			introduced_high INTEGER NOT NULL DEFAULT 0,
			removed_count INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			finished_at TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_pr_comparison_items (
			id SERIAL PRIMARY KEY,
			comparison_id INTEGER NOT NULL REFERENCES vuln_pr_comparisons(id) ON DELETE CASCADE,
			classification VARCHAR(40) NOT NULL,
			canonical_id VARCHAR(80) NOT NULL,
			ecosystem VARCHAR(40) NOT NULL,
			package_name VARCHAR(400) NOT NULL,
			module_path VARCHAR(400) NOT NULL DEFAULT '',
			base_version VARCHAR(120) NOT NULL DEFAULT '',
			head_version VARCHAR(120) NOT NULL DEFAULT '',
			severity VARCHAR(20) NOT NULL DEFAULT 'unknown'
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS vuln_deployments (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL,
			repo_id INTEGER,
			environment VARCHAR(80) NOT NULL,
			digest VARCHAR(200) NOT NULL,
			commit_sha VARCHAR(64) NOT NULL DEFAULT '',
			has_sbom BOOLEAN NOT NULL DEFAULT FALSE,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	backfillVulnAdvisorySeverity()
}
