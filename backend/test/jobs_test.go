package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExpiredLeaseRecoversTheSameJob(t *testing.T) {
	job := durableJob{ID: 7, RecordID: 9, ProjectID: 10, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: jobMaxAttempts}
	restore := stubJobs(&job)
	defer restore()
	start := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	subject := jobGrant(10, "operator")
	first, err := claimJob(subject, 7, "worker-a", start)
	if err != nil || first.Attempts != 1 || first.RecordID != 9 || first.LeaseToken != "lease_a" || job.RecordID != 9 {
		t.Fatalf("claim = %+v err=%v job=%+v", first, err, job)
	}

	held, err := claimJob(subject, 7, "worker-b", start.Add(time.Second))
	if err != errJobLeaseHeld || held.Attempts != 0 || job.Attempts != 1 || job.RecordID != 9 {
		t.Fatalf("held err=%v attempts=%d job=%+v", err, held.Attempts, job)
	}

	recovered, err := claimJob(jobGrant(10, "operator"), 7, "worker-b", start.Add(jobLeaseFor+time.Second))
	if err != nil || recovered.ID != 7 || recovered.RecordID != 9 || recovered.Attempts != 2 || recovered.LeaseToken != "lease_b" || recovered.State != jobStateLeased {
		t.Fatalf("recovery = %+v err=%v job=%+v", recovered, err, job)
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return subject, nil
	}
	hidden := httptest.NewRecorder()
	jobActionHandler(hidden, httptest.NewRequest(http.MethodGet, "/api/jobs/7", nil))
	if hidden.Code != http.StatusOK || strings.Contains(hidden.Body.String(), "lease_a") || strings.Contains(hidden.Body.String(), "lease_b") {
		t.Fatalf("read leaked the lease token: %d %s", hidden.Code, hidden.Body.String())
	}
}

func TestDeadLetterStopsRetriesWithoutANewRecord(t *testing.T) {
	job := durableJob{ID: 7, RecordID: 9, ProjectID: 10, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: 2}
	restore := stubJobs(&job)
	defer restore()
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	subject := jobGrant(10, "operator")

	claimed, err := claimJob(subject, 7, "worker-a", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := failJob(subject, 7, claimed.LeaseToken, "timeout "+claimed.LeaseToken, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if job.State != jobStateQueued || job.RecordID != 9 || strings.Contains(job.LastError, claimed.LeaseToken) {
		t.Fatalf("retry changed the record: %+v", job)
	}
	again, err := claimJob(subject, 7, "worker-a", now.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	dead, err := failJob(subject, 7, again.LeaseToken, "timeout", now.Add(3*time.Second))
	if err != nil || dead.State != jobStateDeadLetter || dead.RecordID != 9 || dead.Attempts != 2 {
		t.Fatalf("dead = %+v err=%v", dead, err)
	}
	if _, err := claimJob(subject, 7, "worker-b", now.Add(4*time.Second)); err != errJobNotRunnable || job.RecordID != 9 {
		t.Fatalf("dead letter was claimed again: %+v err=%v", job, err)
	}
}

func TestJobLeaseStaysInsideProjectConcurrency(t *testing.T) {
	first := durableJob{ID: 7, RecordID: 9, ProjectID: 10, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: jobMaxAttempts}
	second := durableJob{ID: 8, RecordID: 10, ProjectID: 10, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: jobMaxAttempts}
	other := durableJob{ID: 9, RecordID: 11, ProjectID: 12, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: jobMaxAttempts}
	restore := stubJobSet(&first, &second, &other)
	defer restore()
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)

	if _, err := claimJob(jobGrant(10, "operator"), 7, "worker-a", now); err != nil {
		t.Fatal(err)
	}
	if _, err := claimJob(jobGrant(10, "operator"), 8, "worker-a", now); err != errJobConcurrency || second.Attempts != 0 || second.State != jobStateQueued {
		t.Fatalf("second job = %+v", second)
	}
	if _, err := claimJob(jobGrant(12, "operator"), 9, "worker-c", now); err != nil || other.State != jobStateLeased {
		t.Fatalf("other project = %+v err=%v", other, err)
	}

	previousStore := storeJobUpdate
	stores := 0
	storeJobUpdate = func(durableJob, jobAttempt) error {
		stores++
		return previousStore(durableJob{}, jobAttempt{})
	}
	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return jobGrant(10, "viewer"), nil
	}
	denied := httptest.NewRecorder()
	jobActionHandler(denied, httptest.NewRequest(http.MethodPost, "/api/jobs/8/claim", strings.NewReader(`{"owner":"viewer"}`)))
	if denied.Code != http.StatusForbidden || stores != 0 || second.State != jobStateQueued {
		t.Fatalf("viewer status %d stores %d state %s", denied.Code, stores, second.State)
	}
}

func stubJobs(job *durableJob) func() {
	return stubJobSet(job)
}

func stubJobSet(jobs ...*durableJob) func() {
	previousLoad := loadDurableJob
	previousCount := countLeasedJobs
	previousStore := storeJobUpdate
	previousToken := newJobLeaseToken
	previousSubject := catalogSubjectFromRequest
	byID := map[int]*durableJob{}
	for _, job := range jobs {
		byID[job.ID] = job
	}
	tokens := []string{"lease_a", "lease_b", "lease_c", "lease_d"}
	loadDurableJob = func(id int) (durableJob, error) {
		job, ok := byID[id]
		if !ok {
			return durableJob{}, errJobHidden
		}
		return *job, nil
	}
	countLeasedJobs = func(projectID, exceptID int, now time.Time) (int, error) {
		count := 0
		for _, job := range byID {
			if job.ID == exceptID || job.ProjectID != projectID || job.State != jobStateLeased || !job.LeaseUntil.After(now) {
				continue
			}
			count++
		}
		return count, nil
	}
	storeJobUpdate = func(job durableJob, _ jobAttempt) error {
		current := byID[job.ID]
		*current = job
		return nil
	}
	newJobLeaseToken = func() (string, error) {
		token := tokens[0]
		tokens = tokens[1:]
		return token, nil
	}
	return func() {
		loadDurableJob = previousLoad
		countLeasedJobs = previousCount
		storeJobUpdate = previousStore
		newJobLeaseToken = previousToken
		catalogSubjectFromRequest = previousSubject
	}
}

func jobGrant(projectID int, role string) authzSubject {
	return authzSubject{
		UserID:         4,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Role:           role,
			Environments:   []string{"*"},
		}},
	}
}
