package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	errPilotHidden  = errors.New("pilot hidden")
	errPilotDenied  = errors.New("pilot denied")
	errPilotInvalid = errors.New("pilot invalid")
)

var pilotStepNames = []string{"provisioning", "deployment", "scan", "fix", "incident", "restore"}
var pilotEnvironmentNames = []string{"staging", "production"}

type pilotJourney struct {
	ID        int    `json:"id"`
	ProjectID int    `json:"project_id"`
	TeamID    int    `json:"team_id"`
	Service   string `json:"service"`
	Account   string `json:"account"`
	Ready     bool   `json:"ready"`
}

type pilotStep struct {
	ID          int    `json:"id"`
	JourneyID   int    `json:"journey_id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Step        string `json:"step"`
	Evidence    string `json:"evidence"`
	State       string `json:"state"`
}

type pilotRollback struct {
	ID             int    `json:"id"`
	JourneyID      int    `json:"journey_id"`
	Environment    string `json:"environment"`
	ElapsedSet     bool   `json:"elapsed_set"`
	ElapsedSeconds int    `json:"elapsed_seconds"`
	State          string `json:"state"`
}

type pilotBlocker struct {
	ID         int    `json:"id"`
	JourneyID  int    `json:"journey_id"`
	Severity   string `json:"severity"`
	Summary    string `json:"summary"`
	State      string `json:"state"`
	ReviewerID int    `json:"reviewer_id"`
}

type pilotFeedback struct {
	ID        int    `json:"id"`
	JourneyID int    `json:"journey_id"`
	Note      string `json:"note"`
}

type pilotRelease struct {
	ID         int    `json:"id"`
	JourneyID  int    `json:"journey_id"`
	State      string `json:"state"`
	ReviewerID int    `json:"reviewer_id"`
	Applied    bool   `json:"applied"`
}

type pilotExpansion struct {
	ID         int    `json:"id"`
	JourneyID  int    `json:"journey_id"`
	Provider   string `json:"provider"`
	Scope      string `json:"scope"`
	OwnerID    int    `json:"owner_id"`
	State      string `json:"state"`
	ReviewerID int    `json:"reviewer_id"`
	Applied    bool   `json:"applied"`
}

var (
	findPilotJourney      = findPilotJourneyFromDB
	savePilotJourney      = savePilotJourneyToDB
	loadPilotJourney      = loadPilotJourneyFromDB
	findPilotStep         = findPilotStepFromDB
	savePilotStep         = savePilotStepToDB
	updatePilotStep       = updatePilotStepToDB
	listPilotSteps        = listPilotStepsFromDB
	findPilotRollback     = findPilotRollbackFromDB
	savePilotRollback     = savePilotRollbackToDB
	updatePilotRollback   = updatePilotRollbackToDB
	listPilotRollbacks    = listPilotRollbacksFromDB
	savePilotBlockerRow   = savePilotBlockerToDB
	loadPilotBlockerRow   = loadPilotBlockerFromDB
	updatePilotBlocker    = updatePilotBlockerToDB
	listPilotBlockers     = listPilotBlockersFromDB
	savePilotFeedbackRow  = savePilotFeedbackToDB
	findPilotRelease      = findPilotReleaseFromDB
	savePilotRelease      = savePilotReleaseToDB
	findPilotExpansion    = findPilotExpansionFromDB
	savePilotExpansionRow = savePilotExpansionToDB
	loadPilotExpansion    = loadPilotExpansionFromDB
	updatePilotExpansion  = updatePilotExpansionToDB
	savePilotAudit        = savePilotAuditToDB
)

func openPilotJourney(actor authzSubject, projectID, teamID int, service, account string) (pilotJourney, error) {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if err := pilotJourneyAccess(actor, projectID, true); err != nil || teamID <= 0 || !incidentToken(service) || !incidentToken(account) || pilotSensitive(account) {
		if err == nil {
			err = errPilotInvalid
		}
		return pilotJourney{}, err
	}
	current, err := findPilotJourney(projectID, service)
	if err != nil {
		return pilotJourney{}, err
	}
	if current.ID > 0 {
		current.Ready, _ = pilotChecklistReady(current.ID)
		return current, nil
	}
	saved, err := savePilotJourney(pilotJourney{ProjectID: projectID, TeamID: teamID, Service: service, Account: account})
	if err != nil {
		return pilotJourney{}, err
	}
	_ = savePilotAudit(projectID, service, actor.UserID, "pilot journey saved")
	return saved, nil
}

func recordPilotEvidence(actor authzSubject, journeyID int, environment, step, evidence string) (pilotStep, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotStep{}, errPilotHidden
	}
	environment = strings.ToLower(strings.TrimSpace(environment))
	step = strings.ToLower(strings.TrimSpace(step))
	if err := pilotEnvironmentAccess(actor, journey.ProjectID, environment, true); err != nil || !pilotStepName(step) {
		if err == nil {
			err = errPilotInvalid
		}
		return pilotStep{}, err
	}
	if pilotSensitive(evidence) {
		return pilotStep{}, errPilotInvalid
	}
	item := pilotStep{JourneyID: journey.ID, ProjectID: journey.ProjectID, Environment: environment, Step: step, Evidence: strings.TrimSpace(evidence), State: "unknown"}
	if item.Evidence != "" {
		item.State = "recorded"
	}
	current, err := findPilotStep(journey.ID, environment, step)
	if err != nil {
		return pilotStep{}, err
	}
	if current.ID > 0 {
		item.ID = current.ID
		return updatePilotStep(item)
	}
	return savePilotStep(item)
}

func rehearsePilotRollback(actor authzSubject, journeyID int, environment string, elapsedSet bool, elapsed int) (pilotRollback, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotRollback{}, errPilotHidden
	}
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := pilotEnvironmentAccess(actor, journey.ProjectID, environment, true); err != nil {
		return pilotRollback{}, err
	}
	item := pilotRollback{JourneyID: journey.ID, Environment: environment, ElapsedSet: elapsedSet, State: "unknown"}
	if elapsedSet && elapsed >= 0 {
		item.ElapsedSeconds = elapsed
		item.State = "rehearsed"
	}
	current, err := findPilotRollback(journey.ID, environment)
	if err != nil {
		return pilotRollback{}, err
	}
	if current.ID > 0 {
		item.ID = current.ID
		return updatePilotRollback(item)
	}
	return savePilotRollback(item)
}

func openPilotBlocker(actor authzSubject, journeyID int, severity, summary string) (pilotBlocker, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotBlocker{}, errPilotHidden
	}
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil || pilotSensitive(summary) || strings.TrimSpace(summary) == "" {
		if err == nil {
			err = errPilotInvalid
		}
		return pilotBlocker{}, err
	}
	severity = strings.ToLower(strings.TrimSpace(severity))
	if severity != "critical" && severity != "normal" {
		return pilotBlocker{}, errPilotInvalid
	}
	return savePilotBlockerRow(pilotBlocker{JourneyID: journey.ID, Severity: severity, Summary: strings.TrimSpace(summary), State: "open"})
}

func resolvePilotBlocker(actor authzSubject, blockerID, reviewerID int, evidence string) (pilotBlocker, error) {
	item, err := loadPilotBlockerRow(blockerID)
	if err != nil || item.ID == 0 {
		return pilotBlocker{}, errPilotHidden
	}
	journey, err := loadPilotJourney(item.JourneyID)
	if err != nil || journey.ID == 0 {
		return pilotBlocker{}, errPilotHidden
	}
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil {
		return pilotBlocker{}, err
	}
	if reviewerID <= 0 || reviewerID == actor.UserID || pilotSensitive(evidence) || strings.TrimSpace(evidence) == "" || item.State != "open" {
		return pilotBlocker{}, errPilotInvalid
	}
	item.State = "resolved"
	item.ReviewerID = reviewerID
	return updatePilotBlocker(item)
}

func savePilotFeedback(actor authzSubject, journeyID int, note string) (pilotFeedback, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotFeedback{}, errPilotHidden
	}
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil || pilotSensitive(note) || strings.TrimSpace(note) == "" || len(note) > 500 {
		if err == nil {
			err = errPilotInvalid
		}
		return pilotFeedback{}, err
	}
	return savePilotFeedbackRow(pilotFeedback{JourneyID: journey.ID, Note: strings.TrimSpace(note)})
}

func publishPilotRelease(actor authzSubject, journeyID, reviewerID int) (pilotRelease, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotRelease{}, errPilotHidden
	}
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil {
		return pilotRelease{}, err
	}
	current, err := findPilotRelease(journey.ID)
	if err != nil {
		return pilotRelease{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	ready, err := pilotChecklistReady(journey.ID)
	if err != nil {
		return pilotRelease{}, err
	}
	rehearsed, err := pilotRollbackReady(journey.ID)
	if err != nil {
		return pilotRelease{}, err
	}
	blocked, err := pilotCriticalOpen(journey.ID)
	if err != nil {
		return pilotRelease{}, err
	}
	if reviewerID <= 0 || reviewerID == actor.UserID || !ready || !rehearsed || blocked {
		return pilotRelease{}, errPilotInvalid
	}
	saved, err := savePilotRelease(pilotRelease{JourneyID: journey.ID, State: "accepted", ReviewerID: reviewerID, Applied: true})
	if err != nil {
		return pilotRelease{}, err
	}
	_ = savePilotAudit(journey.ProjectID, journey.Service, actor.UserID, "pilot release accepted")
	return saved, nil
}

func proposePilotExpansion(actor authzSubject, journeyID int, provider, scope string, ownerID int) (pilotExpansion, error) {
	journey, err := loadPilotJourney(journeyID)
	if err != nil || journey.ID == 0 {
		return pilotExpansion{}, errPilotHidden
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	scope = strings.ToLower(strings.TrimSpace(scope))
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil || !pilotProvider(provider) || !singleEnvironment(scope) || ownerID <= 0 {
		if err == nil {
			err = errPilotInvalid
		}
		return pilotExpansion{}, err
	}
	current, err := findPilotExpansion(journey.ID, provider)
	if err != nil {
		return pilotExpansion{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	return savePilotExpansionRow(pilotExpansion{JourneyID: journey.ID, Provider: provider, Scope: scope, OwnerID: ownerID, State: "proposed", Applied: true})
}

func acceptPilotExpansion(actor authzSubject, expansionID, reviewerID int) (pilotExpansion, error) {
	item, err := loadPilotExpansion(expansionID)
	if err != nil || item.ID == 0 {
		return pilotExpansion{}, errPilotHidden
	}
	journey, err := loadPilotJourney(item.JourneyID)
	if err != nil || journey.ID == 0 {
		return pilotExpansion{}, errPilotHidden
	}
	if err := pilotJourneyAccess(actor, journey.ProjectID, true); err != nil {
		return pilotExpansion{}, err
	}
	release, err := findPilotRelease(journey.ID)
	if err != nil {
		return pilotExpansion{}, err
	}
	if reviewerID <= 0 || reviewerID == actor.UserID || release.State != "accepted" || item.State != "proposed" {
		return pilotExpansion{}, errPilotInvalid
	}
	item.State = "accepted"
	item.ReviewerID = reviewerID
	item.Applied = true
	return updatePilotExpansion(item)
}

func readPilotJourney(actor authzSubject, projectID int, service string) (pilotJourney, error) {
	if err := pilotJourneyAccess(actor, projectID, false); err != nil {
		return pilotJourney{}, err
	}
	item, err := findPilotJourney(projectID, strings.TrimSpace(service))
	if err != nil || item.ID == 0 {
		return pilotJourney{}, errPilotHidden
	}
	item.Ready, _ = pilotChecklistReady(item.ID)
	return item, nil
}

func pilotChecklistReady(journeyID int) (bool, error) {
	steps, err := listPilotSteps(journeyID)
	if err != nil {
		return false, err
	}
	seen := map[string]bool{}
	for _, step := range steps {
		if step.State == "recorded" && step.Evidence != "" {
			seen[step.Environment+"/"+step.Step] = true
		}
	}
	for _, environment := range pilotEnvironmentNames {
		for _, step := range pilotStepNames {
			if !seen[environment+"/"+step] {
				return false, nil
			}
		}
	}
	return true, nil
}

func pilotRollbackReady(journeyID int) (bool, error) {
	items, err := listPilotRollbacks(journeyID)
	if err != nil {
		return false, err
	}
	seen := map[string]bool{}
	for _, item := range items {
		if item.State == "rehearsed" && item.ElapsedSet {
			seen[item.Environment] = true
		}
	}
	return seen["staging"] && seen["production"], nil
}

func pilotCriticalOpen(journeyID int) (bool, error) {
	items, err := listPilotBlockers(journeyID)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if item.Severity == "critical" && item.State == "open" {
			return true, nil
		}
	}
	return false, nil
}

func pilotJourneyAccess(actor authzSubject, projectID int, write bool) error {
	if projectID <= 0 {
		return errPilotInvalid
	}
	action := authzRead
	if write {
		action = authzWrite
	}
	if !catalogEnvironmentsAllowed(actor, projectID, pilotEnvironmentNames, authzRead) {
		return errPilotHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, pilotEnvironmentNames, action) {
		return errPilotDenied
	}
	return nil
}

func pilotEnvironmentAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if !pilotEnvironmentName(environment) {
		return errPilotInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errPilotHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errPilotDenied
	}
	return nil
}

func pilotEnvironmentName(environment string) bool {
	for _, name := range pilotEnvironmentNames {
		if environment == name {
			return true
		}
	}
	return false
}

func pilotStepName(step string) bool {
	for _, name := range pilotStepNames {
		if step == name {
			return true
		}
	}
	return false
}

func pilotProvider(provider string) bool {
	switch provider {
	case "azure", "gcp", "runtime":
		return true
	default:
		return false
	}
}

func pilotSensitive(detail string) bool {
	lower := strings.ToLower(detail)
	if strings.EqualFold(strings.TrimSpace(detail), "healthy") {
		return true
	}
	if strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.Contains(lower, "execute") || strings.Contains(lower, "approve") {
		return true
	}
	for _, blocked := range []string{"i-0a1b2c3d4e5f67890", "db-platform-prod", "setuops-artifacts-uat", "setuops-terraform-dev", "arn:aws:eks", "arn:aws:lambda"} {
		if strings.Contains(lower, blocked) {
			return true
		}
	}
	return false
}

func migratePilotSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_journeys (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			team_id INTEGER NOT NULL,
			service_key TEXT NOT NULL,
			account_label TEXT NOT NULL,
			UNIQUE (project_id, service_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_steps (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			step_name TEXT NOT NULL,
			evidence TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL,
			UNIQUE (journey_id, environment, step_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_rollbacks (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			elapsed_set BOOLEAN NOT NULL,
			elapsed_seconds INTEGER NOT NULL DEFAULT 0,
			state TEXT NOT NULL,
			UNIQUE (journey_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_blockers (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL,
			severity TEXT NOT NULL,
			summary TEXT NOT NULL,
			state TEXT NOT NULL,
			reviewer_id INTEGER NOT NULL DEFAULT 0
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_feedback (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL,
			note TEXT NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_releases (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL UNIQUE,
			state TEXT NOT NULL,
			reviewer_id INTEGER NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pilot_expansions (
			id SERIAL PRIMARY KEY,
			journey_id INTEGER NOT NULL,
			provider TEXT NOT NULL,
			scope_name TEXT NOT NULL,
			owner_id INTEGER NOT NULL,
			state TEXT NOT NULL,
			reviewer_id INTEGER NOT NULL DEFAULT 0,
			UNIQUE (journey_id, provider)
		)
	`)
}

func findPilotJourneyFromDB(projectID int, service string) (pilotJourney, error) {
	if DB == nil {
		return pilotJourney{}, errInboxStored
	}
	var item pilotJourney
	err := DB.QueryRow(`SELECT id, project_id, team_id, service_key, account_label FROM pilot_journeys WHERE project_id = $1 AND service_key = $2`, projectID, service).Scan(&item.ID, &item.ProjectID, &item.TeamID, &item.Service, &item.Account)
	if err != nil {
		return pilotJourney{}, nil
	}
	return item, nil
}

func savePilotJourneyToDB(item pilotJourney) (pilotJourney, error) {
	if DB == nil {
		return pilotJourney{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_journeys (project_id, team_id, service_key, account_label) VALUES ($1,$2,$3,$4) RETURNING id`, item.ProjectID, item.TeamID, item.Service, item.Account).Scan(&item.ID)
	return item, err
}

func loadPilotJourneyFromDB(id int) (pilotJourney, error) {
	if DB == nil {
		return pilotJourney{}, errInboxStored
	}
	var item pilotJourney
	err := DB.QueryRow(`SELECT id, project_id, team_id, service_key, account_label FROM pilot_journeys WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.TeamID, &item.Service, &item.Account)
	if err != nil {
		return pilotJourney{}, nil
	}
	return item, nil
}

func findPilotStepFromDB(journeyID int, environment, step string) (pilotStep, error) {
	if DB == nil {
		return pilotStep{}, errInboxStored
	}
	var item pilotStep
	err := DB.QueryRow(`SELECT id, journey_id, project_id, environment, step_name, evidence, state FROM pilot_steps WHERE journey_id = $1 AND environment = $2 AND step_name = $3`, journeyID, environment, step).Scan(&item.ID, &item.JourneyID, &item.ProjectID, &item.Environment, &item.Step, &item.Evidence, &item.State)
	if err != nil {
		return pilotStep{}, nil
	}
	return item, nil
}

func savePilotStepToDB(item pilotStep) (pilotStep, error) {
	if DB == nil {
		return pilotStep{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_steps (journey_id, project_id, environment, step_name, evidence, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, item.JourneyID, item.ProjectID, item.Environment, item.Step, item.Evidence, item.State).Scan(&item.ID)
	return item, err
}

func updatePilotStepToDB(item pilotStep) (pilotStep, error) {
	if DB == nil {
		return pilotStep{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE pilot_steps SET evidence = $2, state = $3 WHERE id = $1`, item.ID, item.Evidence, item.State)
	return item, err
}

func listPilotStepsFromDB(journeyID int) ([]pilotStep, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, journey_id, project_id, environment, step_name, evidence, state FROM pilot_steps WHERE journey_id = $1 ORDER BY id`, journeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []pilotStep
	for rows.Next() {
		var item pilotStep
		if err := rows.Scan(&item.ID, &item.JourneyID, &item.ProjectID, &item.Environment, &item.Step, &item.Evidence, &item.State); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func findPilotRollbackFromDB(journeyID int, environment string) (pilotRollback, error) {
	if DB == nil {
		return pilotRollback{}, errInboxStored
	}
	var item pilotRollback
	err := DB.QueryRow(`SELECT id, journey_id, environment, elapsed_set, elapsed_seconds, state FROM pilot_rollbacks WHERE journey_id = $1 AND environment = $2`, journeyID, environment).Scan(&item.ID, &item.JourneyID, &item.Environment, &item.ElapsedSet, &item.ElapsedSeconds, &item.State)
	if err != nil {
		return pilotRollback{}, nil
	}
	return item, nil
}

func savePilotRollbackToDB(item pilotRollback) (pilotRollback, error) {
	if DB == nil {
		return pilotRollback{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_rollbacks (journey_id, environment, elapsed_set, elapsed_seconds, state) VALUES ($1,$2,$3,$4,$5) RETURNING id`, item.JourneyID, item.Environment, item.ElapsedSet, item.ElapsedSeconds, item.State).Scan(&item.ID)
	return item, err
}

func updatePilotRollbackToDB(item pilotRollback) (pilotRollback, error) {
	if DB == nil {
		return pilotRollback{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE pilot_rollbacks SET elapsed_set = $2, elapsed_seconds = $3, state = $4 WHERE id = $1`, item.ID, item.ElapsedSet, item.ElapsedSeconds, item.State)
	return item, err
}

func listPilotRollbacksFromDB(journeyID int) ([]pilotRollback, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, journey_id, environment, elapsed_set, elapsed_seconds, state FROM pilot_rollbacks WHERE journey_id = $1`, journeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []pilotRollback
	for rows.Next() {
		var item pilotRollback
		if err := rows.Scan(&item.ID, &item.JourneyID, &item.Environment, &item.ElapsedSet, &item.ElapsedSeconds, &item.State); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func savePilotBlockerToDB(item pilotBlocker) (pilotBlocker, error) {
	if DB == nil {
		return pilotBlocker{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_blockers (journey_id, severity, summary, state, reviewer_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, item.JourneyID, item.Severity, item.Summary, item.State, item.ReviewerID).Scan(&item.ID)
	return item, err
}

func loadPilotBlockerFromDB(id int) (pilotBlocker, error) {
	if DB == nil {
		return pilotBlocker{}, errInboxStored
	}
	var item pilotBlocker
	err := DB.QueryRow(`SELECT id, journey_id, severity, summary, state, reviewer_id FROM pilot_blockers WHERE id = $1`, id).Scan(&item.ID, &item.JourneyID, &item.Severity, &item.Summary, &item.State, &item.ReviewerID)
	if err != nil {
		return pilotBlocker{}, nil
	}
	return item, nil
}

func updatePilotBlockerToDB(item pilotBlocker) (pilotBlocker, error) {
	if DB == nil {
		return pilotBlocker{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE pilot_blockers SET state = $2, reviewer_id = $3 WHERE id = $1`, item.ID, item.State, item.ReviewerID)
	return item, err
}

func listPilotBlockersFromDB(journeyID int) ([]pilotBlocker, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, journey_id, severity, summary, state, reviewer_id FROM pilot_blockers WHERE journey_id = $1`, journeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []pilotBlocker
	for rows.Next() {
		var item pilotBlocker
		if err := rows.Scan(&item.ID, &item.JourneyID, &item.Severity, &item.Summary, &item.State, &item.ReviewerID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func savePilotFeedbackToDB(item pilotFeedback) (pilotFeedback, error) {
	if DB == nil {
		return pilotFeedback{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_feedback (journey_id, note) VALUES ($1,$2) RETURNING id`, item.JourneyID, item.Note).Scan(&item.ID)
	return item, err
}

func findPilotReleaseFromDB(journeyID int) (pilotRelease, error) {
	if DB == nil {
		return pilotRelease{}, errInboxStored
	}
	var item pilotRelease
	err := DB.QueryRow(`SELECT id, journey_id, state, reviewer_id FROM pilot_releases WHERE journey_id = $1`, journeyID).Scan(&item.ID, &item.JourneyID, &item.State, &item.ReviewerID)
	if err != nil {
		return pilotRelease{}, nil
	}
	return item, nil
}

func savePilotReleaseToDB(item pilotRelease) (pilotRelease, error) {
	if DB == nil {
		return pilotRelease{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_releases (journey_id, state, reviewer_id) VALUES ($1,$2,$3) RETURNING id`, item.JourneyID, item.State, item.ReviewerID).Scan(&item.ID)
	return item, err
}

func findPilotExpansionFromDB(journeyID int, provider string) (pilotExpansion, error) {
	if DB == nil {
		return pilotExpansion{}, errInboxStored
	}
	var item pilotExpansion
	err := DB.QueryRow(`SELECT id, journey_id, provider, scope_name, owner_id, state, reviewer_id FROM pilot_expansions WHERE journey_id = $1 AND provider = $2`, journeyID, provider).Scan(&item.ID, &item.JourneyID, &item.Provider, &item.Scope, &item.OwnerID, &item.State, &item.ReviewerID)
	if err != nil {
		return pilotExpansion{}, nil
	}
	return item, nil
}

func savePilotExpansionToDB(item pilotExpansion) (pilotExpansion, error) {
	if DB == nil {
		return pilotExpansion{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pilot_expansions (journey_id, provider, scope_name, owner_id, state, reviewer_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, item.JourneyID, item.Provider, item.Scope, item.OwnerID, item.State, item.ReviewerID).Scan(&item.ID)
	return item, err
}

func loadPilotExpansionFromDB(id int) (pilotExpansion, error) {
	if DB == nil {
		return pilotExpansion{}, errInboxStored
	}
	var item pilotExpansion
	err := DB.QueryRow(`SELECT id, journey_id, provider, scope_name, owner_id, state, reviewer_id FROM pilot_expansions WHERE id = $1`, id).Scan(&item.ID, &item.JourneyID, &item.Provider, &item.Scope, &item.OwnerID, &item.State, &item.ReviewerID)
	if err != nil {
		return pilotExpansion{}, nil
	}
	return item, nil
}

func updatePilotExpansionToDB(item pilotExpansion) (pilotExpansion, error) {
	if DB == nil {
		return pilotExpansion{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE pilot_expansions SET state = $2, reviewer_id = $3 WHERE id = $1`, item.ID, item.State, item.ReviewerID)
	return item, err
}

func savePilotAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "pilot_journey",
		ResourceID: resourceID, Action: "pilot_journey", Result: "success", Summary: summary,
	})
	return nil
}

func pilotJourneyHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writePilotError(w, errPilotInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		item, err := readPilotJourney(actor, projectID, r.URL.Query().Get("service"))
		if err != nil {
			writePilotError(w, err)
			return
		}
		writePilotJSON(w, item)
		return
	}
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	var body struct {
		ProjectID int    `json:"project_id"`
		TeamID    int    `json:"team_id"`
		Service   string `json:"service"`
		Account   string `json:"account"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := openPilotJourney(actor, body.ProjectID, body.TeamID, body.Service, body.Account)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotStepHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID   int    `json:"journey_id"`
		Environment string `json:"environment"`
		Step        string `json:"step"`
		Evidence    string `json:"evidence"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := recordPilotEvidence(actor, body.JourneyID, body.Environment, body.Step, body.Evidence)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotRollbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID   int    `json:"journey_id"`
		Environment string `json:"environment"`
		ElapsedSet  bool   `json:"elapsed_set"`
		Elapsed     int    `json:"elapsed_seconds"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := rehearsePilotRollback(actor, body.JourneyID, body.Environment, body.ElapsedSet, body.Elapsed)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotBlockerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID int    `json:"journey_id"`
		Severity  string `json:"severity"`
		Summary   string `json:"summary"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := openPilotBlocker(actor, body.JourneyID, body.Severity, body.Summary)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotBlockerResolveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		BlockerID  int    `json:"blocker_id"`
		ReviewerID int    `json:"reviewer_id"`
		Evidence   string `json:"evidence"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := resolvePilotBlocker(actor, body.BlockerID, body.ReviewerID, body.Evidence)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotFeedbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID int    `json:"journey_id"`
		Note      string `json:"note"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := savePilotFeedback(actor, body.JourneyID, body.Note)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotReleaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID  int `json:"journey_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := publishPilotRelease(actor, body.JourneyID, body.ReviewerID)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotExpansionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		JourneyID int    `json:"journey_id"`
		Provider  string `json:"provider"`
		Scope     string `json:"scope"`
		OwnerID   int    `json:"owner_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := proposePilotExpansion(actor, body.JourneyID, body.Provider, body.Scope, body.OwnerID)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func pilotExpansionAcceptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePilotError(w, errPilotInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writePilotError(w, errPilotHidden)
		return
	}
	var body struct {
		ExpansionID int `json:"expansion_id"`
		ReviewerID  int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writePilotError(w, errPilotInvalid)
		return
	}
	item, err := acceptPilotExpansion(actor, body.ExpansionID, body.ReviewerID)
	if err != nil {
		writePilotError(w, err)
		return
	}
	writePilotJSON(w, item)
}

func writePilotJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writePilotError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errPilotHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errPilotDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "pilot request failed"})
}
