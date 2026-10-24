package main

import (
	"fmt"
	"strings"
	"time"
)

type vulnRepoConfig struct {
	ID              int     `json:"id"`
	Repository      string  `json:"repository"`
	ProjectID       int     `json:"project_id,omitempty"`
	Branch          string  `json:"branch"`
	OwnerTeam       string  `json:"owner_team,omitempty"`
	CollectionMode  string  `json:"collection_mode"`
	ScheduleMinutes int     `json:"schedule_minutes"`
	AlertMinSev     string  `json:"alert_min_severity"`
	Exclusions      string  `json:"exclusions,omitempty"`
	AllowForkPRs    bool    `json:"allow_fork_prs"`
	EnforcePRGate   bool    `json:"enforce_pr_gate"`
	Provider        string  `json:"provider"`
	Enabled         bool    `json:"enabled"`
	UpdatedAt       *string `json:"updated_at,omitempty"`
}

func runVulnPRComparison(userID, repoID, prNumber int) (int, error) {
	var owner, name, provider string
	var projectID int
	var allowFork bool
	if err := queryRowContext(`SELECT COALESCE(NULLIF(provider,''),'github'), owner, name, COALESCE(project_id,0), allow_fork_prs FROM vuln_repositories WHERE id=$1`, repoID).Scan(&provider, &owner, &name, &projectID, &allowFork); err != nil {
		return 0, fmt.Errorf("repository is not registered")
	}
	baseSHA, headSHA, err := loadVulnPRSHAs(provider, owner, name, prNumber, allowFork)
	if err != nil {
		return 0, err
	}
	var id int
	err = queryRowContext(`
		INSERT INTO vuln_pr_comparisons (repo_id, project_id, pr_number, base_sha, head_sha, state, created_by)
		VALUES ($1,$2,$3,$4,$5,'running',$6) RETURNING id
	`, repoID, nullIfZero(projectID), prNumber, baseSHA, headSHA, userID).Scan(&id)
	if err != nil {
		return 0, err
	}
	baseInv, baseCov, err := inventoryAtCommit(provider, owner, name, baseSHA)
	if err != nil {
		_, _ = execContext(`UPDATE vuln_pr_comparisons SET state='failed', error=$2, finished_at=CURRENT_TIMESTAMP WHERE id=$1`, id, "Base commit inventory failed.")
		return id, err
	}
	headInv, headCov, err := inventoryAtCommit(provider, owner, name, headSHA)
	if err != nil {
		_, _ = execContext(`UPDATE vuln_pr_comparisons SET state='failed', error=$2, finished_at=CURRENT_TIMESTAMP WHERE id=$1`, id, "Head commit inventory failed.")
		return id, err
	}
	advisories := loadAdvisoriesForMatch()
	items := compareVulnMatches(correlateInventory(baseInv, advisories), correlateInventory(headInv, advisories))
	coverage := "complete"
	if len(baseCov)+len(headCov) > 0 {
		coverage = "incomplete"
	}
	introducedC, introducedH, removed := 0, 0, 0
	for _, item := range items {
		class := classifyPRFinding(item["classification"], coverage)
		item["classification"] = class
		_, _ = execContext(`
			INSERT INTO vuln_pr_comparison_items (comparison_id, classification, canonical_id, ecosystem, package_name, module_path, base_version, head_version, severity)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, id, class, item["canonical_id"], item["ecosystem"], item["package_name"], item["module_path"], item["base_version"], item["head_version"], item["severity"])
		if class == "introduced" && item["severity"] == vulnSevCritical {
			introducedC++
		}
		if class == "introduced" && item["severity"] == vulnSevHigh {
			introducedH++
		}
		if class == "removed" {
			removed++
		}
	}
	state := "succeeded"
	if coverage == "incomplete" {
		state = "partial"
	}
	_, _ = execContext(`
		UPDATE vuln_pr_comparisons SET state=$2, coverage=$3, introduced_critical=$4, introduced_high=$5, removed_count=$6, finished_at=CURRENT_TIMESTAMP
		WHERE id=$1
	`, id, state, coverage, introducedC, introducedH, removed)
	publishVulnPRCheck(repoID, prNumber, coverage, introducedC, introducedH, headSHA)
	return id, nil
}

func classifyPRFinding(class, coverage string) string {
	if coverage == "incomplete" && class == "introduced" {
		return "not_comparable"
	}
	return class
}

func vulnAgentOwnsJob(agentProjectID, jobProjectID int) bool {
	if agentProjectID == 0 {
		return jobProjectID == 0
	}
	return agentProjectID == jobProjectID
}

func inventoryAtCommit(provider, owner, name, sha string) ([]vulnComponent, []vulnCoverageGap, error) {
	if provider == "" {
		_ = queryRowContext(`SELECT COALESCE(NULLIF(provider,''),'github') FROM vuln_repositories WHERE owner=$1 AND name=$2 LIMIT 1`, owner, name).Scan(&provider)
	}
	paths, truncated, err := listVulnRepoPaths(provider, owner, name, sha)
	if err != nil {
		return nil, nil, err
	}
	files := discoverVulnLockfiles(paths)
	var exclusions string
	_ = queryRowContext(`SELECT COALESCE(exclusions,'') FROM vuln_repositories WHERE COALESCE(NULLIF(provider,''),'github')=$1 AND owner=$2 AND name=$3`, normalizeVulnProvider(provider), owner, name).Scan(&exclusions)
	excluded := []vulnCoverageGap{}
	files, excluded = applyVulnExclusions(files, exclusions)
	parsed := []vulnParsedInventory{}
	coverage := []vulnCoverageGap{}
	coverage = append(coverage, excluded...)
	if truncated {
		coverage = append(coverage, vulnCoverageGap{Path: "/", Reason: "Tree was truncated."})
	}
	if len(files) > vulnMaxLockfiles {
		files = files[:vulnMaxLockfiles]
	}
	for _, filePath := range files {
		content, ok, getErr := fetchVulnRepoFile(provider, owner, name, filePath, sha)
		if getErr != nil || !ok {
			coverage = append(coverage, vulnCoverageGap{Path: filePath, Reason: "File could not be read."})
			continue
		}
		parsed = append(parsed, parseVulnArtifact(filePath, content))
	}
	merged := mergeParsedInventories(parsed)
	merged.Coverage = append(coverage, merged.Coverage...)
	return merged.Components, merged.Coverage, nil
}

func listVulnPRComparisons(userID int) []map[string]any {
	if DB == nil {
		return []map[string]any{}
	}
	seeAll, ids, _ := visibleServiceProjectIDs(userID)
	args := []any{}
	extra, args := vulnProjectFilter(seeAll, ids, "c.project_id", args)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT c.id, c.pr_number, c.base_sha, c.head_sha, c.state, c.coverage, c.introduced_critical, c.introduced_high, c.removed_count,
		       COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), c.error, c.created_at
		FROM vuln_pr_comparisons c JOIN vuln_repositories r ON r.id = c.repo_id
		WHERE 1=1 `+extra+` ORDER BY c.id DESC LIMIT 50
	`, args...)
	if err != nil {
		return []map[string]any{}
	}
	defer cancel()
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, pr, introC, introH, removed int
		var base, head, state, coverage, repo, errText string
		var created time.Time
		if rows.Scan(&id, &pr, &base, &head, &state, &coverage, &introC, &introH, &removed, &repo, &errText, &created) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "pr_number": pr, "base_sha": base, "head_sha": head, "state": state, "coverage": coverage,
			"introduced_critical": introC, "introduced_high": introH, "removed_count": removed,
			"repository": repo, "error": errText, "created_at": created.UTC().Format(time.RFC3339),
			"note": "Removed in the PR does not close default-branch or deployment findings. Incomplete coverage is never a clean verdict.",
		})
	}
	return out
}

func getVulnPRComparison(userID, id int) map[string]any {
	items := listVulnPRComparisons(userID)
	var found map[string]any
	for _, item := range items {
		if item["id"] == id {
			found = item
			break
		}
	}
	if found == nil {
		return nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT classification, canonical_id, ecosystem, package_name, module_path, base_version, head_version, severity
		FROM vuln_pr_comparison_items WHERE comparison_id=$1 ORDER BY id
	`, id)
	if err != nil {
		found["items"] = []any{}
		return found
	}
	defer cancel()
	defer rows.Close()
	detail := []map[string]any{}
	for rows.Next() {
		var class, canonical, eco, pkg, module, base, head, sev string
		if rows.Scan(&class, &canonical, &eco, &pkg, &module, &base, &head, &sev) == nil {
			detail = append(detail, map[string]any{
				"classification": class, "canonical_id": canonical, "ecosystem": eco, "package_name": pkg,
				"module_path": module, "base_version": base, "head_version": head, "severity": sev,
			})
		}
	}
	found["items"] = detail
	return found
}

func listVulnCampaigns(userID int) []map[string]any {
	findings, err := listVulnFindings(userID, 0, 0, "", "", "")
	if err != nil {
		return []map[string]any{}
	}
	groups := map[string]map[string]any{}
	order := []string{}
	for _, item := range findings {
		if item.Lifecycle == vulnLifeFixed || item.Lifecycle == vulnLifeFalsePos || item.Lifecycle == vulnLifeWithdrawn {
			continue
		}
		g, ok := groups[item.CanonicalID]
		if !ok {
			g = map[string]any{
				"canonical_id": item.CanonicalID, "title": item.Title, "severity": item.Severity,
				"services": []string{}, "count": 0,
				"unscanned_note": "Unknown coverage is listed separately from unaffected services.",
			}
			groups[item.CanonicalID] = g
			order = append(order, item.CanonicalID)
		}
		g["count"] = g["count"].(int) + 1
		if item.Service != "" {
			g["services"] = append(g["services"].([]string), item.Service)
		}
	}
	out := make([]map[string]any, 0, len(order))
	for _, id := range order {
		out = append(out, groups[id])
	}
	return out
}

func latestInventoryID(repoID int) int {
	var id int
	_ = queryRowContext(`SELECT id FROM vuln_inventories WHERE repo_id=$1 ORDER BY collected_at DESC LIMIT 1`, repoID).Scan(&id)
	return id
}

func listNewDependencies(userID int) []map[string]any {
	repos := listVulnRepoConfigs(userID)
	out := []map[string]any{}
	for _, repo := range repos {
		ids := []int{}
		inv, cancel, err := queryRowsWithTimeout(`SELECT id FROM vuln_inventories WHERE repo_id=$1 ORDER BY collected_at DESC LIMIT 2`, repo.ID)
		if err != nil {
			continue
		}
		for inv.Next() {
			var id int
			if inv.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		inv.Close()
		cancel()
		if len(ids) < 2 {
			continue
		}
		newer, _ := loadInventoryComponents(ids[0])
		older, _ := loadInventoryComponents(ids[1])
		seen := map[string]bool{}
		for _, item := range older {
			seen[item.Ecosystem+"|"+item.PackageName] = true
		}
		for _, item := range newer {
			if item.Usage != "" && item.Usage != "dependency" && item.Usage != "image" {
				continue
			}
			key := item.Ecosystem + "|" + item.PackageName
			if seen[key] {
				continue
			}
			out = append(out, map[string]any{
				"repository": repo.Repository, "ecosystem": item.Ecosystem, "package_name": item.PackageName,
				"version": item.Version, "signal": "new_package",
				"note": "Newly introduced package. Missing maintenance metadata is Unknown, not malicious.",
			})
		}
	}
	return out
}

func listVulnExceptions(findingID int) []map[string]any {
	rows, cancel, err := queryRowsWithTimeout(`SELECT id, kind, reason, evidence, issuer, status, expires_at, created_at FROM vuln_exceptions WHERE finding_id=$1 ORDER BY id DESC`, findingID)
	if err != nil {
		return []map[string]any{}
	}
	defer cancel()
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int
		var kind, reason, evidence, issuer, status string
		var expires, created time.Time
		if rows.Scan(&id, &kind, &reason, &evidence, &issuer, &status, &expires, &created) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "kind": kind, "reason": reason, "evidence": evidence, "issuer": issuer, "status": status,
			"expires_at": expires.UTC().Format(time.RFC3339), "created_at": created.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func listVulnRepoConfigs(userID int) []vulnRepoConfig {
	if DB == nil {
		return []vulnRepoConfig{}
	}
	seeAll, ids, _ := visibleServiceProjectIDs(userID)
	args := []any{}
	extra, args := vulnProjectFilter(seeAll, ids, "project_id", args)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, COALESCE(owner,'') || '/' || COALESCE(name,''), COALESCE(project_id,0), branch, owner_team,
		       COALESCE(NULLIF(collection_mode,''),'hosted'), schedule_minutes, alert_min_severity, exclusions, allow_fork_prs, enforce_pr_gate,
		       COALESCE(NULLIF(provider,''),'github'), enabled, updated_at
		FROM vuln_repositories WHERE 1=1 `+extra+` ORDER BY id
	`, args...)
	if err != nil {
		return []vulnRepoConfig{}
	}
	defer cancel()
	defer rows.Close()
	out := []vulnRepoConfig{}
	for rows.Next() {
		var item vulnRepoConfig
		var updated time.Time
		if rows.Scan(&item.ID, &item.Repository, &item.ProjectID, &item.Branch, &item.OwnerTeam, &item.CollectionMode, &item.ScheduleMinutes, &item.AlertMinSev, &item.Exclusions, &item.AllowForkPRs, &item.EnforcePRGate, &item.Provider, &item.Enabled, &updated) == nil {
			item.UpdatedAt = stampPtr(updated)
			out = append(out, item)
		}
	}
	return out
}

func updateVulnRepoConfig(id int, body map[string]any) error {
	mode, _ := body["collection_mode"].(string)
	if mode == "" {
		mode = "hosted"
	}
	if mode != "hosted" && mode != "agent" && mode != "ci" {
		return fmt.Errorf("collection_mode must be hosted, agent, or ci")
	}
	team, _ := body["owner_team"].(string)
	excl, _ := body["exclusions"].(string)
	alert, _ := body["alert_min_severity"].(string)
	if alert == "" {
		alert = "high"
	}
	branch, _ := body["branch"].(string)
	branch = strings.TrimSpace(branch)
	schedule := 0
	switch v := body["schedule_minutes"].(type) {
	case float64:
		schedule = int(v)
	case int:
		schedule = v
	}
	allowFork, _ := body["allow_fork_prs"].(bool)
	enforceGate, _ := body["enforce_pr_gate"].(bool)
	enabled := true
	if v, ok := body["enabled"].(bool); ok {
		enabled = v
	}
	_, err := execContext(`
		UPDATE vuln_repositories
		SET collection_mode=$2, owner_team=CASE WHEN $3='' THEN owner_team ELSE $3 END, exclusions=$4,
		    alert_min_severity=$5, branch=CASE WHEN $6='' THEN branch ELSE $6 END, schedule_minutes=$7, allow_fork_prs=$8, enforce_pr_gate=$9, enabled=$10, updated_at=CURRENT_TIMESTAMP
		WHERE id=$1
	`, id, mode, strings.TrimSpace(team), strings.TrimSpace(excl), alert, branch, schedule, allowFork, enforceGate, enabled)
	return err
}

func serviceVulnDetail(userID, serviceID int) map[string]any {
	rows, err := listVulnServiceRows(userID, 0)
	if err != nil {
		return map[string]any{"status": "error"}
	}
	var service *vulnServiceRow
	for i := range rows {
		if rows[i].ServiceID == serviceID {
			service = &rows[i]
			break
		}
	}
	if service == nil {
		return nil
	}
	findings, _ := listVulnFindings(userID, 0, serviceID, "", "", "")
	plans, _ := listVulnPlans(userID)
	servicePlans := []vulnPlanView{}
	for _, plan := range plans {
		if plan.Repository == service.Repo {
			servicePlans = append(servicePlans, plan)
		}
	}
	scans, _ := listVulnScans(userID)
	serviceScans := []vulnScanView{}
	for _, scan := range scans {
		if scan.Repository == service.Repo {
			serviceScans = append(serviceScans, scan)
		}
	}
	deps := []vulnComponent{}
	if service.RepoID > 0 {
		deps, _ = loadInventoryComponents(latestInventoryID(service.RepoID))
	}
	runtime := []map[string]any{}
	if service.RepoID > 0 {
		rt, cancel, rtErr := queryRowsWithTimeout(`SELECT kind, value, provenance, path, commit_sha, collected_at FROM vuln_runtime_observations WHERE repo_id=$1 ORDER BY id DESC LIMIT 20`, service.RepoID)
		if rtErr == nil {
			defer cancel()
			defer rt.Close()
			for rt.Next() {
				var kind, value, prov, path, sha string
				var collected time.Time
				if rt.Scan(&kind, &value, &prov, &path, &sha, &collected) == nil {
					runtime = append(runtime, map[string]any{
						"kind": kind, "value": value, "provenance": prov, "path": path, "commit_sha": sha,
						"collected_at": collected.UTC().Format(time.RFC3339),
						"note":         "Declared runtime is not observed production runtime.",
					})
				}
			}
		}
	}
	return map[string]any{
		"service": service, "findings": findings, "plans": servicePlans, "scans": serviceScans,
		"dependencies": deps, "runtime": runtime, "deployments": listVulnDeployments(serviceID), "status": "ok",
	}
}

func handleVulnGitHubEvent(event string, payload map[string]any) {
	if DB == nil || payload == nil {
		return
	}
	repo, _ := payload["repository"].(map[string]any)
	if repo == nil {
		return
	}
	full, _ := repo["full_name"].(string)
	owner, name := parseGitHubRepo(full)
	if owner == "" {
		return
	}
	var repoID, projectID int
	var branch string
	if err := queryRowContext(`SELECT id, COALESCE(project_id,0), branch FROM vuln_repositories WHERE COALESCE(NULLIF(provider,''),'github')='github' AND owner=$1 AND name=$2 AND enabled=TRUE`, owner, name).Scan(&repoID, &projectID, &branch); err != nil || repoID <= 0 {
		return
	}
	switch event {
	case "push":
		ref, _ := payload["ref"].(string)
		if ref != "refs/heads/"+branch {
			return
		}
		_, _ = enqueueVulnScan(repoID, 0, projectID, 0, "push", "")
	case "pull_request":
		action, _ := payload["action"].(string)
		if action != "opened" && action != "synchronize" && action != "reopened" {
			return
		}
		pr, _ := payload["pull_request"].(map[string]any)
		if pr == nil {
			return
		}
		number := 0
		switch v := pr["number"].(type) {
		case float64:
			number = int(v)
		case int:
			number = v
		}
		if number <= 0 {
			return
		}
		_, _ = runVulnPRComparison(0, repoID, number)
	}
}

func markStaleVulnAgents() {
	if DB == nil {
		return
	}
	_, _ = execContext(`UPDATE vuln_agents SET status='degraded', last_error='Heartbeat is late. Last evidence is preserved; this is not a clean scan.' WHERE status='online' AND last_heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`)
	_, _ = execContext(`UPDATE vuln_agents SET status='offline', last_error='Agent is offline. Last evidence is preserved; this is not a clean scan.' WHERE status IN ('online','degraded') AND (last_heartbeat_at IS NULL OR last_heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '60 minutes')`)
}

func enqueueDueVulnSchedules() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, COALESCE(project_id,0), schedule_minutes
		FROM vuln_repositories
		WHERE enabled = TRUE AND schedule_minutes >= 15
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type row struct{ ID, ProjectID, Minutes int }
	items := []row{}
	for rows.Next() {
		var item row
		if rows.Scan(&item.ID, &item.ProjectID, &item.Minutes) == nil {
			items = append(items, item)
		}
	}
	for _, item := range items {
		var last time.Time
		_ = queryRowContext(`SELECT COALESCE(MAX(created_at), TIMESTAMP '1970-01-01') FROM vuln_scan_jobs WHERE repo_id=$1`, item.ID).Scan(&last)
		if time.Since(last) < time.Duration(item.Minutes)*time.Minute {
			continue
		}
		_, _ = enqueueVulnScan(item.ID, 0, item.ProjectID, 0, "schedule", "")
	}
}
