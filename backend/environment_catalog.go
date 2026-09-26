package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type environmentCatalogRow struct {
	ProjectID          int      `json:"project_id"`
	ProjectName        string   `json:"project_name"`
	ProjectCode        string   `json:"project_code,omitempty"`
	Name               string   `json:"name"`
	EnvType            string   `json:"env_type"`
	CloudAccountID          *int   `json:"cloud_account_id,omitempty"`
	CloudAccountLabel       string `json:"cloud_account_label,omitempty"`
	CloudAccountExternalID  string `json:"cloud_account_external_id,omitempty"`
	CloudProvider           string `json:"cloud_provider,omitempty"`
	DefaultRegion      string   `json:"default_region,omitempty"`
	DefaultCluster     string   `json:"default_cluster,omitempty"`
	Owners             []string `json:"owners"`
	Frozen             bool     `json:"frozen"`
	FreezeReason       string   `json:"freeze_reason,omitempty"`
	FreezeEndsAt       string   `json:"freeze_ends_at,omitempty"`
}

func migrateEnvironmentCatalogSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS env_type VARCHAR(32) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS default_region VARCHAR(80) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS default_cluster_name VARCHAR(160) NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS owners_json TEXT NOT NULL DEFAULT '[]'`)
	_, _ = DB.Exec(`ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS cloud_account_id INTEGER REFERENCES cloud_accounts(id) ON DELETE SET NULL`)
}

func devopsEnvironmentCatalogHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	switch r.Method {
	case http.MethodGet:
		projectFilter := strings.TrimSpace(r.URL.Query().Get("project_id"))
		rows, err := listEnvironmentCatalogForDevops(userID, projectFilter)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list environment catalog", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "environments": rows})
	case http.MethodPatch:
		managerID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		row, err := patchEnvironmentCatalogMetadata(managerID, r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "environment": row})
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPatch, http.MethodOptions)
	}
}

type environmentCatalogPatchInput struct {
	ProjectID        int      `json:"project_id"`
	Environment      string   `json:"environment"`
	EnvType          string   `json:"env_type"`
	DefaultRegion    string   `json:"default_region"`
	DefaultCluster   string   `json:"default_cluster_name"`
	Owners           []string `json:"owners"`
	CloudAccountID   *int     `json:"cloud_account_id"`
	ClearCloudAccount bool    `json:"clear_cloud_account"`
}

func patchEnvironmentCatalogMetadata(managerID int, r *http.Request) (*environmentCatalogRow, error) {
	var input environmentCatalogPatchInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		return nil, fmt.Errorf("invalid json")
	}
	input.Environment = strings.TrimSpace(input.Environment)
	if input.ProjectID <= 0 || input.Environment == "" {
		return nil, fmt.Errorf("project_id and environment are required")
	}
	project, err := getProjectCatalogByID(input.ProjectID)
	if err != nil || project == nil {
		return nil, fmt.Errorf("project not found")
	}
	if !devopsUserCanViewProject(managerID, *project) {
		return nil, fmt.Errorf("project not found")
	}
	envAllowed := false
	for _, env := range project.Environments {
		if strings.EqualFold(strings.TrimSpace(env), input.Environment) {
			envAllowed = true
			break
		}
	}
	if !envAllowed {
		return nil, fmt.Errorf("environment is not defined on this project")
	}
	envType := strings.TrimSpace(input.EnvType)
	if envType == "" {
		envType = inferEnvironmentType(input.Environment)
	}
	ownersJSON := "[]"
	if len(input.Owners) > 0 {
		clean := make([]string, 0, len(input.Owners))
		for _, owner := range input.Owners {
			owner = strings.TrimSpace(owner)
			if owner != "" {
				clean = append(clean, owner)
			}
		}
		if encoded, err := json.Marshal(clean); err == nil {
			ownersJSON = string(encoded)
		}
	}
	meta, _ := loadProjectEnvironmentMeta(input.ProjectID)
	existing := meta[strings.ToLower(input.Environment)]
	var cloudAccountID interface{}
	if input.ClearCloudAccount {
		cloudAccountID = nil
	} else if input.CloudAccountID != nil && *input.CloudAccountID > 0 {
		acct, err := getCloudAccountByID(*input.CloudAccountID)
		if err != nil || acct == nil {
			return nil, fmt.Errorf("cloud account not found")
		}
		if !devopsManagerCanOnboardTeamSlug(managerID, acct.TeamSlug) {
			return nil, fmt.Errorf("cloud account not available for this project")
		}
		teamSlug := projectOwnerTeamSlug(*project)
		if teamSlug != "" && !strings.EqualFold(strings.TrimSpace(acct.TeamSlug), teamSlug) {
			return nil, fmt.Errorf("cloud account team does not match project owner team")
		}
		cloudAccountID = *input.CloudAccountID
	} else if existing.CloudAccountID != nil && *existing.CloudAccountID > 0 {
		cloudAccountID = *existing.CloudAccountID
	}
	_, err = DB.Exec(`
		INSERT INTO project_environments (
			project_id, environment, env_type, default_region, default_cluster_name, owners_json, cloud_account_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (project_id, environment) DO UPDATE SET
			env_type = EXCLUDED.env_type,
			default_region = EXCLUDED.default_region,
			default_cluster_name = EXCLUDED.default_cluster_name,
			owners_json = EXCLUDED.owners_json,
			cloud_account_id = EXCLUDED.cloud_account_id
	`, input.ProjectID, input.Environment, envType, strings.TrimSpace(input.DefaultRegion),
		strings.TrimSpace(input.DefaultCluster), ownersJSON, cloudAccountID)
	if err != nil {
		return nil, err
	}
	details := fmt.Sprintf("project=%d env=%s type=%s", input.ProjectID, input.Environment, envType)
	AppendAuditLog(&managerID, "environment_catalog_update", "project_environment",
		fmt.Sprintf("%d:%s", input.ProjectID, strings.ToLower(input.Environment)), details)
	accountsByTeam, _ := loadCloudAccountsByTeamSlug()
	rows, err := buildEnvironmentCatalogRows(*project, accountsByTeam)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].ProjectID == input.ProjectID && strings.EqualFold(rows[i].Name, input.Environment) {
			return &rows[i], nil
		}
	}
	return nil, fmt.Errorf("updated row not found")
}

func inferEnvironmentType(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	switch {
	case strings.Contains(n, "preview"), strings.HasPrefix(n, "pr-"):
		return "preview"
	case n == "prod" || n == "production" || strings.HasSuffix(n, "-prod"):
		return "prod"
	case n == "uat" || n == "stage" || n == "staging":
		return "uat"
	case n == "dev" || n == "development" || strings.HasSuffix(n, "-dev"):
		return "dev"
	default:
		return "other"
	}
}

func parseOwnersJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	clean := make([]string, 0, len(out))
	for _, owner := range out {
		owner = strings.TrimSpace(owner)
		if owner != "" {
			clean = append(clean, owner)
		}
	}
	return clean
}

func projectOwnerTeamSlug(project ProjectCatalog) string {
	if project.OwnerTeamID != nil && *project.OwnerTeamID > 0 {
		if team, err := GetTeamByID(*project.OwnerTeamID); err == nil && team != nil {
			if slug := strings.TrimSpace(team.Slug); slug != "" {
				return slug
			}
		}
	}
	raw := strings.TrimSpace(project.OwnerTeam)
	if raw == "" {
		return ""
	}
	if team, err := GetTeamByNameOrSlug(raw); err == nil && team != nil {
		return strings.TrimSpace(team.Slug)
	}
	return raw
}

func devopsUserCanViewProject(userID int, project ProjectCatalog) bool {
	profile, _ := GetDevopsProfile(userID)
	if profile != nil && profile.IsManager {
		return true
	}
	teamSlugs, err := devopsVisibleTeamSlugs(userID)
	if err != nil || len(teamSlugs) == 0 {
		return false
	}
	ownerSlug := projectOwnerTeamSlug(project)
	for _, slug := range teamSlugs {
		if ownerSlug != "" && strings.EqualFold(slug, ownerSlug) {
			return true
		}
	}
	devopsTeams, err := GetDevopsTeamsForUser(userID)
	if err != nil {
		return false
	}
	devopsTeamIDs := map[int]struct{}{}
	for _, team := range devopsTeams {
		devopsTeamIDs[team.ID] = struct{}{}
	}
	for _, access := range project.TeamAccess {
		if _, ok := devopsTeamIDs[access.TeamID]; ok {
			return true
		}
	}
	return false
}

func environmentCatalogRowForDevops(userID, projectID int, env string) (*environmentCatalogRow, error) {
	env = strings.TrimSpace(env)
	if projectID <= 0 || env == "" {
		return nil, nil
	}
	project, err := getProjectCatalogByID(projectID)
	if err != nil || project == nil {
		return nil, err
	}
	if !devopsUserCanViewProject(userID, *project) {
		return nil, nil
	}
	accountsByTeam, err := loadCloudAccountsByTeamSlug()
	if err != nil {
		return nil, err
	}
	rows, err := buildEnvironmentCatalogRows(*project, accountsByTeam)
	if err != nil {
		return nil, err
	}
	envKey := strings.ToLower(env)
	for i := range rows {
		if strings.ToLower(rows[i].Name) == envKey {
			row := rows[i]
			return &row, nil
		}
	}
	return nil, nil
}

func listEnvironmentCatalogForDevops(userID int, projectIDFilter string) ([]environmentCatalogRow, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	filterID := 0
	if projectIDFilter != "" {
		filterID, err = strconv.Atoi(projectIDFilter)
		if err != nil || filterID <= 0 {
			return []environmentCatalogRow{}, nil
		}
	}
	accountsByTeam, err := loadCloudAccountsByTeamSlug()
	if err != nil {
		return nil, err
	}
	out := make([]environmentCatalogRow, 0, 32)
	for _, project := range projects {
		if filterID > 0 && project.ID != filterID {
			continue
		}
		if !devopsUserCanViewProject(userID, project) {
			continue
		}
		rows, err := buildEnvironmentCatalogRows(project, accountsByTeam)
		if err != nil {
			return nil, err
		}
		out = append(out, rows...)
	}
	return out, nil
}

func loadCloudAccountsByTeamSlug() (map[string][]cloudAccountRecord, error) {
	out := map[string][]cloudAccountRecord{}
	items, err := listAllCloudAccounts()
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_accounts") {
			return out, nil
		}
		return nil, err
	}
	for _, item := range items {
		if item.DisabledAt != nil {
			continue
		}
		slug := strings.TrimSpace(item.TeamSlug)
		out[slug] = append(out[slug], item)
	}
	return out, nil
}

func pickCloudAccountForEnv(accounts []cloudAccountRecord, env string, explicitID *int) *cloudAccountRecord {
	if explicitID != nil && *explicitID > 0 {
		for i := range accounts {
			if accounts[i].ID == *explicitID {
				return &accounts[i]
			}
		}
	}
	envLower := strings.ToLower(strings.TrimSpace(env))
	var fallback *cloudAccountRecord
	for i := range accounts {
		acc := &accounts[i]
		for _, allowed := range acc.Environments {
			if strings.EqualFold(strings.TrimSpace(allowed), envLower) {
				if acc.Status == "connected" {
					return acc
				}
				if fallback == nil {
					fallback = acc
				}
			}
		}
	}
	return fallback
}

func buildEnvironmentCatalogRows(project ProjectCatalog, accountsByTeam map[string][]cloudAccountRecord) ([]environmentCatalogRow, error) {
	envNames := append([]string(nil), project.Environments...)
	if len(envNames) == 0 {
		envNames = []string{"dev", "uat", "prod"}
	}
	meta, err := loadProjectEnvironmentMeta(project.ID)
	if err != nil {
		return nil, err
	}
	teamAccounts := accountsByTeam[projectOwnerTeamSlug(project)]
	out := make([]environmentCatalogRow, 0, len(envNames))
	seen := map[string]struct{}{}
	for _, env := range envNames {
		env = strings.TrimSpace(env)
		if env == "" {
			continue
		}
		key := strings.ToLower(env)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		m := meta[key]
		envType := strings.TrimSpace(m.EnvType)
		if envType == "" {
			envType = inferEnvironmentType(env)
		}
		cluster := strings.TrimSpace(m.DefaultCluster)
		if cluster == "" {
			cluster = lookupK8sClusterForProjectEnv(project.ID, env)
		}
		region := strings.TrimSpace(m.DefaultRegion)
		owners := parseOwnersJSON(m.OwnersJSON)
		var account *cloudAccountRecord
		if m.CloudAccountID != nil {
			account = pickCloudAccountForEnv(teamAccounts, env, m.CloudAccountID)
		} else {
			account = pickCloudAccountForEnv(teamAccounts, env, nil)
		}
		frozen, reason, endsAt := activeDeploymentFreeze(&project.ID, env)
		row := environmentCatalogRow{
			ProjectID:      project.ID,
			ProjectName:    project.Name,
			ProjectCode:    project.Code,
			Name:           env,
			EnvType:        envType,
			DefaultRegion:  region,
			DefaultCluster: cluster,
			Owners:         owners,
			Frozen:         frozen,
			FreezeReason:   reason,
			FreezeEndsAt:   endsAt,
		}
		if account != nil {
			row.CloudAccountID = &account.ID
			row.CloudProvider = account.Provider
			row.CloudAccountExternalID = strings.TrimSpace(account.AccountID)
			label := strings.TrimSpace(account.DisplayName)
			if label == "" {
				label = account.AccountID
			}
			row.CloudAccountLabel = label
		}
		out = append(out, row)
	}
	return out, nil
}

type projectEnvironmentMeta struct {
	EnvType        string
	DefaultRegion  string
	DefaultCluster string
	OwnersJSON     string
	CloudAccountID *int
}

func loadProjectEnvironmentMeta(projectID int) (map[string]projectEnvironmentMeta, error) {
	out := map[string]projectEnvironmentMeta{}
	if DB == nil {
		return out, nil
	}
	rows, err := DB.Query(`
		SELECT environment,
		       COALESCE(env_type, ''),
		       COALESCE(default_region, ''),
		       COALESCE(default_cluster_name, ''),
		       COALESCE(owners_json, '[]'),
		       cloud_account_id
		FROM project_environments
		WHERE project_id = $1
	`, projectID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			rows, err = DB.Query(`SELECT environment, '', '', '', '[]', NULL FROM project_environments WHERE project_id = $1`, projectID)
		}
		if err != nil {
			return out, err
		}
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var env string
		var meta projectEnvironmentMeta
		var cloudID *int
		if err := rows.Scan(&env, &meta.EnvType, &meta.DefaultRegion, &meta.DefaultCluster, &meta.OwnersJSON, &cloudID); err != nil {
			continue
		}
		meta.CloudAccountID = cloudID
		out[strings.ToLower(strings.TrimSpace(env))] = meta
	}
	return out, nil
}

func lookupK8sClusterForProjectEnv(projectID int, env string) string {
	if DB == nil {
		return ""
	}
	var cluster string
	_ = DB.QueryRow(`
		SELECT cluster_name FROM project_k8s_connections
		WHERE project_id = $1 AND LOWER(environment) = LOWER($2)
		ORDER BY updated_at DESC LIMIT 1
	`, projectID, env).Scan(&cluster)
	return strings.TrimSpace(cluster)
}

func activeDeploymentFreeze(projectID *int, env string) (bool, string, string) {
	if DB == nil {
		return false, "", ""
	}
	env = strings.TrimSpace(env)
	var reason string
	var ends time.Time
	var pid interface{}
	if projectID != nil && *projectID > 0 {
		pid = *projectID
	}
	err := DB.QueryRow(`
		SELECT reason, ends_at FROM deployment_freezes
		WHERE starts_at <= NOW() AND ends_at >= NOW()
		  AND LOWER(environment) = LOWER($1)
		  AND (project_id IS NULL OR project_id = $2)
		ORDER BY CASE WHEN project_id IS NULL THEN 1 ELSE 0 END, starts_at DESC
		LIMIT 1
	`, env, pid).Scan(&reason, &ends)
	if err != nil {
		return false, "", ""
	}
	return true, strings.TrimSpace(reason), ends.UTC().Format(time.RFC3339)
}

func workspaceEnvironmentFreezeQueue(portal string, viewerID int) []workspaceQueueItem {
	if DB == nil || portal == "user" {
		return nil
	}
	rows, err := listEnvironmentCatalogForDevops(viewerID, "")
	if err != nil {
		return nil
	}
	items := make([]workspaceQueueItem, 0, 6)
	for _, row := range rows {
		if !row.Frozen {
			continue
		}
		meta := row.ProjectName
		if row.ProjectCode != "" {
			meta = row.ProjectName + " · " + row.ProjectCode
		}
		reason := firstNonEmpty(row.FreezeReason, "Deployment freeze")
		items = append(items, workspaceQueueItem{
			ID:     "env-freeze-" + strconv.Itoa(row.ProjectID) + "-" + row.Name,
			Kind:   "freeze",
			Title:  "Freeze: " + row.Name + " (" + row.ProjectName + ")",
			Meta:   meta + " — " + reason,
			Href:   "/environments?project_id=" + strconv.Itoa(row.ProjectID),
			Action: "Catalog",
			Tone:   "danger",
		})
		if len(items) >= 6 {
			break
		}
	}
	return items
}
