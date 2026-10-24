package main

import (
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
	case path == "findings" && r.Method == http.MethodGet:
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		serviceID, _ := strconv.Atoi(r.URL.Query().Get("service_id"))
		if projectID > 0 && !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		items, err := listVulnFindings(userID, projectID, serviceID, r.URL.Query().Get("severity"), r.URL.Query().Get("lifecycle"))
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
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"scan": item, "status": "ok"})
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
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"sources":               listVulnSources(),
			"hosted_collector":      strings.TrimSpace(GitHubToken) != "",
			"private_agents":        agents,
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
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"repositories": listVulnRepoConfigs(userID), "status": "ok"})
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
		owner, name := parseGitHubRepo(body.Repository)
		if owner == "" {
			writeAPIError(w, r, http.StatusBadRequest, "repository must be owner/name", nil)
			return
		}
		id, err := ensureVulnRepository(body.ProjectID, owner, name, firstNonEmpty(body.Branch, "main"), body.OwnerTeam, userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "repository could not be registered", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"repository_id": id, "status": "ok"})
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
			"repositories": listVulnRepoConfigs(userID),
			"agents":       agents,
			"sources":      listVulnSources(),
			"steps":        []string{"connection", "repositories", "ownership", "policy", "alerts", "review"},
			"status":       "ok",
			"note":         "Tokens stay on the API as environment names. This wizard never displays secret values.",
		})
	case path == "campaigns" && r.Method == http.MethodGet:
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"campaigns": listVulnCampaigns(userID), "status": "ok"})
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

func hostedCollectorNote() string {
	if strings.TrimSpace(GitHubToken) != "" {
		return "Hosted collector is configured on the API."
	}
	return "Hosted collector is offline until GITHUB_TOKEN is set on the API. That name is stored as a secret reference, not shown here."
}

func handleVulnFindingPatch(w http.ResponseWriter, r *http.Request, userID, id int, current *vulnFindingView) {
	var body struct {
		Lifecycle string `json:"lifecycle"`
		Owner     string `json:"owner"`
		PRURL     string `json:"pr_url"`
		ChangeRef string `json:"change_ref"`
		Reason    string `json:"reason"`
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
	_, err := execContext(`
		UPDATE vuln_findings SET lifecycle=$2, owner=$3, pr_url=CASE WHEN $4='' THEN pr_url ELSE $4 END,
			change_ref=CASE WHEN $5='' THEN change_ref ELSE $5 END, patch_state=$6
		WHERE id=$1
	`, id, next, owner, pr, change, patchState)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "finding could not be updated", err)
		return
	}
	detail := firstNonEmpty(body.Reason, "Updated to "+next)
	_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'update',$2,$3)`, id, detail, userID)
	item, events, _ := getVulnFinding(userID, id)
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"finding": item, "activity": events, "status": "ok"})
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
		ServiceIDs []int  `json:"service_ids"`
		Repository string `json:"repository"`
		ProjectID  int    `json:"project_id"`
		Branch     string `json:"branch"`
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
			owner, name := parseGitHubRepo(item.Repo)
			if owner == "" {
				writeAPIError(w, r, http.StatusConflict, "Service "+item.Service+" has no GitHub repository mapping.", nil)
				return
			}
			projectID := 0
			if item.ProjectID != nil {
				projectID = *item.ProjectID
			}
			repoID, err := ensureVulnRepository(projectID, owner, name, firstNonEmpty(body.Branch, "main"), item.Team, userID)
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
	} else {
		owner, name := parseGitHubRepo(body.Repository)
		if owner == "" {
			writeAPIError(w, r, http.StatusBadRequest, "Select at least one service or a repository.", nil)
			return
		}
		if body.ProjectID > 0 && !ensureProjectVisible(w, r, userID, body.ProjectID) {
			return
		}
		repoID, err := ensureVulnRepository(body.ProjectID, owner, name, firstNonEmpty(body.Branch, "main"), "", userID)
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
	if len(jobIDs) == 0 {
		writeAPIError(w, r, http.StatusConflict, "No scan was queued.", nil)
		return
	}
	statusURL := "/api/devops/security/scans/" + strconv.Itoa(jobIDs[0])
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"job_id": jobIDs[0], "job_ids": jobIDs, "status_url": statusURL, "status": "accepted",
	})
}

func enqueueVulnScanFromFinding(userID, findingID int) (int, error) {
	item, _, err := getVulnFinding(userID, findingID)
	if err != nil {
		return 0, err
	}
	owner, name := parseGitHubRepo(item.Repo)
	if owner == "" {
		return 0, fmt.Errorf("finding repository is missing")
	}
	var repoID int
	if err := queryRowContext(`SELECT id FROM vuln_repositories WHERE owner=$1 AND name=$2`, owner, name).Scan(&repoID); err != nil {
		return 0, fmt.Errorf("repository is not registered")
	}
	return enqueueVulnScan(repoID, item.ServiceID, item.ProjectID, userID, "verify", "")
}
