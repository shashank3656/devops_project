package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	errTriageHidden  = errors.New("finding assignment not found")
	errTriageDenied  = errors.New("finding assignment is not permitted")
	errTriageInvalid = errors.New("finding assignment is invalid")
	triageClock      = func() time.Time { return time.Now().UTC() }
)

type serviceOwner struct {
	ProjectID int
	ServiceID int
	Team      string
	Verified  bool
}

type findingAssignment struct {
	ID             int                      `json:"id"`
	ProjectID      int                      `json:"project_id"`
	FindingKey     string                   `json:"finding_key"`
	ServiceID      int                      `json:"service_id"`
	OwnerTeam      string                   `json:"owner_team"`
	State          string                   `json:"state"`
	Severity       string                   `json:"severity"`
	DueAt          time.Time                `json:"due_at,omitempty"`
	PriorityReason string                   `json:"priority_reason"`
	History        []findingAssignmentEvent `json:"history"`
}

type findingAssignmentEvent struct {
	ID            int       `json:"id"`
	AssignmentID  int       `json:"assignment_id"`
	Action        string    `json:"action"`
	PreviousOwner string    `json:"previous_owner"`
	NextOwner     string    `json:"next_owner"`
	PreviousDue   time.Time `json:"previous_due,omitempty"`
	NextDue       time.Time `json:"next_due,omitempty"`
	ActorUserID   int       `json:"actor_user_id"`
}

type triageAuditRecord struct {
	ProjectID   int
	FindingKey  string
	ActorUserID int
	Summary     string
}

var (
	saveFindingAssignment   = saveFindingAssignmentToDB
	findFindingAssignment   = findFindingAssignmentFromDB
	loadFindingAssignment   = loadFindingAssignmentFromDB
	updateFindingAssignment = updateFindingAssignmentInDB
	insertAssignmentEvent   = insertAssignmentEventToDB
	listAssignmentEvents    = listAssignmentEventsFromDB
	listTriageAssignments   = listTriageAssignmentsFromDB
	saveTriageAudit         = saveTriageAuditToDB
	loadServiceOwner        = loadServiceOwnerFromDB
)

func slaWindow(severity string) (time.Duration, bool) {
	switch strings.ToLower(strings.TrimSpace(severity)) {
	case "critical":
		return 24 * time.Hour, true
	case "high":
		return 72 * time.Hour, true
	case "medium":
		return 168 * time.Hour, true
	case "low":
		return 336 * time.Hour, true
	default:
		return 0, false
	}
}

func recordFindingAssignment(actor authzSubject, projectID, serviceID int, findingKey, severity string) (findingAssignment, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return findingAssignment{}, errTriageHidden
	}
	if !mappingAllowed(actor, projectID, authzWrite) {
		return findingAssignment{}, errTriageDenied
	}
	findingKey = strings.TrimSpace(findingKey)
	severity = strings.ToLower(strings.TrimSpace(severity))
	if findingKey == "" || strings.Contains(findingKey, " ") || strings.Contains(findingKey, "\n") || len(findingKey) > 128 {
		return findingAssignment{}, errTriageInvalid
	}
	if severity != "" && severityRank(severity) == 0 {
		return findingAssignment{}, errTriageInvalid
	}
	existing, err := findFindingAssignment(projectID, findingKey)
	if err != nil {
		return findingAssignment{}, err
	}
	if existing.ID > 0 {
		return presentFindingAssignment(existing)
	}
	ownerTeam := ""
	state := "triage"
	if serviceID > 0 {
		owner, err := loadServiceOwner(serviceID)
		if err != nil {
			return findingAssignment{}, err
		}
		if owner.ServiceID > 0 && owner.ProjectID != projectID {
			return findingAssignment{}, errTriageHidden
		}
		if owner.ServiceID > 0 && owner.ProjectID == projectID && owner.Verified && strings.TrimSpace(owner.Team) != "" {
			ownerTeam = strings.TrimSpace(owner.Team)
			state = "assigned"
		}
	}
	dueAt := time.Time{}
	if window, ok := slaWindow(severity); ok {
		dueAt = triageClock().Add(window)
	}
	saved, err := saveFindingAssignment(findingAssignment{
		ProjectID: projectID, FindingKey: findingKey, ServiceID: serviceID, OwnerTeam: ownerTeam,
		State: state, Severity: severity, DueAt: dueAt,
	})
	if err != nil {
		return findingAssignment{}, err
	}
	action := "triage"
	if state == "assigned" {
		action = "assigned"
	}
	event, err := insertAssignmentEvent(findingAssignmentEvent{
		AssignmentID: saved.ID, Action: action, NextOwner: ownerTeam, NextDue: dueAt, ActorUserID: actor.UserID,
	})
	if err != nil {
		return findingAssignment{}, err
	}
	saved.History = []findingAssignmentEvent{event}
	return presentFindingAssignment(saved)
}

func reassignFinding(actor authzSubject, assignmentID int, team string) (findingAssignment, error) {
	current, err := loadFindingAssignment(assignmentID)
	if err != nil || current.ID <= 0 {
		return findingAssignment{}, errTriageHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return findingAssignment{}, errTriageHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return findingAssignment{}, errTriageDenied
	}
	if current.ServiceID <= 0 {
		return findingAssignment{}, errTriageInvalid
	}
	team = strings.TrimSpace(team)
	if strings.Contains(team, "\n") || len(team) > 120 {
		return findingAssignment{}, errTriageInvalid
	}
	state := "assigned"
	action := "reassigned"
	if team == "" {
		state = "triage"
		action = "triage"
	}
	if current.OwnerTeam == team && current.State == state {
		return presentFindingAssignment(current)
	}
	previous := current.OwnerTeam
	current.OwnerTeam = team
	current.State = state
	if _, err := updateFindingAssignment(current); err != nil {
		return findingAssignment{}, err
	}
	event, err := insertAssignmentEvent(findingAssignmentEvent{
		AssignmentID: current.ID, Action: action, PreviousOwner: previous, NextOwner: team,
		PreviousDue: current.DueAt, NextDue: current.DueAt, ActorUserID: actor.UserID,
	})
	if err != nil {
		return findingAssignment{}, err
	}
	current.History = nil
	presented, err := presentFindingAssignment(current)
	if err != nil {
		return findingAssignment{}, err
	}
	if len(presented.History) == 0 {
		presented.History = []findingAssignmentEvent{event}
	}
	return presented, nil
}

func changeFindingDue(actor authzSubject, assignmentID int, dueAt time.Time) (findingAssignment, error) {
	current, err := loadFindingAssignment(assignmentID)
	if err != nil || current.ID <= 0 {
		return findingAssignment{}, errTriageHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzRead) {
		return findingAssignment{}, errTriageHidden
	}
	if !mappingAllowed(actor, current.ProjectID, authzWrite) {
		return findingAssignment{}, errTriageDenied
	}
	if dueAt.IsZero() || !dueAt.After(triageClock()) {
		return findingAssignment{}, errTriageInvalid
	}
	dueAt = dueAt.UTC()
	if !current.DueAt.IsZero() && current.DueAt.UTC().Equal(dueAt) {
		return presentFindingAssignment(current)
	}
	previous := current.DueAt
	current.DueAt = dueAt
	if _, err := updateFindingAssignment(current); err != nil {
		return findingAssignment{}, err
	}
	if _, err := insertAssignmentEvent(findingAssignmentEvent{
		AssignmentID: current.ID, Action: "due_date", PreviousOwner: current.OwnerTeam, NextOwner: current.OwnerTeam,
		PreviousDue: previous, NextDue: dueAt, ActorUserID: actor.UserID,
	}); err != nil {
		return findingAssignment{}, err
	}
	if err := saveTriageAudit(triageAuditRecord{
		ProjectID: current.ProjectID, FindingKey: current.FindingKey, ActorUserID: actor.UserID,
		Summary: fmt.Sprintf("due %s to %s", formatTriageDue(previous), formatTriageDue(dueAt)),
	}); err != nil {
		return findingAssignment{}, err
	}
	current.History = nil
	return presentFindingAssignment(current)
}

func triageQueue(actor authzSubject, projectID int) ([]findingAssignment, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return nil, errTriageHidden
	}
	items, err := listTriageAssignments(projectID)
	if err != nil {
		return nil, err
	}
	presented := make([]findingAssignment, 0, len(items))
	for _, item := range items {
		if item.State != "triage" || item.OwnerTeam != "" {
			continue
		}
		next, err := presentFindingAssignment(item)
		if err != nil {
			return nil, err
		}
		presented = append(presented, next)
	}
	sort.Slice(presented, func(i, j int) bool {
		if severityRank(presented[i].Severity) == severityRank(presented[j].Severity) {
			return presented[i].ID < presented[j].ID
		}
		return severityRank(presented[i].Severity) > severityRank(presented[j].Severity)
	})
	return presented, nil
}

func presentFindingAssignment(item findingAssignment) (findingAssignment, error) {
	if item.History == nil {
		history, err := listAssignmentEvents(item.ID)
		if err != nil {
			return findingAssignment{}, err
		}
		item.History = history
	}
	item.PriorityReason = findingPriorityReason(item)
	return item, nil
}

func findingPriorityReason(item findingAssignment) string {
	if item.State == "triage" && item.ServiceID <= 0 {
		return "unmapped finding stays in triage"
	}
	if item.State == "triage" || item.OwnerTeam == "" {
		return "owner is unknown"
	}
	if _, ok := slaWindow(item.Severity); !ok {
		return "severity is unknown"
	}
	hours := int(slaWindowMust(item.Severity).Hours())
	return fmt.Sprintf("severity %s is due within %dh", item.Severity, hours)
}

func slaWindowMust(severity string) time.Duration {
	window, _ := slaWindow(severity)
	return window
}

func formatTriageDue(value time.Time) string {
	if value.IsZero() {
		return "none"
	}
	return value.UTC().Format(time.RFC3339)
}

func migrateFindingTriageSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS finding_assignments (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			finding_key VARCHAR(128) NOT NULL,
			service_id INTEGER NOT NULL DEFAULT 0,
			owner_team VARCHAR(120) NOT NULL DEFAULT '',
			state VARCHAR(32) NOT NULL,
			severity VARCHAR(16) NOT NULL DEFAULT '',
			due_at TIMESTAMP NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, finding_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS finding_assignment_events (
			id SERIAL PRIMARY KEY,
			assignment_id INTEGER NOT NULL,
			action VARCHAR(32) NOT NULL,
			previous_owner VARCHAR(120) NOT NULL DEFAULT '',
			next_owner VARCHAR(120) NOT NULL DEFAULT '',
			previous_due TIMESTAMP NULL,
			next_due TIMESTAMP NULL,
			actor_user_id INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveFindingAssignmentToDB(item findingAssignment) (findingAssignment, error) {
	if DB == nil {
		return findingAssignment{}, errInboxStored
	}
	var due interface{}
	if !item.DueAt.IsZero() {
		due = item.DueAt.UTC()
	}
	err := DB.QueryRow(`
		INSERT INTO finding_assignments (project_id, finding_key, service_id, owner_team, state, severity, due_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
	`, item.ProjectID, item.FindingKey, item.ServiceID, item.OwnerTeam, item.State, item.Severity, due).Scan(&item.ID)
	return item, err
}

func findFindingAssignmentFromDB(projectID int, findingKey string) (findingAssignment, error) {
	if DB == nil {
		return findingAssignment{}, nil
	}
	item, err := scanFindingAssignment(`
		SELECT id, project_id, finding_key, service_id, owner_team, state, severity, due_at
		FROM finding_assignments WHERE project_id = $1 AND finding_key = $2
	`, projectID, findingKey)
	if err != nil {
		return findingAssignment{}, nil
	}
	return item, nil
}

func loadFindingAssignmentFromDB(id int) (findingAssignment, error) {
	if DB == nil || id <= 0 {
		return findingAssignment{}, errTriageHidden
	}
	item, err := scanFindingAssignment(`
		SELECT id, project_id, finding_key, service_id, owner_team, state, severity, due_at
		FROM finding_assignments WHERE id = $1
	`, id)
	if err != nil || item.ID <= 0 {
		return findingAssignment{}, errTriageHidden
	}
	return item, nil
}

func scanFindingAssignment(query string, args ...interface{}) (findingAssignment, error) {
	var item findingAssignment
	var due *time.Time
	err := DB.QueryRow(query, args...).Scan(&item.ID, &item.ProjectID, &item.FindingKey, &item.ServiceID, &item.OwnerTeam, &item.State, &item.Severity, &due)
	if err != nil {
		return findingAssignment{}, err
	}
	if due != nil {
		item.DueAt = due.UTC()
	}
	return item, nil
}

func updateFindingAssignmentInDB(item findingAssignment) (findingAssignment, error) {
	if DB == nil {
		return findingAssignment{}, errInboxStored
	}
	var due interface{}
	if !item.DueAt.IsZero() {
		due = item.DueAt.UTC()
	}
	_, err := DB.Exec(`
		UPDATE finding_assignments SET owner_team = $2, state = $3, due_at = $4 WHERE id = $1
	`, item.ID, item.OwnerTeam, item.State, due)
	return item, err
}

func insertAssignmentEventToDB(item findingAssignmentEvent) (findingAssignmentEvent, error) {
	if DB == nil {
		return findingAssignmentEvent{}, errInboxStored
	}
	var previous, next interface{}
	if !item.PreviousDue.IsZero() {
		previous = item.PreviousDue.UTC()
	}
	if !item.NextDue.IsZero() {
		next = item.NextDue.UTC()
	}
	err := DB.QueryRow(`
		INSERT INTO finding_assignment_events (assignment_id, action, previous_owner, next_owner, previous_due, next_due, actor_user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
	`, item.AssignmentID, item.Action, item.PreviousOwner, item.NextOwner, previous, next, item.ActorUserID).Scan(&item.ID)
	return item, err
}

func listAssignmentEventsFromDB(assignmentID int) ([]findingAssignmentEvent, error) {
	if DB == nil || assignmentID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, assignment_id, action, previous_owner, next_owner, previous_due, next_due, actor_user_id
		FROM finding_assignment_events WHERE assignment_id = $1 ORDER BY id
	`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []findingAssignmentEvent
	for rows.Next() {
		var item findingAssignmentEvent
		var previous, next *time.Time
		if err := rows.Scan(&item.ID, &item.AssignmentID, &item.Action, &item.PreviousOwner, &item.NextOwner, &previous, &next, &item.ActorUserID); err != nil {
			return nil, err
		}
		if previous != nil {
			item.PreviousDue = previous.UTC()
		}
		if next != nil {
			item.NextDue = next.UTC()
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listTriageAssignmentsFromDB(projectID int) ([]findingAssignment, error) {
	if DB == nil || projectID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, finding_key, service_id, owner_team, state, severity, due_at
		FROM finding_assignments WHERE project_id = $1 AND state = 'triage' ORDER BY id
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []findingAssignment
	for rows.Next() {
		var item findingAssignment
		var due *time.Time
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.FindingKey, &item.ServiceID, &item.OwnerTeam, &item.State, &item.Severity, &due); err != nil {
			return nil, err
		}
		if due != nil {
			item.DueAt = due.UTC()
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveTriageAuditToDB(item triageAuditRecord) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "finding_assignment",
		ResourceID: item.FindingKey, Action: "finding_due_date", Result: "success", Summary: item.Summary,
	})
	return nil
}

func loadServiceOwnerFromDB(serviceID int) (serviceOwner, error) {
	if DB == nil || serviceID <= 0 {
		return serviceOwner{}, nil
	}
	var item serviceOwner
	err := DB.QueryRow(`
		SELECT project_id, COALESCE(team, '')
		FROM service_map WHERE id = $1
	`, serviceID).Scan(&item.ProjectID, &item.Team)
	if err != nil {
		return serviceOwner{}, nil
	}
	item.ServiceID = serviceID
	item.Team = strings.TrimSpace(item.Team)
	item.Verified = item.Team != ""
	return item, nil
}

func findingAssignmentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ProjectID  int    `json:"project_id"`
		ServiceID  int    `json:"service_id"`
		FindingKey string `json:"finding_key"`
		Severity   string `json:"severity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeTriageError(w, r, errTriageInvalid)
		return
	}
	saved, err := recordFindingAssignment(actor, body.ProjectID, body.ServiceID, body.FindingKey, body.Severity)
	if err != nil {
		writeTriageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func findingReassignHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		AssignmentID int    `json:"assignment_id"`
		Team         string `json:"team"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeTriageError(w, r, errTriageInvalid)
		return
	}
	saved, err := reassignFinding(actor, body.AssignmentID, body.Team)
	if err != nil {
		writeTriageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func findingDueHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		AssignmentID int    `json:"assignment_id"`
		DueAt        string `json:"due_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeTriageError(w, r, errTriageInvalid)
		return
	}
	dueAt, err := time.Parse(time.RFC3339, strings.TrimSpace(body.DueAt))
	if err != nil {
		writeTriageError(w, r, errTriageInvalid)
		return
	}
	saved, err := changeFindingDue(actor, body.AssignmentID, dueAt)
	if err != nil {
		writeTriageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func findingTriageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	items, err := triageQueue(actor, projectID)
	if err != nil {
		writeTriageError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]interface{}{"project_id": projectID, "items": items})
}

func writeTriageError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errTriageHidden):
		writeAPIError(w, r, http.StatusNotFound, errTriageHidden.Error(), nil)
	case errors.Is(err, errTriageDenied):
		writeAPIError(w, r, http.StatusForbidden, errTriageDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errTriageInvalid.Error(), nil)
	}
}
