package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const bootstrapMaxAttempts = 3

var (
	errBootstrapHidden  = errors.New("bootstrap hidden")
	errBootstrapDenied  = errors.New("bootstrap denied")
	errBootstrapInvalid = errors.New("bootstrap invalid")
)

type serviceBootstrap struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Service     string `json:"service"`
	Language    string `json:"language"`
	Version     int    `json:"version"`
	State       string `json:"state"`
	Observed    string `json:"observed"`
	CIValid     bool   `json:"ci_valid"`
	CanApply    bool   `json:"can_apply"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

type bootstrapStep struct {
	ID          int    `json:"id"`
	BootstrapID int    `json:"bootstrap_id"`
	Name        string `json:"name"`
	State       string `json:"state"`
	Attempts    int    `json:"attempts"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

type bootstrapReview struct {
	ID          int    `json:"id"`
	BootstrapID int    `json:"bootstrap_id"`
	ReviewerID  int    `json:"reviewer_id"`
	State       string `json:"state"`
	Applied     bool   `json:"applied"`
}

var (
	findServiceBootstrap   = findServiceBootstrapFromDB
	saveServiceBootstrap   = saveServiceBootstrapToDB
	loadServiceBootstrap   = loadServiceBootstrapFromDB
	updateServiceBootstrap = updateServiceBootstrapToDB
	listServiceBootstraps  = listServiceBootstrapsFromDB
	findBootstrapStep      = findBootstrapStepFromDB
	saveBootstrapStep      = saveBootstrapStepToDB
	updateBootstrapStep    = updateBootstrapStepToDB
	listBootstrapSteps     = listBootstrapStepsFromDB
	findBootstrapReview    = findBootstrapReviewFromDB
	saveBootstrapReview    = saveBootstrapReviewToDB
	saveBootstrapAudit     = saveBootstrapAuditToDB
)

func recordServiceBootstrap(actor authzSubject, projectID int, environment, service, language string, version int) (serviceBootstrap, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	service = strings.TrimSpace(service)
	language = strings.ToLower(strings.TrimSpace(language))
	if !incidentToken(service) || language != "go" || version <= 0 || pilotSensitive(service) || bootstrapProduction(environment) || !singleEnvironment(environment) {
		return serviceBootstrap{}, errBootstrapInvalid
	}
	if err := bootstrapAccess(actor, projectID, environment, true); err != nil {
		return serviceBootstrap{}, err
	}
	current, err := findServiceBootstrap(projectID, environment, service)
	if err != nil {
		return serviceBootstrap{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		current.CanApply = false
		return current, nil
	}
	item := serviceBootstrap{ProjectID: projectID, Environment: environment, Service: service, Language: language, Version: version, State: "staged", Observed: "unknown"}
	saved, err := saveServiceBootstrap(item)
	if err != nil {
		return serviceBootstrap{}, err
	}
	_ = saveBootstrapAudit(projectID, service, actor.UserID, "service bootstrap staged")
	return saved, nil
}

func recordBootstrapStep(actor authzSubject, bootstrapID int, name string, passed bool) (bootstrapStep, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	item, err := loadServiceBootstrap(bootstrapID)
	if err != nil || item.ID == 0 {
		return bootstrapStep{}, errBootstrapHidden
	}
	if err := bootstrapAccess(actor, item.ProjectID, item.Environment, true); err != nil || !bootstrapStepName(name) {
		if err == nil {
			err = errBootstrapInvalid
		}
		return bootstrapStep{}, err
	}
	if err := bootstrapPriorReady(item.ID, name); err != nil {
		return bootstrapStep{}, err
	}
	current, err := findBootstrapStep(item.ID, name)
	if err != nil {
		return bootstrapStep{}, err
	}
	if current.ID > 0 && current.State == "passed" {
		current.Applied = false
		return current, nil
	}
	if current.ID > 0 && current.Attempts >= bootstrapMaxAttempts {
		current.Applied = false
		current.Reason = "retry bound reached"
		return current, nil
	}
	state := "failed"
	if passed {
		state = "passed"
	}
	if current.ID > 0 {
		current.Attempts++
		current.State = state
		current.Applied = true
		current.Reason = ""
		return updateBootstrapStep(current)
	}
	return saveBootstrapStep(bootstrapStep{BootstrapID: item.ID, Name: name, State: state, Attempts: 1})
}

func validateBootstrapPipeline(actor authzSubject, bootstrapID int) (serviceBootstrap, error) {
	item, err := loadServiceBootstrap(bootstrapID)
	if err != nil || item.ID == 0 {
		return serviceBootstrap{}, errBootstrapHidden
	}
	if err := bootstrapAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return serviceBootstrap{}, err
	}
	if item.CIValid {
		item.Applied = false
		item.CanApply = false
		return item, nil
	}
	ready, err := bootstrapChecksReady(item.ID)
	if err != nil || !ready {
		if err == nil {
			err = errBootstrapInvalid
		}
		return serviceBootstrap{}, err
	}
	item.CIValid = true
	item.State = "validated"
	item.CanApply = false
	item.Observed = "unknown"
	saved, err := updateServiceBootstrap(item)
	if err != nil {
		return serviceBootstrap{}, err
	}
	_ = saveBootstrapAudit(item.ProjectID, item.Service, actor.UserID, "generated pipeline validated")
	return saved, nil
}

func openBootstrapReview(actor authzSubject, bootstrapID, reviewerID int) (bootstrapReview, error) {
	item, err := loadServiceBootstrap(bootstrapID)
	if err != nil || item.ID == 0 {
		return bootstrapReview{}, errBootstrapHidden
	}
	if err := bootstrapAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return bootstrapReview{}, err
	}
	if !item.CIValid || reviewerID <= 0 || reviewerID == actor.UserID {
		return bootstrapReview{}, errBootstrapInvalid
	}
	current, err := findBootstrapReview(item.ID)
	if err != nil {
		return bootstrapReview{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	saved, err := saveBootstrapReview(bootstrapReview{BootstrapID: item.ID, ReviewerID: reviewerID, State: "proposed"})
	if err != nil {
		return bootstrapReview{}, err
	}
	kept, err := loadServiceBootstrap(item.ID)
	if err != nil || kept.CanApply || kept.State != "validated" {
		return bootstrapReview{}, errBootstrapInvalid
	}
	_ = saveBootstrapAudit(item.ProjectID, item.Service, actor.UserID, "bootstrap review proposed")
	return saved, nil
}

func readServiceBootstraps(actor authzSubject, projectID int, environment string) ([]serviceBootstrap, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := bootstrapAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listServiceBootstraps(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []serviceBootstrap{}
	}
	return items, nil
}

func bootstrapAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errBootstrapInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errBootstrapHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errBootstrapDenied
	}
	return nil
}

func bootstrapProduction(environment string) bool {
	return environment == "production" || environment == "prod"
}

func bootstrapStepName(name string) bool {
	return name == "catalog" || name == "telemetry" || name == "security"
}

func bootstrapPriorReady(bootstrapID int, name string) error {
	var prior string
	switch name {
	case "telemetry":
		prior = "catalog"
	case "security":
		prior = "telemetry"
	default:
		return nil
	}
	step, err := findBootstrapStep(bootstrapID, prior)
	if err != nil {
		return err
	}
	if step.State != "passed" {
		return errBootstrapInvalid
	}
	return nil
}

func bootstrapChecksReady(bootstrapID int) (bool, error) {
	for _, name := range []string{"catalog", "telemetry", "security"} {
		step, err := findBootstrapStep(bootstrapID, name)
		if err != nil {
			return false, err
		}
		if step.State != "passed" {
			return false, nil
		}
	}
	return true, nil
}

func migrateBootstrapSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS service_bootstraps (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			service_key TEXT NOT NULL,
			language_name TEXT NOT NULL,
			template_version INTEGER NOT NULL,
			state TEXT NOT NULL,
			observed TEXT NOT NULL,
			ci_valid BOOLEAN NOT NULL,
			UNIQUE (project_id, environment, service_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS bootstrap_steps (
			id SERIAL PRIMARY KEY,
			bootstrap_id INTEGER NOT NULL,
			step_name TEXT NOT NULL,
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			UNIQUE (bootstrap_id, step_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS bootstrap_reviews (
			id SERIAL PRIMARY KEY,
			bootstrap_id INTEGER NOT NULL UNIQUE,
			reviewer_id INTEGER NOT NULL,
			state TEXT NOT NULL
		)
	`)
}

func findServiceBootstrapFromDB(projectID int, environment, service string) (serviceBootstrap, error) {
	if DB == nil {
		return serviceBootstrap{}, errInboxStored
	}
	var item serviceBootstrap
	err := DB.QueryRow(`SELECT id, project_id, environment, service_key, language_name, template_version, state, observed, ci_valid FROM service_bootstraps WHERE project_id = $1 AND environment = $2 AND service_key = $3`, projectID, environment, service).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Language, &item.Version, &item.State, &item.Observed, &item.CIValid)
	if err != nil {
		return serviceBootstrap{}, nil
	}
	return item, nil
}

func saveServiceBootstrapToDB(item serviceBootstrap) (serviceBootstrap, error) {
	if DB == nil {
		return serviceBootstrap{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO service_bootstraps (project_id, environment, service_key, language_name, template_version, state, observed, ci_valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, item.ProjectID, item.Environment, item.Service, item.Language, item.Version, item.State, item.Observed, item.CIValid).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func loadServiceBootstrapFromDB(id int) (serviceBootstrap, error) {
	if DB == nil {
		return serviceBootstrap{}, errInboxStored
	}
	var item serviceBootstrap
	err := DB.QueryRow(`SELECT id, project_id, environment, service_key, language_name, template_version, state, observed, ci_valid FROM service_bootstraps WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Language, &item.Version, &item.State, &item.Observed, &item.CIValid)
	if err != nil {
		return serviceBootstrap{}, nil
	}
	return item, nil
}

func updateServiceBootstrapToDB(item serviceBootstrap) (serviceBootstrap, error) {
	if DB == nil {
		return serviceBootstrap{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE service_bootstraps SET state = $2, observed = $3, ci_valid = $4 WHERE id = $1`, item.ID, item.State, item.Observed, item.CIValid)
	item.Applied = true
	item.CanApply = false
	return item, err
}

func listServiceBootstrapsFromDB(projectID int, environment string) ([]serviceBootstrap, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, service_key, language_name, template_version, state, observed, ci_valid FROM service_bootstraps WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []serviceBootstrap
	for rows.Next() {
		var item serviceBootstrap
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Language, &item.Version, &item.State, &item.Observed, &item.CIValid); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func findBootstrapStepFromDB(bootstrapID int, name string) (bootstrapStep, error) {
	if DB == nil {
		return bootstrapStep{}, errInboxStored
	}
	var item bootstrapStep
	err := DB.QueryRow(`SELECT id, bootstrap_id, step_name, state, attempts FROM bootstrap_steps WHERE bootstrap_id = $1 AND step_name = $2`, bootstrapID, name).Scan(&item.ID, &item.BootstrapID, &item.Name, &item.State, &item.Attempts)
	if err != nil {
		return bootstrapStep{}, nil
	}
	return item, nil
}

func saveBootstrapStepToDB(item bootstrapStep) (bootstrapStep, error) {
	if DB == nil {
		return bootstrapStep{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO bootstrap_steps (bootstrap_id, step_name, state, attempts) VALUES ($1,$2,$3,$4) RETURNING id`, item.BootstrapID, item.Name, item.State, item.Attempts).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func updateBootstrapStepToDB(item bootstrapStep) (bootstrapStep, error) {
	if DB == nil {
		return bootstrapStep{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE bootstrap_steps SET state = $2, attempts = $3 WHERE id = $1`, item.ID, item.State, item.Attempts)
	item.Applied = true
	return item, err
}

func listBootstrapStepsFromDB(bootstrapID int) ([]bootstrapStep, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, bootstrap_id, step_name, state, attempts FROM bootstrap_steps WHERE bootstrap_id = $1 ORDER BY id`, bootstrapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []bootstrapStep
	for rows.Next() {
		var item bootstrapStep
		if err := rows.Scan(&item.ID, &item.BootstrapID, &item.Name, &item.State, &item.Attempts); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func findBootstrapReviewFromDB(bootstrapID int) (bootstrapReview, error) {
	if DB == nil {
		return bootstrapReview{}, errInboxStored
	}
	var item bootstrapReview
	err := DB.QueryRow(`SELECT id, bootstrap_id, reviewer_id, state FROM bootstrap_reviews WHERE bootstrap_id = $1`, bootstrapID).Scan(&item.ID, &item.BootstrapID, &item.ReviewerID, &item.State)
	if err != nil {
		return bootstrapReview{}, nil
	}
	return item, nil
}

func saveBootstrapReviewToDB(item bootstrapReview) (bootstrapReview, error) {
	if DB == nil {
		return bootstrapReview{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO bootstrap_reviews (bootstrap_id, reviewer_id, state) VALUES ($1,$2,$3) RETURNING id`, item.BootstrapID, item.ReviewerID, item.State).Scan(&item.ID)
	return item, err
}

func saveBootstrapAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "service_bootstrap",
		ResourceID: resourceID, Action: "service_bootstrap", Result: "success", Summary: summary,
	})
	return nil
}

func serviceBootstrapHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBootstrapError(w, errBootstrapHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeBootstrapError(w, errBootstrapInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readServiceBootstraps(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeBootstrapError(w, err)
			return
		}
		writeBootstrapJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Service     string `json:"service"`
		Language    string `json:"language"`
		Version     int    `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	item, err := recordServiceBootstrap(actor, body.ProjectID, body.Environment, body.Service, body.Language, body.Version)
	if err != nil {
		writeBootstrapError(w, err)
		return
	}
	writeBootstrapJSON(w, item)
}

func bootstrapStepHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBootstrapError(w, errBootstrapHidden)
		return
	}
	var body struct {
		BootstrapID int    `json:"bootstrap_id"`
		Name        string `json:"name"`
		Passed      bool   `json:"passed"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	item, err := recordBootstrapStep(actor, body.BootstrapID, body.Name, body.Passed)
	if err != nil {
		writeBootstrapError(w, err)
		return
	}
	writeBootstrapJSON(w, item)
}

func bootstrapPipelineHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBootstrapError(w, errBootstrapHidden)
		return
	}
	var body struct {
		BootstrapID int `json:"bootstrap_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	item, err := validateBootstrapPipeline(actor, body.BootstrapID)
	if err != nil {
		writeBootstrapError(w, err)
		return
	}
	writeBootstrapJSON(w, item)
}

func bootstrapReviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBootstrapError(w, errBootstrapHidden)
		return
	}
	var body struct {
		BootstrapID int `json:"bootstrap_id"`
		ReviewerID  int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeBootstrapError(w, errBootstrapInvalid)
		return
	}
	item, err := openBootstrapReview(actor, body.BootstrapID, body.ReviewerID)
	if err != nil {
		writeBootstrapError(w, err)
		return
	}
	writeBootstrapJSON(w, item)
}

func writeBootstrapJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeBootstrapError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errBootstrapHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errBootstrapDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "bootstrap request failed"})
}
