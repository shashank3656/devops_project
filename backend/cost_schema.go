package main

func migrateCostLedgerSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_connections (
			id SERIAL PRIMARY KEY,
			cloud_account_id INTEGER NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL DEFAULT 0,
			provider VARCHAR(20) NOT NULL DEFAULT 'aws',
			billing_source VARCHAR(32) NOT NULL DEFAULT 'aws_cur_2',
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			billing_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			inventory_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			metrics_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(cloud_account_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_connections_account ON cost_connections(cloud_account_id)`)
	_, _ = DB.Exec(`ALTER TABLE cost_connections ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMP`)
	_, _ = DB.Exec(`ALTER TABLE cost_connections ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMP`)
	_, _ = DB.Exec(`ALTER TABLE cost_connections ADD COLUMN IF NOT EXISTS last_test_status VARCHAR(32) NOT NULL DEFAULT 'unknown'`)
	_, _ = DB.Exec(`ALTER TABLE cost_connections ADD COLUMN IF NOT EXISTS last_test_note TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_ingestion_batches (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES cost_connections(id) ON DELETE CASCADE,
			source VARCHAR(64) NOT NULL DEFAULT 'fixture',
			window_start DATE NOT NULL,
			window_end DATE NOT NULL,
			complete BOOLEAN NOT NULL DEFAULT FALSE,
			status VARCHAR(32) NOT NULL DEFAULT 'imported',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_batches_connection ON cost_ingestion_batches(connection_id, created_at DESC)`)
	_, _ = DB.Exec(`ALTER TABLE cost_ingestion_batches ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'import'`)
	_, _ = DB.Exec(`ALTER TABLE cost_ingestion_batches ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_source_revisions (
			id SERIAL PRIMARY KEY,
			batch_id INTEGER NOT NULL REFERENCES cost_ingestion_batches(id) ON DELETE CASCADE,
			connection_id INTEGER NOT NULL DEFAULT 0,
			revision TEXT NOT NULL,
			content_hash TEXT NOT NULL DEFAULT '',
			supersedes_revision_id INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE cost_source_revisions ADD COLUMN IF NOT EXISTS connection_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE cost_source_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE cost_source_revisions ADD COLUMN IF NOT EXISTS supersedes_revision_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_revision_hash ON cost_source_revisions(connection_id, content_hash) WHERE content_hash <> ''`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_lines (
			id SERIAL PRIMARY KEY,
			revision_id INTEGER NOT NULL REFERENCES cost_source_revisions(id) ON DELETE CASCADE,
			connection_id INTEGER NOT NULL REFERENCES cost_connections(id) ON DELETE CASCADE,
			usage_date DATE NOT NULL,
			service TEXT NOT NULL DEFAULT '',
			region TEXT NOT NULL DEFAULT '',
			account_id TEXT NOT NULL DEFAULT '',
			resource_id TEXT NOT NULL DEFAULT '',
			team_slug TEXT NOT NULL DEFAULT '',
			project_code TEXT NOT NULL DEFAULT '',
			actual_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
			amortized_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
			currency VARCHAR(8) NOT NULL DEFAULT 'USD'
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_lines_revision ON cost_lines(revision_id, service, region)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_lines_connection ON cost_lines(connection_id, usage_date)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_aggregates (
			id SERIAL PRIMARY KEY,
			connection_id INTEGER NOT NULL REFERENCES cost_connections(id) ON DELETE CASCADE,
			revision_id INTEGER NOT NULL REFERENCES cost_source_revisions(id) ON DELETE CASCADE,
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			basis VARCHAR(16) NOT NULL,
			currency VARCHAR(8) NOT NULL DEFAULT 'USD',
			amount NUMERIC(18,6) NOT NULL DEFAULT 0,
			unallocated NUMERIC(18,6) NOT NULL DEFAULT 0,
			complete BOOLEAN NOT NULL DEFAULT FALSE,
			UNIQUE(connection_id, revision_id, basis, currency)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_allocation_rules (
			id SERIAL PRIMARY KEY,
			match_type VARCHAR(32) NOT NULL DEFAULT 'resource',
			match_value TEXT NOT NULL DEFAULT '',
			team_slug TEXT NOT NULL DEFAULT '',
			service_name TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL DEFAULT 100,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_allocation_priority ON cost_allocation_rules(priority, id)`)
	_, _ = DB.Exec(`ALTER TABLE cost_allocation_rules ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`)
	_, _ = DB.Exec(`ALTER TABLE cost_allocation_rules ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT CURRENT_DATE`)
	_, _ = DB.Exec(`ALTER TABLE cost_allocation_rules ADD COLUMN IF NOT EXISTS effective_to DATE`)
	_, _ = DB.Exec(`ALTER TABLE cost_allocation_rules ADD COLUMN IF NOT EXISTS supersedes_rule_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_budgets (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			scope_type VARCHAR(32) NOT NULL DEFAULT 'all',
			scope_value TEXT NOT NULL DEFAULT '',
			amount NUMERIC(18,6) NOT NULL,
			currency VARCHAR(8) NOT NULL DEFAULT 'USD',
			basis VARCHAR(16) NOT NULL DEFAULT 'actual',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE cost_budgets ADD COLUMN IF NOT EXISTS period VARCHAR(32) NOT NULL DEFAULT 'calendar_month'`)
	_, _ = DB.Exec(`ALTER TABLE cost_budgets ADD COLUMN IF NOT EXISTS owner_slug TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE cost_budgets ADD COLUMN IF NOT EXISTS warn_percent INTEGER NOT NULL DEFAULT 80`)
	_, _ = DB.Exec(`ALTER TABLE cost_budgets ADD COLUMN IF NOT EXISTS over_percent INTEGER NOT NULL DEFAULT 100`)
	_, _ = DB.Exec(`ALTER TABLE cost_budgets ADD COLUMN IF NOT EXISTS destination VARCHAR(32) NOT NULL DEFAULT 'cost_alerts'`)
	_, _ = DB.Exec(`ALTER TABLE ops_notification_settings ADD COLUMN IF NOT EXISTS notify_cost BOOLEAN NOT NULL DEFAULT TRUE`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_recommendation_reviews (
			calc_id TEXT PRIMARY KEY,
			group_id TEXT NOT NULL DEFAULT '',
			resource_id TEXT NOT NULL DEFAULT '',
			lifecycle VARCHAR(32) NOT NULL DEFAULT 'detected',
			change_id INTEGER NOT NULL DEFAULT 0,
			change_number TEXT NOT NULL DEFAULT '',
			dismiss_reason TEXT NOT NULL DEFAULT '',
			review_by DATE,
			allocation_reduction NUMERIC(18,6),
			bill_reduction NUMERIC(18,6),
			cost_avoidance NUMERIC(18,6),
			verification VARCHAR(32) NOT NULL DEFAULT '',
			confounders TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_reviews_lifecycle ON cost_recommendation_reviews(lifecycle)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_k8s_bindings (
			id SERIAL PRIMARY KEY,
			k8s_connection_id INTEGER NOT NULL,
			cost_connection_id INTEGER NOT NULL DEFAULT 0,
			cluster_uid TEXT NOT NULL DEFAULT '',
			cluster_name TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT '',
			cloud TEXT NOT NULL DEFAULT '',
			auth_mode TEXT NOT NULL DEFAULT '',
			project_id INTEGER NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			inventory_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			metrics_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			allocation_readiness VARCHAR(32) NOT NULL DEFAULT 'unknown',
			billing_reconciled VARCHAR(32) NOT NULL DEFAULT 'unknown',
			collector_health VARCHAR(32) NOT NULL DEFAULT 'unknown',
			collector_install VARCHAR(32) NOT NULL DEFAULT 'not_installed_by_product',
			worker_can_edit BOOLEAN NOT NULL DEFAULT FALSE,
			token_hash TEXT NOT NULL DEFAULT '',
			fixture_issued_at TIMESTAMP,
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(k8s_connection_id)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_k8s_bindings_project ON cost_k8s_bindings(project_id, cluster_name)`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_bindings ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMP`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_k8s_snapshots (
			id SERIAL PRIMARY KEY,
			binding_id INTEGER NOT NULL,
			cluster_uid TEXT NOT NULL DEFAULT '',
			window_start TIMESTAMP NOT NULL,
			window_end TIMESTAMP NOT NULL,
			complete BOOLEAN NOT NULL DEFAULT FALSE,
			content_hash TEXT NOT NULL DEFAULT '',
			collected_at TIMESTAMP NOT NULL,
			imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			supersedes_snapshot_id INTEGER NOT NULL DEFAULT 0,
			stale BOOLEAN NOT NULL DEFAULT FALSE,
			inventory_present BOOLEAN NOT NULL DEFAULT FALSE,
			metrics_present BOOLEAN NOT NULL DEFAULT FALSE,
			allocation_present BOOLEAN NOT NULL DEFAULT FALSE,
			undercoverage TEXT NOT NULL DEFAULT '',
			UNIQUE(binding_id, content_hash)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_k8s_snapshots_window ON cost_k8s_snapshots(binding_id, window_start, collected_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_k8s_identities (
			id SERIAL PRIMARY KEY,
			snapshot_id INTEGER NOT NULL,
			binding_id INTEGER NOT NULL,
			pod_uid TEXT NOT NULL DEFAULT '',
			pod_name TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			controller_kind TEXT NOT NULL DEFAULT '',
			controller_name TEXT NOT NULL DEFAULT '',
			workload_key TEXT NOT NULL DEFAULT '',
			started_at TIMESTAMP,
			ended_at TIMESTAMP,
			deleted BOOLEAN NOT NULL DEFAULT FALSE,
			cpu_request TEXT NOT NULL DEFAULT '',
			memory_request TEXT NOT NULL DEFAULT '',
			cpu_usage TEXT,
			memory_usage TEXT,
			allocation_total TEXT,
			currency VARCHAR(8) NOT NULL DEFAULT 'USD',
			estimated BOOLEAN NOT NULL DEFAULT TRUE,
			labels_json TEXT NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_k8s_identities_snapshot ON cost_k8s_identities(snapshot_id, pod_uid)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_k8s_identities_uid ON cost_k8s_identities(binding_id, pod_uid)`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_identities ADD COLUMN IF NOT EXISTS managed_by TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_identities ADD COLUMN IF NOT EXISTS hpa TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_identities ADD COLUMN IF NOT EXISTS vpa TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_identities ADD COLUMN IF NOT EXISTS pdb TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_k8s_nodes (
			id SERIAL PRIMARY KEY,
			snapshot_id INTEGER NOT NULL,
			binding_id INTEGER NOT NULL,
			node_name TEXT NOT NULL DEFAULT '',
			provider_id TEXT NOT NULL DEFAULT '',
			instance_id TEXT NOT NULL DEFAULT '',
			instance_class TEXT NOT NULL DEFAULT '',
			zone TEXT NOT NULL DEFAULT '',
			purchase_model TEXT NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_k8s_nodes_snapshot ON cost_k8s_nodes(snapshot_id, instance_id)`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_snapshots ADD COLUMN IF NOT EXISTS idle_estimated TEXT`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_snapshots ADD COLUMN IF NOT EXISTS shared_estimated TEXT`)
	_, _ = DB.Exec(`ALTER TABLE cost_k8s_snapshots ADD COLUMN IF NOT EXISTS unallocated_estimated TEXT`)
	migrateCostAccessSchema()
}
