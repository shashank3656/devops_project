package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const integrationStaleHours = 24

type integrationAction struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type integrationConnector struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	State            string             `json:"state"`
	Source           string             `json:"source,omitempty"`
	LastAttemptAt    *time.Time         `json:"last_attempt_at,omitempty"`
	LastSuccessAt    *time.Time         `json:"last_success_at,omitempty"`
	FailedJobs       int                `json:"failed_jobs"`
	Detail           string             `json:"detail,omitempty"`
	FailureReason    string             `json:"failure_reason,omitempty"`
	AffectedServices []string           `json:"affected_services,omitempty"`
	Recovery         string             `json:"recovery,omitempty"`
	Action           *integrationAction `json:"action,omitempty"`
}

type integrationFamily struct {
	ID            string                 `json:"id"`
	Label         string                 `json:"label"`
	State         string                 `json:"state"`
	Source        string                 `json:"source"`
	LastSuccessAt *time.Time             `json:"last_success_at,omitempty"`
	FailedJobs    int                    `json:"failed_jobs"`
	Detail        string                 `json:"detail,omitempty"`
	Action        *integrationAction     `json:"action,omitempty"`
	Connectors    []integrationConnector `json:"connectors"`
}

func integrationCollectionState(connected, failed, empty bool, last *time.Time, staleHours int) string {
	if failed {
		return "failed"
	}
	if !connected {
		return "not_connected"
	}
	if staleHours <= 0 {
		staleHours = integrationStaleHours
	}
	if last == nil || last.IsZero() {
		if empty {
			return "no_findings"
		}
		return "stale"
	}
	if time.Since(last.UTC()) > time.Duration(staleHours)*time.Hour {
		return "stale"
	}
	if empty {
		return "no_findings"
	}
	return "ok"
}

func integrationStateRank(state string) int {
	switch state {
	case "failed":
		return 5
	case "stale":
		return 4
	case "not_connected":
		return 3
	case "no_findings":
		return 2
	case "ok":
		return 1
	default:
		return 0
	}
}

func integrationWorstState(states ...string) string {
	worst := "ok"
	for _, state := range states {
		if integrationStateRank(state) > integrationStateRank(worst) {
			worst = state
		}
	}
	return worst
}

func integrationFamilyState(states ...string) string {
	worst := integrationWorstState(states...)
	current := 0
	missing := 0
	for _, state := range states {
		if state == "ok" || state == "no_findings" {
			current++
		}
		if state == "not_connected" {
			missing++
		}
	}
	if current > 0 && missing > 0 && worst != "failed" && worst != "stale" {
		return "partial"
	}
	return worst
}

func integrationCurrentSourceCount(states []string) (current, total int) {
	total = len(states)
	for _, state := range states {
		if state == "ok" || state == "no_findings" || state == "partial" {
			current++
		}
	}
	return current, total
}

func integrationLatest(times ...*time.Time) *time.Time {
	var latest *time.Time
	for _, item := range times {
		if item == nil || item.IsZero() {
			continue
		}
		stamp := item.UTC()
		if latest == nil || stamp.After(*latest) {
			copy := stamp
			latest = &copy
		}
	}
	return latest
}

func integrationHealthHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeAPIError(w, r, http.StatusMethodNotAllowed, "method not allowed", nil)
		return
	}
	userID, ok := requireSessionUser(w, r)
	if !ok {
		return
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		writeAPIError(w, r, http.StatusUnauthorized, "user not found", err)
		return
	}
	grants := sectionGrantsForUser(user)
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	families := collectIntegrationFamilies(userID, grants, projectID)
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"families":   families,
		"project_id": projectID,
		"scope":      integrationHealthScopeLabel(projectID),
		"note":       "Counts are individual connectors, not integration categories.",
	})
}

func integrationHealthScopeLabel(projectID int) string {
	if projectID > 0 {
		return "Selected project"
	}
	return "Organization-wide"
}

func collectIntegrationFamilies(userID int, grants sectionGrants, projectID int) []integrationFamily {
	out := []integrationFamily{}
	if grants.Operations {
		out = append(out, integrationJiraFamily())
	}
	if grants.Infrastructure {
		out = append(out, integrationGitHubFamily())
	}
	if grants.Cost {
		out = append(out, integrationBillingFamily(userID, projectID))
	}
	if grants.Security {
		out = append(out, integrationScannerFamily(userID))
	}
	if grants.Daily || grants.Operations {
		out = append(out, integrationObservabilityFamily())
	}
	for i := range out {
		out[i] = decorateIntegrationFamily(out[i])
	}
	return out
}

func integrationFailureReason(state string, failedJobs int) string {
	switch state {
	case "failed":
		return integrationFailedJobsDetail(failedJobs)
	case "stale":
		return "Last successful collection is older than 24 hours."
	case "not_connected":
		return "No connector is collecting."
	case "partial":
		return "Some sources are current and others are not."
	default:
		return ""
	}
}

func integrationRecoveryAction(state string, action *integrationAction) string {
	if action == nil {
		return "No recovery action."
	}
	label := strings.TrimSpace(action.Label)
	if label == "" {
		return "No recovery action."
	}
	switch state {
	case "failed":
		return label + ". Retry collection from that page."
	case "stale":
		return label + ". Run a collection if this source should still be current."
	case "not_connected":
		return label + "."
	case "partial":
		return label + ". Finish connecting the remaining sources."
	default:
		return label + "."
	}
}

func decorateConnector(item integrationConnector, familyLabel string) integrationConnector {
	if item.LastAttemptAt == nil {
		item.LastAttemptAt = item.LastSuccessAt
	}
	if len(item.AffectedServices) == 0 && strings.TrimSpace(familyLabel) != "" {
		item.AffectedServices = []string{familyLabel}
	}
	if item.FailureReason == "" {
		item.FailureReason = integrationFailureReason(item.State, item.FailedJobs)
	}
	if item.Recovery == "" {
		item.Recovery = integrationRecoveryAction(item.State, item.Action)
	}
	return item
}

func decorateIntegrationFamily(family integrationFamily) integrationFamily {
	for i := range family.Connectors {
		family.Connectors[i] = decorateConnector(family.Connectors[i], family.Label)
	}
	return family
}

func integrationJiraFamily() integrationFamily {
	actionConnect := &integrationAction{Label: "Connect Jira", Href: "/integrations/jira/onboard"}
	if DB == nil {
		return integrationFamily{
			ID: "jira", Label: "Jira", Source: "Jira Cloud", State: "failed",
			Detail: "Collection failed.", Action: actionConnect, Connectors: []integrationConnector{},
		}
	}
	conns, err := listJiraConnections()
	if err != nil {
		return integrationFamily{
			ID: "jira", Label: "Jira", Source: "Jira Cloud", State: "failed",
			Detail: "Collection failed.", Action: actionConnect, Connectors: []integrationConnector{},
		}
	}
	ops, _ := listJiraOperations(80)
	failedByConn := 0
	for _, op := range ops {
		if op.State == jiraOpFailed || op.State == jiraOpRetrying {
			failedByConn++
		}
	}
	if len(conns) == 0 {
		return integrationFamily{
			ID: "jira", Label: "Jira", Source: "Jira Cloud", State: "not_connected",
			Detail: "Not connected.", Action: actionConnect, FailedJobs: failedByConn, Connectors: []integrationConnector{},
		}
	}
	connectors := []integrationConnector{}
	states := []string{}
	var latest *time.Time
	for _, conn := range conns {
		failed := conn.AuthHealth == jiraHealthFailed || conn.AuthHealth == jiraHealthReauth || conn.SyncHealth == jiraHealthFailed || conn.State == jiraStateFailed
		connected := conn.State == jiraStateConnected || conn.AuthHealth == jiraHealthConnected || conn.SyncHealth == jiraHealthSynced || conn.SyncHealth == jiraHealthConnected
		state := integrationCollectionState(connected, failed, conn.SpaceCount == 0, conn.LastSuccessAt, integrationStaleHours)
		action := &integrationAction{Label: "Open Jira", Href: "/integrations/jira"}
		detail := integrationJiraDetail(state, conn, failedByConn)
		if conn.AuthHealth == jiraHealthReauth {
			action = &integrationAction{Label: "Reauthorize Jira", Href: "/integrations/jira/" + itoa(conn.ID)}
			detail = "Reauthorization required."
			state = "failed"
		} else if failedByConn > 0 || state == "failed" {
			action = &integrationAction{Label: "Review failed jobs", Href: "/integrations/jira?tab=activity"}
		} else if state == "not_connected" {
			action = actionConnect
		}
		var attempt *time.Time
		if !conn.UpdatedAt.IsZero() {
			stamp := conn.UpdatedAt.UTC()
			attempt = &stamp
		}
		connectors = append(connectors, integrationConnector{
			ID: "jira-" + itoa(conn.ID), Name: firstNonEmpty(conn.Name, conn.SiteName, "Jira"),
			State: state, Source: "Jira Cloud", LastAttemptAt: attempt, LastSuccessAt: conn.LastSuccessAt,
			FailedJobs: failedByConn, Detail: detail, Action: action, AffectedServices: []string{firstNonEmpty(conn.SiteName, "Jira")},
		})
		states = append(states, state)
		latest = integrationLatest(latest, conn.LastSuccessAt)
	}
	familyState := integrationWorstState(states...)
	action := &integrationAction{Label: "Open Jira", Href: "/integrations/jira"}
	detail := "Last successful collection is listed per connection."
	if familyState == "not_connected" {
		action = actionConnect
		detail = "Not connected."
	} else if familyState == "failed" || failedByConn > 0 {
		action = &integrationAction{Label: "Review failed jobs", Href: "/integrations/jira?tab=activity"}
		detail = integrationFailedJobsDetail(failedByConn)
	} else if familyState == "stale" {
		detail = "Stale. Last successful collection is older than 24 hours."
	} else if familyState == "no_findings" {
		detail = "No findings."
	}
	return integrationFamily{
		ID: "jira", Label: "Jira", Source: "Jira Cloud", State: familyState,
		LastSuccessAt: latest, FailedJobs: failedByConn, Detail: detail, Action: action, Connectors: connectors,
	}
}

func integrationJiraDetail(state string, conn jiraConnection, failedJobs int) string {
	if conn.AuthHealth == jiraHealthReauth {
		return "Reauthorization required."
	}
	if state == "failed" {
		return integrationFailedJobsDetail(failedJobs)
	}
	if state == "stale" {
		return "Stale. Open Jira and run a sync."
	}
	if state == "not_connected" {
		return "Not connected."
	}
	if state == "no_findings" {
		return "No findings."
	}
	return "Current."
}

func integrationGitHubFamily() integrationFamily {
	action := &integrationAction{Label: "Connect repository", Href: "/deploy-intelligence/onboard"}
	repos, err := listDeployIntelRepos()
	if err != nil {
		return integrationFamily{
			ID: "github", Label: "GitHub", Source: "GitHub", State: "failed",
			Detail: "Collection failed.", Action: action, Connectors: []integrationConnector{},
		}
	}
	if len(repos) == 0 {
		return integrationFamily{
			ID: "github", Label: "GitHub", Source: "GitHub", State: "not_connected",
			Detail: "Not connected.", Action: action, Connectors: []integrationConnector{},
		}
	}
	connectors := []integrationConnector{}
	states := []string{}
	failedJobs := 0
	var latest *time.Time
	for _, repo := range repos {
		access, fetched := githubAccessFromCache(repo.Owner, repo.Name)
		last := fetched
		if last == nil && !repo.UpdatedAt.IsZero() {
			stamp := repo.UpdatedAt.UTC()
			last = &stamp
		}
		failed := access == "failed"
		if failed {
			failedJobs++
		}
		connected := access == "connected" || (!failed && last != nil)
		state := integrationCollectionState(connected, failed, false, last, integrationStaleHours)
		href := "/deploy-intelligence/" + repo.Owner + "/" + repo.Name
		itemAction := &integrationAction{Label: "Open repository", Href: href}
		if state == "not_connected" || failed {
			itemAction = action
		}
		name := strings.Trim(repo.Owner+"/"+repo.Name, "/")
		connectors = append(connectors, integrationConnector{
			ID: "github-" + itoa(repo.ID), Name: firstNonEmpty(name, "Repository"),
			State: state, Source: "GitHub", LastAttemptAt: last, LastSuccessAt: last, FailedJobs: boolToCount(failed),
			Detail: integrationGitHubDetail(state), Action: itemAction, AffectedServices: []string{firstNonEmpty(name, "GitHub")},
		})
		states = append(states, state)
		latest = integrationLatest(latest, last)
	}
	familyState := integrationWorstState(states...)
	familyAction := &integrationAction{Label: "Open repositories", Href: "/deploy-intelligence"}
	detail := "Catalog last sync is listed per repository. Merge tracking stays a separate setup step."
	if familyState == "not_connected" {
		familyAction = action
		detail = "Not connected."
	} else if familyState == "failed" {
		familyAction = &integrationAction{Label: "Open repositories", Href: "/deploy-intelligence"}
		detail = integrationFailedJobsDetail(failedJobs)
	} else if familyState == "stale" {
		detail = "Stale. Last successful collection is older than 24 hours."
	}
	return integrationFamily{
		ID: "github", Label: "GitHub", Source: "GitHub", State: familyState,
		LastSuccessAt: latest, FailedJobs: failedJobs, Detail: detail, Action: familyAction, Connectors: connectors,
	}
}

func githubAccessFromCache(owner, name string) (string, *time.Time) {
	if cached, ok := githubInspectStore.Load(githubInspectKey(owner, name)); ok {
		item, valid := cached.(githubInspectCache)
		if !valid {
			return "", nil
		}
		at := item.At.UTC()
		return item.Access, &at
	}
	return "", nil
}

func integrationGitHubDetail(state string) string {
	switch state {
	case "failed":
		return "Collection failed."
	case "stale":
		return "Stale."
	case "not_connected":
		return "Not connected."
	case "no_findings":
		return "No findings."
	default:
		return "Current."
	}
}

func integrationBillingFamily(userID, projectID int) integrationFamily {
	curAction := &integrationAction{Label: "Import labelled CUR 2.0", Href: "/cost/configuration"}
	conns, err := listCostConnections(userID)
	if err != nil {
		return integrationFamily{
			ID: "billing", Label: "Billing", Source: "Billing", State: "failed",
			Detail: "Collection failed.", Action: curAction, Connectors: []integrationConnector{},
		}
	}
	if userID > 0 {
		conns = mergeCostTreeConnections(userID, conns)
	}
	return billingFamilyFrom(conns, projectID)
}

func billingFamilyFrom(conns []costConnection, projectID int) integrationFamily {
	curAction := &integrationAction{Label: "Import labelled CUR 2.0", Href: "/cost/configuration"}
	usable := []costConnection{}
	matchedProject := false
	for _, conn := range conns {
		if costDemoAccountID(conn.AccountID) {
			continue
		}
		if projectID > 0 && conn.ProjectID == projectID {
			matchedProject = true
		}
		usable = append(usable, conn)
	}
	orgWide := true
	if projectID > 0 && matchedProject {
		orgWide = false
		scoped := []costConnection{}
		for _, conn := range usable {
			if conn.ProjectID == projectID {
				scoped = append(scoped, conn)
			}
		}
		usable = scoped
	}
	connectors := []integrationConnector{}
	states := []string{}
	failedJobs := 0
	var latest *time.Time
	awsSeen := false
	providers := map[string]int{}
	for _, conn := range usable {
		provider := normalizeCloudProvider(conn.Provider)
		providers[provider]++
		name := firstNonEmpty(conn.DisplayName, conn.AccountID, "Billing connection")
		if orgWide {
			name = "Organization-wide · " + name
		}
		if provider != "aws" {
			detail := "Not imported. GCP Cloud Billing export and Azure Cost Management are not ingested yet."
			source := "Not imported"
			if provider == "gcp" {
				detail = "Not imported. GCP Cloud Billing export is not ingested yet."
				source = "GCP Cloud Billing"
			} else if provider == "azure" {
				detail = "Not imported. Azure Cost Management is not ingested yet."
				source = "Azure Cost Management"
			}
			connectors = append(connectors, integrationConnector{
				ID: "billing-" + itoa(conn.ID), Name: name, State: "not_connected",
				Source: source, Detail: detail, AffectedServices: []string{"Cost"},
			})
			states = append(states, "not_connected")
			continue
		}
		awsSeen = true
		if strings.TrimSpace(conn.AccountID) != "" {
			name = name + " · AWS account " + strings.TrimSpace(conn.AccountID)
		}
		failed := strings.EqualFold(conn.LastTestStatus, "failed")
		if failed {
			failedJobs++
		}
		connected := conn.LastIngestedAt != nil && !conn.LastIngestedAt.IsZero()
		state := integrationCollectionState(connected, failed, !connected, conn.LastIngestedAt, integrationStaleHours)
		if !connected && !failed {
			state = "not_connected"
		}
		detail := "AWS labelled CUR 2.0. Incomplete stays Unknown, never $0."
		if state == "stale" {
			detail = "Stale. Import a newer labelled window."
		} else if state == "failed" {
			detail = "Collection failed. Test reads stored billed data."
		} else if state == "not_connected" {
			detail = "Not connected. Import a labelled CUR 2.0 export."
		} else if state == "no_findings" {
			detail = "No findings."
		}
		itemAction := curAction
		if state == "stale" {
			itemAction = &integrationAction{Label: "Import a newer labelled window", Href: "/cost/configuration"}
		}
		var attempt *time.Time
		if !conn.UpdatedAt.IsZero() {
			stamp := conn.UpdatedAt.UTC()
			attempt = &stamp
		}
		connectors = append(connectors, integrationConnector{
			ID: "billing-" + itoa(conn.ID), Name: name, State: state, Source: "AWS CUR 2.0",
			LastAttemptAt: attempt, LastSuccessAt: conn.LastIngestedAt, FailedJobs: boolToCount(failed), Detail: detail, Action: itemAction,
			AffectedServices: []string{"Cost"},
		})
		states = append(states, state)
		latest = integrationLatest(latest, conn.LastIngestedAt)
	}
	source := billingFamilySource(providers, orgWide)
	if len(connectors) == 0 {
		detail := "Not connected."
		if projectID > 0 {
			detail = "No billed account is linked to this project."
		}
		var emptyAction *integrationAction
		if awsSeen || projectID == 0 {
			emptyAction = curAction
			detail = "Not connected. Enable Cost, then import a labelled CUR 2.0 export. Collection is manual."
		}
		return integrationFamily{
			ID: "billing", Label: "Billing", Source: source, State: "not_connected",
			Detail: detail, Action: emptyAction, Connectors: []integrationConnector{},
		}
	}
	familyState := integrationFamilyState(states...)
	detail := billingFamilyDetail(orgWide, awsSeen, familyState, failedJobs, providers)
	var familyAction *integrationAction
	if awsSeen {
		familyAction = curAction
		if familyState == "stale" {
			familyAction = &integrationAction{Label: "Import a newer labelled window", Href: "/cost/configuration"}
		}
	}
	return integrationFamily{
		ID: "billing", Label: "Billing", Source: source, State: familyState,
		LastSuccessAt: latest, FailedJobs: failedJobs, Detail: detail, Action: familyAction, Connectors: connectors,
	}
}

func billingFamilySource(providers map[string]int, orgWide bool) string {
	label := "Billing"
	if providers["aws"] > 0 && providers["gcp"] == 0 && providers["azure"] == 0 {
		label = "AWS CUR 2.0"
	} else if providers["gcp"] > 0 && providers["aws"] == 0 && providers["azure"] == 0 {
		label = "GCP Cloud Billing"
	} else if providers["azure"] > 0 && providers["aws"] == 0 && providers["gcp"] == 0 {
		label = "Azure Cost Management"
	} else if providers["aws"] > 0 || providers["gcp"] > 0 || providers["azure"] > 0 {
		label = "Billing"
	}
	if orgWide {
		return "Organization-wide · " + label
	}
	return label
}

func billingFamilyDetail(orgWide, awsSeen bool, familyState string, failedJobs int, _ map[string]int) string {
	scope := "Selected project."
	if orgWide {
		scope = "Organization-wide. This is not limited to the workspace project."
	}
	switch familyState {
	case "failed":
		return scope + " " + integrationFailedJobsDetail(failedJobs)
	case "stale":
		return scope + " Stale. Import a newer labelled window."
	case "partial":
		return scope + " Partially connected."
	case "not_connected":
		if !awsSeen {
			return scope + " Not imported."
		}
		return scope + " Not connected."
	case "no_findings":
		return scope + " No findings."
	default:
		return scope
	}
}

func integrationScannerFamily(userID int) integrationFamily {
	overview := vulnOverview(userID)
	intel, _ := overview["intelligence_synced_at"].(*string)
	var last *time.Time
	if intel != nil && strings.TrimSpace(*intel) != "" {
		if parsed, err := time.Parse(time.RFC3339, *intel); err == nil {
			stamp := parsed.UTC()
			last = &stamp
		}
	}
	scanned, _ := overview["scanned_repositories"].(int)
	crit, _ := overview["critical_findings"].(int)
	high, _ := overview["high_findings"].(int)
	hosted := vulnHostedCollectorConfigured()
	connected := scanned > 0 || hosted || last != nil
	empty := crit+high == 0
	state := integrationCollectionState(connected, false, empty, last, integrationStaleHours)
	if !connected {
		state = "not_connected"
	}
	action := &integrationAction{Label: "Open vulnerabilities", Href: "/security/vulnerabilities"}
	detail := "A public advisory is not proof of repository exposure. Empty coverage stays Unknown, never Secure."
	if state == "not_connected" {
		action = &integrationAction{Label: "Register a repository", Href: "/security/vulnerabilities"}
		detail = "Not connected. A feed is not repository coverage."
	} else if state == "stale" {
		detail = "Stale. Refresh intelligence from Vulnerabilities. A public advisory is not proof of repository exposure."
	} else if state == "no_findings" {
		detail = "No findings. Empty coverage stays Unknown, never Secure."
	} else if state == "failed" {
		detail = "Collection failed."
	}
	vuln := integrationConnector{
		ID: "scanner-vuln", Name: "Repository scan", State: state, Source: "Advisory feeds · Repository scan",
		LastAttemptAt: last, LastSuccessAt: last, Detail: detail, Action: action, AffectedServices: []string{"Vulnerabilities"},
	}
	cloudAction := &integrationAction{Label: "Open cloud scan", Href: "/security/cloud-scan"}
	cloud := integrationConnector{
		ID: "scanner-cloud", Name: "Cloud scan", State: "not_connected", Source: "Cloud scan",
		Detail: "Coverage stays Unknown until a scan finishes. An exception is not cloud access.",
		Action: cloudAction, AffectedServices: []string{"Cloud scan"},
	}
	familyState := integrationFamilyState(state, cloud.State)
	familyAction := action
	current, total := integrationCurrentSourceCount([]string{state, cloud.State})
	familyDetail := "Not connected."
	if familyState == "partial" {
		familyDetail = fmt.Sprintf("Partially connected — %d of %d sources current.", current, total)
	} else if familyState == "stale" {
		familyDetail = "Stale."
	} else if familyState == "failed" {
		familyDetail = "Collection failed."
	} else if familyState == "no_findings" {
		familyDetail = "No findings."
	} else if familyState == "ok" {
		familyDetail = "Current."
	}
	return integrationFamily{
		ID: "scanners", Label: "Scanners", Source: "Repository scan · Cloud scan", State: familyState,
		LastSuccessAt: last, Detail: familyDetail, Action: familyAction, Connectors: []integrationConnector{vuln, cloud},
	}
}

func integrationObservabilityFamily() integrationFamily {
	action := &integrationAction{Label: "Open SLOs", Href: "/slos"}
	connectors, err := listObservabilityConnectors(0)
	if err != nil {
		return integrationFamily{
			ID: "observability", Label: "Observability", Source: "Observability", State: "failed",
			Detail: "Collection failed.", Action: action, Connectors: []integrationConnector{},
		}
	}
	if len(connectors) == 0 {
		return integrationFamily{
			ID: "observability", Label: "Observability", Source: "Observability", State: "not_connected",
			Detail: "Not connected. Add a connector on SLOs. Missing telemetry is Unknown, never Healthy.",
			Action: action, Connectors: []integrationConnector{},
		}
	}
	items := []integrationConnector{}
	states := []string{}
	failedJobs := 0
	var latest *time.Time
	for _, conn := range connectors {
		failed := strings.EqualFold(conn.Status, "failed") || strings.EqualFold(conn.Status, "error")
		if failed {
			failedJobs++
		}
		var last *time.Time
		if conn.LastTestedAt != nil {
			if parsed, err := time.Parse(time.RFC3339, *conn.LastTestedAt); err == nil {
				stamp := parsed.UTC()
				last = &stamp
			}
		}
		connected := conn.Enabled && !failed
		state := integrationCollectionState(connected, failed, false, last, integrationStaleHours)
		if !conn.Enabled {
			state = "not_connected"
		}
		items = append(items, integrationConnector{
			ID: "obs-" + itoa(conn.ID), Name: firstNonEmpty(conn.Name, conn.SourceType, "Connector"),
			State: state, Source: firstNonEmpty(conn.SourceType, "Observability"), LastAttemptAt: last, LastSuccessAt: last,
			FailedJobs: boolToCount(failed), Detail: integrationGitHubDetail(state), Action: action,
			AffectedServices: []string{firstNonEmpty(conn.SourceType, "Observability")},
		})
		states = append(states, state)
		latest = integrationLatest(latest, last)
	}
	familyState := integrationWorstState(states...)
	detail := "Missing telemetry is Unknown, never Healthy."
	if familyState == "failed" {
		detail = integrationFailedJobsDetail(failedJobs)
	} else if familyState == "stale" {
		detail = "Stale. Test the connector on SLOs."
	} else if familyState == "not_connected" {
		detail = "Not connected."
	} else if familyState == "no_findings" {
		detail = "No findings."
	}
	return integrationFamily{
		ID: "observability", Label: "Observability", Source: "Observability", State: familyState,
		LastSuccessAt: latest, FailedJobs: failedJobs, Detail: detail, Action: action, Connectors: items,
	}
}

func integrationFailedJobsDetail(count int) string {
	if count <= 0 {
		return "Collection failed."
	}
	if count == 1 {
		return "1 failed job."
	}
	return itoa(count) + " failed jobs."
}

func boolToCount(value bool) int {
	if value {
		return 1
	}
	return 0
}
