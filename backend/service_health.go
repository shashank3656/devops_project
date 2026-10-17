package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errSLOHidden  = errors.New("service health not found")
	errSLODenied  = errors.New("service health is not permitted")
	errSLOInvalid = errors.New("service health is invalid")
)

type sloDefinition struct {
	ID            int    `json:"id"`
	ProjectID     int    `json:"project_id"`
	ServiceKey    string `json:"service_key"`
	Environment   string `json:"environment"`
	Version       int    `json:"version"`
	Query         string `json:"query"`
	ObjectiveBPS  int    `json:"objective_bps"`
	WindowMinutes int    `json:"window_minutes"`
	MinSamples    int    `json:"min_samples"`
}

type sloEvaluation struct {
	ID              int    `json:"id"`
	DefinitionID    int    `json:"definition_id"`
	ProjectID       int    `json:"project_id"`
	SampleCount     int    `json:"sample_count"`
	GoodCount       int    `json:"good_count"`
	CoveredMinutes  int    `json:"covered_minutes"`
	Freshness       string `json:"freshness"`
	State           string `json:"state"`
	Reason          string `json:"reason"`
	BudgetRemaining *int   `json:"budget_remaining,omitempty"`
}

type serviceWatch struct {
	ID              int    `json:"id"`
	ProjectID       int    `json:"project_id"`
	DefinitionID    int    `json:"definition_id"`
	AttemptID       int    `json:"attempt_id"`
	ImageDigest     string `json:"image_digest"`
	SampleCount     int    `json:"sample_count"`
	State           string `json:"state"`
	Source          string `json:"source"`
	ReleaseCriteria string `json:"release_criteria"`
	BudgetFromWatch bool   `json:"budget_from_watch"`
}

type serviceHealthView struct {
	ProjectID       int    `json:"project_id"`
	ServiceKey      string `json:"service_key"`
	Environment     string `json:"environment"`
	State           string `json:"state"`
	Freshness       string `json:"freshness"`
	Reason          string `json:"reason"`
	WindowMinutes   int    `json:"window_minutes"`
	BudgetRemaining *int   `json:"budget_remaining,omitempty"`
	WatchState      string `json:"watch_state"`
	FreezeSource    string `json:"freeze_source"`
	ReleaseCriteria string `json:"release_criteria"`
	BudgetFromWatch bool   `json:"budget_from_watch"`
}

type sloDefinitionInput struct {
	ProjectID     int
	ServiceKey    string
	Environment   string
	Version       int
	Query         string
	ObjectiveBPS  int
	WindowMinutes int
	MinSamples    int
}

type sloEvaluationInput struct {
	DefinitionID   int
	SampleCount    int
	GoodCount      int
	CoveredMinutes int
	Freshness      string
}

var (
	saveSLODefinition   = saveSLODefinitionToDB
	findSLODefinition   = findSLODefinitionFromDB
	loadSLODefinition   = loadSLODefinitionFromDB
	latestSLODefinition = latestSLODefinitionFromDB
	saveSLOEvaluation   = saveSLOEvaluationToDB
	findSLOEvaluation   = findSLOEvaluationFromDB
	latestSLOEvaluation = latestSLOEvaluationFromDB
	saveServiceWatch    = saveServiceWatchToDB
	findServiceWatch    = findServiceWatchFromDB
	loadServiceWatch    = loadServiceWatchFromDB
	updateServiceWatch  = updateServiceWatchInDB
	latestServiceWatch  = latestServiceWatchFromDB
	loadHealthAttempt   = loadDeploymentAttemptFromDB
	saveSLOAudit        = saveSLOAuditToDB
)

func recordSLODefinition(actor authzSubject, input sloDefinitionInput) (sloDefinition, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return sloDefinition{}, errSLOHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return sloDefinition{}, errSLODenied
	}
	item, err := normalizeSLODefinition(input)
	if err != nil {
		return sloDefinition{}, err
	}
	existing, err := findSLODefinition(item.ProjectID, item.ServiceKey, item.Environment, item.Version)
	if err != nil {
		return sloDefinition{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	saved, err := saveSLODefinition(item)
	if err != nil {
		return sloDefinition{}, err
	}
	_ = saveSLOAudit(sloAuditRecord{ProjectID: saved.ProjectID, ServiceKey: saved.ServiceKey, ActorUserID: actor.UserID, Summary: "slo definition recorded"})
	return saved, nil
}

func normalizeSLODefinition(input sloDefinitionInput) (sloDefinition, error) {
	item := sloDefinition{
		ProjectID: input.ProjectID, ServiceKey: strings.TrimSpace(input.ServiceKey),
		Environment: strings.ToLower(strings.TrimSpace(input.Environment)), Version: input.Version,
		Query: strings.TrimSpace(input.Query), ObjectiveBPS: input.ObjectiveBPS,
		WindowMinutes: input.WindowMinutes, MinSamples: input.MinSamples,
	}
	if item.ServiceKey == "" || strings.ContainsAny(item.ServiceKey, " \n") || len(item.ServiceKey) > 128 || !singleEnvironment(item.Environment) {
		return sloDefinition{}, errSLOInvalid
	}
	if item.Version <= 0 || item.Query == "" || len(item.Query) > 2000 || strings.EqualFold(item.Query, "healthy") {
		return sloDefinition{}, errSLOInvalid
	}
	if item.ObjectiveBPS < 1 || item.ObjectiveBPS > 10000 || item.WindowMinutes < 1 || item.MinSamples < 2 {
		return sloDefinition{}, errSLOInvalid
	}
	return item, nil
}

func recordSLOEvaluation(actor authzSubject, input sloEvaluationInput) (sloEvaluation, error) {
	definition, err := loadSLODefinition(input.DefinitionID)
	if err != nil || definition.ID <= 0 {
		return sloEvaluation{}, errSLOHidden
	}
	if !mappingAllowed(actor, definition.ProjectID, authzRead) {
		return sloEvaluation{}, errSLOHidden
	}
	if !mappingAllowed(actor, definition.ProjectID, authzWrite) {
		return sloEvaluation{}, errSLODenied
	}
	if input.SampleCount < 0 || input.GoodCount < 0 || input.GoodCount > input.SampleCount || input.CoveredMinutes < 0 {
		return sloEvaluation{}, errSLOInvalid
	}
	freshness, state, reason, budget := evaluateSLOWindow(definition, input)
	existing, err := findSLOEvaluation(definition.ID, input.SampleCount, input.CoveredMinutes, freshness)
	if err != nil {
		return sloEvaluation{}, err
	}
	if existing.ID > 0 {
		return presentSLOEvaluation(existing), nil
	}
	return saveSLOEvaluation(sloEvaluation{
		DefinitionID: definition.ID, ProjectID: definition.ProjectID, SampleCount: input.SampleCount, GoodCount: input.GoodCount,
		CoveredMinutes: input.CoveredMinutes, Freshness: freshness, State: state, Reason: reason, BudgetRemaining: budget,
	})
}

func evaluateSLOWindow(definition sloDefinition, input sloEvaluationInput) (string, string, string, *int) {
	freshness := strings.ToLower(strings.TrimSpace(input.Freshness))
	switch freshness {
	case "", "missing", "unknown":
		return "missing", "unknown", "telemetry is missing", nil
	case "stale":
		return "stale", "unknown", "telemetry is stale", nil
	case "partial":
		return "partial", "unknown", "telemetry is partial", nil
	case "fresh":
		if input.SampleCount < definition.MinSamples || input.CoveredMinutes < definition.WindowMinutes {
			return "partial", "unknown", "window is incomplete", nil
		}
		ratio := input.GoodCount * 10000 / input.SampleCount
		remaining := ratio - definition.ObjectiveBPS
		return "fresh", "evaluated", "full window evaluated", &remaining
	default:
		return "missing", "unknown", "telemetry is missing", nil
	}
}

func presentSLOEvaluation(item sloEvaluation) sloEvaluation {
	if item.State != "evaluated" {
		item.BudgetRemaining = nil
		if item.State == "" {
			item.State = "unknown"
		}
	}
	return item
}

func startServiceWatch(actor authzSubject, definitionID, attemptID int) (serviceWatch, error) {
	definition, err := loadSLODefinition(definitionID)
	if err != nil || definition.ID <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, definition.ProjectID, authzRead) {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, definition.ProjectID, authzWrite) {
		return serviceWatch{}, errSLODenied
	}
	attempt, err := loadHealthAttempt(attemptID)
	if err != nil || attempt.ID <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	if attempt.ProjectID != definition.ProjectID || attempt.Environment != definition.Environment || attempt.State != "success" || strings.TrimSpace(attempt.ImageDigest) == "" {
		return serviceWatch{}, errSLOInvalid
	}
	existing, err := findServiceWatch(definition.ProjectID, attempt.ID)
	if err != nil {
		return serviceWatch{}, err
	}
	if existing.ID > 0 {
		return presentServiceWatch(existing), nil
	}
	saved, err := saveServiceWatch(serviceWatch{
		ProjectID: definition.ProjectID, DefinitionID: definition.ID, AttemptID: attempt.ID,
		ImageDigest: attempt.ImageDigest, State: "watching",
	})
	if err != nil {
		return serviceWatch{}, err
	}
	return presentServiceWatch(saved), nil
}

func recordWatchSamples(actor authzSubject, watchID, sampleCount int) (serviceWatch, error) {
	current, err := loadServiceWatch(watchID)
	if err != nil || current.ID <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return serviceWatch{}, errSLODenied
	}
	if sampleCount < 1 {
		return serviceWatch{}, errSLOInvalid
	}
	current.SampleCount = sampleCount
	updated, err := updateServiceWatch(current)
	if err != nil {
		return serviceWatch{}, err
	}
	return presentServiceWatch(updated), nil
}

func freezeServiceWatch(actor authzSubject, watchID int, source, criteria string) (serviceWatch, error) {
	current, err := loadServiceWatch(watchID)
	if err != nil || current.ID <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return serviceWatch{}, errSLOHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return serviceWatch{}, errSLODenied
	}
	source = strings.TrimSpace(source)
	criteria = strings.TrimSpace(criteria)
	if source == "" || criteria == "" || strings.EqualFold(source, "healthy") || strings.EqualFold(criteria, "healthy") || len(source) > 200 || len(criteria) > 500 {
		return serviceWatch{}, errSLOInvalid
	}
	current.State = "frozen"
	current.Source = source
	current.ReleaseCriteria = criteria
	updated, err := updateServiceWatch(current)
	if err != nil {
		return serviceWatch{}, err
	}
	return presentServiceWatch(updated), nil
}

func presentServiceWatch(item serviceWatch) serviceWatch {
	item.BudgetFromWatch = false
	if item.State == "" {
		item.State = "watching"
	}
	return item
}

func readServiceHealth(actor authzSubject, projectID int, serviceKey, environment string) (serviceHealthView, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return serviceHealthView{}, errSLOHidden
	}
	serviceKey = strings.TrimSpace(serviceKey)
	environment = strings.ToLower(strings.TrimSpace(environment))
	if serviceKey == "" || !singleEnvironment(environment) {
		return serviceHealthView{}, errSLOInvalid
	}
	view := serviceHealthView{
		ProjectID: projectID, ServiceKey: serviceKey, Environment: environment,
		State: "unknown", Freshness: "missing", Reason: "telemetry is missing",
	}
	definition, err := latestSLODefinition(projectID, serviceKey, environment)
	if err != nil {
		return serviceHealthView{}, err
	}
	if definition.ID == 0 {
		return view, nil
	}
	view.WindowMinutes = definition.WindowMinutes
	evaluation, err := latestSLOEvaluation(definition.ID)
	if err != nil {
		return serviceHealthView{}, err
	}
	if evaluation.ID > 0 {
		evaluation = presentSLOEvaluation(evaluation)
		view.State = evaluation.State
		view.Freshness = evaluation.Freshness
		view.Reason = evaluation.Reason
		view.BudgetRemaining = evaluation.BudgetRemaining
	}
	watch, err := latestServiceWatch(definition.ID)
	if err != nil {
		return serviceHealthView{}, err
	}
	if watch.ID > 0 {
		watch = presentServiceWatch(watch)
		view.WatchState = watch.State
		view.FreezeSource = watch.Source
		view.ReleaseCriteria = watch.ReleaseCriteria
	}
	view.BudgetFromWatch = false
	if view.State != "evaluated" {
		view.BudgetRemaining = nil
	}
	return view, nil
}

type sloAuditRecord struct {
	ProjectID   int
	ServiceKey  string
	ActorUserID int
	Summary     string
}

func migrateSLOSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS slo_definitions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			service_key VARCHAR(128) NOT NULL,
			environment VARCHAR(64) NOT NULL,
			version INTEGER NOT NULL,
			query TEXT NOT NULL,
			objective_bps INTEGER NOT NULL,
			window_minutes INTEGER NOT NULL,
			min_samples INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, service_key, environment, version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS slo_evaluations (
			id SERIAL PRIMARY KEY,
			definition_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL,
			sample_count INTEGER NOT NULL,
			good_count INTEGER NOT NULL,
			covered_minutes INTEGER NOT NULL,
			freshness VARCHAR(32) NOT NULL,
			state VARCHAR(32) NOT NULL,
			reason TEXT NOT NULL,
			budget_remaining INTEGER NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (definition_id, sample_count, covered_minutes, freshness)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS watch_runs (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			definition_id INTEGER NOT NULL,
			attempt_id INTEGER NOT NULL,
			image_digest VARCHAR(80) NOT NULL,
			sample_count INTEGER NOT NULL DEFAULT 0,
			state VARCHAR(32) NOT NULL,
			source TEXT NOT NULL DEFAULT '',
			release_criteria TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, attempt_id)
		)
	`)
}

func saveSLODefinitionToDB(item sloDefinition) (sloDefinition, error) {
	if DB == nil {
		return sloDefinition{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO slo_definitions (project_id, service_key, environment, version, query, objective_bps, window_minutes, min_samples)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
	`, item.ProjectID, item.ServiceKey, item.Environment, item.Version, item.Query, item.ObjectiveBPS, item.WindowMinutes, item.MinSamples).Scan(&item.ID)
	return item, err
}

func scanSLODefinition(query string, args ...interface{}) (sloDefinition, error) {
	var item sloDefinition
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.ServiceKey, &item.Environment, &item.Version, &item.Query, &item.ObjectiveBPS, &item.WindowMinutes, &item.MinSamples,
	)
	return item, err
}

const sloDefinitionSelect = `SELECT id, project_id, service_key, environment, version, query, objective_bps, window_minutes, min_samples FROM slo_definitions`

func findSLODefinitionFromDB(projectID int, serviceKey, environment string, version int) (sloDefinition, error) {
	if DB == nil {
		return sloDefinition{}, nil
	}
	item, err := scanSLODefinition(sloDefinitionSelect+` WHERE project_id = $1 AND service_key = $2 AND environment = $3 AND version = $4`, projectID, serviceKey, environment, version)
	if err != nil {
		return sloDefinition{}, nil
	}
	return item, nil
}

func loadSLODefinitionFromDB(id int) (sloDefinition, error) {
	if DB == nil || id <= 0 {
		return sloDefinition{}, errSLOHidden
	}
	item, err := scanSLODefinition(sloDefinitionSelect+` WHERE id = $1`, id)
	if err != nil || item.ID <= 0 {
		return sloDefinition{}, errSLOHidden
	}
	return item, nil
}

func latestSLODefinitionFromDB(projectID int, serviceKey, environment string) (sloDefinition, error) {
	if DB == nil {
		return sloDefinition{}, nil
	}
	item, err := scanSLODefinition(sloDefinitionSelect+` WHERE project_id = $1 AND service_key = $2 AND environment = $3 ORDER BY version DESC LIMIT 1`, projectID, serviceKey, environment)
	if err != nil {
		return sloDefinition{}, nil
	}
	return item, nil
}

func saveSLOEvaluationToDB(item sloEvaluation) (sloEvaluation, error) {
	if DB == nil {
		return sloEvaluation{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO slo_evaluations (definition_id, project_id, sample_count, good_count, covered_minutes, freshness, state, reason, budget_remaining)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, item.DefinitionID, item.ProjectID, item.SampleCount, item.GoodCount, item.CoveredMinutes, item.Freshness, item.State, item.Reason, item.BudgetRemaining).Scan(&item.ID)
	return presentSLOEvaluation(item), err
}

func scanSLOEvaluation(query string, args ...interface{}) (sloEvaluation, error) {
	var item sloEvaluation
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.DefinitionID, &item.ProjectID, &item.SampleCount, &item.GoodCount, &item.CoveredMinutes, &item.Freshness, &item.State, &item.Reason, &item.BudgetRemaining,
	)
	return item, err
}

const sloEvaluationSelect = `SELECT id, definition_id, project_id, sample_count, good_count, covered_minutes, freshness, state, reason, budget_remaining FROM slo_evaluations`

func findSLOEvaluationFromDB(definitionID, sampleCount, coveredMinutes int, freshness string) (sloEvaluation, error) {
	if DB == nil {
		return sloEvaluation{}, nil
	}
	item, err := scanSLOEvaluation(sloEvaluationSelect+` WHERE definition_id = $1 AND sample_count = $2 AND covered_minutes = $3 AND freshness = $4`, definitionID, sampleCount, coveredMinutes, freshness)
	if err != nil {
		return sloEvaluation{}, nil
	}
	return item, nil
}

func latestSLOEvaluationFromDB(definitionID int) (sloEvaluation, error) {
	if DB == nil || definitionID <= 0 {
		return sloEvaluation{}, nil
	}
	item, err := scanSLOEvaluation(sloEvaluationSelect+` WHERE definition_id = $1 ORDER BY id DESC LIMIT 1`, definitionID)
	if err != nil {
		return sloEvaluation{}, nil
	}
	return item, nil
}

func saveServiceWatchToDB(item serviceWatch) (serviceWatch, error) {
	if DB == nil {
		return serviceWatch{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO watch_runs (project_id, definition_id, attempt_id, image_digest, sample_count, state, source, release_criteria)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
	`, item.ProjectID, item.DefinitionID, item.AttemptID, item.ImageDigest, item.SampleCount, item.State, item.Source, item.ReleaseCriteria).Scan(&item.ID)
	return item, err
}

func scanServiceWatch(query string, args ...interface{}) (serviceWatch, error) {
	var item serviceWatch
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.DefinitionID, &item.AttemptID, &item.ImageDigest, &item.SampleCount, &item.State, &item.Source, &item.ReleaseCriteria,
	)
	return item, err
}

const serviceWatchSelect = `SELECT id, project_id, definition_id, attempt_id, image_digest, sample_count, state, source, release_criteria FROM watch_runs`

func findServiceWatchFromDB(projectID, attemptID int) (serviceWatch, error) {
	if DB == nil {
		return serviceWatch{}, nil
	}
	item, err := scanServiceWatch(serviceWatchSelect+` WHERE project_id = $1 AND attempt_id = $2`, projectID, attemptID)
	if err != nil {
		return serviceWatch{}, nil
	}
	return item, nil
}

func loadServiceWatchFromDB(id int) (serviceWatch, error) {
	if DB == nil || id <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	item, err := scanServiceWatch(serviceWatchSelect+` WHERE id = $1`, id)
	if err != nil || item.ID <= 0 {
		return serviceWatch{}, errSLOHidden
	}
	return item, nil
}

func updateServiceWatchInDB(item serviceWatch) (serviceWatch, error) {
	if DB == nil {
		return serviceWatch{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE watch_runs SET sample_count = $2, state = $3, source = $4, release_criteria = $5 WHERE id = $1
	`, item.ID, item.SampleCount, item.State, item.Source, item.ReleaseCriteria)
	return item, err
}

func latestServiceWatchFromDB(definitionID int) (serviceWatch, error) {
	if DB == nil || definitionID <= 0 {
		return serviceWatch{}, nil
	}
	item, err := scanServiceWatch(serviceWatchSelect+` WHERE definition_id = $1 ORDER BY id DESC LIMIT 1`, definitionID)
	if err != nil {
		return serviceWatch{}, nil
	}
	return item, nil
}

func saveSLOAuditToDB(item sloAuditRecord) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "slo_definition",
		ResourceID: item.ServiceKey, Action: "slo_definition", Result: "success", Summary: item.Summary,
	})
	return nil
}

func sloDefinitionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ProjectID     int    `json:"project_id"`
		ServiceKey    string `json:"service_key"`
		Environment   string `json:"environment"`
		Version       int    `json:"version"`
		Query         string `json:"query"`
		ObjectiveBPS  int    `json:"objective_bps"`
		WindowMinutes int    `json:"window_minutes"`
		MinSamples    int    `json:"min_samples"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSLOError(w, r, errSLOInvalid)
		return
	}
	saved, err := recordSLODefinition(actor, sloDefinitionInput{
		ProjectID: body.ProjectID, ServiceKey: body.ServiceKey, Environment: body.Environment, Version: body.Version,
		Query: body.Query, ObjectiveBPS: body.ObjectiveBPS, WindowMinutes: body.WindowMinutes, MinSamples: body.MinSamples,
	})
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sloEvaluationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		DefinitionID   int    `json:"definition_id"`
		SampleCount    int    `json:"sample_count"`
		GoodCount      int    `json:"good_count"`
		CoveredMinutes int    `json:"covered_minutes"`
		Freshness      string `json:"freshness"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSLOError(w, r, errSLOInvalid)
		return
	}
	saved, err := recordSLOEvaluation(actor, sloEvaluationInput{
		DefinitionID: body.DefinitionID, SampleCount: body.SampleCount, GoodCount: body.GoodCount,
		CoveredMinutes: body.CoveredMinutes, Freshness: body.Freshness,
	})
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func serviceWatchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		DefinitionID int `json:"definition_id"`
		AttemptID    int `json:"attempt_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSLOError(w, r, errSLOInvalid)
		return
	}
	saved, err := startServiceWatch(actor, body.DefinitionID, body.AttemptID)
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func serviceWatchSampleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		WatchID     int `json:"watch_id"`
		SampleCount int `json:"sample_count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSLOError(w, r, errSLOInvalid)
		return
	}
	saved, err := recordWatchSamples(actor, body.WatchID, body.SampleCount)
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func serviceWatchFreezeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		WatchID         int    `json:"watch_id"`
		Source          string `json:"source"`
		ReleaseCriteria string `json:"release_criteria"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSLOError(w, r, errSLOInvalid)
		return
	}
	saved, err := freezeServiceWatch(actor, body.WatchID, body.Source, body.ReleaseCriteria)
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func serviceHealthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	view, err := readServiceHealth(actor, projectID, r.URL.Query().Get("service_key"), r.URL.Query().Get("environment"))
	if err != nil {
		writeSLOError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, view)
}

func writeSLOError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errSLOHidden):
		writeAPIError(w, r, http.StatusNotFound, errSLOHidden.Error(), nil)
	case errors.Is(err, errSLODenied):
		writeAPIError(w, r, http.StatusForbidden, errSLODenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errSLOInvalid.Error(), nil)
	}
}
