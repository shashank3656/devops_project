package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDuplicateOutboxEventCreatesNoSecondRecord(t *testing.T) {
	store := []outboxPair{}
	previousSave := saveOutboxPair
	previousID := newEnvelopeID
	previousSubject := catalogSubjectFromRequest
	defer func() {
		saveOutboxPair = previousSave
		newEnvelopeID = previousID
		catalogSubjectFromRequest = previousSubject
	}()
	ids := []string{"evt_first", "evt_second"}
	newEnvelopeID = func() (string, error) {
		id := ids[0]
		ids = ids[1:]
		return id, nil
	}
	saveOutboxPair = func(pair outboxPair) (outboxPair, bool, error) {
		for _, existing := range store {
			if existing.Record.ProjectID == pair.Record.ProjectID && existing.Record.IdempotencyKey == pair.Record.IdempotencyKey {
				return existing, true, nil
			}
		}
		pair.Record.ID = len(store) + 1
		pair.Event.RecordID = pair.Record.ID
		store = append(store, pair)
		return pair, false, nil
	}
	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return outboxGrant(10, "operator"), nil
	}
	body := `{"project_id":10,"environment":"dev","name":"link service","event_type":"catalog.service.linked","idempotency_key":"evt-1","correlation_id":"corr-1","payload":{"service":"payments"}}`

	firstRec := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodPost, "/api/outbox/events", strings.NewReader(body))
	outboxEventsHandler(firstRec, firstReq)
	if firstRec.Code != http.StatusCreated {
		t.Fatalf("create status %d body %s", firstRec.Code, firstRec.Body.String())
	}

	secondRec := httptest.NewRecorder()
	secondReq := httptest.NewRequest(http.MethodPost, "/api/outbox/events", strings.NewReader(strings.ReplaceAll(body, "payments", "billing")))
	outboxEventsHandler(secondRec, secondReq)
	secondBody := secondRec.Body.String()
	if secondRec.Code != http.StatusOK || len(store) != 1 {
		t.Fatalf("duplicate status %d records %d body %s", secondRec.Code, len(store), secondBody)
	}
	if !strings.Contains(secondBody, `"duplicate":true`) || !strings.Contains(secondBody, `"id":"evt_first"`) || strings.Contains(secondBody, "evt_second") {
		t.Fatalf("duplicate replaced the envelope: %s", secondBody)
	}
	if !strings.Contains(secondBody, `"version":1`) || !strings.Contains(secondBody, `"correlation_id":"corr-1"`) || strings.Contains(secondBody, "billing") {
		t.Fatalf("envelope or original record changed: %s", secondBody)
	}
	if store[0].Record.Name != "link service" || store[0].Event.Version != eventEnvelopeVersion {
		t.Fatalf("stored pair = %+v", store[0])
	}
}

func TestOutboxWriteRequiresProjectScope(t *testing.T) {
	saves := 0
	previousSave := saveOutboxPair
	previousSubject := catalogSubjectFromRequest
	defer func() {
		saveOutboxPair = previousSave
		catalogSubjectFromRequest = previousSubject
	}()
	saveOutboxPair = func(pair outboxPair) (outboxPair, bool, error) {
		saves++
		pair.Record.ID = 1
		pair.Event.RecordID = 1
		return pair, false, nil
	}
	body := `{"project_id":10,"name":"link service","event_type":"catalog.service.linked","idempotency_key":"evt-1","correlation_id":"corr-1"}`

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return outboxGrant(11, "operator"), nil
	}
	hidden := httptest.NewRecorder()
	outboxEventsHandler(hidden, httptest.NewRequest(http.MethodPost, "/api/outbox/events", strings.NewReader(body)))
	if hidden.Code != http.StatusNotFound || saves != 0 || strings.Contains(hidden.Body.String(), "link service") {
		t.Fatalf("hidden status %d saves %d body %s", hidden.Code, saves, hidden.Body.String())
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return outboxGrant(10, "viewer"), nil
	}
	denied := httptest.NewRecorder()
	outboxEventsHandler(denied, httptest.NewRequest(http.MethodPost, "/api/outbox/events", strings.NewReader(body)))
	if denied.Code != http.StatusForbidden || saves != 0 {
		t.Fatalf("viewer status %d saves %d", denied.Code, saves)
	}
}

func TestOutboxSaveFailureLeavesNoRecord(t *testing.T) {
	previousSave := saveOutboxPair
	defer func() { saveOutboxPair = previousSave }()
	saveOutboxPair = func(outboxPair) (outboxPair, bool, error) {
		return outboxPair{}, false, errors.New("outbox write failed")
	}
	_, err := acceptOutboxEvent(outboxGrant(10, "operator"), outboxInput{
		ProjectID: 10, Name: "link service", EventType: "catalog.service.linked",
		IdempotencyKey: "evt-1", CorrelationID: "corr-1",
	}, time.Now().UTC())
	if err == nil || !strings.Contains(err.Error(), "outbox write failed") {
		t.Fatalf("err = %v", err)
	}
}

func outboxGrant(projectID int, role string) authzSubject {
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
