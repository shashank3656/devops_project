package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	jobStateQueued        = "queued"
	jobStateLeased        = "leased"
	jobStateDeadLetter    = "dead_letter"
	jobStateSucceeded     = "succeeded"
	jobMaxAttempts        = 3
	jobLeaseFor           = 30 * time.Second
	jobAccountConcurrency = 1
)

var (
	errJobHidden       = errors.New("job not found")
	errJobDenied       = errors.New("job scope denied")
	errJobLeaseHeld    = errors.New("job lease is held")
	errJobNotRunnable  = errors.New("job is not runnable")
	errJobConcurrency  = errors.New("account concurrency limit")
	errJobToken        = errors.New("job lease token does not match")
	errJobLeaseExpired = errors.New("job lease expired")
)

type durableJob struct {
	ID             int
	RecordID       int
	ProjectID      int
	OrganizationID int
	Environment    string
	State          string
	Attempts       int
	MaxAttempts    int
	LeaseOwner     string
	LeaseToken     string
	LeaseUntil     time.Time
	LastError      string
}

type jobAttempt struct {
	JobID   int
	Attempt int
	Owner   string
	Result  string
	Error   string
}

type jobView struct {
	ID          int       `json:"id"`
	RecordID    int       `json:"record_id"`
	ProjectID   int       `json:"project_id"`
	Environment string    `json:"environment"`
	State       string    `json:"state"`
	Attempts    int       `json:"attempts"`
	MaxAttempts int       `json:"max_attempts"`
	LeaseOwner  string    `json:"lease_owner,omitempty"`
	LeaseUntil  time.Time `json:"lease_until,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
	LeaseToken  string    `json:"lease_token,omitempty"`
}

var (
	loadDurableJob   = loadDurableJobFromDB
	countLeasedJobs  = countLeasedJobsFromDB
	storeJobUpdate   = storeJobUpdateToDB
	newJobLeaseToken = randomJobLeaseToken
)

func (job durableJob) Public(includeToken bool) jobView {
	view := jobView{
		ID:          job.ID,
		RecordID:    job.RecordID,
		ProjectID:   job.ProjectID,
		Environment: job.Environment,
		State:       job.State,
		Attempts:    job.Attempts,
		MaxAttempts: job.MaxAttempts,
		LeaseOwner:  job.LeaseOwner,
		LastError:   job.LastError,
	}
	if !job.LeaseUntil.IsZero() {
		view.LeaseUntil = job.LeaseUntil.UTC()
	}
	if includeToken {
		view.LeaseToken = job.LeaseToken
	}
	return view
}

func claimDurableJob(job durableJob, owner string, now time.Time, leasedSiblings int, token string) (durableJob, jobAttempt, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || len(owner) > 128 {
		return job, jobAttempt{}, errors.New("worker owner is required")
	}
	if strings.TrimSpace(token) == "" {
		return job, jobAttempt{}, errors.New("job lease token is required")
	}
	if job.State == jobStateSucceeded || job.State == jobStateDeadLetter {
		return job, jobAttempt{}, errJobNotRunnable
	}
	if job.MaxAttempts <= 0 {
		job.MaxAttempts = jobMaxAttempts
	}
	if job.State == jobStateLeased && job.LeaseUntil.After(now) {
		return job, jobAttempt{}, errJobLeaseHeld
	}
	if leasedSiblings >= jobAccountConcurrency {
		return job, jobAttempt{}, errJobConcurrency
	}
	job.Attempts++
	job.State = jobStateLeased
	job.LeaseOwner = owner
	job.LeaseToken = token
	job.LeaseUntil = now.UTC().Add(jobLeaseFor)
	job.LastError = ""
	return job, jobAttempt{JobID: job.ID, Attempt: job.Attempts, Owner: owner, Result: "leased"}, nil
}

func failDurableJob(job durableJob, token, reason string, now time.Time) (durableJob, jobAttempt, error) {
	if job.State != jobStateLeased || !job.LeaseUntil.After(now) {
		return job, jobAttempt{}, errJobLeaseExpired
	}
	if strings.TrimSpace(token) == "" || token != job.LeaseToken {
		return job, jobAttempt{}, errJobToken
	}
	owner := job.LeaseOwner
	reason = strings.TrimSpace(strings.ReplaceAll(reason, token, "[redacted]"))
	if len(reason) > 500 {
		reason = reason[:500]
	}
	result := "failed"
	if job.Attempts >= job.MaxAttempts {
		job.State = jobStateDeadLetter
		result = "dead_letter"
	} else {
		job.State = jobStateQueued
	}
	job.LeaseOwner = ""
	job.LeaseToken = ""
	job.LeaseUntil = time.Time{}
	job.LastError = reason
	return job, jobAttempt{JobID: job.ID, Attempt: job.Attempts, Owner: owner, Result: result, Error: reason}, nil
}

func completeDurableJob(job durableJob, token string, now time.Time) (durableJob, jobAttempt, bool, error) {
	if job.State == jobStateSucceeded {
		return job, jobAttempt{}, true, nil
	}
	if job.State != jobStateLeased || !job.LeaseUntil.After(now) {
		return job, jobAttempt{}, false, errJobLeaseExpired
	}
	if strings.TrimSpace(token) == "" || token != job.LeaseToken {
		return job, jobAttempt{}, false, errJobToken
	}
	owner := job.LeaseOwner
	job.State = jobStateSucceeded
	job.LeaseOwner = ""
	job.LeaseToken = ""
	job.LeaseUntil = time.Time{}
	return job, jobAttempt{JobID: job.ID, Attempt: job.Attempts, Owner: owner, Result: "succeeded"}, false, nil
}

func authorizeJob(subject authzSubject, job durableJob) error {
	environment := job.Environment
	if strings.TrimSpace(environment) == "" {
		environment = "*"
	}
	if job.ID <= 0 || job.ProjectID <= 0 || !catalogEnvironmentsAllowed(subject, job.ProjectID, []string{environment}, authzRead) {
		return errJobHidden
	}
	if !catalogEnvironmentsAllowed(subject, job.ProjectID, []string{environment}, authzWrite) {
		return errJobDenied
	}
	return nil
}

func claimJob(subject authzSubject, id int, owner string, now time.Time) (jobView, error) {
	current, err := loadDurableJob(id)
	if err != nil {
		return jobView{}, err
	}
	if err := authorizeJob(subject, current); err != nil {
		return jobView{}, err
	}
	if current.State == jobStateSucceeded || current.State == jobStateDeadLetter {
		return jobView{}, errJobNotRunnable
	}
	if current.State == jobStateLeased && current.LeaseUntil.After(now) {
		return jobView{}, errJobLeaseHeld
	}
	token, err := newJobLeaseToken()
	if err != nil {
		return jobView{}, err
	}
	siblings, err := countLeasedJobs(current.ProjectID, current.ID, now)
	if err != nil {
		return jobView{}, err
	}
	next, attempt, err := claimDurableJob(current, owner, now, siblings, token)
	if err != nil {
		return jobView{}, err
	}
	if err := storeJobUpdate(next, attempt); err != nil {
		return jobView{}, err
	}
	return next.Public(true), nil
}

func failJob(subject authzSubject, id int, token, reason string, now time.Time) (jobView, error) {
	current, err := loadDurableJob(id)
	if err != nil {
		return jobView{}, err
	}
	if err := authorizeJob(subject, current); err != nil {
		return jobView{}, err
	}
	next, attempt, err := failDurableJob(current, token, reason, now)
	if err != nil {
		return jobView{}, err
	}
	if err := storeJobUpdate(next, attempt); err != nil {
		return jobView{}, err
	}
	return next.Public(false), nil
}

func completeJob(subject authzSubject, id int, token string, now time.Time) (jobView, error) {
	current, err := loadDurableJob(id)
	if err != nil {
		return jobView{}, err
	}
	if err := authorizeJob(subject, current); err != nil {
		return jobView{}, err
	}
	next, attempt, _, err := completeDurableJob(current, token, now)
	if err != nil {
		return jobView{}, err
	}
	if attempt.Attempt > 0 {
		if err := storeJobUpdate(next, attempt); err != nil {
			return jobView{}, err
		}
	}
	return next.Public(false), nil
}

func readJob(subject authzSubject, id int) (jobView, error) {
	current, err := loadDurableJob(id)
	if err != nil {
		return jobView{}, err
	}
	environment := current.Environment
	if strings.TrimSpace(environment) == "" {
		environment = "*"
	}
	if current.ID <= 0 || !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{environment}, authzRead) {
		return jobView{}, errJobHidden
	}
	return current.Public(false), nil
}

func randomJobLeaseToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "lease_" + hex.EncodeToString(buf), nil
}

func jobActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	id, action, ok := parseJobPath(r.URL.Path)
	if !ok || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid job id", nil)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid job request", nil)
		return
	}
	var input struct {
		Owner string `json:"owner"`
		Token string `json:"token"`
		Error string `json:"error"`
	}
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &input); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid job request", nil)
			return
		}
	}
	now := time.Now().UTC()
	var view jobView
	switch {
	case action == "" && r.Method == http.MethodGet:
		view, err = readJob(subject, id)
	case action == "claim" && r.Method == http.MethodPost:
		view, err = claimJob(subject, id, input.Owner, now)
	case action == "fail" && r.Method == http.MethodPost:
		view, err = failJob(subject, id, input.Token, input.Error, now)
	case action == "complete" && r.Method == http.MethodPost:
		view, err = completeJob(subject, id, input.Token, now)
	default:
		writeMethodNotAllowed(w, r)
		return
	}
	if err != nil {
		writeJobError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"job": view, "status": "ok"})
}

func parseJobPath(path string) (int, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/jobs/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || parts[0] == "" {
		return 0, "", false
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, "", false
	}
	if len(parts) == 1 {
		return id, "", true
	}
	if len(parts) == 2 && (parts[1] == "claim" || parts[1] == "fail" || parts[1] == "complete") {
		return id, parts[1], true
	}
	return 0, "", false
}

func writeJobError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errJobHidden):
		writeAPIError(w, r, http.StatusNotFound, errJobHidden.Error(), nil)
	case errors.Is(err, errJobDenied):
		writeAPIError(w, r, http.StatusForbidden, errJobDenied.Error(), nil)
	case errors.Is(err, errJobLeaseHeld), errors.Is(err, errJobNotRunnable), errors.Is(err, errJobConcurrency), errors.Is(err, errJobToken), errors.Is(err, errJobLeaseExpired):
		writeAPIError(w, r, http.StatusConflict, err.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}

func migrateJobSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS jobs (
			id SERIAL PRIMARY KEY,
			record_id INTEGER NOT NULL UNIQUE REFERENCES outbox_records(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			organization_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			state VARCHAR(32) NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			max_attempts INTEGER NOT NULL DEFAULT 3,
			lease_owner VARCHAR(128) NOT NULL DEFAULT '',
			lease_token VARCHAR(64) NOT NULL DEFAULT '',
			lease_until TIMESTAMP,
			last_error TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS job_attempts (
			id SERIAL PRIMARY KEY,
			job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
			attempt INTEGER NOT NULL,
			owner VARCHAR(128) NOT NULL DEFAULT '',
			result VARCHAR(32) NOT NULL,
			error TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_jobs_project_state ON jobs(project_id, state)`)
}

func loadDurableJobFromDB(id int) (durableJob, error) {
	if DB == nil {
		return durableJob{}, errors.New("database not available")
	}
	job, err := scanDurableJob(DB.QueryRow(`
		SELECT id, record_id, project_id, organization_id, environment, state, attempts, max_attempts, lease_owner, lease_token, lease_until, last_error
		FROM jobs WHERE id = $1
	`, id))
	if errors.Is(err, sql.ErrNoRows) || isMissingDatabaseRelation(err, "jobs") {
		return durableJob{}, errJobHidden
	}
	return job, err
}

func countLeasedJobsFromDB(projectID, exceptID int, now time.Time) (int, error) {
	if DB == nil {
		return 0, errors.New("database not available")
	}
	var count int
	err := DB.QueryRow(`
		SELECT COUNT(*) FROM jobs
		WHERE project_id = $1 AND id <> $2 AND state = $3 AND lease_until > $4
	`, projectID, exceptID, jobStateLeased, now.UTC()).Scan(&count)
	return count, err
}

func storeJobUpdateToDB(job durableJob, attempt jobAttempt) error {
	if DB == nil {
		return errors.New("database not available")
	}
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var leaseUntil any
	if !job.LeaseUntil.IsZero() {
		leaseUntil = job.LeaseUntil.UTC()
	}
	_, err = tx.Exec(`
		UPDATE jobs
		SET state = $2, attempts = $3, max_attempts = $4, lease_owner = $5, lease_token = $6, lease_until = $7, last_error = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, job.ID, job.State, job.Attempts, job.MaxAttempts, job.LeaseOwner, job.LeaseToken, leaseUntil, job.LastError)
	if err != nil {
		return err
	}
	if attempt.Attempt > 0 {
		if _, err = tx.Exec(`
			INSERT INTO job_attempts (job_id, attempt, owner, result, error)
			VALUES ($1, $2, $3, $4, $5)
		`, attempt.JobID, attempt.Attempt, attempt.Owner, attempt.Result, attempt.Error); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func scanDurableJob(row *sql.Row) (durableJob, error) {
	var job durableJob
	var leaseUntil sql.NullTime
	err := row.Scan(&job.ID, &job.RecordID, &job.ProjectID, &job.OrganizationID, &job.Environment, &job.State, &job.Attempts, &job.MaxAttempts, &job.LeaseOwner, &job.LeaseToken, &leaseUntil, &job.LastError)
	if leaseUntil.Valid {
		job.LeaseUntil = leaseUntil.Time.UTC()
	}
	return job, err
}

func insertDurableJobTx(tx *sql.Tx, record outboxRecord) (durableJob, error) {
	job := durableJob{
		RecordID:       record.ID,
		ProjectID:      record.ProjectID,
		OrganizationID: record.OrganizationID,
		Environment:    record.Environment,
		State:          jobStateQueued,
		MaxAttempts:    jobMaxAttempts,
	}
	err := tx.QueryRow(`
		INSERT INTO jobs (record_id, project_id, organization_id, environment, state, attempts, max_attempts)
		VALUES ($1, $2, $3, $4, $5, 0, $6)
		RETURNING id
	`, job.RecordID, job.ProjectID, job.OrganizationID, job.Environment, job.State, job.MaxAttempts).Scan(&job.ID)
	return job, err
}

func loadJobByRecordTx(tx *sql.Tx, recordID int) (durableJob, error) {
	return scanDurableJob(tx.QueryRow(`
		SELECT id, record_id, project_id, organization_id, environment, state, attempts, max_attempts, lease_owner, lease_token, lease_until, last_error
		FROM jobs WHERE record_id = $1
	`, recordID))
}
