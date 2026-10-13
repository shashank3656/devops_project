package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

const policyPackVersion = "setuops-cloud-1"

var (
	errCoverageHidden  = errors.New("coverage not found")
	errCoverageDenied  = errors.New("coverage is not permitted")
	errCoverageInvalid = errors.New("coverage is invalid")
)

type policyCheck struct {
	ID        string `json:"id"`
	Domain    string `json:"domain"`
	Severity  string `json:"severity"`
	Rationale string `json:"rationale"`
}

type policyPack struct {
	Version   string        `json:"version"`
	Certified bool          `json:"certified"`
	Guidance  string        `json:"guidance"`
	Checks    []policyCheck `json:"checks"`
}

type nativeFinding struct {
	ID              int    `json:"id"`
	ProjectID       int    `json:"project_id"`
	AccountID       string `json:"account_id"`
	Region          string `json:"region"`
	Source          string `json:"source"`
	SourceFindingID string `json:"source_finding_id"`
	AnalyzerARN     string `json:"analyzer_arn"`
	FindingType     string `json:"finding_type"`
	ResourceID      string `json:"resource_id"`
	CheckID         string `json:"check_id"`
	Severity        string `json:"severity"`
}

type coverageGap struct {
	ID        int    `json:"id"`
	ProjectID int    `json:"project_id"`
	AccountID string `json:"account_id"`
	Region    string `json:"region"`
	CheckID   string `json:"check_id,omitempty"`
	State     string `json:"state"`
	Reason    string `json:"reason"`
}

type coverageReport struct {
	ProjectID           int             `json:"project_id"`
	AccountID           string          `json:"account_id"`
	PackVersion         string          `json:"pack_version"`
	Certified           bool            `json:"certified"`
	Passed              int             `json:"passed"`
	Failed              int             `json:"failed"`
	Error               int             `json:"error"`
	Unknown             int             `json:"unknown"`
	Skipped             int             `json:"skipped"`
	Denominator         int             `json:"denominator"`
	CoverageState       string          `json:"coverage_state"`
	SkippedChecks       []string        `json:"skipped_checks"`
	InaccessibleRegions []coverageGap   `json:"inaccessible_regions"`
	NativeFindings      []nativeFinding `json:"native_findings"`
}

var (
	saveNativeFinding   = saveNativeFindingToDB
	findNativeFinding   = findNativeFindingFromDB
	saveCoverageGap     = saveCoverageGapToDB
	listCoverageGaps    = listCoverageGapsFromDB
	listCoverageResults = listCoverageResultsFromDB
	listNativeFindings  = listNativeFindingsFromDB
)

func initialPolicyPack() policyPack {
	return policyPack{
		Version:   policyPackVersion,
		Certified: false,
		Guidance:  "Initial IAM, network, storage, database, and logging checks. This pack is not a certification.",
		Checks: []policyCheck{
			{ID: "iam_root_mfa", Domain: "iam", Severity: "critical", Rationale: "Root without MFA can take the account."},
			{ID: "sg_unrestricted_ssh", Domain: "network", Severity: "high", Rationale: "Open SSH exposes instances to the internet."},
			{ID: "s3_bucket_public", Domain: "storage", Severity: "high", Rationale: "Public buckets expose stored data."},
			{ID: "rds_public", Domain: "database", Severity: "high", Rationale: "A public database accepts untrusted connections."},
			{ID: "cloudtrail_enabled", Domain: "logging", Severity: "medium", Rationale: "Missing trails hide later account activity."},
		},
	}
}

func packCheck(checkID string) (policyCheck, bool) {
	checkID = strings.ToLower(strings.TrimSpace(checkID))
	for _, check := range initialPolicyPack().Checks {
		if check.ID == checkID {
			return check, true
		}
	}
	return policyCheck{}, false
}

func importNativeFinding(actor authzSubject, input nativeFinding) (nativeFinding, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return nativeFinding{}, errCoverageHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return nativeFinding{}, errCoverageDenied
	}
	input.AccountID = strings.TrimSpace(input.AccountID)
	input.Region = strings.ToLower(strings.TrimSpace(input.Region))
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.SourceFindingID = strings.TrimSpace(input.SourceFindingID)
	input.AnalyzerARN = strings.TrimSpace(input.AnalyzerARN)
	input.FindingType = strings.ToLower(strings.TrimSpace(input.FindingType))
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	if len(input.AccountID) != 12 || input.Region == "" || input.ResourceID == "" || input.SourceFindingID == "" || input.AnalyzerARN == "" {
		return nativeFinding{}, errCoverageInvalid
	}
	if input.Source != "aws-access-analyzer" || input.FindingType != "external-access" {
		return nativeFinding{}, errCoverageInvalid
	}
	if existing, err := findNativeFinding(input.ProjectID, input.Source, input.SourceFindingID); err != nil {
		return nativeFinding{}, err
	} else if existing.ID > 0 {
		return existing, nil
	}
	check, _ := packCheck("s3_bucket_public")
	input.CheckID = check.ID
	input.Severity = check.Severity
	return saveNativeFinding(input)
}

func recordCoverageGap(actor authzSubject, gap coverageGap) (coverageGap, error) {
	if gap.ProjectID <= 0 || !mappingAllowed(actor, gap.ProjectID, authzRead) {
		return coverageGap{}, errCoverageHidden
	}
	if !mappingAllowed(actor, gap.ProjectID, authzWrite) {
		return coverageGap{}, errCoverageDenied
	}
	gap.AccountID = strings.TrimSpace(gap.AccountID)
	gap.Region = strings.ToLower(strings.TrimSpace(gap.Region))
	gap.CheckID = strings.ToLower(strings.TrimSpace(gap.CheckID))
	gap.State = strings.ToLower(strings.TrimSpace(gap.State))
	gap.Reason = strings.TrimSpace(gap.Reason)
	if len(gap.AccountID) != 12 || gap.Region == "" || gap.Reason == "" {
		return coverageGap{}, errCoverageInvalid
	}
	switch gap.State {
	case "inaccessible":
		if gap.CheckID != "" {
			return coverageGap{}, errCoverageInvalid
		}
	case "skipped":
		if _, ok := packCheck(gap.CheckID); !ok {
			return coverageGap{}, errCoverageInvalid
		}
	default:
		return coverageGap{}, errCoverageInvalid
	}
	return saveCoverageGap(gap)
}

func accountCoverage(actor authzSubject, projectID int, accountID string) (coverageReport, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return coverageReport{}, errCoverageHidden
	}
	accountID = strings.TrimSpace(accountID)
	if len(accountID) != 12 {
		return coverageReport{}, errCoverageInvalid
	}
	results, err := listCoverageResults(projectID, accountID)
	if err != nil {
		return coverageReport{}, err
	}
	gaps, err := listCoverageGaps(projectID, accountID)
	if err != nil {
		return coverageReport{}, err
	}
	native, err := listNativeFindings(projectID, accountID)
	if err != nil {
		return coverageReport{}, err
	}
	return summarizeCoverage(projectID, accountID, results, gaps, native), nil
}

func summarizeCoverage(projectID int, accountID string, results map[string]string, gaps []coverageGap, native []nativeFinding) coverageReport {
	pack := initialPolicyPack()
	report := coverageReport{
		ProjectID: projectID, AccountID: accountID, PackVersion: pack.Version,
		Certified: false, Denominator: len(pack.Checks), CoverageState: "unknown",
		SkippedChecks: []string{}, InaccessibleRegions: []coverageGap{}, NativeFindings: native,
	}
	skipped := map[string]bool{}
	for _, gap := range gaps {
		if gap.State == "inaccessible" {
			report.InaccessibleRegions = append(report.InaccessibleRegions, gap)
		}
		if gap.State == "skipped" && gap.CheckID != "" {
			skipped[gap.CheckID] = true
		}
	}
	nativeFail := map[string]bool{}
	for _, item := range native {
		if item.CheckID != "" {
			nativeFail[item.CheckID] = true
		}
	}
	for _, check := range pack.Checks {
		state := "unknown"
		if skipped[check.ID] {
			state = "skipped"
		} else if nativeFail[check.ID] {
			state = "fail"
		} else if result := results[check.ID]; result == "pass" || result == "fail" || result == "error" {
			state = result
		}
		switch state {
		case "pass":
			report.Passed++
		case "fail":
			report.Failed++
		case "error":
			report.Error++
		case "skipped":
			report.Skipped++
			report.SkippedChecks = append(report.SkippedChecks, check.ID)
		default:
			report.Unknown++
		}
	}
	switch {
	case report.Unknown > 0 || report.Skipped > 0 || report.Error > 0 || len(report.InaccessibleRegions) > 0:
		report.CoverageState = "unknown"
	case report.Failed > 0:
		report.CoverageState = "fail"
	case report.Passed == report.Denominator:
		report.CoverageState = "evaluated"
	}
	return report
}

func migrateCoverageSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS native_findings (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			account_id VARCHAR(12) NOT NULL,
			region VARCHAR(64) NOT NULL,
			source VARCHAR(64) NOT NULL,
			source_finding_id VARCHAR(128) NOT NULL,
			analyzer_arn TEXT NOT NULL,
			finding_type VARCHAR(64) NOT NULL,
			resource_id TEXT NOT NULL,
			check_id VARCHAR(128) NOT NULL,
			severity VARCHAR(32) NOT NULL,
			UNIQUE (project_id, source, source_finding_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS coverage_gaps (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			account_id VARCHAR(12) NOT NULL,
			region VARCHAR(64) NOT NULL,
			check_id VARCHAR(128) NOT NULL DEFAULT '',
			state VARCHAR(32) NOT NULL,
			reason TEXT NOT NULL
		)
	`)
}

func saveNativeFindingToDB(item nativeFinding) (nativeFinding, error) {
	if DB == nil {
		return nativeFinding{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO native_findings (project_id, account_id, region, source, source_finding_id, analyzer_arn, finding_type, resource_id, check_id, severity)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
	`, item.ProjectID, item.AccountID, item.Region, item.Source, item.SourceFindingID, item.AnalyzerARN, item.FindingType, item.ResourceID, item.CheckID, item.Severity).Scan(&item.ID)
	return item, err
}

func findNativeFindingFromDB(projectID int, source, sourceFindingID string) (nativeFinding, error) {
	if DB == nil {
		return nativeFinding{}, nil
	}
	var item nativeFinding
	err := DB.QueryRow(`
		SELECT id, project_id, account_id, region, source, source_finding_id, analyzer_arn, finding_type, resource_id, check_id, severity
		FROM native_findings WHERE project_id = $1 AND source = $2 AND source_finding_id = $3
	`, projectID, source, sourceFindingID).Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.Region, &item.Source, &item.SourceFindingID, &item.AnalyzerARN, &item.FindingType, &item.ResourceID, &item.CheckID, &item.Severity)
	if err != nil {
		return nativeFinding{}, nil
	}
	return item, nil
}

func listNativeFindingsFromDB(projectID int, accountID string) ([]nativeFinding, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, account_id, region, source, source_finding_id, analyzer_arn, finding_type, resource_id, check_id, severity
		FROM native_findings WHERE project_id = $1 AND account_id = $2 ORDER BY id
	`, projectID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []nativeFinding
	for rows.Next() {
		var item nativeFinding
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.Region, &item.Source, &item.SourceFindingID, &item.AnalyzerARN, &item.FindingType, &item.ResourceID, &item.CheckID, &item.Severity); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveCoverageGapToDB(item coverageGap) (coverageGap, error) {
	if DB == nil {
		return coverageGap{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO coverage_gaps (project_id, account_id, region, check_id, state, reason)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.ProjectID, item.AccountID, item.Region, item.CheckID, item.State, item.Reason).Scan(&item.ID)
	return item, err
}

func listCoverageGapsFromDB(projectID int, accountID string) ([]coverageGap, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, account_id, region, check_id, state, reason
		FROM coverage_gaps WHERE project_id = $1 AND account_id = $2 ORDER BY id
	`, projectID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []coverageGap
	for rows.Next() {
		var item coverageGap
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.Region, &item.CheckID, &item.State, &item.Reason); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listCoverageResultsFromDB(projectID int, accountID string) (map[string]string, error) {
	results := map[string]string{}
	if DB == nil {
		return results, nil
	}
	rows, err := DB.Query(`
		SELECT check_id, latest_result, coverage FROM cloud_findings
		WHERE project_id = $1 AND account_id = $2
	`, projectID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var checkID, result, coverage string
		if err := rows.Scan(&checkID, &result, &coverage); err != nil {
			return nil, err
		}
		if coverage == "failed" {
			result = "error"
		}
		if result == "pass" || result == "fail" || result == "error" {
			results[checkID] = result
		}
	}
	return results, rows.Err()
}

func policyPackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, err := catalogSubjectFromRequest(r); err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, initialPolicyPack())
}

func nativeFindingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body nativeFinding
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeCoverageError(w, r, errCoverageInvalid)
		return
	}
	saved, err := importNativeFinding(actor, body)
	if err != nil {
		writeCoverageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func coverageGapHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body coverageGap
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeCoverageError(w, r, errCoverageInvalid)
		return
	}
	saved, err := recordCoverageGap(actor, body)
	if err != nil {
		writeCoverageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func coverageReportHandler(w http.ResponseWriter, r *http.Request) {
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
	report, err := accountCoverage(actor, projectID, r.URL.Query().Get("account_id"))
	if err != nil {
		writeCoverageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, report)
}

func writeCoverageError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errCoverageHidden):
		writeAPIError(w, r, http.StatusNotFound, errCoverageHidden.Error(), nil)
	case errors.Is(err, errCoverageDenied):
		writeAPIError(w, r, http.StatusForbidden, errCoverageDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
