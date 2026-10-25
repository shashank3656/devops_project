package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	vulnFindingsViewScope = "security_findings"
	vulnFindingsViewName  = "Last Findings filters"
)

var opsRecordRefPattern = regexp.MustCompile(`(?i)^(chg|inc|req)?0*([0-9]+)$`)

type vulnPolicyEvent struct {
	ID        int    `json:"id"`
	ActorID   int    `json:"actor_id,omitempty"`
	Summary   string `json:"summary"`
	CreatedAt string `json:"created_at"`
}

type vulnOpsLink struct {
	Kind  string
	ID    int
	Label string
}

func looksLikeSARIF(raw []byte) bool {
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return false
	}
	if _, hasRepo := doc["repository_id"]; hasRepo {
		return false
	}
	runs, ok := doc["runs"]
	if !ok {
		return false
	}
	_, isArr := runs.([]any)
	return isArr
}

func looksLikeSBOMDocument(raw []byte) bool {
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return false
	}
	if _, hasRepo := doc["repository_id"]; hasRepo {
		return false
	}
	if _, ok := doc["bomFormat"]; ok {
		return true
	}
	if _, ok := doc["spdxVersion"]; ok {
		return true
	}
	return false
}

func parseSARIFMatches(raw []byte) (vulnParsedInventory, []vulnMatch) {
	out := vulnParsedInventory{Coverage: []vulnCoverageGap{}}
	matches := []vulnMatch{}
	var doc struct {
		Runs []struct {
			Results []struct {
				RuleID     string         `json:"ruleId"`
				Message    map[string]any `json:"message"`
				Properties map[string]any `json:"properties"`
				Locations  []struct {
					PhysicalLocation struct {
						ArtifactLocation struct {
							URI string `json:"uri"`
						} `json:"artifactLocation"`
					} `json:"physicalLocation"`
				} `json:"locations"`
			} `json:"results"`
		} `json:"runs"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: "/", Reason: "SARIF JSON could not be read. Coverage is Unknown."})
		return out, matches
	}
	skipped := 0
	for _, run := range doc.Runs {
		for _, result := range run.Results {
			path := "unknown"
			if len(result.Locations) > 0 {
				if uri := strings.TrimSpace(result.Locations[0].PhysicalLocation.ArtifactLocation.URI); uri != "" {
					path = uri
				}
			}
			eco, pkg, version, purl := sarifPackageIdentity(result.Properties)
			if pkg == "" {
				skipped++
				continue
			}
			module := path
			if i := strings.LastIndex(path, "/"); i >= 0 {
				module = path[:i]
			}
			comp := vulnComponent{
				Ecosystem: firstNonEmpty(eco, "generic"), PackageName: pkg, Version: version, PURL: purl,
				Path: path, ModulePath: module, Direct: true, Resolved: version != "",
			}
			out.Components = append(out.Components, comp)
			canonical := strings.TrimSpace(result.RuleID)
			if looksLikeAdvisoryID(canonical) {
				matches = append(matches, vulnMatch{
					Component:   comp,
					CanonicalID: strings.ToUpper(canonical),
					Title:       firstNonEmpty(sarifString(result.Message["text"]), canonical),
					Severity:    vulnSevUnknown,
					Confidence:  vulnConfidencePotential,
					PatchState:  vulnPatchUnknown,
					Priority:    vulnPriorityReview,
				})
			}
		}
	}
	if skipped > 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{
			Path: "/", Reason: fmt.Sprintf("%d SARIF results had no package identity and were skipped. Coverage is Unknown for those results.", skipped),
		})
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: "/", Reason: "SARIF contained no package identity. Empty coverage is Unknown, never Secure."})
	}
	return out, matches
}

func sarifPackageIdentity(props map[string]any) (eco, pkg, version, purl string) {
	if props == nil {
		return "", "", "", ""
	}
	if nested := sarifMap(props["osv-scanner/package"]); nested != nil {
		eco = sarifString(nested["ecosystem"])
		pkg = sarifString(nested["name"])
		version = sarifString(nested["version"])
		purl = sarifString(nested["purl"])
	}
	if pkg == "" {
		if nested := sarifMap(props["package"]); nested != nil {
			eco = firstNonEmpty(eco, sarifString(nested["ecosystem"]))
			pkg = sarifString(nested["name"])
			version = firstNonEmpty(version, sarifString(nested["version"]))
			purl = firstNonEmpty(purl, sarifString(nested["purl"]))
		}
	}
	if pkg == "" {
		pkg = firstNonEmpty(sarifString(props["packageName"]), sarifString(props["package_name"]))
		version = firstNonEmpty(version, sarifString(props["packageVersion"]), sarifString(props["installedVersion"]))
		eco = firstNonEmpty(eco, sarifString(props["ecosystem"]))
		purl = firstNonEmpty(purl, sarifString(props["purl"]))
	}
	if purl != "" && (pkg == "" || eco == "") {
		parsedEco, parsedName, parsedVersion := purlParts(purl, pkg, version)
		eco = firstNonEmpty(eco, parsedEco)
		pkg = firstNonEmpty(pkg, parsedName)
		version = firstNonEmpty(version, parsedVersion)
	}
	return eco, pkg, version, purl
}

func sarifString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strings.TrimSpace(strconv.FormatFloat(v, 'f', -1, 64))
	default:
		return ""
	}
}

func sarifMap(value any) map[string]any {
	out, _ := value.(map[string]any)
	return out
}

func looksLikeAdvisoryID(raw string) bool {
	id := strings.ToUpper(strings.TrimSpace(raw))
	return strings.HasPrefix(id, "CVE-") || strings.HasPrefix(id, "GHSA-") || strings.HasPrefix(id, "OSV-")
}

func vulnPolicyChangeSummary(before, after map[string]string) string {
	keys := []string{"collection_mode", "branch", "schedule_minutes", "alert_min_severity", "owner_team", "exclusions", "allow_fork_prs", "enforce_pr_gate", "stale_after_days", "enabled"}
	parts := []string{}
	for _, key := range keys {
		oldVal := strings.TrimSpace(before[key])
		newVal := strings.TrimSpace(after[key])
		if oldVal == newVal {
			continue
		}
		if oldVal == "" {
			oldVal = "unset"
		}
		if newVal == "" {
			newVal = "unset"
		}
		parts = append(parts, fmt.Sprintf("%s: %s → %s", key, oldVal, newVal))
	}
	if len(parts) == 0 {
		return "Policy saved. No collection fields changed. Token values are never recorded."
	}
	return strings.Join(parts, "; ") + ". Token values are never recorded."
}

func loadVulnRepoPolicySnapshot(id int) map[string]string {
	out := map[string]string{}
	if DB == nil || id <= 0 {
		return out
	}
	var mode, branch, alert, team, excl string
	var schedule, stale int
	var forks, gate, enabled bool
	if queryRowContext(`
		SELECT COALESCE(NULLIF(collection_mode,''),'hosted'), COALESCE(branch,''), COALESCE(schedule_minutes,0),
		       COALESCE(NULLIF(alert_min_severity,''),'high'), COALESCE(owner_team,''), COALESCE(exclusions,''),
		       allow_fork_prs, enforce_pr_gate, COALESCE(stale_after_days,14), enabled
		FROM vuln_repositories WHERE id=$1
	`, id).Scan(&mode, &branch, &schedule, &alert, &team, &excl, &forks, &gate, &stale, &enabled) != nil {
		return out
	}
	out["collection_mode"] = mode
	out["branch"] = branch
	out["schedule_minutes"] = strconv.Itoa(schedule)
	out["alert_min_severity"] = alert
	out["owner_team"] = team
	out["exclusions"] = excl
	out["allow_fork_prs"] = strconv.FormatBool(forks)
	out["enforce_pr_gate"] = strconv.FormatBool(gate)
	out["stale_after_days"] = strconv.Itoa(stale)
	out["enabled"] = strconv.FormatBool(enabled)
	return out
}

func recordVulnPolicyEvent(repoID, actorID int, summary string) {
	if DB == nil || repoID <= 0 || strings.TrimSpace(summary) == "" {
		return
	}
	_, _ = execContext(`INSERT INTO vuln_policy_events (repo_id, actor_id, summary) VALUES ($1,$2,$3)`, repoID, actorID, strings.TrimSpace(summary))
}

func listVulnPolicyEvents(repoID int) []vulnPolicyEvent {
	if DB == nil || repoID <= 0 {
		return []vulnPolicyEvent{}
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, actor_id, summary, created_at FROM vuln_policy_events WHERE repo_id=$1 ORDER BY id DESC LIMIT 50
	`, repoID)
	if err != nil {
		return []vulnPolicyEvent{}
	}
	defer cancel()
	defer rows.Close()
	out := []vulnPolicyEvent{}
	for rows.Next() {
		var item vulnPolicyEvent
		var created time.Time
		if rows.Scan(&item.ID, &item.ActorID, &item.Summary, &created) != nil {
			continue
		}
		item.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, item)
	}
	return out
}

func registerVulnReposFromServiceMap(userID int) (registered, skipped, already int, err error) {
	rows, listErr := listVulnServiceRows(userID, 0)
	if listErr != nil {
		return 0, 0, 0, listErr
	}
	for _, item := range rows {
		provider, owner, name := parseVulnRepo(item.Repo)
		if owner == "" || name == "" {
			skipped++
			continue
		}
		var existing int
		_ = queryRowContext(`SELECT id FROM vuln_repositories WHERE COALESCE(NULLIF(provider,''),'github')=$1 AND owner=$2 AND name=$3`, normalizeVulnProvider(provider), owner, name).Scan(&existing)
		if existing > 0 || item.RepoID > 0 {
			already++
			if existing == 0 {
				existing = item.RepoID
			}
			linkServiceRepo(item.ServiceID, existing, "")
			continue
		}
		id, ensureErr := ensureVulnRepository(item.ProjectID, provider, owner, name, "main", item.Team, userID)
		if ensureErr != nil || id <= 0 {
			skipped++
			continue
		}
		linkServiceRepo(item.ServiceID, id, "")
		registered++
	}
	return registered, skipped, already, nil
}

func parseOpsRecordRef(raw string) (kind string, id int) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0
	}
	match := opsRecordRefPattern.FindStringSubmatch(raw)
	if match == nil {
		return "", 0
	}
	id, _ = strconv.Atoi(match[2])
	switch strings.ToLower(match[1]) {
	case "chg":
		return "change", id
	case "inc":
		return "incident", id
	case "req":
		return "ticket", id
	default:
		return "", id
	}
}

func formatVulnTicketNumber(id int) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("REQ%07d", id)
}

func vulnProjectVisibleToUser(userID, projectID int) bool {
	if projectID <= 0 {
		return true
	}
	seeAll, ids, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return false
	}
	if seeAll {
		return true
	}
	for _, id := range ids {
		if id == projectID {
			return true
		}
	}
	return false
}

func resolveVulnOpsLink(userID int, kind, raw string, fallbackID int) (*vulnOpsLink, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	parsedKind, parsedID := parseOpsRecordRef(raw)
	id := fallbackID
	if parsedID > 0 {
		id = parsedID
	}
	if parsedKind != "" {
		kind = parsedKind
	}
	if id <= 0 || kind == "" {
		return nil, nil
	}
	switch kind {
	case "change":
		var projectID int
		var number string
		if queryRowContext(`SELECT id, COALESCE(project_id,0), COALESCE(change_number,'') FROM change_requests WHERE id=$1 OR LOWER(change_number)=LOWER($2)`, id, strings.TrimSpace(raw)).Scan(&id, &projectID, &number) != nil {
			return nil, fmt.Errorf("That change was not found in your authorized projects.")
		}
		if !vulnProjectVisibleToUser(userID, projectID) {
			return nil, fmt.Errorf("That change was not found in your authorized projects.")
		}
		return &vulnOpsLink{Kind: "change", ID: id, Label: firstNonEmpty(number, formatChangeNumber(id))}, nil
	case "incident":
		var projectID int
		var number string
		if queryRowContext(`SELECT id, COALESCE(project_id,0), COALESCE(incident_number,'') FROM request_incidents WHERE id=$1 OR LOWER(incident_number)=LOWER($2)`, id, strings.TrimSpace(raw)).Scan(&id, &projectID, &number) != nil {
			return nil, fmt.Errorf("That incident was not found in your authorized projects.")
		}
		if !vulnProjectVisibleToUser(userID, projectID) {
			return nil, fmt.Errorf("That incident was not found in your authorized projects.")
		}
		return &vulnOpsLink{Kind: "incident", ID: id, Label: firstNonEmpty(number, formatIncidentNumber(id))}, nil
	case "ticket":
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil {
			return nil, fmt.Errorf("That ticket was not found in your authorized projects.")
		}
		projectID := 0
		if req.ProjectID != nil {
			projectID = *req.ProjectID
		}
		if !vulnProjectVisibleToUser(userID, projectID) {
			return nil, fmt.Errorf("That ticket was not found in your authorized projects.")
		}
		return &vulnOpsLink{Kind: "ticket", ID: req.ID, Label: formatVulnTicketNumber(req.ID)}, nil
	default:
		return nil, fmt.Errorf("Link a change, incident, or ticket. That does not mark the finding Fixed.")
	}
}

func applyVulnFindingLinks(userID, findingID int, changeRef, incidentRef, ticketRef string, changeID, incidentID, ticketID int) (string, error) {
	updates := []string{}
	if changeRef != "" || changeID > 0 {
		link, err := resolveVulnOpsLink(userID, "change", changeRef, changeID)
		if err != nil {
			return "", err
		}
		if link != nil {
			_, _ = execContext(`UPDATE vuln_findings SET linked_change_id=$2, change_ref=CASE WHEN $3='' THEN change_ref ELSE $3 END WHERE id=$1`, findingID, link.ID, link.Label)
			updates = append(updates, "change "+link.Label)
		}
	}
	if incidentRef != "" || incidentID > 0 {
		link, err := resolveVulnOpsLink(userID, "incident", incidentRef, incidentID)
		if err != nil {
			return "", err
		}
		if link != nil {
			_, _ = execContext(`UPDATE vuln_findings SET linked_incident_id=$2 WHERE id=$1`, findingID, link.ID)
			updates = append(updates, "incident "+link.Label)
		}
	}
	if ticketRef != "" || ticketID > 0 {
		link, err := resolveVulnOpsLink(userID, "ticket", ticketRef, ticketID)
		if err != nil {
			return "", err
		}
		if link != nil {
			_, _ = execContext(`UPDATE vuln_findings SET linked_ticket_id=$2 WHERE id=$1`, findingID, link.ID)
			updates = append(updates, "ticket "+link.Label)
		}
	}
	if len(updates) == 0 {
		return "", nil
	}
	return "Linked " + strings.Join(updates, ", ") + ". Linked work is not Fixed.", nil
}

func attachVulnFindingLinks(item *vulnFindingView) {
	if item == nil {
		return
	}
	if item.LinkedChangeID > 0 {
		item.LinkedChange = firstNonEmpty(item.ChangeRef, formatChangeNumber(item.LinkedChangeID))
	}
	if item.LinkedIncidentID > 0 {
		item.LinkedIncident = formatIncidentNumber(item.LinkedIncidentID)
	}
	if item.LinkedTicketID > 0 {
		item.LinkedTicket = formatVulnTicketNumber(item.LinkedTicketID)
	}
}

func loadVulnFindingsView(userID int) json.RawMessage {
	if DB == nil || userID <= 0 {
		return json.RawMessage("{}")
	}
	views, err := listSavedFilterViews(userID, vulnFindingsViewScope)
	if err != nil || len(views) == 0 {
		return json.RawMessage("{}")
	}
	for _, view := range views {
		if strings.EqualFold(view.Name, vulnFindingsViewName) {
			return view.Filters
		}
	}
	return views[0].Filters
}

func saveVulnFindingsView(userID int, filters json.RawMessage) error {
	_, err := upsertSavedFilterView(userID, vulnFindingsViewScope, vulnFindingsViewName, filters)
	return err
}

func vulnScanIsAutomatic(trigger string) bool {
	t := strings.ToLower(strings.TrimSpace(trigger))
	return t == "schedule" || t == "push"
}

func vulnExportOwner(owner string) string {
	owner = strings.TrimSpace(owner)
	if owner == "" || strings.Contains(owner, "@") {
		return ""
	}
	return owner
}

func vulnCampaignExportFilename(canonical string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(canonical) {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('-')
	}
	safe := strings.Trim(b.String(), "-")
	if safe == "" {
		safe = "campaign"
	}
	return safe + "-open-occurrences.csv"
}

func csvCell(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func vulnCampaignExportRows(userID int, canonical string) []map[string]any {
	canonical = strings.TrimSpace(canonical)
	out := []map[string]any{}
	if canonical == "" {
		return out
	}
	for _, campaign := range listVulnCampaigns(userID) {
		id, _ := campaign["canonical_id"].(string)
		if !strings.EqualFold(strings.TrimSpace(id), canonical) {
			continue
		}
		occs, _ := campaign["occurrences"].([]map[string]any)
		for _, occ := range occs {
			out = append(out, map[string]any{
				"advisory":   id,
				"repository": csvCell(occ["repository"]),
				"package":    csvCell(occ["package_name"]),
				"version":    csvCell(occ["installed_version"]),
				"owner":      vulnExportOwner(csvCell(occ["owner"])),
				"due_at":     csvCell(occ["due_at"]),
			})
		}
		break
	}
	return out
}

func renderVulnCampaignCSV(rows []map[string]any) string {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{"advisory", "repository", "package", "version", "owner", "due_at"})
	for _, row := range rows {
		_ = writer.Write([]string{
			csvCell(row["advisory"]),
			csvCell(row["repository"]),
			csvCell(row["package"]),
			csvCell(row["version"]),
			vulnExportOwner(csvCell(row["owner"])),
			csvCell(row["due_at"]),
		})
	}
	writer.Flush()
	return buf.String()
}
