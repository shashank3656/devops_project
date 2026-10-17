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
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS environments_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(32) NOT NULL DEFAULT 'assume_role'`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS role_arn VARCHAR(256) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS external_id VARCHAR(128) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ADD COLUMN IF NOT EXISTS secret_ref VARCHAR(128) NOT NULL DEFAULT ''`,
		`ALTER TABLE cloud_accounts ALTER COLUMN role_arn TYPE TEXT`,
		`ALTER TABLE cloud_accounts ALTER COLUMN external_id TYPE TEXT`,
		`ALTER TABLE cloud_accounts ALTER COLUMN secret_ref TYPE TEXT`,
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
	sealStoredCloudAccountSecrets()
}

func sealStoredCloudAccountSecrets() {
	if DB == nil {
		return
	}
	rows, err := DB.Query(`SELECT id, COALESCE(role_arn,''), COALESCE(external_id,''), COALESCE(secret_ref,'') FROM cloud_accounts`)
	if err != nil {
		logSchemaMigrationWarning("cloud_accounts", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var roleARN, externalID, secretRef string
		if err := rows.Scan(&id, &roleARN, &externalID, &secretRef); err != nil {
			continue
		}
		roleOpen := roleARN != "" && !cloudSecretIsSealed(roleARN)
		externalOpen := externalID != "" && !cloudSecretIsSealed(externalID)
		secretOpen := secretRef != "" && !cloudSecretIsSealed(secretRef)
		if !roleOpen && !externalOpen && !secretOpen {
			continue
		}
		if roleARN != "" && !cloudSecretIsSealed(roleARN) {
			sealed, sealErr := sealCloudSecret(roleARN)
			if sealErr != nil {
				logSchemaMigrationWarning("cloud_accounts", sealErr)
				return
			}
			roleARN = sealed
		}
		if externalID != "" && !cloudSecretIsSealed(externalID) {
			sealed, sealErr := sealCloudSecret(externalID)
			if sealErr != nil {
				logSchemaMigrationWarning("cloud_accounts", sealErr)
				return
			}
			externalID = sealed
		}
		if secretRef != "" && !cloudSecretIsSealed(secretRef) {
			sealed, sealErr := sealCloudSecret(secretRef)
			if sealErr != nil {
				logSchemaMigrationWarning("cloud_accounts", sealErr)
				return
			}
			secretRef = sealed
		}
		if _, err := DB.Exec(`UPDATE cloud_accounts SET role_arn = $2, external_id = $3, secret_ref = $4 WHERE id = $1`, id, roleARN, externalID, secretRef); err != nil {
			logSchemaMigrationWarning("cloud_accounts", err)
			return
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
