package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"strings"
	"sync"
	"time"
)

const idempotencyPendingWindow = 2 * time.Minute

func migrateAPIIdempotencySchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS api_idempotency (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL,
			scope VARCHAR(64) NOT NULL,
			idempotency_key VARCHAR(80) NOT NULL,
			done BOOLEAN NOT NULL DEFAULT FALSE,
			status_code INTEGER NOT NULL DEFAULT 0,
			response_body BYTEA,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (user_id, scope, idempotency_key)
		)
	`)
}

var idempotencyTableOnce sync.Once

func ensureAPIIdempotencyTable() {
	idempotencyTableOnce.Do(migrateAPIIdempotencySchema)
}

func validIdempotencyKey(key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 80 {
		return false
	}
	for _, r := range key {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' {
			return false
		}
	}
	return true
}

type durableIdempotency struct {
	claimed bool
	done    bool
	unknown bool
	status  int
	body    []byte
}

func claimDurableIdempotency(userID int, scope, key string) (durableIdempotency, error) {
	key = strings.TrimSpace(key)
	scope = strings.TrimSpace(scope)
	if DB == nil || userID <= 0 || scope == "" || !validIdempotencyKey(key) {
		return durableIdempotency{claimed: true}, nil
	}
	ensureAPIIdempotencyTable()
	var id int
	err := DB.QueryRow(`
		INSERT INTO api_idempotency (user_id, scope, idempotency_key)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING
		RETURNING id
	`, userID, scope, key).Scan(&id)
	if err == nil {
		return durableIdempotency{claimed: true}, nil
	}
	if err != sql.ErrNoRows {
		return durableIdempotency{}, err
	}
	var done bool
	var status int
	var body []byte
	var created time.Time
	err = DB.QueryRow(`
		SELECT done, status_code, response_body, created_at
		FROM api_idempotency
		WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
	`, userID, scope, key).Scan(&done, &status, &body, &created)
	if err != nil {
		return durableIdempotency{}, err
	}
	if done && len(body) > 0 {
		return durableIdempotency{done: true, status: status, body: body}, nil
	}
	if time.Since(created) < idempotencyPendingWindow {
		return durableIdempotency{}, nil
	}
	_, _ = DB.Exec(`
		DELETE FROM api_idempotency
		WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3 AND done = FALSE
	`, userID, scope, key)
	err = DB.QueryRow(`
		INSERT INTO api_idempotency (user_id, scope, idempotency_key)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING
		RETURNING id
	`, userID, scope, key).Scan(&id)
	if err == nil {
		return durableIdempotency{claimed: true}, nil
	}
	if err != sql.ErrNoRows {
		return durableIdempotency{}, err
	}
	return durableIdempotency{unknown: true}, nil
}

func completeDurableIdempotency(userID int, scope, key string, status int, body []byte) {
	key = strings.TrimSpace(key)
	if DB == nil || userID <= 0 || !validIdempotencyKey(key) || len(body) == 0 {
		return
	}
	_, _ = DB.Exec(`
		UPDATE api_idempotency
		SET done = TRUE, status_code = $4, response_body = $5
		WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
	`, userID, strings.TrimSpace(scope), key, status, body)
}

func releaseDurableIdempotency(userID int, scope, key string) {
	key = strings.TrimSpace(key)
	if DB == nil || userID <= 0 || !validIdempotencyKey(key) {
		return
	}
	_, _ = DB.Exec(`
		DELETE FROM api_idempotency
		WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3 AND done = FALSE
	`, userID, strings.TrimSpace(scope), key)
}

type statusCapture struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (c *statusCapture) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
	c.ResponseWriter.WriteHeader(status)
}

func (c *statusCapture) Write(p []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	_, _ = c.body.Write(p)
	return c.ResponseWriter.Write(p)
}

// beginIdempotentPost replays a finished attempt, rejects a repeat while the first
// attempt is unfinished, or records the response so a later retry returns the same record.
func beginIdempotentPost(w http.ResponseWriter, r *http.Request, userID int, scope string) (http.ResponseWriter, func(), bool) {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if userID <= 0 || !validIdempotencyKey(key) {
		return w, func() {}, false
	}
	claim, err := claimDurableIdempotency(userID, scope, key)
	if err != nil {
		return w, func() {}, false
	}
	if claim.done {
		w.Header().Set("Content-Type", "application/json")
		if claim.status == 0 {
			claim.status = http.StatusOK
		}
		w.WriteHeader(claim.status)
		_, _ = w.Write(claim.body)
		return w, func() {}, true
	}
	if !claim.claimed {
		message := "This attempt is still being saved. Wait, then retry the same submission."
		if claim.unknown {
			message = "The first attempt did not confirm a result. It was not submitted again."
		}
		writeAPIError(w, r, http.StatusConflict, message, nil)
		return w, func() {}, true
	}
	capture := &statusCapture{ResponseWriter: w}
	finish := func() {
		if capture.status >= 200 && capture.status < 300 && capture.body.Len() > 0 {
			completeDurableIdempotency(userID, scope, key, capture.status, capture.body.Bytes())
			return
		}
		releaseDurableIdempotency(userID, scope, key)
	}
	return capture, finish, false
}
