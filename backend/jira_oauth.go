package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const jiraOAuthAudience = "api.atlassian.com"
const jiraOAuthTenantKey = "default"

type jiraOAuthApp struct {
	ClientID    string
	Secret      string
	RedirectURL string
	Scopes      string
	UpdatedBy   int
}

type jiraOAuthAppView struct {
	Configured      bool   `json:"configured"`
	ClientID        string `json:"client_id,omitempty"`
	ClientSecretSet bool   `json:"client_secret_set"`
	RedirectURL     string `json:"redirect_url"`
	CallbackURL     string `json:"callback_url"`
	Scopes          string `json:"scopes"`
	CanManage       bool   `json:"can_manage"`
}

var (
	jiraOAuthAppMu    sync.RWMutex
	jiraOAuthAppCache *jiraOAuthApp
)

func jiraDefaultCallbackURL() string {
	return oidcPublicAPIBase() + "/api/integrations/jira/oauth/callback"
}

func jiraDefaultScopes() string {
	return "read:jira-work write:jira-work read:jira-user manage:jira-webhook offline_access"
}

func loadJiraOAuthApp() jiraOAuthApp {
	jiraOAuthAppMu.RLock()
	if jiraOAuthAppCache != nil {
		app := *jiraOAuthAppCache
		jiraOAuthAppMu.RUnlock()
		return app
	}
	jiraOAuthAppMu.RUnlock()

	app := jiraOAuthApp{}
	if DB != nil {
		var clientID, secretEnc, redirect, scopes string
		err := DB.QueryRow(`
			SELECT client_id, client_secret_enc, redirect_url, scopes
			FROM jira_oauth_apps WHERE tenant_key = $1
		`, jiraOAuthTenantKey).Scan(&clientID, &secretEnc, &redirect, &scopes)
		if err != nil && err != sql.ErrNoRows {
			return app
		}
		if err == nil {
			secret, decErr := decryptJiraSecret(secretEnc)
			if decErr == nil {
				app = jiraOAuthApp{
					ClientID:    strings.TrimSpace(clientID),
					Secret:      secret,
					RedirectURL: strings.TrimSpace(redirect),
					Scopes:      strings.TrimSpace(scopes),
				}
			}
		}
	}
	jiraOAuthAppMu.Lock()
	jiraOAuthAppCache = &app
	jiraOAuthAppMu.Unlock()
	return app
}

func clearJiraOAuthAppCache() {
	jiraOAuthAppMu.Lock()
	jiraOAuthAppCache = nil
	jiraOAuthAppMu.Unlock()
}

func saveJiraOAuthApp(userID int, clientID, secret, redirect, scopes string) (jiraOAuthApp, error) {
	clientID = strings.TrimSpace(clientID)
	secret = strings.TrimSpace(secret)
	redirect = strings.TrimSpace(redirect)
	scopes = strings.TrimSpace(scopes)
	if clientID == "" {
		return jiraOAuthApp{}, fmt.Errorf("client ID is required")
	}
	current := loadJiraOAuthApp()
	if secret == "" {
		secret = current.Secret
	}
	if secret == "" {
		return jiraOAuthApp{}, fmt.Errorf("client secret is required")
	}
	scopes = jiraMergeScopes(scopes, jiraDefaultScopes())
	secretEnc, err := encryptJiraSecret(secret)
	if err != nil {
		return jiraOAuthApp{}, err
	}
	_, err = DB.Exec(`
		INSERT INTO jira_oauth_apps (tenant_key, client_id, client_secret_enc, redirect_url, scopes, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), CURRENT_TIMESTAMP)
		ON CONFLICT (tenant_key) DO UPDATE SET
			client_id = EXCLUDED.client_id,
			client_secret_enc = EXCLUDED.client_secret_enc,
			redirect_url = EXCLUDED.redirect_url,
			scopes = EXCLUDED.scopes,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`, jiraOAuthTenantKey, clientID, secretEnc, redirect, scopes, userID)
	if err != nil {
		return jiraOAuthApp{}, err
	}
	clearJiraOAuthAppCache()
	return loadJiraOAuthApp(), nil
}

func jiraOAuthAppConfigured(app jiraOAuthApp) bool {
	return strings.TrimSpace(app.ClientID) != "" && strings.TrimSpace(app.Secret) != ""
}

func jiraOAuthAppPublicView(userID int) jiraOAuthAppView {
	app := loadJiraOAuthApp()
	return jiraOAuthAppView{
		Configured:      jiraOAuthAppConfigured(app),
		ClientID:        app.ClientID,
		ClientSecretSet: strings.TrimSpace(app.Secret) != "",
		RedirectURL:     jiraOAuthRedirectURL(),
		CallbackURL:     jiraDefaultCallbackURL(),
		Scopes:          jiraOAuthScopes(),
		CanManage:       jiraCanManageOAuthApp(userID),
	}
}

func jiraCanManageOAuthApp(userID int) bool {
	if jiraUserIsPortalAdmin(userID) {
		return true
	}
	app := loadJiraOAuthApp()
	return !jiraOAuthAppConfigured(app)
}

func jiraOAuthClientID() string {
	if id := strings.TrimSpace(loadJiraOAuthApp().ClientID); id != "" {
		return id
	}
	return strings.TrimSpace(os.Getenv("JIRA_OAUTH_CLIENT_ID"))
}

func jiraOAuthClientSecret() string {
	if secret := strings.TrimSpace(loadJiraOAuthApp().Secret); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JIRA_OAUTH_CLIENT_SECRET"))
}

func jiraOAuthConfigured() bool {
	return jiraOAuthClientID() != "" && jiraOAuthClientSecret() != ""
}

func jiraCapabilityMode() capabilityMode {
	if jiraOAuthConfigured() {
		return capabilityLive
	}
	return capabilityUnavailable
}

func jiraOAuthRedirectURL() string {
	if trimmed := strings.TrimSpace(loadJiraOAuthApp().RedirectURL); trimmed != "" {
		return trimmed
	}
	if trimmed := strings.TrimSpace(os.Getenv("JIRA_OAUTH_REDIRECT_URL")); trimmed != "" {
		return trimmed
	}
	return jiraDefaultCallbackURL()
}

func jiraOAuthScopes() string {
	stored := strings.TrimSpace(loadJiraOAuthApp().Scopes)
	if stored == "" {
		stored = strings.TrimSpace(os.Getenv("JIRA_OAUTH_SCOPES"))
	}
	return jiraMergeScopes(stored, jiraDefaultScopes())
}

func jiraMergeScopes(parts ...string) string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, part := range parts {
		for _, scope := range strings.Fields(part) {
			if _, ok := seen[scope]; ok {
				continue
			}
			seen[scope] = struct{}{}
			out = append(out, scope)
		}
	}
	return strings.Join(out, " ")
}

func jiraAuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("audience", jiraOAuthAudience)
	q.Set("client_id", jiraOAuthClientID())
	q.Set("scope", jiraOAuthScopes())
	q.Set("redirect_uri", jiraOAuthRedirectURL())
	q.Set("state", state)
	q.Set("response_type", "code")
	q.Set("prompt", "consent")
	return "https://auth.atlassian.com/authorize?" + q.Encode()
}

func jiraExchangeCode(code string) (jiraTokenSet, error) {
	payload, _ := json.Marshal(map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     jiraOAuthClientID(),
		"client_secret": jiraOAuthClientSecret(),
		"code":          code,
		"redirect_uri":  jiraOAuthRedirectURL(),
	})
	req, err := http.NewRequest(http.MethodPost, "https://auth.atlassian.com/oauth/token", bytes.NewReader(payload))
	if err != nil {
		return jiraTokenSet{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return jiraTokenSet{}, fmt.Errorf("Jira authorization could not be completed")
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return jiraTokenSet{}, fmt.Errorf("Jira authorization was refused")
	}
	return parseJiraTokenResponse(body)
}

func jiraFrontendRedirect(connectionID int, extra url.Values) string {
	base := strings.TrimRight(DevOpsFrontendURL, "/")
	if base == "" {
		base = "http://localhost:3002"
	}
	target := base + "/integrations/jira"
	if connectionID > 0 {
		target = fmt.Sprintf("%s/integrations/jira/%d", base, connectionID)
	}
	if extra != nil && len(extra) > 0 {
		target += "?" + extra.Encode()
	}
	return target
}

func jiraValidAccessToken(connectionID int) (string, error) {
	tokens, err := loadJiraConnectionTokens(connectionID)
	if err != nil {
		return "", fmt.Errorf("this Jira connection has no stored credentials")
	}
	if tokens.Access != "" && (tokens.Expiry.IsZero() || time.Until(tokens.Expiry) > 2*time.Minute) {
		return tokens.Access, nil
	}
	if strings.TrimSpace(tokens.Refresh) == "" {
		_ = updateJiraConnectionState(connectionID, jiraStateFailed, jiraHealthReauth, jiraHealthFailed, false, "Reauthorization is required.")
		return "", fmt.Errorf("Jira reauthorization is required")
	}
	refreshed, err := jiraAPI.RefreshToken(tokens.Refresh)
	if err != nil {
		_ = updateJiraConnectionState(connectionID, jiraStateFailed, jiraHealthReauth, jiraHealthFailed, false, "Reauthorization is required.")
		return "", fmt.Errorf("Jira reauthorization is required")
	}
	if err := upsertJiraConnectionSecrets(connectionID, refreshed.Access, refreshed.Refresh, refreshed.Type, refreshed.Expiry); err != nil {
		return "", err
	}
	_ = markJiraConnectionSuccess(connectionID)
	return refreshed.Access, nil
}
