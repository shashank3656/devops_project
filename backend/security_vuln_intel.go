package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	vulnGitHubAdvisoriesURL = "https://api.github.com/advisories"
	vulnCISAKEVURL          = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
	vulnIntelMaxBytes       = 2 << 20
	vulnIntelPageSize       = 30
)

var vulnAllowedFeedHosts = map[string]bool{
	"api.github.com":        true,
	"www.cisa.gov":          true,
	"api.osv.dev":           true,
	"services.nvd.nist.gov": true,
	"api.first.org":         true,
}

var vulnFeedGet = fetchVulnFeed

type githubAdvisoryPayload struct {
	GHSAID      string  `json:"ghsa_id"`
	CVEID       string  `json:"cve_id"`
	URL         string  `json:"html_url"`
	Summary     string  `json:"summary"`
	Description string  `json:"description"`
	Severity    string  `json:"severity"`
	WithdrawnAt *string `json:"withdrawn_at"`
	PublishedAt string  `json:"published_at"`
	UpdatedAt   string  `json:"updated_at"`
	CVSS        *struct {
		Score        float64 `json:"score"`
		VectorString string  `json:"vector_string"`
	} `json:"cvss"`
	Vulnerabilities []struct {
		Package struct {
			Ecosystem string `json:"ecosystem"`
			Name      string `json:"name"`
		} `json:"package"`
		VulnerableVersionRange string           `json:"vulnerable_version_range"`
		FirstPatchedVersion    githubPatchedVer `json:"first_patched_version"`
	} `json:"vulnerabilities"`
}

type githubPatchedVer struct {
	Identifier string
}

func (p *githubPatchedVer) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" || len(raw) == 0 {
		return nil
	}
	if raw[0] == '"' {
		return json.Unmarshal(raw, &p.Identifier)
	}
	var obj struct {
		Identifier string `json:"identifier"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return err
	}
	p.Identifier = obj.Identifier
	return nil
}

type cisaKEVPayload struct {
	CatalogVersion  string `json:"catalogVersion"`
	Vulnerabilities []struct {
		CVEID string `json:"cveID"`
	} `json:"vulnerabilities"`
}

func fetchVulnFeed(rawURL string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "https" || !vulnAllowedFeedHosts[parsed.Host] || parsed.User != nil {
		return nil, fmt.Errorf("feed host is not allowed")
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 2 {
				return fmt.Errorf("too many redirects")
			}
			if req.URL.Host != parsed.Host || req.URL.Scheme != "https" {
				return fmt.Errorf("redirect host is not allowed")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "OpsTrellis-security-intel")
	req.Header.Set("Accept", "application/json")
	if parsed.Host == "api.github.com" {
		req.Header.Set("Accept", "application/vnd.github+json")
		if strings.TrimSpace(GitHubToken) != "" {
			req.Header.Set("Authorization", "Bearer "+GitHubToken)
		}
	}
	if parsed.Host == "services.nvd.nist.gov" {
		if key := strings.TrimSpace(os.Getenv("NVD_API_KEY")); key != "" {
			req.Header.Set("apiKey", key)
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, vulnIntelMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > vulnIntelMaxBytes {
		return nil, fmt.Errorf("feed response exceeded size cap")
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("feed returned HTTP %d", res.StatusCode)
	}
	return body, nil
}

func parseGitHubAdvisories(body []byte) []vulnAdvisoryRecord {
	var rows []githubAdvisoryPayload
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil
	}
	out := make([]vulnAdvisoryRecord, 0, len(rows))
	for _, row := range rows {
		canonical, aliases := canonicalizeAdvisoryIDs(row.GHSAID, row.CVEID)
		if canonical == "" {
			continue
		}
		score := 0.0
		vector := ""
		if row.CVSS != nil {
			score = row.CVSS.Score
			vector = row.CVSS.VectorString
		}
		ranges := make([]vulnAffectedRange, 0, len(row.Vulnerabilities))
		firstFixed := ""
		eco, pkg := "", ""
		for _, item := range row.Vulnerabilities {
			rng := parseGitHubVersionRange(item.Package.Ecosystem, item.Package.Name, item.VulnerableVersionRange, item.FirstPatchedVersion.Identifier)
			ranges = append(ranges, rng)
			if firstFixed == "" {
				firstFixed = rng.Fixed
			}
			if eco == "" {
				eco = rng.Ecosystem
				pkg = rng.Package
			}
		}
		summary := strings.TrimSpace(row.Summary)
		if summary == "" {
			summary = strings.TrimSpace(row.Description)
			if len(summary) > 400 {
				summary = summary[:400]
			}
		}
		out = append(out, vulnAdvisoryRecord{
			CanonicalID:  canonical,
			Aliases:      aliases,
			Title:        firstNonEmpty(row.Summary, canonical),
			Summary:      summary,
			Severity:     severityFromScore(score, row.Severity),
			CVSSScore:    score,
			CVSSVector:   vector,
			CVSSProvider: "github",
			Ranges:       ranges,
			FirstFixed:   firstFixed,
			Source:       "github",
			SourceURL:    row.URL,
			Withdrawn:    row.WithdrawnAt != nil && strings.TrimSpace(*row.WithdrawnAt) != "",
			Revision:     firstNonEmpty(row.UpdatedAt, row.PublishedAt),
		})
		_ = eco
		_ = pkg
	}
	return out
}

func parseCISAKEVIDs(body []byte) (string, map[string]bool) {
	var doc cisaKEVPayload
	if err := json.Unmarshal(body, &doc); err != nil {
		return "", nil
	}
	ids := map[string]bool{}
	for _, item := range doc.Vulnerabilities {
		id := strings.ToUpper(strings.TrimSpace(item.CVEID))
		if id != "" {
			ids[id] = true
		}
	}
	return strings.TrimSpace(doc.CatalogVersion), ids
}

func runVulnIntelligenceSync(actorID int) (int, error) {
	if DB == nil {
		return 0, fmt.Errorf("database is not configured")
	}
	var runID int
	_ = queryRowContext(`INSERT INTO vuln_intel_runs (state, created_by) VALUES ('running', $1) RETURNING id`, actorID).Scan(&runID)
	fetched := 0
	markSource := func(provider, status, revision, errText string, count int) {
		_, _ = execContext(`
			UPDATE vuln_intelligence_sources
			SET status = $2, latest_revision = CASE WHEN $3 = '' THEN latest_revision ELSE $3 END,
			    last_error = $4, fetched_count = fetched_count + $5,
			    last_success_at = CASE WHEN $2 = 'ok' THEN CURRENT_TIMESTAMP ELSE last_success_at END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE provider = $1
		`, provider, status, revision, errText, count)
	}

	criticalBody, err := vulnFeedGet(vulnGitHubAdvisoriesURL + "?severity=critical&per_page=" + fmt.Sprint(vulnIntelPageSize))
	if err != nil {
		markSource("github", "failed", "", "GitHub advisories could not be retrieved.", 0)
		_, _ = execContext(`UPDATE vuln_intel_runs SET state='failed', error=$2, finished_at=CURRENT_TIMESTAMP WHERE id=$1`, runID, "GitHub advisories could not be retrieved.")
		return 0, err
	}
	highBody, highErr := vulnFeedGet(vulnGitHubAdvisoriesURL + "?severity=high&per_page=" + fmt.Sprint(vulnIntelPageSize))
	if highErr != nil {
		highBody = []byte("[]")
	}
	advisories := append(parseGitHubAdvisories(criticalBody), parseGitHubAdvisories(highBody)...)
	for _, item := range advisories {
		if err := upsertVulnAdvisory(item); err != nil {
			continue
		}
		fetched++
	}
	markSource("github", "ok", time.Now().UTC().Format(time.RFC3339), "", fetched)

	kevBody, kevErr := vulnFeedGet(vulnCISAKEVURL)
	if kevErr != nil {
		markSource("cisa_kev", "failed", "", "CISA KEV catalogue could not be retrieved.", 0)
	} else {
		rev, ids := parseCISAKEVIDs(kevBody)
		if ids != nil {
			applied := applyKEVFlags(ids)
			markSource("cisa_kev", "ok", rev, "", applied)
		}
	}

	nvdCount, nvdErr := enrichAdvisoriesFromNVD()
	if nvdErr != nil {
		markSource("nvd", "failed", "", "NVD enrichment could not be retrieved.", 0)
	} else {
		markSource("nvd", "ok", time.Now().UTC().Format(time.RFC3339), "", nvdCount)
	}
	epssCount, epssErr := enrichAdvisoriesFromEPSS()
	if epssErr != nil {
		markSource("epss", "failed", "", "EPSS scores could not be retrieved.", 0)
	} else {
		markSource("epss", "ok", time.Now().UTC().Format(time.RFC3339), "", epssCount)
	}

	enrichInventoryFromOSV(loadLatestStoredComponents())
	repos, matched := reevaluateStoredInventories()
	invalidateWithdrawnVulnFixes()
	_, _ = execContext(`UPDATE vuln_intel_runs SET state='succeeded', fetched=$2, matched=$3, repos_assessed=$4, finished_at=CURRENT_TIMESTAMP WHERE id=$1`, runID, fetched, matched, repos)
	return fetched, nil
}

func invalidateWithdrawnVulnFixes() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT f.id, f.canonical_id, COALESCE(f.first_fixed_version,'')
		FROM vuln_findings f
		JOIN vuln_advisories a ON a.id = f.advisory_id
		WHERE a.withdrawn = TRUE AND f.patch_state IN ('fix_available','pr_linked')
		  AND f.lifecycle NOT IN ('fixed','withdrawn','false_positive')
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type row struct {
		ID         int
		Canonical  string
		FirstFixed string
	}
	items := []row{}
	for rows.Next() {
		var item row
		if rows.Scan(&item.ID, &item.Canonical, &item.FirstFixed) == nil {
			items = append(items, item)
		}
	}
	for _, item := range items {
		_, _ = execContext(`UPDATE vuln_findings SET patch_state=$2 WHERE id=$1`, item.ID, vulnPatchNone)
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail) VALUES ($1,'fix_withdrawn',$2)`, item.ID, "The listed fix was withdrawn. The candidate is invalidated; this is not recovery.")
		notifyVulnEvent(item.ID, "fix_withdrawn:"+firstNonEmpty(item.FirstFixed, "none"), "Patch candidate withdrawn for "+item.Canonical, "The previously listed fix is no longer valid. The finding stays open until a replacement source-supported fix exists.")
	}
	_, _ = execContext(`
		UPDATE vuln_patch_plans SET status='invalidated', updated_at=CURRENT_TIMESTAMP
		WHERE status IN ('fix_available','pr_linked','open')
		  AND package_name IN (
		    SELECT DISTINCT f.package_name FROM vuln_findings f
		    JOIN vuln_advisories a ON a.id = f.advisory_id
		    WHERE a.withdrawn = TRUE
		  )
	`)
}

func fetchVulnFeedPost(rawURL string, payload any) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "https" || !vulnAllowedFeedHosts[parsed.Host] || parsed.User != nil {
		return nil, fmt.Errorf("feed host is not allowed")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodPost, parsed.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "OpsTrellis-security-intel")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, vulnIntelMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > vulnIntelMaxBytes {
		return nil, fmt.Errorf("feed response exceeded size cap")
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("feed returned HTTP %d", res.StatusCode)
	}
	return raw, nil
}

func osvQueryPayload(name, eco, version string) map[string]any {
	return map[string]any{
		"package": map[string]string{"name": name, "ecosystem": eco},
		"version": version,
	}
}

func osvEcosystem(eco string) string {
	switch normalizeEcosystem(eco) {
	case "npm":
		return "npm"
	case "pypi":
		return "PyPI"
	case "maven":
		return "Maven"
	case "go":
		return "Go"
	case "nuget":
		return "NuGet"
	case "packagist":
		return "Packagist"
	case "rubygems":
		return "RubyGems"
	case "cargo":
		return "crates.io"
	case "pub":
		return "Pub"
	case "hex":
		return "Hex"
	default:
		return ""
	}
}

func sourceEnabled(provider string) bool {
	if DB == nil {
		return false
	}
	var enabled bool
	_ = queryRowContext(`SELECT enabled FROM vuln_intelligence_sources WHERE provider = $1`, provider).Scan(&enabled)
	return enabled
}

func enrichInventoryFromOSV(components []vulnComponent) {
	if !sourceEnabled("osv") {
		return
	}
	seen := map[string]bool{}
	count := 0
	for _, item := range components {
		if item.Usage == "declared_runtime" || item.Usage == "image_tag" || !item.Resolved || item.Version == "" {
			continue
		}
		eco := osvEcosystem(item.Ecosystem)
		if eco == "" {
			continue
		}
		key := eco + "|" + item.PackageName + "|" + item.Version
		if seen[key] {
			continue
		}
		seen[key] = true
		if count >= 40 {
			break
		}
		count++
		body, err := fetchVulnFeedPost("https://api.osv.dev/v1/query", osvQueryPayload(item.PackageName, eco, item.Version))
		if err != nil {
			continue
		}
		for _, rec := range parseOSVQuery(body, item.Ecosystem, item.PackageName) {
			_ = upsertVulnAdvisory(rec)
		}
	}
	if count > 0 {
		_, _ = execContext(`UPDATE vuln_intelligence_sources SET status='ok', last_success_at=CURRENT_TIMESTAMP, fetched_count=fetched_count+$1, updated_at=CURRENT_TIMESTAMP WHERE provider='osv'`, count)
	}
}

func parseOSVQuery(body []byte, eco, pkg string) []vulnAdvisoryRecord {
	var doc struct {
		Vulns []struct {
			ID        string   `json:"id"`
			Aliases   []string `json:"aliases"`
			Summary   string   `json:"summary"`
			Withdrawn string   `json:"withdrawn"`
			Severity  []struct {
				Type  string `json:"type"`
				Score string `json:"score"`
			} `json:"severity"`
			Affected []struct {
				Package struct {
					Ecosystem string `json:"ecosystem"`
					Name      string `json:"name"`
				} `json:"package"`
				Ranges []struct {
					Events []struct {
						Introduced string `json:"introduced"`
						Fixed      string `json:"fixed"`
					} `json:"events"`
				} `json:"ranges"`
			} `json:"affected"`
		} `json:"vulns"`
	}
	if json.Unmarshal(body, &doc) != nil {
		return nil
	}
	out := []vulnAdvisoryRecord{}
	for _, vuln := range doc.Vulns {
		canonical, aliases := canonicalizeAdvisoryIDs(append(vuln.Aliases, vuln.ID)...)
		ranges := []vulnAffectedRange{}
		firstFixed := ""
		for _, aff := range vuln.Affected {
			for _, rng := range aff.Ranges {
				item := vulnAffectedRange{Ecosystem: normalizeEcosystem(firstNonEmpty(aff.Package.Ecosystem, eco)), Package: normalizePackageName(eco, firstNonEmpty(aff.Package.Name, pkg))}
				for _, ev := range rng.Events {
					if ev.Introduced != "" && ev.Introduced != "0" {
						item.Introduced = ev.Introduced
					}
					if ev.Fixed != "" {
						item.Fixed = ev.Fixed
						if firstFixed == "" {
							firstFixed = ev.Fixed
						}
					}
				}
				ranges = append(ranges, item)
			}
		}
		out = append(out, vulnAdvisoryRecord{
			CanonicalID: canonical, Aliases: aliases, Title: firstNonEmpty(vuln.Summary, canonical), Summary: vuln.Summary,
			Severity: severityFromScore(0, ""), FirstFixed: firstFixed, Ranges: ranges, Source: "osv",
			SourceURL: "https://osv.dev/vulnerability/" + vuln.ID, Withdrawn: strings.TrimSpace(vuln.Withdrawn) != "",
		})
	}
	return out
}

func enrichAdvisoriesFromNVD() (int, error) {
	if DB == nil || !sourceEnabled("nvd") {
		return 0, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT canonical_id FROM vuln_advisories WHERE canonical_id LIKE 'CVE-%' ORDER BY fetched_at DESC LIMIT 20`)
	if err != nil {
		return 0, err
	}
	defer cancel()
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	updated := 0
	for _, id := range ids {
		body, err := vulnFeedGet("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=" + url.QueryEscape(id))
		if err != nil {
			continue
		}
		score, vector, summary := parseNVD(body)
		if score <= 0 && summary == "" {
			continue
		}
		_, _ = execContext(`UPDATE vuln_advisories SET cvss_score = CASE WHEN $2>0 THEN $2 ELSE cvss_score END, cvss_vector = CASE WHEN $3='' THEN cvss_vector ELSE $3 END, cvss_provider='nvd', summary = CASE WHEN $4='' THEN summary ELSE $4 END, severity = CASE WHEN $2>=9 THEN 'critical' WHEN $2>=7 THEN 'high' WHEN $2>=4 THEN 'medium' WHEN $2>0 THEN 'low' ELSE severity END WHERE canonical_id=$1 OR id IN (SELECT advisory_id FROM vuln_advisory_aliases WHERE alias=$1)`, id, score, vector, summary)
		updated++
		time.Sleep(200 * time.Millisecond)
	}
	return updated, nil
}

func parseNVD(body []byte) (float64, string, string) {
	var doc struct {
		Vulnerabilities []struct {
			CVE struct {
				Descriptions []struct {
					Lang  string `json:"lang"`
					Value string `json:"value"`
				} `json:"descriptions"`
				Metrics struct {
					CvssMetricV31 []struct {
						CvssData struct {
							BaseScore    float64 `json:"baseScore"`
							VectorString string  `json:"vectorString"`
						} `json:"cvssData"`
					} `json:"cvssMetricV31"`
				} `json:"metrics"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if json.Unmarshal(body, &doc) != nil || len(doc.Vulnerabilities) == 0 {
		return 0, "", ""
	}
	item := doc.Vulnerabilities[0].CVE
	summary := ""
	for _, d := range item.Descriptions {
		if d.Lang == "en" {
			summary = d.Value
			break
		}
	}
	score, vector := 0.0, ""
	if len(item.Metrics.CvssMetricV31) > 0 {
		score = item.Metrics.CvssMetricV31[0].CvssData.BaseScore
		vector = item.Metrics.CvssMetricV31[0].CvssData.VectorString
	}
	return score, vector, summary
}

func enrichAdvisoriesFromEPSS() (int, error) {
	if DB == nil || !sourceEnabled("epss") {
		return 0, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT canonical_id FROM vuln_advisories WHERE canonical_id LIKE 'CVE-%' ORDER BY fetched_at DESC LIMIT 40`)
	if err != nil {
		return 0, err
	}
	defer cancel()
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	body, err := vulnFeedGet("https://api.first.org/data/v1/epss?cve=" + url.QueryEscape(strings.Join(ids, ",")))
	if err != nil {
		return 0, err
	}
	var doc struct {
		Data []struct {
			CVE        string `json:"cve"`
			EPSS       string `json:"epss"`
			Percentile string `json:"percentile"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &doc) != nil {
		return 0, fmt.Errorf("epss parse")
	}
	updated := 0
	for _, row := range doc.Data {
		var score, pct float64
		fmt.Sscanf(row.EPSS, "%f", &score)
		fmt.Sscanf(row.Percentile, "%f", &pct)
		_, _ = execContext(`UPDATE vuln_advisories SET epss=$2, epss_percentile=$3 WHERE canonical_id=$1 OR id IN (SELECT advisory_id FROM vuln_advisory_aliases WHERE alias=$1)`, strings.ToUpper(row.CVE), score, pct)
		updated++
	}
	return updated, nil
}
