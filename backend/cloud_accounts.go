package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type cloudAccountRecord struct {
	ID                   int        `json:"id"`
	Provider             string     `json:"provider"`
	AccountID            string     `json:"account_id"`
	DisplayName          string     `json:"display_name"`
	TeamSlug             string     `json:"team_slug"`
	ProjectID            int        `json:"project_id,omitempty"`
	ProjectName          string     `json:"project_name,omitempty"`
	ProjectCode          string     `json:"project_code,omitempty"`
	Environments         []string   `json:"environments"`
	AuthMode             string     `json:"auth_mode"`
	RoleARNSet           bool       `json:"role_arn_set"`
	ExternalIDSet        bool       `json:"external_id_set"`
	SecretRefSet         bool       `json:"secret_ref_set"`
	CredentialsEncrypted bool       `json:"credentials_encrypted"`
	Status               string     `json:"status"`
	LastError            string     `json:"last_error,omitempty"`
	LastTestAt           *time.Time `json:"last_test_at,omitempty"`
	OnboardedBy          *int       `json:"onboarded_by,omitempty"`
	OnboardedByName      string     `json:"onboarded_by_username,omitempty"`
	DisabledAt           *time.Time `json:"disabled_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

func normalizeCloudProvider(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "aws", "azure", "gcp":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "aws"
	}
}

func normalizeCloudAccountAuthMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "static_ref", "assume_role":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "assume_role"
	}
}

func parseEnvironmentsJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	clean := make([]string, 0, len(out))
	for _, env := range out {
		env = strings.TrimSpace(env)
		if env != "" {
			clean = append(clean, env)
		}
	}
	return clean
}

func encodeEnvironmentsJSON(envs []string) string {
	if len(envs) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(envs)
	return string(b)
}

func devopsCloudAccountsRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/cloud/accounts"), "/")
	if path == "" {
		devopsCloudAccountsListHandler(w, r)
		return
	}
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid account id", err)
		return
	}
	if len(parts) == 2 && parts[1] == "test" {
		devopsCloudAccountTestHandler(w, r, id)
		return
	}
	devopsCloudAccountDetailHandler(w, r, id)
}

func devopsCloudAccountsListHandler(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodPost {
		devopsCloudAccountCreateHandler(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	teamSlugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to resolve teams", err)
		return
	}
	items, err := listCloudAccountsForTeams(teamSlugs)
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_accounts") {
			items = []cloudAccountRecord{}
		} else {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list cloud accounts", err)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "accounts": items})
}

func devopsCloudAccountCreateHandler(w http.ResponseWriter, r *http.Request) {
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var body struct {
		Provider     string   `json:"provider"`
		AccountID    string   `json:"account_id"`
		DisplayName  string   `json:"display_name"`
		TeamSlug     string   `json:"team_slug"`
		ProjectID    int      `json:"project_id"`
		Environments []string `json:"environments"`
		AuthMode     string   `json:"auth_mode"`
		RoleARN      string   `json:"role_arn"`
		ExternalID   string   `json:"external_id"`
		SecretRef    string   `json:"secret_ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	provider := normalizeCloudProvider(body.Provider)
	accountID := strings.TrimSpace(body.AccountID)
	displayName := strings.TrimSpace(body.DisplayName)
	teamSlug := strings.TrimSpace(body.TeamSlug)
	if accountID == "" || displayName == "" || teamSlug == "" || body.ProjectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "account, name, team, and project are required", nil)
		return
	}
	if !cloudAccountProjectExists(body.ProjectID) {
		writeAPIError(w, r, http.StatusBadRequest, "project not found", nil)
		return
	}
	if !devopsManagerCanOnboardTeamSlug(managerID, teamSlug) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot onboard accounts for this team", nil)
		return
	}
	authMode := normalizeCloudAccountAuthMode(body.AuthMode)
	roleARN := strings.TrimSpace(body.RoleARN)
	externalID := strings.TrimSpace(body.ExternalID)
	secretRef := strings.TrimSpace(body.SecretRef)
	if err := validateCloudAccountCredentials(provider, accountID, authMode, roleARN, externalID, secretRef); err != nil {
		writeCloudAccountValidationError(w, r, err)
		return
	}
	item, err := insertCloudAccount(cloudAccountInsert{
		Provider:     provider,
		AccountID:    accountID,
		DisplayName:  displayName,
		TeamSlug:     teamSlug,
		ProjectID:    body.ProjectID,
		Environments: body.Environments,
		AuthMode:     authMode,
		RoleARN:      roleARN,
		ExternalID:   externalID,
		SecretRef:    secretRef,
		OnboardedBy:  managerID,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeAPIError(w, r, http.StatusConflict, "this cloud account is already onboarded", err)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create cloud account", nil)
		return
	}
	AppendAuditLog(&managerID, "cloud_account_onboard", "cloud_account", strconv.Itoa(item.ID), provider+":"+accountID+":"+teamSlug)
	_, creds, _ := getCloudAccountCredentials(item.ID)
	if creds != nil {
		testErr := testCloudAccountConnection(item, creds)
		if updated, err := recordCloudAccountTestResult(item.ID, testErr); err == nil && updated != nil {
			item = updated
		}
		AppendAuditLog(&managerID, "cloud_account_test", "cloud_account", strconv.Itoa(item.ID), item.Status)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                "ok",
		"credentials_encrypted": item.CredentialsEncrypted,
		"account":               item,
		"entered": map[string]interface{}{
			"provider":              item.Provider,
			"account_id":            item.AccountID,
			"display_name":          item.DisplayName,
			"team_slug":             item.TeamSlug,
			"project_id":            item.ProjectID,
			"project_name":          item.ProjectName,
			"project_code":          item.ProjectCode,
			"environments":          item.Environments,
			"auth_mode":             item.AuthMode,
			"status":                item.Status,
			"role_arn_set":          item.RoleARNSet,
			"external_id_set":       item.ExternalIDSet,
			"secret_ref_set":        item.SecretRefSet,
			"credentials_encrypted": item.CredentialsEncrypted,
		},
	})
}

func devopsCloudAccountDetailHandler(w http.ResponseWriter, r *http.Request, id int) {
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	item, err := getCloudAccountByID(id)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusNotFound, "cloud account not found", err)
		return
	}
	if !devopsUserCanAccessTeamSlug(userID, item.TeamSlug) {
		writeAPIError(w, r, http.StatusForbidden, "cloud account not found", nil)
		return
	}
	switch r.Method {
	case http.MethodGet:
		payload := map[string]interface{}{"status": "ok", "account": item}
		if events, err := operatorAuditEventsForResource(userID, "cloud_account", strconv.Itoa(id), 10); err == nil {
			payload["operator_activity"] = events
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(payload)
	case http.MethodPatch:
		devopsCloudAccountPatchHandler(w, r, userID, item)
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsCloudAccountPatchHandler(w http.ResponseWriter, r *http.Request, userID int, item *cloudAccountRecord) {
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if !devopsManagerCanOnboardTeamSlug(managerID, item.TeamSlug) {
		writeAPIError(w, r, http.StatusForbidden, "you cannot modify this account", nil)
		return
	}
	var body struct {
		DisplayName  *string  `json:"display_name"`
		Environments []string `json:"environments"`
		Status       string   `json:"status"`
		AuthMode     string   `json:"auth_mode"`
		RoleARN      *string  `json:"role_arn"`
		ExternalID   *string  `json:"external_id"`
		SecretRef    *string  `json:"secret_ref"`
		Retest       *bool    `json:"retest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	nextStatus := strings.ToLower(strings.TrimSpace(body.Status))
	if nextStatus == "disabled" {
		updated, err := disableCloudAccount(item.ID, managerID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to disable account", err)
			return
		}
		AppendAuditLog(&managerID, "cloud_account_disable", "cloud_account", strconv.Itoa(item.ID), item.AccountID)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "account": updated})
		return
	}
	if nextStatus == "connected" || nextStatus == "pending" {
		updated, err := reenableCloudAccount(item.ID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update account", err)
			return
		}
		AppendAuditLog(&managerID, "cloud_account_enable", "cloud_account", strconv.Itoa(item.ID), item.AccountID)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "account": updated})
		return
	}
	if body.RoleARN != nil && strings.TrimSpace(*body.RoleARN) == "" {
		body.RoleARN = nil
	}
	if body.ExternalID != nil && strings.TrimSpace(*body.ExternalID) == "" {
		body.ExternalID = nil
	}
	if body.SecretRef != nil && strings.TrimSpace(*body.SecretRef) == "" {
		body.SecretRef = nil
	}
	trustTouched := strings.TrimSpace(body.AuthMode) != "" || body.RoleARN != nil || body.ExternalID != nil || body.SecretRef != nil
	var updated *cloudAccountRecord
	if trustTouched {
		_, creds, credErr := getCloudAccountCredentials(item.ID)
		if credErr != nil || creds == nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load account credentials", nil)
			return
		}
		authMode := creds.AuthMode
		if strings.TrimSpace(body.AuthMode) != "" {
			authMode = normalizeCloudAccountAuthMode(body.AuthMode)
		}
		roleARN := creds.RoleARN
		if body.RoleARN != nil {
			roleARN = strings.TrimSpace(*body.RoleARN)
		}
		externalID := creds.ExternalID
		if body.ExternalID != nil {
			externalID = strings.TrimSpace(*body.ExternalID)
		}
		secretRef := creds.SecretRef
		if body.SecretRef != nil {
			secretRef = strings.TrimSpace(*body.SecretRef)
		}
		if err := validateCloudAccountCredentials(item.Provider, item.AccountID, authMode, roleARN, externalID, secretRef); err != nil {
			writeCloudAccountValidationError(w, r, err)
			return
		}
		if err := updateCloudAccountTrust(item.ID, authMode, roleARN, externalID, secretRef); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update trust configuration", nil)
			return
		}
		AppendAuditLog(&managerID, "cloud_account_trust_update", "cloud_account", strconv.Itoa(item.ID), item.AccountID)
		updated, _ = getCloudAccountByID(item.ID)
		retest := body.Retest == nil || *body.Retest
		if retest && updated != nil {
			_, credsAfter, _ := getCloudAccountCredentials(item.ID)
			testErr := testCloudAccountConnection(updated, credsAfter)
			if tested, err := recordCloudAccountTestResult(item.ID, testErr); err == nil {
				updated = tested
			}
			AppendAuditLog(&managerID, "cloud_account_test", "cloud_account", strconv.Itoa(item.ID), updated.Status)
		}
	}
	if body.DisplayName != nil || body.Environments != nil {
		meta, err := updateCloudAccountMeta(item.ID, body.DisplayName, body.Environments)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update account", err)
			return
		}
		updated = meta
	}
	if updated == nil {
		updated = item
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "account": updated})
}

func devopsCloudAccountTestHandler(w http.ResponseWriter, r *http.Request, id int) {
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	item, creds, err := getCloudAccountCredentials(id)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusNotFound, "cloud account not found", err)
		return
	}
	if !devopsManagerCanOnboardTeamSlug(managerID, item.TeamSlug) {
		writeAPIError(w, r, http.StatusForbidden, "cloud account not found", nil)
		return
	}
	if item.Status == "disabled" {
		writeAPIError(w, r, http.StatusBadRequest, "account is disabled", nil)
		return
	}
	testErr := testCloudAccountConnection(item, creds)
	updated, _ := recordCloudAccountTestResult(id, testErr)
	AppendAuditLog(&managerID, "cloud_account_test", "cloud_account", strconv.Itoa(id), updated.Status)
	w.Header().Set("Content-Type", "application/json")
	if testErr != nil {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "error",
			"account": updated,
			"message": publicCloudTestError(testErr),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"account": updated,
		"message": "Connection verified on the server.",
	})
}

func adminCloudAccountsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	items, err := listAllCloudAccounts()
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_accounts") {
			items = []cloudAccountRecord{}
		} else {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list cloud accounts", err)
			return
		}
	}
	_ = adminID
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "accounts": items})
}

func devopsVisibleTeamSlugs(userID int) ([]string, error) {
	teams, err := GetDevopsTeamsForUser(userID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(teams))
	for _, team := range teams {
		if slug := strings.TrimSpace(team.Slug); slug != "" {
			out = append(out, slug)
		}
	}
	return out, nil
}

func devopsUserCanAccessTeamSlug(userID int, teamSlug string) bool {
	teamSlug = strings.TrimSpace(teamSlug)
	if teamSlug == "" {
		return false
	}
	slugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		return false
	}
	for _, slug := range slugs {
		if strings.EqualFold(slug, teamSlug) {
			return true
		}
	}
	return false
}

func devopsManagerCanOnboardTeamSlug(userID int, teamSlug string) bool {
	teamSlug = strings.TrimSpace(teamSlug)
	if teamSlug == "" {
		return false
	}
	team, err := GetTeamByNameOrSlug(teamSlug)
	if err != nil || team == nil || strings.ToLower(strings.TrimSpace(team.TeamType)) != "devops" {
		return false
	}
	return CanUserManageDevopsTeam(userID, team.ID)
}

func publicCloudTestError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "Connection test failed."
	}
	if len(msg) > 180 {
		return msg[:177] + "..."
	}
	return msg
}
