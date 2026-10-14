package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const workspaceStaleAfter = 24 * time.Hour

var (
	errWorkspaceHidden  = errors.New("workspace hidden")
	errWorkspaceInvalid = errors.New("workspace invalid")
	errWorkspaceSource  = errors.New("workspace source failed")
)

type workspaceRef struct {
	Kind        string `json:"kind"`
	SourceID    string `json:"source_id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	ServiceKey  string `json:"service_key"`
	State       string `json:"state"`
	Freshness   string `json:"freshness"`
	ObservedAt  string `json:"observed_at"`
	Owner       string `json:"owner"`
	Link        string `json:"link"`
}

type workspaceSection struct {
	Kind       string         `json:"kind"`
	State      string         `json:"state"`
	Count      int            `json:"count"`
	ObservedAt string         `json:"observed_at"`
	Items      []workspaceRef `json:"items"`
}

type workspaceView struct {
	ProjectID   int                `json:"project_id"`
	Environment string             `json:"environment"`
	ServiceKey  string             `json:"service_key"`
	State       string             `json:"state"`
	Sections    []workspaceSection `json:"sections"`
	Items       []workspaceRef     `json:"items"`
	Page        int                `json:"page"`
	PageSize    int                `json:"page_size"`
	Total       int                `json:"total"`
}

type workspaceQuery struct {
	ProjectID   int
	Environment string
	ServiceKey  string
	Kind        string
	Owner       string
	Page        int
	PageSize    int
}

var (
	loadWorkspaceDeployments = loadWorkspaceDeploymentsFromDB
	loadWorkspaceIncidents   = loadWorkspaceIncidentsFromDB
	loadWorkspaceSecurity    = loadWorkspaceSecurityFromDB
	loadWorkspaceResources   = loadWorkspaceResourcesFromDB
	loadWorkspaceOwners      = loadWorkspaceOwnersFromDB
	workspaceClock           = time.Now
)

func loadWorkspace(actor authzSubject, query workspaceQuery) (workspaceView, error) {
	if query.ProjectID <= 0 || !singleEnvironment(query.Environment) {
		return workspaceView{}, errWorkspaceInvalid
	}
	if query.ServiceKey != "" && !workspaceServiceKey(query.ServiceKey) {
		return workspaceView{}, errWorkspaceInvalid
	}
	if query.Kind != "" && !workspaceKind(query.Kind) {
		return workspaceView{}, errWorkspaceInvalid
	}
	pageSize, ok := workspacePageSize(query.PageSize)
	if !ok || query.Page < 1 {
		return workspaceView{}, errWorkspaceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, query.ProjectID, []string{query.Environment}, authzRead) {
		return workspaceView{}, errWorkspaceHidden
	}
	query.Environment = strings.ToLower(query.Environment)
	query.ServiceKey = strings.ToLower(query.ServiceKey)
	query.Kind = strings.ToLower(query.Kind)
	query.PageSize = pageSize
	deployments, deploymentErr := loadWorkspaceDeployments(query.ProjectID, query.Environment)
	incidents, incidentErr := loadWorkspaceIncidents(query.ProjectID, query.Environment)
	security, securityErr := loadWorkspaceSecurity(query.ProjectID, query.Environment)
	resources, resourceErr := loadWorkspaceResources(query.ProjectID, query.Environment)
	owners, ownerErr := loadWorkspaceOwners(query.ProjectID, query.Environment)
	sections := []workspaceSection{
		workspaceSectionFrom("deployment", query.Environment, deployments, deploymentErr),
		workspaceSectionFrom("incident", query.Environment, incidents, incidentErr),
		workspaceSectionFrom("security", query.Environment, security, securityErr),
		workspaceSectionFrom("resource", query.Environment, resources, resourceErr),
		workspaceSectionFrom("owner", query.Environment, owners, ownerErr),
	}
	view := workspaceView{
		ProjectID: query.ProjectID, Environment: query.Environment, ServiceKey: query.ServiceKey,
		Sections: sections, State: workspacePageState(sections), Page: query.Page, PageSize: pageSize,
	}
	items := []workspaceRef{}
	for _, section := range sections {
		for _, item := range section.Items {
			if query.ServiceKey != "" && item.ServiceKey != query.ServiceKey {
				continue
			}
			if query.Kind != "" && item.Kind != query.Kind {
				continue
			}
			if query.Owner != "" && item.Owner != query.Owner {
				continue
			}
			items = append(items, item)
		}
	}
	view.Total = len(items)
	start := (query.Page - 1) * pageSize
	if start >= len(items) {
		view.Items = []workspaceRef{}
		return view, nil
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	view.Items = items[start:end]
	return view, nil
}

func workspaceSectionFrom(kind, environment string, items []workspaceRef, err error) workspaceSection {
	section := workspaceSection{Kind: kind, Items: []workspaceRef{}}
	if err != nil {
		section.State = "error"
		return section
	}
	seen := map[string]bool{}
	kept := []workspaceRef{}
	var latest time.Time
	hasTime := false
	for _, item := range items {
		item.Kind = kind
		item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
		item.ServiceKey = strings.ToLower(strings.TrimSpace(item.ServiceKey))
		item.SourceID = strings.TrimSpace(item.SourceID)
		if item.SourceID == "" || item.Environment != environment || !singleEnvironment(item.Environment) || seen[item.SourceID] {
			continue
		}
		seen[item.SourceID] = true
		item.State = workspaceSourceState(item.State)
		item.Freshness, item.ObservedAt = workspaceFreshness(item.ObservedAt)
		item.Link = workspaceScopeLink(item)
		if item.Link == "" {
			continue
		}
		if stamp, parseErr := time.Parse(time.RFC3339, item.ObservedAt); parseErr == nil {
			if !hasTime || stamp.After(latest) {
				latest = stamp
				hasTime = true
			}
		}
		kept = append(kept, item)
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].SourceID < kept[j].SourceID })
	section.Items = kept
	section.Count = len(kept)
	if hasTime {
		section.ObservedAt = latest.UTC().Format(time.RFC3339)
	}
	section.State = workspaceSectionState(kept)
	return section
}

func workspaceSectionState(items []workspaceRef) string {
	if len(items) == 0 {
		return "empty"
	}
	stale, missing := false, false
	for _, item := range items {
		switch item.Freshness {
		case "stale":
			stale = true
		case "missing":
			missing = true
		}
	}
	if stale {
		return "stale"
	}
	if missing {
		return "unknown"
	}
	return "ready"
}

func workspacePageState(sections []workspaceSection) string {
	rank := map[string]int{"error": 5, "stale": 4, "unknown": 3, "empty": 2, "ready": 1}
	state := "empty"
	for _, section := range sections {
		if rank[section.State] > rank[state] {
			state = section.State
		}
	}
	return state
}

func workspaceFreshness(observedAt string) (string, string) {
	observedAt = strings.TrimSpace(observedAt)
	stamp, err := time.Parse(time.RFC3339, observedAt)
	if err != nil {
		return "missing", ""
	}
	stamp = stamp.UTC()
	if workspaceClock().UTC().Sub(stamp) > workspaceStaleAfter {
		return "stale", stamp.Format(time.RFC3339)
	}
	return "fresh", stamp.Format(time.RFC3339)
}

func workspaceSourceState(state string) string {
	state = strings.ToLower(strings.TrimSpace(state))
	if state == "" || state == "healthy" {
		return "unknown"
	}
	return state
}

func workspaceScopeLink(item workspaceRef) string {
	if item.ProjectID <= 0 || !singleEnvironment(item.Environment) || item.SourceID == "" || !workspaceKind(item.Kind) {
		return ""
	}
	values := url.Values{}
	values.Set("project_id", strconv.Itoa(item.ProjectID))
	values.Set("environment", item.Environment)
	values.Set("kind", item.Kind)
	values.Set("source_id", item.SourceID)
	if item.ServiceKey != "" {
		values.Set("service", item.ServiceKey)
	}
	return "/api/workspace?" + values.Encode()
}

func workspaceKind(kind string) bool {
	switch strings.ToLower(kind) {
	case "deployment", "incident", "security", "resource", "owner":
		return true
	default:
		return false
	}
}

func workspaceServiceKey(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 64 || strings.ContainsAny(value, " \n,*") {
		return false
	}
	return true
}

func workspacePageSize(size int) (int, bool) {
	if size == 0 {
		return 10, true
	}
	switch size {
	case 10, 25, 50:
		return size, true
	default:
		return 0, false
	}
}

func loadWorkspaceDeploymentsFromDB(projectID int, environment string) ([]workspaceRef, error) {
	return loadWorkspaceRows(`
		SELECT id::text, environment, state, observed_at, '', ''
		FROM deployment_attempts
		WHERE project_id = $1 AND lower(environment) = $2
	`, projectID, environment)
}

func loadWorkspaceIncidentsFromDB(projectID int, environment string) ([]workspaceRef, error) {
	return loadWorkspaceRows(`
		SELECT id::text, environment, status, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), owner_team, ''
		FROM sre_incidents
		WHERE project_id = $1 AND lower(environment) = $2
	`, projectID, environment)
}

func loadWorkspaceSecurityFromDB(projectID int, environment string) ([]workspaceRef, error) {
	return loadWorkspaceRows(`
		SELECT s.id::text, e.environment, s.state, '', '', ''
		FROM artifact_exposures e
		JOIN artifact_sboms s ON s.project_id = e.project_id AND s.digest = e.digest
		WHERE e.project_id = $1 AND lower(e.environment) = $2
	`, projectID, environment)
}

func loadWorkspaceResourcesFromDB(projectID int, environment string) ([]workspaceRef, error) {
	return loadWorkspaceRows(`
		SELECT r.id::text, env.environment, 'recorded', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '', lower(s.name)
		FROM catalog_service_resources r
		JOIN catalog_services s ON s.id = r.service_id
		JOIN catalog_service_environments env ON env.service_id = s.id
		WHERE s.project_id = $1 AND lower(env.environment) = $2
	`, projectID, environment)
}

func loadWorkspaceOwnersFromDB(projectID int, environment string) ([]workspaceRef, error) {
	return loadWorkspaceRows(`
		SELECT t.id::text, env.environment, 'recorded', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), t.team, lower(s.name)
		FROM catalog_service_teams t
		JOIN catalog_services s ON s.id = t.service_id
		JOIN catalog_service_environments env ON env.service_id = s.id
		WHERE s.project_id = $1 AND lower(env.environment) = $2 AND btrim(t.team) <> ''
	`, projectID, environment)
}

func loadWorkspaceRows(query string, projectID int, environment string) ([]workspaceRef, error) {
	if DB == nil {
		return nil, errWorkspaceSource
	}
	rows, err := DB.Query(query, projectID, strings.ToLower(environment))
	if err != nil {
		return nil, errWorkspaceSource
	}
	defer rows.Close()
	items := []workspaceRef{}
	for rows.Next() {
		var item workspaceRef
		var observed sql.NullString
		if err := rows.Scan(&item.SourceID, &item.Environment, &item.State, &observed, &item.Owner, &item.ServiceKey); err != nil {
			return nil, errWorkspaceSource
		}
		item.ProjectID = projectID
		item.Environment = environment
		if observed.Valid {
			item.ObservedAt = observed.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errWorkspaceSource
	}
	return items, nil
}

func workspaceHandler(w http.ResponseWriter, r *http.Request) {
	writeServiceWorkspace(w, r, false, false)
}

func workspaceWorkHandler(w http.ResponseWriter, r *http.Request) {
	writeServiceWorkspace(w, r, false, true)
}

func workspaceServiceHandler(w http.ResponseWriter, r *http.Request) {
	writeServiceWorkspace(w, r, true, false)
}

func writeServiceWorkspace(w http.ResponseWriter, r *http.Request, serviceRequired, work bool) {
	if r.Method != http.MethodGet {
		writeWorkspaceOverviewError(w, errWorkspaceInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeWorkspaceOverviewError(w, errWorkspaceHidden)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page == 0 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	serviceKey := r.URL.Query().Get("service")
	if serviceRequired && strings.TrimSpace(serviceKey) == "" {
		writeWorkspaceOverviewError(w, errWorkspaceInvalid)
		return
	}
	kind := ""
	owner := ""
	if work {
		kind = r.URL.Query().Get("kind")
		owner = strings.TrimSpace(r.URL.Query().Get("owner"))
	}
	view, err := loadWorkspace(actor, workspaceQuery{
		ProjectID: projectID, Environment: r.URL.Query().Get("environment"), ServiceKey: serviceKey,
		Kind: kind, Owner: owner, Page: page, PageSize: pageSize,
	})
	if err != nil {
		writeWorkspaceOverviewError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(view)
}

func writeWorkspaceOverviewError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errWorkspaceHidden) {
		status = http.StatusNotFound
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "workspace request failed"})
}
