package main

import (
	"errors"
	"strings"
)

var (
	errAcceptanceInvalid = errors.New("acceptance case is invalid")
	errAcceptanceDenied  = errors.New("acceptance case is denied")
)

type acceptanceCase struct {
	ID          int
	ProjectID   int
	Environment string
	Scenario    string
	Subject     string
	Revision    int
	Partial     bool
	FindingOpen bool
	Applied     bool
	State       string
	Attempts    int
	Reason      string
}

type acceptanceRisk struct {
	ID         int
	CaseID     int
	Note       string
	State      string
	ReviewerID int
}

type acceptanceAudit struct {
	ProjectID   int
	CaseID      int
	ActorUserID int
	Summary     string
}

var (
	findAcceptanceCase    = findAcceptanceCaseUnavailable
	saveAcceptanceCase    = saveAcceptanceCaseUnavailable
	updateAcceptanceCase  = updateAcceptanceCaseUnavailable
	listAcceptanceCases   = listAcceptanceCasesUnavailable
	loadAcceptanceCase    = loadAcceptanceCaseUnavailable
	saveAcceptanceRiskRow = saveAcceptanceRiskRowUnavailable
	loadAcceptanceRiskRow = loadAcceptanceRiskRowUnavailable
	updateAcceptanceRisk  = updateAcceptanceRiskUnavailable
	saveAcceptanceAudit   = saveAcceptanceAuditUnavailable
)

func recordAcceptanceCase(actor authzSubject, projectID int, environment, scenario, subject string, revision int, partial bool, note string) (acceptanceCase, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	scenario = strings.ToLower(strings.TrimSpace(scenario))
	subject = strings.TrimSpace(subject)
	state, known := acceptanceScenario(scenario)
	if !singleEnvironment(environment) || !known || !acceptanceSubject(subject) || acceptanceNoteHasSecret(note) {
		return acceptanceCase{}, errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return acceptanceCase{}, errAcceptanceDenied
	}
	existing, err := findAcceptanceCase(projectID, environment, scenario, subject)
	if err != nil {
		return acceptanceCase{}, err
	}
	if existing.ID > 0 && scenario == "webhook_replay" {
		replay := existing
		replay.Applied = false
		replay.Attempts = 1
		replay.Reason = "duplicate replay"
		return replay, nil
	}
	if existing.ID > 0 && scenario == "out_of_order" && revision < existing.Revision {
		kept := existing
		kept.Applied = false
		kept.Reason = "older revision retained"
		return kept, nil
	}
	if existing.ID > 0 && scenario == "cloud_throttle" {
		if existing.Attempts >= 3 {
			bound := existing
			bound.Applied = false
			bound.Reason = "retry bound reached"
			return bound, nil
		}
		existing.Attempts++
		existing.Applied = true
		existing.Reason = ""
		return updateAcceptanceCase(existing)
	}
	item := acceptanceCase{
		ProjectID:   projectID,
		Environment: environment,
		Scenario:    scenario,
		Subject:     subject,
		Revision:    revision,
		Partial:     partial,
		FindingOpen: true,
		Applied:     true,
		State:       state,
		Attempts:    1,
	}
	return saveAcceptanceCase(item)
}

func readAcceptanceCases(actor authzSubject, projectID int, environment string) ([]acceptanceCase, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if !singleEnvironment(environment) {
		return nil, errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return nil, errAcceptanceDenied
	}
	return listAcceptanceCases(projectID, environment)
}

func closeAcceptanceFinding(actor authzSubject, caseID int) (acceptanceCase, error) {
	item, err := loadAcceptanceCase(caseID)
	if err != nil || item.ID == 0 {
		return acceptanceCase{}, errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, item.ProjectID, []string{item.Environment}, authzWrite) {
		return acceptanceCase{}, errAcceptanceDenied
	}
	if item.Partial || item.State != "recorded" || !item.FindingOpen {
		return acceptanceCase{}, errAcceptanceInvalid
	}
	item.FindingOpen = false
	return updateAcceptanceCase(item)
}

func saveAcceptanceRisk(actor authzSubject, caseID int, note string) (acceptanceRisk, error) {
	item, err := loadAcceptanceCase(caseID)
	if err != nil || item.ID == 0 {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	if acceptanceNoteHasSecret(note) || strings.TrimSpace(note) == "" {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, item.ProjectID, []string{item.Environment}, authzWrite) {
		return acceptanceRisk{}, errAcceptanceDenied
	}
	return saveAcceptanceRiskRow(acceptanceRisk{CaseID: caseID, Note: strings.TrimSpace(note), State: "open"})
}

func acceptAcceptanceRisk(actor authzSubject, riskID, reviewerID int) (acceptanceRisk, error) {
	if reviewerID <= 0 || reviewerID == actor.UserID {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	item, err := loadAcceptanceRiskRow(riskID)
	if err != nil || item.ID == 0 || item.State != "open" {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	parent, err := loadAcceptanceCase(item.CaseID)
	if err != nil || parent.ID == 0 {
		return acceptanceRisk{}, errAcceptanceInvalid
	}
	if !catalogEnvironmentsAllowed(actor, parent.ProjectID, []string{parent.Environment}, authzWrite) {
		return acceptanceRisk{}, errAcceptanceDenied
	}
	item.State = "accepted"
	item.ReviewerID = reviewerID
	return updateAcceptanceRisk(item)
}

func acceptanceScenario(scenario string) (string, bool) {
	switch scenario {
	case "webhook_replay", "cross_project", "out_of_order":
		return "recorded", true
	case "worker_crash", "cloud_throttle":
		return "recoverable", true
	case "credential_expiry":
		return "unknown", true
	default:
		return "", false
	}
}

func acceptanceSubject(subject string) bool {
	if subject == "" || len(subject) > 128 || strings.ContainsAny(subject, " \n\t,") {
		return false
	}
	return true
}

func acceptanceNoteHasSecret(note string) bool {
	lower := strings.ToLower(note)
	return strings.Contains(lower, "password=") || strings.Contains(lower, "secret=")
}

func findAcceptanceCaseUnavailable(int, string, string, string) (acceptanceCase, error) {
	return acceptanceCase{}, errAcceptanceInvalid
}

func saveAcceptanceCaseUnavailable(acceptanceCase) (acceptanceCase, error) {
	return acceptanceCase{}, errAcceptanceInvalid
}

func updateAcceptanceCaseUnavailable(acceptanceCase) (acceptanceCase, error) {
	return acceptanceCase{}, errAcceptanceInvalid
}

func listAcceptanceCasesUnavailable(int, string) ([]acceptanceCase, error) {
	return nil, errAcceptanceInvalid
}

func loadAcceptanceCaseUnavailable(int) (acceptanceCase, error) {
	return acceptanceCase{}, errAcceptanceInvalid
}

func saveAcceptanceRiskRowUnavailable(acceptanceRisk) (acceptanceRisk, error) {
	return acceptanceRisk{}, errAcceptanceInvalid
}

func loadAcceptanceRiskRowUnavailable(int) (acceptanceRisk, error) {
	return acceptanceRisk{}, errAcceptanceInvalid
}

func updateAcceptanceRiskUnavailable(acceptanceRisk) (acceptanceRisk, error) {
	return acceptanceRisk{}, errAcceptanceInvalid
}

func saveAcceptanceAuditUnavailable(acceptanceAudit) error {
	return nil
}
