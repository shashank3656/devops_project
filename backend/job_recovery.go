package main

import (
	"context"
	"strconv"
	"sync"
	"time"
)

const durableJobDispatchKey = "setuops:durable-job-dispatch"

var (
	jobDispatchMu       sync.Mutex
	jobDispatchHints    []int
	runDurableJobEffect = func(durableJob) error { return nil }
)

func noteJobDispatch(jobID int) {
	if jobID <= 0 {
		return
	}
	jobDispatchMu.Lock()
	jobDispatchHints = append(jobDispatchHints, jobID)
	jobDispatchMu.Unlock()
	if redisClient != nil && redisClient.enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = redisClient.LPush(ctx, durableJobDispatchKey, strconv.Itoa(jobID))
	}
}

func loseRedisDispatch() {
	jobDispatchMu.Lock()
	jobDispatchHints = nil
	jobDispatchMu.Unlock()
	if redisClient != nil && redisClient.enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = redisClient.Del(ctx, durableJobDispatchKey)
	}
}

func jobDispatchHintCount() int {
	jobDispatchMu.Lock()
	defer jobDispatchMu.Unlock()
	return len(jobDispatchHints)
}

func deliverDurableJob(subject authzSubject, id int, now time.Time) (jobView, bool, error) {
	current, err := loadDurableJob(id)
	if err != nil {
		return jobView{}, false, err
	}
	if err := authorizeJob(subject, current); err != nil {
		return jobView{}, false, err
	}
	if current.State == jobStateSucceeded {
		return current.Public(false), true, nil
	}
	claimed, err := claimJob(subject, id, "recovery", now)
	if err != nil {
		return jobView{}, false, err
	}
	if err := runDurableJobEffect(current); err != nil {
		view, failErr := failJob(subject, id, claimed.LeaseToken, err.Error(), now.Add(time.Millisecond))
		if failErr != nil {
			return jobView{}, false, failErr
		}
		return view, false, err
	}
	view, err := completeJob(subject, id, claimed.LeaseToken, now.Add(time.Millisecond))
	return view, false, err
}
