package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

const (
	pinnedReportAdapter = "sarif-1"
	pinnedReportScanner = "semgrep"
	maxReportBytes      = 65536
	redactedReportValue = "[redacted]"
)

var (
	errReportHidden  = errors.New("security report not found")
	errReportDenied  = errors.New("security report is not permitted")
	errReportInvalid = errors.New("malformed report is rejected")
	reportSHAPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type securityReport struct {
	ID             int                     `json:"id"`
	ProjectID      int                     `json:"project_id"`
	OrganizationID int                     `json:"organization_id"`
	ConnectionID   int                     `json:"connection_id"`
	Repository     string                  `json:"repository"`
	Branch         string                  `json:"branch"`
	CommitSHA      string                  `json:"commit_sha"`
	AdapterVersion string                  `json:"adapter_version"`
	Scanner        string                  `json:"scanner"`
	State          string                  `json:"state"`
	Findings       []securityReportFinding `json:"findings"`
}

type securityReportFinding struct {
	ID       int    `json:"id"`
	ReportID int    `json:"report_id"`
	RuleID   string `json:"rule_id"`
	Path     string `json:"path"`
	Message  string `json:"message"`
}

type securityReportInput struct {
	ProjectID      int
	OrganizationID int
	ConnectionID   int
	Repository     string
	Branch         string
	CommitSHA      string
	AdapterVersion string
	Scanner        string
	Payload        string
	Findings       []securityReportFindingInput
}

type securityReportFindingInput struct {
	RuleID  string
	Path    string
	Message string
	Secret  string
}

var (
	saveSecurityReport    = saveSecurityReportToDB
	findSecurityReport    = findSecurityReportFromDB
	insertSecurityFinding = insertSecurityFindingToDB
	loadSecurityReport    = loadSecurityReportFromDB
)

func ingestSecurityReport(actor authzSubject, input securityReportInput) (securityReport, error) {
	if len(input.Payload) > maxReportBytes {
		return securityReport{}, errReportInvalid
	}
	connection, err := loadConnectionByID(input.ConnectionID)
	if err != nil || connection.ID <= 0 || connection.ProjectID <= 0 || connection.Disabled {
		if err != nil || connection.ID <= 0 || connection.ProjectID <= 0 {
			return securityReport{}, errReportHidden
		}
		return securityReport{}, errReportInvalid
	}
	if !mappingAllowed(actor, connection.ProjectID, authzRead) {
		return securityReport{}, errReportHidden
	}
	if !mappingAllowed(actor, connection.ProjectID, authzWrite) {
		return securityReport{}, errReportDenied
	}
	normalized, err := normalizeSecurityReport(input)
	if err != nil {
		return securityReport{}, err
	}
	existing, err := findSecurityReport(connection.ID, normalized.Repository, normalized.CommitSHA, normalized.AdapterVersion)
	if err != nil {
		return securityReport{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	saved, err := saveSecurityReport(securityReport{
		ProjectID: connection.ProjectID, OrganizationID: actor.OrganizationID, ConnectionID: connection.ID,
		Repository: normalized.Repository, Branch: normalized.Branch, CommitSHA: normalized.CommitSHA,
		AdapterVersion: normalized.AdapterVersion, Scanner: normalized.Scanner, State: "accepted",
	})
	if err != nil {
		return securityReport{}, err
	}
	for _, finding := range normalized.Findings {
		finding.ReportID = saved.ID
		stored, err := insertSecurityFinding(finding)
		if err != nil {
			return securityReport{}, err
		}
		saved.Findings = append(saved.Findings, stored)
	}
	return saved, nil
}

func normalizeSecurityReport(input securityReportInput) (securityReport, error) {
	report := securityReport{
		Repository: strings.TrimSpace(input.Repository),
		Branch:     strings.TrimSpace(input.Branch),
		CommitSHA:  strings.ToLower(strings.TrimSpace(input.CommitSHA)),
		Scanner:    strings.ToLower(strings.TrimSpace(input.Scanner)),
	}
	report.AdapterVersion = strings.TrimSpace(input.AdapterVersion)
	if report.AdapterVersion == "" {
		report.AdapterVersion = pinnedReportAdapter
	}
	if report.Repository == "" || strings.Contains(report.Repository, " ") || strings.Contains(report.Repository, "\n") || report.Branch == "" || strings.Contains(report.Branch, "\n") || !reportSHAPattern.MatchString(report.CommitSHA) {
		return securityReport{}, errReportInvalid
	}
	if report.AdapterVersion != pinnedReportAdapter || report.Scanner != pinnedReportScanner {
		return securityReport{}, errReportInvalid
	}
	for _, finding := range input.Findings {
		ruleID := strings.TrimSpace(finding.RuleID)
		path := strings.TrimSpace(finding.Path)
		if ruleID == "" || path == "" || strings.Contains(ruleID, "\n") {
			return securityReport{}, errReportInvalid
		}
		message := redactReportMessage(finding.Message, finding.Secret)
		if strings.TrimSpace(finding.Secret) != "" && strings.Contains(message, strings.TrimSpace(finding.Secret)) {
			return securityReport{}, errReportInvalid
		}
		report.Findings = append(report.Findings, securityReportFinding{RuleID: ruleID, Path: path, Message: message})
	}
	report.State = "accepted"
	return report, nil
}

func redactReportMessage(message, secret string) string {
	message = strings.TrimSpace(message)
	secret = strings.TrimSpace(secret)
	if secret != "" {
		message = strings.ReplaceAll(message, secret, redactedReportValue)
	}
	return message
}

func migrateSecurityReportSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_reports (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			organization_id INTEGER NOT NULL,
			connection_id INTEGER NOT NULL,
			repository VARCHAR(200) NOT NULL,
			branch VARCHAR(200) NOT NULL,
			commit_sha CHAR(40) NOT NULL,
			adapter_version VARCHAR(32) NOT NULL,
			scanner VARCHAR(64) NOT NULL,
			state VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (connection_id, repository, commit_sha, adapter_version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_report_findings (
			id SERIAL PRIMARY KEY,
			report_id INTEGER NOT NULL,
			rule_id VARCHAR(128) NOT NULL,
			path TEXT NOT NULL,
			message TEXT NOT NULL
		)
	`)
}

func saveSecurityReportToDB(item securityReport) (securityReport, error) {
	if DB == nil {
		return securityReport{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_reports (project_id, organization_id, connection_id, repository, branch, commit_sha, adapter_version, scanner, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, item.ProjectID, item.OrganizationID, item.ConnectionID, item.Repository, item.Branch, item.CommitSHA, item.AdapterVersion, item.Scanner, item.State).Scan(&item.ID)
	return item, err
}

func findSecurityReportFromDB(connectionID int, repository, commitSHA, adapter string) (securityReport, error) {
	if DB == nil {
		return securityReport{}, nil
	}
	var item securityReport
	err := DB.QueryRow(`
		SELECT id, project_id, organization_id, connection_id, repository, branch, commit_sha, adapter_version, scanner, state
		FROM security_reports
		WHERE connection_id = $1 AND repository = $2 AND commit_sha = $3 AND adapter_version = $4
	`, connectionID, repository, commitSHA, adapter).Scan(&item.ID, &item.ProjectID, &item.OrganizationID, &item.ConnectionID, &item.Repository, &item.Branch, &item.CommitSHA, &item.AdapterVersion, &item.Scanner, &item.State)
	if err != nil {
		return securityReport{}, nil
	}
	item.Findings, _ = listSecurityFindingsFromDB(item.ID)
	return item, nil
}

func insertSecurityFindingToDB(item securityReportFinding) (securityReportFinding, error) {
	if DB == nil {
		return securityReportFinding{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_report_findings (report_id, rule_id, path, message)
		VALUES ($1,$2,$3,$4) RETURNING id
	`, item.ReportID, item.RuleID, item.Path, item.Message).Scan(&item.ID)
	return item, err
}

func listSecurityFindingsFromDB(reportID int) ([]securityReportFinding, error) {
	rows, err := DB.Query(`
		SELECT id, report_id, rule_id, path, message FROM security_report_findings WHERE report_id = $1 ORDER BY id
	`, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []securityReportFinding
	for rows.Next() {
		var item securityReportFinding
		if err := rows.Scan(&item.ID, &item.ReportID, &item.RuleID, &item.Path, &item.Message); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadSecurityReportFromDB(id int) (securityReport, error) {
	if DB == nil || id <= 0 {
		return securityReport{}, errReportHidden
	}
	var item securityReport
	err := DB.QueryRow(`
		SELECT id, project_id, organization_id, connection_id, repository, branch, commit_sha, adapter_version, scanner, state
		FROM security_reports WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.OrganizationID, &item.ConnectionID, &item.Repository, &item.Branch, &item.CommitSHA, &item.AdapterVersion, &item.Scanner, &item.State)
	if err != nil {
		return securityReport{}, errReportHidden
	}
	item.Findings, err = listSecurityFindingsFromDB(item.ID)
	return item, err
}

func securityReportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		securityReportDetailHandler(w, r)
		return
	}
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
		ProjectID      int    `json:"project_id"`
		OrganizationID int    `json:"organization_id"`
		ConnectionID   int    `json:"connection_id"`
		Repository     string `json:"repository"`
		Branch         string `json:"branch"`
		CommitSHA      string `json:"commit_sha"`
		AdapterVersion string `json:"adapter_version"`
		Scanner        string `json:"scanner"`
		Payload        string `json:"payload"`
		Findings       []struct {
			RuleID  string `json:"rule_id"`
			Path    string `json:"path"`
			Message string `json:"message"`
			Secret  string `json:"secret"`
		} `json:"findings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeReportError(w, r, errReportInvalid)
		return
	}
	input := securityReportInput{
		ProjectID: body.ProjectID, OrganizationID: body.OrganizationID, ConnectionID: body.ConnectionID,
		Repository: body.Repository, Branch: body.Branch, CommitSHA: body.CommitSHA,
		AdapterVersion: body.AdapterVersion, Scanner: body.Scanner, Payload: body.Payload,
	}
	for _, finding := range body.Findings {
		input.Findings = append(input.Findings, securityReportFindingInput{
			RuleID: finding.RuleID, Path: finding.Path, Message: finding.Message, Secret: finding.Secret,
		})
	}
	saved, err := ingestSecurityReport(actor, input)
	if err != nil {
		writeReportError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func securityReportDetailHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	reportID, _ := strconv.Atoi(r.URL.Query().Get("report_id"))
	saved, err := loadSecurityReport(reportID)
	if err != nil || saved.ID <= 0 || !mappingAllowed(actor, saved.ProjectID, authzRead) {
		writeReportError(w, r, errReportHidden)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func writeReportError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errReportHidden):
		writeAPIError(w, r, http.StatusNotFound, errReportHidden.Error(), nil)
	case errors.Is(err, errReportDenied):
		writeAPIError(w, r, http.StatusForbidden, errReportDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errReportInvalid.Error(), nil)
	}
}
