package main

func migrateSREObservabilitySchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`ALTER TABLE service_map ADD COLUMN IF NOT EXISTS criticality VARCHAR(40) NOT NULL DEFAULT 'unclassified'`)
	_, _ = DB.Exec(`ALTER TABLE service_map ADD COLUMN IF NOT EXISTS support_team VARCHAR(200) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE service_map ADD COLUMN IF NOT EXISTS escalation_route TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE service_map ADD COLUMN IF NOT EXISTS runbook_url TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS observability_connectors (
			id SERIAL PRIMARY KEY,
			project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			source_type VARCHAR(40) NOT NULL,
			grafana_datasource_uid VARCHAR(120) NOT NULL DEFAULT '',
			secret_ref VARCHAR(200) NOT NULL DEFAULT '',
			status VARCHAR(40) NOT NULL DEFAULT 'untested',
			last_tested_at TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_observability_connectors_project ON observability_connectors (project_id)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS service_monitors (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			project_id INTEGER,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			name VARCHAR(200) NOT NULL,
			measurement_type VARCHAR(40) NOT NULL,
			connector_id INTEGER REFERENCES observability_connectors(id) ON DELETE SET NULL,
			enabled BOOLEAN NOT NULL DEFAULT FALSE,
			current_version INTEGER NOT NULL DEFAULT 1,
			owner VARCHAR(200) NOT NULL DEFAULT '',
			created_by INTEGER NOT NULL DEFAULT 0,
			updated_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_service_monitors_service ON service_monitors (service_id, environment)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS service_monitor_versions (
			id SERIAL PRIMARY KEY,
			monitor_id INTEGER NOT NULL REFERENCES service_monitors(id) ON DELETE CASCADE,
			version INTEGER NOT NULL,
			query_text TEXT NOT NULL DEFAULT '',
			query_language VARCHAR(40) NOT NULL DEFAULT '',
			good_field VARCHAR(80) NOT NULL DEFAULT '',
			total_field VARCHAR(80) NOT NULL DEFAULT '',
			bad_field VARCHAR(80) NOT NULL DEFAULT '',
			timestamp_field VARCHAR(80) NOT NULL DEFAULT '',
			latency_field VARCHAR(80) NOT NULL DEFAULT '',
			latency_unit VARCHAR(20) NOT NULL DEFAULT 'ms',
			target_bps INTEGER NOT NULL DEFAULT 0,
			window_minutes INTEGER NOT NULL DEFAULT 0,
			latency_threshold_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
			min_samples INTEGER NOT NULL DEFAULT 0,
			min_coverage_bps INTEGER NOT NULL DEFAULT 0,
			freshness_minutes INTEGER NOT NULL DEFAULT 0,
			ingestion_delay_minutes INTEGER NOT NULL DEFAULT 0,
			warning_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
			critical_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
			calculation_mode VARCHAR(40) NOT NULL DEFAULT 'local',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (monitor_id, version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_evaluation_batches (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			project_id INTEGER,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			actor_id INTEGER NOT NULL DEFAULT 0,
			state VARCHAR(40) NOT NULL DEFAULT 'queued',
			anchor_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			coalesce_key VARCHAR(240) NOT NULL DEFAULT '',
			monitor_ids TEXT NOT NULL DEFAULT '',
			correlation_id VARCHAR(80) NOT NULL DEFAULT '',
			started_at TIMESTAMP,
			finished_at TIMESTAMP,
			error TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_eval_batches_scope ON monitor_evaluation_batches (service_id, environment, created_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_evaluation_runs (
			id SERIAL PRIMARY KEY,
			batch_id INTEGER NOT NULL REFERENCES monitor_evaluation_batches(id) ON DELETE CASCADE,
			monitor_id INTEGER NOT NULL REFERENCES service_monitors(id) ON DELETE CASCADE,
			version INTEGER NOT NULL DEFAULT 1,
			state VARCHAR(40) NOT NULL DEFAULT 'queued',
			quality VARCHAR(40) NOT NULL DEFAULT 'invalid',
			measurement_state VARCHAR(40) NOT NULL DEFAULT 'unknown',
			good_count BIGINT NOT NULL DEFAULT 0,
			total_count BIGINT NOT NULL DEFAULT 0,
			bad_count BIGINT NOT NULL DEFAULT 0,
			availability_bps INTEGER NOT NULL DEFAULT 0,
			budget_remaining_bps INTEGER NOT NULL DEFAULT 0,
			burn_rate_milli INTEGER NOT NULL DEFAULT 0,
			coverage_bps INTEGER NOT NULL DEFAULT 0,
			sample_count BIGINT NOT NULL DEFAULT 0,
			window_minutes INTEGER NOT NULL DEFAULT 0,
			covered_minutes INTEGER NOT NULL DEFAULT 0,
			observed_at TIMESTAMP,
			evaluated_at TIMESTAMP,
			reason TEXT NOT NULL DEFAULT '',
			source_error TEXT NOT NULL DEFAULT '',
			evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_eval_runs_monitor ON monitor_evaluation_runs (monitor_id, evaluated_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_findings (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			monitor_id INTEGER NOT NULL REFERENCES service_monitors(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			identity_key VARCHAR(240) NOT NULL,
			severity VARCHAR(40) NOT NULL,
			lifecycle VARCHAR(40) NOT NULL DEFAULT 'open',
			title VARCHAR(240) NOT NULL,
			explanation TEXT NOT NULL DEFAULT '',
			observed TEXT NOT NULL DEFAULT '',
			expected TEXT NOT NULL DEFAULT '',
			source_type VARCHAR(40) NOT NULL DEFAULT '',
			query_version INTEGER NOT NULL DEFAULT 1,
			evaluation_run_id INTEGER,
			owner VARCHAR(200) NOT NULL DEFAULT '',
			ack_note TEXT NOT NULL DEFAULT '',
			acked_by INTEGER NOT NULL DEFAULT 0,
			acked_at TIMESTAMP,
			first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_evaluated_at TIMESTAMP,
			resolved_at TIMESTAMP,
			UNIQUE (service_id, identity_key)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_findings_service ON monitor_findings (service_id, environment, lifecycle, severity)`)
	_, _ = DB.Exec(`ALTER TABLE observability_connectors ADD COLUMN IF NOT EXISTS base_url TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE observability_connectors ADD COLUMN IF NOT EXISTS ingest_delay_minutes INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE observability_connectors ADD COLUMN IF NOT EXISTS timeout_seconds INTEGER NOT NULL DEFAULT 15`)
	_, _ = DB.Exec(`ALTER TABLE service_monitors ADD COLUMN IF NOT EXISTS schedule_minutes INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE service_monitors ADD COLUMN IF NOT EXISTS last_known_good_version INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE service_monitors ADD COLUMN IF NOT EXISTS ingest_delay_minutes INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE monitor_findings ADD COLUMN IF NOT EXISTS incident_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE monitor_findings ADD COLUMN IF NOT EXISTS episode_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = DB.Exec(`ALTER TABLE monitor_findings ALTER COLUMN monitor_id DROP NOT NULL`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_private_samples (
			id SERIAL PRIMARY KEY,
			connector_id INTEGER NOT NULL REFERENCES observability_connectors(id) ON DELETE CASCADE,
			service_id INTEGER NOT NULL DEFAULT 0,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			good_count BIGINT NOT NULL DEFAULT 0,
			total_count BIGINT NOT NULL DEFAULT 0,
			latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
			observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_private_samples ON monitor_private_samples (connector_id, service_id, environment, observed_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_routing_policies (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			observation_only BOOLEAN NOT NULL DEFAULT TRUE,
			create_incidents BOOLEAN NOT NULL DEFAULT FALSE,
			page_oncall BOOLEAN NOT NULL DEFAULT FALSE,
			updated_by INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (service_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_guardrail_policies (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			mode VARCHAR(40) NOT NULL DEFAULT 'observation',
			block_on_critical BOOLEAN NOT NULL DEFAULT TRUE,
			min_budget_bps INTEGER NOT NULL DEFAULT 2000,
			freshness_minutes INTEGER NOT NULL DEFAULT 1440,
			policy_version INTEGER NOT NULL DEFAULT 1,
			updated_by INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (service_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_guardrail_decisions (
			id SERIAL PRIMARY KEY,
			policy_id INTEGER,
			change_id INTEGER NOT NULL DEFAULT 0,
			service_id INTEGER NOT NULL DEFAULT 0,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			artifact_sha VARCHAR(120) NOT NULL DEFAULT '',
			mode VARCHAR(40) NOT NULL DEFAULT 'observation',
			outcome VARCHAR(40) NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
			policy_version INTEGER NOT NULL DEFAULT 1,
			expires_at TIMESTAMP,
			override_reason TEXT NOT NULL DEFAULT '',
			override_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_guardrail_decisions_change ON monitor_guardrail_decisions (change_id, created_at DESC)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_webhook_receipts (
			id SERIAL PRIMARY KEY,
			source VARCHAR(40) NOT NULL DEFAULT '',
			body_sha VARCHAR(64) NOT NULL,
			received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (source, body_sha)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS monitor_alert_episodes (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES service_map(id) ON DELETE CASCADE,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			fingerprint VARCHAR(240) NOT NULL,
			sequence INTEGER NOT NULL DEFAULT 1,
			status VARCHAR(40) NOT NULL DEFAULT 'firing',
			severity VARCHAR(40) NOT NULL DEFAULT 'warning',
			title TEXT NOT NULL DEFAULT '',
			incident_id INTEGER NOT NULL DEFAULT 0,
			started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_event_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			recovered_at TIMESTAMP,
			UNIQUE (service_id, fingerprint, sequence)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_monitor_alert_episodes_service ON monitor_alert_episodes (service_id, environment, status)`)
}
