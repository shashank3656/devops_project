package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const reportTimezone = "UTC"

var (
	errOutcomeHidden  = errors.New("report hidden")
	errOutcomeDenied  = errors.New("report denied")
	errOutcomeInvalid = errors.New("report invalid")
)

type reportDefinition struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Metric      string `json:"metric"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
	Timezone    string `json:"timezone"`
}

type reportSource struct {
	ID          string
	Present     bool
	Numerator   int
	Denominator int
}

type reportView struct {
	Definition  reportDefinition `json:"definition"`
	Numerator   int              `json:"numerator"`
	Denominator int              `json:"denominator"`
	Coverage    string           `json:"coverage"`
	Missing     []string         `json:"missing"`
	Citations   []string         `json:"citations"`
	Disclosed   bool             `json:"disclosed"`
	Timezone    string           `json:"timezone"`
}

type reportDraft struct {
	ID           int      `json:"id"`
	ProjectID    int      `json:"project_id"`
	Environment  string   `json:"environment"`
	Metric       string   `json:"metric"`
	Text         string   `json:"text"`
	Citations    []string `json:"citations"`
	State        string   `json:"state"`
	AuthorUserID int      `json:"author_user_id"`
	ReviewerID   int      `json:"reviewer_user_id"`
	CanExecute   bool     `json:"can_execute"`
}

type reportAudit struct {
	ProjectID   int
	ResourceID  string
	ActorUserID int
	Summary     string
}

var (
	saveReportDefinition    = saveReportDefinitionToDB
	loadReportDefinition    = loadReportDefinitionFromDB
	loadReportDraftGate     = loadReportDraftGateFromDB
	saveReportDraftGate     = saveReportDraftGateToDB
	loadReportSources       = loadReportSourcesFromDB
	saveReportObservation   = saveReportObservationToDB
	saveReportDraftRecord   = saveReportDraftToDB
	loadReportDraftRecord   = loadReportDraftFromDB
	updateReportDraftRecord = updateReportDraftToDB
	saveReportAudit         = saveReportAuditToDB
)

func saveReport(actor authzSubject, projectID int, environment, metric string) (reportDefinition, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	metric = strings.ToLower(strings.TrimSpace(metric))
	numerator, denominator, ok := reportMetric(metric)
	if err := reportAccess(actor, projectID, environment, true); err != nil || !ok {
		if err == nil {
			err = errOutcomeInvalid
		}
		return reportDefinition{}, err
	}
	item := reportDefinition{
		ProjectID: projectID, Environment: environment, Metric: metric,
		Numerator: numerator, Denominator: denominator, Timezone: reportTimezone,
	}
	saved, err := saveReportDefinition(item)
	if err != nil {
		return reportDefinition{}, err
	}
	_ = saveReportAudit(reportAudit{
		ProjectID: projectID, ResourceID: metric + "-" + environment, ActorUserID: actor.UserID, Summary: "report definition saved",
	})
	return saved, nil
}

func readReport(actor authzSubject, projectID int, environment, metric string) (reportView, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	metric = strings.ToLower(strings.TrimSpace(metric))
	if _, _, ok := reportMetric(metric); !ok {
		return reportView{}, errOutcomeInvalid
	}
	if err := reportAccess(actor, projectID, environment, false); err != nil {
		return reportView{}, err
	}
	definition, err := loadReportDefinition(projectID, environment, metric)
	if err != nil || definition.ID == 0 || definition.Timezone != reportTimezone || definition.Denominator == "" {
		return reportView{}, errOutcomeInvalid
	}
	sources, err := loadReportSources(projectID, environment)
	view := reportView{Definition: definition, Timezone: reportTimezone, Missing: []string{}, Citations: []string{}}
	if err != nil {
		view.Coverage = "unknown"
		view.Missing = []string{"source"}
		view.Disclosed = true
		return view, nil
	}
	present := map[string]reportSource{}
	for _, source := range sources {
		if incidentToken(source.ID) {
			present[source.ID] = source
		}
	}
	required := reportSourceIDs(metric)
	for _, id := range required {
		source, ok := present[id]
		if !ok || !source.Present {
			view.Missing = append(view.Missing, id)
			continue
		}
		view.Numerator += source.Numerator
		view.Denominator += source.Denominator
		view.Citations = append(view.Citations, id)
	}
	switch {
	case len(view.Missing) == len(required):
		view.Coverage = "unknown"
		view.Numerator = 0
		view.Denominator = 0
		view.Disclosed = true
	case len(view.Missing) > 0:
		view.Coverage = "partial"
		view.Numerator = 0
		view.Denominator = 0
		view.Disclosed = true
	case view.Denominator == 0:
		view.Coverage = "empty"
		view.Disclosed = true
	default:
		view.Coverage = "ready"
	}
	return view, nil
}

func recordReportObservation(actor authzSubject, projectID int, environment string, source reportSource) error {
	environment = strings.ToLower(strings.TrimSpace(environment))
	source.ID = strings.ToLower(strings.TrimSpace(source.ID))
	if err := reportAccess(actor, projectID, environment, true); err != nil || !incidentToken(source.ID) || source.Numerator < 0 || source.Denominator < 0 {
		if err == nil {
			err = errOutcomeInvalid
		}
		return err
	}
	return saveReportObservation(projectID, environment, source)
}

func setReportDrafts(actor authzSubject, projectID int, environment string, enabled bool) error {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := reportAccess(actor, projectID, environment, true); err != nil {
		return err
	}
	return saveReportDraftGate(projectID, environment, enabled)
}

func saveDraft(actor authzSubject, projectID int, environment, metric, text string, citations []string) (reportDraft, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	metric = strings.ToLower(strings.TrimSpace(metric))
	if err := reportAccess(actor, projectID, environment, true); err != nil {
		return reportDraft{}, err
	}
	enabled, err := loadReportDraftGate(projectID, environment)
	if err != nil || !enabled {
		return reportDraft{}, errOutcomeInvalid
	}
	view, err := readReport(actor, projectID, environment, metric)
	if err != nil {
		return reportDraft{}, err
	}
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 2000 || draftActionText(text) || len(citations) == 0 {
		return reportDraft{}, errOutcomeInvalid
	}
	for _, citation := range citations {
		if !reportCited(view.Citations, citation) {
			return reportDraft{}, errOutcomeInvalid
		}
	}
	item := reportDraft{
		ProjectID: projectID, Environment: environment, Metric: metric, Text: text,
		Citations: append([]string{}, citations...), State: "draft", AuthorUserID: actor.UserID,
	}
	return saveReportDraftRecord(item)
}

func publishDraft(actor authzSubject, draftID, reviewerID int) (reportDraft, error) {
	item, err := loadReportDraftRecord(draftID)
	if err != nil || item.ID == 0 {
		return reportDraft{}, errOutcomeHidden
	}
	if err := reportAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return reportDraft{}, err
	}
	if item.State != "draft" || reviewerID <= 0 || reviewerID == actor.UserID || reviewerID == item.AuthorUserID || len(item.Citations) == 0 {
		return reportDraft{}, errOutcomeInvalid
	}
	item.State = "published"
	item.ReviewerID = reviewerID
	item.CanExecute = false
	return updateReportDraftRecord(item)
}

func reportAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errOutcomeInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errOutcomeHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errOutcomeDenied
	}
	return nil
}

func reportMetric(metric string) (string, string, bool) {
	switch metric {
	case "delivery":
		return "delivered deployments", "attempted deployments", true
	case "incident":
		return "opened incidents", "services in the environment", true
	case "remediation":
		return "closed findings", "findings with a recorded due date", true
	default:
		return "", "", false
	}
}

func reportSourceIDs(metric string) []string {
	switch metric {
	case "delivery":
		return []string{"deployments"}
	case "incident":
		return []string{"incidents", "services"}
	case "remediation":
		return []string{"findings"}
	default:
		return nil
	}
}

func reportCited(citations []string, id string) bool {
	for _, citation := range citations {
		if citation == id {
			return true
		}
	}
	return false
}

func draftActionText(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(lower, "execute") || strings.Contains(lower, "approve") || strings.Contains(lower, "password") || strings.Contains(lower, "secret")
}

func migrateReportingSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS report_definitions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			metric_name TEXT NOT NULL,
			numerator_label TEXT NOT NULL,
			denominator_label TEXT NOT NULL,
			time_zone TEXT NOT NULL,
			UNIQUE (project_id, environment, metric_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS report_observations (
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			source_id TEXT NOT NULL,
			present BOOLEAN NOT NULL,
			numerator INTEGER NOT NULL,
			denominator INTEGER NOT NULL,
			PRIMARY KEY (project_id, environment, source_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS report_draft_gates (
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			enabled BOOLEAN NOT NULL,
			PRIMARY KEY (project_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS report_drafts (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			metric_name TEXT NOT NULL,
			body TEXT NOT NULL,
			citations TEXT NOT NULL,
			state TEXT NOT NULL,
			author_user_id INTEGER NOT NULL,
			reviewer_user_id INTEGER NOT NULL DEFAULT 0
		)
	`)
}

func saveReportDefinitionToDB(item reportDefinition) (reportDefinition, error) {
	if DB == nil {
		return reportDefinition{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO report_definitions (project_id, environment, metric_name, numerator_label, denominator_label, time_zone)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (project_id, environment, metric_name)
		DO UPDATE SET numerator_label = EXCLUDED.numerator_label, denominator_label = EXCLUDED.denominator_label, time_zone = EXCLUDED.time_zone
		RETURNING id
	`, item.ProjectID, item.Environment, item.Metric, item.Numerator, item.Denominator, item.Timezone).Scan(&item.ID)
	return item, err
}

func loadReportDefinitionFromDB(projectID int, environment, metric string) (reportDefinition, error) {
	if DB == nil {
		return reportDefinition{}, errInboxStored
	}
	var item reportDefinition
	err := DB.QueryRow(`
		SELECT id, project_id, environment, metric_name, numerator_label, denominator_label, time_zone
		FROM report_definitions WHERE project_id = $1 AND environment = $2 AND metric_name = $3
	`, projectID, environment, metric).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Metric, &item.Numerator, &item.Denominator, &item.Timezone)
	if err != nil {
		return reportDefinition{}, nil
	}
	return item, nil
}

func loadReportDraftGateFromDB(projectID int, environment string) (bool, error) {
	if DB == nil {
		return false, errInboxStored
	}
	var enabled bool
	err := DB.QueryRow(`SELECT enabled FROM report_draft_gates WHERE project_id = $1 AND environment = $2`, projectID, environment).Scan(&enabled)
	if err != nil {
		return false, nil
	}
	return enabled, nil
}

func saveReportDraftGateToDB(projectID int, environment string, enabled bool) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO report_draft_gates (project_id, environment, enabled) VALUES ($1,$2,$3)
		ON CONFLICT (project_id, environment) DO UPDATE SET enabled = EXCLUDED.enabled
	`, projectID, environment, enabled)
	return err
}

func loadReportSourcesFromDB(projectID int, environment string) ([]reportSource, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT source_id, present, numerator, denominator FROM report_observations WHERE project_id = $1 AND environment = $2`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []reportSource
	for rows.Next() {
		var item reportSource
		if err := rows.Scan(&item.ID, &item.Present, &item.Numerator, &item.Denominator); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveReportObservationToDB(projectID int, environment string, source reportSource) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO report_observations (project_id, environment, source_id, present, numerator, denominator)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (project_id, environment, source_id)
		DO UPDATE SET present = EXCLUDED.present, numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator
	`, projectID, environment, source.ID, source.Present, source.Numerator, source.Denominator)
	return err
}

func saveReportDraftToDB(item reportDraft) (reportDraft, error) {
	if DB == nil {
		return reportDraft{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO report_drafts (project_id, environment, metric_name, body, citations, state, author_user_id, reviewer_user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
	`, item.ProjectID, item.Environment, item.Metric, item.Text, strings.Join(item.Citations, ","), item.State, item.AuthorUserID, item.ReviewerID).Scan(&item.ID)
	item.CanExecute = false
	return item, err
}

func loadReportDraftFromDB(id int) (reportDraft, error) {
	if DB == nil {
		return reportDraft{}, errInboxStored
	}
	var item reportDraft
	var citations string
	err := DB.QueryRow(`
		SELECT id, project_id, environment, metric_name, body, citations, state, author_user_id, reviewer_user_id
		FROM report_drafts WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Metric, &item.Text, &citations, &item.State, &item.AuthorUserID, &item.ReviewerID)
	if err != nil {
		return reportDraft{}, nil
	}
	if citations != "" {
		item.Citations = strings.Split(citations, ",")
	}
	return item, nil
}

func updateReportDraftToDB(item reportDraft) (reportDraft, error) {
	if DB == nil {
		return reportDraft{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE report_drafts SET state = $2, reviewer_user_id = $3 WHERE id = $1`, item.ID, item.State, item.ReviewerID)
	item.CanExecute = false
	return item, err
}

func saveReportAuditToDB(item reportAudit) error {
	if DB == nil {
		return nil
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "report_definition",
		ResourceID: item.ResourceID, Action: "report_definition", Result: "success", Summary: item.Summary,
	})
	return nil
}

func reportDefinitionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeOutcomeError(w, errOutcomeHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Metric      string `json:"metric"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	item, err := saveReport(actor, body.ProjectID, body.Environment, body.Metric)
	if err != nil {
		writeOutcomeError(w, err)
		return
	}
	writeOutcomeJSON(w, item)
}

func reportViewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeOutcomeError(w, errOutcomeHidden)
		return
	}
	projectID := 0
	if raw := r.URL.Query().Get("project_id"); raw != "" {
		for _, ch := range raw {
			if ch < '0' || ch > '9' {
				writeOutcomeError(w, errOutcomeInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
	}
	item, err := readReport(actor, projectID, r.URL.Query().Get("environment"), r.URL.Query().Get("metric"))
	if err != nil {
		writeOutcomeError(w, err)
		return
	}
	writeOutcomeJSON(w, item)
}

func reportDraftHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeOutcomeError(w, errOutcomeHidden)
		return
	}
	var body struct {
		ProjectID   int      `json:"project_id"`
		Environment string   `json:"environment"`
		Metric      string   `json:"metric"`
		Text        string   `json:"text"`
		Citations   []string `json:"citations"`
		Action      string   `json:"action"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil || body.Action != "" {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	item, err := saveDraft(actor, body.ProjectID, body.Environment, body.Metric, body.Text, body.Citations)
	if err != nil {
		writeOutcomeError(w, err)
		return
	}
	writeOutcomeJSON(w, item)
}

func reportPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeOutcomeError(w, errOutcomeHidden)
		return
	}
	var body struct {
		DraftID    int `json:"draft_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeOutcomeError(w, errOutcomeInvalid)
		return
	}
	item, err := publishDraft(actor, body.DraftID, body.ReviewerID)
	if err != nil {
		writeOutcomeError(w, err)
		return
	}
	writeOutcomeJSON(w, item)
}

func writeOutcomeJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeOutcomeError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errOutcomeHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errOutcomeDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "report request failed"})
}
