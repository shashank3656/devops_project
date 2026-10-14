package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const episodeRecoveryPolicy = "require-evidence"

var (
	errEpisodeHidden  = errors.New("episode not found")
	errEpisodeDenied  = errors.New("episode is not permitted")
	errEpisodeInvalid = errors.New("episode is invalid")
)

type alertEpisode struct {
	ID              int    `json:"id"`
	ProjectID       int    `json:"project_id"`
	Environment     string `json:"environment"`
	ConnectionID    int    `json:"connection_id"`
	ConnectionName  string `json:"connection_name"`
	Fingerprint     string `json:"fingerprint"`
	Sequence        int    `json:"sequence"`
	Status          string `json:"status"`
	Severity        string `json:"severity"`
	IncidentID      int    `json:"incident_id"`
	Source          string `json:"source"`
	CreatorUserID   int    `json:"creator_user_id"`
	EventID         string `json:"event_id"`
	OccurrenceAt    string `json:"occurrence_at"`
	ReceivedAt      string `json:"received_at"`
	ProcessedAt     string `json:"processed_at"`
	EvidenceState   string `json:"evidence_state"`
	CausationProven bool   `json:"causation_proven"`
	ProblemID       int    `json:"problem_id"`
	Applied         bool   `json:"applied"`
	Reason          string `json:"reason"`
}

type episodeInput struct {
	ProjectID     int
	ConnectionID  int
	Environment   string
	Fingerprint   string
	Kind          string
	EventID       string
	OccurrenceAt  string
	ReceivedAt    string
	EvidenceState string
	Severity      string
	Source        string
	CreatorUserID int
}

type episodeConnection struct {
	ID        int
	ProjectID int
	Name      string
}

type sreProblem struct {
	ID             int    `json:"id"`
	ProjectID      int    `json:"project_id"`
	Environment    string `json:"environment"`
	ConnectionID   int    `json:"connection_id"`
	ExternalID     string `json:"external_id"`
	Title          string `json:"title"`
	SymptomKey     string `json:"symptom_key"`
	Status         string `json:"status"`
	Source         string `json:"source"`
	CreatorUserID  int    `json:"creator_user_id"`
	EventID        string `json:"event_id"`
	Cause          string `json:"cause"`
	Workaround     string `json:"workaround"`
	FixEvidence    string `json:"fix_evidence"`
	Verified       bool   `json:"verified"`
	SeparateReason string `json:"separate_reason"`
	IncidentIDs    []int  `json:"incident_ids"`
}

type problemInput struct {
	ProjectID      int
	Environment    string
	ConnectionID   int
	ExternalID     string
	Title          string
	SymptomKey     string
	Source         string
	EventID        string
	CreatorUserID  int
	SeparateReason string
}

var (
	loadEpisodeConnection  = loadEpisodeConnectionFromDB
	saveAlertEpisode       = saveAlertEpisodeToDB
	updateAlertEpisode     = updateAlertEpisodeInDB
	findAlertEpisode       = findAlertEpisodeFromDB
	latestAlertEpisode     = latestAlertEpisodeFromDB
	listAlertEpisodes      = listAlertEpisodesFromDB
	findEpisodeEvent       = findEpisodeEventFromDB
	saveEpisodeEvent       = saveEpisodeEventToDB
	openEpisodeIncident    = openEpisodeIncidentFromRecord
	resolveEpisodeIncident = resolveEpisodeIncidentFromRecord
	saveSREProblem         = saveSREProblemToDB
	findSREProblem         = findSREProblemFromDB
	loadSREProblem         = loadSREProblemFromDB
	updateSREProblem       = updateSREProblemInDB
	listSREProblems        = listSREProblemsFromDB
	saveProblemLink        = saveProblemLinkToDB
	findProblemLink        = findProblemLinkFromDB
	listProblemLinks       = listProblemLinksFromDB
	saveEpisodeAudit       = saveEpisodeAuditToDB
	episodeClock           = func() time.Time { return time.Now().UTC() }
)

func ingestAlertEpisode(actor authzSubject, input episodeInput) (alertEpisode, error) {
	item, err := normalizeEpisode(input)
	if err != nil {
		return alertEpisode{}, err
	}
	if err := authorizeEpisode(actor, item.ProjectID, item.Environment, true); err != nil {
		return alertEpisode{}, err
	}
	if item.Source == "webhook" {
		connection, err := loadEpisodeConnection(item.ConnectionID)
		if err != nil || connection.ID == 0 || connection.ProjectID != item.ProjectID {
			return alertEpisode{}, errEpisodeHidden
		}
		item.ConnectionName = connection.Name
	}
	existing, err := findEpisodeEvent(item.ProjectID, item.EventID)
	if err != nil {
		return alertEpisode{}, err
	}
	if existing.ID > 0 {
		current, err := findAlertEpisode(existing.ID)
		if err != nil || current.ID == 0 {
			return alertEpisode{}, errEpisodeHidden
		}
		current.Applied = true
		current.Reason = "duplicate event"
		current.CausationProven = false
		return current, nil
	}
	latest, err := latestAlertEpisode(item.ProjectID, item.ConnectionID, item.Fingerprint)
	if err != nil {
		return alertEpisode{}, err
	}
	item.ProcessedAt = episodeClock().Format(time.RFC3339)
	item.CausationProven = false
	switch item.Reason {
	case "firing":
		return applyFiring(actor, item, latest)
	case "recovery":
		return applyRecovery(actor, item, latest)
	default:
		return alertEpisode{}, errEpisodeInvalid
	}
}

func normalizeEpisode(input episodeInput) (alertEpisode, error) {
	item := alertEpisode{
		ProjectID: input.ProjectID, ConnectionID: input.ConnectionID,
		Environment:  strings.ToLower(strings.TrimSpace(input.Environment)),
		Fingerprint:  strings.ToLower(strings.TrimSpace(input.Fingerprint)),
		EventID:      strings.ToLower(strings.TrimSpace(input.EventID)),
		OccurrenceAt: strings.TrimSpace(input.OccurrenceAt), ReceivedAt: strings.TrimSpace(input.ReceivedAt),
		Source: strings.ToLower(strings.TrimSpace(input.Source)), CreatorUserID: input.CreatorUserID,
		Severity: incidentSeverity(input.Severity), Reason: strings.ToLower(strings.TrimSpace(input.Kind)),
	}
	if item.ProjectID <= 0 || !singleEnvironment(item.Environment) || !incidentToken(item.Fingerprint) || !incidentToken(item.EventID) {
		return alertEpisode{}, errEpisodeInvalid
	}
	if _, err := time.Parse(time.RFC3339, item.OccurrenceAt); err != nil {
		return alertEpisode{}, errEpisodeInvalid
	}
	if _, err := time.Parse(time.RFC3339, item.ReceivedAt); err != nil {
		return alertEpisode{}, errEpisodeInvalid
	}
	if item.OccurrenceAt == item.ReceivedAt {
		return alertEpisode{}, errEpisodeInvalid
	}
	switch item.Source {
	case "webhook":
		if item.ConnectionID <= 0 {
			return alertEpisode{}, errEpisodeInvalid
		}
	case "ui":
		if item.CreatorUserID <= 0 {
			return alertEpisode{}, errEpisodeInvalid
		}
	default:
		return alertEpisode{}, errEpisodeInvalid
	}
	if item.Reason != "firing" && item.Reason != "recovery" {
		return alertEpisode{}, errEpisodeInvalid
	}
	switch strings.ToLower(strings.TrimSpace(input.EvidenceState)) {
	case "recorded":
		item.EvidenceState = "recorded"
	case "", "missing", "unknown", "stale", "partial":
		item.EvidenceState = "unknown"
	default:
		return alertEpisode{}, errEpisodeInvalid
	}
	return item, nil
}

func applyFiring(actor authzSubject, item, latest alertEpisode) (alertEpisode, error) {
	if latest.ID > 0 && latest.Status == "firing" {
		latest.OccurrenceAt = item.OccurrenceAt
		latest.ReceivedAt = item.ReceivedAt
		latest.ProcessedAt = item.ProcessedAt
		latest.EventID = item.EventID
		updated, err := updateAlertEpisode(latest)
		if err != nil {
			return alertEpisode{}, err
		}
		if _, err := openEpisodeIncident(actor, updated.ProjectID, updated.Environment, updated.Fingerprint, updated.Sequence, updated.Severity); err != nil {
			return alertEpisode{}, err
		}
		if err := saveEpisodeEvent(updated.ProjectID, updated.ID, item.EventID, true, "firing updated the episode"); err != nil {
			return alertEpisode{}, err
		}
		updated.Applied = true
		updated.Reason = "firing updated the episode"
		updated.CausationProven = false
		return updated, nil
	}
	if latest.ID > 0 && latest.Status == "resolved" && !episodeAfter(item.OccurrenceAt, latest.OccurrenceAt) {
		if err := saveEpisodeEvent(item.ProjectID, latest.ID, item.EventID, false, "late firing does not reopen"); err != nil {
			return alertEpisode{}, err
		}
		latest.Applied = false
		latest.Reason = "late firing does not reopen"
		latest.CausationProven = false
		return latest, nil
	}
	item.Sequence = latest.Sequence + 1
	item.Status = "firing"
	incidentID, err := openEpisodeIncident(actor, item.ProjectID, item.Environment, item.Fingerprint, item.Sequence, item.Severity)
	if err != nil {
		return alertEpisode{}, err
	}
	item.IncidentID = incidentID
	saved, err := saveAlertEpisode(item)
	if err != nil {
		return alertEpisode{}, err
	}
	if err := saveEpisodeEvent(saved.ProjectID, saved.ID, item.EventID, true, "new episode"); err != nil {
		return alertEpisode{}, err
	}
	_ = saveEpisodeAudit(episodeAudit{ProjectID: saved.ProjectID, EventID: item.EventID, ActorUserID: actor.UserID, Summary: "alert episode recorded"})
	saved.Applied = true
	saved.Reason = "new episode"
	saved.CausationProven = false
	return saved, nil
}

func applyRecovery(actor authzSubject, item, latest alertEpisode) (alertEpisode, error) {
	if latest.ID == 0 || latest.Status != "firing" {
		return alertEpisode{}, errEpisodeInvalid
	}
	if episodeRecoveryPolicy != "require-evidence" || item.EvidenceState != "recorded" {
		if err := saveEpisodeEvent(item.ProjectID, latest.ID, item.EventID, false, "recovery evidence is unknown"); err != nil {
			return alertEpisode{}, err
		}
		latest.Applied = false
		latest.Reason = "recovery evidence is unknown"
		latest.EvidenceState = "unknown"
		latest.CausationProven = false
		return latest, nil
	}
	latest.Status = "resolved"
	latest.EvidenceState = "recorded"
	latest.OccurrenceAt = item.OccurrenceAt
	latest.ReceivedAt = item.ReceivedAt
	latest.ProcessedAt = item.ProcessedAt
	latest.EventID = item.EventID
	updated, err := updateAlertEpisode(latest)
	if err != nil {
		return alertEpisode{}, err
	}
	if updated.Severity != "critical" {
		if err := resolveEpisodeIncident(actor, updated.IncidentID); err != nil && !errors.Is(err, errIncidentInvalid) {
			return alertEpisode{}, err
		}
	}
	if err := saveEpisodeEvent(updated.ProjectID, updated.ID, item.EventID, true, "recovery recorded"); err != nil {
		return alertEpisode{}, err
	}
	updated.Applied = true
	updated.Reason = "recovery recorded"
	updated.CausationProven = false
	return updated, nil
}

func episodeAfter(next, previous string) bool {
	left, leftErr := time.Parse(time.RFC3339, next)
	right, rightErr := time.Parse(time.RFC3339, previous)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return left.After(right)
}

func listEpisodeRecords(actor authzSubject, projectID int, environment string) ([]alertEpisode, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := authorizeEpisode(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	rows, err := listAlertEpisodes(projectID, environment)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []alertEpisode{}
	}
	for index := range rows {
		rows[index].CausationProven = false
	}
	return rows, nil
}

func linkEpisodeProblem(actor authzSubject, episodeID, problemID int) (alertEpisode, error) {
	episode, err := findAlertEpisode(episodeID)
	if err != nil || episode.ID == 0 {
		return alertEpisode{}, errEpisodeHidden
	}
	problem, err := loadSREProblem(problemID)
	if err != nil || problem.ID == 0 {
		return alertEpisode{}, errEpisodeHidden
	}
	if err := authorizeEpisode(actor, episode.ProjectID, episode.Environment, true); err != nil {
		return alertEpisode{}, err
	}
	if err := authorizeEpisode(actor, problem.ProjectID, problem.Environment, true); err != nil {
		return alertEpisode{}, err
	}
	episode.ProblemID = problem.ID
	episode.CausationProven = false
	updated, err := updateAlertEpisode(episode)
	if err != nil {
		return alertEpisode{}, err
	}
	updated.CausationProven = false
	updated.Reason = "suspected link"
	return updated, nil
}

func upsertSREProblem(actor authzSubject, input problemInput) (sreProblem, error) {
	item, err := normalizeProblem(input)
	if err != nil {
		return sreProblem{}, err
	}
	if err := authorizeEpisode(actor, item.ProjectID, item.Environment, true); err != nil {
		return sreProblem{}, err
	}
	if item.Source == "webhook" {
		connection, err := loadEpisodeConnection(item.ConnectionID)
		if err != nil || connection.ID == 0 || connection.ProjectID != item.ProjectID {
			return sreProblem{}, errEpisodeHidden
		}
	}
	existing, err := findSREProblem(item.ProjectID, item.ConnectionID, item.ExternalID)
	if err != nil {
		return sreProblem{}, err
	}
	if existing.ID > 0 {
		existing.Title = item.Title
		updated, err := updateSREProblem(existing)
		if err != nil {
			return sreProblem{}, err
		}
		return presentProblem(updated)
	}
	matches, err := suggestSREProblems(actor, item.ProjectID, item.Environment, item.SymptomKey)
	if err != nil {
		return sreProblem{}, err
	}
	if len(matches) > 0 && strings.TrimSpace(item.SeparateReason) == "" {
		return sreProblem{}, errEpisodeInvalid
	}
	item.Status = "open"
	item.Verified = false
	saved, err := saveSREProblem(item)
	if err != nil {
		return sreProblem{}, err
	}
	_ = saveEpisodeAudit(episodeAudit{ProjectID: saved.ProjectID, EventID: saved.ExternalID, ActorUserID: actor.UserID, Summary: "problem recorded"})
	return presentProblem(saved)
}

func normalizeProblem(input problemInput) (sreProblem, error) {
	item := sreProblem{
		ProjectID: input.ProjectID, ConnectionID: input.ConnectionID,
		Environment: strings.ToLower(strings.TrimSpace(input.Environment)),
		ExternalID:  strings.ToLower(strings.TrimSpace(input.ExternalID)),
		Title:       strings.TrimSpace(input.Title), SymptomKey: strings.ToLower(strings.TrimSpace(input.SymptomKey)),
		Source: strings.ToLower(strings.TrimSpace(input.Source)), EventID: strings.ToLower(strings.TrimSpace(input.EventID)),
		CreatorUserID: input.CreatorUserID, SeparateReason: strings.TrimSpace(input.SeparateReason),
	}
	if item.ProjectID <= 0 || !singleEnvironment(item.Environment) || !incidentToken(item.ExternalID) || !incidentToken(item.SymptomKey) || item.Title == "" || len(item.Title) > 200 {
		return sreProblem{}, errEpisodeInvalid
	}
	if strings.EqualFold(item.Title, "healthy") || strings.EqualFold(item.SeparateReason, "healthy") {
		return sreProblem{}, errEpisodeInvalid
	}
	switch item.Source {
	case "webhook":
		if item.ConnectionID <= 0 || !incidentToken(item.EventID) {
			return sreProblem{}, errEpisodeInvalid
		}
	case "ui":
		if item.CreatorUserID <= 0 || !incidentToken(item.EventID) {
			return sreProblem{}, errEpisodeInvalid
		}
	default:
		return sreProblem{}, errEpisodeInvalid
	}
	return item, nil
}

func suggestSREProblems(actor authzSubject, projectID int, environment, symptomKey string) ([]sreProblem, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	symptomKey = strings.ToLower(strings.TrimSpace(symptomKey))
	if err := authorizeEpisode(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	rows, err := listSREProblems(projectID, environment)
	if err != nil {
		return nil, err
	}
	matched := []sreProblem{}
	for _, row := range rows {
		if row.SymptomKey == symptomKey && row.Status != "closed" {
			matched = append(matched, row)
		}
	}
	return matched, nil
}

func linkSREProblemIncident(actor authzSubject, problemID, incidentID int) (sreProblem, error) {
	problem, err := loadSREProblem(problemID)
	if err != nil || problem.ID == 0 {
		return sreProblem{}, errEpisodeHidden
	}
	incident, err := loadSREIncident(incidentID)
	if err != nil || incident.ID == 0 {
		return sreProblem{}, errEpisodeHidden
	}
	if err := authorizeEpisode(actor, problem.ProjectID, problem.Environment, true); err != nil {
		return sreProblem{}, err
	}
	if err := authorizeEpisode(actor, incident.ProjectID, incident.Environment, true); err != nil {
		return sreProblem{}, err
	}
	existing, err := findProblemLink(problem.ID, incident.ID)
	if err != nil {
		return sreProblem{}, err
	}
	if existing == 0 {
		if err := saveProblemLink(problem.ID, incident.ID); err != nil {
			return sreProblem{}, err
		}
	}
	return presentProblem(problem)
}

func publishKnownError(actor authzSubject, problemID int, cause, workaround string) (sreProblem, error) {
	problem, err := writableProblem(actor, problemID)
	if err != nil {
		return sreProblem{}, err
	}
	cause = strings.TrimSpace(cause)
	workaround = strings.TrimSpace(workaround)
	if cause == "" || workaround == "" || strings.EqualFold(cause, "healthy") || strings.EqualFold(workaround, "healthy") || len(cause) > 1000 || len(workaround) > 1000 {
		return sreProblem{}, errEpisodeInvalid
	}
	problem.Cause = cause
	problem.Workaround = workaround
	problem.Status = "known_error"
	problem.Verified = false
	updated, err := updateSREProblem(problem)
	if err != nil {
		return sreProblem{}, err
	}
	return presentProblem(updated)
}

func verifyProblemFix(actor authzSubject, problemID int, evidence string) (sreProblem, error) {
	problem, err := writableProblem(actor, problemID)
	if err != nil {
		return sreProblem{}, err
	}
	evidence = strings.TrimSpace(evidence)
	if problem.Status != "known_error" || evidence == "" || strings.EqualFold(evidence, "healthy") || len(evidence) > 500 {
		return sreProblem{}, errEpisodeInvalid
	}
	problem.FixEvidence = evidence
	problem.Verified = true
	problem.Status = "closed"
	updated, err := updateSREProblem(problem)
	if err != nil {
		return sreProblem{}, err
	}
	return presentProblem(updated)
}

func writableProblem(actor authzSubject, problemID int) (sreProblem, error) {
	problem, err := loadSREProblem(problemID)
	if err != nil || problem.ID == 0 {
		return sreProblem{}, errEpisodeHidden
	}
	if err := authorizeEpisode(actor, problem.ProjectID, problem.Environment, true); err != nil {
		return sreProblem{}, err
	}
	return problem, nil
}

func presentProblem(item sreProblem) (sreProblem, error) {
	if item.Status == "" {
		item.Status = "open"
	}
	links, err := listProblemLinks(item.ID)
	if err != nil {
		return sreProblem{}, err
	}
	if links == nil {
		links = []int{}
	}
	item.IncidentIDs = links
	item.Verified = item.Status == "closed" && item.FixEvidence != ""
	return item, nil
}

func authorizeEpisode(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) || !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errEpisodeHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errEpisodeDenied
	}
	return nil
}

func openEpisodeIncidentFromRecord(actor authzSubject, projectID int, environment, fingerprint string, sequence int, severity string) (int, error) {
	item, err := recordSREIncident(actor, sreIncidentInput{
		ProjectID: projectID, Environment: environment, Source: "episode",
		Fingerprint: fingerprint + "-" + strconv.Itoa(sequence), Severity: severity, Summary: "alert episode",
	})
	if err != nil {
		return 0, err
	}
	return item.ID, nil
}

func resolveEpisodeIncidentFromRecord(actor authzSubject, incidentID int) error {
	_, err := closeSREIncident(actor, incidentID, "recovery evidence recorded")
	return err
}

type episodeAudit struct {
	ProjectID   int
	EventID     string
	ActorUserID int
	Summary     string
}

func migrateEpisodeSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS alert_episodes (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			connection_id INTEGER NOT NULL DEFAULT 0,
			connection_name VARCHAR(200) NOT NULL DEFAULT '',
			fingerprint VARCHAR(128) NOT NULL,
			sequence INTEGER NOT NULL,
			status VARCHAR(32) NOT NULL,
			severity VARCHAR(32) NOT NULL,
			incident_id INTEGER NOT NULL DEFAULT 0,
			source VARCHAR(32) NOT NULL,
			creator_user_id INTEGER NOT NULL DEFAULT 0,
			event_id VARCHAR(128) NOT NULL,
			occurrence_at VARCHAR(64) NOT NULL,
			received_at VARCHAR(64) NOT NULL,
			processed_at VARCHAR(64) NOT NULL,
			evidence_state VARCHAR(32) NOT NULL,
			problem_id INTEGER NOT NULL DEFAULT 0,
			UNIQUE (project_id, connection_id, fingerprint, sequence)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS alert_episode_events (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			episode_id INTEGER NOT NULL,
			event_id VARCHAR(128) NOT NULL,
			applied BOOLEAN NOT NULL,
			reason TEXT NOT NULL,
			UNIQUE (project_id, event_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_problems (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(64) NOT NULL,
			connection_id INTEGER NOT NULL DEFAULT 0,
			external_id VARCHAR(128) NOT NULL,
			title TEXT NOT NULL,
			symptom_key VARCHAR(128) NOT NULL,
			status VARCHAR(32) NOT NULL,
			source VARCHAR(32) NOT NULL,
			creator_user_id INTEGER NOT NULL DEFAULT 0,
			event_id VARCHAR(128) NOT NULL DEFAULT '',
			cause TEXT NOT NULL DEFAULT '',
			workaround TEXT NOT NULL DEFAULT '',
			fix_evidence TEXT NOT NULL DEFAULT '',
			verified BOOLEAN NOT NULL DEFAULT FALSE,
			separate_reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, connection_id, external_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS sre_problem_links (
			problem_id INTEGER NOT NULL,
			incident_id INTEGER NOT NULL,
			PRIMARY KEY (problem_id, incident_id)
		)
	`)
}

func loadEpisodeConnectionFromDB(id int) (episodeConnection, error) {
	if DB == nil || id <= 0 {
		return episodeConnection{}, errEpisodeHidden
	}
	var item episodeConnection
	err := DB.QueryRow(`SELECT id, project_id, name FROM connection_contracts WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Name)
	if err != nil || item.ID == 0 {
		return episodeConnection{}, errEpisodeHidden
	}
	return item, nil
}

func saveAlertEpisodeToDB(item alertEpisode) (alertEpisode, error) {
	if DB == nil {
		return alertEpisode{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO alert_episodes (
			project_id, environment, connection_id, connection_name, fingerprint, sequence, status, severity, incident_id, source, creator_user_id, event_id, occurrence_at, received_at, processed_at, evidence_state, problem_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id
	`, item.ProjectID, item.Environment, item.ConnectionID, item.ConnectionName, item.Fingerprint, item.Sequence, item.Status, item.Severity, item.IncidentID, item.Source, item.CreatorUserID, item.EventID, item.OccurrenceAt, item.ReceivedAt, item.ProcessedAt, item.EvidenceState, item.ProblemID).Scan(&item.ID)
	return item, err
}

const alertEpisodeSelect = `SELECT id, project_id, environment, connection_id, connection_name, fingerprint, sequence, status, severity, incident_id, source, creator_user_id, event_id, occurrence_at, received_at, processed_at, evidence_state, problem_id FROM alert_episodes`

func scanAlertEpisode(query string, args ...interface{}) (alertEpisode, error) {
	var item alertEpisode
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.Environment, &item.ConnectionID, &item.ConnectionName, &item.Fingerprint, &item.Sequence, &item.Status, &item.Severity, &item.IncidentID, &item.Source, &item.CreatorUserID, &item.EventID, &item.OccurrenceAt, &item.ReceivedAt, &item.ProcessedAt, &item.EvidenceState, &item.ProblemID,
	)
	return item, err
}

func findAlertEpisodeFromDB(id int) (alertEpisode, error) {
	if DB == nil || id <= 0 {
		return alertEpisode{}, errEpisodeHidden
	}
	item, err := scanAlertEpisode(alertEpisodeSelect+` WHERE id = $1`, id)
	if err != nil || item.ID == 0 {
		return alertEpisode{}, errEpisodeHidden
	}
	return item, nil
}

func latestAlertEpisodeFromDB(projectID, connectionID int, fingerprint string) (alertEpisode, error) {
	if DB == nil {
		return alertEpisode{}, nil
	}
	item, err := scanAlertEpisode(alertEpisodeSelect+` WHERE project_id = $1 AND connection_id = $2 AND fingerprint = $3 ORDER BY sequence DESC LIMIT 1`, projectID, connectionID, fingerprint)
	if err != nil {
		return alertEpisode{}, nil
	}
	return item, nil
}

func updateAlertEpisodeInDB(item alertEpisode) (alertEpisode, error) {
	if DB == nil {
		return alertEpisode{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE alert_episodes SET status = $2, event_id = $3, occurrence_at = $4, received_at = $5, processed_at = $6, evidence_state = $7, problem_id = $8 WHERE id = $1
	`, item.ID, item.Status, item.EventID, item.OccurrenceAt, item.ReceivedAt, item.ProcessedAt, item.EvidenceState, item.ProblemID)
	return item, err
}

func listAlertEpisodesFromDB(projectID int, environment string) ([]alertEpisode, error) {
	if DB == nil {
		return []alertEpisode{}, nil
	}
	rows, err := DB.Query(alertEpisodeSelect+` WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []alertEpisode{}
	for rows.Next() {
		var item alertEpisode
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.ConnectionID, &item.ConnectionName, &item.Fingerprint, &item.Sequence, &item.Status, &item.Severity, &item.IncidentID, &item.Source, &item.CreatorUserID, &item.EventID, &item.OccurrenceAt, &item.ReceivedAt, &item.ProcessedAt, &item.EvidenceState, &item.ProblemID); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func findEpisodeEventFromDB(projectID int, eventID string) (alertEpisode, error) {
	if DB == nil {
		return alertEpisode{}, nil
	}
	var episodeID int
	err := DB.QueryRow(`SELECT episode_id FROM alert_episode_events WHERE project_id = $1 AND event_id = $2`, projectID, eventID).Scan(&episodeID)
	if err != nil || episodeID == 0 {
		return alertEpisode{}, nil
	}
	return findAlertEpisodeFromDB(episodeID)
}

func saveEpisodeEventToDB(projectID, episodeID int, eventID string, applied bool, reason string) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`INSERT INTO alert_episode_events (project_id, episode_id, event_id, applied, reason) VALUES ($1,$2,$3,$4,$5)`, projectID, episodeID, eventID, applied, reason)
	return err
}

func saveSREProblemToDB(item sreProblem) (sreProblem, error) {
	if DB == nil {
		return sreProblem{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO sre_problems (
			project_id, environment, connection_id, external_id, title, symptom_key, status, source, creator_user_id, event_id, cause, workaround, fix_evidence, verified, separate_reason
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id
	`, item.ProjectID, item.Environment, item.ConnectionID, item.ExternalID, item.Title, item.SymptomKey, item.Status, item.Source, item.CreatorUserID, item.EventID, item.Cause, item.Workaround, item.FixEvidence, item.Verified, item.SeparateReason).Scan(&item.ID)
	return item, err
}

const sreProblemSelect = `SELECT id, project_id, environment, connection_id, external_id, title, symptom_key, status, source, creator_user_id, event_id, cause, workaround, fix_evidence, verified, separate_reason FROM sre_problems`

func scanSREProblem(query string, args ...interface{}) (sreProblem, error) {
	var item sreProblem
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.Environment, &item.ConnectionID, &item.ExternalID, &item.Title, &item.SymptomKey, &item.Status, &item.Source, &item.CreatorUserID, &item.EventID, &item.Cause, &item.Workaround, &item.FixEvidence, &item.Verified, &item.SeparateReason,
	)
	return item, err
}

func findSREProblemFromDB(projectID, connectionID int, externalID string) (sreProblem, error) {
	if DB == nil {
		return sreProblem{}, nil
	}
	item, err := scanSREProblem(sreProblemSelect+` WHERE project_id = $1 AND connection_id = $2 AND external_id = $3`, projectID, connectionID, externalID)
	if err != nil {
		return sreProblem{}, nil
	}
	return item, nil
}

func loadSREProblemFromDB(id int) (sreProblem, error) {
	if DB == nil || id <= 0 {
		return sreProblem{}, errEpisodeHidden
	}
	item, err := scanSREProblem(sreProblemSelect+` WHERE id = $1`, id)
	if err != nil || item.ID == 0 {
		return sreProblem{}, errEpisodeHidden
	}
	return item, nil
}

func updateSREProblemInDB(item sreProblem) (sreProblem, error) {
	if DB == nil {
		return sreProblem{}, errInboxStored
	}
	_, err := DB.Exec(`
		UPDATE sre_problems SET title = $2, status = $3, cause = $4, workaround = $5, fix_evidence = $6, verified = $7, separate_reason = $8 WHERE id = $1
	`, item.ID, item.Title, item.Status, item.Cause, item.Workaround, item.FixEvidence, item.Verified, item.SeparateReason)
	return item, err
}

func listSREProblemsFromDB(projectID int, environment string) ([]sreProblem, error) {
	if DB == nil {
		return []sreProblem{}, nil
	}
	rows, err := DB.Query(sreProblemSelect+` WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []sreProblem{}
	for rows.Next() {
		var item sreProblem
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.ConnectionID, &item.ExternalID, &item.Title, &item.SymptomKey, &item.Status, &item.Source, &item.CreatorUserID, &item.EventID, &item.Cause, &item.Workaround, &item.FixEvidence, &item.Verified, &item.SeparateReason); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveProblemLinkToDB(problemID, incidentID int) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`INSERT INTO sre_problem_links (problem_id, incident_id) VALUES ($1,$2)`, problemID, incidentID)
	return err
}

func findProblemLinkFromDB(problemID, incidentID int) (int, error) {
	if DB == nil {
		return 0, nil
	}
	var found int
	err := DB.QueryRow(`SELECT incident_id FROM sre_problem_links WHERE problem_id = $1 AND incident_id = $2`, problemID, incidentID).Scan(&found)
	if err != nil {
		return 0, nil
	}
	return found, nil
}

func listProblemLinksFromDB(problemID int) ([]int, error) {
	if DB == nil || problemID <= 0 {
		return []int{}, nil
	}
	rows, err := DB.Query(`SELECT incident_id FROM sre_problem_links WHERE problem_id = $1 ORDER BY incident_id`, problemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		list = append(list, id)
	}
	return list, rows.Err()
}

func saveEpisodeAuditToDB(item episodeAudit) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "sre_episode",
		ResourceID: item.EventID, Action: "sre_episode", Result: "success", Summary: item.Summary,
	})
	return nil
}

func alertEpisodeHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	if r.Method == http.MethodGet {
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		rows, err := listEpisodeRecords(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeEpisodeError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, rows)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	saved, err := ingestAlertEpisode(actor, decodeEpisode(r, "webhook"))
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func alertEpisodeManualHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	input := decodeEpisode(r, "ui")
	input.CreatorUserID = actor.UserID
	saved, err := ingestAlertEpisode(actor, input)
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func decodeEpisode(r *http.Request, source string) episodeInput {
	var body struct {
		ProjectID     int    `json:"project_id"`
		ConnectionID  int    `json:"connection_id"`
		Environment   string `json:"environment"`
		Fingerprint   string `json:"fingerprint"`
		Kind          string `json:"kind"`
		EventID       string `json:"event_id"`
		OccurrenceAt  string `json:"occurrence_at"`
		ReceivedAt    string `json:"received_at"`
		EvidenceState string `json:"evidence_state"`
		Severity      string `json:"severity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return episodeInput{}
	}
	return episodeInput{
		ProjectID: body.ProjectID, ConnectionID: body.ConnectionID, Environment: body.Environment, Fingerprint: body.Fingerprint,
		Kind: body.Kind, EventID: body.EventID, OccurrenceAt: body.OccurrenceAt, ReceivedAt: body.ReceivedAt,
		EvidenceState: body.EvidenceState, Severity: body.Severity, Source: source,
	}
}

func sreProblemHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	if r.Method == http.MethodGet {
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		rows, err := suggestSREProblems(actor, projectID, r.URL.Query().Get("environment"), r.URL.Query().Get("symptom_key"))
		if err != nil {
			writeEpisodeError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, rows)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		ProjectID      int    `json:"project_id"`
		Environment    string `json:"environment"`
		ConnectionID   int    `json:"connection_id"`
		ExternalID     string `json:"external_id"`
		Title          string `json:"title"`
		SymptomKey     string `json:"symptom_key"`
		Source         string `json:"source"`
		EventID        string `json:"event_id"`
		SeparateReason string `json:"separate_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEpisodeError(w, r, errEpisodeInvalid)
		return
	}
	saved, err := upsertSREProblem(actor, problemInput{
		ProjectID: body.ProjectID, Environment: body.Environment, ConnectionID: body.ConnectionID, ExternalID: body.ExternalID,
		Title: body.Title, SymptomKey: body.SymptomKey, Source: body.Source, EventID: body.EventID, CreatorUserID: actor.UserID, SeparateReason: body.SeparateReason,
	})
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreProblemLinkHandler(w http.ResponseWriter, r *http.Request) {
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
		ProblemID  int `json:"problem_id"`
		IncidentID int `json:"incident_id"`
		EpisodeID  int `json:"episode_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEpisodeError(w, r, errEpisodeInvalid)
		return
	}
	if body.EpisodeID > 0 {
		saved, err := linkEpisodeProblem(actor, body.EpisodeID, body.ProblemID)
		if err != nil {
			writeEpisodeError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusCreated, saved)
		return
	}
	saved, err := linkSREProblemIncident(actor, body.ProblemID, body.IncidentID)
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreProblemKnownErrorHandler(w http.ResponseWriter, r *http.Request) {
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
		ProblemID  int    `json:"problem_id"`
		Cause      string `json:"cause"`
		Workaround string `json:"workaround"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEpisodeError(w, r, errEpisodeInvalid)
		return
	}
	saved, err := publishKnownError(actor, body.ProblemID, body.Cause, body.Workaround)
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func sreProblemVerifyHandler(w http.ResponseWriter, r *http.Request) {
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
		ProblemID int    `json:"problem_id"`
		Evidence  string `json:"evidence"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEpisodeError(w, r, errEpisodeInvalid)
		return
	}
	saved, err := verifyProblemFix(actor, body.ProblemID, body.Evidence)
	if err != nil {
		writeEpisodeError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func writeEpisodeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errEpisodeHidden):
		writeAPIError(w, r, http.StatusNotFound, errEpisodeHidden.Error(), nil)
	case errors.Is(err, errEpisodeDenied):
		writeAPIError(w, r, http.StatusForbidden, errEpisodeDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errEpisodeInvalid.Error(), nil)
	}
}
