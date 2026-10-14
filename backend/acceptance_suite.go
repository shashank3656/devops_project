package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const acceptanceMaxAttempts = 3

var (
	errAcceptanceHidden  = errors.New("acceptance hidden")
	errAcceptanceDenied  = errors.New("acceptance denied")
	errAcceptanceInvalid = errors.New("acceptance invalid")
)

type acceptanceCase struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Scenario    string `json:"scenario"`
	Subject     string `json:"subject"`
	Revision    int    `json:"revision"`
	Partial     bool   `json:"partial"`
	FindingOpen bool   `json:"finding_open"`
	State       string `json:"state"`
	Attempts    int    `json:"attempts"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

type acceptanceRisk struct {
	ID          int    `json:"id"`
	CaseID      int    `json:"case_id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Summary     string `json:"summary"`
	State       string `json:"state"`
	ReviewerID  int    `json:"reviewer_id"`
}

type acceptanceAudit struct {
	ProjectID   int
	ResourceID  string
	ActorUserID int
	Summary     string
}

var (
	findAcceptanceCase    = findAcceptanceCaseFromDB
	saveAcceptanceCase    = saveAcceptanceCaseToDB
	updateAcceptanceCase  = updateAcceptanceCaseToDB
	listAcceptanceCases   = listAcceptanceCasesFromDB
	loadAcceptanceCase    = loadAcceptanceCaseFromDB
	saveAcceptanceRiskRow = saveAcceptanceRiskToDB
	loadAcceptanceRiskRow = loadAcceptanceRiskFromDB
	updateAcceptanceRisk  = updateAcceptanceRiskToDB
	saveAcceptanceAudit   = saveAcceptanceAuditToDB
)

func recordAcceptanceCase(actor authzSubject, projectID int, environment, scenario, subject string, revision int, partial bool, detail string) (acceptanceCase, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	scenario = strings.ToLower(strings.TrimSpace(scenario))
	subject = strings.TrimSpace(subject)
	if err := acceptanceAccess(actor, projectID, environment, true); err != nil || !acceptanceScenario(scenario) || acceptanceSensitive(detail) || revision < 0 {
		if err == nil {
			err = errAcceptanceInvalid
		}
		return acceptanceCase{}, err
	}
	if scenario == "parser_abuse" || !incidentToken(subject) {
		return acceptanceCase{}, errAcceptanceInvalid
	}
	current, err := findAcceptanceCase(projectID, environment, scenario, subject)
	if err != nil {
		return acceptanceCase{}, err
	}
	if current.ID > 0 {
		return replayAcceptance(current, revision, partial)
	}
	item := acceptanceCase{
		ProjectID: projectID, Environment: environment, Scenario: scenario, Subject: subject,
		Revision: revision, Partial: partial, FindingOpen: true, Attempts: 1, Applied: true,
	}
	switch scenario {
	case "worker_crash", "cloud_throttle":
		item.State = "recoverable"
		item.Reason = "failure retained"
	case "credential_expiry":
		item.State = "unknown"
		item.Reason = "credential evidence missing"
	default:
		item.State = "recorded"
	}
	saved, err := saveAcceptanceCase(item)
	if err != nil {
		return acceptanceCase{}, err
	}
	_ = saveAcceptanceAudit(acceptanceAudit{ProjectID: projectID, ResourceID: scenario + "-" + subject, ActorUserID: actor.UserID, Summary: "acceptance case saved"})
	return saved, nil
}

func replayAcceptance(current acceptanceCase, revision int, partial bool) (acceptanceCase, error) {
	current.Applied = false
	if current.Scenario == "out_of_order" && revision < current.Revision {
		current.Reason = "older revision retained"
		return current, nil
	}
	if current.Scenario == "webhook_replay" {
		current.Reason = "duplicate replay"
		return current, nil
	}
	if current.State == "recoverable" && current.Attempts >= acceptanceMaxAttempts {
		current.Reason = "retry bound reached"
		return current, nil
	}
	if current.Scenario == "worker_crash" || current.Scenario == "cloud_throttle" {
		current.Attempts++
		current.State = "recoverable"
		current.FindingOpen = true
		current.Reason = "failure retained"
		return updateAcceptanceCase(current)
	}
	if revision > current.Revision {
		current.Revision = revision
		current.Partial = partial
		current.FindingOpen = true
		current.Reason = "newer revision retained"
		return updateAcceptanceCase(current)
	}
	current.Reason = "duplicate replay"
	return current, nil
}

func readAcceptanceCases(actor authzSubject, projectID int, environment string) ([]acceptanceCase, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := acceptanceAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listAcceptanceCases(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []acceptanceCase{}
	}
	return items, nil
}

func closeAcceptanceFinding(actor authzSubject, caseID int) (acceptanceCase, error) {
	item, err := loadAcceptanceCase(caseID)
	if err != nil || item.ID == 0 {
		return acceptanceCase{}, errAcceptanceHidden
	}
	if err := acceptanceAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return acceptanceCase{}, err
	}
	if item.Partial || item.State != "recorded" || !item.FindingOpen {
		return acceptanceCase{}, errAcceptanceInvalid
	}
	item.FindingOpen = false
	item.Applied = true
	item.Reason = "finding closed"
	return updateAcceptanceCase(item)
}

func saveAcceptanceRisk(actor authzSubject, caseID int, summary string) (acceptanceRisk, error) {
	item, err := loadAcceptanceCase(caseID)
	if err != nil || item.ID == 0 {
		return acceptanceRisk{}, errAcceptanceHidden
	}
	if err := acceptanceAccess(actor, item.ProjectID, item.Environment, true); err != nil || acceptanceSensitive(summary) || strings.TrimSpace(summary) == "" || len(summary) > 500 {
		if err == nil {
			err = errAcceptanceInvalid
		}
		return acceptanceRisk{}, err
	}
	risk := acceptanceRisk{CaseID: item.ID, ProjectID: item.ProjectID, Environment: item.Environment, Summary: strings.TrimSpace(summary), State: "open"}
	saved, err := saveAcceptanceRiskRow(risk)
	if err != nil {
		return acceptanceRisk{}, err
	}
	_ = saveAcceptanceAudit(acceptanceAudit{ProjectID: item.ProjectID, ResourceID: "risk-" + item.Subject, ActorUserID: actor.UserID, Summary: "residual risk saved"})
	return saved, nil
}

func acceptAcceptanceRisk(actor authzSubject, riskID, reviewerID int) (acceptanceRisk, error) {
	risk, err := loadAcceptanceRiskRow(riskID)
	if err != nil || risk.ID == 0 {
		return acceptanceRisk{}, errAcceptanceHidden
	}
	if err := acceptanceAccess(actor, risk.ProjectID, risk.Environment, true); err != nil {
		return acceptanceRisk{}, err
	}
	if reviewerID <= 0 || reviewerID == actor.UserID || risk.State != "open" {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	risk.State = "accepted"
	risk.ReviewerID = reviewerID
	return updateAcceptanceRisk(risk)
}

func acceptanceAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errAcceptanceHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errAcceptanceDenied
	}
	return nil
}

func acceptanceScenario(scenario string) bool {
	switch scenario {
	case "cross_project", "webhook_replay", "parser_abuse", "worker_crash", "cloud_throttle", "credential_expiry", "out_of_order":
		return true
	default:
		return false
	}
}

func acceptanceSensitive(detail string) bool {
	lower := strings.ToLower(detail)
	return strings.TrimSpace(detail) != "" && (strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") || strings.EqualFold(detail, "healthy"))
}

func migrateAcceptanceSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS acceptance_cases (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			scenario_name TEXT NOT NULL,
			subject_key TEXT NOT NULL,
			revision INTEGER NOT NULL,
			partial BOOLEAN NOT NULL,
			finding_open BOOLEAN NOT NULL,
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, environment, scenario_name, subject_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS acceptance_risks (
			id SERIAL PRIMARY KEY,
			case_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			summary TEXT NOT NULL,
			state TEXT NOT NULL,
			reviewer_id INTEGER NOT NULL DEFAULT 0
		)
	`)
}

func findAcceptanceCaseFromDB(projectID int, environment, scenario, subject string) (acceptanceCase, error) {
	if DB == nil {
		return acceptanceCase{}, errInboxStored
	}
	var item acceptanceCase
	err := DB.QueryRow(`
		SELECT id, project_id, environment, scenario_name, subject_key, revision, partial, finding_open, state, attempts, reason
		FROM acceptance_cases WHERE project_id = $1 AND environment = $2 AND scenario_name = $3 AND subject_key = $4
	`, projectID, environment, scenario, subject).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scenario, &item.Subject, &item.Revision, &item.Partial, &item.FindingOpen, &item.State, &item.Attempts, &item.Reason)
	if err != nil {
		return acceptanceCase{}, nil
	}
	return item, nil
}

func saveAcceptanceCaseToDB(item acceptanceCase) (acceptanceCase, error) {
	if DB == nil {
		return acceptanceCase{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO acceptance_cases (project_id, environment, scenario_name, subject_key, revision, partial, finding_open, state, attempts, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
	`, item.ProjectID, item.Environment, item.Scenario, item.Subject, item.Revision, item.Partial, item.FindingOpen, item.State, item.Attempts, item.Reason).Scan(&item.ID)
	return item, err
}

func updateAcceptanceCaseToDB(item acceptanceCase) (acceptanceCase, error) {
	if DB == nil {
		return acceptanceCase{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE acceptance_cases SET revision = $2, partial = $3, finding_open = $4, state = $5, attempts = $6, reason = $7 WHERE id = $1
	`, item.ID, item.Revision, item.Partial, item.FindingOpen, item.State, item.Attempts, item.Reason)
	return item, err
}

func listAcceptanceCasesFromDB(projectID int, environment string) ([]acceptanceCase, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`
		SELECT id, project_id, environment, scenario_name, subject_key, revision, partial, finding_open, state, attempts, reason
		FROM acceptance_cases WHERE project_id = $1 AND environment = $2 ORDER BY id
	`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []acceptanceCase
	for rows.Next() {
		var item acceptanceCase
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scenario, &item.Subject, &item.Revision, &item.Partial, &item.FindingOpen, &item.State, &item.Attempts, &item.Reason); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadAcceptanceCaseFromDB(id int) (acceptanceCase, error) {
	if DB == nil {
		return acceptanceCase{}, errInboxStored
	}
	var item acceptanceCase
	err := DB.QueryRow(`
		SELECT id, project_id, environment, scenario_name, subject_key, revision, partial, finding_open, state, attempts, reason
		FROM acceptance_cases WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scenario, &item.Subject, &item.Revision, &item.Partial, &item.FindingOpen, &item.State, &item.Attempts, &item.Reason)
	if err != nil {
		return acceptanceCase{}, nil
	}
	return item, nil
}

func saveAcceptanceRiskToDB(item acceptanceRisk) (acceptanceRisk, error) {
	if DB == nil {
		return acceptanceRisk{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO acceptance_risks (case_id, project_id, environment, summary, state, reviewer_id)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.CaseID, item.ProjectID, item.Environment, item.Summary, item.State, item.ReviewerID).Scan(&item.ID)
	return item, err
}

func loadAcceptanceRiskFromDB(id int) (acceptanceRisk, error) {
	if DB == nil {
		return acceptanceRisk{}, errInboxStored
	}
	var item acceptanceRisk
	err := DB.QueryRow(`
		SELECT id, case_id, project_id, environment, summary, state, reviewer_id FROM acceptance_risks WHERE id = $1
	`, id).Scan(&item.ID, &item.CaseID, &item.ProjectID, &item.Environment, &item.Summary, &item.State, &item.ReviewerID)
	if err != nil {
		return acceptanceRisk{}, nil
	}
	return item, nil
}

func updateAcceptanceRiskToDB(item acceptanceRisk) (acceptanceRisk, error) {
	if DB == nil {
		return acceptanceRisk{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE acceptance_risks SET state = $2, reviewer_id = $3 WHERE id = $1`, item.ID, item.State, item.ReviewerID)
	return item, err
}

func saveAcceptanceAuditToDB(item acceptanceAudit) error {
	if DB == nil {
		return nil
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "acceptance_case",
		ResourceID: item.ResourceID, Action: "acceptance_case", Result: "success", Summary: item.Summary,
	})
	return nil
}

func acceptanceCaseHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAcceptanceError(w, errAcceptanceHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeAcceptanceError(w, errAcceptanceInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readAcceptanceCases(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeAcceptanceError(w, err)
			return
		}
		writeAcceptanceJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Scenario    string `json:"scenario"`
		Subject     string `json:"subject"`
		Revision    int    `json:"revision"`
		Partial     bool   `json:"partial"`
		Detail      string `json:"detail"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	item, err := recordAcceptanceCase(actor, body.ProjectID, body.Environment, body.Scenario, body.Subject, body.Revision, body.Partial, body.Detail)
	if err != nil {
		writeAcceptanceError(w, err)
		return
	}
	writeAcceptanceJSON(w, item)
}

func acceptanceCloseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAcceptanceError(w, errAcceptanceHidden)
		return
	}
	var body struct {
		CaseID int `json:"case_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	item, err := closeAcceptanceFinding(actor, body.CaseID)
	if err != nil {
		writeAcceptanceError(w, err)
		return
	}
	writeAcceptanceJSON(w, item)
}

func acceptanceRiskHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAcceptanceError(w, errAcceptanceHidden)
		return
	}
	var body struct {
		CaseID  int    `json:"case_id"`
		Summary string `json:"summary"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	item, err := saveAcceptanceRisk(actor, body.CaseID, body.Summary)
	if err != nil {
		writeAcceptanceError(w, err)
		return
	}
	writeAcceptanceJSON(w, item)
}

func acceptanceRiskAcceptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAcceptanceError(w, errAcceptanceHidden)
		return
	}
	var body struct {
		RiskID     int `json:"risk_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeAcceptanceError(w, errAcceptanceInvalid)
		return
	}
	item, err := acceptAcceptanceRisk(actor, body.RiskID, body.ReviewerID)
	if err != nil {
		writeAcceptanceError(w, err)
		return
	}
	writeAcceptanceJSON(w, item)
}

func writeAcceptanceJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeAcceptanceError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errAcceptanceHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errAcceptanceDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "acceptance request failed"})
}
