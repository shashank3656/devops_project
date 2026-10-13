package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errCatalogUnauthorized = errors.New("missing or invalid authorization")
	errCatalogHidden       = errors.New("service not found")
	errCatalogDenied       = errors.New("catalog scope denied")
	errCatalogDuplicate    = errors.New("link already exists")
)

type catalogRecord struct {
	ID           int      `json:"id"`
	ProjectID    int      `json:"project_id"`
	Name         string   `json:"name"`
	Environments []string `json:"environments"`
	Teams        []string `json:"teams"`
	Repos        []string `json:"repos"`
	Resources    []string `json:"resources"`
}

type catalogShare struct {
	ResourceID string `json:"resource_id"`
	ServiceIDs []int  `json:"service_ids"`
}

type catalogContext struct {
	Service catalogRecord  `json:"service"`
	Shared  []catalogShare `json:"shared_resources"`
}

type catalogWrite struct {
	ProjectID    int      `json:"project_id"`
	Name         string   `json:"name"`
	Environments []string `json:"environments"`
	Teams        []string `json:"teams"`
	ResourceID   string   `json:"resource_id"`
	Repo         string   `json:"repo"`
}

var catalogSubjectFromRequest = defaultCatalogSubject
var loadCatalogRecords = loadCatalogRecordsFromDB
var saveCatalogRecord = saveCatalogRecordToDB

func defaultCatalogSubject(r *http.Request) (authzSubject, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return authzSubject{}, errCatalogUnauthorized
	}
	userID, err := validateToken(strings.TrimPrefix(header, "Bearer "))
	if err != nil || userID <= 0 {
		return authzSubject{}, errCatalogUnauthorized
	}
	return authzSubjectForUser(userID), nil
}

func catalogEnvironmentsAllowed(subject authzSubject, projectID int, environments []string, action authzAction) bool {
	if projectID <= 0 {
		return false
	}
	envs := environments
	if len(envs) == 0 {
		envs = []string{"*"}
	}
	for _, environment := range envs {
		decision := authorizeResource(authzRequest{
			Subject: subject,
			Resource: authzResource{
				OrganizationID: pilotOrganizationID,
				ProjectID:      projectID,
				Environment:    environment,
				Kind:           "catalog-service",
				ResourceID:     strconv.Itoa(projectID),
			},
			Action: action,
		})
		if !decision.Allowed {
			return false
		}
	}
	return true
}

func visibleCatalogEnvironments(subject authzSubject, item catalogRecord) []string {
	visible := []string{}
	for _, environment := range item.Environments {
		if catalogEnvironmentsAllowed(subject, item.ProjectID, []string{environment}, authzRead) {
			visible = append(visible, environment)
		}
	}
	return visible
}

func presentCatalogRecord(subject authzSubject, item catalogRecord) (catalogRecord, bool) {
	if item.ID <= 0 || item.ProjectID <= 0 {
		return catalogRecord{}, false
	}
	visible := visibleCatalogEnvironments(subject, item)
	if len(item.Environments) > 0 && len(visible) == 0 {
		return catalogRecord{}, false
	}
	if len(item.Environments) == 0 && !catalogEnvironmentsAllowed(subject, item.ProjectID, nil, authzRead) {
		return catalogRecord{}, false
	}
	item.Environments = visible
	return item, true
}

func findCatalogRecord(services []catalogRecord, id int) (catalogRecord, bool) {
	for _, item := range services {
		if item.ID == id {
			return item, true
		}
	}
	return catalogRecord{}, false
}

func listVisibleCatalog(services []catalogRecord, subject authzSubject) []catalogRecord {
	out := []catalogRecord{}
	for _, item := range services {
		if view, ok := presentCatalogRecord(subject, item); ok {
			out = append(out, view)
		}
	}
	return out
}

func catalogContextFor(services []catalogRecord, subject authzSubject, id int) (catalogContext, error) {
	item, ok := findCatalogRecord(services, id)
	if !ok {
		return catalogContext{}, errCatalogHidden
	}
	view, ok := presentCatalogRecord(subject, item)
	if !ok {
		return catalogContext{}, errCatalogHidden
	}
	shared := []catalogShare{}
	for _, resourceID := range view.Resources {
		ids := []int{}
		for _, other := range services {
			if !catalogListHas(other.Resources, resourceID) {
				continue
			}
			if _, visible := presentCatalogRecord(subject, other); !visible {
				continue
			}
			ids = append(ids, other.ID)
		}
		shared = append(shared, catalogShare{ResourceID: resourceID, ServiceIDs: ids})
	}
	return catalogContext{Service: view, Shared: shared}, nil
}

func prepareCatalogCreate(subject authzSubject, body catalogWrite) (catalogRecord, error) {
	item := catalogRecord{
		ProjectID:    body.ProjectID,
		Name:         strings.TrimSpace(body.Name),
		Environments: normalizeCatalogEnvironments(body.Environments),
		Teams:        normalizeCatalogValues(body.Teams),
		Repos:        []string{},
		Resources:    []string{},
	}
	if item.ProjectID <= 0 {
		return catalogRecord{}, errors.New("project_id is required")
	}
	if item.Name == "" {
		return catalogRecord{}, errors.New("service name is required")
	}
	if len(item.Environments) == 0 {
		return catalogRecord{}, errors.New("environment is required")
	}
	if len(item.Teams) == 0 {
		return catalogRecord{}, errors.New("owner team is required")
	}
	if !catalogEnvironmentsAllowed(subject, item.ProjectID, item.Environments, authzCreate) {
		if catalogEnvironmentsAllowed(subject, item.ProjectID, item.Environments, authzRead) {
			return catalogRecord{}, errCatalogDenied
		}
		return catalogRecord{}, errCatalogHidden
	}
	return item, nil
}

func updateCatalogOwnership(services []catalogRecord, subject authzSubject, id int, body catalogWrite) (catalogRecord, error) {
	current, ok := findCatalogRecord(services, id)
	if !ok {
		return catalogRecord{}, errCatalogHidden
	}
	if _, visible := presentCatalogRecord(subject, current); !visible {
		return catalogRecord{}, errCatalogHidden
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, current.Environments, authzWrite) {
		return catalogRecord{}, errCatalogDenied
	}
	next := current
	if name := strings.TrimSpace(body.Name); name != "" {
		next.Name = name
	}
	if body.Environments != nil {
		next.Environments = normalizeCatalogEnvironments(body.Environments)
		if len(next.Environments) == 0 {
			return catalogRecord{}, errors.New("environment is required")
		}
		if !catalogEnvironmentsAllowed(subject, current.ProjectID, next.Environments, authzWrite) {
			return catalogRecord{}, errCatalogDenied
		}
	}
	if body.Teams != nil {
		next.Teams = normalizeCatalogValues(body.Teams)
		if len(next.Teams) == 0 {
			return catalogRecord{}, errors.New("owner team is required")
		}
	}
	return next, nil
}

func linkCatalogValue(services []catalogRecord, subject authzSubject, id int, target string, field string) (catalogRecord, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return catalogRecord{}, errors.New("link target is required")
	}
	current, ok := findCatalogRecord(services, id)
	if !ok {
		return catalogRecord{}, errCatalogHidden
	}
	if _, visible := presentCatalogRecord(subject, current); !visible {
		return catalogRecord{}, errCatalogHidden
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, current.Environments, authzWrite) {
		return catalogRecord{}, errCatalogDenied
	}
	values := current.Repos
	if field == "resource" {
		values = current.Resources
	}
	if catalogListHas(values, target) {
		return catalogRecord{}, errCatalogDuplicate
	}
	next := current
	if field == "resource" {
		next.Resources = append(append([]string{}, current.Resources...), target)
	} else {
		next.Repos = append(append([]string{}, current.Repos...), target)
	}
	return next, nil
}

func normalizeCatalogEnvironments(values []string) []string {
	out := normalizeCatalogValues(values)
	for i := range out {
		out[i] = strings.ToLower(out[i])
	}
	return out
}

func normalizeCatalogValues(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func catalogListHas(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

func catalogServicesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	switch r.Method {
	case http.MethodGet:
		services, err := loadCatalogRecords()
		if err != nil {
			writeAPIError(w, r, http.StatusServiceUnavailable, "catalog is unavailable", err)
			return
		}
		visible := listVisibleCatalog(services, subject)
		projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
		if projectID > 0 {
			filtered := []catalogRecord{}
			for _, item := range visible {
				if item.ProjectID == projectID {
					filtered = append(filtered, item)
				}
			}
			visible = filtered
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"services": pageCatalog(visible, r), "status": "ok"})
	case http.MethodPost:
		body, err := decodeCatalogWrite(r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		item, err := prepareCatalogCreate(subject, body)
		if err != nil {
			writeCatalogError(w, r, err)
			return
		}
		saved, err := saveCatalogRecord(item)
		if err != nil {
			writeAPIError(w, r, http.StatusServiceUnavailable, "catalog save failed", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusCreated, map[string]any{"service": saved, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func catalogServiceDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	id, action, ok := parseCatalogPath(r.URL.Path)
	if !ok || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid service id", nil)
		return
	}
	services, err := loadCatalogRecords()
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "catalog is unavailable", err)
		return
	}
	switch {
	case action == "context" && r.Method == http.MethodGet:
		view, err := catalogContextFor(services, subject, id)
		if err != nil {
			writeCatalogError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"context": view, "status": "ok"})
	case action == "" && r.Method == http.MethodGet:
		item, ok := findCatalogRecord(services, id)
		if !ok {
			writeCatalogError(w, r, errCatalogHidden)
			return
		}
		view, visible := presentCatalogRecord(subject, item)
		if !visible {
			writeCatalogError(w, r, errCatalogHidden)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"service": view, "status": "ok"})
	case action == "" && r.Method == http.MethodPatch:
		body, err := decodeCatalogWrite(r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		next, err := updateCatalogOwnership(services, subject, id, body)
		if err != nil {
			writeCatalogError(w, r, err)
			return
		}
		saved, err := saveCatalogRecord(next)
		if err != nil {
			writeAPIError(w, r, http.StatusServiceUnavailable, "catalog save failed", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"service": saved, "status": "ok"})
	case (action == "resources" || action == "repos") && r.Method == http.MethodPost:
		body, err := decodeCatalogWrite(r)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
			return
		}
		field := "repo"
		target := body.Repo
		if action == "resources" {
			field = "resource"
			target = body.ResourceID
		}
		next, err := linkCatalogValue(services, subject, id, target, field)
		if err != nil {
			writeCatalogError(w, r, err)
			return
		}
		saved, err := saveCatalogRecord(next)
		if err != nil {
			writeAPIError(w, r, http.StatusServiceUnavailable, "catalog save failed", err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"service": saved, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func parseCatalogPath(path string) (int, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/catalog/services/"), "/")
	if trimmed == "" {
		return 0, "", false
	}
	parts := strings.Split(trimmed, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, "", false
	}
	if len(parts) == 1 {
		return id, "", true
	}
	if len(parts) == 2 && (parts[1] == "context" || parts[1] == "resources" || parts[1] == "repos") {
		return id, parts[1], true
	}
	return 0, "", false
}

func decodeCatalogWrite(r *http.Request) (catalogWrite, error) {
	var body catalogWrite
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return catalogWrite{}, err
	}
	return body, nil
}

func pageCatalog(items []catalogRecord, r *http.Request) []catalogRecord {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	if len(items) > limit {
		return items[:limit]
	}
	return items
}

func writeCatalogError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errCatalogHidden):
		writeAPIError(w, r, http.StatusNotFound, errCatalogHidden.Error(), nil)
	case errors.Is(err, errCatalogDenied):
		writeAPIError(w, r, http.StatusForbidden, errCatalogDenied.Error(), nil)
	case errors.Is(err, errCatalogDuplicate):
		writeAPIError(w, r, http.StatusConflict, errCatalogDuplicate.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}

func loadCatalogRecordsFromDB() ([]catalogRecord, error) {
	if DB == nil {
		return nil, errors.New("database not available")
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT id, project_id, name FROM catalog_services ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	byID := map[int]*catalogRecord{}
	order := []int{}
	for rows.Next() {
		var item catalogRecord
		var projectID sql.NullInt64
		if err := rows.Scan(&item.ID, &projectID, &item.Name); err != nil {
			return nil, err
		}
		if projectID.Valid {
			item.ProjectID = int(projectID.Int64)
		}
		item.Environments = []string{}
		item.Teams = []string{}
		item.Repos = []string{}
		item.Resources = []string{}
		copied := item
		byID[item.ID] = &copied
		order = append(order, item.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachCatalogColumn(byID, `SELECT service_id, environment FROM catalog_service_environments ORDER BY id`, "environment"); err != nil {
		return nil, err
	}
	if err := attachCatalogColumn(byID, `SELECT service_id, team FROM catalog_service_teams ORDER BY id`, "team"); err != nil {
		return nil, err
	}
	if err := attachCatalogColumn(byID, `SELECT service_id, repo FROM catalog_service_repos ORDER BY id`, "repo"); err != nil {
		return nil, err
	}
	if err := attachCatalogColumn(byID, `SELECT service_id, resource_id FROM catalog_service_resources ORDER BY id`, "resource"); err != nil {
		return nil, err
	}
	out := make([]catalogRecord, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, nil
}

func attachCatalogColumn(byID map[int]*catalogRecord, query string, field string) error {
	rows, cancel, err := queryRowsWithTimeout(query)
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var serviceID int
		var value string
		if err := rows.Scan(&serviceID, &value); err != nil {
			return err
		}
		item := byID[serviceID]
		if item == nil || strings.TrimSpace(value) == "" {
			continue
		}
		switch field {
		case "environment":
			item.Environments = append(item.Environments, value)
		case "team":
			item.Teams = append(item.Teams, value)
		case "repo":
			item.Repos = append(item.Repos, value)
		default:
			item.Resources = append(item.Resources, value)
		}
	}
	return rows.Err()
}

func saveCatalogRecordToDB(item catalogRecord) (catalogRecord, error) {
	if DB == nil {
		return catalogRecord{}, errors.New("database not available")
	}
	tx, err := DB.Begin()
	if err != nil {
		return catalogRecord{}, err
	}
	defer tx.Rollback()
	if item.ID <= 0 {
		err = tx.QueryRow(`
			INSERT INTO catalog_services (project_id, name)
			VALUES ($1, $2)
			RETURNING id
		`, item.ProjectID, item.Name).Scan(&item.ID)
	} else {
		_, err = tx.Exec(`UPDATE catalog_services SET name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, item.ID, item.Name)
	}
	if err != nil {
		return catalogRecord{}, err
	}
	for _, statement := range []string{
		`DELETE FROM catalog_service_environments WHERE service_id = $1`,
		`DELETE FROM catalog_service_teams WHERE service_id = $1`,
		`DELETE FROM catalog_service_repos WHERE service_id = $1`,
		`DELETE FROM catalog_service_resources WHERE service_id = $1`,
	} {
		if _, err = tx.Exec(statement, item.ID); err != nil {
			return catalogRecord{}, err
		}
	}
	for _, environment := range item.Environments {
		if _, err = tx.Exec(`INSERT INTO catalog_service_environments (service_id, environment) VALUES ($1, $2)`, item.ID, environment); err != nil {
			return catalogRecord{}, err
		}
	}
	for _, team := range item.Teams {
		if _, err = tx.Exec(`INSERT INTO catalog_service_teams (service_id, team) VALUES ($1, $2)`, item.ID, team); err != nil {
			return catalogRecord{}, err
		}
	}
	for _, repo := range item.Repos {
		if _, err = tx.Exec(`INSERT INTO catalog_service_repos (service_id, repo) VALUES ($1, $2)`, item.ID, repo); err != nil {
			return catalogRecord{}, err
		}
	}
	for _, resourceID := range item.Resources {
		if _, err = tx.Exec(`INSERT INTO catalog_service_resources (service_id, resource_id) VALUES ($1, $2)`, item.ID, resourceID); err != nil {
			return catalogRecord{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return catalogRecord{}, err
	}
	return item, nil
}

type catalogAsset struct {
	ResourceID  string `json:"resource_id"`
	DisplayName string `json:"display_name"`
	Environment string `json:"environment"`
	Region      string `json:"region"`
	ServiceType string `json:"service_type"`
}

var loadCatalogAssets = loadCatalogAssetsFromDB

func subjectCanReadEnvironment(subject authzSubject, environment string) bool {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if environment == "" {
		return false
	}
	for _, grant := range subject.Grants {
		if grant.Revoked {
			continue
		}
		projectID := grant.ProjectID
		if projectID == 0 {
			projectID = 1
		}
		if projectID <= 0 {
			continue
		}
		if catalogEnvironmentsAllowed(subject, projectID, []string{environment}, authzRead) {
			return true
		}
	}
	return false
}

func catalogTriage(subject authzSubject, services []catalogRecord, assets []catalogAsset) []catalogAsset {
	linked := map[string]struct{}{}
	for _, service := range services {
		if _, visible := presentCatalogRecord(subject, service); !visible {
			continue
		}
		for _, resourceID := range service.Resources {
			resourceID = strings.ToLower(strings.TrimSpace(resourceID))
			if resourceID != "" {
				linked[resourceID] = struct{}{}
			}
		}
	}
	out := []catalogAsset{}
	for _, asset := range assets {
		resourceID := strings.TrimSpace(asset.ResourceID)
		if resourceID == "" || !subjectCanReadEnvironment(subject, asset.Environment) {
			continue
		}
		if _, ok := linked[strings.ToLower(resourceID)]; ok {
			continue
		}
		asset.ResourceID = resourceID
		asset.DisplayName = strings.TrimSpace(asset.DisplayName)
		asset.Environment = strings.ToLower(strings.TrimSpace(asset.Environment))
		out = append(out, asset)
	}
	return out
}

func catalogTriageHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	services, err := loadCatalogRecords()
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "catalog is unavailable", err)
		return
	}
	assets, err := loadCatalogAssets()
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "catalog triage is unavailable", err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"assets": catalogTriage(subject, services, assets),
		"status": "ok",
	})
}

func loadCatalogAssetsFromDB() ([]catalogAsset, error) {
	if DB == nil {
		return nil, errors.New("database not available")
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT COALESCE(resource_id,''), COALESCE(display_name,''), COALESCE(environment,''), COALESCE(region,''), COALESCE(service_type,'')
		FROM cloud_resources
		ORDER BY id
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "cloud_resources") {
			return []catalogAsset{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []catalogAsset{}
	for rows.Next() {
		var asset catalogAsset
		if err := rows.Scan(&asset.ResourceID, &asset.DisplayName, &asset.Environment, &asset.Region, &asset.ServiceType); err != nil {
			return nil, err
		}
		out = append(out, asset)
	}
	return out, rows.Err()
}
