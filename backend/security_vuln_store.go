package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type vulnAdvisoryView struct {
	ID             int      `json:"id"`
	CanonicalID    string   `json:"canonical_id"`
	Aliases        []string `json:"aliases"`
	Title          string   `json:"title"`
	Summary        string   `json:"summary"`
	Severity       string   `json:"severity"`
	CVSSScore      float64  `json:"cvss_score,omitempty"`
	CVSSVector     string   `json:"cvss_vector,omitempty"`
	Ecosystem      string   `json:"ecosystem,omitempty"`
	PackageName    string   `json:"package_name,omitempty"`
	FirstFixed     string   `json:"first_fixed_version,omitempty"`
	KEV            bool     `json:"kev"`
	EPSS           float64  `json:"epss,omitempty"`
	EPSSPercentile float64  `json:"epss_percentile,omitempty"`
	Source         string   `json:"source"`
	SourceURL      string   `json:"source_url,omitempty"`
	PublishedAt    *string  `json:"published_at,omitempty"`
	ModifiedAt     *string  `json:"modified_at,omitempty"`
	FetchedAt      *string  `json:"fetched_at,omitempty"`
	Withdrawn      bool     `json:"withdrawn"`
	Affected       int      `json:"affected_services"`
	PublicLabel    string   `json:"count_note"`
}

type vulnFindingView struct {
	ID             int     `json:"id"`
	Repo           string  `json:"repository"`
	Service        string  `json:"service,omitempty"`
	ServiceID      int     `json:"service_id,omitempty"`
	ProjectID      int     `json:"project_id,omitempty"`
	CanonicalID    string  `json:"canonical_id"`
	Title          string  `json:"title"`
	Severity       string  `json:"severity"`
	Priority       string  `json:"priority"`
	PriorityReason string  `json:"priority_reason"`
	Lifecycle      string  `json:"lifecycle"`
	PatchState     string  `json:"patch_state"`
	Confidence     string  `json:"confidence"`
	Ecosystem      string  `json:"ecosystem"`
	PackageName    string  `json:"package_name"`
	Installed      string  `json:"installed_version"`
	FirstFixed     string  `json:"first_fixed_version,omitempty"`
	Recommended    string  `json:"recommended_version,omitempty"`
	ParentPackage  string  `json:"parent_package,omitempty"`
	ModulePath     string  `json:"module_path,omitempty"`
	Path           string  `json:"path,omitempty"`
	Owner          string  `json:"owner,omitempty"`
	KEV            bool    `json:"kev"`
	CommitSHA      string  `json:"commit_sha,omitempty"`
	PRURL          string  `json:"pr_url,omitempty"`
	ChangeRef      string  `json:"change_ref,omitempty"`
	DueAt          *string `json:"due_at,omitempty"`
	LastSeenAt     *string `json:"last_seen_at,omitempty"`
	SourceURL      string  `json:"source_url,omitempty"`
	Reachability   string  `json:"reachability,omitempty"`
	MatchSource    string  `json:"match_source,omitempty"`
}

type vulnServiceRow struct {
	ServiceID    int      `json:"service_id"`
	Service      string   `json:"service"`
	Repo         string   `json:"repository"`
	ProjectID    int      `json:"project_id,omitempty"`
	ProjectName  string   `json:"project_name,omitempty"`
	Team         string   `json:"team,omitempty"`
	Technologies []string `json:"technologies"`
	Critical     int      `json:"critical_findings"`
	High         int      `json:"high_findings"`
	PatchLabel   string   `json:"patch_readiness"`
	Coverage     string   `json:"coverage"`
	LastScanAt   *string  `json:"last_scan_at,omitempty"`
	RepoID       int      `json:"repo_id,omitempty"`
}

type vulnScanView struct {
	ID                int               `json:"id"`
	State             string            `json:"state"`
	Stage             string            `json:"stage"`
	Repository        string            `json:"repository"`
	CommitSHA         string            `json:"commit_sha,omitempty"`
	Error             string            `json:"error,omitempty"`
	DiscoveredModules int               `json:"discovered_modules"`
	AssessedModules   int               `json:"assessed_modules"`
	Coverage          []vulnCoverageGap `json:"coverage"`
	CreatedAt         *string           `json:"created_at,omitempty"`
	FinishedAt        *string           `json:"finished_at,omitempty"`
}

type vulnSourceView struct {
	Provider       string  `json:"provider"`
	Status         string  `json:"status"`
	Enabled        bool    `json:"enabled"`
	LastSuccessAt  *string `json:"last_success_at,omitempty"`
	LastError      string  `json:"last_error,omitempty"`
	LatestRevision string  `json:"latest_revision,omitempty"`
}

type vulnPlanView struct {
	ID          int    `json:"id"`
	Repository  string `json:"repository"`
	ModulePath  string `json:"module_path,omitempty"`
	Ecosystem   string `json:"ecosystem"`
	PackageName string `json:"package_name"`
	Current     string `json:"current_version"`
	Target      string `json:"target_version"`
	Action      string `json:"action"`
	Status      string `json:"status"`
	FindingIDs  []int  `json:"finding_ids"`
	Estimated   bool   `json:"estimated"`
	Label       string `json:"label"`
}

func stampPtr(value time.Time) *string {
	if value.IsZero() {
		return nil
	}
	text := value.UTC().Format(time.RFC3339)
	return &text
}

func nullTimePtr(value sql.NullTime) *string {
	if !value.Valid {
		return nil
	}
	return stampPtr(value.Time)
}

func upsertVulnAdvisory(item vulnAdvisoryRecord) error {
	if DB == nil || strings.TrimSpace(item.CanonicalID) == "" {
		return nil
	}
	eco, pkg := "", ""
	if len(item.Ranges) > 0 {
		eco = item.Ranges[0].Ecosystem
		pkg = item.Ranges[0].Package
	}
	var id int
	err := queryRowContext(`
		INSERT INTO vuln_advisories (
			canonical_id, title, summary, severity, cvss_score, cvss_vector, cvss_provider,
			ecosystem, package_name, affected_json, first_fixed_version, kev, source, source_url,
			withdrawn, revision, fetched_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CURRENT_TIMESTAMP)
		ON CONFLICT (canonical_id) DO UPDATE SET
			title = EXCLUDED.title,
			summary = EXCLUDED.summary,
			severity = EXCLUDED.severity,
			cvss_score = EXCLUDED.cvss_score,
			cvss_vector = EXCLUDED.cvss_vector,
			affected_json = EXCLUDED.affected_json,
			first_fixed_version = EXCLUDED.first_fixed_version,
			source_url = EXCLUDED.source_url,
			withdrawn = EXCLUDED.withdrawn,
			revision = EXCLUDED.revision,
			kev = vuln_advisories.kev OR EXCLUDED.kev,
			fetched_at = CURRENT_TIMESTAMP
		RETURNING id
	`, item.CanonicalID, item.Title, item.Summary, item.Severity, item.CVSSScore, item.CVSSVector, item.CVSSProvider,
		eco, pkg, encodeJSONString(item.Ranges), item.FirstFixed, item.KEV, item.Source, item.SourceURL, item.Withdrawn, item.Revision).Scan(&id)
	if err != nil {
		return err
	}
	for _, alias := range item.Aliases {
		_, _ = execContext(`INSERT INTO vuln_advisory_aliases (advisory_id, alias) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET advisory_id = EXCLUDED.advisory_id`, id, alias)
	}
	return nil
}

func applyKEVFlags(ids map[string]bool) int {
	if DB == nil || len(ids) == 0 {
		return 0
	}
	applied := 0
	for id := range ids {
		res, err := execContext(`
			UPDATE vuln_advisories SET kev = TRUE
			WHERE canonical_id = $1 OR id IN (SELECT advisory_id FROM vuln_advisory_aliases WHERE alias = $1)
		`, id)
		if err != nil {
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			applied++
		}
	}
	return applied
}

func listVulnAdvisories(severity string, kevOnly bool, limit, offset int) ([]vulnAdvisoryView, int, error) {
	if DB == nil {
		return []vulnAdvisoryView{}, 0, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	where := []string{"1=1"}
	args := []any{}
	if sev := strings.ToLower(strings.TrimSpace(severity)); sev != "" && sev != "all" {
		args = append(args, sev)
		where = append(where, fmt.Sprintf("severity = $%d", len(args)))
	} else if sev != "all" {
		where = append(where, "severity IN ('critical','high')")
	}
	if kevOnly {
		where = append(where, "kev = TRUE")
	}
	clause := strings.Join(where, " AND ")
	var total int
	_ = queryRowContext(`SELECT COUNT(*) FROM vuln_advisories WHERE `+clause, args...).Scan(&total)
	args = append(args, limit, offset)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, canonical_id, title, summary, severity, COALESCE(cvss_score,0), cvss_vector, ecosystem, package_name,
		       first_fixed_version, kev, COALESCE(epss,0), COALESCE(epss_percentile,0), source, source_url, published_at, modified_at, fetched_at, withdrawn
		FROM vuln_advisories
		WHERE `+clause+`
		ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, fetched_at DESC, id DESC
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args))+`
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnAdvisoryView{}
	for rows.Next() {
		var item vulnAdvisoryView
		var published, modified, fetched sql.NullTime
		if err := rows.Scan(&item.ID, &item.CanonicalID, &item.Title, &item.Summary, &item.Severity, &item.CVSSScore, &item.CVSSVector,
			&item.Ecosystem, &item.PackageName, &item.FirstFixed, &item.KEV, &item.EPSS, &item.EPSSPercentile, &item.Source, &item.SourceURL, &published, &modified, &fetched, &item.Withdrawn); err != nil {
			continue
		}
		item.PublishedAt = nullTimePtr(published)
		item.ModifiedAt = nullTimePtr(modified)
		item.FetchedAt = nullTimePtr(fetched)
		item.Aliases = aliasesForAdvisory(item.ID)
		item.Affected = countConfirmedForAdvisory(item.CanonicalID)
		item.PublicLabel = "Public intelligence. This count is not organization exposure."
		out = append(out, item)
	}
	return out, total, nil
}

func getVulnAdvisory(id, userID int) (*vulnAdvisoryView, []vulnFindingView, error) {
	if DB == nil || id <= 0 {
		return nil, nil, fmt.Errorf("not found")
	}
	item := vulnAdvisoryView{}
	var published, modified, fetched sql.NullTime
	err := queryRowContext(`
		SELECT id, canonical_id, title, summary, severity, COALESCE(cvss_score,0), cvss_vector, ecosystem, package_name,
		       first_fixed_version, kev, COALESCE(epss,0), COALESCE(epss_percentile,0), source, source_url, published_at, modified_at, fetched_at, withdrawn
		FROM vuln_advisories WHERE id=$1
	`, id).Scan(&item.ID, &item.CanonicalID, &item.Title, &item.Summary, &item.Severity, &item.CVSSScore, &item.CVSSVector,
		&item.Ecosystem, &item.PackageName, &item.FirstFixed, &item.KEV, &item.EPSS, &item.EPSSPercentile, &item.Source, &item.SourceURL, &published, &modified, &fetched, &item.Withdrawn)
	if err != nil {
		return nil, nil, err
	}
	item.PublishedAt = nullTimePtr(published)
	item.ModifiedAt = nullTimePtr(modified)
	item.FetchedAt = nullTimePtr(fetched)
	item.Aliases = aliasesForAdvisory(item.ID)
	item.Affected = countConfirmedForAdvisory(item.CanonicalID)
	item.PublicLabel = "Public intelligence. This count is not organization exposure."
	found := &item
	findings, err := listVulnFindings(userID, 0, 0, "", "", "")
	if err != nil {
		return found, nil, nil
	}
	linked := []vulnFindingView{}
	for _, item := range findings {
		if item.CanonicalID == found.CanonicalID {
			linked = append(linked, item)
		}
	}
	return found, linked, nil
}

func aliasesForAdvisory(id int) []string {
	if DB == nil {
		return nil
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT alias FROM vuln_advisory_aliases WHERE advisory_id = $1 ORDER BY alias`, id)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var alias string
		if rows.Scan(&alias) == nil {
			out = append(out, alias)
		}
	}
	return out
}

func countConfirmedForAdvisory(canonical string) int {
	if DB == nil {
		return 0
	}
	var n int
	_ = queryRowContext(`SELECT COUNT(*) FROM vuln_findings WHERE canonical_id = $1 AND confidence = 'confirmed' AND lifecycle NOT IN ('fixed','withdrawn','false_positive')`, canonical).Scan(&n)
	return n
}

func loadAdvisoriesForMatch() []vulnAdvisoryRecord {
	if DB == nil {
		return nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, canonical_id, title, summary, severity, COALESCE(cvss_score,0), affected_json, first_fixed_version, kev, withdrawn
		FROM vuln_advisories
	`)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []vulnAdvisoryRecord{}
	for rows.Next() {
		var item vulnAdvisoryRecord
		var id int
		var raw string
		if err := rows.Scan(&id, &item.CanonicalID, &item.Title, &item.Summary, &item.Severity, &item.CVSSScore, &raw, &item.FirstFixed, &item.KEV, &item.Withdrawn); err != nil {
			continue
		}
		item.Ranges = decodeAffectedJSON(raw)
		item.Aliases = aliasesForAdvisory(id)
		out = append(out, item)
	}
	return out
}

func ensureVulnRepository(projectID int, provider, owner, name, branch, team string, actorID int) (int, error) {
	owner, name = strings.TrimSpace(owner), strings.TrimSpace(name)
	if owner == "" || name == "" {
		return 0, fmt.Errorf("repository owner and name are required")
	}
	if branch == "" {
		branch = "main"
	}
	provider = normalizeVulnProvider(provider)
	var projectAny any
	if projectID > 0 {
		projectAny = projectID
	}
	var id int
	err := queryRowContext(`
		INSERT INTO vuln_repositories (project_id, provider, owner, name, branch, owner_team, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (provider, owner, name) DO UPDATE SET
			branch = EXCLUDED.branch,
			owner_team = CASE WHEN EXCLUDED.owner_team = '' THEN vuln_repositories.owner_team ELSE EXCLUDED.owner_team END,
			project_id = COALESCE(EXCLUDED.project_id, vuln_repositories.project_id),
			updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, projectAny, provider, owner, name, branch, team, actorID).Scan(&id)
	return id, err
}

func linkServiceRepo(serviceID, repoID int, module string) {
	if DB == nil || serviceID <= 0 || repoID <= 0 {
		return
	}
	_, _ = execContext(`INSERT INTO vuln_service_repos (service_id, repo_id, module_path) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, serviceID, repoID, strings.TrimSpace(module))
}

func parseGitHubRepo(raw string) (owner, name string) {
	_, owner, name = parseVulnRepo(raw)
	return owner, name
}

func enqueueVulnScan(repoID, serviceID, projectID, actorID int, trigger, idempotency string) (int, error) {
	if DB == nil {
		return 0, fmt.Errorf("database is not configured")
	}
	var existing int
	_ = queryRowContext(`SELECT id FROM vuln_scan_jobs WHERE repo_id = $1 AND state IN ('queued','running') ORDER BY id DESC LIMIT 1`, repoID).Scan(&existing)
	if existing > 0 {
		return existing, nil
	}
	if strings.TrimSpace(idempotency) != "" {
		_ = queryRowContext(`SELECT id FROM vuln_scan_jobs WHERE idempotency_key = $1 LIMIT 1`, idempotency).Scan(&existing)
		if existing > 0 {
			return existing, nil
		}
	}
	var id int
	var serviceAny, projectAny any
	if serviceID > 0 {
		serviceAny = serviceID
	}
	if projectID > 0 {
		projectAny = projectID
	}
	mode := "hosted"
	_ = queryRowContext(`SELECT COALESCE(NULLIF(collection_mode,''),'hosted') FROM vuln_repositories WHERE id = $1`, repoID).Scan(&mode)
	err := queryRowContext(`
		INSERT INTO vuln_scan_jobs (repo_id, service_id, project_id, trigger, state, stage, idempotency_key, created_by, collection_mode)
		VALUES ($1,$2,$3,$4,'queued','queued',$5,$6,$7) RETURNING id
	`, repoID, serviceAny, projectAny, trigger, idempotency, actorID, mode).Scan(&id)
	return id, err
}

func saveInventoryAndCorrelate(jobID, repoID int, commit string, parsed vulnParsedInventory) error {
	if DB == nil {
		return fmt.Errorf("database is not configured")
	}
	var newer int
	_ = queryRowContext(`SELECT COUNT(*) FROM vuln_scan_jobs WHERE repo_id=$1 AND id>$2 AND state IN ('succeeded','partial') AND finished_at IS NOT NULL`, repoID, jobID).Scan(&newer)
	if newer > 0 {
		return nil
	}
	var inventoryID int
	err := queryRowContext(`
		INSERT INTO vuln_inventories (repo_id, scan_id, commit_sha, coverage_json, component_count, fresh)
		VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id
	`, repoID, jobID, commit, encodeJSONString(parsed.Coverage), len(parsed.Components)).Scan(&inventoryID)
	if err != nil {
		return err
	}
	for _, item := range parsed.Components {
		usage := item.Usage
		if usage == "" {
			usage = "dependency"
		}
		reach := item.Reachability
		if reach == "" {
			reach = vulnReachUnknown
		}
		_, _ = execContext(`
			INSERT INTO vuln_components (inventory_id, ecosystem, package_name, version, purl, path, module_path, direct, dev, resolved, parent_package, usage, reachability)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		`, inventoryID, item.Ecosystem, item.PackageName, item.Version, item.PURL, item.Path, item.ModulePath, item.Direct, item.Dev, item.Resolved, item.ParentPackage, usage, reach)
		if usage == "declared_runtime" || usage == "image_tag" {
			_, _ = execContext(`
				INSERT INTO vuln_runtime_observations (repo_id, kind, value, provenance, path, commit_sha)
				VALUES ($1,$2,$3,'declared',$4,$5)
			`, repoID, item.Ecosystem, item.Version, item.Path, commit)
		}
	}
	for i := range parsed.Components {
		if parsed.Components[i].Reachability == "" {
			parsed.Components[i].Reachability = vulnReachUnknown
		}
	}
	enrichInventoryFromOSV(parsed.Components)
	matches := correlateInventory(parsed.Components, loadAdvisoriesForMatch())
	assessed := map[string]bool{}
	for _, item := range parsed.Components {
		assessed[item.ModulePath+"|"+item.Ecosystem] = true
	}
	upsertVulnMatches(repoID, jobID, commit, matches, assessed, vulnMatchScan)
	persistPatchPlans(repoID, matches)
	return nil
}

func intelMatchDetail(commit string) string {
	sha := strings.TrimSpace(commit)
	if sha == "" {
		sha = "the stored inventory"
	}
	return "Public advisory matched the stored inventory at commit " + sha + ". The lockfile was not fetched again."
}

func upsertVulnMatches(repoID, jobID int, commit string, matches []vulnMatch, assessed map[string]bool, origin string) int {
	var projectID int
	var branch, ownerTeam string
	_ = queryRowContext(`SELECT COALESCE(project_id,0), branch, owner_team FROM vuln_repositories WHERE id = $1`, repoID).Scan(&projectID, &branch, &ownerTeam)
	var serviceID int
	_ = queryRowContext(`SELECT service_id FROM vuln_service_repos WHERE repo_id = $1 ORDER BY id LIMIT 1`, repoID).Scan(&serviceID)
	if origin != vulnMatchIntel {
		origin = vulnMatchScan
	}
	created := 0
	for _, match := range matches {
		canonical := match.CanonicalID
		var advisoryID int
		_ = queryRowContext(`SELECT id FROM vuln_advisories WHERE canonical_id = $1`, canonical).Scan(&advisoryID)
		if advisoryID == 0 {
			continue
		}
		var existingID int
		var lifecycle string
		_ = queryRowContext(`
			SELECT id, lifecycle FROM vuln_findings
			WHERE repo_id=$1 AND branch=$2 AND module_path=$3 AND ecosystem=$4 AND package_name=$5 AND canonical_id=$6
		`, repoID, branch, match.Component.ModulePath, match.Component.Ecosystem, match.Component.PackageName, canonical).Scan(&existingID, &lifecycle)
		if existingID == 0 {
			_ = queryRowContext(`
				INSERT INTO vuln_findings (
					repo_id, project_id, service_id, advisory_id, canonical_id, ecosystem, package_name, installed_version,
					module_path, path, branch, confidence, lifecycle, patch_state, first_fixed_version, recommended_version,
					parent_package, priority, priority_reason, owner, last_scan_id, due_at, reachability, match_source
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
				RETURNING id
			`, repoID, nullIfZero(projectID), nullIfZero(serviceID), advisoryID, canonical, match.Component.Ecosystem, match.Component.PackageName,
				match.Component.Version, match.Component.ModulePath, match.Component.Path, branch, match.Confidence, match.PatchState,
				match.FirstFixed, match.Recommended, match.ParentPackage, match.Priority, reachabilityReason(match), ownerTeam, jobID, dueAtForPriority(match.Priority), reachabilityValue(match.Component.Reachability), origin).Scan(&existingID)
			if existingID > 0 {
				kind, detail := "detected", "Confirmed dependency match at commit "+commit
				if origin == vulnMatchIntel {
					kind, detail = "intel_matched", intelMatchDetail(commit)
				}
				_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,$2,$3)`, existingID, kind, detail)
				created++
				if match.Confidence == vulnConfidenceConfirmed && (match.Severity == vulnSevCritical || match.Severity == vulnSevHigh) {
					notifyVulnFinding(existingID, projectID, match)
				}
			}
			continue
		}
		nextLife := lifecycle
		if lifecycle == vulnLifeFixed && match.Confidence == vulnConfidenceConfirmed {
			nextLife = vulnLifeOpen
			_, _ = execContext(`UPDATE vuln_findings SET episode = episode + 1 WHERE id = $1`, existingID)
			detail := "Affected version returned at commit " + commit
			if origin == vulnMatchIntel {
				detail = intelMatchDetail(commit)
				_, _ = execContext(`UPDATE vuln_findings SET match_source=$2 WHERE id=$1`, existingID, vulnMatchIntel)
			}
			_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'reintroduced',$2)`, existingID, detail)
			notifyVulnFinding(existingID, projectID, match)
		}
		if lifecycle == vulnLifePending && match.Confidence != vulnConfidenceConfirmed {
			nextLife = vulnLifeFixed
			_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'verified',$2)`, existingID, "Scoped rescan no longer matched this version at commit "+commit)
		}
		prevPatch := ""
		_ = queryRowContext(`SELECT patch_state FROM vuln_findings WHERE id = $1`, existingID).Scan(&prevPatch)
		_, _ = execContext(`
			UPDATE vuln_findings SET
				installed_version=$2, confidence=$3, lifecycle=$4, patch_state=$5, first_fixed_version=$6,
				recommended_version=$7, parent_package=$8, priority=$9, priority_reason=$10, last_scan_id=$11,
				reachability=$12, last_seen_at=CURRENT_TIMESTAMP
			WHERE id=$1
		`, existingID, match.Component.Version, match.Confidence, nextLife, match.PatchState, match.FirstFixed, match.Recommended, match.ParentPackage, match.Priority, reachabilityReason(match), jobID, reachabilityValue(match.Component.Reachability))
		if prevPatch == vulnPatchNone && match.PatchState == vulnPatchAvailable {
			_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'fix_available',$2)`, existingID, "A source-supported fix is now listed: "+match.FirstFixed)
			notifyVulnFixAvailable(existingID, projectID, match)
		}
	}
	closeVerifiedFindings(repoID, branch, matches, assessed, commit)
	return created
}

func closeVerifiedFindings(repoID int, branch string, matches []vulnMatch, assessed map[string]bool, commit string) {
	if DB == nil || len(assessed) == 0 {
		return
	}
	still := map[string]bool{}
	for _, match := range matches {
		still[findingKey(repoID, branch, match.Component.ModulePath, match.Component.Ecosystem, match.Component.PackageName, match.CanonicalID)] = true
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, module_path, ecosystem, package_name, canonical_id, lifecycle
		FROM vuln_findings
		WHERE repo_id = $1 AND branch = $2 AND lifecycle NOT IN ('fixed','withdrawn','false_positive')
	`, repoID, branch)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type row struct {
		ID, Module, Eco, Pkg, Canonical, Life string
		Num                                   int
	}
	items := []row{}
	for rows.Next() {
		var item row
		if rows.Scan(&item.Num, &item.Module, &item.Eco, &item.Pkg, &item.Canonical, &item.Life) == nil {
			items = append(items, item)
		}
	}
	for _, item := range items {
		if !assessed[item.Module+"|"+item.Eco] {
			continue
		}
		if still[findingKey(repoID, branch, item.Module, item.Eco, item.Pkg, item.Canonical)] {
			continue
		}
		_, _ = execContext(`UPDATE vuln_findings SET lifecycle='fixed', patch_state='repository_verified', last_seen_at=CURRENT_TIMESTAMP WHERE id=$1`, item.Num)
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'verified',$2)`, item.Num, "Scoped rescan no longer matched this package at commit "+commit)
	}
}

func persistPatchPlans(repoID int, matches []vulnMatch) {
	if DB == nil {
		return
	}
	_, _ = execContext(`DELETE FROM vuln_patch_plans WHERE repo_id = $1`, repoID)
	for _, plan := range groupPatchPlans(matches) {
		ids := make([]int, 0)
		for _, key := range plan.FindingKeys {
			parts := strings.SplitN(key, ":", 2)
			if len(parts) == 0 {
				continue
			}
			var id int
			_ = queryRowContext(`SELECT id FROM vuln_findings WHERE repo_id = $1 AND canonical_id = $2 LIMIT 1`, repoID, parts[0]).Scan(&id)
			if id > 0 {
				ids = append(ids, id)
			}
		}
		_, _ = execContext(`
			INSERT INTO vuln_patch_plans (repo_id, module_path, ecosystem, package_name, current_version, target_version, action, status, finding_ids, estimated)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
		`, repoID, plan.ModulePath, plan.Ecosystem, plan.PackageName, plan.Current, plan.Target, plan.Action, plan.Status, encodeJSONString(ids))
	}
}

func reevaluateStoredInventories() (repos, created int) {
	if DB == nil {
		return 0, 0
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT DISTINCT ON (repo_id) id, repo_id, scan_id, commit_sha
		FROM vuln_inventories
		ORDER BY repo_id, collected_at DESC
	`)
	if err != nil {
		return 0, 0
	}
	defer cancel()
	defer rows.Close()
	type snap struct {
		ID, RepoID, ScanID int
		SHA                string
	}
	items := []snap{}
	for rows.Next() {
		var item snap
		if rows.Scan(&item.ID, &item.RepoID, &item.ScanID, &item.SHA) == nil {
			items = append(items, item)
		}
	}
	advisories := loadAdvisoriesForMatch()
	for _, item := range items {
		comps, _ := loadInventoryComponents(item.ID)
		matches := correlateInventory(comps, advisories)
		assessed := map[string]bool{}
		for _, comp := range comps {
			assessed[comp.ModulePath+"|"+comp.Ecosystem] = true
		}
		created += upsertVulnMatches(item.RepoID, item.ScanID, item.SHA, matches, assessed, vulnMatchIntel)
		persistPatchPlans(item.RepoID, matches)
	}
	return len(items), created
}

func loadLatestStoredComponents() []vulnComponent {
	if DB == nil {
		return nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT DISTINCT ON (repo_id) id FROM vuln_inventories ORDER BY repo_id, collected_at DESC
	`)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []vulnComponent{}
	for rows.Next() {
		var id int
		if rows.Scan(&id) != nil || id <= 0 {
			continue
		}
		comps, _ := loadInventoryComponents(id)
		out = append(out, comps...)
	}
	return out
}

func loadInventoryComponents(inventoryID int) ([]vulnComponent, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT ecosystem, package_name, version, purl, path, module_path, direct, dev, resolved, parent_package, COALESCE(usage,'dependency'), COALESCE(NULLIF(reachability,''),'unknown')
		FROM vuln_components WHERE inventory_id = $1
	`, inventoryID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnComponent{}
	for rows.Next() {
		var item vulnComponent
		if rows.Scan(&item.Ecosystem, &item.PackageName, &item.Version, &item.PURL, &item.Path, &item.ModulePath, &item.Direct, &item.Dev, &item.Resolved, &item.ParentPackage, &item.Usage, &item.Reachability) == nil {
			out = append(out, item)
		}
	}
	return out, nil
}

func nullIfZero(value int) any {
	if value <= 0 {
		return nil
	}
	return value
}

func dueAtForPriority(priority string) any {
	now := time.Now().UTC()
	switch priority {
	case vulnPriorityEmergency:
		return now.Add(24 * time.Hour)
	case vulnPriorityUrgent:
		return now.Add(7 * 24 * time.Hour)
	case vulnPriorityHigh:
		return now.Add(14 * 24 * time.Hour)
	default:
		return nil
	}
}

func notifyVulnFinding(findingID, projectID int, match vulnMatch) {
	key := fmt.Sprintf("vuln:%d:%s:%d", findingID, "new_match", 1)
	title := match.CanonicalID + " matched a registered repository"
	message := fmt.Sprintf("%s %s %s@%s. Fix listed: %s. This is repository evidence, not proof of production exposure.",
		severityLabel(match.Severity), match.CanonicalID, match.Component.PackageName, match.Component.Version, firstNonEmpty(match.FirstFixed, "no known fix"))
	dispatchVulnAlert(key, title, message, findingID, projectID, match.Severity, map[string]any{
		"finding_id": findingID, "canonical_id": match.CanonicalID, "severity": match.Severity,
	})
}

func notifyVulnEvent(findingID int, event, title, message string) {
	if findingID <= 0 {
		return
	}
	var projectID int
	var severity, canonical string
	_ = queryRowContext(`
		SELECT COALESCE(f.project_id,0), COALESCE(a.severity,'unknown'), f.canonical_id
		FROM vuln_findings f JOIN vuln_advisories a ON a.id = f.advisory_id WHERE f.id=$1
	`, findingID).Scan(&projectID, &severity, &canonical)
	dispatchVulnAlert(fmt.Sprintf("vuln:%d:%s", findingID, event), title, message, findingID, projectID, severity, map[string]any{
		"finding_id": findingID, "canonical_id": canonical, "event": event,
	})
}

func notifyVulnFixAvailable(findingID, projectID int, match vulnMatch) {
	key := fmt.Sprintf("vuln:%d:%s:%s", findingID, "fix_available", match.FirstFixed)
	title := "Patch now available for " + match.CanonicalID
	message := fmt.Sprintf("A source-supported fix %s is listed for %s@%s. Tests are still required.", match.FirstFixed, match.Component.PackageName, match.Component.Version)
	dispatchVulnAlert(key, title, message, findingID, projectID, match.Severity, map[string]any{
		"finding_id": findingID, "canonical_id": match.CanonicalID, "first_fixed_version": match.FirstFixed,
	})
}

func dispatchVulnAlert(key, title, message string, findingID, projectID int, severity string, payload map[string]any) {
	var minSev, ownerTeam string
	_ = queryRowContext(`SELECT COALESCE(r.alert_min_severity,'high'), COALESCE(r.owner_team,'') FROM vuln_findings f JOIN vuln_repositories r ON r.id = f.repo_id WHERE f.id = $1`, findingID).Scan(&minSev, &ownerTeam)
	if !vulnSeverityAtLeast(severity, minSev) {
		return
	}
	var projectPtr *int
	if projectID > 0 {
		projectPtr = &projectID
	}
	recipients := ownerUserIDs(ownerTeam)
	_ = dispatchOpsNotification(key, "security_vuln", title, message, nil, projectPtr, recipients, payload)
}

func vulnSeverityAtLeast(have, min string) bool {
	rank := map[string]int{"low": 1, "medium": 2, "high": 3, "critical": 4}
	return rank[strings.ToLower(have)] >= rank[strings.ToLower(firstNonEmpty(min, "high"))]
}

func ownerUserIDs(teamName string) []int {
	teamName = strings.TrimSpace(teamName)
	if teamName == "" {
		return nil
	}
	team, err := GetTeamByNameOrSlug(teamName)
	if err != nil || team == nil {
		return nil
	}
	members, err := GetTeamMembers(team.ID)
	if err != nil {
		return nil
	}
	ids := make([]int, 0, len(members))
	for _, member := range members {
		if member.UserID > 0 {
			ids = append(ids, member.UserID)
		}
	}
	return ids
}

func vulnProjectFilter(seeAll bool, ids []int, column string, args []any) (string, []any) {
	if seeAll {
		return "", args
	}
	if len(ids) == 0 {
		return " AND FALSE", args
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		parts = append(parts, fmt.Sprintf("$%d", len(args)))
	}
	return fmt.Sprintf(" AND %s IN (%s)", column, strings.Join(parts, ",")), args
}

func listVulnServiceRows(userID, projectID int) ([]vulnServiceRow, error) {
	if DB == nil {
		return []vulnServiceRow{}, nil
	}
	seeAll, visible, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return nil, err
	}
	items, err := listServiceMap(projectID, "", "")
	if err != nil {
		return nil, err
	}
	items, err = filterServicesVisible(userID, items)
	if err != nil {
		return nil, err
	}
	_ = seeAll
	_ = visible
	out := make([]vulnServiceRow, 0, len(items))
	for _, item := range items {
		row := vulnServiceRow{
			ServiceID:    item.ID,
			Service:      item.Service,
			Repo:         item.Repo,
			ProjectName:  item.ProjectName,
			Team:         item.Team,
			Coverage:     "Not scanned",
			PatchLabel:   "Unknown",
			Technologies: []string{},
		}
		if item.ProjectID != nil {
			row.ProjectID = *item.ProjectID
		}
		provider, owner, name := parseVulnRepo(item.Repo)
		if owner != "" {
			_ = queryRowContext(`SELECT id FROM vuln_repositories WHERE COALESCE(NULLIF(provider,''),'github')=$1 AND owner=$2 AND name=$3`, normalizeVulnProvider(provider), owner, name).Scan(&row.RepoID)
		}
		if row.RepoID > 0 {
			var last sql.NullTime
			var coverageRaw string
			var state string
			_ = queryRowContext(`
				SELECT finished_at, coverage_json, state FROM vuln_scan_jobs
				WHERE repo_id = $1 ORDER BY id DESC LIMIT 1
			`, row.RepoID).Scan(&last, &coverageRaw, &state)
			row.LastScanAt = nullTimePtr(last)
			var crit, high int
			_ = queryRowContext(`SELECT COUNT(*) FILTER (WHERE a.severity='critical'), COUNT(*) FILTER (WHERE a.severity='high')
				FROM vuln_findings f JOIN vuln_advisories a ON a.id = f.advisory_id
				WHERE f.repo_id=$1 AND f.confidence='confirmed' AND f.lifecycle NOT IN ('fixed','withdrawn','false_positive')`, row.RepoID).Scan(&crit, &high)
			row.Critical = crit
			row.High = high
			var techRaw []string
			rows, cancel, techErr := queryRowsWithTimeout(`
				SELECT DISTINCT ecosystem FROM vuln_components c
				JOIN vuln_inventories i ON i.id = c.inventory_id
				WHERE i.repo_id = $1
			`, row.RepoID)
			if techErr == nil {
				for rows.Next() {
					var eco string
					if rows.Scan(&eco) == nil {
						techRaw = append(techRaw, eco)
					}
				}
				rows.Close()
				cancel()
			}
			row.Technologies = techRaw
			switch {
			case state == "failed":
				row.Coverage = "Scan failed"
			case state == "partial":
				row.Coverage = "Partial scan"
			case state == "succeeded" && crit+high == 0:
				row.Coverage = "No matches in scanned scope"
				row.PatchLabel = "No action identified"
			case state == "succeeded":
				row.Coverage = "Dependency scan current"
			case state == "queued" || state == "running":
				row.Coverage = "Scan " + state
			}
			var planCount int
			_ = queryRowContext(`SELECT COUNT(*) FROM vuln_patch_plans WHERE repo_id = $1`, row.RepoID).Scan(&planCount)
			if planCount > 0 {
				row.PatchLabel = fmt.Sprintf("%d candidate · tests required", planCount)
			}
		} else if strings.TrimSpace(item.Repo) == "" {
			row.Coverage = "Repository not connected"
		}
		if len(row.Technologies) == 0 {
			row.Technologies = []string{}
		}
		out = append(out, row)
	}
	return out, nil
}

func listVulnFindings(userID, projectID, serviceID int, severity, lifecycle, matchSource string) ([]vulnFindingView, error) {
	if DB == nil {
		return []vulnFindingView{}, nil
	}
	seeAll, ids, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return nil, err
	}
	args := []any{}
	where := " WHERE f.confidence IN ('confirmed','potential','needs_verification') "
	extra, args := vulnProjectFilter(seeAll, ids, "f.project_id", args)
	where += extra
	if projectID > 0 {
		args = append(args, projectID)
		where += fmt.Sprintf(" AND f.project_id = $%d", len(args))
	}
	if serviceID > 0 {
		args = append(args, serviceID)
		where += fmt.Sprintf(" AND f.service_id = $%d", len(args))
	}
	if sev := strings.ToLower(strings.TrimSpace(severity)); sev != "" {
		args = append(args, sev)
		where += fmt.Sprintf(" AND a.severity = $%d", len(args))
	}
	if life := strings.ToLower(strings.TrimSpace(lifecycle)); life != "" {
		args = append(args, life)
		where += fmt.Sprintf(" AND f.lifecycle = $%d", len(args))
	}
	if src := strings.ToLower(strings.TrimSpace(matchSource)); src == vulnMatchIntel || src == vulnMatchScan {
		args = append(args, src)
		where += fmt.Sprintf(" AND COALESCE(NULLIF(f.match_source,''),'scan') = $%d", len(args))
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT f.id, COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), COALESCE(s.service,''), COALESCE(f.service_id,0), COALESCE(f.project_id,0),
		       f.canonical_id, a.title, a.severity, f.priority, f.priority_reason, f.lifecycle, f.patch_state, f.confidence,
		       f.ecosystem, f.package_name, f.installed_version, f.first_fixed_version, f.recommended_version, f.parent_package,
		       f.module_path, f.path, f.owner, a.kev, f.pr_url, f.change_ref, f.due_at, f.last_seen_at, a.source_url,
		       COALESCE((SELECT commit_sha FROM vuln_scan_jobs WHERE id = f.last_scan_id), ''), COALESCE(NULLIF(f.reachability,''),'unknown'),
		       COALESCE(NULLIF(f.match_source,''),'scan')
		FROM vuln_findings f
		JOIN vuln_advisories a ON a.id = f.advisory_id
		JOIN vuln_repositories r ON r.id = f.repo_id
		LEFT JOIN service_map s ON s.id = f.service_id
		`+where+`
		ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, f.last_seen_at DESC, f.id DESC
		LIMIT 200
	`, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnFindingView{}
	for rows.Next() {
		var item vulnFindingView
		var due, seen sql.NullTime
		if err := rows.Scan(&item.ID, &item.Repo, &item.Service, &item.ServiceID, &item.ProjectID, &item.CanonicalID, &item.Title, &item.Severity,
			&item.Priority, &item.PriorityReason, &item.Lifecycle, &item.PatchState, &item.Confidence, &item.Ecosystem, &item.PackageName,
			&item.Installed, &item.FirstFixed, &item.Recommended, &item.ParentPackage, &item.ModulePath, &item.Path, &item.Owner, &item.KEV,
			&item.PRURL, &item.ChangeRef, &due, &seen, &item.SourceURL, &item.CommitSHA, &item.Reachability, &item.MatchSource); err != nil {
			continue
		}
		item.DueAt = nullTimePtr(due)
		item.LastSeenAt = nullTimePtr(seen)
		out = append(out, item)
	}
	return out, nil
}

func getVulnFinding(userID, id int) (*vulnFindingView, []map[string]any, error) {
	items, err := listVulnFindings(userID, 0, 0, "", "", "")
	if err != nil {
		return nil, nil, err
	}
	var found *vulnFindingView
	for i := range items {
		if items[i].ID == id {
			found = &items[i]
			break
		}
	}
	if found == nil {
		return nil, nil, fmt.Errorf("not found")
	}
	events := []map[string]any{}
	rows, cancel, err := queryRowsWithTimeout(`SELECT kind, detail, actor_id, created_at FROM vuln_finding_events WHERE finding_id = $1 ORDER BY id`, id)
	if err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var kind, detail string
			var actor int
			var created time.Time
			if rows.Scan(&kind, &detail, &actor, &created) == nil {
				events = append(events, map[string]any{"kind": kind, "detail": detail, "created_at": created.UTC().Format(time.RFC3339)})
			}
		}
	}
	return found, events, nil
}

func listVulnScans(userID int) ([]vulnScanView, error) {
	if DB == nil {
		return []vulnScanView{}, nil
	}
	seeAll, ids, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return nil, err
	}
	args := []any{}
	extra, args := vulnProjectFilter(seeAll, ids, "j.project_id", args)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT j.id, j.state, j.stage, COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), j.commit_sha, j.error,
		       j.discovered_modules, j.assessed_modules, j.coverage_json, j.created_at, j.finished_at
		FROM vuln_scan_jobs j
		JOIN vuln_repositories r ON r.id = j.repo_id
		WHERE 1=1 `+extra+`
		ORDER BY j.id DESC LIMIT 50
	`, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnScanView{}
	for rows.Next() {
		var item vulnScanView
		var created, finished sql.NullTime
		var raw string
		if err := rows.Scan(&item.ID, &item.State, &item.Stage, &item.Repository, &item.CommitSHA, &item.Error, &item.DiscoveredModules, &item.AssessedModules, &raw, &created, &finished); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(raw), &item.Coverage)
		if item.Coverage == nil {
			item.Coverage = []vulnCoverageGap{}
		}
		item.CreatedAt = nullTimePtr(created)
		item.FinishedAt = nullTimePtr(finished)
		out = append(out, item)
	}
	return out, nil
}

func getVulnScan(id int) (*vulnScanView, error) {
	items, err := listVulnScans(0)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	if DB == nil {
		return nil, fmt.Errorf("not found")
	}
	var item vulnScanView
	var created, finished sql.NullTime
	var raw string
	err = queryRowContext(`
		SELECT j.id, j.state, j.stage, COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), j.commit_sha, j.error,
		       j.discovered_modules, j.assessed_modules, j.coverage_json, j.created_at, j.finished_at
		FROM vuln_scan_jobs j JOIN vuln_repositories r ON r.id = j.repo_id WHERE j.id = $1
	`, id).Scan(&item.ID, &item.State, &item.Stage, &item.Repository, &item.CommitSHA, &item.Error, &item.DiscoveredModules, &item.AssessedModules, &raw, &created, &finished)
	if err != nil {
		return nil, fmt.Errorf("not found")
	}
	_ = json.Unmarshal([]byte(raw), &item.Coverage)
	item.CreatedAt = nullTimePtr(created)
	item.FinishedAt = nullTimePtr(finished)
	return &item, nil
}

func listVulnSources() []vulnSourceView {
	if DB == nil {
		return []vulnSourceView{}
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT provider, status, enabled, last_success_at, last_error, latest_revision FROM vuln_intelligence_sources ORDER BY provider`)
	if err != nil {
		return []vulnSourceView{}
	}
	defer cancel()
	defer rows.Close()
	out := []vulnSourceView{}
	for rows.Next() {
		var item vulnSourceView
		var last sql.NullTime
		if rows.Scan(&item.Provider, &item.Status, &item.Enabled, &last, &item.LastError, &item.LatestRevision) == nil {
			item.LastSuccessAt = nullTimePtr(last)
			out = append(out, item)
		}
	}
	return out
}

func listVulnPlans(userID int) ([]vulnPlanView, error) {
	if DB == nil {
		return []vulnPlanView{}, nil
	}
	seeAll, ids, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return nil, err
	}
	args := []any{}
	extra, args := vulnProjectFilter(seeAll, ids, "r.project_id", args)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT p.id, COALESCE(r.owner,'') || '/' || COALESCE(r.name,''), p.module_path, p.ecosystem, p.package_name,
		       p.current_version, p.target_version, p.action, p.status, p.finding_ids, p.estimated
		FROM vuln_patch_plans p
		JOIN vuln_repositories r ON r.id = p.repo_id
		WHERE 1=1 `+extra+`
		ORDER BY p.id DESC LIMIT 100
	`, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnPlanView{}
	for rows.Next() {
		var item vulnPlanView
		var raw string
		if rows.Scan(&item.ID, &item.Repository, &item.ModulePath, &item.Ecosystem, &item.PackageName, &item.Current, &item.Target, &item.Action, &item.Status, &raw, &item.Estimated) != nil {
			continue
		}
		_ = json.Unmarshal([]byte(raw), &item.FindingIDs)
		if item.FindingIDs == nil {
			item.FindingIDs = []int{}
		}
		n := len(item.FindingIDs)
		item.Label = fmt.Sprintf("Candidate upgrade addresses %d findings", n)
		if item.Estimated {
			item.Label = fmt.Sprintf("Estimated candidate coverage · %d findings", n)
		}
		out = append(out, item)
	}
	return out, nil
}

func vulnOverview(userID int) map[string]any {
	rows, _ := listVulnServiceRows(userID, 0)
	findings, _ := listVulnFindings(userID, 0, 0, "", "", "")
	crit, high, kev, overdue := 0, 0, 0, 0
	affected := 0
	scanned := 0
	for _, row := range rows {
		if row.Critical+row.High > 0 {
			affected++
		}
		if row.LastScanAt != nil {
			scanned++
		}
		crit += row.Critical
		high += row.High
	}
	for _, item := range findings {
		if item.KEV && item.Lifecycle != vulnLifeFixed {
			kev++
		}
		if item.DueAt != nil {
			if due, err := time.Parse(time.RFC3339, *item.DueAt); err == nil && due.Before(time.Now().UTC()) && item.Lifecycle != vulnLifeFixed {
				overdue++
			}
		}
	}
	var intel *string
	intelMatched, intelRepos := 0, 0
	unscanned := 0
	if DB != nil {
		var last sql.NullTime
		_ = queryRowContext(`SELECT MAX(last_success_at) FROM vuln_intelligence_sources WHERE enabled = TRUE`).Scan(&last)
		intel = nullTimePtr(last)
		_ = queryRowContext(`SELECT COALESCE(matched,0), COALESCE(repos_assessed,0) FROM vuln_intel_runs WHERE state='succeeded' ORDER BY id DESC LIMIT 1`).Scan(&intelMatched, &intelRepos)
		var registered int
		var withInv int
		_ = queryRowContext(`SELECT COUNT(*) FROM vuln_repositories WHERE enabled=TRUE`).Scan(&registered)
		_ = queryRowContext(`SELECT COUNT(DISTINCT repo_id) FROM vuln_inventories`).Scan(&withInv)
		if registered > withInv {
			unscanned = registered - withInv
		}
	}
	intelOpen := 0
	for _, item := range findings {
		if item.MatchSource == vulnMatchIntel && item.Lifecycle != vulnLifeFixed && item.Lifecycle != vulnLifeFalsePos && item.Lifecycle != vulnLifeWithdrawn {
			intelOpen++
		}
	}
	return map[string]any{
		"critical_findings":       crit,
		"high_findings":           high,
		"affected_services":       affected,
		"registered_services":     len(rows),
		"scanned_repositories":    scanned,
		"unscanned_repositories":  unscanned,
		"kev_matches":             kev,
		"overdue":                 overdue,
		"intelligence_synced_at":  intel,
		"intel_new_matches":       intelMatched,
		"intel_repos_assessed":    intelRepos,
		"intel_open_matches":      intelOpen,
		"github_token_configured": strings.TrimSpace(GitHubToken) != "",
		"hosted_collector":        vulnHostedCollectorConfigured(),
		"count_note":              "Scorecards count confirmed repository occurrences in your authorized projects. Global advisories are public intelligence, not exposure.",
		"status":                  "ok",
	}
}
