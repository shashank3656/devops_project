package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type costExportIn struct {
	UserID       int
	ConnectionID int
	Source       string
	Kind         string
	Label        string
	WindowStart  time.Time
	WindowEnd    time.Time
	Complete     bool
	Lines        []costLineRow
	Now          time.Time
}

type costExportResult struct {
	Connection  *costConnection `json:"connection"`
	Duplicate   bool            `json:"duplicate"`
	Correction  bool            `json:"correction"`
	Revision    string          `json:"revision"`
	ContentHash string          `json:"content_hash"`
	Supersedes  int             `json:"supersedes_revision_id,omitempty"`
	Kind        string          `json:"kind"`
	Label       string          `json:"label"`
	Complete    bool            `json:"complete"`
	WindowStart string          `json:"window_start"`
	WindowEnd   string          `json:"window_end"`
}

type costBatchRow struct {
	ID           int       `json:"id"`
	ConnectionID int       `json:"connection_id"`
	AccountID    string    `json:"account_id,omitempty"`
	DisplayName  string    `json:"display_name,omitempty"`
	Source       string    `json:"source"`
	Kind         string    `json:"kind"`
	Label        string    `json:"label"`
	WindowStart  string    `json:"window_start"`
	WindowEnd    string    `json:"window_end"`
	Complete     bool      `json:"complete"`
	Revision     string    `json:"revision"`
	ContentHash  string    `json:"content_hash,omitempty"`
	Supersedes   int       `json:"supersedes_revision_id,omitempty"`
	ImportedAt   time.Time `json:"imported_at"`
}

func persistCostExport(in costExportIn) (*costExportResult, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	if in.Now.IsZero() {
		in.Now = time.Now().UTC()
	}
	conn, err := getCostConnection(in.UserID, in.ConnectionID)
	if err != nil || conn == nil {
		return nil, fmt.Errorf("cost connection not found")
	}
	if costDemoAccountID(conn.AccountID) {
		return nil, fmt.Errorf("demo cloud accounts cannot be used for Cost")
	}
	if err := costWindowAllowed(in.WindowStart, in.WindowEnd, in.Now); err != nil {
		return nil, err
	}
	if len(in.Lines) == 0 {
		return nil, fmt.Errorf("CUR export has no lines")
	}
	kind := costNormalizeKind(in.Kind)
	label, err := costSanitizeLabel(in.Label)
	if err != nil {
		return nil, err
	}
	windowStart := in.WindowStart.Format("2006-01-02")
	windowEnd := in.WindowEnd.Format("2006-01-02")
	if label == "" {
		label = kind + " " + windowStart
	}
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = "aws_cur_2"
	}
	for i := range in.Lines {
		if in.Lines[i].AccountID == "" {
			in.Lines[i].AccountID = conn.AccountID
		}
		if in.Lines[i].AccountID != conn.AccountID || costDemoAccountID(in.Lines[i].AccountID) {
			return nil, fmt.Errorf("CUR usage account does not match the Cost connection")
		}
		if in.Lines[i].UsageDate == "" {
			in.Lines[i].UsageDate = windowStart
		}
		in.Lines[i].Currency = normalizeCostCurrency(in.Lines[i].Currency)
	}
	hash := costExportFingerprint(conn.AccountID, windowStart, windowEnd, in.Complete, in.Lines)
	if existing, found, lookErr := lookupCostRevisionHash(conn.ID, hash); lookErr != nil {
		return nil, lookErr
	} else if found {
		if _, err := DB.Exec(`UPDATE cost_connections SET last_ingested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, conn.ID); err != nil {
			return nil, err
		}
		updated, getErr := getCostConnection(in.UserID, conn.ID)
		if getErr != nil {
			return nil, getErr
		}
		return &costExportResult{
			Connection:  updated,
			Duplicate:   true,
			Revision:    existing.Revision,
			ContentHash: hash,
			Kind:        existing.Kind,
			Label:       existing.Label,
			Complete:    existing.Complete,
			WindowStart: existing.WindowStart,
			WindowEnd:   existing.WindowEnd,
		}, nil
	}
	previousID := latestRevisionIDForWindow(conn.ID, in.WindowStart, in.WindowEnd)
	correction := previousID > 0 && hash != ""
	if correction && kind == "import" {
		kind = "correction"
	}
	tx, err := DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var batchID int
	err = tx.QueryRow(`
		INSERT INTO cost_ingestion_batches (connection_id, source, kind, label, window_start, window_end, complete, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'imported',$8)
		RETURNING id
	`, conn.ID, source, kind, label, in.WindowStart, in.WindowEnd, in.Complete, in.UserID).Scan(&batchID)
	if err != nil {
		return nil, err
	}
	revision := hash
	if len(revision) > 24 {
		revision = revision[:24]
	}
	var revisionID int
	err = tx.QueryRow(`
		INSERT INTO cost_source_revisions (batch_id, connection_id, revision, content_hash, supersedes_revision_id, note)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id
	`, batchID, conn.ID, revision, hash, previousID, "AWS CUR 2.0. Actual and amortized stay on separate columns. Replay uses content hash.").Scan(&revisionID)
	if err != nil {
		if isUniqueViolation(err) {
			_ = tx.Rollback()
			existing, found, lookErr := lookupCostRevisionHash(conn.ID, hash)
			if lookErr != nil || !found {
				return nil, err
			}
			updated, getErr := getCostConnection(in.UserID, conn.ID)
			if getErr != nil {
				return nil, getErr
			}
			return &costExportResult{
				Connection:  updated,
				Duplicate:   true,
				Revision:    existing.Revision,
				ContentHash: hash,
				Kind:        existing.Kind,
				Label:       existing.Label,
				Complete:    existing.Complete,
				WindowStart: existing.WindowStart,
				WindowEnd:   existing.WindowEnd,
			}, nil
		}
		return nil, err
	}
	actualTotal := "0." + strings.Repeat("0", costMoneyScale)
	amortizedTotal := actualTotal
	actualUnallocated := actualTotal
	amortizedUnallocated := actualTotal
	for _, line := range in.Lines {
		usage := in.WindowStart
		if parsed, parseErr := costParseDate(line.UsageDate); parseErr == nil {
			usage = parsed
		}
		_, err = tx.Exec(`
			INSERT INTO cost_lines (
				revision_id, connection_id, usage_date, service, region, account_id, resource_id,
				team_slug, project_code, actual_amount, amortized_amount, currency
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11::numeric,$12)
		`, revisionID, conn.ID, usage, line.Service, line.Region, line.AccountID, line.ResourceID, line.TeamSlug, line.ProjectCode, line.Actual, line.Amortized, line.Currency)
		if err != nil {
			return nil, err
		}
		actualTotal = addCostAmounts(actualTotal, line.Actual)
		amortizedTotal = addCostAmounts(amortizedTotal, line.Amortized)
		if strings.TrimSpace(line.TeamSlug) == "" {
			actualUnallocated = addCostAmounts(actualUnallocated, line.Actual)
			amortizedUnallocated = addCostAmounts(amortizedUnallocated, line.Amortized)
		}
	}
	_, err = tx.Exec(`
		INSERT INTO cost_aggregates (connection_id, revision_id, period_start, period_end, basis, currency, amount, unallocated, complete)
		VALUES ($1,$2,$3,$4,'actual','USD',$5::numeric,$6::numeric,$7)
	`, conn.ID, revisionID, in.WindowStart, in.WindowEnd, actualTotal, actualUnallocated, in.Complete)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(`
		INSERT INTO cost_aggregates (connection_id, revision_id, period_start, period_end, basis, currency, amount, unallocated, complete)
		VALUES ($1,$2,$3,$4,'amortized','USD',$5::numeric,$6::numeric,$7)
	`, conn.ID, revisionID, in.WindowStart, in.WindowEnd, amortizedTotal, amortizedUnallocated, in.Complete)
	if err != nil {
		return nil, err
	}
	billing := "unknown"
	status := "pending"
	if in.Complete {
		billing = "ready"
		status = "ready"
	}
	_, err = tx.Exec(`
		UPDATE cost_connections
		   SET billing_readiness = $2, status = $3, metrics_readiness = 'unknown',
		       last_ingested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE id = $1
	`, conn.ID, billing, status)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := getCostConnection(in.UserID, conn.ID)
	if err != nil {
		return nil, err
	}
	return &costExportResult{
		Connection:  updated,
		Duplicate:   false,
		Correction:  correction,
		Revision:    revision,
		ContentHash: hash,
		Supersedes:  previousID,
		Kind:        kind,
		Label:       label,
		Complete:    in.Complete,
		WindowStart: windowStart,
		WindowEnd:   windowEnd,
	}, nil
}

func lookupCostRevisionHash(connectionID int, hash string) (costBatchRow, bool, error) {
	var row costBatchRow
	err := DB.QueryRow(`
		SELECT r.id, b.connection_id, b.source, b.kind, b.label,
		       to_char(b.window_start, 'YYYY-MM-DD'), to_char(b.window_end, 'YYYY-MM-DD'),
		       b.complete, r.revision, r.content_hash, r.supersedes_revision_id, r.imported_at
		  FROM cost_source_revisions r
		  JOIN cost_ingestion_batches b ON b.id = r.batch_id
		 WHERE r.connection_id = $1 AND r.content_hash = $2
		 ORDER BY r.imported_at DESC, r.id DESC
		 LIMIT 1
	`, connectionID, hash).Scan(
		&row.ID, &row.ConnectionID, &row.Source, &row.Kind, &row.Label,
		&row.WindowStart, &row.WindowEnd, &row.Complete, &row.Revision, &row.ContentHash, &row.Supersedes, &row.ImportedAt,
	)
	if err == sql.ErrNoRows {
		return costBatchRow{}, false, nil
	}
	if err != nil {
		return costBatchRow{}, false, err
	}
	return row, true, nil
}

func latestRevisionIDForWindow(connectionID int, start, end time.Time) int {
	var id int
	err := DB.QueryRow(`
		SELECT r.id
		  FROM cost_source_revisions r
		  JOIN cost_ingestion_batches b ON b.id = r.batch_id
		 WHERE b.connection_id = $1 AND b.window_start = $2 AND b.window_end = $3
		 ORDER BY r.imported_at DESC, r.id DESC
		 LIMIT 1
	`, connectionID, start, end).Scan(&id)
	if err != nil {
		return 0
	}
	return id
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "duplicate key") || strings.Contains(text, "unique constraint")
}

func listCostBatches(userID int) ([]costBatchRow, error) {
	connections, err := listCostConnections(userID)
	if err != nil {
		return nil, err
	}
	if len(connections) == 0 {
		return []costBatchRow{}, nil
	}
	ids := make([]int, 0, len(connections))
	names := map[int]costConnection{}
	for _, conn := range connections {
		ids = append(ids, conn.ID)
		names[conn.ID] = conn
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	rows, err := DB.Query(`
		SELECT b.id, b.connection_id, b.source, COALESCE(b.kind, 'import'), COALESCE(b.label, ''),
		       to_char(b.window_start, 'YYYY-MM-DD'), to_char(b.window_end, 'YYYY-MM-DD'),
		       b.complete, COALESCE(r.revision, ''), COALESCE(r.content_hash, ''), COALESCE(r.supersedes_revision_id, 0),
		       COALESCE(r.imported_at, b.created_at)
		  FROM cost_ingestion_batches b
		  LEFT JOIN LATERAL (
		    SELECT revision, content_hash, supersedes_revision_id, imported_at
		      FROM cost_source_revisions
		     WHERE batch_id = b.id
		     ORDER BY imported_at DESC, id DESC
		     LIMIT 1
		  ) r ON true
		 WHERE b.connection_id IN (`+strings.Join(placeholders, ",")+`)
		 ORDER BY COALESCE(r.imported_at, b.created_at) DESC, b.id DESC
		 LIMIT 50
	`, args...)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_ingestion_batches") {
			return []costBatchRow{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costBatchRow{}
	for rows.Next() {
		var row costBatchRow
		if err := rows.Scan(&row.ID, &row.ConnectionID, &row.Source, &row.Kind, &row.Label, &row.WindowStart, &row.WindowEnd, &row.Complete, &row.Revision, &row.ContentHash, &row.Supersedes, &row.ImportedAt); err != nil {
			return nil, err
		}
		if conn, ok := names[row.ConnectionID]; ok {
			row.AccountID = conn.AccountID
			row.DisplayName = conn.DisplayName
		}
		out = append(out, row)
	}
	return out, nil
}
