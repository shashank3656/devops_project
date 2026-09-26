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
	ID          int    `json:"id"`
	TeamSlug    string `json:"team_slug"`
	Cloud       string `json:"cloud"`
	AccountID   string `json:"account_id"`
	AccountName string `json:"account_name"`
	Environment string `json:"environment"`
	Region      string `json:"region"`
	ServiceType string `json:"service_type"`
	ResourceID  string `json:"resource_id"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updated_at"`
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

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"resources": items,
		"page":      page,
		"limit":     limit,
		"total":     total,
	})
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
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"resource": item})
}

func devopsCloudResourcesRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/cloud/resources")
	path = strings.Trim(path, "/")
	if path == "" {
		devopsCloudResourcesHandler(w, r)
		return
	}
	devopsCloudResourceDetailHandler(w, r)
}
