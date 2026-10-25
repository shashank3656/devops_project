package main

func migrateOncallHandoverSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_handovers (
			id SERIAL PRIMARY KEY,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			team_name TEXT NOT NULL DEFAULT '',
			project_id INTEGER NOT NULL DEFAULT 0,
			timezone TEXT NOT NULL,
			shift_date DATE NOT NULL,
			shift_end_at TIMESTAMP NOT NULL,
			outgoing_user_id INTEGER NOT NULL DEFAULT 0,
			incoming_user_id INTEGER NOT NULL DEFAULT 0,
			outgoing_name TEXT NOT NULL DEFAULT '',
			incoming_name TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT 'draft',
			revision INTEGER NOT NULL DEFAULT 1,
			notes TEXT NOT NULL DEFAULT '',
			collection_status TEXT NOT NULL DEFAULT 'complete',
			missing_sections TEXT NOT NULL DEFAULT '[]',
			cancel_reason TEXT NOT NULL DEFAULT '',
			collected_at TIMESTAMP,
			submitted_at TIMESTAMP,
			submitted_by INTEGER NOT NULL DEFAULT 0,
			acknowledged_at TIMESTAMP,
			acknowledged_by INTEGER NOT NULL DEFAULT 0,
			escalated_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (team_id, shift_end_at)
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_oncall_handovers_state ON oncall_handovers(state, shift_end_at)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_oncall_handovers_incoming ON oncall_handovers(incoming_user_id, state)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_handover_revisions (
			id SERIAL PRIMARY KEY,
			handover_id INTEGER NOT NULL REFERENCES oncall_handovers(id) ON DELETE CASCADE,
			revision INTEGER NOT NULL,
			state TEXT NOT NULL,
			notes TEXT NOT NULL DEFAULT '',
			items_json TEXT NOT NULL DEFAULT '[]',
			actions_json TEXT NOT NULL DEFAULT '[]',
			created_by INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (handover_id, revision)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_handover_items (
			id SERIAL PRIMARY KEY,
			handover_id INTEGER NOT NULL REFERENCES oncall_handovers(id) ON DELETE CASCADE,
			source_type TEXT NOT NULL,
			source_id INTEGER NOT NULL DEFAULT 0,
			source_ref TEXT NOT NULL DEFAULT '',
			project_id INTEGER NOT NULL DEFAULT 0,
			title TEXT NOT NULL DEFAULT '',
			owner_name TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT '',
			next_action TEXT NOT NULL DEFAULT '',
			deadline TIMESTAMP,
			href TEXT NOT NULL DEFAULT '',
			critical BOOLEAN NOT NULL DEFAULT FALSE,
			section TEXT NOT NULL DEFAULT 'open_work',
			collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_oncall_handover_items_handover ON oncall_handover_items(handover_id, section)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_handover_actions (
			id SERIAL PRIMARY KEY,
			handover_id INTEGER NOT NULL REFERENCES oncall_handovers(id) ON DELETE CASCADE,
			source_type TEXT NOT NULL DEFAULT '',
			source_id INTEGER NOT NULL DEFAULT 0,
			source_ref TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			owner_name TEXT NOT NULL DEFAULT '',
			next_action TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'open',
			due_at TIMESTAMP,
			carried BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_oncall_handover_actions_status ON oncall_handover_actions(handover_id, status)`)
}
