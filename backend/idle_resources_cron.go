package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// uploadIdleScanArtifact writes the raw scan dump (resources + errors) to
// Supabase under idle-scans/<cloud>/<scanID>.json so retention pruning can
// delete it later. Returns the public-style URL or "" if storage isn't
// configured (in which case the worker just skips it).
func uploadIdleScanArtifact(scanID int, cloud string, resources []IdleResource, errs []scanError) string {
	body, err := json.Marshal(map[string]any{
		"scan_id":    scanID,
		"cloud":      cloud,
		"resources":  resources,
		"errors":     errs,
		"generated":  time.Now().UTC(),
	})
	if err != nil {
		log.Printf("idle-scan %d: artifact marshal: %v", scanID, err)
		return ""
	}
	key := fmt.Sprintf("idle-scans/%s/%d.json", cloud, scanID)
	url, err := supabaseStorageUpload(key, "application/json", body)
	if err != nil {
		// soft failure - don't block scan completion
		log.Printf("idle-scan %d: artifact upload skipped: %v", scanID, err)
		return ""
	}
	return url
}

// startIdleResourcesCron kicks off the daily retention sweeper. It runs once
// at boot (after a short warm-up) and then every 24 hours.
func startIdleResourcesCron() {
	go func() {
		time.Sleep(60 * time.Second)
		runIdleRetentionSweep()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runIdleRetentionSweep()
		}
	}()
}

// runIdleRetentionSweep prunes per-resource rows + raw artifacts older than
// the configured retention window. idle_scans summary rows and idle_audit_log
// rows are intentionally never deleted.
func runIdleRetentionSweep() {
	if DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	settings, err := getIdleSettings(ctx)
	if err != nil {
		log.Printf("idle-retention: load settings failed: %v", err)
		return
	}
	if settings.RetentionDays <= 0 {
		settings.RetentionDays = IdleRetentionDays
	}
	cutoff := time.Now().AddDate(0, 0, -settings.RetentionDays)

	// Always prune raw artifacts when enabled - they're the heaviest.
	if settings.PurgeRawArtifacts {
		rows, err := DB.QueryContext(ctx, `
			SELECT id, raw_artifact_url FROM idle_scans
			WHERE finished_at IS NOT NULL
			  AND finished_at < $1
			  AND COALESCE(raw_artifact_url, '') != ''
			LIMIT 500
		`, cutoff)
		if err != nil {
			log.Printf("idle-retention: artifact query failed: %v", err)
		} else {
			deleted := 0
			for rows.Next() {
				var id int
				var rawURL string
				if err := rows.Scan(&id, &rawURL); err != nil {
					continue
				}
				key := extractSupabaseObjectKey(rawURL)
				if key == "" {
					continue
				}
				if err := supabaseStorageDelete(key); err != nil {
					log.Printf("idle-retention: scan %d artifact delete: %v", id, err)
					continue
				}
				if _, err := DB.ExecContext(ctx, `UPDATE idle_scans SET raw_artifact_url = NULL WHERE id = $1`, id); err == nil {
					deleted++
				}
			}
			rows.Close()
			if deleted > 0 {
				log.Printf("idle-retention: pruned %d raw artifacts older than %d days", deleted, settings.RetentionDays)
			}
		}
	}

	if settings.PurgeResources {
		res, err := DB.ExecContext(ctx, `
			DELETE FROM idle_resources
			WHERE scan_id IN (
				SELECT id FROM idle_scans WHERE finished_at IS NOT NULL AND finished_at < $1
			)
		`, cutoff)
		if err != nil {
			log.Printf("idle-retention: resources delete failed: %v", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			log.Printf("idle-retention: pruned %d resource rows older than %d days", n, settings.RetentionDays)
		}
	}

	// Always trim very large ai_rankings response_raw blobs to avoid pgsql
	// bloat. We keep the row, just blank out the heavy column.
	_, _ = DB.ExecContext(ctx, `
		UPDATE idle_ai_rankings SET response_raw = ''
		WHERE created_at < $1 AND length(response_raw) > 1024
	`, cutoff)

	writeIdleAudit(ctx, 0, 0, 0, "retention_sweep_completed", map[string]any{
		"cutoff":         cutoff,
		"retention_days": settings.RetentionDays,
		"purge_raw":      settings.PurgeRawArtifacts,
		"purge_rows":     settings.PurgeResources,
	})
}

// extractSupabaseObjectKey turns the public-style URL we stored back into the
// "<bucket>/<key>" path the storage signer needs. Defensive against various
// URL shapes.
func extractSupabaseObjectKey(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	// supabase URL looks like https://<host>/storage/v1/s3/<bucket>/<key>
	// We just need the bucket-rooted suffix.
	idx := strings.Index(rawURL, "/storage/v1/s3/")
	if idx < 0 {
		// best-effort: trim everything up to the bucket name we know
		bucket := strings.TrimSpace(getEnv("SUPABASE_STORAGE_BUCKET", ""))
		if bucket == "" {
			return ""
		}
		i := strings.Index(rawURL, bucket+"/")
		if i < 0 {
			return ""
		}
		return strings.TrimPrefix(rawURL[i:], bucket+"/")
	}
	tail := rawURL[idx+len("/storage/v1/s3/"):]
	bucket := strings.TrimSpace(getEnv("SUPABASE_STORAGE_BUCKET", ""))
	if bucket != "" && strings.HasPrefix(tail, bucket+"/") {
		return strings.TrimPrefix(tail, bucket+"/")
	}
	return tail
}
