package main

import (
	"testing"
	"time"
)

func TestRedisLossKeepsTheAcceptedJob(t *testing.T) {
	loseRedisDispatch()
	t.Cleanup(loseRedisDispatch)
	job := durableJob{ID: 7, RecordID: 9, ProjectID: 10, OrganizationID: pilotOrganizationID, Environment: "dev", State: jobStateQueued, MaxAttempts: jobMaxAttempts}
	restore := stubJobs(&job)
	defer restore()
	start := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	subject := jobGrant(10, "operator")
	effects := 0
	previousEffect := runDurableJobEffect
	runDurableJobEffect = func(durableJob) error {
		effects++
		return nil
	}
	defer func() { runDurableJobEffect = previousEffect }()

	noteJobDispatch(job.ID)
	noteJobDispatch(job.ID)
	if jobDispatchHintCount() != 2 {
		t.Fatalf("hints = %d", jobDispatchHintCount())
	}
	claimed, err := claimJob(subject, 7, "worker-a", start)
	if err != nil || claimed.RecordID != 9 {
		t.Fatalf("claim = %+v err=%v", claimed, err)
	}
	loseRedisDispatch()
	if jobDispatchHintCount() != 0 || job.ID != 7 || job.RecordID != 9 || job.State != jobStateLeased {
		t.Fatalf("redis loss changed the job: hints=%d job=%+v", jobDispatchHintCount(), job)
	}
	if _, _, err := deliverDurableJob(subject, 7, start.Add(time.Second)); err != errJobLeaseHeld || effects != 0 {
		t.Fatalf("active lease after redis loss err=%v effects=%d", err, effects)
	}
	recovered, duplicate, err := deliverDurableJob(subject, 7, start.Add(jobLeaseFor+time.Second))
	if err != nil || duplicate || recovered.ID != 7 || recovered.RecordID != 9 || recovered.State != jobStateSucceeded || effects != 1 {
		t.Fatalf("recovery = %+v duplicate=%v effects=%d err=%v", recovered, duplicate, effects, err)
	}
	again, duplicate, err := deliverDurableJob(subject, 7, start.Add(jobLeaseFor+2*time.Second))
	if err != nil || !duplicate || again.RecordID != 9 || effects != 1 || job.RecordID != 9 {
		t.Fatalf("duplicate delivery = %+v duplicate=%v effects=%d err=%v", again, duplicate, effects, err)
	}

	otherEffects := effects
	if _, _, err := deliverDurableJob(jobGrant(11, "operator"), 7, start); err != errJobHidden || effects != otherEffects {
		t.Fatalf("hidden delivery err=%v effects=%d", err, effects)
	}
	if _, _, err := deliverDurableJob(jobGrant(10, "viewer"), 7, start); err != errJobDenied || effects != otherEffects {
		t.Fatalf("viewer delivery err=%v effects=%d", err, effects)
	}
}
