package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

const (
	pinnedProwlerVersion = "5.15.1"
	maxOverlappingScans  = 1
)

var (
	errScanBounded = errors.New("overlapping scans are bounded")
	errScanVersion = errors.New("prowler version is not pinned")
)

type scanJob struct {
	ID                int      `json:"id"`
	ProjectID         int      `json:"project_id"`
	ProfileID         int      `json:"profile_id"`
	AccountID         string   `json:"account_id"`
	Region            string   `json:"region"`
	Checks            []string `json:"checks"`
	ProwlerVersion    string   `json:"prowler_version"`
	State             string   `json:"state"`
	Completed         int      `json:"completed"`
	Total             int      `json:"total"`
	PermissionFailure string   `json:"permission_failure,omitempty"`
	CredentialsIssued bool     `json:"credentials_issued"`
	WritePermitted    bool     `json:"write_permitted"`
}

var (
	saveScanJob       = saveScanJobToDB
	loadScanJob       = loadScanJobFromDB
	updateScanJob     = updateScanJobInDB
	countOpenScanJobs = countOpenScanJobsInDB
)

func startIsolatedScan(actor authzSubject, profileID int, observedAccount, region string, checks []string, requestedVersion string) (scanJob, error) {
	profile, err := loadScanProfile(profileID)
	if err != nil || profile.ID <= 0 {
		return scanJob{}, errScanHidden
	}
	if !mappingAllowed(actor, profile.ProjectID, authzRead) {
		return scanJob{}, errScanHidden
	}
	if !mappingAllowed(actor, profile.ProjectID, authzWrite) {
		return scanJob{}, errScanDenied
	}
	requestedVersion = strings.TrimSpace(requestedVersion)
	if requestedVersion != "" && requestedVersion != pinnedProwlerVersion {
		return scanJob{}, errScanVersion
	}
	region = strings.TrimSpace(region)
	if region == "" || region != profile.Region || profile.State != "ready" || !profile.ReadOnly {
		return scanJob{}, errScanInvalid
	}
	if strings.TrimSpace(observedAccount) != profile.AccountID {
		_ = abortScanProfile(profile.ID)
		return scanJob{}, errScanIdentity
	}
	normalized, err := normalizeScanChecks(checks)
	if err != nil {
		return scanJob{}, err
	}
	open, err := countOpenScanJobs(profile.ProjectID, profile.AccountID, region)
	if err != nil {
		return scanJob{}, err
	}
	if open >= maxOverlappingScans {
		return scanJob{}, errScanBounded
	}
	return saveScanJob(scanJob{
		ProjectID: profile.ProjectID, ProfileID: profile.ID, AccountID: profile.AccountID,
		Region: region, Checks: normalized, ProwlerVersion: pinnedProwlerVersion,
		State: "running", Total: len(normalized), WritePermitted: false,
	})
}

func normalizeScanChecks(checks []string) ([]string, error) {
	if len(checks) == 0 {
		return nil, errScanInvalid
	}
	seen := map[string]bool{}
	var out []string
	for _, check := range checks {
		check = strings.TrimSpace(check)
		if check == "" || strings.Contains(check, "*") || strings.Contains(check, " ") || seen[check] {
			return nil, errScanInvalid
		}
		seen[check] = true
		out = append(out, check)
	}
	return out, nil
}

func recordScanProgress(actor authzSubject, jobID, completed int, permissionFailure string) (scanJob, error) {
	saved, err := loadScanJob(jobID)
	if err != nil || saved.ID <= 0 {
		return scanJob{}, errScanHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return scanJob{}, errScanHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return scanJob{}, errScanDenied
	}
	if completed < 0 || completed > saved.Total || saved.State == "partial" || saved.State == "completed" {
		return scanJob{}, errScanInvalid
	}
	saved.Completed = completed
	saved.PermissionFailure = strings.TrimSpace(permissionFailure)
	saved.WritePermitted = false
	saved.CredentialsIssued = false
	if saved.PermissionFailure != "" {
		saved.State = "partial"
		return updateScanJob(saved)
	}
	if completed == saved.Total {
		saved.State = "completed"
	} else {
		saved.State = "running"
	}
	return updateScanJob(saved)
}

func migrateScanJobSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS scan_jobs (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			profile_id INTEGER NOT NULL,
			account_id VARCHAR(12) NOT NULL,
			region VARCHAR(64) NOT NULL,
			checks TEXT NOT NULL,
			prowler_version VARCHAR(32) NOT NULL,
			state VARCHAR(32) NOT NULL,
			completed INTEGER NOT NULL DEFAULT 0,
			total INTEGER NOT NULL,
			permission_failure TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveScanJobToDB(item scanJob) (scanJob, error) {
	if DB == nil {
		return scanJob{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO scan_jobs (project_id, profile_id, account_id, region, checks, prowler_version, state, completed, total, permission_failure)
		VALUES ($1,$2,$3,$4,$5,$6,'running',0,$7,'') RETURNING id
	`, item.ProjectID, item.ProfileID, item.AccountID, item.Region, strings.Join(item.Checks, ","), item.ProwlerVersion, item.Total).Scan(&item.ID)
	if err != nil {
		return scanJob{}, err
	}
	item.State = "running"
	item.ProwlerVersion = pinnedProwlerVersion
	item.WritePermitted = false
	return item, nil
}

func loadScanJobFromDB(id int) (scanJob, error) {
	if DB == nil || id <= 0 {
		return scanJob{}, errScanHidden
	}
	var item scanJob
	var checks string
	err := DB.QueryRow(`
		SELECT id, project_id, profile_id, account_id, region, checks, prowler_version, state, completed, total, permission_failure
		FROM scan_jobs WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.ProfileID, &item.AccountID, &item.Region, &checks, &item.ProwlerVersion, &item.State, &item.Completed, &item.Total, &item.PermissionFailure)
	if err != nil {
		return scanJob{}, errScanHidden
	}
	if checks != "" {
		item.Checks = strings.Split(checks, ",")
	}
	return item, nil
}

func updateScanJobInDB(item scanJob) (scanJob, error) {
	if DB == nil {
		return scanJob{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE scan_jobs SET state = $2, completed = $3, permission_failure = $4 WHERE id = $1
	`, item.ID, item.State, item.Completed, item.PermissionFailure)
	return item, err
}

func countOpenScanJobsInDB(projectID int, accountID, region string) (int, error) {
	if DB == nil {
		return 0, nil
	}
	var count int
	err := DB.QueryRow(`
		SELECT COUNT(*) FROM scan_jobs
		WHERE project_id = $1 AND account_id = $2 AND region = $3 AND state IN ('queued', 'running')
	`, projectID, accountID, region).Scan(&count)
	return count, err
}

func scanJobHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		scanProgressHandler(w, r)
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
		ProfileID       int      `json:"profile_id"`
		ObservedAccount string   `json:"observed_account"`
		Region          string   `json:"region"`
		Checks          []string `json:"checks"`
		ProwlerVersion  string   `json:"prowler_version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeScanError(w, r, errScanInvalid)
		return
	}
	saved, err := startIsolatedScan(actor, body.ProfileID, body.ObservedAccount, body.Region, body.Checks, body.ProwlerVersion)
	if err != nil {
		writeScanError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func scanProgressHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	jobID, _ := strconv.Atoi(r.URL.Query().Get("job_id"))
	saved, err := loadScanJob(jobID)
	if err != nil || saved.ID <= 0 || !mappingAllowed(actor, saved.ProjectID, authzRead) {
		writeScanError(w, r, errScanHidden)
		return
	}
	saved.WritePermitted = false
	saved.CredentialsIssued = false
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func scanProgressReportHandler(w http.ResponseWriter, r *http.Request) {
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
		JobID             int    `json:"job_id"`
		Completed         int    `json:"completed"`
		PermissionFailure string `json:"permission_failure"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeScanError(w, r, errScanInvalid)
		return
	}
	saved, err := recordScanProgress(actor, body.JobID, body.Completed, body.PermissionFailure)
	if err != nil {
		writeScanError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}
