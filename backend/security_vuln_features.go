package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const vulnStaleDefaultDays = 14

type vulnScanDiffView struct {
	CurrentID  int               `json:"current_id"`
	PreviousID int               `json:"previous_id,omitempty"`
	Repository string            `json:"repository"`
	Note       string            `json:"note"`
	Added      []vulnScanFinding `json:"added"`
	StillOpen  []vulnScanFinding `json:"still_open"`
	Gone       []vulnScanFinding `json:"gone"`
}

func classifyScanDiff(lastScanID, currentID, previousID int, firstSeen, started time.Time, lifecycle string) string {
	if currentID <= 0 {
		return ""
	}
	if lastScanID == currentID {
		if started.IsZero() || !firstSeen.Before(started) {
			return "added"
		}
		if findingIsClosed(lifecycle) {
			return ""
		}
		return "still_open"
	}
	if previousID > 0 && lastScanID == previousID && !findingIsClosed(lifecycle) {
		return "gone"
	}
	return ""
}

func vulnRepoStaleReason(hasInventory bool, ageDays int, lastState string, threshold int) (bool, string) {
	if threshold <= 0 {
		threshold = vulnStaleDefaultDays
	}
	if !hasInventory {
		return true, "No stored inventory. Coverage is Unknown."
	}
	if strings.EqualFold(strings.TrimSpace(lastState), "failed") {
		return true, "Last scan failed. Coverage is Unknown."
	}
	if ageDays >= threshold {
		return true, fmt.Sprintf("Inventory is %d days old. Coverage is Unknown.", ageDays)
	}
	return false, ""
}

func vulnDigestDue(lastSent, now time.Time) bool {
	if lastSent.IsZero() {
		return true
	}
	return now.Sub(lastSent) >= 6*24*time.Hour
}

func attachVulnRepoFreshness(item *vulnRepoConfig) {
	if item == nil || DB == nil {
		return
	}
	threshold := item.StaleAfterDays
	if threshold <= 0 {
		threshold = vulnStaleDefaultDays
		item.StaleAfterDays = threshold
	}
	var collected sql.NullTime
	_ = queryRowContext(`SELECT collected_at FROM vuln_inventories WHERE repo_id=$1 ORDER BY collected_at DESC LIMIT 1`, item.ID).Scan(&collected)
	var lastState string
	_ = queryRowContext(`SELECT COALESCE(state,'') FROM vuln_scan_jobs WHERE repo_id=$1 ORDER BY id DESC LIMIT 1`, item.ID).Scan(&lastState)
	item.LastScanState = lastState
	hasInventory := collected.Valid
	ageDays := 0
	if hasInventory {
		item.LastInventoryAt = stampPtr(collected.Time)
		ageDays = int(time.Since(collected.Time.UTC()).Hours() / 24)
		item.InventoryAgeDays = ageDays
	}
	item.Stale, item.StaleReason = vulnRepoStaleReason(hasInventory, ageDays, lastState, threshold)
}

func diffVulnScan(scanID int) vulnScanDiffView {
	out := vulnScanDiffView{
		CurrentID: scanID,
		Note:      "Gone since the previous scan is not Fixed. Close only after a verify scan or an explicit disposition.",
		Added:     []vulnScanFinding{},
		StillOpen: []vulnScanFinding{},
		Gone:      []vulnScanFinding{},
	}
	if DB == nil || scanID <= 0 {
		return out
	}
	var repoID int
	var repo string
	var started time.Time
	if queryRowContext(`
		SELECT j.repo_id, COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), COALESCE(j.started_at, j.created_at)
		FROM vuln_scan_jobs j JOIN vuln_repositories r ON r.id = j.repo_id WHERE j.id=$1
	`, scanID).Scan(&repoID, &repo, &started) != nil {
		return out
	}
	out.Repository = repo
	var previousID int
	_ = queryRowContext(`
		SELECT id FROM vuln_scan_jobs
		WHERE repo_id=$1 AND id < $2 AND state IN ('succeeded','partial')
		ORDER BY id DESC LIMIT 1
	`, repoID, scanID).Scan(&previousID)
	out.PreviousID = previousID
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT f.id, f.canonical_id, a.severity, COALESCE(a.cvss_score,0), COALESCE(a.cvss_vector,''), f.package_name, f.installed_version, f.lifecycle, f.confidence,
		       COALESCE(f.last_scan_id,0), f.first_seen_at
		FROM vuln_findings f JOIN vuln_advisories a ON a.id = f.advisory_id
		WHERE f.repo_id=$1 AND COALESCE(f.last_scan_id,0) IN ($2,$3)
		ORDER BY f.id
	`, repoID, scanID, previousID)
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var item vulnScanFinding
		var score float64
		var vector string
		var lastID int
		var firstSeen time.Time
		if rows.Scan(&item.ID, &item.Canonical, &item.Severity, &score, &vector, &item.Package, &item.Installed, &item.Lifecycle, &item.Confidence, &lastID, &firstSeen) != nil {
			continue
		}
		item.Severity = normalizeStoredSeverity(score, item.Severity, vector)
		switch classifyScanDiff(lastID, scanID, previousID, firstSeen.UTC(), started.UTC(), item.Lifecycle) {
		case "added":
			out.Added = append(out.Added, item)
		case "still_open":
			out.StillOpen = append(out.StillOpen, item)
		case "gone":
			out.Gone = append(out.Gone, item)
		}
	}
	return out
}

func exportVulnInventory(repoID, scanID int) (map[string]any, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	inventoryID := 0
	commit := ""
	collected := ""
	if scanID > 0 {
		var collectedAt sql.NullTime
		_ = queryRowContext(`SELECT id, commit_sha, collected_at FROM vuln_inventories WHERE scan_id=$1 ORDER BY id DESC LIMIT 1`, scanID).Scan(&inventoryID, &commit, &collectedAt)
		if collectedAt.Valid {
			collected = collectedAt.Time.UTC().Format(time.RFC3339)
		}
		if inventoryID == 0 {
			var boundRepo int
			if queryRowContext(`SELECT repo_id FROM vuln_scan_jobs WHERE id=$1`, scanID).Scan(&boundRepo) == nil && boundRepo > 0 {
				repoID = boundRepo
			}
		}
	}
	if inventoryID == 0 && repoID > 0 {
		inventoryID = latestInventoryID(repoID)
		if inventoryID > 0 {
			var at time.Time
			_ = queryRowContext(`SELECT commit_sha, collected_at FROM vuln_inventories WHERE id=$1`, inventoryID).Scan(&commit, &at)
			collected = at.UTC().Format(time.RFC3339)
		}
	}
	if inventoryID <= 0 {
		return nil, fmt.Errorf("No stored inventory for that repository. Coverage is Unknown.")
	}
	if repoID <= 0 {
		_ = queryRowContext(`SELECT repo_id FROM vuln_inventories WHERE id=$1`, inventoryID).Scan(&repoID)
	}
	var repo string
	_ = queryRowContext(`SELECT COALESCE(owner,'') || '/' || COALESCE(name,'') FROM vuln_repositories WHERE id=$1`, repoID).Scan(&repo)
	comps, _ := loadInventoryComponents(inventoryID)
	components := []map[string]any{}
	for _, item := range comps {
		components = append(components, map[string]any{
			"type": "library", "name": item.PackageName, "version": item.Version, "purl": item.PURL,
			"bom-ref": item.Ecosystem + ":" + item.PackageName + "@" + item.Version,
			"properties": []map[string]string{
				{"name": "opstrellis:path", "value": item.Path},
				{"name": "opstrellis:ecosystem", "value": item.Ecosystem},
			},
		})
	}
	return map[string]any{
		"bomFormat":    "CycloneDX",
		"specVersion":  "1.5",
		"repository":   repo,
		"commit_sha":   commit,
		"collected_at": collected,
		"components":   components,
		"note":         "Stored snapshot from the last inventory. This is not a live clone.",
	}, nil
}

func advisoryRangeLines(canonical, eco, pkg string) []string {
	if DB == nil || strings.TrimSpace(canonical) == "" {
		return []string{}
	}
	var raw string
	_ = queryRowContext(`SELECT COALESCE(affected_json,'[]') FROM vuln_advisories WHERE canonical_id=$1`, canonical).Scan(&raw)
	var ranges []vulnAffectedRange
	if json.Unmarshal([]byte(raw), &ranges) != nil || len(ranges) == 0 {
		return []string{}
	}
	out := []string{}
	for _, item := range ranges {
		if eco != "" && item.Ecosystem != "" && !strings.EqualFold(item.Ecosystem, eco) {
			continue
		}
		if pkg != "" && item.Package != "" && !strings.EqualFold(item.Package, pkg) {
			continue
		}
		text := strings.TrimSpace(item.RangeText)
		if text == "" {
			parts := []string{}
			if item.Introduced != "" {
				parts = append(parts, ">="+item.Introduced)
			}
			if item.Fixed != "" {
				parts = append(parts, "<"+item.Fixed)
			}
			if item.LastAffected != "" {
				parts = append(parts, "<="+item.LastAffected)
			}
			text = strings.Join(parts, " ")
		}
		if text == "" {
			continue
		}
		out = append(out, strings.TrimSpace(item.Ecosystem+" "+item.Package+" "+text))
	}
	return out
}

func sendVulnWeeklyDigests() {
	if DB == nil {
		return
	}
	var last sql.NullTime
	_ = queryRowContext(`SELECT MAX(sent_at) FROM vuln_digest_runs`).Scan(&last)
	now := time.Now().UTC()
	if last.Valid && !vulnDigestDue(last.Time.UTC(), now) {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT COALESCE(NULLIF(r.owner_team,''),'unassigned'), COALESCE(r.project_id,0),
		       COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(a.severity,''),'unknown'))='critical' OR COALESCE(a.cvss_score,0) >= 9),
		       COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(a.severity,''),'unknown'))='high' OR (COALESCE(a.cvss_score,0) >= 7 AND COALESCE(a.cvss_score,0) < 9)),
		       COUNT(*) FILTER (WHERE f.due_at IS NOT NULL AND f.due_at < CURRENT_TIMESTAMP),
		       COUNT(*) FILTER (WHERE COALESCE(NULLIF(f.match_source,''),'scan')='intel')
		FROM vuln_findings f
		JOIN vuln_advisories a ON a.id = f.advisory_id
		JOIN vuln_repositories r ON r.id = f.repo_id
		WHERE f.lifecycle NOT IN ('fixed','false_positive','withdrawn') AND f.confidence='confirmed'
		GROUP BY 1, 2
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	teams, critTotal, highTotal := 0, 0, 0
	for rows.Next() {
		var team string
		var projectID, crit, high, overdue, intel int
		if rows.Scan(&team, &projectID, &crit, &high, &overdue, &intel) != nil {
			continue
		}
		teams++
		critTotal += crit
		highTotal += high
		message := fmt.Sprintf("%s: %d Critical, %d High confirmed matches, %d overdue, %d open internet matches. Public advisories are not organization exposure. Empty coverage stays Unknown.",
			team, crit, high, overdue, intel)
		var projectPtr *int
		if projectID > 0 {
			projectPtr = &projectID
		}
		recipients := ownerUserIDs(team)
		_ = dispatchOpsNotification("vuln:digest:"+team+":"+now.Format("2006-01-02"), "security_vuln", "Weekly open-risk digest", message, nil, projectPtr, recipients, map[string]any{
			"team": team, "critical": crit, "high": high, "overdue": overdue, "intel_open": intel,
		})
	}
	_, _ = execContext(`INSERT INTO vuln_digest_runs (sent_at, teams, open_critical, open_high) VALUES ($1,$2,$3,$4)`, now, teams, critTotal, highTotal)
}
