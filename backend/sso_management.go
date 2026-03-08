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
	"sync/atomic"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	ssoModeDisabled = "disabled"
	ssoModeOptional = "optional"
	ssoModeRequired = "required"
)

var (
	ssoSyncInFlight    int32
	ssoSchedulerActive int32
)

type ssoSettings struct {
	Provider                  string     `json:"provider"`
	Enabled                   bool       `json:"enabled"`
	SyncEnabled               bool       `json:"sync_enabled"`
	UserPortalEnabled         bool       `json:"user_portal_sso_enabled"`
	DevopsPortalEnabled       bool       `json:"devops_portal_sso_enabled"`
	UserPortalMode            string     `json:"user_portal_sso_mode"`
	DevopsPortalMode          string     `json:"devops_portal_sso_mode"`
	SSOLoginURL               string     `json:"sso_login_url"`
	DirectoryUsersJSON        string     `json:"directory_users_json,omitempty"`
	BreakGlassAdminsJSON      string     `json:"break_glass_admins_json,omitempty"`
	GroupRoleMappingsJSON     string     `json:"group_role_mappings_json,omitempty"`
	GroupTeamMappingsJSON     string     `json:"group_team_mappings_json,omitempty"`
	DeprovisionMissingUsers   bool       `json:"deprovision_missing_users"`
	ScheduledSyncEnabled      bool       `json:"scheduled_sync_enabled"`
	SyncIntervalMinutes       int        `json:"sync_interval_minutes"`
	JITProvisionEnabled       bool       `json:"jit_provision_enabled"`
	RequireMFAClaim           bool       `json:"require_mfa_claim"`
	RequireVerifiedEmailClaim bool       `json:"require_verified_email_claim"`
	LastSyncAt                *time.Time `json:"last_sync_at,omitempty"`
	UpdatedAt                 *time.Time `json:"updated_at,omitempty"`
	DirectoryUsersJSONSize    int        `json:"directory_users_json_size"`
}

type ssoDirectoryUser struct {
	ExternalID string
	Username   string
	Email      string
	UserType   string
	Role       string
	Groups     []string
	Claims     map[string]interface{}
}

type ssoGroupRoleMapping struct {
	Group string `json:"group"`
	Role  string `json:"role"`
}

type ssoGroupTeamMapping struct {
	Group    string `json:"group"`
	TeamID   int    `json:"team_id,omitempty"`
	TeamSlug string `json:"team_slug,omitempty"`
	TeamRole string `json:"team_role,omitempty"`
}

type parsedSSOPolicy struct {
	BreakGlass         map[string]struct{}
	GroupRoleMappings  []ssoGroupRoleMapping
	GroupTeamMappings  []ssoGroupTeamMapping
	GroupRoleByGroup   map[string]string
	GroupTeamByGroup   map[string][]ssoGroupTeamMapping
	BreakGlassHasItems bool
}

type ssoSyncSummary struct {
	Processed     int `json:"processed"`
	Created       int `json:"created"`
	Updated       int `json:"updated"`
	Skipped       int `json:"skipped"`
	Deprovisioned int `json:"deprovisioned"`
}

type ssoLoginRequest struct {
	Portal     string                 `json:"portal"`
	Provider   string                 `json:"provider"`
	ExternalID string                 `json:"external_id"`
	Username   string                 `json:"username"`
	Email      string                 `json:"email"`
	UserType   string                 `json:"user_type"`
	Role       string                 `json:"role"`
	Groups     []string               `json:"groups"`
	Claims     map[string]interface{} `json:"claims"`
}

type ssoAuditEntry struct {
	ID            int       `json:"id"`
	AdminUserID   *int      `json:"admin_user_id,omitempty"`
	AdminUsername string    `json:"admin_username,omitempty"`
	Action        string    `json:"action"`
	ResourceType  string    `json:"resource_type"`
	ResourceID    string    `json:"resource_id"`
	Details       string    `json:"details"`
	CreatedAt     time.Time `json:"created_at"`
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

func normalizePortalMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case ssoModeRequired:
		return ssoModeRequired
	case ssoModeOptional:
		return ssoModeOptional
	default:
		return ssoModeDisabled
	}
}

func normalizePortalName(portal string) string {
	switch strings.TrimSpace(strings.ToLower(portal)) {
	case "devops":
		return "devops"
	case "admin":
		return "admin"
	default:
		return "user"
	}
}

func defaultSSOSettings() ssoSettings {
	return ssoSettings{
		Provider:                  "none",
		Enabled:                   false,
		SyncEnabled:               false,
		UserPortalEnabled:         false,
		DevopsPortalEnabled:       false,
		UserPortalMode:            ssoModeDisabled,
		DevopsPortalMode:          ssoModeDisabled,
		SSOLoginURL:               "",
		DirectoryUsersJSON:        "",
		BreakGlassAdminsJSON:      "[]",
		GroupRoleMappingsJSON:     "[]",
		GroupTeamMappingsJSON:     "[]",
		DeprovisionMissingUsers:   false,
		ScheduledSyncEnabled:      false,
		SyncIntervalMinutes:       60,
		JITProvisionEnabled:       false,
		RequireMFAClaim:           false,
		RequireVerifiedEmailClaim: false,
	}
}

func applyLegacyPortalFlags(settings *ssoSettings) {
	settings.UserPortalMode = normalizePortalMode(settings.UserPortalMode)
	settings.DevopsPortalMode = normalizePortalMode(settings.DevopsPortalMode)
	if settings.UserPortalMode == ssoModeDisabled && settings.UserPortalEnabled {
		settings.UserPortalMode = ssoModeOptional
	}
	if settings.DevopsPortalMode == ssoModeDisabled && settings.DevopsPortalEnabled {
		settings.DevopsPortalMode = ssoModeOptional
	}
	settings.UserPortalEnabled = settings.UserPortalMode != ssoModeDisabled
	settings.DevopsPortalEnabled = settings.DevopsPortalMode != ssoModeDisabled
	settings.Enabled = settings.UserPortalEnabled || settings.DevopsPortalEnabled
}

func normalizeSettings(settings *ssoSettings) {
	settings.Provider = normalizeSSOProvider(settings.Provider)
	settings.SSOLoginURL = strings.TrimSpace(settings.SSOLoginURL)
	settings.DirectoryUsersJSON = strings.TrimSpace(settings.DirectoryUsersJSON)
	settings.BreakGlassAdminsJSON = strings.TrimSpace(settings.BreakGlassAdminsJSON)
	settings.GroupRoleMappingsJSON = strings.TrimSpace(settings.GroupRoleMappingsJSON)
	settings.GroupTeamMappingsJSON = strings.TrimSpace(settings.GroupTeamMappingsJSON)
	if settings.BreakGlassAdminsJSON == "" {
		settings.BreakGlassAdminsJSON = "[]"
	}
	if settings.GroupRoleMappingsJSON == "" {
		settings.GroupRoleMappingsJSON = "[]"
	}
	if settings.GroupTeamMappingsJSON == "" {
		settings.GroupTeamMappingsJSON = "[]"
	}
	if settings.SyncIntervalMinutes < 5 {
		settings.SyncIntervalMinutes = 5
	}
	if settings.SyncIntervalMinutes > 1440 {
		settings.SyncIntervalMinutes = 1440
	}
	applyLegacyPortalFlags(settings)
	if settings.Provider == "none" {
		settings.SyncEnabled = false
		settings.UserPortalMode = ssoModeDisabled
		settings.DevopsPortalMode = ssoModeDisabled
		settings.UserPortalEnabled = false
		settings.DevopsPortalEnabled = false
		settings.Enabled = false
		settings.SSOLoginURL = ""
	}
	settings.DirectoryUsersJSONSize = len(settings.DirectoryUsersJSON)
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
			COALESCE(user_portal_sso_mode, CASE WHEN COALESCE(user_portal_sso_enabled, false) THEN 'optional' ELSE 'disabled' END),
			COALESCE(devops_portal_sso_mode, CASE WHEN COALESCE(devops_portal_sso_enabled, false) THEN 'optional' ELSE 'disabled' END),
			COALESCE(sso_login_url, ''),
			COALESCE(directory_users_json, ''),
			COALESCE(break_glass_admins_json, '[]'),
			COALESCE(group_role_mappings_json, '[]'),
			COALESCE(group_team_mappings_json, '[]'),
			COALESCE(deprovision_missing_users, false),
			COALESCE(scheduled_sync_enabled, false),
			COALESCE(sync_interval_minutes, 60),
			COALESCE(jit_provision_enabled, false),
			COALESCE(require_mfa_claim, false),
			COALESCE(require_verified_email_claim, false),
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
		&settings.UserPortalMode,
		&settings.DevopsPortalMode,
		&settings.SSOLoginURL,
		&settings.DirectoryUsersJSON,
		&settings.BreakGlassAdminsJSON,
		&settings.GroupRoleMappingsJSON,
		&settings.GroupTeamMappingsJSON,
		&settings.DeprovisionMissingUsers,
		&settings.ScheduledSyncEnabled,
		&settings.SyncIntervalMinutes,
		&settings.JITProvisionEnabled,
		&settings.RequireMFAClaim,
		&settings.RequireVerifiedEmailClaim,
		&lastSyncAt,
		&updatedAt,
	)
	if err == sql.ErrNoRows {
		normalizeSettings(&settings)
		return settings, nil
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return settings, nil
		}
		return settings, err
	}
	if lastSyncAt.Valid {
		ts := lastSyncAt.Time
		settings.LastSyncAt = &ts
	}
	if updatedAt.Valid {
		ts := updatedAt.Time
		settings.UpdatedAt = &ts
	}
	normalizeSettings(&settings)
	return settings, nil
}

func saveSSOSettings(settings ssoSettings, updatedBy int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	normalizeSettings(&settings)

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
			user_portal_sso_mode,
			devops_portal_sso_mode,
			sso_login_url,
			directory_users_json,
			break_glass_admins_json,
			group_role_mappings_json,
			group_team_mappings_json,
			deprovision_missing_users,
			scheduled_sync_enabled,
			sync_interval_minutes,
			jit_provision_enabled,
			require_mfa_claim,
			require_verified_email_claim,
			updated_by,
			updated_at
		)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
		ON CONFLICT (id) DO UPDATE SET
			provider = EXCLUDED.provider,
			enabled = EXCLUDED.enabled,
			sync_enabled = EXCLUDED.sync_enabled,
			user_portal_sso_enabled = EXCLUDED.user_portal_sso_enabled,
			devops_portal_sso_enabled = EXCLUDED.devops_portal_sso_enabled,
			user_portal_sso_mode = EXCLUDED.user_portal_sso_mode,
			devops_portal_sso_mode = EXCLUDED.devops_portal_sso_mode,
			sso_login_url = EXCLUDED.sso_login_url,
			directory_users_json = EXCLUDED.directory_users_json,
			break_glass_admins_json = EXCLUDED.break_glass_admins_json,
			group_role_mappings_json = EXCLUDED.group_role_mappings_json,
			group_team_mappings_json = EXCLUDED.group_team_mappings_json,
			deprovision_missing_users = EXCLUDED.deprovision_missing_users,
			scheduled_sync_enabled = EXCLUDED.scheduled_sync_enabled,
			sync_interval_minutes = EXCLUDED.sync_interval_minutes,
			jit_provision_enabled = EXCLUDED.jit_provision_enabled,
			require_mfa_claim = EXCLUDED.require_mfa_claim,
			require_verified_email_claim = EXCLUDED.require_verified_email_claim,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`,
		settings.Provider,
		settings.Enabled,
		settings.SyncEnabled,
		settings.UserPortalEnabled,
		settings.DevopsPortalEnabled,
		settings.UserPortalMode,
		settings.DevopsPortalMode,
		settings.SSOLoginURL,
		settings.DirectoryUsersJSON,
		settings.BreakGlassAdminsJSON,
		settings.GroupRoleMappingsJSON,
		settings.GroupTeamMappingsJSON,
		settings.DeprovisionMissingUsers,
		settings.ScheduledSyncEnabled,
		settings.SyncIntervalMinutes,
		settings.JITProvisionEnabled,
		settings.RequireMFAClaim,
		settings.RequireVerifiedEmailClaim,
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
	switch role {
	case "admin":
		return "admin"
	case "contributor":
		return "contributor"
	default:
		return "viewer"
	}
}

func normalizeTeamMemberRole(value string) string {
	role := strings.TrimSpace(strings.ToLower(value))
	if role == "" {
		return "member"
	}
	return role
}

func normalizeGroupValue(value string) string {
	return strings.TrimSpace(strings.ToLower(value))
}

func normalizeGroupList(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]struct{}{}
	for _, item := range in {
		v := normalizeGroupValue(item)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func parseGroups(record map[string]interface{}) []string {
	extract := func(value interface{}) []string {
		switch v := value.(type) {
		case string:
			parts := strings.Split(v, ",")
			out := make([]string, 0, len(parts))
			for _, part := range parts {
				if strings.TrimSpace(part) != "" {
					out = append(out, part)
				}
			}
			return out
		case []interface{}:
			out := make([]string, 0, len(v))
			for _, item := range v {
				if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
					out = append(out, str)
				}
			}
			return out
		default:
			return nil
		}
	}

	groups := []string{}
	for _, key := range []string{"groups", "group_ids", "groupIds", "roles"} {
		value, ok := record[key]
		if !ok {
			continue
		}
		groups = append(groups, extract(value)...)
	}
	return normalizeGroupList(groups)
}

func parseClaims(record map[string]interface{}) map[string]interface{} {
	claims := map[string]interface{}{}
	if rawClaims, ok := record["claims"].(map[string]interface{}); ok {
		for k, v := range rawClaims {
			claims[k] = v
		}
	}
	for _, key := range []string{"mfa", "email_verified", "verified_email", "amr", "acr"} {
		if value, ok := record[key]; ok {
			claims[key] = value
		}
	}
	return claims
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
			Groups:     parseGroups(record),
			Claims:     parseClaims(record),
		})
	}
	return users, nil
}

func parseStringArrayJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var items []string
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		v := strings.TrimSpace(strings.ToLower(item))
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func parseGroupRoleMappingsJSON(raw string) []ssoGroupRoleMapping {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var mappings []ssoGroupRoleMapping
	if err := json.Unmarshal([]byte(raw), &mappings); err != nil {
		return nil
	}
	out := make([]ssoGroupRoleMapping, 0, len(mappings))
	for _, item := range mappings {
		group := normalizeGroupValue(item.Group)
		role := normalizeUserRole(item.Role)
		if group == "" {
			continue
		}
		out = append(out, ssoGroupRoleMapping{
			Group: group,
			Role:  role,
		})
	}
	return out
}

func parseGroupTeamMappingsJSON(raw string) []ssoGroupTeamMapping {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var mappings []ssoGroupTeamMapping
	if err := json.Unmarshal([]byte(raw), &mappings); err != nil {
		return nil
	}
	out := make([]ssoGroupTeamMapping, 0, len(mappings))
	for _, item := range mappings {
		group := normalizeGroupValue(item.Group)
		slug := strings.TrimSpace(strings.ToLower(item.TeamSlug))
		if group == "" {
			continue
		}
		if item.TeamID <= 0 && slug == "" {
			continue
		}
		out = append(out, ssoGroupTeamMapping{
			Group:    group,
			TeamID:   item.TeamID,
			TeamSlug: slug,
			TeamRole: normalizeTeamMemberRole(item.TeamRole),
		})
	}
	return out
}

func parseSSOPolicy(settings ssoSettings) parsedSSOPolicy {
	policy := parsedSSOPolicy{
		BreakGlass:       map[string]struct{}{},
		GroupRoleByGroup: map[string]string{},
		GroupTeamByGroup: map[string][]ssoGroupTeamMapping{},
	}

	for _, value := range parseStringArrayJSON(settings.BreakGlassAdminsJSON) {
		policy.BreakGlass[value] = struct{}{}
	}
	if envUsers := strings.TrimSpace(os.Getenv("SSO_BREAK_GLASS_USERS")); envUsers != "" {
		for _, item := range strings.Split(envUsers, ",") {
			value := strings.TrimSpace(strings.ToLower(item))
			if value != "" {
				policy.BreakGlass[value] = struct{}{}
			}
		}
	}
	policy.BreakGlassHasItems = len(policy.BreakGlass) > 0

	policy.GroupRoleMappings = parseGroupRoleMappingsJSON(settings.GroupRoleMappingsJSON)
	for _, item := range policy.GroupRoleMappings {
		policy.GroupRoleByGroup[item.Group] = item.Role
	}

	policy.GroupTeamMappings = parseGroupTeamMappingsJSON(settings.GroupTeamMappingsJSON)
	for _, item := range policy.GroupTeamMappings {
		policy.GroupTeamByGroup[item.Group] = append(policy.GroupTeamByGroup[item.Group], item)
	}

	return policy
}

func isBreakGlassUser(policy parsedSSOPolicy, username, email, role string) bool {
	if !strings.EqualFold(strings.TrimSpace(role), "admin") {
		return false
	}
	if !policy.BreakGlassHasItems {
		return true
	}
	username = strings.TrimSpace(strings.ToLower(username))
	email = strings.TrimSpace(strings.ToLower(email))
	if _, ok := policy.BreakGlass[username]; ok {
		return true
	}
	if _, ok := policy.BreakGlass[email]; ok {
		return true
	}
	return false
}

func ssoModeForPortal(settings ssoSettings, portal string) string {
	switch normalizePortalName(portal) {
	case "devops":
		return normalizePortalMode(settings.DevopsPortalMode)
	case "admin":
		return ssoModeDisabled
	default:
		return normalizePortalMode(settings.UserPortalMode)
	}
}

func findSSOUserByProviderExternalID(provider, externalID string) (int, error) {
	if DB == nil {
		return 0, sql.ErrNoRows
	}
	var userID int
	err := DB.QueryRow(
		`SELECT id
		 FROM users
		 WHERE COALESCE(sso_provider, '') = $1
		   AND COALESCE(sso_external_id, '') = $2
		 LIMIT 1`,
		provider,
		externalID,
	).Scan(&userID)
	return userID, err
}

func findUserByEmail(email string) (id int, role string, authSource string, err error) {
	if DB == nil {
		return 0, "", "", sql.ErrNoRows
	}
	err = DB.QueryRow(
		`SELECT id, COALESCE(role, 'viewer'), COALESCE(auth_source, 'local')
		 FROM users
		 WHERE LOWER(email) = LOWER($1)
		 LIMIT 1`,
		email,
	).Scan(&id, &role, &authSource)
	return id, role, authSource, err
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

func rolePriority(role string) int {
	switch normalizeUserRole(role) {
	case "admin":
		return 3
	case "contributor":
		return 2
	default:
		return 1
	}
}

func resolveMappedRole(groups []string, fallbackRole string, policy parsedSSOPolicy) string {
	bestRole := normalizeUserRole(fallbackRole)
	bestPriority := rolePriority(bestRole)
	for _, group := range groups {
		if mappedRole, ok := policy.GroupRoleByGroup[group]; ok {
			p := rolePriority(mappedRole)
			if p > bestPriority {
				bestPriority = p
				bestRole = mappedRole
			}
		}
	}
	return bestRole
}

func resolveTeamID(mapping ssoGroupTeamMapping, cache map[string]int) (int, error) {
	if mapping.TeamID > 0 {
		return mapping.TeamID, nil
	}
	if mapping.TeamSlug == "" {
		return 0, nil
	}
	if id, ok := cache[mapping.TeamSlug]; ok {
		return id, nil
	}
	var teamID int
	err := DB.QueryRow(`SELECT id FROM teams WHERE LOWER(slug) = LOWER($1) LIMIT 1`, mapping.TeamSlug).Scan(&teamID)
	if err == sql.ErrNoRows {
		cache[mapping.TeamSlug] = 0
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	cache[mapping.TeamSlug] = teamID
	return teamID, nil
}

func applyGroupTeamMappings(userID int, groups []string, policy parsedSSOPolicy) (int, error) {
	if DB == nil || userID <= 0 {
		return 0, nil
	}
	if len(policy.GroupTeamByGroup) == 0 || len(groups) == 0 {
		return 0, nil
	}
	cache := map[string]int{}
	applied := 0
	seenTeam := map[int]struct{}{}
	for _, group := range groups {
		mappings := policy.GroupTeamByGroup[group]
		for _, mapping := range mappings {
			teamID, err := resolveTeamID(mapping, cache)
			if err != nil {
				return applied, err
			}
			if teamID <= 0 {
				continue
			}
			if _, exists := seenTeam[teamID]; exists {
				continue
			}
			seenTeam[teamID] = struct{}{}
			if _, err := DB.Exec(
				`INSERT INTO team_members (team_id, user_id, role)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
				teamID,
				userID,
				normalizeTeamMemberRole(mapping.TeamRole),
			); err != nil {
				return applied, err
			}
			applied++
		}
	}
	return applied, nil
}

func upsertSSODirectoryUser(settings ssoSettings, policy parsedSSOPolicy, user ssoDirectoryUser, allowCreate bool) (int, string, error) {
	provider := normalizeSSOProvider(settings.Provider)
	if provider == "none" {
		return 0, "skipped", nil
	}
	user.Role = normalizeUserRole(user.Role)
	user.UserType = normalizeUserType(user.UserType)
	user.Email = strings.TrimSpace(strings.ToLower(user.Email))
	user.Username = sanitizeUsername(user.Username)
	user.ExternalID = strings.TrimSpace(user.ExternalID)
	user.Groups = normalizeGroupList(user.Groups)
	if user.Username == "" || user.Email == "" || user.ExternalID == "" {
		return 0, "skipped", nil
	}

	targetRole := resolveMappedRole(user.Groups, user.Role, policy)

	var existingID int
	err := DB.QueryRow(
		`SELECT id FROM users WHERE COALESCE(sso_provider, '') = $1 AND COALESCE(sso_external_id, '') = $2 LIMIT 1`,
		provider,
		user.ExternalID,
	).Scan(&existingID)
	if err == nil {
		var existingRole string
		var existingAuthSource string
		var existingUsername string
		var existingEmail string
		if scanErr := DB.QueryRow(`SELECT COALESCE(role, 'viewer'), COALESCE(auth_source, 'local'), COALESCE(username, ''), COALESCE(email, '') FROM users WHERE id = $1`, existingID).Scan(&existingRole, &existingAuthSource, &existingUsername, &existingEmail); scanErr != nil {
			return 0, "", scanErr
		}
		if strings.EqualFold(existingAuthSource, "local") && strings.EqualFold(existingRole, "admin") && isBreakGlassUser(policy, existingUsername, existingEmail, existingRole) {
			return existingID, "skipped", nil
		}
		if _, updateErr := DB.Exec(
			`UPDATE users
			 SET username = $1,
			     email = $2,
			     verified = TRUE,
			     role = $3,
			     user_type = $4,
			     auth_source = 'sso',
			     sso_provider = $5,
			     sso_external_id = $6,
			     sso_active = TRUE,
			     last_sso_sync_at = CURRENT_TIMESTAMP
			 WHERE id = $7`,
			user.Username,
			user.Email,
			targetRole,
			user.UserType,
			provider,
			user.ExternalID,
			existingID,
		); updateErr != nil {
			return 0, "", updateErr
		}
		if _, err := applyGroupTeamMappings(existingID, user.Groups, policy); err != nil {
			return 0, "", err
		}
		return existingID, "updated", nil
	}
	if err != sql.ErrNoRows {
		return 0, "", err
	}

	var idByEmail int
	var roleByEmail string
	var authSourceByEmail string
	var usernameByEmail string
	var emailByEmail string
	err = DB.QueryRow(
		`SELECT id, COALESCE(role, 'viewer'), COALESCE(auth_source, 'local'), COALESCE(username,''), COALESCE(email,'')
		 FROM users
		 WHERE LOWER(email) = LOWER($1)
		 LIMIT 1`,
		user.Email,
	).Scan(&idByEmail, &roleByEmail, &authSourceByEmail, &usernameByEmail, &emailByEmail)
	if err == nil {
		if strings.EqualFold(roleByEmail, "admin") && strings.EqualFold(authSourceByEmail, "local") && isBreakGlassUser(policy, usernameByEmail, emailByEmail, roleByEmail) {
			return idByEmail, "skipped", nil
		}
		if _, updateErr := DB.Exec(
			`UPDATE users
			 SET username = $1,
			     email = $2,
			     verified = TRUE,
			     role = $3,
			     user_type = $4,
			     auth_source = 'sso',
			     sso_provider = $5,
			     sso_external_id = $6,
			     sso_active = TRUE,
			     last_sso_sync_at = CURRENT_TIMESTAMP
			 WHERE id = $7`,
			user.Username,
			user.Email,
			targetRole,
			user.UserType,
			provider,
			user.ExternalID,
			idByEmail,
		); updateErr != nil {
			return 0, "", updateErr
		}
		if _, err := applyGroupTeamMappings(idByEmail, user.Groups, policy); err != nil {
			return 0, "", err
		}
		return idByEmail, "updated", nil
	}
	if err != sql.ErrNoRows {
		return 0, "", err
	}
	if !allowCreate {
		return 0, "skipped", fmt.Errorf("jit provisioning is disabled for this SSO policy")
	}

	username, err := ensureUniqueUsername(user.Username)
	if err != nil {
		return 0, "", err
	}
	secret, err := randomSecret(32)
	if err != nil {
		return 0, "", err
	}
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		return 0, "", err
	}
	var newID int
	err = DB.QueryRow(
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
			sso_active,
			last_sso_sync_at
		)
		VALUES ($1, $2, $3, TRUE, $4, $5, 'sso', $6, $7, TRUE, CURRENT_TIMESTAMP)
		RETURNING id`,
		username,
		user.Email,
		string(hashedPassword),
		targetRole,
		user.UserType,
		provider,
		user.ExternalID,
	).Scan(&newID)
	if err != nil {
		return 0, "", err
	}
	if _, err := applyGroupTeamMappings(newID, user.Groups, policy); err != nil {
		return 0, "", err
	}
	return newID, "created", nil
}

func deprovisionMissingSSOUsers(provider string, externalIDs map[string]struct{}) (int, error) {
	if DB == nil {
		return 0, nil
	}
	rows, err := DB.Query(
		`SELECT id, COALESCE(sso_external_id, '')
		 FROM users
		 WHERE COALESCE(auth_source, '') = 'sso'
		   AND COALESCE(sso_provider, '') = $1
		   AND COALESCE(sso_external_id, '') != ''
		   AND COALESCE(sso_active, TRUE) = TRUE`,
		provider,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type candidate struct {
		UserID     int
		ExternalID string
	}
	candidates := []candidate{}
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.UserID, &c.ExternalID); err != nil {
			return 0, err
		}
		c.ExternalID = strings.TrimSpace(c.ExternalID)
		candidates = append(candidates, c)
	}

	deprovisioned := 0
	for _, c := range candidates {
		if _, ok := externalIDs[c.ExternalID]; ok {
			continue
		}
		if _, err := DB.Exec(
			`UPDATE users
			 SET sso_active = FALSE,
			     last_sso_sync_at = CURRENT_TIMESTAMP
			 WHERE id = $1`,
			c.UserID,
		); err != nil {
			return deprovisioned, err
		}
		if _, err := DB.Exec(`DELETE FROM team_members WHERE user_id = $1`, c.UserID); err != nil {
			return deprovisioned, err
		}
		userID := c.UserID
		AppendUserActivity(&userID, "sso_deprovision", "user", strconv.Itoa(c.UserID), fmt.Sprintf("provider=%s", provider))
		deprovisioned++
	}
	return deprovisioned, nil
}

func executeSSODirectorySync(settings ssoSettings, actorUserID *int, trigger string) (ssoSyncSummary, error) {
	summary := ssoSyncSummary{}
	if DB == nil {
		return summary, fmt.Errorf("database not available")
	}
	if settings.Provider == "none" {
		return summary, fmt.Errorf("configure an SSO provider first")
	}
	if !settings.SyncEnabled {
		return summary, fmt.Errorf("sso sync is disabled in settings")
	}
	source := readDirectoryUsersSource(settings)
	if source == "" {
		return summary, fmt.Errorf("no directory users payload found. save directory_users_json or set SSO_DIRECTORY_USERS_JSON/AZURE_DIRECTORY_USERS_JSON/SAML_DIRECTORY_USERS_JSON")
	}
	users, err := parseDirectoryUsers(source)
	if err != nil {
		return summary, err
	}
	if len(users) == 0 {
		return summary, fmt.Errorf("directory users payload has no valid users")
	}

	policy := parseSSOPolicy(settings)
	activeExternalIDs := map[string]struct{}{}
	for _, user := range users {
		activeExternalIDs[strings.TrimSpace(user.ExternalID)] = struct{}{}
		userID, action, upsertErr := upsertSSODirectoryUser(settings, policy, user, true)
		if upsertErr != nil {
			log.Printf("sso sync user failed provider=%s email=%s external_id=%s: %v", settings.Provider, user.Email, user.ExternalID, upsertErr)
			summary.Skipped++
			continue
		}
		switch action {
		case "created":
			summary.Created++
			if userID > 0 {
				AppendUserActivity(&userID, "sso_sync_create", "user", strconv.Itoa(userID), fmt.Sprintf("provider=%s", settings.Provider))
			}
		case "updated":
			summary.Updated++
			if userID > 0 {
				AppendUserActivity(&userID, "sso_sync_update", "user", strconv.Itoa(userID), fmt.Sprintf("provider=%s", settings.Provider))
			}
		default:
			summary.Skipped++
		}
	}
	summary.Processed = len(users)

	if settings.DeprovisionMissingUsers {
		deprovisioned, depErr := deprovisionMissingSSOUsers(settings.Provider, activeExternalIDs)
		if depErr != nil {
			return summary, depErr
		}
		summary.Deprovisioned = deprovisioned
	}

	var updatedBy interface{}
	if actorUserID != nil && *actorUserID > 0 {
		updatedBy = *actorUserID
	}
	if _, err := DB.Exec(
		`UPDATE sso_settings
		 SET last_sync_at = CURRENT_TIMESTAMP,
		     updated_at = CURRENT_TIMESTAMP,
		     updated_by = $1
		 WHERE id = 1`,
		updatedBy,
	); err != nil {
		log.Printf("sso sync: failed to update last_sync_at: %v", err)
	}

	AppendAuditLog(actorUserID, "sso_sync_run", "sso", settings.Provider, fmt.Sprintf("trigger=%s processed=%d created=%d updated=%d skipped=%d deprovisioned=%d", trigger, summary.Processed, summary.Created, summary.Updated, summary.Skipped, summary.Deprovisioned))
	return summary, nil
}

func runSSOSyncWithLock(settings ssoSettings, actorUserID *int, trigger string) (ssoSyncSummary, error) {
	if !atomic.CompareAndSwapInt32(&ssoSyncInFlight, 0, 1) {
		return ssoSyncSummary{}, fmt.Errorf("sso sync is already in progress")
	}
	defer atomic.StoreInt32(&ssoSyncInFlight, 0)
	return executeSSODirectorySync(settings, actorUserID, trigger)
}

func shouldRunScheduledSync(settings ssoSettings) bool {
	if !settings.SyncEnabled || !settings.ScheduledSyncEnabled {
		return false
	}
	if settings.Provider == "none" {
		return false
	}
	if settings.LastSyncAt == nil {
		return true
	}
	interval := settings.SyncIntervalMinutes
	if interval < 5 {
		interval = 5
	}
	return time.Since(*settings.LastSyncAt) >= time.Duration(interval)*time.Minute
}

func startSSOSyncScheduler() {
	if !atomic.CompareAndSwapInt32(&ssoSchedulerActive, 0, 1) {
		return
	}
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if DB == nil {
				continue
			}
			settings, err := loadSSOSettings()
			if err != nil {
				log.Printf("sso scheduler: settings load failed: %v", err)
				continue
			}
			if !shouldRunScheduledSync(settings) {
				continue
			}
			summary, err := runSSOSyncWithLock(settings, nil, "scheduler")
			if err != nil {
				log.Printf("sso scheduler: sync failed: %v", err)
				continue
			}
			log.Printf("sso scheduler: processed=%d created=%d updated=%d skipped=%d deprovisioned=%d", summary.Processed, summary.Created, summary.Updated, summary.Skipped, summary.Deprovisioned)
		}
	}()
}

func checkBoolClaim(claims map[string]interface{}, keys ...string) bool {
	for _, key := range keys {
		raw, ok := claims[key]
		if !ok {
			continue
		}
		switch v := raw.(type) {
		case bool:
			if v {
				return true
			}
		case string:
			switch strings.TrimSpace(strings.ToLower(v)) {
			case "1", "true", "yes", "y", "mfa":
				return true
			}
		case float64:
			if int(v) == 1 {
				return true
			}
		}
	}
	return false
}

func claimsContainMFA(claims map[string]interface{}) bool {
	if checkBoolClaim(claims, "mfa", "has_mfa", "multi_factor") {
		return true
	}
	for _, key := range []string{"amr", "acr"} {
		raw, ok := claims[key]
		if !ok {
			continue
		}
		switch v := raw.(type) {
		case string:
			val := strings.TrimSpace(strings.ToLower(v))
			if strings.Contains(val, "mfa") {
				return true
			}
		case []interface{}:
			for _, item := range v {
				str, ok := item.(string)
				if !ok {
					continue
				}
				if strings.Contains(strings.TrimSpace(strings.ToLower(str)), "mfa") {
					return true
				}
			}
		}
	}
	return false
}

func validateSSOClaims(settings ssoSettings, claims map[string]interface{}) error {
	if settings.RequireVerifiedEmailClaim {
		if !checkBoolClaim(claims, "email_verified", "verified_email") {
			return fmt.Errorf("verified email claim is required")
		}
	}
	if settings.RequireMFAClaim {
		if !claimsContainMFA(claims) {
			return fmt.Errorf("mfa claim is required")
		}
	}
	return nil
}

func portalRequiredSSO(settings ssoSettings, portal string) bool {
	return ssoModeForPortal(settings, portal) == ssoModeRequired
}

func enforcePortalSSOPolicyForPasswordLogin(portal string, user *User, authSource string, ssoActive bool) error {
	if user == nil {
		return nil
	}
	if strings.EqualFold(strings.TrimSpace(authSource), "sso") && !ssoActive {
		return fmt.Errorf("account deprovisioned from SSO directory. contact administrator")
	}

	normalizedPortal := normalizePortalName(portal)
	if normalizedPortal == "admin" {
		return nil
	}

	settings, err := loadSSOSettings()
	if err != nil {
		return nil
	}
	policy := parseSSOPolicy(settings)
	if strings.EqualFold(strings.TrimSpace(authSource), "sso") && ssoModeForPortal(settings, normalizedPortal) != ssoModeDisabled && !isBreakGlassUser(policy, user.Username, user.Email, user.Role) {
		return fmt.Errorf("local password sign-in is disabled for SSO-managed users on this portal")
	}
	if portalRequiredSSO(settings, normalizedPortal) && !isBreakGlassUser(policy, user.Username, user.Email, user.Role) {
		return fmt.Errorf("sso login is required for this portal")
	}
	return nil
}

func loadSSOAuditEntries(limit int) ([]ssoAuditEntry, error) {
	if DB == nil {
		return []ssoAuditEntry{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := DB.Query(
		`SELECT
			a.id,
			a.admin_user_id,
			COALESCE(u.username, ''),
			COALESCE(a.action, ''),
			COALESCE(a.resource_type, ''),
			COALESCE(a.resource_id, ''),
			COALESCE(a.details, ''),
			a.created_at
		 FROM admin_audit_log a
		 LEFT JOIN users u ON u.id = a.admin_user_id
		 WHERE a.action LIKE 'sso_%'
		    OR a.action LIKE 'sso-login-%'
		 ORDER BY a.created_at DESC, a.id DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return []ssoAuditEntry{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	entries := []ssoAuditEntry{}
	for rows.Next() {
		var item ssoAuditEntry
		var adminUserID sql.NullInt64
		if err := rows.Scan(&item.ID, &adminUserID, &item.AdminUsername, &item.Action, &item.ResourceType, &item.ResourceID, &item.Details, &item.CreatedAt); err != nil {
			return nil, err
		}
		if adminUserID.Valid {
			id := int(adminUserID.Int64)
			item.AdminUserID = &id
		}
		entries = append(entries, item)
	}
	return entries, nil
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
			Provider                  string `json:"provider"`
			SyncEnabled               bool   `json:"sync_enabled"`
			UserPortalEnabled         bool   `json:"user_portal_sso_enabled"`
			DevopsPortalEnabled       bool   `json:"devops_portal_sso_enabled"`
			UserPortalMode            string `json:"user_portal_sso_mode"`
			DevopsPortalMode          string `json:"devops_portal_sso_mode"`
			SSOLoginURL               string `json:"sso_login_url"`
			DirectoryUsersJSON        string `json:"directory_users_json"`
			BreakGlassAdminsJSON      string `json:"break_glass_admins_json"`
			GroupRoleMappingsJSON     string `json:"group_role_mappings_json"`
			GroupTeamMappingsJSON     string `json:"group_team_mappings_json"`
			DeprovisionMissingUsers   bool   `json:"deprovision_missing_users"`
			ScheduledSyncEnabled      bool   `json:"scheduled_sync_enabled"`
			SyncIntervalMinutes       int    `json:"sync_interval_minutes"`
			JITProvisionEnabled       bool   `json:"jit_provision_enabled"`
			RequireMFAClaim           bool   `json:"require_mfa_claim"`
			RequireVerifiedEmailClaim bool   `json:"require_verified_email_claim"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		settings := ssoSettings{
			Provider:                  normalizeSSOProvider(req.Provider),
			SyncEnabled:               req.SyncEnabled,
			UserPortalEnabled:         req.UserPortalEnabled,
			DevopsPortalEnabled:       req.DevopsPortalEnabled,
			UserPortalMode:            req.UserPortalMode,
			DevopsPortalMode:          req.DevopsPortalMode,
			SSOLoginURL:               strings.TrimSpace(req.SSOLoginURL),
			DirectoryUsersJSON:        strings.TrimSpace(req.DirectoryUsersJSON),
			BreakGlassAdminsJSON:      strings.TrimSpace(req.BreakGlassAdminsJSON),
			GroupRoleMappingsJSON:     strings.TrimSpace(req.GroupRoleMappingsJSON),
			GroupTeamMappingsJSON:     strings.TrimSpace(req.GroupTeamMappingsJSON),
			DeprovisionMissingUsers:   req.DeprovisionMissingUsers,
			ScheduledSyncEnabled:      req.ScheduledSyncEnabled,
			SyncIntervalMinutes:       req.SyncIntervalMinutes,
			JITProvisionEnabled:       req.JITProvisionEnabled,
			RequireMFAClaim:           req.RequireMFAClaim,
			RequireVerifiedEmailClaim: req.RequireVerifiedEmailClaim,
		}
		if normalizePortalMode(settings.UserPortalMode) == ssoModeDisabled && settings.UserPortalEnabled {
			settings.UserPortalMode = ssoModeOptional
		}
		if normalizePortalMode(settings.DevopsPortalMode) == ssoModeDisabled && settings.DevopsPortalEnabled {
			settings.DevopsPortalMode = ssoModeOptional
		}
		if err := saveSSOSettings(settings, adminID); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminTeamJSON(w, map[string]interface{}{"error": "failed to save sso settings", "status": "error"})
			return
		}
		AppendAuditLog(&adminID, "sso_settings_update", "sso", "1", fmt.Sprintf("provider=%s user_mode=%s devops_mode=%s", normalizeSSOProvider(req.Provider), normalizePortalMode(settings.UserPortalMode), normalizePortalMode(settings.DevopsPortalMode)))
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
	summary, err := runSSOSyncWithLock(settings, &adminID, "manual")
	if err != nil {
		statusCode := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "already in progress") {
			statusCode = http.StatusConflict
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{
		"status":  "ok",
		"summary": summary,
	})
}

func adminSSOAuditHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	entries, err := loadSSOAuditEntries(limit)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAdminTeamJSON(w, map[string]interface{}{"error": "failed to load sso audit trail", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, map[string]interface{}{
		"status":  "ok",
		"entries": entries,
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
	portal := normalizePortalName(r.URL.Query().Get("portal"))
	mode := ssoModeForPortal(settings, portal)

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
			"enabled":  mode != ssoModeDisabled,
			"mode":     mode,
			"provider": settings.Provider,
			"login_url": func() string {
				if mode == ssoModeDisabled {
					return ""
				}
				return loginURL
			}(),
			"claim_requirements": map[string]bool{
				"mfa":            settings.RequireMFAClaim,
				"verified_email": settings.RequireVerifiedEmailClaim,
			},
		},
	})
}

func authSSOLoginHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAuthJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	if sharedSecret := strings.TrimSpace(os.Getenv("SSO_AUTH_SHARED_SECRET")); sharedSecret != "" {
		if strings.TrimSpace(r.Header.Get("X-SSO-Auth-Secret")) != sharedSecret {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			encodeAuthJSON(w, map[string]interface{}{"error": "invalid sso auth secret", "status": "error"})
			return
		}
	}

	var req ssoLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}

	settings, err := loadSSOSettings()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to load sso settings", "status": "error"})
		return
	}

	portal := normalizePortalName(req.Portal)
	mode := ssoModeForPortal(settings, portal)
	if mode == ssoModeDisabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "sso login is disabled for this portal", "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "portal mode disabled")
		return
	}
	provider := normalizeSSOProvider(req.Provider)
	if provider == "none" {
		provider = normalizeSSOProvider(settings.Provider)
	}
	if provider == "none" || provider != normalizeSSOProvider(settings.Provider) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": "invalid sso provider", "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "provider mismatch")
		return
	}

	if req.Claims == nil {
		req.Claims = map[string]interface{}{}
	}
	if err := validateSSOClaims(settings, req.Claims); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "claims failed: "+err.Error())
		return
	}

	policy := parseSSOPolicy(settings)
	user := ssoDirectoryUser{
		ExternalID: strings.TrimSpace(req.ExternalID),
		Username:   sanitizeUsername(req.Username),
		Email:      strings.TrimSpace(strings.ToLower(req.Email)),
		UserType:   normalizeUserType(req.UserType),
		Role:       normalizeUserRole(req.Role),
		Groups:     normalizeGroupList(req.Groups),
		Claims:     req.Claims,
	}
	if user.ExternalID == "" {
		if user.Email != "" {
			user.ExternalID = user.Email
		} else {
			user.ExternalID = user.Username
		}
	}
	if user.UserType == "" {
		if portal == "devops" {
			user.UserType = "devops_user"
		} else {
			user.UserType = "portal_user"
		}
	}

	existingUserID := 0
	if user.ExternalID != "" {
		if foundID, findErr := findSSOUserByProviderExternalID(provider, user.ExternalID); findErr == nil {
			existingUserID = foundID
		}
	}
	if existingUserID == 0 && user.Email != "" {
		if idByEmail, _, _, findErr := findUserByEmail(user.Email); findErr == nil {
			existingUserID = idByEmail
		}
	}
	if existingUserID == 0 && !settings.JITProvisionEnabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "jit provisioning is disabled. run directory sync first", "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "jit disabled")
		return
	}

	userID, action, err := upsertSSODirectoryUser(settings, policy, user, settings.JITProvisionEnabled)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAuthJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "upsert failed: "+err.Error())
		return
	}
	if userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeAuthJSON(w, map[string]interface{}{"error": "sso user not allowed", "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "no user id")
		return
	}

	fullUser, err := GetUserByID(userID)
	if err != nil || fullUser == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeAuthJSON(w, map[string]interface{}{"error": "failed to load user", "status": "error"})
		AppendAuditLog(nil, "sso-login-denied", "sso", portal, "failed to load user")
		return
	}

	token := generateToken(userID)
	timeoutMins := 24 * 60
	if m := os.Getenv("SESSION_TIMEOUT_MINUTES"); m != "" {
		if n, _ := strconv.Atoi(m); n > 0 {
			timeoutMins = n
		}
	}
	userIDForActivity := userID
	AppendUserActivity(&userIDForActivity, "sso_login", "user", strconv.Itoa(userID), fmt.Sprintf("provider=%s portal=%s action=%s", provider, portal, action))
	AppendAuditLog(nil, "sso-login-success", "sso", strconv.Itoa(userID), fmt.Sprintf("provider=%s portal=%s action=%s", provider, portal, action))

	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"status":     "ok",
		"token":      token,
		"user":       fullUser,
		"expires_at": time.Now().Add(time.Duration(timeoutMins) * time.Minute),
		"sso": map[string]interface{}{
			"provider": provider,
			"portal":   portal,
			"action":   action,
		},
	})
}
