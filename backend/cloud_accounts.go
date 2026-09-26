package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type cloudAccountRecord struct {
	ID              int        `json:"id"`
	Provider        string     `json:"provider"`
	AccountID       string     `json:"account_id"`
	DisplayName     string     `json:"display_name"`
	TeamSlug        string     `json:"team_slug"`
	Environments    []string   `json:"environments"`
	AuthMode        string     `json:"auth_mode"`
	RoleARN         string     `json:"role_arn,omitempty"`
	ExternalIDSet   bool       `json:"external_id_set"`
	SecretRefSet    bool       `json:"secret_ref_set"`
	Status          string     `json:"status"`
	LastError       string     `json:"last_error,omitempty"`
	LastTestAt      *time.Time `json:"last_test_at,omitempty"`
	OnboardedBy     *int       `json:"onboarded_by,omitempty"`
	OnboardedByName string     `json:"onboarded_by_username,omitempty"`
	DisabledAt      *time.Time `json:"disabled_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
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
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list cloud accounts", err)
		return
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
	if accountID == "" || displayName == "" || teamSlug == "" {
		writeAPIError(w, r, http.StatusBadRequest, "account_id, display_name, and team_slug are required", nil)
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
	if authMode == "assume_role" && provider == "aws" && roleARN == "" {
		writeAPIError(w, r, http.StatusBadRequest, "role_arn is required for AWS role assumption", nil)
		return
	}
	if authMode == "assume_role" && provider == "aws" && roleARN != "" {
		if arnAcct := awsAccountIDFromRoleARN(roleARN); arnAcct != "" && arnAcct != accountID {
			writeAPIError(w, r, http.StatusBadRequest, "role_arn account must match account_id", nil)
			return
		}
	}
	if authMode == "static_ref" && secretRef == "" {
		writeAPIError(w, r, http.StatusBadRequest, "secret_ref is required for static_ref mode (server-side env var name only)", nil)
		return
	}
	item, err := insertCloudAccount(cloudAccountInsert{
		Provider:     provider,
		AccountID:    accountID,
		DisplayName:  displayName,
		TeamSlug:     teamSlug,
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
		writeAPIError(w, r, http.StatusInternalServerError, "failed to create cloud account", err)
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
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "account": item})
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
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "account": item})
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
	updated, err := updateCloudAccountMeta(item.ID, body.DisplayName, body.Environments)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to update account", err)
		return
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
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list cloud accounts", err)
		return
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
