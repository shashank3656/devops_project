package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

type cloudResourceRow struct {
	ID                 int    `json:"id"`
	TeamSlug           string `json:"team_slug"`
	Cloud              string `json:"cloud"`
	AccountID          string `json:"account_id"`
	AccountName        string `json:"account_name"`
	OnboardedAccountID *int   `json:"onboarded_account_id,omitempty"`
	Environment        string `json:"environment"`
	Region             string `json:"region"`
	ServiceType        string `json:"service_type"`
	ResourceID         string `json:"resource_id"`
	DisplayName        string `json:"display_name"`
	Status             string `json:"status"`
	UpdatedAt          string `json:"updated_at"`
	Purpose            string `json:"purpose,omitempty"`
	OwnerName          string `json:"owner_name,omitempty"`
	ExpiresAt          string `json:"expires_at,omitempty"`
	LifecycleState     string `json:"lifecycle_state,omitempty"`
}

func seedCloudResourceInventoryDemo() {
	if DB == nil {
		return
	}
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM cloud_resources`).Scan(&count); err != nil || count > 0 {
		return
	}
	rows := []cloudResourceRow{
		{TeamSlug: "platform-team", Cloud: "aws", AccountID: "111122223333", AccountName: "Platform prod", Environment: "prod", Region: "us-east-1", ServiceType: "ec2", ResourceID: "i-0a1b2c3d4e5f67890", DisplayName: "api-gateway-1", Status: "running"},
		{TeamSlug: "platform-team", Cloud: "aws", AccountID: "111122223333", AccountName: "Platform prod", Environment: "prod", Region: "us-east-1", ServiceType: "rds", ResourceID: "db-platform-prod", DisplayName: "platform-db", Status: "available"},
		{TeamSlug: "platform-team", Cloud: "aws", AccountID: "111122223333", AccountName: "Platform prod", Environment: "uat", Region: "us-east-1", ServiceType: "s3", ResourceID: "setuops-artifacts-uat", DisplayName: "artifacts-uat", Status: "active"},
		{TeamSlug: "devopsteam", Cloud: "aws", AccountID: "444455556666", AccountName: "DevOps shared", Environment: "dev", Region: "us-west-2", ServiceType: "eks", ResourceID: "arn:aws:eks:us-west-2:444455556666:cluster/dev", DisplayName: "dev-cluster", Status: "active"},
		{TeamSlug: "devopsteam", Cloud: "aws", AccountID: "444455556666", AccountName: "DevOps shared", Environment: "dev", Region: "us-west-2", ServiceType: "lambda", ResourceID: "arn:aws:lambda:us-west-2:444455556666:function:webhook-relay", DisplayName: "webhook-relay", Status: "active"},
	}
	for _, row := range rows {
		_, err := DB.Exec(`
			INSERT INTO cloud_resources (team_slug, cloud, account_id, account_name, environment, region, service_type, resource_id, display_name, status)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, row.TeamSlug, row.Cloud, row.AccountID, row.AccountName, row.Environment, row.Region, row.ServiceType, row.ResourceID, row.DisplayName, row.Status)
		if err != nil {
			log.Printf("cloud inventory seed row failed: %v", err)
		}
	}
	log.Println("Seeded demo cloud_resources rows")
}

func devopsCloudResourcesHandler(w http.ResponseWriter, r *http.Request) {
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
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	visibleTeams, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to resolve teams", err)
		return
	}
	q := r.URL.Query()
	env := strings.TrimSpace(q.Get("environment"))
	if env == "" {
		env = strings.TrimSpace(q.Get("env"))
	}
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	projectID, _ := strconv.Atoi(strings.TrimSpace(q.Get("project_id")))
	filters := CloudInventoryListFilters{
		Cloud:            strings.TrimSpace(q.Get("cloud")),
		Team:             strings.TrimSpace(q.Get("team")),
		Account:          strings.TrimSpace(q.Get("account_id")),
		Env:              env,
		Region:           strings.TrimSpace(q.Get("region")),
		Search:           strings.TrimSpace(q.Get("q")),
		Page:             page,
		Limit:            limit,
		ProjectID:        projectID,
		VisibleTeamSlugs: visibleTeams,
	}
	items, total, err := cloudInventoryProvider.List(r.Context(), filters)
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_resources") {
			items = []cloudResourceRow{}
			total = 0
		} else {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list resources", err)
			return
		}
	}

	payload := map[string]interface{}{
		"resources":        items,
		"page":             page,
		"limit":            limit,
		"total":            total,
		"secrets_included": false,
	}
	if acct := strings.TrimSpace(filters.Account); acct != "" {
		if ctx := resolveInventoryAccountContext(filters.Cloud, acct, visibleTeams); ctx != nil {
			payload["account_context"] = ctx
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func devopsCloudResourceDetailHandler(w http.ResponseWriter, r *http.Request) {
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
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	visibleTeams, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to resolve teams", err)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/devops/cloud/resources/")
	idStr = strings.Trim(idStr, "/")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid resource id", err)
		return
	}
	item, err := cloudInventoryProvider.GetByID(r.Context(), id)
	if err == sql.ErrNoRows {
		writeAPIError(w, r, http.StatusNotFound, "resource not found", err)
		return
	}
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load resource", err)
		return
	}
	if !devopsUserCanViewInventoryTeam(visibleTeams, item.TeamSlug) {
		writeAPIError(w, r, http.StatusNotFound, "resource not found", nil)
		return
	}
	var catalogLinks []cloudInventoryCatalogLink
	if onboardedID := lookupCloudAccountDBID(item.TeamSlug, item.Cloud, item.AccountID); onboardedID > 0 {
		item.OnboardedAccountID = &onboardedID
		if links, err := catalogLinksForOnboardedAccount(onboardedID, item.Environment); err == nil {
			catalogLinks = links
		}
	}
	detail := map[string]interface{}{"resource": item, "secrets_included": false}
	if len(catalogLinks) > 0 {
		detail["catalog_links"] = catalogLinks
	}
	if ctx := resolveInventoryAccountContext(item.Cloud, item.AccountID, visibleTeams); ctx != nil {
		detail["account_context"] = ctx
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(detail)
}

func demoCloudResourceID(resourceID string) bool {
	switch strings.TrimSpace(resourceID) {
	case "i-0a1b2c3d4e5f67890", "db-platform-prod", "setuops-artifacts-uat",
		"arn:aws:eks:us-west-2:444455556666:cluster/dev",
		"arn:aws:lambda:us-west-2:444455556666:function:webhook-relay":
		return true
	default:
		return false
	}
}

func devopsCloudResourceLifecycleHandler(w http.ResponseWriter, r *http.Request, idStr string) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid resource id", err)
		return
	}
	item, err := cloudInventoryProvider.GetByID(r.Context(), id)
	if err != nil || item == nil || demoCloudResourceID(item.ResourceID) {
		writeAPIError(w, r, http.StatusNotFound, "resource not found", nil)
		return
	}
	visibleTeams, err := devopsVisibleTeamSlugs(userID)
	if err != nil || !devopsUserCanViewInventoryTeam(visibleTeams, item.TeamSlug) {
		writeAPIError(w, r, http.StatusNotFound, "resource not found", nil)
		return
	}
	var body struct {
		Action    string `json:"action"`
		Purpose   string `json:"purpose"`
		OwnerName string `json:"owner_name"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	state := ""
	switch strings.TrimSpace(body.Action) {
	case "renewal":
		state = "renewal_requested"
	case "decommission":
		state = "decommission_requested"
	default:
		writeAPIError(w, r, http.StatusBadRequest, "choose renewal or decommission approval", nil)
		return
	}
	purpose := strings.TrimSpace(body.Purpose)
	if purpose == "" {
		purpose = item.Purpose
	}
	owner := strings.TrimSpace(body.OwnerName)
	if owner == "" {
		owner = item.OwnerName
	}
	expires := strings.TrimSpace(body.ExpiresAt)
	if expires == "" {
		expires = item.ExpiresAt
	}
	var expiresValue any
	if expires != "" {
		expiresValue = expires
	}
	if _, err := DB.Exec(`
		UPDATE cloud_resources
		SET purpose = $2, owner_name = $3, expires_at = $4, lifecycle_state = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, purpose, owner, expiresValue, state); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "the lifecycle request was not saved", err)
		return
	}
	uid := userID
	AppendUserActivity(&uid, "resource_lifecycle_"+state, "cloud_resource", strconv.Itoa(id), "state="+state)
	_ = InsertUserNotification(userID, nil, nil, "resource_lifecycle", "Resource "+item.DisplayName+" needs "+strings.ReplaceAll(state, "_", " ")+". It was not deleted.")
	writeIAM(w, http.StatusOK, map[string]any{
		"status":          "ok",
		"lifecycle_state": state,
		"deleted":         false,
		"message":         "Approval was requested. The resource was not deleted.",
	})
}

func devopsCloudResourcesRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/cloud/resources")
	path = strings.Trim(path, "/")
	if path == "" {
		devopsCloudResourcesHandler(w, r)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[1] == "lifecycle" {
		devopsCloudResourceLifecycleHandler(w, r, parts[0])
		return
	}
	devopsCloudResourceDetailHandler(w, r)
}
