package main

import (
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

const githubActionsIssuer = "https://token.actions.githubusercontent.com"
const gitlabOIDCIssuerDefault = "https://gitlab.com"

type oidcStatePayload struct {
	Portal string `json:"portal"`
	Nonce  string `json:"nonce"`
	Exp    int64  `json:"exp"`
}

type oidcDiscovery struct {
	Issuer      string `json:"issuer"`
	AuthURL     string `json:"authorization_endpoint"`
	TokenURL    string `json:"token_endpoint"`
	UserInfoURL string `json:"userinfo_endpoint"`
	JWKSURL     string `json:"jwks_uri"`
}

type jwksDocument struct {
	Keys []jwksKey `json:"keys"`
}

type jwksKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

var (
	jwksCache     = map[string]jwksDocument{}
	jwksCacheAt   = map[string]time.Time{}
	jwksCacheLock sync.Mutex
)

func oidcPublicAPIBase() string {
	base := strings.TrimRight(os.Getenv("NEXT_PUBLIC_API_URL"), "/")
	if base == "" {
		base = "http://localhost:8080"
	}
	return base
}

func oidcStartURL(portal string) string {
	return oidcPublicAPIBase() + "/api/auth/oidc/start?portal=" + url.QueryEscape(normalizePortalName(portal))
}

func oidcRedirectURL() string {
	if trimmed := strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")); trimmed != "" {
		return trimmed
	}
	return oidcPublicAPIBase() + "/api/auth/oidc/callback"
}

func oidcIssuer() string {
	return strings.TrimRight(strings.TrimSpace(os.Getenv("OIDC_ISSUER")), "/")
}

func oidcClientID() string {
	return strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID"))
}

func oidcClientSecret() string {
	return strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET"))
}

func oidcStateSecret() []byte {
	secret := strings.TrimSpace(os.Getenv("OIDC_STATE_SECRET"))
	if secret == "" {
		secret = oidcClientSecret()
	}
	if secret == "" {
		secret = "opstrellis-oidc-state"
	}
	return []byte(secret)
}

func oidcScopes() []string {
	raw := strings.TrimSpace(os.Getenv("OIDC_SCOPES"))
	if raw == "" {
		return []string{"openid", "email", "profile"}
	}
	parts := strings.Fields(raw)
	if len(parts) == 0 {
		return []string{"openid", "email", "profile"}
	}
	return parts
}

func portalFrontendURL(portal string) string {
	switch normalizePortalName(portal) {
	case "devops":
		return strings.TrimRight(DevOpsFrontendURL, "/")
	case "admin":
		return strings.TrimRight(AdminFrontendURL, "/")
	default:
		return strings.TrimRight(FrontendURL, "/")
	}
}

func encodeOIDCState(portal string) (string, error) {
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := oidcStatePayload{
		Portal: normalizePortalName(portal),
		Nonce:  base64.RawURLEncoding.EncodeToString(nonce),
		Exp:    time.Now().Add(10 * time.Minute).Unix(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, oidcStateSecret())
	_, _ = mac.Write(body)
	return base64.RawURLEncoding.EncodeToString(body) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func decodeOIDCState(raw string) (oidcStatePayload, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return oidcStatePayload{}, fmt.Errorf("invalid state")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return oidcStatePayload{}, fmt.Errorf("invalid state")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return oidcStatePayload{}, fmt.Errorf("invalid state")
	}
	mac := hmac.New(sha256.New, oidcStateSecret())
	_, _ = mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), sig) {
		return oidcStatePayload{}, fmt.Errorf("invalid state signature")
	}
	var payload oidcStatePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return oidcStatePayload{}, fmt.Errorf("invalid state")
	}
	if payload.Exp < time.Now().Unix() {
		return oidcStatePayload{}, fmt.Errorf("state expired")
	}
	return payload, nil
}

func fetchOIDCDiscovery(issuer string) (oidcDiscovery, error) {
	if issuer == "" {
		return oidcDiscovery{}, fmt.Errorf("OIDC_ISSUER is not configured")
	}
	resp, err := http.Get(issuer + "/.well-known/openid-configuration")
	if err != nil {
		return oidcDiscovery{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return oidcDiscovery{}, fmt.Errorf("oidc discovery returned %d", resp.StatusCode)
	}
	var doc oidcDiscovery
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&doc); err != nil {
		return oidcDiscovery{}, err
	}
	if doc.AuthURL == "" || doc.TokenURL == "" {
		return oidcDiscovery{}, fmt.Errorf("oidc discovery missing endpoints")
	}
	return doc, nil
}

func oidcOauthConfig(discovery oidcDiscovery) (*oauth2.Config, error) {
	if oidcClientID() == "" || oidcClientSecret() == "" {
		return nil, fmt.Errorf("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required")
	}
	return &oauth2.Config{
		ClientID:     oidcClientID(),
		ClientSecret: oidcClientSecret(),
		RedirectURL:  oidcRedirectURL(),
		Scopes:       oidcScopes(),
		Endpoint: oauth2.Endpoint{
			AuthURL:  discovery.AuthURL,
			TokenURL: discovery.TokenURL,
		},
	}, nil
}

func oidcStartHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	portal := normalizePortalName(r.URL.Query().Get("portal"))
	if portal == "admin" {
		writeAPIError(w, r, http.StatusForbidden, "admin portal uses local break-glass login", nil)
		return
	}
	settings, err := loadSSOSettings()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load sso settings", err)
		return
	}
	if ssoModeForPortal(settings, portal) == ssoModeDisabled && normalizeSSOProvider(settings.Provider) != "oidc" {
		writeAPIError(w, r, http.StatusForbidden, "sso login is disabled for this portal", nil)
		return
	}
	discovery, err := fetchOIDCDiscovery(oidcIssuer())
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "oidc issuer is not reachable", err)
		return
	}
	cfg, err := oidcOauthConfig(discovery)
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, err.Error(), err)
		return
	}
	state, err := encodeOIDCState(portal)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to start oidc login", err)
		return
	}
	http.Redirect(w, r, cfg.AuthCodeURL(state), http.StatusFound)
}

func oidcCallbackHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if errMsg := strings.TrimSpace(r.URL.Query().Get("error")); errMsg != "" {
		writeAPIError(w, r, http.StatusUnauthorized, "oidc provider returned "+errMsg, nil)
		return
	}
	state, err := decodeOIDCState(r.URL.Query().Get("state"))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing authorization code", nil)
		return
	}
	discovery, err := fetchOIDCDiscovery(oidcIssuer())
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "oidc issuer is not reachable", err)
		return
	}
	cfg, err := oidcOauthConfig(discovery)
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, err.Error(), err)
		return
	}
	token, err := cfg.Exchange(r.Context(), code)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "failed to exchange oidc code", err)
		return
	}
	claims, err := fetchOIDCUserInfo(discovery.UserInfoURL, token.AccessToken)
	if err != nil {
		if rawID, ok := token.Extra("id_token").(string); ok && rawID != "" {
			claims, err = decodeJWTPayloadUnverified(rawID)
		}
	}
	if err != nil || claims == nil {
		writeAPIError(w, r, http.StatusUnauthorized, "failed to read oidc identity", err)
		return
	}
	email := firstNonEmpty(stringFromAny(claims["email"]), stringFromAny(claims["preferred_username"]))
	sub := firstNonEmpty(stringFromAny(claims["sub"]), email)
	name := firstNonEmpty(stringFromAny(claims["preferred_username"]), stringFromAny(claims["name"]), strings.Split(email, "@")[0])
	groups := stringSliceFromAny(claims["groups"])
	session, user, loginErr := completeOIDCPortalLogin(state.Portal, email, name, sub, groups, claims)
	if loginErr != nil {
		writeAPIError(w, r, http.StatusForbidden, loginErr.Error(), loginErr)
		return
	}
	redirect := portalFrontendURL(state.Portal) + "/login?sso_token=" + url.QueryEscape(session)
	if user != nil && user.Username != "" {
		redirect += "&sso_user=" + url.QueryEscape(user.Username)
	}
	http.Redirect(w, r, redirect, http.StatusFound)
}

func fetchOIDCUserInfo(endpoint, accessToken string) (map[string]interface{}, error) {
	if strings.TrimSpace(endpoint) == "" || strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("userinfo unavailable")
	}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("userinfo returned %d", resp.StatusCode)
	}
	var claims map[string]interface{}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func completeOIDCPortalLogin(portal, email, username, externalID string, groups []string, claims map[string]interface{}) (string, *User, error) {
	if DB == nil {
		return "", nil, fmt.Errorf("database not available")
	}
	settings, err := loadSSOSettings()
	if err != nil {
		return "", nil, err
	}
	if normalizeSSOProvider(settings.Provider) == "none" {
		settings.Provider = "oidc"
	} else {
		settings.Provider = "oidc"
	}
	if ssoModeForPortal(settings, portal) == ssoModeDisabled {
		return "", nil, fmt.Errorf("sso login is disabled for this portal")
	}
	if claims == nil {
		claims = map[string]interface{}{}
	}
	if err := validateSSOClaims(settings, claims); err != nil {
		return "", nil, err
	}
	policy := parseSSOPolicy(settings)
	user := ssoDirectoryUser{
		ExternalID: strings.TrimSpace(externalID),
		Username:   sanitizeUsername(username),
		Email:      strings.TrimSpace(strings.ToLower(email)),
		Groups:     normalizeGroupList(groups),
		Claims:     claims,
		Role:       "viewer",
	}
	if portal == "devops" {
		user.UserType = "devops_user"
	} else {
		user.UserType = "portal_user"
	}
	if user.ExternalID == "" {
		user.ExternalID = user.Email
	}
	if user.Username == "" {
		user.Username = sanitizeUsername(strings.Split(user.Email, "@")[0])
	}
	if user.Email == "" {
		return "", nil, fmt.Errorf("oidc identity did not include an email")
	}
	if existingID, findErr := findSSOUserByProviderExternalID("oidc", user.ExternalID); findErr != nil && existingID == 0 && !settings.JITProvisionEnabled {
		if idByEmail, _, _, emailErr := findUserByEmail(user.Email); emailErr != nil || idByEmail == 0 {
			return "", nil, fmt.Errorf("jit provisioning is disabled. run directory sync first")
		}
	}
	userID, action, err := upsertSSODirectoryUser(settings, policy, user, settings.JITProvisionEnabled)
	if err != nil {
		return "", nil, err
	}
	if userID <= 0 {
		return "", nil, fmt.Errorf("sso user not allowed")
	}
	fullUser, err := GetUserByID(userID)
	if err != nil || fullUser == nil {
		return "", nil, fmt.Errorf("failed to load user")
	}
	token := generateToken(userID)
	if token == "" {
		return "", nil, fmt.Errorf("failed to issue session")
	}
	AppendUserActivity(&userID, "sso_login", "user", fmt.Sprintf("%d", userID), fmt.Sprintf("provider=oidc portal=%s action=%s", portal, action))
	AppendAuditLog(nil, "sso-login-success", "sso", fmt.Sprintf("%d", userID), fmt.Sprintf("provider=oidc portal=%s action=%s", portal, action))
	return token, fullUser, nil
}

func decodeJWTPayloadUnverified(token string) (map[string]interface{}, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid jwt")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []interface{}:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(stringFromAny(item)); text != "" {
				out = append(out, text)
			}
		}
		return out
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return strings.Split(typed, ",")
	default:
		return nil
	}
}

const (
	workloadOIDCAudienceDefault = "opstrellis"
	workloadOIDCAudienceLegacy  = "setuops"
)

func githubOIDCAudience() string {
	if trimmed := strings.TrimSpace(os.Getenv("GITHUB_OIDC_AUDIENCE")); trimmed != "" {
		return trimmed
	}
	return workloadOIDCAudienceDefault
}

func readWorkloadOIDCToken(r *http.Request) string {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
	if token != "" {
		return token
	}
	var body struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	return strings.TrimSpace(body.Token)
}

func writeWorkloadOIDCResult(w http.ResponseWriter, claims map[string]any, exchange workloadRoleExchange) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":   "ok",
		"issuer":   stringFromAny(claims["iss"]),
		"subject":  stringFromAny(claims["sub"]),
		"claims":   claims,
		"exchange": exchange,
	})
}

func workloadGitHubHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	token := readWorkloadOIDCToken(r)
	if token == "" {
		writeAPIError(w, r, http.StatusUnauthorized, "missing github oidc token", nil)
		return
	}
	claims, err := verifyGitHubOIDC(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	recordIdentityFinding("oidc_ok", firstNonEmpty(stringFromAny(claims["repository"]), stringFromAny(claims["sub"])), "github_actions", claims)
	writeWorkloadOIDCResult(w, claims, exchangeWorkloadCloudRole("github", token, claims))
}

func workloadGitLabHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	token := readWorkloadOIDCToken(r)
	if token == "" {
		writeAPIError(w, r, http.StatusUnauthorized, "missing gitlab oidc token", nil)
		return
	}
	claims, err := verifyGitLabOIDC(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}
	recordIdentityFinding("oidc_ok", firstNonEmpty(stringFromAny(claims["project_path"]), stringFromAny(claims["sub"])), "gitlab_ci", claims)
	writeWorkloadOIDCResult(w, claims, exchangeWorkloadCloudRole("gitlab", token, claims))
}

func gitlabOIDCIssuer() string {
	if trimmed := strings.TrimSpace(os.Getenv("GITLAB_OIDC_ISSUER")); trimmed != "" {
		return strings.TrimRight(trimmed, "/")
	}
	return gitlabOIDCIssuerDefault
}

func gitlabOIDCJWKS() string {
	if trimmed := strings.TrimSpace(os.Getenv("GITLAB_OIDC_JWKS_URL")); trimmed != "" {
		return trimmed
	}
	return gitlabOIDCIssuer() + "/oauth/discovery/keys"
}

func gitlabOIDCAudience() string {
	if trimmed := strings.TrimSpace(os.Getenv("GITLAB_OIDC_AUDIENCE")); trimmed != "" {
		return trimmed
	}
	return workloadOIDCAudienceDefault
}

func verifyGitHubOIDC(token string) (map[string]interface{}, error) {
	return verifyWorkloadOIDC(token, githubActionsIssuer, githubActionsIssuer+"/.well-known/jwks", githubOIDCAudience(), "github")
}

func verifyGitLabOIDC(token string) (map[string]interface{}, error) {
	return verifyWorkloadOIDC(token, gitlabOIDCIssuer(), gitlabOIDCJWKS(), gitlabOIDCAudience(), "gitlab")
}

func verifyWorkloadOIDC(token, issuer, jwksURL, audience, label string) (map[string]interface{}, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid %s oidc token", label)
	}
	headerRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid %s oidc header", label)
	}
	var header struct {
		Kid string `json:"kid"`
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerRaw, &header); err != nil || header.Kid == "" {
		return nil, fmt.Errorf("%s oidc header missing kid", label)
	}
	if header.Alg != "" && header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported %s oidc alg", label)
	}
	keys, err := fetchJWKS(jwksURL)
	if err != nil {
		return nil, err
	}
	var matched *jwksKey
	for i := range keys.Keys {
		if keys.Keys[i].Kid == header.Kid {
			matched = &keys.Keys[i]
			break
		}
	}
	if matched == nil {
		return nil, fmt.Errorf("%s oidc signing key not found", label)
	}
	pub, err := rsaPublicFromJWKS(*matched)
	if err != nil {
		return nil, err
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid %s oidc signature", label)
	}
	sum := sha256.Sum256(signingInput)
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig); err != nil {
		return nil, fmt.Errorf("%s oidc signature invalid", label)
	}
	claims, err := decodeJWTPayloadUnverified(token)
	if err != nil {
		return nil, err
	}
	if stringFromAny(claims["iss"]) != issuer {
		return nil, fmt.Errorf("unexpected %s oidc issuer", label)
	}
	if !audienceContains(claims["aud"], audience) &&
		!(audience == workloadOIDCAudienceDefault && audienceContains(claims["aud"], workloadOIDCAudienceLegacy)) {
		return nil, fmt.Errorf("%s oidc audience mismatch", label)
	}
	if exp := intFromAny(claims["exp"]); exp > 0 && int64(exp) < time.Now().Unix() {
		return nil, fmt.Errorf("%s oidc token expired", label)
	}
	return claims, nil
}

func audienceContains(value any, want string) bool {
	want = strings.TrimSpace(want)
	if want == "" {
		return true
	}
	switch typed := value.(type) {
	case string:
		return strings.EqualFold(typed, want)
	case []interface{}:
		for _, item := range typed {
			if strings.EqualFold(stringFromAny(item), want) {
				return true
			}
		}
	}
	return false
}

func fetchJWKS(jwksURL string) (jwksDocument, error) {
	jwksCacheLock.Lock()
	if cached, ok := jwksCache[jwksURL]; ok && time.Since(jwksCacheAt[jwksURL]) < time.Hour {
		jwksCacheLock.Unlock()
		return cached, nil
	}
	jwksCacheLock.Unlock()
	resp, err := http.Get(jwksURL)
	if err != nil {
		return jwksDocument{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return jwksDocument{}, fmt.Errorf("jwks returned %d", resp.StatusCode)
	}
	var doc jwksDocument
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&doc); err != nil {
		return jwksDocument{}, err
	}
	jwksCacheLock.Lock()
	jwksCache[jwksURL] = doc
	jwksCacheAt[jwksURL] = time.Now()
	jwksCacheLock.Unlock()
	return doc, nil
}

func rsaPublicFromJWKS(key jwksKey) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
	if err != nil {
		return nil, err
	}
	var eInt int
	for _, b := range eBytes {
		eInt = eInt<<8 + int(b)
	}
	if eInt == 0 {
		eInt = 65537
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: eInt}, nil
}

func listStaticKeyFindings() []map[string]any {
	names := []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "RAILWAY_TOKEN", "GITHUB_TOKEN", "GCP_SA_KEY"}
	out := []map[string]any{}
	for _, name := range names {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			continue
		}
		out = append(out, map[string]any{
			"kind":    "static_key",
			"name":    name,
			"present": true,
			"advice":  "Prefer GitHub OIDC / cloud workload identity. POST /api/auth/workload/github from CI to prove a short-lived token.",
		})
	}
	return out
}

func recordIdentityFinding(kind, name, provider string, details any) {
	if DB == nil || strings.TrimSpace(name) == "" {
		return
	}
	raw, _ := json.Marshal(details)
	_, _ = execContext(`
		INSERT INTO identity_findings (kind, name, provider, details_json, last_seen_at, updated_at)
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT (kind, name)
		DO UPDATE SET provider = EXCLUDED.provider, details_json = EXCLUDED.details_json, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
	`, kind, name, provider, string(raw))
}

func listIdentityFindings(limit int) []map[string]any {
	if DB == nil {
		return []map[string]any{}
	}
	if limit <= 0 {
		limit = 50
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT kind, name, COALESCE(provider,''), COALESCE(details_json,''), last_seen_at
		FROM identity_findings
		ORDER BY last_seen_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return []map[string]any{}
	}
	defer cancel()
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var kind, name, provider, details string
		var lastSeen time.Time
		if err := rows.Scan(&kind, &name, &provider, &details, &lastSeen); err != nil {
			continue
		}
		item := map[string]any{"kind": kind, "name": name, "provider": provider, "last_seen_at": lastSeen}
		if details != "" {
			var parsed any
			if json.Unmarshal([]byte(details), &parsed) == nil {
				item["details"] = parsed
			}
		}
		out = append(out, item)
	}
	return out
}

func devopsIdentityHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	payload := identityCatalogPayload()
	payload["status"] = "ok"
	payload["oidc_issuer"] = oidcIssuer()
	payload["oidc_audience"] = githubOIDCAudience()
	_ = json.NewEncoder(w).Encode(payload)
}
