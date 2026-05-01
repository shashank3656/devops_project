package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

// ---------- cloud_accounts ----------

func saveCloudAccount(ctx context.Context, actorID int, acct CloudAccount, creds CloudCredentials) (CloudAccount, error) {
	if DB == nil {
		return acct, fmt.Errorf("database not initialised")
	}
	plaintext, err := json.Marshal(creds)
	if err != nil {
		return acct, err
	}
	cipherBytes, nonceBytes, err := encryptCloudSecret(plaintext)
	if err != nil {
		return acct, err
	}

	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return acct, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRowContext(ctx, `
		INSERT INTO cloud_accounts
			(name, cloud, auth_method, default_regions, default_currency,
			 retention_days, ai_provider, ai_model, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, created_at, updated_at
	`,
		strings.TrimSpace(acct.Name), acct.Cloud, creds.AuthMethod,
		pq.Array(acct.DefaultRegions), defaultIfBlank(acct.DefaultCurrency, "USD"),
		nullableInt(acct.RetentionDays), nullableString(acct.AIProvider), nullableString(acct.AIModel),
		"active", actorID,
	)
	if err := row.Scan(&acct.ID, &acct.CreatedAt, &acct.UpdatedAt); err != nil {
		return acct, fmt.Errorf("insert cloud_account: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO cloud_account_secrets (account_id, ciphertext, nonce)
		VALUES ($1, $2, $3)
	`, acct.ID, cipherBytes, nonceBytes); err != nil {
		return acct, fmt.Errorf("insert account secret: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return acct, err
	}
	acct.AuthMethod = creds.AuthMethod
	acct.Status = "active"
	cb := actorID
	acct.CreatedBy = &cb
	return acct, nil
}

func listCloudAccounts(ctx context.Context) ([]CloudAccount, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT a.id, a.name, a.cloud, a.auth_method, a.default_regions, a.default_currency,
			a.retention_days, COALESCE(a.ai_provider, ''), COALESCE(a.ai_model, ''),
			a.status, a.last_test_at, COALESCE(a.last_test_status, ''), COALESCE(a.last_test_message, ''),
			a.last_scan_id, a.last_scan_at, a.created_by, COALESCE(u.username, ''),
			a.created_at, a.updated_at
		FROM cloud_accounts a
		LEFT JOIN users u ON u.id = a.created_by
		ORDER BY a.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CloudAccount{}
	for rows.Next() {
		var (
			a            CloudAccount
			retention    sql.NullInt64
			lastTestAt   sql.NullTime
			lastScanID   sql.NullInt64
			lastScanAt   sql.NullTime
			createdBy    sql.NullInt64
			username     string
			defaultRegs  pq.StringArray
		)
		if err := rows.Scan(&a.ID, &a.Name, &a.Cloud, &a.AuthMethod, &defaultRegs, &a.DefaultCurrency,
			&retention, &a.AIProvider, &a.AIModel,
			&a.Status, &lastTestAt, &a.LastTestStatus, &a.LastTestMessage,
			&lastScanID, &lastScanAt, &createdBy, &username,
			&a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		a.DefaultRegions = []string(defaultRegs)
		if retention.Valid {
			v := int(retention.Int64)
			a.RetentionDays = &v
		}
		if lastTestAt.Valid {
			t := lastTestAt.Time
			a.LastTestAt = &t
		}
		if lastScanID.Valid {
			id := int(lastScanID.Int64)
			a.LastScanID = &id
		}
		if lastScanAt.Valid {
			t := lastScanAt.Time
			a.LastScanAt = &t
		}
		if createdBy.Valid {
			id := int(createdBy.Int64)
			a.CreatedBy = &id
		}
		a.CreatedByUsername = username
		out = append(out, a)
	}
	return out, rows.Err()
}

func getCloudAccount(ctx context.Context, id int) (*CloudAccount, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	row := DB.QueryRowContext(ctx, `
		SELECT a.id, a.name, a.cloud, a.auth_method, a.default_regions, a.default_currency,
			a.retention_days, COALESCE(a.ai_provider, ''), COALESCE(a.ai_model, ''),
			a.status, a.last_test_at, COALESCE(a.last_test_status, ''), COALESCE(a.last_test_message, ''),
			a.last_scan_id, a.last_scan_at, a.created_by, COALESCE(u.username, ''),
			a.created_at, a.updated_at
		FROM cloud_accounts a
		LEFT JOIN users u ON u.id = a.created_by
		WHERE a.id = $1
	`, id)
	var (
		a           CloudAccount
		retention   sql.NullInt64
		lastTestAt  sql.NullTime
		lastScanID  sql.NullInt64
		lastScanAt  sql.NullTime
		createdBy   sql.NullInt64
		username    string
		defaultRegs pq.StringArray
	)
	if err := row.Scan(&a.ID, &a.Name, &a.Cloud, &a.AuthMethod, &defaultRegs, &a.DefaultCurrency,
		&retention, &a.AIProvider, &a.AIModel,
		&a.Status, &lastTestAt, &a.LastTestStatus, &a.LastTestMessage,
		&lastScanID, &lastScanAt, &createdBy, &username,
		&a.CreatedAt, &a.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	a.DefaultRegions = []string(defaultRegs)
	if retention.Valid {
		v := int(retention.Int64)
		a.RetentionDays = &v
	}
	if lastTestAt.Valid {
		t := lastTestAt.Time
		a.LastTestAt = &t
	}
	if lastScanID.Valid {
		id := int(lastScanID.Int64)
		a.LastScanID = &id
	}
	if lastScanAt.Valid {
		t := lastScanAt.Time
		a.LastScanAt = &t
	}
	if createdBy.Valid {
		id := int(createdBy.Int64)
		a.CreatedBy = &id
	}
	a.CreatedByUsername = username
	return &a, nil
}

func loadCloudCredentials(ctx context.Context, accountID int) (CloudCredentials, error) {
	var creds CloudCredentials
	if DB == nil {
		return creds, fmt.Errorf("database not initialised")
	}
	row := DB.QueryRowContext(ctx, `SELECT ciphertext, nonce FROM cloud_account_secrets WHERE account_id = $1`, accountID)
	var ct, nonce []byte
	if err := row.Scan(&ct, &nonce); err != nil {
		return creds, err
	}
	plain, err := decryptCloudSecret(ct, nonce)
	if err != nil {
		return creds, err
	}
	if err := json.Unmarshal(plain, &creds); err != nil {
		return creds, err
	}
	return creds, nil
}

func updateCloudAccountMeta(ctx context.Context, id int, name, currency, aiProvider, aiModel string, regions []string, retentionDays *int, status string) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `
		UPDATE cloud_accounts SET
			name = COALESCE(NULLIF($2, ''), name),
			default_currency = COALESCE(NULLIF($3, ''), default_currency),
			ai_provider = COALESCE(NULLIF($4, ''), ai_provider),
			ai_model = COALESCE(NULLIF($5, ''), ai_model),
			default_regions = COALESCE($6, default_regions),
			retention_days = COALESCE($7, retention_days),
			status = COALESCE(NULLIF($8, ''), status),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, strings.TrimSpace(name), currency, aiProvider, aiModel, pq.Array(regions), nullableInt(retentionDays), status)
	return err
}

func rotateCloudCredentials(ctx context.Context, id int, creds CloudCredentials) error {
	plaintext, err := json.Marshal(creds)
	if err != nil {
		return err
	}
	cipherBytes, nonceBytes, err := encryptCloudSecret(plaintext)
	if err != nil {
		return err
	}
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO cloud_account_secrets (account_id, ciphertext, nonce, rotated_at)
		VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
		ON CONFLICT (account_id) DO UPDATE SET
			ciphertext = EXCLUDED.ciphertext,
			nonce = EXCLUDED.nonce,
			rotated_at = CURRENT_TIMESTAMP
	`, id, cipherBytes, nonceBytes); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE cloud_accounts SET auth_method = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, creds.AuthMethod); err != nil {
		return err
	}
	return tx.Commit()
}

func deleteCloudAccount(ctx context.Context, id int) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `DELETE FROM cloud_accounts WHERE id = $1`, id)
	return err
}

func recordAccountTest(ctx context.Context, id int, status, message string) {
	if DB == nil {
		return
	}
	_, _ = DB.ExecContext(ctx, `
		UPDATE cloud_accounts SET
			last_test_at = CURRENT_TIMESTAMP,
			last_test_status = $2,
			last_test_message = $3,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, truncate(message, 800))
}

// ---------- idle_scans ----------

func createIdleScan(ctx context.Context, scan IdleScan, triggeredBy int) (IdleScan, error) {
	if DB == nil {
		return scan, fmt.Errorf("database not initialised")
	}
	if scan.Thresholds == nil {
		scan.Thresholds = json.RawMessage("{}")
	}
	if scan.Progress == nil {
		scan.Progress = json.RawMessage("{}")
	}
	if scan.Totals == nil {
		scan.Totals = json.RawMessage("{}")
	}
	if scan.ErrorLog == nil {
		scan.ErrorLog = json.RawMessage("[]")
	}
	row := DB.QueryRowContext(ctx, `
		INSERT INTO idle_scans
			(account_id, cloud, regions, scope, thresholds, ai_provider, ai_model,
			 status, progress, totals, error_log, triggered_by)
		VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
		RETURNING id, created_at, updated_at
	`,
		scan.AccountID, scan.Cloud, pq.Array(scan.Regions), pq.Array(scan.Scope),
		string(scan.Thresholds), nullableString(scan.AIProvider), nullableString(scan.AIModel),
		"pending", string(scan.Progress), string(scan.Totals), string(scan.ErrorLog),
		triggeredBy,
	)
	if err := row.Scan(&scan.ID, &scan.CreatedAt, &scan.UpdatedAt); err != nil {
		return scan, err
	}
	tb := triggeredBy
	scan.TriggeredBy = &tb
	scan.Status = "pending"
	return scan, nil
}

type scanUpdate struct {
	Status         *string
	Progress       json.RawMessage
	Totals         json.RawMessage
	ErrorLog       json.RawMessage
	ErrorMessage   *string
	RawArtifactURL *string
	StartedAt      *time.Time
	FinishedAt     *time.Time
}

func updateIdleScan(ctx context.Context, id int, upd scanUpdate) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `
		UPDATE idle_scans SET
			status = COALESCE(NULLIF($2, ''), status),
			progress = COALESCE($3::jsonb, progress),
			totals = COALESCE($4::jsonb, totals),
			error_log = COALESCE($5::jsonb, error_log),
			error_message = COALESCE($6, error_message),
			raw_artifact_url = COALESCE($7, raw_artifact_url),
			started_at = COALESCE($8, started_at),
			finished_at = COALESCE($9, finished_at),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id,
		stringFromPtr(upd.Status),
		jsonStringPtr(upd.Progress),
		jsonStringPtr(upd.Totals),
		jsonStringPtr(upd.ErrorLog),
		upd.ErrorMessage,
		upd.RawArtifactURL,
		upd.StartedAt, upd.FinishedAt,
	)
	return err
}

func listIdleScans(ctx context.Context, accountID int) ([]IdleScan, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	args := []interface{}{}
	where := ""
	if accountID > 0 {
		where = "WHERE s.account_id = $1"
		args = append(args, accountID)
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT s.id, s.account_id, COALESCE(a.name, ''), s.cloud, s.regions, s.scope,
			s.thresholds::text, COALESCE(s.ai_provider, ''), COALESCE(s.ai_model, ''),
			s.status, s.progress::text, s.totals::text, s.error_log::text,
			COALESCE(s.error_message, ''), COALESCE(s.raw_artifact_url, ''),
			s.triggered_by, COALESCE(u.username, ''), s.started_at, s.finished_at,
			s.created_at, s.updated_at
		FROM idle_scans s
		LEFT JOIN cloud_accounts a ON a.id = s.account_id
		LEFT JOIN users u ON u.id = s.triggered_by
		`+where+`
		ORDER BY s.created_at DESC
		LIMIT 200
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleScan{}
	for rows.Next() {
		var (
			s           IdleScan
			thresholds  string
			progress    string
			totals      string
			errorLog    string
			triggeredBy sql.NullInt64
			startedAt   sql.NullTime
			finishedAt  sql.NullTime
			regions     pq.StringArray
			scope       pq.StringArray
			username    string
		)
		if err := rows.Scan(&s.ID, &s.AccountID, &s.AccountName, &s.Cloud, &regions, &scope,
			&thresholds, &s.AIProvider, &s.AIModel,
			&s.Status, &progress, &totals, &errorLog,
			&s.ErrorMessage, &s.RawArtifactURL,
			&triggeredBy, &username, &startedAt, &finishedAt,
			&s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Regions = []string(regions)
		s.Scope = []string(scope)
		s.Thresholds = json.RawMessage(thresholds)
		s.Progress = json.RawMessage(progress)
		s.Totals = json.RawMessage(totals)
		s.ErrorLog = json.RawMessage(errorLog)
		if triggeredBy.Valid {
			id := int(triggeredBy.Int64)
			s.TriggeredBy = &id
		}
		s.TriggeredUsername = username
		if startedAt.Valid {
			t := startedAt.Time
			s.StartedAt = &t
		}
		if finishedAt.Valid {
			t := finishedAt.Time
			s.FinishedAt = &t
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func getIdleScan(ctx context.Context, id int) (*IdleScan, error) {
	scans, err := listIdleScansWhere(ctx, "WHERE s.id = $1", id)
	if err != nil {
		return nil, err
	}
	if len(scans) == 0 {
		return nil, nil
	}
	return &scans[0], nil
}

func listIdleScansWhere(ctx context.Context, where string, args ...interface{}) ([]IdleScan, error) {
	rows, err := DB.QueryContext(ctx, `
		SELECT s.id, s.account_id, COALESCE(a.name, ''), s.cloud, s.regions, s.scope,
			s.thresholds::text, COALESCE(s.ai_provider, ''), COALESCE(s.ai_model, ''),
			s.status, s.progress::text, s.totals::text, s.error_log::text,
			COALESCE(s.error_message, ''), COALESCE(s.raw_artifact_url, ''),
			s.triggered_by, COALESCE(u.username, ''), s.started_at, s.finished_at,
			s.created_at, s.updated_at
		FROM idle_scans s
		LEFT JOIN cloud_accounts a ON a.id = s.account_id
		LEFT JOIN users u ON u.id = s.triggered_by
		`+where+`
		ORDER BY s.created_at DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleScan{}
	for rows.Next() {
		var (
			s           IdleScan
			thresholds  string
			progress    string
			totals      string
			errorLog    string
			triggeredBy sql.NullInt64
			startedAt   sql.NullTime
			finishedAt  sql.NullTime
			regions     pq.StringArray
			scope       pq.StringArray
			username    string
		)
		if err := rows.Scan(&s.ID, &s.AccountID, &s.AccountName, &s.Cloud, &regions, &scope,
			&thresholds, &s.AIProvider, &s.AIModel,
			&s.Status, &progress, &totals, &errorLog,
			&s.ErrorMessage, &s.RawArtifactURL,
			&triggeredBy, &username, &startedAt, &finishedAt,
			&s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Regions = []string(regions)
		s.Scope = []string(scope)
		s.Thresholds = json.RawMessage(thresholds)
		s.Progress = json.RawMessage(progress)
		s.Totals = json.RawMessage(totals)
		s.ErrorLog = json.RawMessage(errorLog)
		if triggeredBy.Valid {
			id := int(triggeredBy.Int64)
			s.TriggeredBy = &id
		}
		s.TriggeredUsername = username
		if startedAt.Valid {
			t := startedAt.Time
			s.StartedAt = &t
		}
		if finishedAt.Valid {
			t := finishedAt.Time
			s.FinishedAt = &t
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---------- idle_resources ----------

func insertIdleResources(ctx context.Context, scanID, accountID int, cloud string, resources []IdleResource) error {
	if DB == nil || len(resources) == 0 {
		return nil
	}
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO idle_resources
			(scan_id, account_id, cloud, service, region, resource_id, name, tags,
			 state, created_at_remote, metrics, cost_estimate_usd, reason, severity, console_url)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14,$15)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range resources {
		tagsJSON, _ := json.Marshal(r.Tags)
		if len(tagsJSON) == 0 {
			tagsJSON = []byte("{}")
		}
		metricsJSON, _ := json.Marshal(r.Metrics)
		if len(metricsJSON) == 0 {
			metricsJSON = []byte("{}")
		}
		if _, err := stmt.ExecContext(ctx,
			scanID, accountID, cloud, r.Service, r.Region, r.ResourceID, r.Name,
			string(tagsJSON), r.State, r.CreatedAtRemote, string(metricsJSON),
			r.CostEstimateUSD, r.Reason, r.Severity, r.ConsoleURL,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func listIdleResourcesByScan(ctx context.Context, scanID int, filters resourceFilters) ([]IdleResource, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	clauses := []string{"scan_id = $1"}
	args := []interface{}{scanID}
	if filters.Service != "" {
		args = append(args, filters.Service)
		clauses = append(clauses, fmt.Sprintf("service = $%d", len(args)))
	}
	if filters.Severity != "" {
		args = append(args, filters.Severity)
		clauses = append(clauses, fmt.Sprintf("severity = $%d", len(args)))
	}
	if filters.Region != "" {
		args = append(args, filters.Region)
		clauses = append(clauses, fmt.Sprintf("region = $%d", len(args)))
	}
	if q := strings.TrimSpace(filters.Query); q != "" {
		args = append(args, "%"+strings.ToLower(q)+"%")
		clauses = append(clauses, fmt.Sprintf("(LOWER(name) LIKE $%d OR LOWER(resource_id) LIKE $%d)", len(args), len(args)))
	}
	limit := filters.Limit
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	q := `
		SELECT id, scan_id, account_id, cloud, service, region, resource_id, name, tags::text,
			state, created_at_remote, metrics::text, cost_estimate_usd, reason, severity,
			COALESCE(console_url, ''), ai_rank, ai_recommendation, ai_confidence, created_at
		FROM idle_resources
		WHERE ` + strings.Join(clauses, " AND ") + `
		ORDER BY ai_rank NULLS LAST, cost_estimate_usd DESC, severity DESC
		LIMIT ` + fmt.Sprintf("%d", limit)
	rows, err := DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleResource{}
	for rows.Next() {
		var (
			r           IdleResource
			tagsStr     string
			metricsStr  string
			createdRem  sql.NullTime
			aiRank      sql.NullInt64
			aiRec       sql.NullString
			aiConf      sql.NullFloat64
		)
		if err := rows.Scan(&r.ID, &r.ScanID, &r.AccountID, &r.Cloud, &r.Service, &r.Region, &r.ResourceID, &r.Name, &tagsStr,
			&r.State, &createdRem, &metricsStr, &r.CostEstimateUSD, &r.Reason, &r.Severity,
			&r.ConsoleURL, &aiRank, &aiRec, &aiConf, &r.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tagsStr), &r.Tags)
		_ = json.Unmarshal([]byte(metricsStr), &r.Metrics)
		if createdRem.Valid {
			t := createdRem.Time
			r.CreatedAtRemote = &t
		}
		if aiRank.Valid {
			v := int(aiRank.Int64)
			r.AIRank = &v
		}
		if aiRec.Valid {
			r.AIRecommendation = aiRec.String
		}
		if aiConf.Valid {
			v := aiConf.Float64
			r.AIConfidence = &v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type resourceFilters struct {
	Service  string
	Severity string
	Region   string
	Query    string
	Limit    int
}

func setScanCompletion(ctx context.Context, scanID int, totals map[string]any, status, errorMessage string) error {
	totalsJSON, _ := json.Marshal(totals)
	finished := time.Now()
	upd := scanUpdate{
		Status:       &status,
		Totals:       totalsJSON,
		ErrorMessage: stringPtrIfNotEmpty(errorMessage),
		FinishedAt:   &finished,
	}
	if err := updateIdleScan(ctx, scanID, upd); err != nil {
		return err
	}
	if accountID, _ := scanAccountID(ctx, scanID); accountID > 0 {
		_, _ = DB.ExecContext(ctx, `UPDATE cloud_accounts SET last_scan_id = $2, last_scan_at = CURRENT_TIMESTAMP WHERE id = $1`, accountID, scanID)
	}
	return nil
}

func scanAccountID(ctx context.Context, scanID int) (int, error) {
	var id int
	if err := DB.QueryRowContext(ctx, `SELECT account_id FROM idle_scans WHERE id = $1`, scanID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// ---------- ai rankings ----------

func saveAIRanking(ctx context.Context, scanID int, provider, model, promptHash, prompt, response string, ranked int, actorID int) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `
		INSERT INTO idle_ai_rankings
			(scan_id, provider, model, prompt_hash, prompt_excerpt, response_raw, ranked_count, triggered_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, scanID, provider, model, promptHash, truncate(prompt, 4000), truncate(response, 60000), ranked, actorID)
	return err
}

func applyAIRanksToResources(ctx context.Context, scanID int, ranks []aiRankItem) error {
	if DB == nil || len(ranks) == 0 {
		return nil
	}
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx, `
		UPDATE idle_resources
		SET ai_rank = $2, ai_recommendation = $3, ai_confidence = $4
		WHERE id = $1 AND scan_id = $5
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range ranks {
		if _, err := stmt.ExecContext(ctx, r.ID, r.Rank, r.Recommendation, r.Confidence, scanID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- settings ----------

func getIdleSettings(ctx context.Context) (IdleSettings, error) {
	var s IdleSettings
	if DB == nil {
		return s, fmt.Errorf("database not initialised")
	}
	row := DB.QueryRowContext(ctx, `
		SELECT retention_days, purge_raw_artifacts, purge_resources,
			default_ai_provider, default_ai_model
		FROM idle_settings WHERE id = 1
	`)
	if err := row.Scan(&s.RetentionDays, &s.PurgeRawArtifacts, &s.PurgeResources,
		&s.DefaultAIProvider, &s.DefaultAIModel); err != nil {
		if err == sql.ErrNoRows {
			s.RetentionDays = IdleRetentionDays
			s.DefaultAIProvider = IdleAIProvider
			s.DefaultAIModel = IdleAIModel
			return s, nil
		}
		return s, err
	}
	return s, nil
}

func updateIdleSettings(ctx context.Context, s IdleSettings, actorID int) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `
		UPDATE idle_settings SET
			retention_days = $1,
			purge_raw_artifacts = $2,
			purge_resources = $3,
			default_ai_provider = $4,
			default_ai_model = $5,
			updated_at = CURRENT_TIMESTAMP,
			updated_by = $6
		WHERE id = 1
	`, s.RetentionDays, s.PurgeRawArtifacts, s.PurgeResources, s.DefaultAIProvider, s.DefaultAIModel, actorID)
	return err
}

// ---------- audit ----------

func writeIdleAudit(ctx context.Context, accountID, scanID, actorID int, action string, details map[string]any) {
	if DB == nil {
		return
	}
	body, _ := json.Marshal(details)
	if len(body) == 0 {
		body = []byte("{}")
	}
	var aID, sID interface{}
	if accountID > 0 {
		aID = accountID
	}
	if scanID > 0 {
		sID = scanID
	}
	_, _ = DB.ExecContext(ctx, `
		INSERT INTO idle_audit_log (account_id, scan_id, actor_id, action, details)
		VALUES ($1,$2,$3,$4,$5::jsonb)
	`, aID, sID, actorID, action, string(body))
}

// ---------- helpers ----------

func defaultIfBlank(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nullableInt(v *int) interface{} {
	if v == nil {
		return nil
	}
	return *v
}

func nullableString(v string) interface{} {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func stringFromPtr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func stringPtrIfNotEmpty(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func jsonStringPtr(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
