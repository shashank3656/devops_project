package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/lib/pq"
)

// IdleSchedule is an automated scan plan attached to a cloud account. The
// runner ticks once per hour and triggers the matching schedules.
type IdleSchedule struct {
	ID            int        `json:"id"`
	AccountID     int        `json:"account_id"`
	Name          string     `json:"name"`
	Cadence       string     `json:"cadence"`
	HourUTC       int        `json:"hour_utc"`
	Regions       []string   `json:"regions"`
	Scope         []string   `json:"scope"`
	AIProvider    string     `json:"ai_provider,omitempty"`
	AIModel       string     `json:"ai_model,omitempty"`
	Enabled       bool       `json:"enabled"`
	LastRunAt     *time.Time `json:"last_run_at,omitempty"`
	LastScanID    *int       `json:"last_scan_id,omitempty"`
	LastRunStatus string     `json:"last_run_status,omitempty"`
	CreatedBy     *int       `json:"created_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func listSchedulesForAccount(ctx context.Context, accountID int) ([]IdleSchedule, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT id, account_id, name, cadence, hour_utc, regions, scope,
			COALESCE(ai_provider, ''), COALESCE(ai_model, ''),
			enabled, last_run_at, last_scan_id, COALESCE(last_run_status, ''),
			created_by, created_at, updated_at
		FROM idle_schedules WHERE account_id = $1 ORDER BY created_at DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleSchedule{}
	for rows.Next() {
		s, err := scanIdleSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func listAllEnabledSchedules(ctx context.Context) ([]IdleSchedule, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialised")
	}
	rows, err := DB.QueryContext(ctx, `
		SELECT id, account_id, name, cadence, hour_utc, regions, scope,
			COALESCE(ai_provider, ''), COALESCE(ai_model, ''),
			enabled, last_run_at, last_scan_id, COALESCE(last_run_status, ''),
			created_by, created_at, updated_at
		FROM idle_schedules WHERE enabled = TRUE
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdleSchedule{}
	for rows.Next() {
		s, err := scanIdleSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func scanIdleSchedule(rows *sql.Rows) (IdleSchedule, error) {
	var (
		s          IdleSchedule
		regions    pq.StringArray
		scope      pq.StringArray
		lastRunAt  sql.NullTime
		lastScanID sql.NullInt64
		createdBy  sql.NullInt64
	)
	if err := rows.Scan(&s.ID, &s.AccountID, &s.Name, &s.Cadence, &s.HourUTC, &regions, &scope,
		&s.AIProvider, &s.AIModel,
		&s.Enabled, &lastRunAt, &lastScanID, &s.LastRunStatus,
		&createdBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return s, err
	}
	s.Regions = []string(regions)
	s.Scope = []string(scope)
	if lastRunAt.Valid {
		t := lastRunAt.Time
		s.LastRunAt = &t
	}
	if lastScanID.Valid {
		v := int(lastScanID.Int64)
		s.LastScanID = &v
	}
	if createdBy.Valid {
		v := int(createdBy.Int64)
		s.CreatedBy = &v
	}
	return s, nil
}

func createIdleSchedule(ctx context.Context, s IdleSchedule, actorID int) (IdleSchedule, error) {
	if DB == nil {
		return s, fmt.Errorf("database not initialised")
	}
	row := DB.QueryRowContext(ctx, `
		INSERT INTO idle_schedules
			(account_id, name, cadence, hour_utc, regions, scope, ai_provider, ai_model, enabled, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, created_at, updated_at
	`, s.AccountID, s.Name, s.Cadence, s.HourUTC, pq.Array(s.Regions), pq.Array(s.Scope),
		nullableString(s.AIProvider), nullableString(s.AIModel), s.Enabled, actorID)
	if err := row.Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return s, err
	}
	return s, nil
}

func updateIdleSchedule(ctx context.Context, s IdleSchedule) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `
		UPDATE idle_schedules SET
			name = $2, cadence = $3, hour_utc = $4,
			regions = $5, scope = $6,
			ai_provider = $7, ai_model = $8,
			enabled = $9, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, s.ID, s.Name, s.Cadence, s.HourUTC,
		pq.Array(s.Regions), pq.Array(s.Scope),
		nullableString(s.AIProvider), nullableString(s.AIModel), s.Enabled)
	return err
}

func deleteIdleSchedule(ctx context.Context, id int) error {
	if DB == nil {
		return fmt.Errorf("database not initialised")
	}
	_, err := DB.ExecContext(ctx, `DELETE FROM idle_schedules WHERE id = $1`, id)
	return err
}

func recordScheduleRun(ctx context.Context, scheduleID, scanID int, status string) {
	if DB == nil {
		return
	}
	_, _ = DB.ExecContext(ctx, `
		UPDATE idle_schedules SET
			last_run_at = CURRENT_TIMESTAMP,
			last_scan_id = $2,
			last_run_status = $3,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, scheduleID, scanID, status)
}

// shouldRunSchedule decides whether the tick should kick off this schedule.
// hourly: always (when not run in the last hour).
// daily: only at hour_utc.
// weekly: only at hour_utc on Mondays.
func shouldRunSchedule(s IdleSchedule, now time.Time) bool {
	if !s.Enabled {
		return false
	}
	if s.LastRunAt != nil {
		// Don't re-run inside the same minute window.
		if now.Sub(*s.LastRunAt) < 30*time.Minute {
			return false
		}
	}
	switch s.Cadence {
	case "hourly":
		return true
	case "daily":
		return now.Hour() == s.HourUTC
	case "weekly":
		return now.Weekday() == time.Monday && now.Hour() == s.HourUTC
	default:
		return false
	}
}

// startIdleSchedulesCron evaluates all enabled schedules every 5 minutes and
// triggers scans whose cadence matches the current hour. Each kick-off goes
// through the normal worker so it lands in the same audit + retention path.
func startIdleSchedulesCron() {
	go func() {
		// Initial warm-up to let migrations finish.
		time.Sleep(90 * time.Second)
		runIdleSchedulesTick()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			runIdleSchedulesTick()
		}
	}()
}

func runIdleSchedulesTick() {
	if DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	schedules, err := listAllEnabledSchedules(ctx)
	if err != nil {
		log.Printf("idle-schedule: list failed: %v", err)
		return
	}
	now := time.Now().UTC()
	for _, s := range schedules {
		if !shouldRunSchedule(s, now) {
			continue
		}
		account, err := getCloudAccount(ctx, s.AccountID)
		if err != nil || account == nil {
			continue
		}
		regions := s.Regions
		if len(regions) == 0 {
			regions = account.DefaultRegions
		}
		if len(regions) == 0 {
			continue
		}
		scope := s.Scope
		if len(scope) == 0 {
			scope = SupportedScanScopes[account.Cloud]
		}
		actorID := 0
		if s.CreatedBy != nil {
			actorID = *s.CreatedBy
		}
		newScan := IdleScan{
			AccountID:  account.ID,
			Cloud:      account.Cloud,
			Regions:    regions,
			Scope:      scope,
			AIProvider: s.AIProvider,
			AIModel:    s.AIModel,
		}
		saved, err := createIdleScan(ctx, newScan, actorID)
		if err != nil {
			log.Printf("idle-schedule %d: create scan failed: %v", s.ID, err)
			continue
		}
		recordScheduleRun(ctx, s.ID, saved.ID, "queued")
		writeIdleAudit(ctx, account.ID, saved.ID, actorID, "schedule_triggered", map[string]any{"schedule_id": s.ID, "schedule_name": s.Name})
		enqueueIdleScan(saved.ID, account.ID, actorID)
		go func(scheduleID, scanID int) {
			// Optimistically mark "completed" once the scan record reaches a
			// terminal status. Polled rather than tightly coupled to the
			// queue worker so it works whether Redis or goroutine ran it.
			deadline := time.Now().Add(45 * time.Minute)
			for time.Now().Before(deadline) {
				time.Sleep(30 * time.Second)
				scan, err := getIdleScan(context.Background(), scanID)
				if err != nil || scan == nil {
					continue
				}
				if scan.Status == "complete" || scan.Status == "complete_with_errors" || scan.Status == "failed" || scan.Status == "cancelled" {
					recordScheduleRun(context.Background(), scheduleID, scanID, scan.Status)
					return
				}
			}
		}(s.ID, saved.ID)
	}
}
