package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	errMonitorHidden  = errors.New("monitor hidden")
	errMonitorDenied  = errors.New("monitor denied")
	errMonitorInvalid = errors.New("monitor invalid")
)

type changeEvent struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	EventKey    string `json:"event_key"`
	Identity    string `json:"identity"`
	Resource    string `json:"resource"`
	Revision    int    `json:"revision"`
	State       string `json:"state"`
	Observed    string `json:"observed"`
	Suspected   bool   `json:"suspected"`
	Verified    bool   `json:"verified"`
	WorkCount   int    `json:"work_count"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

type changeRescan struct {
	ID       int    `json:"id"`
	EventID  int    `json:"event_id"`
	State    string `json:"state"`
	Coverage string `json:"coverage"`
	Applied  bool   `json:"applied"`
}

var (
	findChangeEvent    = findChangeEventFromDB
	saveChangeEvent    = saveChangeEventToDB
	loadChangeEvent    = loadChangeEventFromDB
	updateChangeEvent  = updateChangeEventToDB
	listChangeEvents   = listChangeEventsFromDB
	findChangeRescan   = findChangeRescanFromDB
	saveChangeRescan   = saveChangeRescanToDB
	updateChangeRescan = updateChangeRescanToDB
	saveMonitorAudit   = saveMonitorAuditToDB
)

func recordChangeEvent(actor authzSubject, projectID int, environment, eventKey, identity, resource string, revision int, authenticated bool) (changeEvent, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	eventKey = strings.TrimSpace(eventKey)
	identity = strings.TrimSpace(identity)
	resource = strings.TrimSpace(resource)
	if !authenticated || !monitorToken(eventKey) || !monitorToken(identity) || !monitorToken(resource) || revision <= 0 || pilotSensitive(eventKey+" "+identity+" "+resource) {
		return changeEvent{}, errMonitorInvalid
	}
	if err := monitorAccess(actor, projectID, environment, true); err != nil {
		return changeEvent{}, err
	}
	current, err := findChangeEvent(projectID, environment, eventKey)
	if err != nil {
		return changeEvent{}, err
	}
	if current.ID > 0 && (current.Verified || current.Revision >= revision) && current.State != "unknown" {
		current.Applied = false
		if current.Revision > revision {
			current.Reason = "older revision"
		}
		return current, nil
	}
	item := changeEvent{ProjectID: projectID, Environment: environment, EventKey: eventKey, Identity: identity, Resource: resource, Revision: revision, State: "suspected", Observed: "unknown", Suspected: true, WorkCount: 1}
	if current.ID > 0 {
		item.ID = current.ID
		item.Verified = current.Verified
		saved, err := updateChangeEvent(item)
		if err != nil {
			return changeEvent{}, err
		}
		if _, err := ensureChangeRescan(saved.ID); err != nil {
			return changeEvent{}, err
		}
		return saved, nil
	}
	saved, err := saveChangeEvent(item)
	if err != nil {
		return changeEvent{}, err
	}
	if _, err := ensureChangeRescan(saved.ID); err != nil {
		return changeEvent{}, err
	}
	_ = saveMonitorAudit(projectID, eventKey, actor.UserID, "change event recorded")
	return saved, nil
}

func reconcileChangeScan(actor authzSubject, projectID int, environment, eventKey string, seen bool) (changeEvent, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	eventKey = strings.TrimSpace(eventKey)
	if !monitorToken(eventKey) || pilotSensitive(eventKey) {
		return changeEvent{}, errMonitorInvalid
	}
	if err := monitorAccess(actor, projectID, environment, true); err != nil {
		return changeEvent{}, err
	}
	current, err := findChangeEvent(projectID, environment, eventKey)
	if err != nil {
		return changeEvent{}, err
	}
	if current.ID == 0 {
		if seen {
			return changeEvent{}, errMonitorInvalid
		}
		item := changeEvent{ProjectID: projectID, Environment: environment, EventKey: eventKey, State: "unknown", Observed: "unknown", Reason: "delivery loss"}
		saved, err := saveChangeEvent(item)
		if err != nil {
			return changeEvent{}, err
		}
		_ = saveMonitorAudit(projectID, eventKey, actor.UserID, "change delivery loss recorded")
		return saved, nil
	}
	if !seen {
		if current.Reason == "delivery loss" {
			current.Applied = false
			return current, nil
		}
		current.Observed = "unknown"
		current.Reason = "delivery loss"
		current.Applied = true
		return updateChangeEvent(current)
	}
	rescan, err := findChangeRescan(current.ID)
	if err != nil {
		return changeEvent{}, err
	}
	if rescan.ID == 0 || current.State == "unknown" {
		return changeEvent{}, errMonitorInvalid
	}
	if rescan.State == "reconciled" {
		current.Applied = false
		return current, nil
	}
	rescan.State = "reconciled"
	rescan.Coverage = "partial"
	if _, err := updateChangeRescan(rescan); err != nil {
		return changeEvent{}, err
	}
	current.Applied = true
	current.Suspected = !current.Verified
	return current, nil
}

func verifyChangeEvent(actor authzSubject, eventID, reviewerID int) (changeEvent, error) {
	item, err := loadChangeEvent(eventID)
	if err != nil || item.ID == 0 {
		return changeEvent{}, errMonitorHidden
	}
	if err := monitorAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return changeEvent{}, err
	}
	rescan, err := findChangeRescan(item.ID)
	if err != nil {
		return changeEvent{}, err
	}
	if reviewerID <= 0 || reviewerID == actor.UserID || rescan.Coverage != "partial" || item.State == "unknown" {
		return changeEvent{}, errMonitorInvalid
	}
	if item.Verified {
		item.Applied = false
		return item, nil
	}
	item.Verified = true
	item.Suspected = false
	item.State = "verified"
	item.Applied = true
	return updateChangeEvent(item)
}

func readChangeEvents(actor authzSubject, projectID int, environment string) ([]changeEvent, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := monitorAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listChangeEvents(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []changeEvent{}
	}
	return items, nil
}

func ensureChangeRescan(eventID int) (changeRescan, error) {
	current, err := findChangeRescan(eventID)
	if err != nil || current.ID > 0 {
		if current.ID > 0 {
			current.Applied = false
		}
		return current, err
	}
	return saveChangeRescan(changeRescan{EventID: eventID, State: "scheduled", Coverage: "unknown"})
}

func monitorAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errMonitorInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errMonitorHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errMonitorDenied
	}
	return nil
}

func monitorToken(value string) bool {
	return incidentToken(value)
}

func migrateMonitorSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS change_events (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			event_key TEXT NOT NULL,
			identity_name TEXT NOT NULL DEFAULT '',
			resource_key TEXT NOT NULL DEFAULT '',
			revision INTEGER NOT NULL DEFAULT 0,
			state TEXT NOT NULL,
			observed TEXT NOT NULL,
			suspected BOOLEAN NOT NULL,
			verified BOOLEAN NOT NULL,
			work_count INTEGER NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, environment, event_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS change_rescans (
			id SERIAL PRIMARY KEY,
			event_id INTEGER NOT NULL UNIQUE,
			state TEXT NOT NULL,
			coverage TEXT NOT NULL
		)
	`)
}

func findChangeEventFromDB(projectID int, environment, eventKey string) (changeEvent, error) {
	if DB == nil {
		return changeEvent{}, errInboxStored
	}
	var item changeEvent
	err := DB.QueryRow(`SELECT id, project_id, environment, event_key, identity_name, resource_key, revision, state, observed, suspected, verified, work_count, reason FROM change_events WHERE project_id = $1 AND environment = $2 AND event_key = $3`, projectID, environment, eventKey).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.EventKey, &item.Identity, &item.Resource, &item.Revision, &item.State, &item.Observed, &item.Suspected, &item.Verified, &item.WorkCount, &item.Reason)
	if err != nil {
		return changeEvent{}, nil
	}
	return item, nil
}

func saveChangeEventToDB(item changeEvent) (changeEvent, error) {
	if DB == nil {
		return changeEvent{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO change_events (project_id, environment, event_key, identity_name, resource_key, revision, state, observed, suspected, verified, work_count, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, item.ProjectID, item.Environment, item.EventKey, item.Identity, item.Resource, item.Revision, item.State, item.Observed, item.Suspected, item.Verified, item.WorkCount, item.Reason).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func loadChangeEventFromDB(id int) (changeEvent, error) {
	if DB == nil {
		return changeEvent{}, errInboxStored
	}
	var item changeEvent
	err := DB.QueryRow(`SELECT id, project_id, environment, event_key, identity_name, resource_key, revision, state, observed, suspected, verified, work_count, reason FROM change_events WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.EventKey, &item.Identity, &item.Resource, &item.Revision, &item.State, &item.Observed, &item.Suspected, &item.Verified, &item.WorkCount, &item.Reason)
	if err != nil {
		return changeEvent{}, nil
	}
	return item, nil
}

func updateChangeEventToDB(item changeEvent) (changeEvent, error) {
	if DB == nil {
		return changeEvent{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE change_events SET identity_name = $2, resource_key = $3, revision = $4, state = $5, observed = $6, suspected = $7, verified = $8, work_count = $9, reason = $10 WHERE id = $1`, item.ID, item.Identity, item.Resource, item.Revision, item.State, item.Observed, item.Suspected, item.Verified, item.WorkCount, item.Reason)
	if !item.Applied {
		item.Applied = true
	}
	return item, err
}

func listChangeEventsFromDB(projectID int, environment string) ([]changeEvent, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, event_key, identity_name, resource_key, revision, state, observed, suspected, verified, work_count, reason FROM change_events WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []changeEvent
	for rows.Next() {
		var item changeEvent
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.EventKey, &item.Identity, &item.Resource, &item.Revision, &item.State, &item.Observed, &item.Suspected, &item.Verified, &item.WorkCount, &item.Reason); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func findChangeRescanFromDB(eventID int) (changeRescan, error) {
	if DB == nil {
		return changeRescan{}, errInboxStored
	}
	var item changeRescan
	err := DB.QueryRow(`SELECT id, event_id, state, coverage FROM change_rescans WHERE event_id = $1`, eventID).Scan(&item.ID, &item.EventID, &item.State, &item.Coverage)
	if err != nil {
		return changeRescan{}, nil
	}
	return item, nil
}

func saveChangeRescanToDB(item changeRescan) (changeRescan, error) {
	if DB == nil {
		return changeRescan{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO change_rescans (event_id, state, coverage) VALUES ($1,$2,$3) RETURNING id`, item.EventID, item.State, item.Coverage).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func updateChangeRescanToDB(item changeRescan) (changeRescan, error) {
	if DB == nil {
		return changeRescan{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE change_rescans SET state = $2, coverage = $3 WHERE id = $1`, item.ID, item.State, item.Coverage)
	item.Applied = true
	return item, err
}

func saveMonitorAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "change_event",
		ResourceID: resourceID, Action: "change_monitor", Result: "success", Summary: summary,
	})
	return nil
}

func changeEventHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeMonitorError(w, errMonitorHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeMonitorError(w, errMonitorInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readChangeEvents(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeMonitorError(w, err)
			return
		}
		writeMonitorJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	var body struct {
		ProjectID     int    `json:"project_id"`
		Environment   string `json:"environment"`
		EventKey      string `json:"event_key"`
		Identity      string `json:"identity"`
		Resource      string `json:"resource"`
		Revision      int    `json:"revision"`
		Authenticated bool   `json:"authenticated"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	item, err := recordChangeEvent(actor, body.ProjectID, body.Environment, body.EventKey, body.Identity, body.Resource, body.Revision, body.Authenticated)
	if err != nil {
		writeMonitorError(w, err)
		return
	}
	writeMonitorJSON(w, item)
}

func changeScanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeMonitorError(w, errMonitorHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		EventKey    string `json:"event_key"`
		Seen        bool   `json:"seen"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	item, err := reconcileChangeScan(actor, body.ProjectID, body.Environment, body.EventKey, body.Seen)
	if err != nil {
		writeMonitorError(w, err)
		return
	}
	writeMonitorJSON(w, item)
}

func changeVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeMonitorError(w, errMonitorHidden)
		return
	}
	var body struct {
		EventID    int `json:"event_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeMonitorError(w, errMonitorInvalid)
		return
	}
	item, err := verifyChangeEvent(actor, body.EventID, body.ReviewerID)
	if err != nil {
		writeMonitorError(w, err)
		return
	}
	writeMonitorJSON(w, item)
}

func writeMonitorJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeMonitorError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errMonitorHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errMonitorDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "monitor request failed"})
}
