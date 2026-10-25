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
				notifyDueVulnFindings()
			case <-scheduleTicker.C:
				enqueueDueVulnSchedules()
			}
		}
	}()
}

var vulnHostedScanSlots = make(chan struct{}, 4)

func drainVulnScanJobs() {
	if DB == nil {
		return
	}
	for i := 0; i < 4; i++ {
		select {
		case vulnHostedScanSlots <- struct{}{}:
		default:
			return
		}
		var jobID int
		err := queryRowContext(`
			UPDATE vuln_scan_jobs
			SET state = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
			WHERE id = (
				SELECT id FROM vuln_scan_jobs
				WHERE state = 'queued' AND COALESCE(collection_mode,'hosted') IN ('hosted','')
				  AND repo_id NOT IN (SELECT repo_id FROM vuln_scan_jobs WHERE state = 'running')
				ORDER BY id
				LIMIT 1
			) AND state = 'queued'
			RETURNING id
		`).Scan(&jobID)
		if err != nil || jobID <= 0 {
			<-vulnHostedScanSlots
			return
		}
		go func(id int) {
			defer func() { <-vulnHostedScanSlots }()
			runVulnScanJob(id)
		}(jobID)
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
		notifyVulnEvent(item.FindingID, "exception_expired", "Exception expired", "A time-limited exception expired. The finding returned to review. This is not Fixed.")
	}
}

func notifyDueVulnFindings() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, canonical_id, due_at FROM vuln_findings
		WHERE due_at IS NOT NULL AND lifecycle NOT IN ('fixed','false_positive','withdrawn','risk_accepted')
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	now := time.Now().UTC()
	for rows.Next() {
		var id int
		var canonical string
		var due time.Time
		if rows.Scan(&id, &canonical, &due) != nil {
			continue
		}
		due = due.UTC()
		if due.Before(now) {
			notifyVulnEvent(id, "overdue:"+due.Format("2006-01-02"), "Overdue vulnerability "+canonical, "Remediation is past the due date. Acknowledgement does not close the finding.")
			continue
		}
		if due.Before(now.Add(24 * time.Hour)) {
			notifyVulnEvent(id, "due_soon:"+due.Format("2006-01-02"), "Deadline approaching for "+canonical, "Remediation is due within 24 hours. This is not a production-fixed claim.")
		}
	}
}
