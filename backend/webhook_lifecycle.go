package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const lifecycleMaxAttempts = 3

var (
	errLifecycleHidden  = errors.New("lifecycle hidden")
	errLifecycleDenied  = errors.New("lifecycle denied")
	errLifecycleInvalid = errors.New("lifecycle invalid")
)

type lifecycleCheck struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Scenario    string `json:"scenario"`
	Subject     string `json:"subject"`
	Revision    int    `json:"revision"`
	Attempts    int    `json:"attempts"`
	Effect      int    `json:"effect"`
	State       string `json:"state"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

var (
	findLifecycleCheck   = findLifecycleCheckFromDB
	saveLifecycleCheck   = saveLifecycleCheckToDB
	updateLifecycleCheck = updateLifecycleCheckToDB
	listLifecycleChecks  = listLifecycleChecksFromDB
	saveLifecycleAudit   = saveLifecycleAuditToDB
)

func recordLifecycleCheck(actor authzSubject, projectID int, environment, scenario, subject string, revision int, detail string) (lifecycleCheck, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	scenario = strings.ToLower(strings.TrimSpace(scenario))
	subject = strings.TrimSpace(subject)
	if err := lifecycleAccess(actor, projectID, environment, true); err != nil || !lifecycleScenario(scenario) || !incidentToken(subject) || revision < 0 || pilotSensitive(detail) {
		if err == nil {
			err = errLifecycleInvalid
		}
		return lifecycleCheck{}, err
	}
	if scenario == "invalid_signature" {
		return lifecycleCheck{}, errLifecycleInvalid
	}
	if scenario == "sandbox" && strings.TrimSpace(detail) != "" {
		return lifecycleCheck{}, errLifecycleInvalid
	}
	current, err := findLifecycleCheck(projectID, environment, scenario, subject)
	if err != nil {
		return lifecycleCheck{}, err
	}
	if current.ID > 0 {
		return replayLifecycle(current, revision)
	}
	item := lifecycleCheck{ProjectID: projectID, Environment: environment, Scenario: scenario, Subject: subject, Revision: revision, Attempts: 1, Effect: 1, Applied: true}
	switch scenario {
	case "worker_crash":
		item.State = "recoverable"
		item.Reason = "failure retained"
	case "provider_outage", "sandbox":
		item.State = "unknown"
		item.Reason = "evidence missing"
		if scenario == "sandbox" {
			item.Reason = "sandbox resource not observed"
		}
	default:
		item.State = "recorded"
	}
	saved, err := saveLifecycleCheck(item)
	if err != nil {
		return lifecycleCheck{}, err
	}
	_ = saveLifecycleAudit(projectID, scenario+"-"+subject, actor.UserID, "lifecycle check saved")
	return saved, nil
}

func replayLifecycle(current lifecycleCheck, revision int) (lifecycleCheck, error) {
	current.Applied = false
	if current.Scenario == "out_of_order" && revision < current.Revision {
		current.Reason = "older revision retained"
		return current, nil
	}
	if current.Scenario == "duplicate" || current.Scenario == "replay" || current.Scenario == "sandbox" {
		current.Reason = "duplicate retained"
		return current, nil
	}
	if current.Attempts >= lifecycleMaxAttempts {
		current.Reason = "retry bound reached"
		return current, nil
	}
	current.Attempts++
	if current.Scenario == "worker_crash" {
		current.State = "recoverable"
		current.Reason = "failure retained"
	}
	if current.Scenario == "provider_outage" {
		current.State = "unknown"
		current.Reason = "evidence missing"
	}
	if current.Scenario == "out_of_order" && revision > current.Revision {
		current.Revision = revision
		current.Reason = "newer revision retained"
	}
	return updateLifecycleCheck(current)
}

func readLifecycleChecks(actor authzSubject, projectID int, environment string) ([]lifecycleCheck, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := lifecycleAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listLifecycleChecks(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []lifecycleCheck{}
	}
	return items, nil
}

func lifecycleAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errLifecycleInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errLifecycleHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errLifecycleDenied
	}
	return nil
}

func lifecycleScenario(scenario string) bool {
	switch scenario {
	case "duplicate", "out_of_order", "replay", "invalid_signature", "cross_scope", "worker_crash", "provider_outage", "sandbox":
		return true
	default:
		return false
	}
}

func migrateLifecycleSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_lifecycle_checks (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			scenario_name TEXT NOT NULL,
			subject_key TEXT NOT NULL,
			revision INTEGER NOT NULL,
			attempts INTEGER NOT NULL,
			effect_count INTEGER NOT NULL,
			state TEXT NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, environment, scenario_name, subject_key)
		)
	`)
}

func findLifecycleCheckFromDB(projectID int, environment, scenario, subject string) (lifecycleCheck, error) {
	if DB == nil {
		return lifecycleCheck{}, errInboxStored
	}
	var item lifecycleCheck
	err := DB.QueryRow(`
		SELECT id, project_id, environment, scenario_name, subject_key, revision, attempts, effect_count, state, reason
		FROM webhook_lifecycle_checks WHERE project_id = $1 AND environment = $2 AND scenario_name = $3 AND subject_key = $4
	`, projectID, environment, scenario, subject).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scenario, &item.Subject, &item.Revision, &item.Attempts, &item.Effect, &item.State, &item.Reason)
	if err != nil {
		return lifecycleCheck{}, nil
	}
	return item, nil
}

func saveLifecycleCheckToDB(item lifecycleCheck) (lifecycleCheck, error) {
	if DB == nil {
		return lifecycleCheck{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO webhook_lifecycle_checks (project_id, environment, scenario_name, subject_key, revision, attempts, effect_count, state, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, item.ProjectID, item.Environment, item.Scenario, item.Subject, item.Revision, item.Attempts, item.Effect, item.State, item.Reason).Scan(&item.ID)
	return item, err
}

func updateLifecycleCheckToDB(item lifecycleCheck) (lifecycleCheck, error) {
	if DB == nil {
		return lifecycleCheck{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE webhook_lifecycle_checks SET revision = $2, attempts = $3, state = $4, reason = $5 WHERE id = $1`, item.ID, item.Revision, item.Attempts, item.State, item.Reason)
	return item, err
}

func listLifecycleChecksFromDB(projectID int, environment string) ([]lifecycleCheck, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`
		SELECT id, project_id, environment, scenario_name, subject_key, revision, attempts, effect_count, state, reason
		FROM webhook_lifecycle_checks WHERE project_id = $1 AND environment = $2 ORDER BY id
	`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []lifecycleCheck
	for rows.Next() {
		var item lifecycleCheck
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scenario, &item.Subject, &item.Revision, &item.Attempts, &item.Effect, &item.State, &item.Reason); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveLifecycleAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "webhook_lifecycle",
		ResourceID: resourceID, Action: "webhook_lifecycle", Result: "success", Summary: summary,
	})
	return nil
}

func lifecycleCheckHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeLifecycleError(w, errLifecycleHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeLifecycleError(w, errLifecycleInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readLifecycleChecks(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeLifecycleError(w, err)
			return
		}
		writeLifecycleJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeLifecycleError(w, errLifecycleInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Scenario    string `json:"scenario"`
		Subject     string `json:"subject"`
		Revision    int    `json:"revision"`
		Detail      string `json:"detail"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeLifecycleError(w, errLifecycleInvalid)
		return
	}
	item, err := recordLifecycleCheck(actor, body.ProjectID, body.Environment, body.Scenario, body.Subject, body.Revision, body.Detail)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeLifecycleJSON(w, item)
}

func writeLifecycleJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeLifecycleError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errLifecycleHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errLifecycleDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "lifecycle request failed"})
}
