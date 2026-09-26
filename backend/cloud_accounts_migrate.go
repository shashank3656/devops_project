package main

import "log"

// migrateCloudAccountsSchema adds NF-01 columns when cloud_accounts existed from an older partial deploy.
func migrateCloudAccountsSchema() {
	if DB == nil {
		return
	}
	stmts := []string{
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'aws'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS account_id VARCHAR(64) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(120) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS team_slug VARCHAR(120) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS environments_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(32) NOT NULL DEFAULT 'assume_role'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS role_arn VARCHAR(256) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS external_id VARCHAR(128) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS secret_ref VARCHAR(128) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'pending'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMP`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS onboarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS disabled_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_accounts_provider_account ON cloud_accounts(provider, account_id)`,
	}
	for _, stmt := range stmts {
		if _, err := DB.Exec(stmt); err != nil {
			logSchemaMigrationWarning("cloud_accounts", err)
		}
	}
}

func logSchemaMigrationWarning(table string, err error) {
	if err == nil {
		return
	}
	// Best-effort column sync; startup continues so the API stays up.
	log.Printf("schema migration warning (%s): %v", table, err)
}
