package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errFindingHidden  = errors.New("finding not found")
	errFindingDenied  = errors.New("finding is not permitted")
	errFindingInvalid = errors.New("finding is invalid")
)

type cloudFinding struct {
	ID            int                  `json:"id"`
	ProjectID     int                  `json:"project_id"`
	AccountID     string               `json:"account_id"`
	Region        string               `json:"region"`
	CheckID       string               `json:"check_id"`
	ResourceID    string               `json:"resource_id"`
	Fingerprint   string               `json:"fingerprint"`
	State         string               `json:"state"`
	LatestResult  string               `json:"latest_result"`
	PolicyVersion string               `json:"policy_version"`
	ClosureReason string               `json:"closure_reason"`
	Coverage      string               `json:"coverage"`
	RescanState   string               `json:"rescan_state"`
	Observations  []findingObservation `json:"observations"`
}

type findingObservation struct {
	ID            int    `json:"id"`
	FindingID     int    `json:"finding_id"`
	JobID         int    `json:"job_id"`
	Result        string `json:"result"`
	PolicyVersion string `json:"policy_version"`
	Evidence      string `json:"evidence"`
	Coverage      string `json:"coverage"`
	ObservedAt    string `json:"observed_at"`
}

type findingInput struct {
	JobID         int
	AccountID     string
	Region        string
	CheckID       string
	ResourceID    string
	Result        string
	PolicyVersion string
	Evidence      string
	Coverage      string
}

var (
	saveCloudFinding         = saveCloudFindingToDB
	findCloudFinding         = findCloudFindingFromDB
	updateCloudFinding       = updateCloudFindingInDB
	insertFindingObservation = insertFindingObservationToDB
	loadCloudFinding         = loadCloudFindingFromDB
	findingClock             = func() time.Time { return time.Now().UTC() }
)

func findingFingerprint(projectID int, accountID, region, checkID, resourceID string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strconv.Itoa(projectID), accountID, region, checkID, resourceID,
	}, "\n")))
	return hex.EncodeToString(sum[:])
}

func recordCloudObservation(actor authzSubject, input findingInput) (cloudFinding, error) {
	job, err := loadScanJob(input.JobID)
	if err != nil || job.ID <= 0 {
		return cloudFinding{}, errFindingHidden
	}
	if !mappingAllowed(actor, job.ProjectID, authzRead) {
		return cloudFinding{}, errFindingHidden
	}
	if !mappingAllowed(actor, job.ProjectID, authzWrite) {
		return cloudFinding{}, errFindingDenied
	}
	normalized, err := normalizeFindingInput(job, input)
	if err != nil {
		return cloudFinding{}, err
	}
	fingerprint := findingFingerprint(job.ProjectID, normalized.AccountID, normalized.Region, normalized.CheckID, normalized.ResourceID)
	current, err := findCloudFinding(fingerprint)
	if err != nil {
		return cloudFinding{}, err
	}
	for _, existing := range current.Observations {
		if existing.JobID == job.ID {
			return current, nil
		}
	}
	if current.ID == 0 {
		current = cloudFinding{
			ProjectID: job.ProjectID, AccountID: normalized.AccountID, Region: normalized.Region,
			CheckID: normalized.CheckID, ResourceID: normalized.ResourceID, Fingerprint: fingerprint,
			State: "open", LatestResult: "unknown", Coverage: "unknown", RescanState: "unknown",
		}
		current, err = saveCloudFinding(current)
		if err != nil {
			return cloudFinding{}, err
		}
	}
	observation := findingObservation{
		FindingID: current.ID, JobID: job.ID, Result: normalized.Result,
		PolicyVersion: normalized.PolicyVersion, Evidence: normalized.Evidence,
		Coverage: normalized.Coverage, ObservedAt: findingClock().Format(time.RFC3339),
	}
	observation, err = insertFindingObservation(observation)
	if err != nil {
		return cloudFinding{}, err
	}
	applyFindingObservation(&current, observation, job.State)
	return updateCloudFinding(current)
}

func normalizeFindingInput(job scanJob, input findingInput) (findingInput, error) {
	input.AccountID = strings.TrimSpace(input.AccountID)
	input.Region = strings.ToLower(strings.TrimSpace(input.Region))
	input.CheckID = strings.ToLower(strings.TrimSpace(input.CheckID))
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.Result = strings.ToLower(strings.TrimSpace(input.Result))
	input.PolicyVersion = strings.TrimSpace(input.PolicyVersion)
	input.Evidence = strings.TrimSpace(input.Evidence)
	input.Coverage = strings.ToLower(strings.TrimSpace(input.Coverage))
	if input.AccountID != job.AccountID || input.Region != strings.ToLower(job.Region) || input.ResourceID == "" || strings.Contains(input.ResourceID, "\n") {
		return findingInput{}, errFindingInvalid
	}
	if !jobHasCheck(job, input.CheckID) {
		return findingInput{}, errFindingInvalid
	}
	switch input.Result {
	case "pass", "fail", "error", "not_applicable":
	default:
		return findingInput{}, errFindingInvalid
	}
	if job.State == "partial" || input.Coverage == "failed" {
		input.Coverage = "failed"
		input.Result = "error"
		return input, nil
	}
	if input.Coverage == "" {
		input.Coverage = "collected"
	}
	if input.Coverage != "collected" || input.PolicyVersion == "" {
		return findingInput{}, errFindingInvalid
	}
	return input, nil
}

func jobHasCheck(job scanJob, checkID string) bool {
	for _, check := range job.Checks {
		if strings.ToLower(strings.TrimSpace(check)) == checkID {
			return true
		}
	}
	return false
}

func applyFindingObservation(finding *cloudFinding, observation findingObservation, jobState string) {
	finding.Observations = append(finding.Observations, observation)
	if observation.Coverage == "failed" || jobState == "partial" {
		finding.Coverage = "failed"
		finding.RescanState = "unknown"
		if finding.State != "resolved" && finding.State != "closed" {
			finding.State = "open"
			finding.LatestResult = "error"
		}
		return
	}
	finding.Coverage = "collected"
	if observation.PolicyVersion != "" {
		finding.PolicyVersion = observation.PolicyVersion
	}
	switch observation.Result {
	case "pass":
		if jobState == "completed" && finding.State != "closed" {
			finding.State = "resolved"
			finding.LatestResult = "pass"
			finding.RescanState = "verified"
			finding.ClosureReason = ""
		}
	case "fail":
		if finding.State != "closed" {
			finding.State = "open"
			finding.LatestResult = "fail"
			finding.RescanState = "rescan"
			finding.ClosureReason = ""
		}
	case "not_applicable":
		if finding.State != "resolved" && finding.State != "closed" {
			finding.State = "open"
			finding.LatestResult = "not_applicable"
			finding.RescanState = "unknown"
		}
	default:
		if finding.State != "resolved" && finding.State != "closed" {
			finding.State = "open"
			finding.LatestResult = "error"
			finding.RescanState = "unknown"
		}
	}
}

func closeCloudFinding(actor authzSubject, findingID int, reason string) (cloudFinding, error) {
	current, err := loadCloudFinding(findingID)
	if err != nil || current.ID <= 0 {
		return cloudFinding{}, errFindingHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return cloudFinding{}, errFindingHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return cloudFinding{}, errFindingDenied
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.EqualFold(reason, "healthy") {
		return cloudFinding{}, errFindingInvalid
	}
	current.State = "closed"
	current.ClosureReason = reason
	current.RescanState = "closed"
	return updateCloudFinding(current)
}

func migrateFindingSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cloud_findings (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			account_id VARCHAR(12) NOT NULL,
			region VARCHAR(64) NOT NULL,
			check_id VARCHAR(128) NOT NULL,
			resource_id TEXT NOT NULL,
			fingerprint CHAR(64) NOT NULL UNIQUE,
			state VARCHAR(32) NOT NULL,
			latest_result VARCHAR(32) NOT NULL,
			policy_version VARCHAR(64) NOT NULL DEFAULT '',
			closure_reason TEXT NOT NULL DEFAULT '',
			coverage VARCHAR(32) NOT NULL,
			rescan_state VARCHAR(32) NOT NULL,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS finding_observations (
			id SERIAL PRIMARY KEY,
			finding_id INTEGER NOT NULL,
			job_id INTEGER NOT NULL,
			result VARCHAR(32) NOT NULL,
			policy_version VARCHAR(64) NOT NULL DEFAULT '',
			evidence TEXT NOT NULL DEFAULT '',
			coverage VARCHAR(32) NOT NULL,
			observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (finding_id, job_id)
		)
	`)
}

func saveCloudFindingToDB(item cloudFinding) (cloudFinding, error) {
	if DB == nil {
		return cloudFinding{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO cloud_findings (project_id, account_id, region, check_id, resource_id, fingerprint, state, latest_result, policy_version, closure_reason, coverage, rescan_state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
	`, item.ProjectID, item.AccountID, item.Region, item.CheckID, item.ResourceID, item.Fingerprint, item.State, item.LatestResult, item.PolicyVersion, item.ClosureReason, item.Coverage, item.RescanState).Scan(&item.ID)
	return item, err
}

func findCloudFindingFromDB(fingerprint string) (cloudFinding, error) {
	if DB == nil || fingerprint == "" {
		return cloudFinding{}, nil
	}
	var item cloudFinding
	err := DB.QueryRow(`
		SELECT id, project_id, account_id, region, check_id, resource_id, fingerprint, state, latest_result, policy_version, closure_reason, coverage, rescan_state
		FROM cloud_findings WHERE fingerprint = $1
	`, fingerprint).Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.Region, &item.CheckID, &item.ResourceID, &item.Fingerprint, &item.State, &item.LatestResult, &item.PolicyVersion, &item.ClosureReason, &item.Coverage, &item.RescanState)
	if err != nil {
		return cloudFinding{}, nil
	}
	item.Observations, _ = listFindingObservationsFromDB(item.ID)
	return item, nil
}

func updateCloudFindingInDB(item cloudFinding) (cloudFinding, error) {
	if DB == nil {
		return cloudFinding{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE cloud_findings
		SET state = $2, latest_result = $3, policy_version = $4, closure_reason = $5, coverage = $6, rescan_state = $7, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, item.ID, item.State, item.LatestResult, item.PolicyVersion, item.ClosureReason, item.Coverage, item.RescanState)
	return item, err
}

func insertFindingObservationToDB(item findingObservation) (findingObservation, error) {
	if DB == nil {
		return findingObservation{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO finding_observations (finding_id, job_id, result, policy_version, evidence, coverage, observed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
	`, item.FindingID, item.JobID, item.Result, item.PolicyVersion, item.Evidence, item.Coverage, item.ObservedAt).Scan(&item.ID)
	return item, err
}

func loadCloudFindingFromDB(id int) (cloudFinding, error) {
	if DB == nil || id <= 0 {
		return cloudFinding{}, errFindingHidden
	}
	var item cloudFinding
	err := DB.QueryRow(`
		SELECT id, project_id, account_id, region, check_id, resource_id, fingerprint, state, latest_result, policy_version, closure_reason, coverage, rescan_state
		FROM cloud_findings WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.Region, &item.CheckID, &item.ResourceID, &item.Fingerprint, &item.State, &item.LatestResult, &item.PolicyVersion, &item.ClosureReason, &item.Coverage, &item.RescanState)
	if err != nil {
		return cloudFinding{}, errFindingHidden
	}
	item.Observations, err = listFindingObservationsFromDB(item.ID)
	return item, err
}

func listFindingObservationsFromDB(findingID int) ([]findingObservation, error) {
	rows, err := DB.Query(`
		SELECT id, finding_id, job_id, result, policy_version, evidence, coverage, observed_at
		FROM finding_observations WHERE finding_id = $1 ORDER BY id
	`, findingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []findingObservation
	for rows.Next() {
		var item findingObservation
		var observed time.Time
		if err := rows.Scan(&item.ID, &item.FindingID, &item.JobID, &item.Result, &item.PolicyVersion, &item.Evidence, &item.Coverage, &observed); err != nil {
			return nil, err
		}
		item.ObservedAt = observed.UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func findingObservationHandler(w http.ResponseWriter, r *http.Request) {
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
		JobID         int    `json:"job_id"`
		AccountID     string `json:"account_id"`
		Region        string `json:"region"`
		CheckID       string `json:"check_id"`
		ResourceID    string `json:"resource_id"`
		Result        string `json:"result"`
		PolicyVersion string `json:"policy_version"`
		Evidence      string `json:"evidence"`
		Coverage      string `json:"coverage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFindingError(w, r, errFindingInvalid)
		return
	}
	saved, err := recordCloudObservation(actor, findingInput{
		JobID: body.JobID, AccountID: body.AccountID, Region: body.Region, CheckID: body.CheckID,
		ResourceID: body.ResourceID, Result: body.Result, PolicyVersion: body.PolicyVersion,
		Evidence: body.Evidence, Coverage: body.Coverage,
	})
	if err != nil {
		writeFindingError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func findingDetailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	findingID, _ := strconv.Atoi(r.URL.Query().Get("finding_id"))
	saved, err := loadCloudFinding(findingID)
	if err != nil || saved.ID <= 0 || !mappingAllowed(actor, saved.ProjectID, authzRead) {
		writeFindingError(w, r, errFindingHidden)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func findingCloseHandler(w http.ResponseWriter, r *http.Request) {
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
		FindingID int    `json:"finding_id"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFindingError(w, r, errFindingInvalid)
		return
	}
	saved, err := closeCloudFinding(actor, body.FindingID, body.Reason)
	if err != nil {
		writeFindingError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func writeFindingError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errFindingHidden):
		writeAPIError(w, r, http.StatusNotFound, errFindingHidden.Error(), nil)
	case errors.Is(err, errFindingDenied):
		writeAPIError(w, r, http.StatusForbidden, errFindingDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
