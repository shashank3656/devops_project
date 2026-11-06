package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func jiraIntegrationsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireSessionUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/integrations/jira"), "/")
	parts := []string{}
	if path != "" {
		parts = strings.Split(path, "/")
	}
	switch {
	case len(parts) == 0 && r.Method == http.MethodGet:
		jiraOverviewHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "app" && r.Method == http.MethodGet:
		jiraGetOAuthAppHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "app" && (r.Method == http.MethodPut || r.Method == http.MethodPost):
		jiraSaveOAuthAppHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "connections" && r.Method == http.MethodGet:
		jiraListConnectionsHandler(w, r)
	case len(parts) == 1 && parts[0] == "connections" && r.Method == http.MethodPost:
		jiraCreateConnectionHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "connections":
		jiraConnectionHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "authorize" && r.Method == http.MethodPost:
		jiraStartAuthorizeHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "sites" && r.Method == http.MethodGet:
		jiraListSitesHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "select-site" && r.Method == http.MethodPost:
		jiraSelectSiteHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "discover-spaces" && r.Method == http.MethodGet:
		jiraDiscoverSpacesHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "spaces" && r.Method == http.MethodPost:
		jiraSelectSpacesHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "enable" && r.Method == http.MethodPost:
		jiraEnableConnectionHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "pause" && r.Method == http.MethodPost:
		jiraPauseConnectionHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "connections" && parts[2] == "sync-policy":
		jiraConnectionSyncPolicyHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 1 && parts[0] == "spaces" && r.Method == http.MethodGet:
		jiraListSpacesHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "spaces":
		jiraSpaceHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "access":
		jiraSpaceAccessHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "mappings":
		jiraSpaceMappingsHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "issue-types" && r.Method == http.MethodGet:
		jiraIssueTypesHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "create-meta" && r.Method == http.MethodGet:
		jiraCreateMetaHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "remediation-rules" && r.Method == http.MethodGet:
		jiraListRemediationRulesHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "spaces" && parts[2] == "remediation-rules" && r.Method == http.MethodPost:
		jiraSaveRemediationRuleHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 1 && parts[0] == "remediation-rules" && r.Method == http.MethodGet:
		jiraListRemediationRulesHandler(w, r, userID, 0)
	case len(parts) == 2 && parts[0] == "remediation-rules" && r.Method == http.MethodDelete:
		jiraDeleteRemediationRuleHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 3 && parts[0] == "remediation-rules" && parts[2] == "apply" && r.Method == http.MethodPost:
		jiraApplyRemediationRuleHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 1 && parts[0] == "suggestions" && r.Method == http.MethodGet:
		jiraSuggestionsHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "suggestions" && parts[1] == "dismiss" && r.Method == http.MethodPost:
		jiraDismissSuggestionHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "comments" && r.Method == http.MethodPost:
		jiraAddCommentHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "transitions" && r.Method == http.MethodGet:
		jiraListTransitionsHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "transitions" && r.Method == http.MethodPost:
		jiraTransitionHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "attachments" && r.Method == http.MethodPost:
		jiraAttachHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "bulk" && r.Method == http.MethodPost:
		jiraBulkHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "mappings" && r.Method == http.MethodDelete:
		jiraDeleteMappingHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 1 && parts[0] == "search" && r.Method == http.MethodGet:
		jiraSearchIssuesHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "links" && r.Method == http.MethodGet:
		jiraListLinksHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "links" && r.Method == http.MethodPost:
		jiraCreateLinkHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "links" && r.Method == http.MethodDelete:
		jiraDeleteLinkHandler(w, r, userID, atoiSafe(parts[1]))
	case len(parts) == 1 && parts[0] == "issues" && r.Method == http.MethodGet:
		jiraGetIssueHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "issues" && r.Method == http.MethodPost:
		jiraCreateIssueHandler(w, r, userID)
	case len(parts) == 1 && parts[0] == "activity" && r.Method == http.MethodGet:
		jiraActivityHandler(w, r, userID)
	case len(parts) == 2 && parts[0] == "operations" && r.Method == http.MethodGet:
		jiraGetOperationHandler(w, r, parts[1])
	case len(parts) == 1 && parts[0] == "teams" && r.Method == http.MethodGet:
		jiraTeamsHandler(w, r, userID)
	case len(parts) == 3 && parts[0] == "operations" && parts[2] == "retry" && r.Method == http.MethodPost:
		jiraRetryOperationHandler(w, r, userID, parts[1])
	default:
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	}
}

func jiraOverviewHandler(w http.ResponseWriter, r *http.Request, userID int) {
	conns, err := listJiraConnections()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "connections could not be loaded", err)
		return
	}
	spaces, _ := listJiraSpaces(0)
	visibleSpaces := []jiraSpace{}
	for _, space := range spaces {
		access, err := jiraAccessForSpace(userID, space.ID)
		if err != nil || !access.CanView {
			continue
		}
		space.CanView = access.CanView
		space.CanLink = access.CanLink
		space.CanCreate = access.CanCreate
		space.CanAdminister = access.CanAdminister
		visibleSpaces = append(visibleSpaces, space)
	}
	visibleSpaces = withJiraSpaceMappings(visibleSpaces)
	links, _ := listAllJiraIssueLinks(80)
	links = filterVisibleJiraLinks(userID, links)
	ops, _ := listJiraOperations(80)
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"oauth_ready": jiraOAuthConfigured(),
		"oauth_app":   jiraOAuthAppPublicView(userID),
		"provider":    jiraProviderCloud,
		"connections": conns,
		"spaces":      visibleSpaces,
		"linked_work": links,
		"activity":    ops,
		"note":        "Jira Data Center is not available in this release. One connection can include multiple permitted spaces. Issue identity is site ID plus issue ID.",
	})
}

func jiraListConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	conns, err := listJiraConnections()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "connections could not be loaded", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "connections": conns, "oauth_ready": jiraOAuthConfigured()})
}

func jiraGetOAuthAppHandler(w http.ResponseWriter, r *http.Request, userID int) {
	view := jiraOAuthAppPublicView(userID)
	if jiraJSONHasSecret(view) {
		writeAPIError(w, r, http.StatusInternalServerError, "oauth app view leaked a secret", nil)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "oauth_app": view})
}

func jiraSaveOAuthAppHandler(w http.ResponseWriter, r *http.Request, userID int) {
	if !jiraCanManageOAuthApp(userID) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change the Jira OAuth app", nil)
		return
	}
	var req struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		RedirectURL  string `json:"redirect_url"`
		Scopes       string `json:"scopes"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if _, err := saveJiraOAuthApp(userID, req.ClientID, req.ClientSecret, req.RedirectURL, req.Scopes); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	insertJiraAudit(0, userID, "oauth_app_saved", "", 0, "", "", "ok", "Jira OAuth app credentials stored")
	view := jiraOAuthAppPublicView(userID)
	if jiraJSONHasSecret(view) {
		writeAPIError(w, r, http.StatusInternalServerError, "oauth app view leaked a secret", nil)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"oauth_app": view,
		"note":      "Client ID and secret are stored encrypted on the API. They are not returned after save.",
	})
}

func jiraCreateConnectionHandler(w http.ResponseWriter, r *http.Request, userID int) {
	if !jiraOAuthConfigured() {
		writeAPIError(w, r, http.StatusConflict, "Jira OAuth is not configured. Onboard the Jira app with a client ID and secret first.", nil)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)
	conn, err := insertJiraConnection(req.Name, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "connection could not be created", err)
		return
	}
	insertJiraAudit(conn.ID, userID, "connection_created", "", 0, "", "", "ok", conn.Name)
	payload := map[string]any{
		"status":     "ok",
		"connection": conn,
		"requested_access": map[string]any{
			"scopes":      jiraOAuthScopes(),
			"explanation": "OpsTrellis will request read and write access to Jira work the connection owner can already see, plus offline access so the connection can refresh without storing a password. The owner’s Jira access is not granted to every portal user. Space grants still control who can view, link, create, or administer.",
		},
	}
	if url, err := startJiraAuthorization(conn.ID, userID); err == nil && url != "" {
		payload["authorize_url"] = url
	}
	writeJSONResponse(w, http.StatusCreated, payload)
}

func startJiraAuthorization(connectionID, userID int) (string, error) {
	if !jiraOAuthConfigured() {
		return "", fmt.Errorf("Jira OAuth is not configured. Onboard the Jira app with a client ID and secret first.")
	}
	conn, err := getJiraConnection(connectionID)
	if err != nil {
		return "", err
	}
	state := "jira-" + randomHex(16)
	if err := saveJiraOAuthState(state, connectionID, userID, time.Now().Add(15*time.Minute)); err != nil {
		return "", err
	}
	_ = updateJiraConnectionState(connectionID, jiraStateAuthorizing, jiraHealthSyncing, conn.SyncHealth, conn.Enabled, "")
	return jiraAuthorizeURL(state), nil
}

func jiraConnectionHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	conn, err := getJiraConnection(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "connection not found", err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		spaces, _ := listJiraSpaces(id)
		mappings := []jiraMapping{}
		for _, space := range spaces {
			m, _ := listJiraMappings(space.ID)
			mappings = append(mappings, m...)
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":          "ok",
			"connection":      conn,
			"spaces":          spaces,
			"mappings":        mappings,
			"can_manage":      jiraCanManageConnection(userID, conn),
			"checks":          jiraConnectionChecks(conn, spaces),
			"ready_to_enable": jiraReadyToEnable(conn, spaces),
			"setup_step":      jiraSetupStep(conn, spaces),
			"webhook":         jiraWebhookView(conn.ID),
			"sync_policy":     loadJiraSyncPolicy(conn.ID),
			"ownership":       jiraFieldOwnership(),
		})
	case http.MethodPatch:
		if !jiraCanManageConnection(userID, conn) {
			writeAPIError(w, r, http.StatusForbidden, "you cannot change this connection", nil)
			return
		}
		var req struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)
		if strings.TrimSpace(req.Name) != "" {
			_, _ = DB.Exec(`UPDATE jira_connections SET name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, strings.TrimSpace(req.Name))
		}
		updated, _ := getJiraConnection(id)
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "connection": updated})
	case http.MethodDelete:
		if !jiraCanManageConnection(userID, conn) {
			writeAPIError(w, r, http.StatusForbidden, "you cannot disconnect this connection", nil)
			return
		}
		deleteJiraWebhooks(id)
		if err := disconnectJiraConnection(id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "disconnect failed", err)
			return
		}
		insertJiraAudit(id, userID, "disconnect", "", 0, conn.CloudID, "", "paused", "Synchronization stopped. Jira issues were not deleted.")
		updated, _ := getJiraConnection(id)
		writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":     "ok",
			"connection": updated,
			"note":       "Synchronization stopped. Linked portal records and Jira issues were kept.",
		})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func jiraStartAuthorizeHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	conn, err := getJiraConnection(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "connection not found", err)
		return
	}
	if !jiraCanManageConnection(userID, conn) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot authorize this connection", nil)
		return
	}
	url, err := startJiraAuthorization(id, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"authorize_url":    url,
		"requested_access": jiraOAuthScopes(),
		"explanation":      "You will sign in to Atlassian as the connection owner. Only Jira work this account can access is available, and portal team grants still apply.",
	})
}

func jiraOAuthCallbackHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	q := r.URL.Query()
	if msg := strings.TrimSpace(q.Get("error")); msg != "" {
		http.Redirect(w, r, jiraFrontendRedirect(0, url.Values{"error": []string{"Jira authorization was cancelled"}}), http.StatusFound)
		return
	}
	connectionID, userID, err := consumeJiraOAuthState(q.Get("state"))
	if err != nil {
		http.Redirect(w, r, jiraFrontendRedirect(0, url.Values{"error": []string{"This Jira authorization expired. Start again from Integrations."}}), http.StatusFound)
		return
	}
	tokens, err := jiraExchangeCode(q.Get("code"))
	if err != nil {
		_ = updateJiraConnectionState(connectionID, jiraStateFailed, jiraHealthFailed, jiraHealthFailed, false, "Authorization failed")
		http.Redirect(w, r, jiraFrontendRedirect(connectionID, url.Values{"error": []string{"Jira authorization failed"}}), http.StatusFound)
		return
	}
	if err := upsertJiraConnectionSecrets(connectionID, tokens.Access, tokens.Refresh, tokens.Type, tokens.Expiry); err != nil {
		http.Redirect(w, r, jiraFrontendRedirect(connectionID, url.Values{"error": []string{"Credentials could not be stored"}}), http.StatusFound)
		return
	}
	_, _ = DB.Exec(`UPDATE jira_connections SET owner_user_id = $2, scopes = $3, auth_health = $4, state = $5, last_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
		connectionID, userID, jiraOAuthScopes(), jiraHealthConnected, jiraStateConnected)
	insertJiraAudit(connectionID, userID, "authorized", "", 0, "", "", "ok", "")
	next := url.Values{"select_site": []string{"1"}}
	if sites, err := jiraAPI.AccessibleResources(tokens.Access); err == nil && len(sites) == 1 {
		_ = updateJiraConnectionSite(connectionID, sites[0].ID, sites[0].URL, sites[0].Name)
		if me, err := jiraAPI.GetMyself(tokens.Access, sites[0].ID); err == nil {
			saveJiraOwnerAccountID(connectionID, me.AccountID)
		}
		next = url.Values{"select_spaces": []string{"1"}}
	}
	http.Redirect(w, r, jiraFrontendRedirect(connectionID, next), http.StatusFound)
}

func jiraMustManage(w http.ResponseWriter, r *http.Request, userID, connectionID int) (jiraConnection, bool) {
	conn, err := getJiraConnection(connectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "connection not found", err)
		return conn, false
	}
	if !jiraCanManageConnection(userID, conn) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot administer this connection", nil)
		return conn, false
	}
	return conn, true
}

func jiraListSitesHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	if _, ok := jiraMustManage(w, r, userID, id); !ok {
		return
	}
	token, err := jiraValidAccessToken(id)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	sites, err := jiraAPI.AccessibleResources(token)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "sites": sites})
}

func jiraSelectSiteHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	if _, ok := jiraMustManage(w, r, userID, id); !ok {
		return
	}
	var req struct {
		CloudID string `json:"cloud_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil || strings.TrimSpace(req.CloudID) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "cloud_id is required", err)
		return
	}
	token, err := jiraValidAccessToken(id)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	sites, err := jiraAPI.AccessibleResources(token)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	var selected *jiraRemoteSite
	for i := range sites {
		if sites[i].ID == req.CloudID {
			selected = &sites[i]
			break
		}
	}
	if selected == nil {
		writeAPIError(w, r, http.StatusForbidden, "that Jira site is not available to the connection owner", nil)
		return
	}
	if err := updateJiraConnectionSite(id, selected.ID, selected.URL, selected.Name); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "site could not be stored", err)
		return
	}
	if me, err := jiraAPI.GetMyself(token, selected.ID); err == nil {
		saveJiraOwnerAccountID(id, me.AccountID)
	}
	insertJiraAudit(id, userID, "select_site", "", 0, selected.ID, "", "ok", selected.Name)
	conn, _ := getJiraConnection(id)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "connection": conn})
}

func jiraDiscoverSpacesHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	if _, ok := jiraMustManage(w, r, userID, id); !ok {
		return
	}
	conn, _ := getJiraConnection(id)
	if strings.TrimSpace(conn.CloudID) == "" {
		writeAPIError(w, r, http.StatusConflict, "select a Jira site first", nil)
		return
	}
	token, err := jiraValidAccessToken(id)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	spaces, err := jiraAPI.ListProjects(token, conn.CloudID, r.URL.Query().Get("q"))
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "spaces": spaces})
}

func jiraSelectSpacesHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	if _, ok := jiraMustManage(w, r, userID, id); !ok {
		return
	}
	var req struct {
		Spaces []jiraRemoteSpace `json:"spaces"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<18)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	saved := []jiraSpace{}
	for _, remote := range req.Spaces {
		if strings.TrimSpace(remote.ID) == "" {
			continue
		}
		space, err := upsertJiraSpace(id, remote)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "space could not be saved", err)
			return
		}
		saved = append(saved, space)
	}
	insertJiraAudit(id, userID, "select_spaces", "", 0, "", "", "ok", fmt.Sprintf("%d spaces", len(saved)))
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "spaces": saved})
}

func jiraEnableConnectionHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	conn, ok := jiraMustManage(w, r, userID, id)
	if !ok {
		return
	}
	if strings.TrimSpace(conn.CloudID) == "" {
		writeAPIError(w, r, http.StatusConflict, "select a Jira site before enabling", nil)
		return
	}
	spaces, _ := listJiraSpaces(id)
	if !jiraReadyToEnable(conn, spaces) {
		writeAPIError(w, r, http.StatusConflict, "select a Jira site and at least one space, then enable. Reauthorize first if credentials expired.", nil)
		return
	}
	if err := updateJiraConnectionState(id, jiraStateConnected, jiraHealthConnected, jiraHealthQueued, true, ""); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "connection could not be enabled", err)
		return
	}
	insertJiraAudit(id, userID, "enable", "", 0, conn.CloudID, "", "ok", "Initial collection is limited to linked issues.")
	go ensureJiraWebhooks(id)
	updated, _ := getJiraConnection(id)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "connection": updated})
}

func jiraPauseConnectionHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	if _, ok := jiraMustManage(w, r, userID, id); !ok {
		return
	}
	if err := updateJiraConnectionState(id, jiraStatePaused, jiraHealthPaused, jiraHealthPaused, false, "Paused"); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "connection could not be paused", err)
		return
	}
	insertJiraAudit(id, userID, "pause", "", 0, "", "", "ok", "")
	go deleteJiraWebhooks(id)
	updated, _ := getJiraConnection(id)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "connection": updated, "note": "Synchronization paused. Linked records and Jira issues were kept."})
}

func jiraListSpacesHandler(w http.ResponseWriter, r *http.Request, userID int) {
	spaces, err := listJiraSpaces(atoiSafe(r.URL.Query().Get("connection_id")))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "spaces could not be loaded", err)
		return
	}
	visible := []jiraSpace{}
	for _, space := range spaces {
		access, err := jiraAccessForSpace(userID, space.ID)
		if err != nil || !access.CanView {
			continue
		}
		space.CanView, space.CanLink, space.CanCreate, space.CanAdminister = access.CanView, access.CanLink, access.CanCreate, access.CanAdminister
		visible = append(visible, space)
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "spaces": withJiraSpaceMappings(visible)})
}

func jiraSpaceHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	space, err := getJiraSpace(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	access, err := jiraAccessForSpace(userID, space.ID)
	if err != nil || !access.CanView {
		writeAPIError(w, r, http.StatusForbidden, "you cannot view this Jira space", nil)
		return
	}
	if r.Method == http.MethodPatch {
		if !access.CanAdminister {
			writeAPIError(w, r, http.StatusForbidden, "you cannot change this Jira space", nil)
			return
		}
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)
		if req.Enabled != nil {
			_ = setJiraSpaceEnabled(id, *req.Enabled)
		}
		space, _ = getJiraSpace(id)
	}
	mappings, _ := listJiraMappings(id)
	grants, _ := listJiraSpaceAccess(id)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "space": space, "mappings": mappings, "access": grants, "permissions": access})
}

func jiraSpaceAccessHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	access, err := jiraAccessForSpace(userID, id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	if r.Method == http.MethodGet {
		if !access.CanView {
			writeAPIError(w, r, http.StatusForbidden, "you cannot view this Jira space", nil)
			return
		}
		grants, _ := listJiraSpaceAccess(id)
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "access": grants})
		return
	}
	if r.Method != http.MethodPut {
		writeMethodNotAllowed(w, r)
		return
	}
	if !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change access for this space", nil)
		return
	}
	var req struct {
		Grants []jiraSpaceAccess `json:"grants"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<18)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if err := replaceJiraSpaceAccess(id, req.Grants); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "access could not be saved", err)
		return
	}
	grants, _ := listJiraSpaceAccess(id)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "access": grants})
}

func jiraSpaceMappingsHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	access, err := jiraAccessForSpace(userID, id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	if r.Method == http.MethodGet {
		if !access.CanView {
			writeAPIError(w, r, http.StatusForbidden, "you cannot view this Jira space", nil)
			return
		}
		mappings, _ := listJiraMappings(id)
		writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "mappings": mappings})
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	if !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change mappings for this space", nil)
		return
	}
	var req jiraMapping
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	req.SpaceID = id
	saved, err := insertJiraMapping(req)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "mapping could not be saved", err)
		return
	}
	writeJSONResponse(w, http.StatusCreated, map[string]any{"status": "ok", "mapping": saved})
}

func jiraDeleteMappingHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	var spaceID int
	if err := DB.QueryRow(`SELECT space_id FROM jira_mappings WHERE id = $1`, id).Scan(&spaceID); err != nil {
		writeAPIError(w, r, http.StatusNotFound, "mapping not found", err)
		return
	}
	access, err := jiraAccessForSpace(userID, spaceID)
	if err != nil || !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change this mapping", nil)
		return
	}
	if err := deleteJiraMapping(id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "mapping could not be removed", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func jiraIssueTypesHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	space, err := getJiraSpace(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, id)
	if !access.CanView {
		writeAPIError(w, r, http.StatusForbidden, "you cannot view this Jira space", nil)
		return
	}
	token, err := jiraValidAccessToken(space.ConnectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	types, err := jiraAPI.GetIssueTypes(token, space.CloudID, space.JiraProjectID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "issue_types": types})
}

func jiraCreateMetaHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	space, err := getJiraSpace(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, id)
	if !access.CanCreate {
		writeAPIError(w, r, http.StatusForbidden, "you cannot create Jira work in this space", nil)
		return
	}
	issueTypeID := strings.TrimSpace(r.URL.Query().Get("issue_type_id"))
	if issueTypeID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "issue_type_id is required", nil)
		return
	}
	token, err := jiraValidAccessToken(space.ConnectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	fields, err := jiraAPI.GetCreateMeta(token, space.CloudID, space.JiraProjectID, issueTypeID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status": "ok",
		"preview": jiraCreatePreview{
			SiteName:     space.SiteName,
			CloudID:      space.CloudID,
			SpaceName:    space.Name,
			SpaceKey:     space.JiraProjectKey,
			IssueType:    issueTypeID,
			Relationship: jiraRelRelated,
			Fields:       fields,
			Note:         "Only the selected summary is sent. Logs, attachments, and internal notes stay in OpsTrellis.",
		},
	})
}

func jiraSearchIssuesHandler(w http.ResponseWriter, r *http.Request, userID int) {
	spaceID := atoiSafe(r.URL.Query().Get("space_id"))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if spaceID == 0 || query == "" {
		writeAPIError(w, r, http.StatusBadRequest, "space_id and q are required", nil)
		return
	}
	space, err := getJiraSpace(spaceID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "space not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, spaceID)
	if !access.CanLink && !access.CanView {
		writeAPIError(w, r, http.StatusForbidden, "you cannot search this Jira space", nil)
		return
	}
	token, err := jiraValidAccessToken(space.ConnectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	jql := fmt.Sprintf(`project = "%s" AND (key = "%s" OR summary ~ "%s")`, escapeJQL(space.JiraProjectKey), escapeJQL(query), escapeJQL(query))
	issues, err := jiraAPI.SearchIssues(token, space.CloudID, jql, 15)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	out := []jiraIssueView{}
	for i := range issues {
		view := remoteIssueView(&issues[i], space)
		if view.Restricted && !access.IsOwner && !access.CanAdminister {
			continue
		}
		out = append(out, view)
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "issues": out})
}

func escapeJQL(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}

func jiraListLinksHandler(w http.ResponseWriter, r *http.Request, userID int) {
	q := r.URL.Query()
	sourceType := strings.TrimSpace(q.Get("source_type"))
	sourceID := atoiSafe(q.Get("source_id"))
	sourceKey := strings.TrimSpace(q.Get("source_key"))
	var links []jiraIssueLinkView
	var err error
	if sourceType == "" {
		links, err = listAllJiraIssueLinks(100)
	} else {
		links, err = listJiraIssueLinks(sourceType, sourceID, sourceKey)
	}
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "linked work could not be loaded", err)
		return
	}
	links = filterVisibleJiraLinks(userID, links)
	note := ""
	if strings.TrimSpace(q.Get("assigned")) == "1" {
		accounts := jiraAccountIDsForUser(userID)
		if len(accounts) > 0 {
			links = filterJiraLinksByAssigneeAccounts(links, accounts)
			note = "Assigned using verified Jira account identifiers."
		} else {
			note = "Assigned Jira tasks appear when your Jira account is known from a connection you own. This list is authorized linked work, not a second queue."
		}
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "links": links, "note": note})
}

func jiraGetIssueHandler(w http.ResponseWriter, r *http.Request, userID int) {
	cloudID := strings.TrimSpace(r.URL.Query().Get("cloud_id"))
	issueID := strings.TrimSpace(r.URL.Query().Get("issue_id"))
	if cloudID == "" || issueID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "cloud_id and issue_id are required", nil)
		return
	}
	issue, err := getJiraIssue(cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "Jira issue was not found", err)
		return
	}
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "linked issue not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanView || (issue.Restricted && !access.IsOwner && !access.CanAdminister) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot view this Jira issue", nil)
		return
	}
	links, _ := listAllJiraIssueLinks(80)
	related := []jiraIssueLinkView{}
	for _, link := range links {
		if link.Issue.CloudID == cloudID && link.Issue.IssueID == issueID {
			related = append(related, link)
		}
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status": "ok",
		"issue":  issue,
		"links":  filterVisibleJiraLinks(userID, related),
		"note":   "Jira owns title, status, assignee, and priority after creation. Done in Jira does not close the portal record.",
	})
}

func jiraCreateLinkHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req struct {
		SpaceID      int    `json:"space_id"`
		IssueRef     string `json:"issue_ref"`
		Relationship string `json:"relationship"`
		SourceType   string `json:"source_type"`
		SourceID     int    `json:"source_id"`
		SourceKey    string `json:"source_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	op, err := enqueueJiraLink(userID, req.SpaceID, req.IssueRef, req.Relationship, req.SourceType, req.SourceKey, req.SourceID)
	if err != nil {
		writeAPIError(w, r, http.StatusForbidden, err.Error(), err)
		return
	}
	go processJiraOperation(op.OperationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "ok", "operation": op})
}

func jiraDeleteLinkHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	sourceType, cloudID, issueID, _, err := getJiraIssueLink(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "link not found", err)
		return
	}
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "linked issue not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanLink {
		writeAPIError(w, r, http.StatusForbidden, "you cannot unlink this Jira work", nil)
		return
	}
	if err := deleteJiraIssueLink(id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "link could not be removed", err)
		return
	}
	insertJiraAudit(space.ConnectionID, userID, "unlink", sourceType, 0, cloudID, issueID, "ok", "")
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func jiraCreateIssueHandler(w http.ResponseWriter, r *http.Request, userID int) {
	var req jiraCreateRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<18)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	op, err := enqueueJiraCreate(userID, req)
	if err != nil {
		writeAPIError(w, r, http.StatusForbidden, err.Error(), err)
		return
	}
	go processJiraOperation(op.OperationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "ok", "operation": op})
}

func jiraTeamsHandler(w http.ResponseWriter, r *http.Request, userID int) {
	if !jiraUserIsPortalAdmin(userID) {
		conns, _ := listJiraConnections()
		allowed := false
		for _, conn := range conns {
			if jiraCanManageConnection(userID, conn) {
				allowed = true
				break
			}
		}
		if !allowed {
			writeAPIError(w, r, http.StatusForbidden, "you cannot manage Jira access grants", nil)
			return
		}
	}
	rows, err := DB.Query(`SELECT id, name, slug FROM teams ORDER BY name`)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "teams could not be loaded", err)
		return
	}
	defer rows.Close()
	teams := []map[string]any{}
	for rows.Next() {
		var id int
		var name, slug string
		if err := rows.Scan(&id, &name, &slug); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "teams could not be loaded", err)
			return
		}
		teams = append(teams, map[string]any{"id": id, "name": name, "slug": slug})
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "teams": teams})
}

func jiraActivityHandler(w http.ResponseWriter, r *http.Request, _ int) {
	ops, err := listJiraOperations(100)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "activity could not be loaded", err)
		return
	}
	audit, _ := listJiraAudit(80)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "operations": ops, "audit": audit})
}

func jiraGetOperationHandler(w http.ResponseWriter, r *http.Request, operationID string) {
	op, _, _, err := getJiraOperationByID(operationID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "operation not found", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok", "operation": op})
}

func jiraRetryOperationHandler(w http.ResponseWriter, r *http.Request, userID int, operationID string) {
	if err := retryJiraOperation(operationID); err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	insertJiraAudit(0, userID, "retry", "", 0, "", "", "queued", operationID)
	go processJiraOperation(operationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{"status": "ok"})
}

func jiraConnectionChecks(conn jiraConnection, spaces []jiraSpace) []map[string]string {
	out := []map[string]string{}
	add := func(level, message string) {
		out = append(out, map[string]string{"level": level, "message": message})
	}
	if !jiraOAuthConfigured() {
		add("error", "Jira OAuth is not configured. Onboard the Jira app and store the client ID and secret.")
	}
	if conn.AuthHealth == jiraHealthReauth {
		add("error", "Reauthorization is required. The connection owner must sign in to Atlassian again.")
	}
	if strings.TrimSpace(conn.CloudID) == "" {
		add("warn", "Select a Jira site before enabling this connection.")
	}
	if len(spaces) == 0 {
		add("warn", "Select at least one permitted Jira space. The entire site is not imported.")
	}
	if conn.OwnerUserID == 0 {
		add("warn", "This connection has no owner. Reauthorize so access stays tied to a person.")
	}
	hasCreate := false
	for _, space := range spaces {
		grants, _ := listJiraSpaceAccess(space.ID)
		if len(grants) == 0 {
			add("warn", space.Name+" has no team grants. Only the connection owner and portal admins can use it.")
		}
		mappings, _ := listJiraMappings(space.ID)
		if len(mappings) > 0 {
			hasCreate = true
		}
	}
	if !hasCreate && len(spaces) > 0 {
		add("info", "Add a mapping so create forms know the destination issue type.")
	}
	if msg := jiraWebhookStatusCheck(conn); msg != "" {
		add("warn", msg)
	}
	if len(out) == 0 {
		add("ok", "Connection, site, and selected spaces look ready.")
	}
	return out
}

func jiraReadyToEnable(conn jiraConnection, spaces []jiraSpace) bool {
	return jiraOAuthConfigured() &&
		conn.AuthHealth != jiraHealthReauth &&
		strings.TrimSpace(conn.CloudID) != "" &&
		len(spaces) > 0
}

func jiraSetupStep(conn jiraConnection, spaces []jiraSpace) string {
	if !jiraOAuthConfigured() {
		return "onboard_app"
	}
	if conn.AuthHealth == jiraHealthReauth || conn.AuthHealth == jiraHealthNotConfigured || conn.State == jiraStateDraft || conn.State == jiraStateAuthorizing {
		return "authorize"
	}
	if strings.TrimSpace(conn.CloudID) == "" {
		return "select_site"
	}
	if len(spaces) == 0 {
		return "select_spaces"
	}
	hasGrants := false
	hasMapping := false
	for _, space := range spaces {
		grants, _ := listJiraSpaceAccess(space.ID)
		if len(grants) > 0 {
			hasGrants = true
		}
		mappings, _ := listJiraMappings(space.ID)
		if len(mappings) > 0 {
			hasMapping = true
		}
	}
	if !hasGrants && !hasMapping {
		return "access"
	}
	if !hasMapping {
		return "mappings"
	}
	if !jiraSyncPolicyConfigured(conn.ID) {
		return "sync"
	}
	if !conn.Enabled {
		return "validate"
	}
	return "ready"
}

func jiraWebhookView(connectionID int) jiraWebhookStatus {
	status, _ := getJiraWebhookRegistration(connectionID)
	return status
}

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

func jiraJSONHasSecret(v any) bool {
	raw, _ := json.Marshal(v)
	lower := strings.ToLower(string(raw))
	return strings.Contains(lower, "access_token") || strings.Contains(lower, "refresh_token") || strings.Contains(lower, jiraSecretEncPrefix)
}
