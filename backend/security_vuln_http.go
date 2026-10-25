package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func devopsSecurityVulnHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/security/"), "/")
	if path == "" {
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
		return
	}
	routeVulnSecurity(w, r, userID, path)
}

func securityVulnAliasHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	path := strings.Trim(r.URL.Path, "/")
	switch {
	case strings.HasPrefix(path, "api/security/vulnerabilities/"):
		routeVulnSecurity(w, r, userID, strings.TrimPrefix(path, "api/security/vulnerabilities/"))
	case path == "api/security/advisories" || strings.HasPrefix(path, "api/security/advisories/"):
		routeVulnSecurity(w, r, userID, "advisories"+strings.TrimPrefix(strings.TrimPrefix(path, "api/security/advisories"), "/"))
	default:
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	}
}

func routeVulnSecurity(w http.ResponseWriter, r *http.Request, userID int, path string) {
	parts := strings.Split(path, "/")
	switch {
	case path == "vulnerabilities/overview" || path == "overview":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, vulnOverview(userID))
	case path == "advisories" || (parts[0] == "advisories" && len(parts) == 1):
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		items, total, err := listVulnAdvisories(r.URL.Query().Get("severity"), r.URL.Query().Get("kev") == "1", limit, offset)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list advisories", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"advisories": items, "total": total, "status": "ok",
			"note": "Public intelligence. A Critical advisory is not proof that any registered repository is affected.",
		})
	case parts[0] == "advisories" && len(parts) == 2 && r.Method == http.MethodGet:
		id, _ := strconv.Atoi(parts[1])
		item, findings, err := getVulnAdvisory(id, userID)
		if err != nil || item == nil {
			writeAPIError(w, r, http.StatusNotFound, "advisory not found", nil)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"advisory": item, "findings": findings, "status": "ok",
			"note": "Public intelligence. Linked findings are repository matches, not a global exposure count.",
		})
	case path == "services":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w, r)
			return
		}
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		items, err := listVulnServiceRows(userID, projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list services", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"services": items, "status": "ok"})
	case path == "findings/bulk" && r.Method == http.MethodPost:
		handleVulnFindingsBulk(w, r, userID)
	case path == "findings" && r.Method == http.MethodGet:
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		serviceID, _ := strconv.Atoi(r.URL.Query().Get("service_id"))
		if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		items, err := listVulnFindings(userID, projectID, serviceID, r.URL.Query().Get("severity"), r.URL.Query().Get("lifecycle"), r.URL.Query().Get("match_source"))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list findings", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"findings": items, "status": "ok"})
	case parts[0] == "findings" && len(parts) >= 2:
		id, _ := strconv.Atoi(parts[1])
		if id <= 0 {
			writeAPIError(w, r, http.StatusNotFound, "finding not found", nil)
			return
		}
		item, events, err := getVulnFinding(userID, id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "finding not found", nil)
			return
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			_ = writeJSONResponse(w, http.StatusOK, map[string]any{
				"finding": item, "activity": events, "exceptions": listVulnExceptions(id), "status": "ok",
			})
			return
		}
		if len(parts) == 2 && r.Method == http.MethodPatch {
			handleVulnFindingPatch(w, r, userID, id, item)
			return
		}
		if len(parts) == 3 && parts[2] == "verify" && r.Method == http.MethodPost {
			jobID, err := enqueueVulnScanFromFinding(userID, id)
			if err != nil {
				writeAPIError(w, r, http.StatusConflict, err.Error(), err)
				return
			}
			_, _ = execContext(`UPDATE vuln_findings SET lifecycle='pending_verification', patch_state='merged_awaiting_scan' WHERE id=$1 AND lifecycle <> 'fixed'`, id)
			_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'verify','Rescan queued', $2)`, id, userID)
			_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"job_id": jobID, "status": "accepted"})
			return
		}
		if len(parts) == 3 && parts[2] == "exceptions" && r.Method == http.MethodGet {
			_ = writeJSONResponse(w, http.StatusOK, map[string]any{"exceptions": listVulnExceptions(id), "status": "ok"})
			return
		}
		if len(parts) == 3 && parts[2] == "exceptions" && r.Method == http.MethodPost {
			handleVulnException(w, r, userID, id)
			return
		}
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	case path == "scans" && r.Method == http.MethodGet:
		items, err := listVulnScans(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list scans", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"scans": items, "status": "ok"})
	case path == "scans" && r.Method == http.MethodPost:
		handleVulnScanCreate(w, r, userID)
	case parts[0] == "scans" && len(parts) == 2 && r.Method == http.MethodGet:
		id, _ := strconv.Atoi(parts[1])
		item, err := getVulnScan(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "scan not found", nil)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"scan": item, "log": listVulnScanEvents(id, item), "findings": listFindingsForScan(id), "status": "ok",
		})
	case path == "intelligence/sync" && r.Method == http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		go func() {
			_, _ = runVulnIntelligenceSync(userID)
		}()
		_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "accepted", "message": "Intelligence sync queued. The browser does not fetch vulnerability feeds."})
	case path == "sources" && r.Method == http.MethodGet:
		agents, _ := listVulnAgents(userID)
		repos := listVulnRepoConfigsProbed(userID, r.URL.Query().Get("probe") == "1")
		access := make([]map[string]any, 0, len(repos))
		for _, repo := range repos {
			access = append(access, map[string]any{
				"repository": repo.Repository, "access_state": repo.AccessState, "access_detail": repo.AccessDetail,
				"collection_mode": repo.CollectionMode,
			})
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"sources":               listVulnSources(),
			"hosted_collector":      vulnHostedCollectorConfigured(),
			"private_agents":        agents,
			"repository_access":     access,
			"status":                "ok",
			"hosted_collector_note": hostedCollectorNote(),
		})
	case path == "agents" && r.Method == http.MethodGet:
		agents, err := listVulnAgents(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list agents", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"agents": agents, "status": "ok"})
	case path == "agents" && r.Method == http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			Name      string `json:"name"`
			ProjectID int    `json:"project_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		item, bootstrap, err := createVulnAgent(userID, body.ProjectID, body.Name)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusCreated, map[string]any{
			"agent": item, "bootstrap_token": bootstrap, "status": "ok",
			"note": "This bootstrap token is shown once. The API stores only a hash.",
		})
	case path == "inventories" && r.Method == http.MethodPost:
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		handleVulnInventoryUpload(w, r, userID, 0, 0, raw)
	case path == "repositories" && r.Method == http.MethodGet:
		force := r.URL.Query().Get("probe") == "1"
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"repositories": listVulnRepoConfigsProbed(userID, force), "status": "ok"})
	case path == "repositories" && r.Method == http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			Repository string `json:"repository"`
			ProjectID  int    `json:"project_id"`
			Branch     string `json:"branch"`
			OwnerTeam  string `json:"owner_team"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		if body.ProjectID > 0 && !ensureProjectVisible(w, r, userID, body.ProjectID) {
			return
		}
		provider, owner, name := parseVulnRepo(body.Repository)
		if owner == "" {
			writeAPIError(w, r, http.StatusBadRequest, "repository must be owner/name or a GitHub, GitLab, or Bitbucket URL", nil)
			return
		}
		id, err := ensureVulnRepository(body.ProjectID, provider, owner, name, firstNonEmpty(body.Branch, "main"), body.OwnerTeam, userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "repository could not be registered", err)
			return
		}
		mode := "hosted"
		_ = queryRowContext(`SELECT COALESCE(NULLIF(collection_mode,''),'hosted') FROM vuln_repositories WHERE id=$1`, id).Scan(&mode)
		jobID := 0
		if mode == "hosted" {
			jobID, err = enqueueVulnScan(id, 0, body.ProjectID, userID, "register", "")
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "scan could not be queued", err)
				return
			}
			kickVulnScanWorker()
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"repository_id": id, "job_id": jobID, "collection_mode": mode, "status": "ok",
		})
	case parts[0] == "repositories" && len(parts) == 2 && r.Method == http.MethodPatch:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		id, _ := strconv.Atoi(parts[1])
		if id <= 0 {
			writeAPIError(w, r, http.StatusNotFound, "repository not found", nil)
			return
		}
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		if err := updateVulnRepoConfig(id, body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
	case path == "configuration" && r.Method == http.MethodGet:
		agents, _ := listVulnAgents(userID)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"repositories": listVulnRepoConfigsProbed(userID, false),
			"agents":       agents,
			"sources":      listVulnSources(),
			"steps":        []string{"connection", "repositories", "ownership", "policy", "alerts", "review"},
			"status":       "ok",
			"note":         "Tokens stay on the API as environment names. This wizard never displays secret values.",
		})
	case path == "campaigns" && r.Method == http.MethodGet:
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"campaigns": listVulnCampaigns(userID), "status": "ok"})
	case path == "campaigns/prs" && r.Method == http.MethodPost:
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			CanonicalID string `json:"canonical_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || strings.TrimSpace(body.CanonicalID) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "canonical_id is required", nil)
			return
		}
		urls, err := openVulnCampaignPRs(userID, body.CanonicalID)
		if err != nil {
			writeAPIError(w, r, http.StatusConflict, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{
			"pr_urls": urls, "status": "accepted",
			"note": "Draft proposals opened. OpsTrellis does not merge them and does not patch production.",
		})
	case path == "new-dependencies" && r.Method == http.MethodGet:
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"dependencies": listNewDependencies(userID), "status": "ok"})
	case path == "pr-comparisons" && r.Method == http.MethodGet:
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"comparisons": listVulnPRComparisons(userID), "status": "ok"})
	case path == "pr-comparisons" && r.Method == http.MethodPost:
		var body struct {
			RepositoryID int `json:"repository_id"`
			PRNumber     int `json:"pr_number"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.RepositoryID <= 0 || body.PRNumber <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "repository_id and pr_number are required", nil)
			return
		}
		id, err := runVulnPRComparison(userID, body.RepositoryID, body.PRNumber)
		if err != nil {
			writeAPIError(w, r, http.StatusConflict, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"comparison": getVulnPRComparison(userID, id), "status": "ok"})
	case parts[0] == "pr-comparisons" && len(parts) == 2 && r.Method == http.MethodGet:
		id, _ := strconv.Atoi(parts[1])
		item := getVulnPRComparison(userID, id)
		if item == nil {
			writeAPIError(w, r, http.StatusNotFound, "comparison not found", nil)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"comparison": item, "status": "ok"})
	case parts[0] == "services" && len(parts) == 2 && r.Method == http.MethodGet:
		id, _ := strconv.Atoi(parts[1])
		item := serviceVulnDetail(userID, id)
		if item == nil {
			writeAPIError(w, r, http.StatusNotFound, "service not found", nil)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, item)
	case path == "plans" && r.Method == http.MethodGet:
		items, err := listVulnPlans(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list patch plans", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"plans": items, "status": "ok"})
	case parts[0] == "plans" && len(parts) == 3 && parts[2] == "pr" && r.Method == http.MethodPost:
		id, _ := strconv.Atoi(parts[1])
		url, err := openVulnPatchPR(userID, id)
		if err != nil {
			writeAPIError(w, r, http.StatusConflict, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{
			"pr_url": url, "status": "accepted",
			"note": "Draft proposal opened. OpsTrellis does not merge, does not run package scripts, and does not patch production.",
		})
	case path == "deployments" && r.Method == http.MethodGet:
		serviceID, _ := strconv.Atoi(r.URL.Query().Get("service_id"))
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"deployments": listVulnDeployments(serviceID), "status": "ok"})
	case path == "deployments" && r.Method == http.MethodPost:
		var body struct {
			ServiceID   int             `json:"service_id"`
			Environment string          `json:"environment"`
			Digest      string          `json:"digest"`
			CommitSHA   string          `json:"commit_sha"`
			SBOM        json.RawMessage `json:"sbom"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		comps := []vulnComponent{}
		if len(body.SBOM) > 0 {
			parsed := parseSBOM("deployment.sbom.json", "", string(body.SBOM))
			comps = parsed.Components
		}
		id, err := recordVulnDeployment(userID, body.ServiceID, body.Environment, body.Digest, body.CommitSHA, comps)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{
			"deployment_id": id, "status": "accepted",
			"note": "Digest recorded. Images are not pulled. A digest without an SBOM cannot prove production is patched.",
		})
	default:
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	}
}

func handleVulnFindingPatch(w http.ResponseWriter, r *http.Request, userID, id int, current *vulnFindingView) {
	var body struct {
		Lifecycle string  `json:"lifecycle"`
		Owner     string  `json:"owner"`
		PRURL     string  `json:"pr_url"`
		ChangeRef string  `json:"change_ref"`
		Reason    string  `json:"reason"`
		DueAt     *string `json:"due_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	next, problem := nextLifecycle(current.Lifecycle, body.Lifecycle, body.Reason)
	if problem != "" {
		writeAPIError(w, r, http.StatusConflict, problem, nil)
		return
	}
	owner := strings.TrimSpace(body.Owner)
	if owner == "" {
		owner = current.Owner
	}
	pr := strings.TrimSpace(body.PRURL)
	change := strings.TrimSpace(body.ChangeRef)
	patchState := current.PatchState
	if pr != "" && patchState != vulnPatchRepoOK {
		patchState = vulnPatchPRLinked
		if next == vulnLifeOpen {
			next = vulnLifeRemediate
		}
	}
	keepDue := body.DueAt == nil
	var due sql.NullTime
	if body.DueAt != nil {
		if parsed, ok := parseVulnDueTime(*body.DueAt); ok {
			due = parsed
		}
	}
	_, err := execContext(`
		UPDATE vuln_findings SET lifecycle=$2, owner=$3, pr_url=CASE WHEN $4='' THEN pr_url ELSE $4 END,
			change_ref=CASE WHEN $5='' THEN change_ref ELSE $5 END, patch_state=$6,
			due_at=CASE WHEN $7 THEN due_at ELSE $8 END
		WHERE id=$1
	`, id, next, owner, pr, change, patchState, keepDue, due)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "finding could not be updated", err)
		return
	}
	detail := firstNonEmpty(body.Reason, "Updated to "+next)
	_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'update',$2,$3)`, id, detail, userID)
	item, events, _ := getVulnFinding(userID, id)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"finding": item, "activity": events, "status": "ok"})
}

func parseVulnDueTime(raw string) (sql.NullTime, bool) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.EqualFold(value, "none") {
		return sql.NullTime{}, true
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return sql.NullTime{Time: parsed.UTC(), Valid: true}, true
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return sql.NullTime{Time: parsed.UTC(), Valid: true}, true
	}
	return sql.NullTime{}, false
}

func handleVulnFindingsBulk(w http.ResponseWriter, r *http.Request, userID int) {
	var body struct {
		IDs       []int   `json:"ids"`
		Lifecycle string  `json:"lifecycle"`
		Owner     string  `json:"owner"`
		DueAt     *string `json:"due_at"`
		Reason    string  `json:"reason"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.IDs) == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "ids are required", nil)
		return
	}
	if len(body.IDs) > 50 {
		writeAPIError(w, r, http.StatusBadRequest, "Bulk update is limited to 50 findings.", nil)
		return
	}
	want := strings.ToLower(strings.TrimSpace(body.Lifecycle))
	if want != "" && want != vulnLifeAcked && want != vulnLifeRemediate {
		writeAPIError(w, r, http.StatusConflict, "Bulk update is limited to acknowledged or in remediation. Fixed is never set here.", nil)
		return
	}
	updated := 0
	for _, id := range body.IDs {
		item, _, err := getVulnFinding(userID, id)
		if err != nil || item == nil {
			continue
		}
		next := item.Lifecycle
		if want != "" {
			var problem string
			next, problem = nextLifecycle(item.Lifecycle, want, body.Reason)
			if problem != "" {
				writeAPIError(w, r, http.StatusConflict, problem, nil)
				return
			}
		}
		owner := strings.TrimSpace(body.Owner)
		if owner == "" {
			owner = item.Owner
		}
		keepDue := body.DueAt == nil
		var due sql.NullTime
		if body.DueAt != nil {
			if parsed, ok := parseVulnDueTime(*body.DueAt); ok {
				due = parsed
			}
		}
		if _, err := execContext(`
			UPDATE vuln_findings SET lifecycle=$2, owner=$3, due_at=CASE WHEN $4 THEN due_at ELSE $5 END
			WHERE id=$1
		`, id, next, owner, keepDue, due); err != nil {
			continue
		}
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'update',$2,$3)`, id, firstNonEmpty(body.Reason, "Bulk update to "+next), userID)
		updated++
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"updated": updated, "status": "ok"})
}

func openVulnCampaignPRs(userID int, canonical string) ([]string, error) {
	canonical = strings.TrimSpace(canonical)
	campaigns := listVulnCampaigns(userID)
	var occ []map[string]any
	for _, item := range campaigns {
		if fmt.Sprint(item["canonical_id"]) != canonical {
			continue
		}
		raw, _ := item["occurrences"].([]map[string]any)
		occ = raw
		break
	}
	if len(occ) == 0 {
		return nil, fmt.Errorf("No open findings for that advisory.")
	}
	seen := map[int]bool{}
	urls := []string{}
	for _, row := range occ {
		planID, _ := row["plan_id"].(int)
		if planID <= 0 || seen[planID] {
			continue
		}
		seen[planID] = true
		url, err := openVulnPatchPR(userID, planID)
		if err != nil {
			return urls, err
		}
		urls = append(urls, url)
	}
	if len(urls) == 0 {
		return nil, fmt.Errorf("No patch plan with a known fix exists for this advisory yet.")
	}
	return urls, nil
}

func handleVulnException(w http.ResponseWriter, r *http.Request, userID, findingID int) {
	var body struct {
		Kind      string `json:"kind"`
		Reason    string `json:"reason"`
		Evidence  string `json:"evidence"`
		Issuer    string `json:"issuer"`
		ExpiresAt string `json:"expires_at"`
		Approver  int    `json:"approver_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if strings.TrimSpace(body.Reason) == "" || strings.TrimSpace(body.ExpiresAt) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "reason and expiry are required", nil)
		return
	}
	kind := strings.ToLower(strings.TrimSpace(body.Kind))
	if kind == "" {
		kind = "exception"
	}
	if kind != "exception" && kind != "vex_not_affected" && kind != "vex_mitigated" {
		writeAPIError(w, r, http.StatusBadRequest, "kind must be exception, vex_not_affected, or vex_mitigated", nil)
		return
	}
	expires, err := time.Parse("2006-01-02", strings.TrimSpace(body.ExpiresAt))
	if err != nil {
		expires, err = time.Parse(time.RFC3339, strings.TrimSpace(body.ExpiresAt))
	}
	if err != nil || !expires.After(time.Now().UTC()) {
		writeAPIError(w, r, http.StatusBadRequest, "expiry must be a future date", nil)
		return
	}
	status := "requested"
	detail := "Exception requested. A manager must activate it. This is not Fixed."
	manager := devopsUserIsManager(userID)
	if user, err := GetUserByID(userID); err == nil && user != nil && user.Role == "admin" {
		manager = true
	}
	if manager {
		status = "active"
		detail = "Time-limited exception recorded. This is not Fixed."
	}
	_, err = execContext(`
		INSERT INTO vuln_exceptions (finding_id, kind, reason, evidence, issuer, approver_id, expires_at, created_by, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, findingID, kind, strings.TrimSpace(body.Reason), strings.TrimSpace(body.Evidence), strings.TrimSpace(body.Issuer), body.Approver, expires.UTC(), userID, status)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "exception could not be saved", err)
		return
	}
	if status == "active" {
		lifecycle := vulnLifeAccepted
		switch kind {
		case "vex_not_affected":
			lifecycle = vulnLifeFalsePos
		case "vex_mitigated":
			lifecycle = vulnLifeMitigated
		}
		_, _ = execContext(`UPDATE vuln_findings SET lifecycle=$2 WHERE id=$1`, findingID, lifecycle)
	}
	_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'exception',$2,$3)`, findingID, detail, userID)
	item, events, _ := getVulnFinding(userID, findingID)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"finding": item, "activity": events, "exceptions": listVulnExceptions(findingID), "status": "ok"})
}

func handleVulnScanCreate(w http.ResponseWriter, r *http.Request, userID int) {
	var body struct {
		ServiceIDs    []int  `json:"service_ids"`
		RepositoryIDs []int  `json:"repository_ids"`
		Repository    string `json:"repository"`
		ProjectID     int    `json:"project_id"`
		Branch        string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	jobIDs := make([]int, 0, 1)
	if len(body.ServiceIDs) > 0 {
		seenRepo := map[int]bool{}
		for _, serviceID := range body.ServiceIDs {
			item, ok := loadVisibleService(w, r, userID, serviceID)
			if !ok {
				return
			}
			provider, owner, name := parseVulnRepo(item.Repo)
			if owner == "" {
				writeAPIError(w, r, http.StatusConflict, "Service "+item.Service+" has no source-control repository mapping.", nil)
				return
			}
			projectID := 0
			if item.ProjectID != nil {
				projectID = *item.ProjectID
			}
			repoID, err := ensureVulnRepository(projectID, provider, owner, name, firstNonEmpty(body.Branch, "main"), item.Team, userID)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "repository could not be registered", err)
				return
			}
			linkServiceRepo(item.ID, repoID, "")
			if seenRepo[repoID] {
				continue
			}
			seenRepo[repoID] = true
			jobID, err := enqueueVulnScan(repoID, item.ID, projectID, userID, "manual", idem)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "scan could not be queued", err)
				return
			}
			jobIDs = append(jobIDs, jobID)
		}
	} else if len(body.RepositoryIDs) > 0 {
		for _, repoID := range body.RepositoryIDs {
			if repoID <= 0 {
				writeAPIError(w, r, http.StatusBadRequest, "repository_ids must contain registered repository ids.", nil)
				return
			}
			var projectID int
			var enabled bool
			if err := queryRowContext(`SELECT COALESCE(project_id,0), enabled FROM vuln_repositories WHERE id=$1`, repoID).Scan(&projectID, &enabled); err != nil || !enabled {
				writeAPIError(w, r, http.StatusNotFound, "repository not found", nil)
				return
			}
			if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
				return
			}
			jobID, err := enqueueVulnScan(repoID, 0, projectID, userID, "manual", idem)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "scan could not be queued", err)
				return
			}
			jobIDs = append(jobIDs, jobID)
		}
	} else {
		provider, owner, name := parseVulnRepo(body.Repository)
		if owner == "" {
			writeAPIError(w, r, http.StatusBadRequest, "Select at least one service or a registered repository.", nil)
			return
		}
		if body.ProjectID > 0 && !ensureProjectVisible(w, r, userID, body.ProjectID) {
			return
		}
		repoID, err := ensureVulnRepository(body.ProjectID, provider, owner, name, firstNonEmpty(body.Branch, "main"), "", userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "repository could not be registered", err)
			return
		}
		jobID, err := enqueueVulnScan(repoID, 0, body.ProjectID, userID, "manual", idem)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "scan could not be queued", err)
			return
		}
		jobIDs = append(jobIDs, jobID)
	}
	seenJobs := map[int]bool{}
	uniqueJobs := make([]int, 0, len(jobIDs))
	for _, id := range jobIDs {
		if id > 0 && !seenJobs[id] {
			seenJobs[id] = true
			uniqueJobs = append(uniqueJobs, id)
		}
	}
	jobIDs = uniqueJobs
	if len(jobIDs) == 0 {
		writeAPIError(w, r, http.StatusConflict, "No scan was queued.", nil)
		return
	}
	statusURL := "/api/devops/security/scans/" + strconv.Itoa(jobIDs[0])
	kickVulnScanWorker()
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"job_id": jobIDs[0], "job_ids": jobIDs, "status_url": statusURL, "status": "accepted",
	})
}

func enqueueVulnScanFromFinding(userID, findingID int) (int, error) {
	item, _, err := getVulnFinding(userID, findingID)
	if err != nil {
		return 0, err
	}
	var repoID int
	if err := queryRowContext(`SELECT repo_id FROM vuln_findings WHERE id=$1`, findingID).Scan(&repoID); err != nil || repoID <= 0 {
		return 0, fmt.Errorf("repository is not registered")
	}
	return enqueueVulnScan(repoID, item.ServiceID, item.ProjectID, userID, "verify", "")
}
