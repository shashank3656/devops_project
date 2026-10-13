package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"testing"
)

type mappingMem struct {
	mu       sync.Mutex
	versions map[string][]int
	active   map[string]webhookMapping
	targets  map[int]replayTarget
	records  int
	effects  int
	inserts  int
	rows     []webhookActivity
}

func (m *mappingMem) install() func() {
	previousLoad := loadMappingVersions
	previousInsert := insertMappingVersion
	previousTarget := loadReplayTarget
	previousCommit := commitReplay
	previousNote := noteReplay
	previousList := listActivityRows
	previousActive := activeWebhookMapping
	previousNotify := notifyInboxApplied
	loadMappingVersions = func(projectID int, alias string) []int {
		m.mu.Lock()
		defer m.mu.Unlock()
		return append([]int(nil), m.versions[mappingMemKey(projectID, alias)]...)
	}
	insertMappingVersion = func(item webhookMapping) (webhookMapping, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		m.inserts++
		item.ID = m.inserts
		item.Active = true
		key := mappingMemKey(item.ProjectID, item.Alias)
		m.versions[key] = append(m.versions[key], item.Version)
		m.active[key] = item
		return item, nil
	}
	activeWebhookMapping = func(projectID int, alias string) (webhookMapping, bool) {
		m.mu.Lock()
		defer m.mu.Unlock()
		item, ok := m.active[mappingMemKey(projectID, alias)]
		return item, ok && item.Active
	}
	loadReplayTarget = func(inboxID int) (replayTarget, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		target, ok := m.targets[inboxID]
		if !ok {
			return replayTarget{}, errMappingHidden
		}
		return target, nil
	}
	commitReplay = func(target replayTarget, mapping webhookMapping, actorID int, reason string) (replayResult, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if target.RecordID <= 0 {
			m.records++
			target.RecordID = m.records
		}
		target.ReplayApplied = true
		target.Approval = "pending"
		target.RecordRevision = target.Revision
		m.targets[target.ID] = target
		m.effects++
		return replayResult{
			InboxID: target.ID, RecordID: target.RecordID, ProjectID: target.ProjectID, EventID: target.EventID,
			ActorID: actorID, Reason: reason, MappingVersion: mapping.Version, ApprovalState: "pending",
		}, nil
	}
	noteReplay = func(target replayTarget, actorID int, reason string, version int, result string) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		if result == "applied" {
			m.effects++
		}
		_ = actorID
		_ = reason
		_ = version
		return nil
	}
	listActivityRows = func(projectID int, state string) ([]webhookActivity, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		return append([]webhookActivity(nil), m.rows...), nil
	}
	notifyInboxApplied = func(inboxReceipt) error { return nil }
	return func() {
		loadMappingVersions = previousLoad
		insertMappingVersion = previousInsert
		loadReplayTarget = previousTarget
		commitReplay = previousCommit
		noteReplay = previousNote
		listActivityRows = previousList
		activeWebhookMapping = previousActive
		notifyInboxApplied = previousNotify
	}
}

func mappingMemKey(projectID int, alias string) string {
	return strconv.Itoa(projectID) + ":" + alias
}

func mappingOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func mappingViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func TestMappingPreviewHasNoEffects(t *testing.T) {
	mem := &mappingMem{versions: map[string][]int{}, active: map[string]webhookMapping{}, targets: map[int]replayTarget{}}
	restore := mem.install()
	defer restore()
	preview, err := previewWebhookMapping(mappingOperator(), 10, "billing-api", 7)
	if err != nil || !preview.DryRun || preview.Effects != 0 || preview.NextVersion != 1 || mem.inserts != 0 || mem.effects != 0 {
		t.Fatalf("preview %+v err %v inserts %d effects %d", preview, err, mem.inserts, mem.effects)
	}
	if _, err := previewWebhookMapping(mappingOperator(), 11, "billing-api", 7); err != errMappingHidden || mem.inserts != 0 {
		t.Fatalf("other project err %v inserts %d", err, mem.inserts)
	}
	if _, err := activateWebhookMapping(mappingViewer(), 10, "billing-api", 7); err != errMappingDenied || mem.inserts != 0 {
		t.Fatalf("viewer activate err %v inserts %d", err, mem.inserts)
	}
}

func TestMappingReplayAppliesOnceAndStaysPending(t *testing.T) {
	mem := &mappingMem{
		versions: map[string][]int{},
		active:   map[string]webhookMapping{},
		targets: map[int]replayTarget{
			8: {ID: 8, ProjectID: 10, Revision: 3, EventID: "evt-8", ExternalID: "chg-8", Alias: "billing-api"},
		},
	}
	restore := mem.install()
	defer restore()
	held, err := replayWebhookEvent(mappingOperator(), 8, "repair the alias")
	if err != nil || !held.Quarantined || mem.records != 0 || mem.effects != 0 {
		t.Fatalf("unmapped replay %+v err %v records %d effects %d", held, err, mem.records, mem.effects)
	}
	activated, err := activateWebhookMapping(mappingOperator(), 10, "billing-api", 7)
	if err != nil || activated.Version != 1 || !activated.Active || mem.effects != 0 {
		t.Fatalf("activate %+v err %v effects %d", activated, err, mem.effects)
	}
	first, err := replayWebhookEvent(mappingOperator(), 8, "repair the alias")
	if err != nil || first.Duplicate || first.RecordID != 1 || first.ActorID != 4 || first.Reason != "repair the alias" || first.MappingVersion != 1 || first.ApprovalState != "pending" || mem.effects != 1 || mem.records != 1 {
		t.Fatalf("first replay %+v err %v effects %d records %d", first, err, mem.effects, mem.records)
	}
	second, err := replayWebhookEvent(mappingOperator(), 8, "repair the alias")
	if err != nil || !second.Duplicate || second.RecordID != 1 || second.ApprovalState != "pending" || mem.effects != 1 || mem.records != 1 {
		t.Fatalf("second replay %+v err %v effects %d records %d", second, err, mem.effects, mem.records)
	}
	mem.targets[12] = replayTarget{ID: 12, ProjectID: 10, Revision: 3, RecordID: 1, RecordRevision: 3, MappingVersion: 1, EventID: "evt-12", ExternalID: "chg-8", Alias: "billing-api", Approval: "pending"}
	again, err := replayWebhookEvent(mappingOperator(), 12, "repair the alias")
	if err != nil || !again.Duplicate || again.ApprovalState != "pending" || mem.effects != 1 || mem.records != 1 {
		t.Fatalf("already mapped replay %+v err %v effects %d", again, err, mem.effects)
	}
	if _, err := replayWebhookEvent(mappingViewer(), 8, "repair the alias"); err != errMappingDenied || mem.effects != 1 {
		t.Fatalf("viewer replay err %v effects %d", err, mem.effects)
	}
	if _, err := replayWebhookEvent(mappingOperator(), 8, "  "); err != errMappingInvalid || mem.effects != 1 {
		t.Fatalf("blank reason err %v effects %d", err, mem.effects)
	}
}

func TestStaleReplayDoesNotReplaceNewerRevision(t *testing.T) {
	mem := &mappingMem{
		versions: map[string][]int{"10:billing-api": {1}},
		active:   map[string]webhookMapping{"10:billing-api": {ID: 1, ProjectID: 10, Alias: "billing-api", ServiceID: 7, Version: 1, Active: true}},
		targets: map[int]replayTarget{
			9: {ID: 9, ProjectID: 10, Revision: 2, RecordID: 4, RecordRevision: 5, EventID: "evt-old", ExternalID: "chg-8", Alias: "billing-api", Approval: "pending"},
		},
	}
	restore := mem.install()
	defer restore()
	result, err := replayWebhookEvent(mappingOperator(), 9, "retry an older event")
	if err != nil || !result.Stale || result.ApprovalState != "pending" || mem.effects != 0 || mem.targets[9].RecordRevision != 5 {
		t.Fatalf("stale %+v err %v effects %d revision %d", result, err, mem.effects, mem.targets[9].RecordRevision)
	}
}

func TestWebhookActivityIsScopedAndRedacted(t *testing.T) {
	secret := "raw-secret-payload"
	mem := &mappingMem{
		versions: map[string][]int{},
		active:   map[string]webhookMapping{},
		targets:  map[int]replayTarget{},
		rows: []webhookActivity{
			{InboxID: 1, ProjectID: 10, EventID: "evt-1", ExternalID: "chg-1", ReceivedAt: "2026-10-13T12:00:00Z", ProcessingState: "quarantined", ServiceAlias: "billing-api"},
			{InboxID: 2, ProjectID: 11, EventID: "evt-2", ExternalID: "chg-2", ReceivedAt: "2026-10-13T12:01:00Z", ProcessingState: "quarantined", ServiceAlias: "other"},
		},
	}
	restore := mem.install()
	defer restore()
	items, err := listWebhookActivity(mappingViewer(), 10, "quarantined")
	encoded, _ := json.Marshal(items)
	if err != nil || len(items) != 1 || items[0].ProjectID != 10 || items[0].CanReplay || items[0].ReceivedAt == "" || strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "payload") {
		t.Fatalf("activity %+v err %v body %s", items, err, encoded)
	}
	operatorItems, err := listWebhookActivity(mappingOperator(), 10, "quarantined")
	if err != nil || len(operatorItems) != 1 || !operatorItems[0].CanReplay {
		t.Fatalf("operator activity %+v err %v", operatorItems, err)
	}
	_ = secret
}
