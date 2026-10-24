package main

import (
	"log"
	"time"
)

func startVulnSecurityWorker() {
	go func() {
		intelTicker := time.NewTicker(60 * time.Minute)
		defer intelTicker.Stop()
		jobTicker := time.NewTicker(2 * time.Second)
		defer jobTicker.Stop()
		expireTicker := time.NewTicker(15 * time.Minute)
		defer expireTicker.Stop()
		scheduleTicker := time.NewTicker(5 * time.Minute)
		defer scheduleTicker.Stop()
		for {
			select {
			case <-jobTicker.C:
				drainVulnScanJobs()
			case <-intelTicker.C:
				if _, err := runVulnIntelligenceSync(0); err != nil {
					log.Printf("vuln intelligence sync: %v", err)
				}
			case <-expireTicker.C:
				expireVulnExceptions()
				markStaleVulnAgents()
			case <-scheduleTicker.C:
				enqueueDueVulnSchedules()
			}
		}
	}()
}

func drainVulnScanJobs() {
	if DB == nil {
		return
	}
	for i := 0; i < 4; i++ {
		var jobID int
		err := queryRowContext(`
			UPDATE vuln_scan_jobs
			SET state = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
			WHERE id = (
				SELECT id FROM vuln_scan_jobs
				WHERE state = 'queued' AND COALESCE(collection_mode,'hosted') IN ('hosted','')
				ORDER BY id
				LIMIT 1
			) AND state = 'queued'
			RETURNING id
		`).Scan(&jobID)
		if err != nil || jobID <= 0 {
			return
		}
		runVulnScanJob(jobID)
	}
}

func expireVulnExceptions() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, finding_id FROM vuln_exceptions
		WHERE status = 'active' AND expires_at <= CURRENT_TIMESTAMP
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type row struct{ ID, FindingID int }
	items := []row{}
	for rows.Next() {
		var item row
		if rows.Scan(&item.ID, &item.FindingID) == nil {
			items = append(items, item)
		}
	}
	for _, item := range items {
		_, _ = execContext(`UPDATE vuln_exceptions SET status='expired' WHERE id=$1`, item.ID)
		_, _ = execContext(`UPDATE vuln_findings SET lifecycle='open' WHERE id=$1 AND lifecycle='risk_accepted'`, item.FindingID)
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'exception_expired','Exception expired; finding returned to review.')`, item.FindingID)
	}
}
