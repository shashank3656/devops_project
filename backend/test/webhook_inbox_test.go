package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookInboxRejectsInvalidAndCrossScope(t *testing.T) {
	secret := "inbox-test-secret"
	saves := 0
	restore := stubInbox(secret, func(inboxReceipt) (inboxAcceptView, error) {
		saves++
		return inboxAcceptView{InboxID: 1, RecordID: 2, Revision: 1}, nil
	})
	defer restore()
	body := []byte(`{"event_id":"evt-1","external_id":"chg-9","revision":1,"project_id":10,"environment":"dev","event_type":"change.updated"}`)

	missing := postInbox(t, body, "not-a-signature")
	if missing.Code != http.StatusUnauthorized || saves != 0 || strings.Contains(missing.Body.String(), secret) || strings.Contains(missing.Body.String(), `"accepted":true`) {
		t.Fatalf("invalid signature status %d saves %d body %s", missing.Code, saves, missing.Body.String())
	}

	cross := postInbox(t, []byte(`{"event_id":"evt-2","external_id":"chg-9","revision":1,"project_id":11,"environment":"dev","event_type":"change.updated"}`), signInbox(secret, []byte(`{"event_id":"evt-2","external_id":"chg-9","revision":1,"project_id":11,"environment":"dev","event_type":"change.updated"}`)))
	if cross.Code != http.StatusForbidden || saves != 0 {
		t.Fatalf("cross scope status %d saves %d", cross.Code, saves)
	}

	loadConnectionByID = func(id int) (connectionContract, error) {
		if id != 4 {
			return connectionContract{}, errConnectionHidden
		}
		return connectionContract{ID: 4, ProjectID: 10, Environment: "dev", Disabled: true}, nil
	}
	disabled := postInbox(t, body, signInbox(secret, body))
	if disabled.Code != http.StatusConflict || saves != 0 {
		t.Fatalf("disabled status %d saves %d", disabled.Code, saves)
	}
}

func TestWebhookInboxAcknowledgesOnlyADurableWrite(t *testing.T) {
	secret := "inbox-test-secret"
	restore := stubInbox(secret, func(inboxReceipt) (inboxAcceptView, error) {
		return inboxAcceptView{}, errInboxStored
	})
	defer restore()
	body := []byte(`{"event_id":"evt-1","external_id":"chg-9","revision":1,"project_id":10,"environment":"dev","event_type":"change.updated"}`)
	failed := postInbox(t, body, signInbox(secret, body))
	if failed.Code != http.StatusServiceUnavailable || strings.Contains(failed.Body.String(), `"accepted":true`) || strings.Contains(failed.Body.String(), secret) {
		t.Fatalf("failed store status %d body %s", failed.Code, failed.Body.String())
	}

	inboxRateLimit = 1
	inboxHitsMu.Lock()
	inboxHits = map[int][]time.Time{}
	inboxHitsMu.Unlock()
	saves := 0
	saveInboxReceipt = func(receipt inboxReceipt) (inboxAcceptView, error) {
		saves++
		return inboxAcceptView{InboxID: 1, RecordID: 2, ProjectID: receipt.ProjectID, EventID: receipt.EventID, ExternalID: receipt.ExternalID, Revision: receipt.Revision, Attempts: 1}, nil
	}
	first := postInbox(t, body, signInbox(secret, body))
	second := postInbox(t, body, signInbox(secret, body))
	if first.Code != http.StatusAccepted || !strings.Contains(first.Body.String(), `"accepted":true`) || second.Code != http.StatusTooManyRequests || saves != 1 {
		t.Fatalf("rate first %d second %d saves %d", first.Code, second.Code, saves)
	}

	oversized := bytesOf(webhookInboxMaxBytes + 1)
	large := postInbox(t, oversized, signInbox(secret, oversized))
	if large.Code != http.StatusRequestEntityTooLarge || saves != 1 {
		t.Fatalf("large status %d saves %d", large.Code, saves)
	}
}

func TestWebhookIdempotencyKeepsOneRecord(t *testing.T) {
	secret := "inbox-test-secret"
	mem := newInboxMem()
	var effects atomic.Int32
	previousNotify := notifyInboxApplied
	notifyInboxApplied = func(inboxReceipt) error {
		effects.Add(1)
		return nil
	}
	restore := stubInbox(secret, mem.save)
	defer func() {
		restore()
		notifyInboxApplied = previousNotify
	}()

	body := inboxBody("evt-1", "chg-9", 1, 10)
	var first, second inboxAcceptView
	var err1, err2 error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		first, err1 = acceptWebhookInbox(4, body, signInbox("inbox-test-secret", body), time.Now().UTC())
	}()
	go func() {
		defer wg.Done()
		second, err2 = acceptWebhookInbox(4, body, signInbox("inbox-test-secret", body), time.Now().UTC())
	}()
	wg.Wait()
	if err1 != nil || err2 != nil || !first.Accepted || !second.Accepted {
		t.Fatalf("concurrent err1=%v err2=%v first=%+v second=%+v", err1, err2, first, second)
	}
	if effects.Load() != 1 || mem.recordCount() != 1 || mem.eventCount() != 1 {
		t.Fatalf("concurrent effects=%d records=%d events=%d", effects.Load(), mem.recordCount(), mem.eventCount())
	}
	if first.RecordID == 0 || first.RecordID != second.RecordID || first.InboxID != second.InboxID {
		t.Fatalf("concurrent views %+v %+v", first, second)
	}

	newer := mustAcceptInbox(t, inboxBody("evt-2", "chg-9", 3, 10))
	if newer.Stale || newer.Duplicate || newer.Revision != 3 || newer.RecordID != first.RecordID || effects.Load() != 2 || mem.recordCount() != 1 {
		t.Fatalf("newer = %+v effects=%d records=%d", newer, effects.Load(), mem.recordCount())
	}
	stale := mustAcceptInbox(t, inboxBody("evt-3", "chg-9", 2, 10))
	if !stale.Stale || stale.Revision != 3 || stale.RecordID != first.RecordID || effects.Load() != 2 || !mem.sawStale() {
		t.Fatalf("stale = %+v effects=%d audits=%v", stale, effects.Load(), mem.audits)
	}
}

func stubInbox(secret string, save func(inboxReceipt) (inboxAcceptView, error)) func() {
	previousLoad := loadConnectionByID
	previousResolve := resolveInboxSecret
	previousSave := saveInboxReceipt
	previousLimit := inboxRateLimit
	inboxHitsMu.Lock()
	inboxHits = map[int][]time.Time{}
	inboxHitsMu.Unlock()
	loadConnectionByID = func(id int) (connectionContract, error) {
		if id != 4 {
			return connectionContract{}, errConnectionHidden
		}
		return connectionContract{ID: 4, ProjectID: 10, Environment: "dev", SecretRef: "projects.10.github"}, nil
	}
	resolveInboxSecret = func(connectionContract) (string, error) {
		return secret, nil
	}
	saveInboxReceipt = save
	return func() {
		loadConnectionByID = previousLoad
		resolveInboxSecret = previousResolve
		saveInboxReceipt = previousSave
		inboxRateLimit = previousLimit
		inboxHitsMu.Lock()
		inboxHits = map[int][]time.Time{}
		inboxHitsMu.Unlock()
	}
}

func postInbox(t *testing.T, body []byte, signature string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/webhooks/inbox/4", strings.NewReader(string(body)))
	req.Header.Set("X-Webhook-Signature", signature)
	rec := httptest.NewRecorder()
	webhookInboxHandler(rec, req)
	return rec
}

func signInbox(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func inboxBody(eventID, externalID string, revision, projectID int) []byte {
	return []byte(strings.NewReplacer(
		"EVT", eventID,
		"EXT", externalID,
		"REV", strconv.Itoa(revision),
		"PROJ", strconv.Itoa(projectID),
	).Replace(`{"event_id":"EVT","external_id":"EXT","revision":REV,"project_id":PROJ,"environment":"dev","event_type":"change.updated"}`))
}

func mustAcceptInbox(t *testing.T, body []byte) inboxAcceptView {
	t.Helper()
	view, err := acceptWebhookInbox(4, body, signInbox("inbox-test-secret", body), time.Now().UTC())
	if err != nil || !view.Accepted {
		t.Fatalf("accept err=%v view=%+v", err, view)
	}
	return view
}

type inboxMem struct {
	mu      sync.Mutex
	events  map[string]inboxAcceptView
	records map[string]inboxMemRecord
	audits  []string
	seq     int
}

type inboxMemRecord struct {
	id  int
	rev int
}

func newInboxMem() *inboxMem {
	return &inboxMem{events: map[string]inboxAcceptView{}, records: map[string]inboxMemRecord{}}
}

func (m *inboxMem) save(receipt inboxReceipt) (inboxAcceptView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	eventKey := receipt.EventID
	if existing, ok := m.events[eventKey]; ok {
		existing.Attempts++
		existing.Duplicate = true
		m.events[eventKey] = existing
		return existing, nil
	}
	record, exists := m.records[receipt.ExternalID]
	current := 0
	if exists {
		current = record.rev
	}
	m.seq++
	view := inboxAcceptView{InboxID: m.seq, ProjectID: receipt.ProjectID, EventID: receipt.EventID, ExternalID: receipt.ExternalID, Attempts: 1}
	if inboxRevisionApplies(exists, current, receipt.Revision) {
		if err := notifyInboxApplied(receipt); err != nil {
			return inboxAcceptView{}, err
		}
		if !exists {
			m.seq++
			record = inboxMemRecord{id: m.seq, rev: receipt.Revision}
		} else {
			record.rev = receipt.Revision
		}
		m.records[receipt.ExternalID] = record
		view.RecordID = record.id
		view.Revision = receipt.Revision
		m.audits = append(m.audits, "applied")
	} else {
		view.RecordID = record.id
		view.Revision = current
		view.Stale = true
		m.audits = append(m.audits, "stale")
	}
	m.events[eventKey] = view
	return view, nil
}

func (m *inboxMem) recordCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.records)
}

func (m *inboxMem) eventCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

func (m *inboxMem) sawStale() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, audit := range m.audits {
		if audit == "stale" {
			return true
		}
	}
	return false
}

func bytesOf(n int) []byte {
	return []byte(strings.Repeat("x", n))
}
