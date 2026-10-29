package main

import (
	"net/http"
	"strings"
	"time"
)

const integrationStaleHours = 24

type integrationAction struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type integrationConnector struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	State         string             `json:"state"`
	Source        string             `json:"source,omitempty"`
	LastSuccessAt *time.Time         `json:"last_success_at,omitempty"`
	FailedJobs    int                `json:"failed_jobs"`
	Detail        string             `json:"detail,omitempty"`
	Action        *integrationAction `json:"action,omitempty"`
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
	families := collectIntegrationFamilies(userID, grants)
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"families": families,
		"note":     "Empty successful collection is No findings. Missing telemetry is Unknown, never Healthy. A public advisory is not proof of repository exposure. Refreshing this page does not pull newer provider billing data.",
	})
}

func collectIntegrationFamilies(userID int, grants sectionGrants) []integrationFamily {
	out := []integrationFamily{}
	if grants.Operations {
		out = append(out, integrationJiraFamily())
	}
	if grants.Infrastructure {
		out = append(out, integrationGitHubFamily())
	}
	if grants.Cost {
		out = append(out, integrationBillingFamily(userID))
	}
	if grants.Security {
		out = append(out, integrationScannerFamily(userID))
	}
	if grants.Daily || grants.Operations {
		out = append(out, integrationObservabilityFamily())
	}
	return out
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
		connectors = append(connectors, integrationConnector{
			ID: "jira-" + itoa(conn.ID), Name: firstNonEmpty(conn.Name, conn.SiteName, "Jira"),
			State: state, Source: "Jira Cloud", LastSuccessAt: conn.LastSuccessAt,
			FailedJobs: failedByConn, Detail: detail, Action: action,
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
			State: state, Source: "GitHub", LastSuccessAt: last, FailedJobs: boolToCount(failed),
			Detail: integrationGitHubDetail(state), Action: itemAction,
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

func integrationBillingFamily(userID int) integrationFamily {
	action := &integrationAction{Label: "Import labelled CUR 2.0", Href: "/cost/configuration"}
	conns, err := listCostConnections(userID)
	if err != nil {
		return integrationFamily{
			ID: "billing", Label: "Billing", Source: "AWS CUR 2.0", State: "failed",
			Detail: "Collection failed.", Action: action, Connectors: []integrationConnector{},
		}
	}
	return billingFamilyFrom(conns)
}

func billingFamilyFrom(conns []costConnection) integrationFamily {
	action := &integrationAction{Label: "Import labelled CUR 2.0", Href: "/cost/configuration"}
	connectors := []integrationConnector{}
	states := []string{}
	failedJobs := 0
	var latest *time.Time
	awsSeen := false
	for _, conn := range conns {
		if costDemoAccountID(conn.AccountID) {
			continue
		}
		provider := normalizeCloudProvider(conn.Provider)
		name := firstNonEmpty(conn.DisplayName, conn.AccountID, "Billing connection")
		if provider != "aws" {
			detail := "Not imported. GCP Cloud Billing export and Azure Cost Management are not ingested yet."
			if provider == "gcp" {
				detail = "Not imported. GCP Cloud Billing export is not ingested yet."
			} else if provider == "azure" {
				detail = "Not imported. Azure Cost Management is not ingested yet."
			}
			connectors = append(connectors, integrationConnector{
				ID: "billing-" + itoa(conn.ID), Name: name, State: "not_connected",
				Source: "Not imported", Detail: detail, Action: action,
			})
			states = append(states, "not_connected")
			continue
		}
		awsSeen = true
		failed := strings.EqualFold(conn.LastTestStatus, "failed")
		if failed {
			failedJobs++
		}
		connected := conn.LastIngestedAt != nil && !conn.LastIngestedAt.IsZero()
		state := integrationCollectionState(connected, failed, !connected, conn.LastIngestedAt, integrationStaleHours)
		if !connected && !failed {
			state = "not_connected"
		}
		detail := "Collection is manual labelled CUR 2.0. Incomplete stays Unknown, never $0. This product does not store billing credentials and does not pull billing automatically."
		if state == "stale" {
			detail = "Stale. Import a newer labelled window. Refreshing this page does not pull newer provider billing data."
		} else if state == "failed" {
			detail = "Collection failed. Test reads stored billed data. It does not pull newer provider billing."
		} else if state == "not_connected" {
			detail = "Not connected. Enable Cost, then import a labelled CUR 2.0 export."
		} else if state == "no_findings" {
			detail = "No findings."
		}
		itemAction := action
		if state == "stale" {
			itemAction = &integrationAction{Label: "Import a newer labelled window", Href: "/cost/configuration"}
		}
		connectors = append(connectors, integrationConnector{
			ID: "billing-" + itoa(conn.ID), Name: name, State: state, Source: "AWS CUR 2.0",
			LastSuccessAt: conn.LastIngestedAt, FailedJobs: boolToCount(failed), Detail: detail, Action: itemAction,
		})
		states = append(states, state)
		latest = integrationLatest(latest, conn.LastIngestedAt)
	}
	if len(connectors) == 0 {
		return integrationFamily{
			ID: "billing", Label: "Billing", Source: "AWS CUR 2.0", State: "not_connected",
			Detail: "Not connected. Enable Cost, then import a labelled CUR 2.0 export. Collection is manual.",
			Action: action, Connectors: []integrationConnector{},
		}
	}
	familyState := integrationWorstState(states...)
	detail := "Pilot: AWS uses labelled CUR 2.0 import. GCP and Azure stay Not imported. Refreshing this page does not pull newer provider billing data."
	familyAction := action
	if familyState == "stale" {
		familyAction = &integrationAction{Label: "Import a newer labelled window", Href: "/cost/configuration"}
		detail = "Stale. Import a newer labelled window."
	} else if familyState == "failed" {
		detail = integrationFailedJobsDetail(failedJobs)
	} else if familyState == "not_connected" && !awsSeen {
		detail = "Not imported."
	} else if familyState == "not_connected" {
		detail = "Not connected. Import a labelled CUR 2.0 export."
	} else if familyState == "no_findings" {
		detail = "No findings."
	}
	return integrationFamily{
		ID: "billing", Label: "Billing", Source: "AWS CUR 2.0", State: familyState,
		LastSuccessAt: latest, FailedJobs: failedJobs, Detail: detail, Action: familyAction, Connectors: connectors,
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
		LastSuccessAt: last, Detail: detail, Action: action,
	}
	cloudAction := &integrationAction{Label: "Open cloud scan", Href: "/security/cloud-scan"}
	cloud := integrationConnector{
		ID: "scanner-cloud", Name: "Cloud scan", State: "not_connected", Source: "Cloud scan",
		Detail: "Coverage stays Unknown until a scan finishes. An exception is not cloud access.",
		Action: cloudAction,
	}
	familyState := integrationWorstState(state, cloud.State)
	familyAction := action
	familyDetail := detail
	if familyState == "not_connected" {
		familyAction = action
		familyDetail = "Not connected. A public advisory is not proof of repository exposure."
	}
	return integrationFamily{
		ID: "scanners", Label: "Scanners", Source: "Advisory feeds · Repository scan", State: familyState,
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
			State: state, Source: firstNonEmpty(conn.SourceType, "Observability"), LastSuccessAt: last,
			FailedJobs: boolToCount(failed), Detail: integrationGitHubDetail(state), Action: action,
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
