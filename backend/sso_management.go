package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type ssoSettings struct {
	Provider               string     `json:"provider"`
	Enabled                bool       `json:"enabled"`
	SyncEnabled            bool       `json:"sync_enabled"`
	UserPortalEnabled      bool       `json:"user_portal_sso_enabled"`
	DevopsPortalEnabled    bool       `json:"devops_portal_sso_enabled"`
	SSOLoginURL            string     `json:"sso_login_url"`
	DirectoryUsersJSON     string     `json:"directory_users_json,omitempty"`
	LastSyncAt             *time.Time `json:"last_sync_at,omitempty"`
	UpdatedAt              *time.Time `json:"updated_at,omitempty"`
	DirectoryUsersJSONSize int        `json:"directory_users_json_size"`
}

type ssoDirectoryUser struct {
	ExternalID string
	Username   string
	Email      string
	UserType   string
	Role       string
}

func normalizeSSOProvider(provider string) string {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "azure", "azure_ad", "azuread", "microsoft":
		return "azure_ad"
	case "saml":
		return "saml"
	default:
		return "none"
	}
}

func defaultSSOSettings() ssoSettings {
	return ssoSettings{
		Provider:            "none",
		Enabled:             false,
		SyncEnabled:         false,
		UserPortalEnabled:   false,
		DevopsPortalEnabled: false,
		SSOLoginURL:         "",
		DirectoryUsersJSON:  "",
	}
}

func loadSSOSettings() (ssoSettings, error) {
	settings := defaultSSOSettings()
	if DB == nil {
		return settings, nil
	}
	var lastSyncAt sql.NullTime
	var updatedAt sql.NullTime
	err := DB.QueryRow(`
		SELECT
			COALESCE(provider, 'none'),
			COALESCE(enabled, false),
			COALESCE(sync_enabled, false),
			COALESCE(user_portal_sso_enabled, false),
			COALESCE(devops_portal_sso_enabled, false),
			COALESCE(sso_login_url, ''),
			COALESCE(directory_users_json, ''),
			last_sync_at,
			updated_at
		FROM sso_settings
		WHERE id = 1
	`).Scan(
		&settings.Provider,
		&settings.Enabled,
		&settings.SyncEnabled,
		&settings.UserPortalEnabled,
		&settings.DevopsPortalEnabled,
		&settings.SSOLoginURL,
		&settings.DirectoryUsersJSON,
		&lastSyncAt,
		&updatedAt,
	)
	if err == sql.ErrNoRows {
		settings.Provider = normalizeSSOProvider(settings.Provider)
		settings.Enabled = settings.UserPortalEnabled || settings.DevopsPortalEnabled
		settings.DirectoryUsersJSONSize = len(strings.TrimSpace(settings.DirectoryUsersJSON))
		return settings, nil
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return settings, nil
		}
		return settings, err
	}
	settings.Provider = normalizeSSOProvider(settings.Provider)
	settings.Enabled = settings.UserPortalEnabled || settings.DevopsPortalEnabled
	settings.SSOLoginURL = strings.TrimSpace(settings.SSOLoginURL)
	settings.DirectoryUsersJSON = strings.TrimSpace(settings.DirectoryUsersJSON)
	if lastSyncAt.Valid {
		ts := lastSyncAt.Time
		settings.LastSyncAt = &ts
	}
	if updatedAt.Valid {
		ts := updatedAt.Time
		settings.UpdatedAt = &ts
	}
	settings.DirectoryUsersJSONSize = len(settings.DirectoryUsersJSON)
	return settings, nil
}

func saveSSOSettings(settings ssoSettings, updatedBy int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	settings.Provider = normalizeSSOProvider(settings.Provider)
	settings.SSOLoginURL = strings.TrimSpace(settings.SSOLoginURL)
	settings.DirectoryUsersJSON = strings.TrimSpace(settings.DirectoryUsersJSON)
	settings.Enabled = settings.UserPortalEnabled || settings.DevopsPortalEnabled
	if settings.Provider == "none" {
		settings.Enabled = false
		settings.SyncEnabled = false
		settings.UserPortalEnabled = false
		settings.DevopsPortalEnabled = false
		settings.SSOLoginURL = ""
	}

	var updatedByValue interface{}
	if updatedBy > 0 {
		updatedByValue = updatedBy
	}

	_, err := DB.Exec(`
		INSERT INTO sso_settings (
			id,
			provider,
			enabled,
			sync_enabled,
			user_portal_sso_enabled,
			devops_portal_sso_enabled,
			sso_login_url,
			directory_users_json,
			updated_by,
			updated_at
		)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
		ON CONFLICT (id) DO UPDATE SET
			provider = EXCLUDED.provider,
			enabled = EXCLUDED.enabled,
			sync_enabled = EXCLUDED.sync_enabled,
			user_portal_sso_enabled = EXCLUDED.user_portal_sso_enabled,
			devops_portal_sso_enabled = EXCLUDED.devops_portal_sso_enabled,
			sso_login_url = EXCLUDED.sso_login_url,
			directory_users_json = EXCLUDED.directory_users_json,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`,
		settings.Provider,
		settings.Enabled,
		settings.SyncEnabled,
		settings.UserPortalEnabled,
		settings.DevopsPortalEnabled,
		settings.SSOLoginURL,
		settings.DirectoryUsersJSON,
		updatedByValue,
	)
	return err
}

func readDirectoryUsersSource(settings ssoSettings) string {
	if strings.TrimSpace(settings.DirectoryUsersJSON) != "" {
		return strings.TrimSpace(settings.DirectoryUsersJSON)
	}
	switch settings.Provider {
	case "azure_ad":
		if value := strings.TrimSpace(os.Getenv("AZURE_DIRECTORY_USERS_JSON")); value != "" {
			return value
		}
	case "saml":
		if value := strings.TrimSpace(os.Getenv("SAML_DIRECTORY_USERS_JSON")); value != "" {
			return value
		}
	}
	return strings.TrimSpace(os.Getenv("SSO_DIRECTORY_USERS_JSON"))
}

func pickStringValue(raw map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		case float64:
			if v > 0 {
				return strconv.FormatInt(int64(v), 10)
			}
		}
	}
	return ""
}

func normalizeUserType(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "devops_user") {
		return "devops_user"
	}
	return "portal_user"
}

func normalizeUserRole(value string) string {
	role := strings.TrimSpace(strings.ToLower(value))
	if role == "contributor" {
		return "contributor"
	}
	return "viewer"
}

func sanitizeUsername(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return ""
	}
	var b strings.Builder
	lastSeparator := false
	for _, r := range trimmed {
		isLetter := r >= 'a' && r <= 'z'
		isDigit := r >= '0' && r <= '9'
		if isLetter || isDigit || r == '_' || r == '-' || r == '.' {
			b.WriteRune(r)
			lastSeparator = false
			continue
		}
		if !lastSeparator {
			b.WriteByte('-')
			lastSeparator = true
		}
	}
	username := strings.Trim(b.String(), "-_.")
	if username == "" {
		return ""
	}
	if len(username) > 100 {
		username = username[:100]
	}
	return username
}

func parseDirectoryUsers(rawJSON string) ([]ssoDirectoryUser, error) {
	var decoded interface{}
	if err := json.Unmarshal([]byte(rawJSON), &decoded); err != nil {
		return nil, fmt.Errorf("invalid directory users json: %w", err)
	}

	var rawUsers []interface{}
	switch root := decoded.(type) {
	case []interface{}:
		rawUsers = root
	case map[string]interface{}:
		items, ok := root["users"].([]interface{})
		if !ok {
			return nil, fmt.Errorf("directory users payload must be an array or object with users[]")
		}
		rawUsers = items
	default:
		return nil, fmt.Errorf("directory users payload must be an array or object with users[]")
	}

	users := make([]ssoDirectoryUser, 0, len(rawUsers))
	for _, item := range rawUsers {
		record, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		externalID := pickStringValue(record, "external_id", "externalId", "id", "sub", "object_id", "objectId")
		email := strings.ToLower(pickStringValue(record, "email", "mail", "userPrincipalName", "user_principal_name"))
		username := sanitizeUsername(pickStringValue(record, "username", "userPrincipalName", "user_principal_name", "preferred_username", "name"))
		if username == "" && strings.Contains(email, "@") {
			username = sanitizeUsername(strings.SplitN(email, "@", 2)[0])
		}
		if externalID == "" {
			if email != "" {
				externalID = email
			} else {
				externalID = username
			}
		}
		if email == "" || username == "" || externalID == "" {
			continue
		}
		users = append(users, ssoDirectoryUser{
			ExternalID: externalID,
			Username:   username,
			Email:      email,
			UserType:   normalizeUserType(pickStringValue(record, "user_type", "userType", "type")),
			Role:       normalizeUserRole(pickStringValue(record, "role")),
		})
	}
	return users, nil
}

func randomSecret(length int) (string, error) {
	if length <= 0 {
		length = 24
	}
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = chars[int(buf[i])%len(chars)]
	}
	return string(buf), nil
}

func ensureUniqueUsername(base string) (string, error) {
	base = sanitizeUsername(base)
	if base == "" {
		base = "sso-user"
	}
	candidate := base
	for i := 0; i < 50; i++ {
		var exists int
		err := DB.QueryRow("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", candidate).Scan(&exists)
		if err == sql.ErrNoRows {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
		candidate = fmt.Sprintf("%s-%d", base, i+1)
		if len(candidate) > 100 {
			candidate = candidate[:100]
		}
	}
	return "", fmt.Errorf("failed to allocate unique username for %s", base)
}

func upsertSSODirectoryUser(provider string, user ssoDirectoryUser) (string, error) {
	provider = normalizeSSOProvider(provider)
	if provider == "none" {
		return "skipped", nil
	}
	user.Role = normalizeUserRole(user.Role)
	user.UserType = normalizeUserType(user.UserType)
	user.Email = strings.TrimSpace(strings.ToLower(user.Email))
	user.Username = sanitizeUsername(user.Username)
	user.ExternalID = strings.TrimSpace(user.ExternalID)
	if user.Username == "" || user.Email == "" || user.ExternalID == "" {
		return "skipped", nil
	}

	var existingID int
	err := DB.QueryRow(
		`SELECT id FROM users WHERE COALESCE(sso_provider, '') = $1 AND COALESCE(sso_external_id, '') = $2 LIMIT 1`,
		provider,
		user.ExternalID,
	).Scan(&existingID)
	if err == nil {
		_, updateErr := DB.Exec(
			`UPDATE users
			 SET username = $1,
			     email = $2,
			     verified = TRUE,
			     role = $3,
			     user_type = $4,
			     auth_source = 'sso',
			     sso_provider = $5,
			     sso_external_id = $6,
			     last_sso_sync_at = CURRENT_TIMESTAMP
			 WHERE id = $7`,
			user.Username,
			user.Email,
			user.Role,
			user.UserType,
			provider,
			user.ExternalID,
			existingID,
		)
		if updateErr != nil {
			return "", updateErr
		}
		return "updated", nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	var idByEmail int
	var roleByEmail string
	err = DB.QueryRow(
		`SELECT id, COALESCE(role, 'viewer') FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
		user.Email,
	).Scan(&idByEmail, &roleByEmail)
	if err == nil {
		if strings.EqualFold(roleByEmail, "admin") {
			return "skipped", nil
		}
		_, updateErr := DB.Exec(
			`UPDATE users
			 SET username = $1,
			     email = $2,
			     verified = TRUE,
			     role = $3,
			     user_type = $4,
			     auth_source = 'sso',
			     sso_provider = $5,
			     sso_external_id = $6,
			     last_sso_sync_at = CURRENT_TIMESTAMP
			 WHERE id = $7`,
			user.Username,
			user.Email,
			user.Role,
			user.UserType,
			provider,
			user.ExternalID,
			idByEmail,
		)
		if updateErr != nil {
			return "", updateErr
		}
		return "updated", nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	username, err := ensureUniqueUsername(user.Username)
	if err != nil {
		return "", err
	}
	secret, err := randomSecret(32)
	if err != nil {
		return "", err
	}
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	_, err = DB.Exec(
		`INSERT INTO users (
			username,
			email,
			password,
			verified,
			role,
			user_type,
			auth_source,
			sso_provider,
			sso_external_id,
			last_sso_sync_at
		)
		VALUES ($1, $2, $3, TRUE, $4, $5, 'sso', $6, $7, CURRENT_TIMESTAMP)`,
		username,
		user.Email,
		string(hashedPassword),
		user.Role,
		user.UserType,
		provider,
		user.ExternalID,
	)
	if err != nil {
		return "", err
	}
	return "created", nil
}

func adminSSOSettingsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	switch r.Method {
	case "GET":
		settings, err := loadSSOSettings()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "failed to load sso settings", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminTeamJSON(w, map[string]interface{}{
			"status":   "ok",
			"settings": settings,
		})
		return
	case "PUT", "PATCH":
		var req struct {
			Provider            string `json:"provider"`
			SyncEnabled         bool   `json:"sync_enabled"`
			UserPortalEnabled   bool   `json:"user_portal_sso_enabled"`
			DevopsPortalEnabled bool   `json:"devops_portal_sso_enabled"`
			SSOLoginURL         string `json:"sso_login_url"`
			DirectoryUsersJSON  string `json:"directory_users_json"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		settings := ssoSettings{
			Provider:            normalizeSSOProvider(req.Provider),
			SyncEnabled:         req.SyncEnabled,
			UserPortalEnabled:   req.UserPortalEnabled,
			DevopsPortalEnabled: req.DevopsPortalEnabled,
			SSOLoginURL:         strings.TrimSpace(req.SSOLoginURL),
			DirectoryUsersJSON:  strings.TrimSpace(req.DirectoryUsersJSON),
		}
		if err := saveSSOSettings(settings, adminID); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "failed to save sso settings", "status": "error"})
			return
		}
		AppendAuditLog(&adminID, "sso_settings_update", "sso", "1", settings.Provider)
		updated, err := loadSSOSettings()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "saved but failed to reload settings", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminTeamJSON(w, map[string]interface{}{
			"status":   "ok",
			"settings": updated,
		})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

func adminSSOSyncHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	settings, err := loadSSOSettings()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "failed to load sso settings", "status": "error"})
		return
	}
	if settings.Provider == "none" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "configure an SSO provider first", "status": "error"})
		return
	}
	if !settings.SyncEnabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "sso sync is disabled in settings", "status": "error"})
		return
	}

	source := readDirectoryUsersSource(settings)
	if source == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminTeamJSON(w, map[string]interface{}{
			"error":  "no directory users payload found. Save directory_users_json in admin settings or set SSO_DIRECTORY_USERS_JSON/AZURE_DIRECTORY_USERS_JSON/SAML_DIRECTORY_USERS_JSON.",
			"status": "error",
		})
		return
	}

	users, err := parseDirectoryUsers(source)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if len(users) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "directory users payload has no valid users", "status": "error"})
		return
	}

	created := 0
	updated := 0
	skipped := 0
	for _, user := range users {
		action, upsertErr := upsertSSODirectoryUser(settings.Provider, user)
		if upsertErr != nil {
			log.Printf("sso sync user failed provider=%s email=%s external_id=%s: %v", settings.Provider, user.Email, user.ExternalID, upsertErr)
			skipped++
			continue
		}
		switch action {
		case "created":
			created++
		case "updated":
			updated++
		default:
			skipped++
		}
	}

	var updatedBy interface{}
	if adminID > 0 {
		updatedBy = adminID
	}
	if _, err := DB.Exec(`UPDATE sso_settings SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by = $1 WHERE id = 1`, updatedBy); err != nil {
		log.Printf("sso sync: failed to update last_sync_at: %v", err)
	}

	AppendAuditLog(&adminID, "sso_sync_run", "sso", settings.Provider, fmt.Sprintf("created=%d updated=%d skipped=%d", created, updated, skipped))

	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{
		"status": "ok",
		"summary": map[string]int{
			"processed": len(users),
			"created":   created,
			"updated":   updated,
			"skipped":   skipped,
		},
	})
}

func publicSSOOptionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	settings, err := loadSSOSettings()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeJSON(w, map[string]interface{}{"error": "failed to load sso options", "status": "error"})
		return
	}
	portal := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("portal")))
	enabled := false
	switch portal {
	case "devops":
		enabled = settings.DevopsPortalEnabled
	case "user", "":
		enabled = settings.UserPortalEnabled
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeJSON(w, map[string]interface{}{"error": "invalid portal", "status": "error"})
		return
	}
	loginURL := settings.SSOLoginURL
	if loginURL == "" {
		switch settings.Provider {
		case "azure_ad":
			loginURL = strings.TrimSpace(os.Getenv("AZURE_SSO_LOGIN_URL"))
		case "saml":
			loginURL = strings.TrimSpace(os.Getenv("SAML_SSO_LOGIN_URL"))
		default:
			loginURL = strings.TrimSpace(os.Getenv("SSO_LOGIN_URL"))
		}
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status": "ok",
		"sso": map[string]interface{}{
			"enabled":  enabled,
			"provider": settings.Provider,
			"login_url": func() string {
				if enabled {
					return loginURL
				}
				return ""
			}(),
		},
	})
}
