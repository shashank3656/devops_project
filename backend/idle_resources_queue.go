package main

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// idleScanJob is a single unit of work pulled off the queue.
type idleScanJob struct {
	ScanID    int `json:"scan_id"`
	AccountID int `json:"account_id"`
	ActorID   int `json:"actor_id"`
}

const idleScanQueueKey = "idle:scan-queue"

var (
	idleQueueClient    *redis.Client
	idleQueueClientMu  sync.Mutex
	idleQueueAvailable bool
)

// idleQueueClientLazy returns a Redis client (memoised) only when REDIS_ADDR is
// configured and reachable. On any failure it returns nil so callers fall
// back to the in-process goroutine.
func idleQueueClientLazy() *redis.Client {
	idleQueueClientMu.Lock()
	defer idleQueueClientMu.Unlock()
	if idleQueueClient != nil {
		return idleQueueClient
	}
	if RedisAddr == "" {
		return nil
	}
	client := redis.NewClient(&redis.Options{
		Addr:     RedisAddr,
		Password: RedisPassword,
		DB:       RedisDB,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("idle-queue: redis ping failed (%v); falling back to in-process goroutines", err)
		_ = client.Close()
		return nil
	}
	idleQueueClient = client
	idleQueueAvailable = true
	return client
}

// enqueueIdleScan tries to push the job onto Redis. If Redis isn't reachable
// it falls back to spawning a goroutine, preserving the previous behaviour.
func enqueueIdleScan(scanID, accountID, actorID int) {
	job := idleScanJob{ScanID: scanID, AccountID: accountID, ActorID: actorID}
	body, _ := json.Marshal(job)

	if c := idleQueueClientLazy(); c != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := c.RPush(ctx, idleScanQueueKey, body).Err(); err == nil {
			return
		}
		log.Printf("idle-queue: RPUSH failed; running scan inline")
	}
	// Fallback path: in-process goroutine.
	go runIdleScan(scanID, accountID, actorID)
}

// startIdleScanWorker subscribes to the Redis queue and processes jobs in a
// long-running goroutine. Multiple replicas can safely run this in parallel
// because BLPOP is atomic. When Redis isn't configured the worker exits
// quietly and the in-process fallback in enqueueIdleScan handles execution.
func startIdleScanWorker() {
	go func() {
		// Warm-up to let the rest of the boot finish.
		time.Sleep(15 * time.Second)
		c := idleQueueClientLazy()
		if c == nil {
			return
		}
		log.Printf("idle-queue: worker started, listening on %s", idleScanQueueKey)
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			res, err := c.BLPop(ctx, 25*time.Second, idleScanQueueKey).Result()
			cancel()
			if err != nil {
				if err == redis.Nil {
					continue
				}
				log.Printf("idle-queue: blpop failed: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}
			if len(res) < 2 {
				continue
			}
			var job idleScanJob
			if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
				log.Printf("idle-queue: bad job payload: %v", err)
				continue
			}
			runIdleScan(job.ScanID, job.AccountID, job.ActorID)
		}
	}()
}
