package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const (
	automationMaxAttempts = 3
	automationMaxDepth    = 1
)

var (
	errAutomationHidden  = errors.New("automation hidden")
	errAutomationDenied  = errors.New("automation denied")
	errAutomationInvalid = errors.New("automation invalid")
)

type automationRule struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Trigger     string `json:"trigger"`
	Action      string `json:"action"`
	Version     int    `json:"version"`
	Enabled     bool   `json:"enabled"`
}

type automationRun struct {
	ID           int    `json:"id"`
	RuleID       int    `json:"rule_id"`
	ProjectID    int    `json:"project_id"`
	Environment  string `json:"environment"`
	Trigger      string `json:"trigger"`
	Action       string `json:"action"`
	Version      int    `json:"version"`
	ExecutionKey string `json:"execution_key"`
	SourceKind   string `json:"source_kind"`
	SourceID     string `json:"source_id"`
	State        string `json:"state"`
	Attempts     int    `json:"attempts"`
	Applied      bool   `json:"applied"`
	Reason       string `json:"reason"`
}

type automationAudit struct {
	ProjectID   int
	ResourceID  string
	ActorUserID int
	Summary     string
}

var (
	saveAutomationRule      = saveAutomationRuleToDB
	findAutomationVersion   = findAutomationVersionFromDB
	loadAutomationRule      = loadAutomationRuleFromDB
	latestAutomationRule    = latestAutomationRuleFromDB
	updateAutomationRule    = updateAutomationRuleToDB
	findAutomationRun       = findAutomationRunFromDB
	saveAutomationRun       = saveAutomationRunToDB
	updateAutomationRun     = updateAutomationRunToDB
	saveAutomationAttempt   = saveAutomationAttemptToDB
	countAutomationAttempts = countAutomationAttemptsFromDB
	saveAutomationAudit     = saveAutomationAuditToDB
)

func saveAutomation(actor authzSubject, projectID int, environment, trigger, action string) (automationRule, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	trigger = strings.ToLower(strings.TrimSpace(trigger))
	action = strings.ToLower(strings.TrimSpace(action))
	if projectID <= 0 || !singleEnvironment(environment) || !automationPair(trigger, action) {
		return automationRule{}, errAutomationInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return automationRule{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return automationRule{}, errAutomationDenied
	}
	version, err := findAutomationVersion(projectID, environment, trigger, action)
	if err != nil {
		return automationRule{}, err
	}
	item, err := saveAutomationRule(automationRule{
		ProjectID: projectID, Environment: environment, Trigger: trigger, Action: action,
		Version: version + 1, Enabled: true,
	})
	if err != nil {
		return automationRule{}, err
	}
	_ = saveAutomationAudit(automationAudit{ProjectID: projectID, ResourceID: automationRuleKey(item), ActorUserID: actor.UserID, Summary: "automation rule recorded"})
	return item, nil
}

func disableAutomation(actor authzSubject, ruleID int) (automationRule, error) {
	item, err := loadAutomationRule(ruleID)
	if err != nil || item.ID == 0 {
		return automationRule{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, item.ProjectID, []string{item.Environment}, authzRead) {
		return automationRule{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, item.ProjectID, []string{item.Environment}, authzWrite) {
		return automationRule{}, errAutomationDenied
	}
	if !item.Enabled {
		return item, nil
	}
	item.Enabled = false
	item, err = updateAutomationRule(item)
	if err != nil {
		return automationRule{}, err
	}
	_ = saveAutomationAudit(automationAudit{ProjectID: item.ProjectID, ResourceID: automationRuleKey(item), ActorUserID: actor.UserID, Summary: "automation rule disabled"})
	return item, nil
}

func executeAutomation(actor authzSubject, projectID int, environment, trigger, sourceKind, sourceID, result string, depth int) (automationRun, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	trigger = strings.ToLower(strings.TrimSpace(trigger))
	sourceKind = strings.ToLower(strings.TrimSpace(sourceKind))
	result = strings.ToLower(strings.TrimSpace(result))
	if projectID <= 0 || !singleEnvironment(environment) || !automationTrigger(trigger) || !automationSource(sourceKind, sourceID) || !automationResult(result) || depth > automationMaxDepth {
		return automationRun{}, errAutomationInvalid
	}
	if sourceKind == "automation" || sourceKind == "rule" {
		return automationRun{}, errAutomationInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return automationRun{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return automationRun{}, errAutomationDenied
	}
	rule, err := latestAutomationRule(projectID, environment, trigger)
	if err != nil {
		return automationRun{}, err
	}
	if rule.ID == 0 || !rule.Enabled {
		return automationRun{}, errAutomationInvalid
	}
	key := automationExecutionKey(rule, sourceKind, sourceID)
	existing, err := findAutomationRun(projectID, environment, key)
	if err != nil {
		return automationRun{}, err
	}
	if existing.ID > 0 {
		existing.Applied = false
		existing.Reason = "duplicate execution"
		return existing, nil
	}
	run, err := saveAutomationRun(automationRun{
		RuleID: rule.ID, ProjectID: projectID, Environment: environment, Trigger: rule.Trigger, Action: rule.Action,
		Version: rule.Version, ExecutionKey: key, SourceKind: sourceKind, SourceID: sourceID, State: result, Attempts: 1, Applied: true,
		Reason: "notification recorded",
	})
	if err != nil {
		return automationRun{}, err
	}
	if err := saveAutomationAttempt(run.ID, 1, result); err != nil {
		return automationRun{}, err
	}
	_ = saveAutomationAudit(automationAudit{ProjectID: projectID, ResourceID: sourceID, ActorUserID: actor.UserID, Summary: "automation run recorded"})
	return run, nil
}

func retryAutomation(actor authzSubject, runID int, result string) (automationRun, error) {
	result = strings.ToLower(strings.TrimSpace(result))
	if !automationResult(result) {
		return automationRun{}, errAutomationInvalid
	}
	run, err := loadAutomationRun(runID)
	if err != nil || run.ID == 0 {
		return automationRun{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, run.ProjectID, []string{run.Environment}, authzRead) {
		return automationRun{}, errAutomationHidden
	}
	if !catalogEnvironmentsAllowed(actor, run.ProjectID, []string{run.Environment}, authzWrite) {
		return automationRun{}, errAutomationDenied
	}
	rule, err := loadAutomationRule(run.RuleID)
	if err != nil || rule.ID == 0 || !rule.Enabled {
		return automationRun{}, errAutomationInvalid
	}
	attempts, err := countAutomationAttempts(run.ID)
	if err != nil {
		return automationRun{}, err
	}
	run.Attempts = attempts
	if run.State == "delivered" || attempts >= automationMaxAttempts {
		run.Applied = false
		run.Reason = "retry bound reached"
		return run, nil
	}
	next := attempts + 1
	if err := saveAutomationAttempt(run.ID, next, result); err != nil {
		return automationRun{}, err
	}
	run.Attempts = next
	run.State = result
	run.Applied = true
	run.Reason = "notification retried"
	run, err = updateAutomationRun(run)
	if err != nil {
		return automationRun{}, err
	}
	_ = saveAutomationAudit(automationAudit{ProjectID: run.ProjectID, ResourceID: run.SourceID, ActorUserID: actor.UserID, Summary: "automation retry recorded"})
	return run, nil
}

func automationPair(trigger, action string) bool {
	return automationTrigger(trigger) && action == "notify"
}

func automationTrigger(trigger string) bool {
	switch trigger {
	case "assignment", "overdue", "expiry", "scan_health":
		return true
	default:
		return false
	}
}

func automationSource(kind, id string) bool {
	switch kind {
	case "finding", "incident", "exception", "scan":
		return incidentToken(id)
	default:
		return false
	}
}

func automationResult(result string) bool {
	return result == "delivered" || result == "failed"
}

func automationExecutionKey(rule automationRule, sourceKind, sourceID string) string {
	return rule.Trigger + ":" + sourceKind + ":" + sourceID + ":v" + strconv.Itoa(rule.Version)
}

func automationRuleKey(item automationRule) string {
	return item.Trigger + "-v" + strconv.Itoa(item.Version)
}

func migrateAutomationSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS automation_rules (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			trigger_name VARCHAR(32) NOT NULL,
			action_name VARCHAR(32) NOT NULL,
			version INTEGER NOT NULL,
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			UNIQUE (project_id, environment, trigger_name, action_name, version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS automation_runs (
			id SERIAL PRIMARY KEY,
			rule_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			trigger_name VARCHAR(32) NOT NULL,
			action_name VARCHAR(32) NOT NULL,
			version INTEGER NOT NULL,
			execution_key VARCHAR(256) NOT NULL,
			source_kind VARCHAR(32) NOT NULL,
			source_id VARCHAR(128) NOT NULL,
			state VARCHAR(32) NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 1,
			UNIQUE (project_id, environment, execution_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS automation_notifications (
			id SERIAL PRIMARY KEY,
			run_id INTEGER NOT NULL,
			attempt INTEGER NOT NULL,
			state VARCHAR(32) NOT NULL,
			UNIQUE (run_id, attempt)
		)
	`)
}

func saveAutomationRuleToDB(item automationRule) (automationRule, error) {
	if DB == nil {
		return automationRule{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO automation_rules (project_id, environment, trigger_name, action_name, version, enabled)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.ProjectID, item.Environment, item.Trigger, item.Action, item.Version, item.Enabled).Scan(&item.ID)
	return item, err
}

func findAutomationVersionFromDB(projectID int, environment, trigger, action string) (int, error) {
	if DB == nil {
		return 0, errInboxStored
	}
	var version int
	err := DB.QueryRow(`
		SELECT COALESCE(MAX(version), 0) FROM automation_rules
		WHERE project_id = $1 AND environment = $2 AND trigger_name = $3 AND action_name = $4
	`, projectID, environment, trigger, action).Scan(&version)
	return version, err
}

func loadAutomationRuleFromDB(id int) (automationRule, error) {
	if DB == nil || id <= 0 {
		return automationRule{}, errAutomationHidden
	}
	var item automationRule
	err := DB.QueryRow(`
		SELECT id, project_id, environment, trigger_name, action_name, version, enabled
		FROM automation_rules WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Trigger, &item.Action, &item.Version, &item.Enabled)
	if err != nil {
		return automationRule{}, errAutomationHidden
	}
	return item, nil
}

func latestAutomationRuleFromDB(projectID int, environment, trigger string) (automationRule, error) {
	if DB == nil {
		return automationRule{}, errInboxStored
	}
	var item automationRule
	err := DB.QueryRow(`
		SELECT id, project_id, environment, trigger_name, action_name, version, enabled
		FROM automation_rules
		WHERE project_id = $1 AND environment = $2 AND trigger_name = $3 AND enabled = TRUE
		ORDER BY version DESC LIMIT 1
	`, projectID, environment, trigger).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Trigger, &item.Action, &item.Version, &item.Enabled)
	if err != nil {
		return automationRule{}, nil
	}
	return item, nil
}

func updateAutomationRuleToDB(item automationRule) (automationRule, error) {
	if DB == nil {
		return automationRule{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE automation_rules SET enabled = $2 WHERE id = $1`, item.ID, item.Enabled)
	return item, err
}

func findAutomationRunFromDB(projectID int, environment, key string) (automationRun, error) {
	if DB == nil {
		return automationRun{}, errInboxStored
	}
	var item automationRun
	err := DB.QueryRow(`
		SELECT id, rule_id, project_id, environment, trigger_name, action_name, version, execution_key, source_kind, source_id, state, attempts
		FROM automation_runs WHERE project_id = $1 AND environment = $2 AND execution_key = $3
	`, projectID, environment, key).Scan(&item.ID, &item.RuleID, &item.ProjectID, &item.Environment, &item.Trigger, &item.Action, &item.Version, &item.ExecutionKey, &item.SourceKind, &item.SourceID, &item.State, &item.Attempts)
	if err != nil {
		return automationRun{}, nil
	}
	return item, nil
}

func loadAutomationRun(id int) (automationRun, error) {
	return loadAutomationRunByID(id)
}

var loadAutomationRunByID = loadAutomationRunFromDB

func loadAutomationRunFromDB(id int) (automationRun, error) {
	if DB == nil || id <= 0 {
		return automationRun{}, errAutomationHidden
	}
	var item automationRun
	err := DB.QueryRow(`
		SELECT id, rule_id, project_id, environment, trigger_name, action_name, version, execution_key, source_kind, source_id, state, attempts
		FROM automation_runs WHERE id = $1
	`, id).Scan(&item.ID, &item.RuleID, &item.ProjectID, &item.Environment, &item.Trigger, &item.Action, &item.Version, &item.ExecutionKey, &item.SourceKind, &item.SourceID, &item.State, &item.Attempts)
	if err != nil {
		return automationRun{}, errAutomationHidden
	}
	return item, nil
}

func saveAutomationRunToDB(item automationRun) (automationRun, error) {
	if DB == nil {
		return automationRun{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO automation_runs (
			rule_id, project_id, environment, trigger_name, action_name, version, execution_key, source_kind, source_id, state, attempts
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
	`, item.RuleID, item.ProjectID, item.Environment, item.Trigger, item.Action, item.Version, item.ExecutionKey, item.SourceKind, item.SourceID, item.State, item.Attempts).Scan(&item.ID)
	return item, err
}

func updateAutomationRunToDB(item automationRun) (automationRun, error) {
	if DB == nil {
		return automationRun{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE automation_runs SET state = $2, attempts = $3 WHERE id = $1`, item.ID, item.State, item.Attempts)
	return item, err
}

func saveAutomationAttemptToDB(runID, attempt int, state string) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`INSERT INTO automation_notifications (run_id, attempt, state) VALUES ($1,$2,$3)`, runID, attempt, state)
	return err
}

func countAutomationAttemptsFromDB(runID int) (int, error) {
	if DB == nil {
		return 0, errInboxStored
	}
	var count int
	err := DB.QueryRow(`SELECT COUNT(*) FROM automation_notifications WHERE run_id = $1`, runID).Scan(&count)
	return count, err
}

func saveAutomationAuditToDB(item automationAudit) error {
	if DB == nil {
		return nil
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "automation_rule",
		ResourceID: item.ResourceID, Action: "automation_rule", Result: "success", Summary: item.Summary,
	})
	return nil
}

func automationRuleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAutomationError(w, errAutomationHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Trigger     string `json:"trigger"`
		Action      string `json:"action"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	item, err := saveAutomation(actor, body.ProjectID, body.Environment, body.Trigger, body.Action)
	if err != nil {
		writeAutomationError(w, err)
		return
	}
	writeAutomationJSON(w, item)
}

func automationDisableHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAutomationError(w, errAutomationHidden)
		return
	}
	var body struct {
		RuleID int `json:"rule_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	item, err := disableAutomation(actor, body.RuleID)
	if err != nil {
		writeAutomationError(w, err)
		return
	}
	writeAutomationJSON(w, item)
}

func automationRunHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAutomationError(w, errAutomationHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Trigger     string `json:"trigger"`
		SourceKind  string `json:"source_kind"`
		SourceID    string `json:"source_id"`
		Result      string `json:"result"`
		Depth       int    `json:"depth"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	item, err := executeAutomation(actor, body.ProjectID, body.Environment, body.Trigger, body.SourceKind, body.SourceID, body.Result, body.Depth)
	if err != nil {
		writeAutomationError(w, err)
		return
	}
	writeAutomationJSON(w, item)
}

func automationRetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAutomationError(w, errAutomationHidden)
		return
	}
	var body struct {
		RunID  int    `json:"run_id"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeAutomationError(w, errAutomationInvalid)
		return
	}
	item, err := retryAutomation(actor, body.RunID, body.Result)
	if err != nil {
		writeAutomationError(w, err)
		return
	}
	writeAutomationJSON(w, item)
}

func writeAutomationJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeAutomationError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errAutomationHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errAutomationDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "automation request failed"})
}
