package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errIncidentHidden  = errors.New("incident not found")
	errIncidentDenied  = errors.New("incident is not permitted")
	errIncidentInvalid = errors.New("incident is invalid")
)

type sreIncident struct {
	ID            int                `json:"id"`
	ProjectID     int                `json:"project_id"`
	Environment   string             `json:"environment"`
	Source        string             `json:"source"`
	Fingerprint   string             `json:"fingerprint"`
	Severity      string             `json:"severity"`
	Status        string             `json:"status"`
	Summary       string             `json:"summary"`
	OwnerTeam     string             `json:"owner_team"`
	Occurrences   int                `json:"occurrences"`
	ClosureReason string             `json:"closure_reason"`
	Timeline      []sreTimelineEntry `json:"timeline"`
	Runbooks      []sreRunbookLink   `json:"runbooks"`
	Review        *sreReviewDraft    `json:"review,omitempty"`
	FollowUps     []sreFollowUp      `json:"follow_ups"`
}

type sreTimelineEntry struct {
	ID            int    `json:"id"`
	IncidentID    int    `json:"incident_id"`
	EventKey      string `json:"event_key"`
	EvidenceKind  string `json:"evidence_kind"`
	EvidenceRef   string `json:"evidence_ref"`
	EvidenceState string `json:"evidence_state"`
	Note          string `json:"note"`
}

type sreRunbookLink struct {
	ID         int    `json:"id"`
	IncidentID int    `json:"incident_id"`
	Name       string `json:"name"`
	Reviewed   bool   `json:"reviewed"`
}

type sreReviewDraft struct {
	ID              int      `json:"id"`
	IncidentID      int      `json:"incident_id"`
	Body            string   `json:"body"`
	EvidenceRefs    []string `json:"evidence_refs"`
	SuspectedChange string   `json:"suspected_change"`
	ProvenCause     string   `json:"proven_cause"`
}

type sreFollowUp struct {
	ID         int    `json:"id"`
	IncidentID int    `json:"incident_id"`
	Title      string `json:"title"`
	OwnerTeam  string `json:"owner_team"`
	Status     string `json:"status"`
}

type sreIncidentInput struct {
	ProjectID   int
	Environment string
	Source      string
	Fingerprint string
	Severity    string
	Summary     string
	OwnerTeam   string
}

var (
	saveSREIncident      = saveSREIncidentToDB
	findSREIncident      = findSREIncidentFromDB
	loadSREIncident      = loadSREIncidentFromDB
	updateSREIncident    = updateSREIncidentInDB
	saveSRETimeline      = saveSRETimelineToDB
	findSRETimeline      = findSRETimelineFromDB
	listSRETimeline      = listSRETimelineFromDB
	saveSRERunbook       = saveSRERunbookToDB
	findSRERunbook       = findSRERunbookFromDB
	listSRERunbooks      = listSRERunbooksFromDB
	saveSREReview        = saveSREReviewToDB
	findSREReview        = findSREReviewFromDB
	saveSREFollowUp      = saveSREFollowUpToDB
	findSREFollowUp      = findSREFollowUpFromDB
	listSREFollowUps     = listSREFollowUpsFromDB
	saveSREIncidentAudit = saveSREIncidentAuditToDB
)

func recordSREIncident(actor authzSubject, input sreIncidentInput) (sreIncident, error) {
	item, err := normalizeSREIncident(input)
	if err != nil {
		return sreIncident{}, err
	}
	if err := authorizeSREIncident(actor, item.ProjectID, item.Environment, true); err != nil {
		return sreIncident{}, err
	}
	existing, err := findSREIncident(item.ProjectID, item.Source, item.Fingerprint)
	if err != nil {
		return sreIncident{}, err
	}
	if existing.ID > 0 {
		existing.Occurrences++
		if item.Summary != "" {
			existing.Summary = item.Summary
		}
		if existing.OwnerTeam == "" && item.OwnerTeam != "" {
			existing.OwnerTeam = item.OwnerTeam
		}
		updated, err := updateSREIncident(existing)
		if err != nil {
			return sreIncident{}, err
		}
		return presentSREIncident(updated)
	}
	item.Status = "open"
	item.Occurrences = 1
	item.Severity = incidentSeverity(input.Severity)
	saved, err := saveSREIncident(item)
	if err != nil {
		return sreIncident{}, err
	}
	_ = saveSREIncidentAudit(sreIncidentAudit{ProjectID: saved.ProjectID, Fingerprint: saved.Fingerprint, ActorUserID: actor.UserID, Summary: "incident recorded"})
	return presentSREIncident(saved)
}

func normalizeSREIncident(input sreIncidentInput) (sreIncident, error) {
	item := sreIncident{
		ProjectID:   input.ProjectID,
		Environment: strings.ToLower(strings.TrimSpace(input.Environment)),
		Source:      strings.ToLower(strings.TrimSpace(input.Source)),
		Fingerprint: strings.ToLower(strings.TrimSpace(input.Fingerprint)),
		Summary:     strings.TrimSpace(input.Summary),
		OwnerTeam:   strings.TrimSpace(input.OwnerTeam),
	}
	if item.ProjectID <= 0 || !singleEnvironment(item.Environment) || !incidentToken(item.Source) || !incidentToken(item.Fingerprint) {
		return sreIncident{}, errIncidentInvalid
	}
	if strings.EqualFold(item.Summary, "healthy") || len(item.Summary) > 500 {
		return sreIncident{}, errIncidentInvalid
	}
	if item.OwnerTeam != "" && !incidentToken(item.OwnerTeam) {
		return sreIncident{}, errIncidentInvalid
	}
	item.Severity = incidentSeverity(input.Severity)
	return item, nil
}

func incidentToken(value string) bool {
	return value != "" && !strings.ContainsAny(value, " \n,*") && len(value) <= 128 && !strings.EqualFold(value, "healthy")
}

func incidentSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low", "medium", "high", "critical":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "unknown"
	}
}

func authorizeSREIncident(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errIncidentHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errIncidentDenied
	}
	return nil
}

func appendSRETimeline(actor authzSubject, incidentID int, eventKey, kind, evidenceRef, evidenceState, note string) (sreTimelineEntry, error) {
	current, err := writableSREIncident(actor, incidentID)
	if err != nil {
		return sreTimelineEntry{}, err
	}
	entry := sreTimelineEntry{
		IncidentID:   current.ID,
		EventKey:     strings.ToLower(strings.TrimSpace(eventKey)),
		EvidenceKind: strings.ToLower(strings.TrimSpace(kind)),
		EvidenceRef:  strings.TrimSpace(evidenceRef),
		Note:         strings.TrimSpace(note),
	}
	if !incidentToken(entry.EventKey) || entry.EvidenceRef == "" || len(entry.EvidenceRef) > 200 || strings.EqualFold(entry.EvidenceRef, "healthy") {
		return sreTimelineEntry{}, errIncidentInvalid
	}
	switch entry.EvidenceKind {
	case "slo", "pod_failure", "runbook", "note":
	default:
		return sreTimelineEntry{}, errIncidentInvalid
	}
	switch strings.ToLower(strings.TrimSpace(evidenceState)) {
	case "recorded":
		entry.EvidenceState = "recorded"
	case "", "missing", "unknown", "stale", "partial":
		entry.EvidenceState = "unknown"
	default:
		return sreTimelineEntry{}, errIncidentInvalid
	}
	if strings.EqualFold(entry.Note, "healthy") || len(entry.Note) > 1000 {
		return sreTimelineEntry{}, errIncidentInvalid
	}
	existing, err := findSRETimeline(current.ID, entry.EventKey)
	if err != nil {
		return sreTimelineEntry{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	return saveSRETimeline(entry)
}

func linkSRERunbook(actor authzSubject, incidentID int, name string, reviewed bool) (sreRunbookLink, error) {
	current, err := writableSREIncident(actor, incidentID)
	if err != nil {
		return sreRunbookLink{}, err
	}
	link := sreRunbookLink{IncidentID: current.ID, Name: strings.TrimSpace(name), Reviewed: reviewed}
	if !incidentToken(link.Name) {
		return sreRunbookLink{}, errIncidentInvalid
	}
	existing, err := findSRERunbook(current.ID, link.Name)
	if err != nil {
		return sreRunbookLink{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	return saveSRERunbook(link)
}

func closeSREIncident(actor authzSubject, incidentID int, reason string) (sreIncident, error) {
	current, err := writableSREIncident(actor, incidentID)
	if err != nil {
		return sreIncident{}, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.EqualFold(reason, "healthy") || len(reason) > 500 {
		return sreIncident{}, errIncidentInvalid
	}
	if current.Severity == "unknown" {
		return sreIncident{}, errIncidentInvalid
	}
	if current.Severity == "critical" {
		fresh, err := incidentHasFreshEvidence(current.ID)
		if err != nil {
			return sreIncident{}, err
		}
		reviewed, err := incidentHasReviewedRunbook(current.ID)
		if err != nil {
			return sreIncident{}, err
		}
		if !fresh || !reviewed {
			return sreIncident{}, errIncidentInvalid
		}
	}
	if current.Status == "resolved" || current.Status == "closed" {
		return presentSREIncident(current)
	}
	current.Status = "resolved"
	current.ClosureReason = reason
	updated, err := updateSREIncident(current)
	if err != nil {
		return sreIncident{}, err
	}
	return presentSREIncident(updated)
}

func recordSREReview(actor authzSubject, incidentID int, body, suspected, proven string, proof bool, evidenceRefs []string) (sreReviewDraft, error) {
	current, err := writableSREIncident(actor, incidentID)
	if err != nil {
		return sreReviewDraft{}, err
	}
	existing, err := findSREReview(current.ID)
	if err != nil {
		return sreReviewDraft{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	body = strings.TrimSpace(body)
	suspected = strings.TrimSpace(suspected)
	proven = strings.TrimSpace(proven)
	if body == "" || len(body) > 4000 || strings.EqualFold(body, "healthy") || len(evidenceRefs) == 0 {
		return sreReviewDraft{}, errIncidentInvalid
	}
	cited := []string{}
	for _, ref := range evidenceRefs {
		ref = strings.TrimSpace(ref)
		if ref == "" || !strings.Contains(body, ref) {
			return sreReviewDraft{}, errIncidentInvalid
		}
		found, err := timelineHasEvidence(current.ID, ref)
		if err != nil {
			return sreReviewDraft{}, err
		}
		if !found {
			return sreReviewDraft{}, errIncidentInvalid
		}
		cited = append(cited, ref)
	}
	cause := "unknown"
	if proof && proven != "" && !strings.EqualFold(proven, "healthy") && proven != suspected && len(proven) <= 500 {
		cause = proven
	}
	if strings.EqualFold(suspected, "healthy") || len(suspected) > 500 {
		return sreReviewDraft{}, errIncidentInvalid
	}
	return saveSREReview(sreReviewDraft{
		IncidentID: current.ID, Body: body, EvidenceRefs: cited, SuspectedChange: suspected, ProvenCause: cause,
	})
}

func recordSREFollowUp(actor authzSubject, incidentID int, title, owner string) (sreFollowUp, error) {
	current, err := writableSREIncident(actor, incidentID)
	if err != nil {
		return sreFollowUp{}, err
	}
	status := current.Status
	item := sreFollowUp{IncidentID: current.ID, Title: strings.TrimSpace(title), OwnerTeam: strings.TrimSpace(owner), Status: "open"}
	if !incidentToken(item.Title) || !incidentToken(item.OwnerTeam) {
		return sreFollowUp{}, errIncidentInvalid
	}
	existing, err := findSREFollowUp(current.ID, item.Title)
	if err != nil {
		return sreFollowUp{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	saved, err := saveSREFollowUp(item)
	if err != nil {
		return sreFollowUp{}, err
	}
	reloaded, err := loadSREIncident(current.ID)
	if err != nil {
		return sreFollowUp{}, err
	}
	if reloaded.Status != status {
		return sreFollowUp{}, errIncidentInvalid
	}
	return saved, nil
}

func readSREIncident(actor authzSubject, projectID int, source, fingerprint string) (sreIncident, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	fingerprint = strings.ToLower(strings.TrimSpace(fingerprint))
	if projectID <= 0 || !incidentToken(source) || !incidentToken(fingerprint) {
		return sreIncident{}, errIncidentInvalid
	}
	item, err := findSREIncident(projectID, source, fingerprint)
	if err != nil || item.ID == 0 {
		return sreIncident{}, errIncidentHidden
	}
	if err := authorizeSREIncident(actor, item.ProjectID, item.Environment, false); err != nil {
		return sreIncident{}, err
	}
	return presentSREIncident(item)
}

func writableSREIncident(actor authzSubject, incidentID int) (sreIncident, error) {
	current, err := loadSREIncident(incidentID)
	if err != nil || current.ID == 0 {
		return sreIncident{}, errIncidentHidden
	}
	if err := authorizeSREIncident(actor, current.ProjectID, current.Environment, true); err != nil {
		return sreIncident{}, err
	}
	return current, nil
}

func incidentHasFreshEvidence(incidentID int) (bool, error) {
	rows, err := listSRETimeline(incidentID)
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.EvidenceState == "recorded" && row.EvidenceRef != "" {
			return true, nil
		}
	}
	return false, nil
}

func incidentHasReviewedRunbook(incidentID int) (bool, error) {
	rows, err := listSRERunbooks(incidentID)
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.Reviewed {
			return true, nil
		}
	}
	return false, nil
}

func timelineHasEvidence(incidentID int, ref string) (bool, error) {
	rows, err := listSRETimeline(incidentID)
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.EvidenceRef == ref {
			return true, nil
		}
	}
	return false, nil
}

func presentSREIncident(item sreIncident) (sreIncident, error) {
	if item.Status == "" {
		item.Status = "open"
	}
	if item.Severity == "" {
		item.Severity = "unknown"
	}
	rows, err := listSRETimeline(item.ID)
	if err != nil {
		return sreIncident{}, err
	}
	if rows == nil {
		rows = []sreTimelineEntry{}
	}
	item.Timeline = rows
	books, err := listSRERunbooks(item.ID)
	if err != nil {
		return sreIncident{}, err
	}
	if books == nil {
		books = []sreRunbookLink{}
	}
	item.Runbooks = books
	review, err := findSREReview(item.ID)
	if err != nil {
		return sreIncident{}, err
	}
	if review.ID > 0 {
		if review.ProvenCause == "" {
			review.ProvenCause = "unknown"
		}
		item.Review = &review
	}
	followUps, err := listSREFollowUps(item.ID)
	if err != nil {
		return sreIncident{}, err
	}
	if followUps == nil {
		followUps = []sreFollowUp{}
	}
	item.FollowUps = followUps
	return item, nil
}

type sreIncidentAudit struct {
	ProjectID   int
	Fingerprint string
	ActorUserID int
	Summary     string
}

func migrateSREIncidentSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_incidents (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			source VARCHAR(128) NOT NULL,
			fingerprint VARCHAR(128) NOT NULL,
			severity VARCHAR(32) NOT NULL,
			status VARCHAR(32) NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			owner_team VARCHAR(128) NOT NULL DEFAULT '',
			occurrences INTEGER NOT NULL DEFAULT 1,
			closure_reason TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, source, fingerprint)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_incident_timeline (
			id SERIAL PRIMARY KEY,
			incident_id INTEGER NOT NULL,
			event_key VARCHAR(128) NOT NULL,
			evidence_kind VARCHAR(32) NOT NULL,
			evidence_ref TEXT NOT NULL,
			evidence_state VARCHAR(32) NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			UNIQUE (incident_id, event_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_incident_runbooks (
			id SERIAL PRIMARY KEY,
			incident_id INTEGER NOT NULL,
			name VARCHAR(128) NOT NULL,
			reviewed BOOLEAN NOT NULL DEFAULT FALSE,
			UNIQUE (incident_id, name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_incident_reviews (
			id SERIAL PRIMARY KEY,
			incident_id INTEGER NOT NULL UNIQUE,
			body TEXT NOT NULL,
			evidence_refs TEXT NOT NULL,
			suspected_change TEXT NOT NULL DEFAULT '',
			proven_cause TEXT NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_incident_followups (
			id SERIAL PRIMARY KEY,
			incident_id INTEGER NOT NULL,
			title VARCHAR(128) NOT NULL,
			owner_team VARCHAR(128) NOT NULL,
			status VARCHAR(32) NOT NULL,
			UNIQUE (incident_id, title)
		)
	`)
}

func saveSREIncidentToDB(item sreIncident) (sreIncident, error) {
	if DB == nil {
		return sreIncident{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO sre_incidents (project_id, environment, source, fingerprint, severity, status, summary, owner_team, occurrences, closure_reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
	`, item.ProjectID, item.Environment, item.Source, item.Fingerprint, item.Severity, item.Status, item.Summary, item.OwnerTeam, item.Occurrences, item.ClosureReason).Scan(&item.ID)
	return item, err
}

const sreIncidentSelect = `SELECT id, project_id, environment, source, fingerprint, severity, status, summary, owner_team, occurrences, closure_reason FROM sre_incidents`

func scanSREIncident(query string, args ...interface{}) (sreIncident, error) {
	var item sreIncident
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.Environment, &item.Source, &item.Fingerprint, &item.Severity, &item.Status, &item.Summary, &item.OwnerTeam, &item.Occurrences, &item.ClosureReason,
	)
	return item, err
}

func findSREIncidentFromDB(projectID int, source, fingerprint string) (sreIncident, error) {
	if DB == nil {
		return sreIncident{}, nil
	}
	item, err := scanSREIncident(sreIncidentSelect+` WHERE project_id = $1 AND source = $2 AND fingerprint = $3`, projectID, source, fingerprint)
	if err != nil {
		return sreIncident{}, nil
	}
	return item, nil
}

func loadSREIncidentFromDB(id int) (sreIncident, error) {
	if DB == nil || id <= 0 {
		return sreIncident{}, errIncidentHidden
	}
	item, err := scanSREIncident(sreIncidentSelect+` WHERE id = $1`, id)
	if err != nil || item.ID == 0 {
		return sreIncident{}, errIncidentHidden
	}
	return item, nil
}

func updateSREIncidentInDB(item sreIncident) (sreIncident, error) {
	if DB == nil {
		return sreIncident{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE sre_incidents SET summary = $2, owner_team = $3, occurrences = $4, status = $5, closure_reason = $6, severity = $7 WHERE id = $1
	`, item.ID, item.Summary, item.OwnerTeam, item.Occurrences, item.Status, item.ClosureReason, item.Severity)
	return item, err
}

func saveSRETimelineToDB(item sreTimelineEntry) (sreTimelineEntry, error) {
	if DB == nil {
		return sreTimelineEntry{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO sre_incident_timeline (incident_id, event_key, evidence_kind, evidence_ref, evidence_state, note)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.IncidentID, item.EventKey, item.EvidenceKind, item.EvidenceRef, item.EvidenceState, item.Note).Scan(&item.ID)
	return item, err
}

func findSRETimelineFromDB(incidentID int, eventKey string) (sreTimelineEntry, error) {
	if DB == nil {
		return sreTimelineEntry{}, nil
	}
	var item sreTimelineEntry
	err := DB.QueryRow(`SELECT id, incident_id, event_key, evidence_kind, evidence_ref, evidence_state, note FROM sre_incident_timeline WHERE incident_id = $1 AND event_key = $2`, incidentID, eventKey).Scan(
		&item.ID, &item.IncidentID, &item.EventKey, &item.EvidenceKind, &item.EvidenceRef, &item.EvidenceState, &item.Note,
	)
	if err != nil {
		return sreTimelineEntry{}, nil
	}
	return item, nil
}

func listSRETimelineFromDB(incidentID int) ([]sreTimelineEntry, error) {
	if DB == nil || incidentID <= 0 {
		return []sreTimelineEntry{}, nil
	}
	rows, err := DB.Query(`SELECT id, incident_id, event_key, evidence_kind, evidence_ref, evidence_state, note FROM sre_incident_timeline WHERE incident_id = $1 ORDER BY id`, incidentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []sreTimelineEntry{}
	for rows.Next() {
		var item sreTimelineEntry
		if err := rows.Scan(&item.ID, &item.IncidentID, &item.EventKey, &item.EvidenceKind, &item.EvidenceRef, &item.EvidenceState, &item.Note); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveSRERunbookToDB(item sreRunbookLink) (sreRunbookLink, error) {
	if DB == nil {
		return sreRunbookLink{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO sre_incident_runbooks (incident_id, name, reviewed) VALUES ($1,$2,$3) RETURNING id`, item.IncidentID, item.Name, item.Reviewed).Scan(&item.ID)
	return item, err
}

func findSRERunbookFromDB(incidentID int, name string) (sreRunbookLink, error) {
	if DB == nil {
		return sreRunbookLink{}, nil
	}
	var item sreRunbookLink
	err := DB.QueryRow(`SELECT id, incident_id, name, reviewed FROM sre_incident_runbooks WHERE incident_id = $1 AND name = $2`, incidentID, name).Scan(&item.ID, &item.IncidentID, &item.Name, &item.Reviewed)
	if err != nil {
		return sreRunbookLink{}, nil
	}
	return item, nil
}

func listSRERunbooksFromDB(incidentID int) ([]sreRunbookLink, error) {
	if DB == nil || incidentID <= 0 {
		return []sreRunbookLink{}, nil
	}
	rows, err := DB.Query(`SELECT id, incident_id, name, reviewed FROM sre_incident_runbooks WHERE incident_id = $1 ORDER BY id`, incidentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []sreRunbookLink{}
	for rows.Next() {
		var item sreRunbookLink
		if err := rows.Scan(&item.ID, &item.IncidentID, &item.Name, &item.Reviewed); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveSREReviewToDB(item sreReviewDraft) (sreReviewDraft, error) {
	if DB == nil {
		return sreReviewDraft{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO sre_incident_reviews (incident_id, body, evidence_refs, suspected_change, proven_cause)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, item.IncidentID, item.Body, strings.Join(item.EvidenceRefs, "\n"), item.SuspectedChange, item.ProvenCause).Scan(&item.ID)
	return item, err
}

func findSREReviewFromDB(incidentID int) (sreReviewDraft, error) {
	if DB == nil || incidentID <= 0 {
		return sreReviewDraft{}, nil
	}
	var item sreReviewDraft
	var refs string
	err := DB.QueryRow(`SELECT id, incident_id, body, evidence_refs, suspected_change, proven_cause FROM sre_incident_reviews WHERE incident_id = $1`, incidentID).Scan(
		&item.ID, &item.IncidentID, &item.Body, &refs, &item.SuspectedChange, &item.ProvenCause,
	)
	if err != nil {
		return sreReviewDraft{}, nil
	}
	if refs != "" {
		item.EvidenceRefs = strings.Split(refs, "\n")
	} else {
		item.EvidenceRefs = []string{}
	}
	return item, nil
}

func saveSREFollowUpToDB(item sreFollowUp) (sreFollowUp, error) {
	if DB == nil {
		return sreFollowUp{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO sre_incident_followups (incident_id, title, owner_team, status) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.IncidentID, item.Title, item.OwnerTeam, item.Status).Scan(&item.ID)
	return item, err
}

func findSREFollowUpFromDB(incidentID int, title string) (sreFollowUp, error) {
	if DB == nil {
		return sreFollowUp{}, nil
	}
	var item sreFollowUp
	err := DB.QueryRow(`SELECT id, incident_id, title, owner_team, status FROM sre_incident_followups WHERE incident_id = $1 AND title = $2`, incidentID, title).Scan(
		&item.ID, &item.IncidentID, &item.Title, &item.OwnerTeam, &item.Status,
	)
	if err != nil {
		return sreFollowUp{}, nil
	}
	return item, nil
}

func listSREFollowUpsFromDB(incidentID int) ([]sreFollowUp, error) {
	if DB == nil || incidentID <= 0 {
		return []sreFollowUp{}, nil
	}
	rows, err := DB.Query(`SELECT id, incident_id, title, owner_team, status FROM sre_incident_followups WHERE incident_id = $1 ORDER BY id`, incidentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []sreFollowUp{}
	for rows.Next() {
		var item sreFollowUp
		if err := rows.Scan(&item.ID, &item.IncidentID, &item.Title, &item.OwnerTeam, &item.Status); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveSREIncidentAuditToDB(item sreIncidentAudit) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "sre_incident",
		ResourceID: item.Fingerprint, Action: "sre_incident", Result: "success", Summary: item.Summary,
	})
	return nil
}

func sreIncidentHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	if r.Method == http.MethodGet {
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		item, err := readSREIncident(actor, projectID, r.URL.Query().Get("source"), r.URL.Query().Get("fingerprint"))
		if err != nil {
			writeSREIncidentError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, item)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Source      string `json:"source"`
		Fingerprint string `json:"fingerprint"`
		Severity    string `json:"severity"`
		Summary     string `json:"summary"`
		OwnerTeam   string `json:"owner_team"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := recordSREIncident(actor, sreIncidentInput{
		ProjectID: body.ProjectID, Environment: body.Environment, Source: body.Source, Fingerprint: body.Fingerprint,
		Severity: body.Severity, Summary: body.Summary, OwnerTeam: body.OwnerTeam,
	})
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreIncidentTimelineHandler(w http.ResponseWriter, r *http.Request) {
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
		IncidentID    int    `json:"incident_id"`
		EventKey      string `json:"event_key"`
		EvidenceKind  string `json:"evidence_kind"`
		EvidenceRef   string `json:"evidence_ref"`
		EvidenceState string `json:"evidence_state"`
		Note          string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := appendSRETimeline(actor, body.IncidentID, body.EventKey, body.EvidenceKind, body.EvidenceRef, body.EvidenceState, body.Note)
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreIncidentRunbookHandler(w http.ResponseWriter, r *http.Request) {
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
		IncidentID int    `json:"incident_id"`
		Name       string `json:"name"`
		Reviewed   bool   `json:"reviewed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := linkSRERunbook(actor, body.IncidentID, body.Name, body.Reviewed)
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreIncidentCloseHandler(w http.ResponseWriter, r *http.Request) {
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
		IncidentID int    `json:"incident_id"`
		Reason     string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := closeSREIncident(actor, body.IncidentID, body.Reason)
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreIncidentReviewHandler(w http.ResponseWriter, r *http.Request) {
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
		IncidentID      int      `json:"incident_id"`
		Body            string   `json:"body"`
		EvidenceRefs    []string `json:"evidence_refs"`
		SuspectedChange string   `json:"suspected_change"`
		ProvenCause     string   `json:"proven_cause"`
		Proof           bool     `json:"proof"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := recordSREReview(actor, body.IncidentID, body.Body, body.SuspectedChange, body.ProvenCause, body.Proof, body.EvidenceRefs)
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreIncidentFollowUpHandler(w http.ResponseWriter, r *http.Request) {
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
		IncidentID int    `json:"incident_id"`
		Title      string `json:"title"`
		OwnerTeam  string `json:"owner_team"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSREIncidentError(w, r, errIncidentInvalid)
		return
	}
	saved, err := recordSREFollowUp(actor, body.IncidentID, body.Title, body.OwnerTeam)
	if err != nil {
		writeSREIncidentError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func writeSREIncidentError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errIncidentHidden):
		writeAPIError(w, r, http.StatusNotFound, errIncidentHidden.Error(), nil)
	case errors.Is(err, errIncidentDenied):
		writeAPIError(w, r, http.StatusForbidden, errIncidentDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errIncidentInvalid.Error(), nil)
	}
}
