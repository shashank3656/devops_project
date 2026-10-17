package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	failureLogMissing = "missing"
	failureLogLinked  = "linked"
	failureGapLogs    = "logs are missing"
	failureRetainDays = 30
	failureRetainMax  = 90
)

var (
	errFailureHidden  = errors.New("pod failure not found")
	errFailureDenied  = errors.New("pod failure is not permitted")
	errFailureInvalid = errors.New("pod failure is invalid")
	podUIDPattern     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	failureClock      = func() time.Time { return time.Now().UTC() }
)

type podFailure struct {
	ID             int               `json:"id"`
	ProjectID      int               `json:"project_id"`
	Namespace      string            `json:"namespace"`
	PodUID         string            `json:"pod_uid"`
	ExitReason     string            `json:"exit_reason"`
	StartedAt      string            `json:"started_at"`
	FinishedAt     string            `json:"finished_at"`
	Workload       string            `json:"workload"`
	Revision       string            `json:"revision"`
	ImageDigest    string            `json:"image_digest"`
	PodPresent     bool              `json:"pod_present"`
	LogState       string            `json:"log_state"`
	LogLink        string            `json:"log_link"`
	Retention      string            `json:"retention"`
	WriteRequested bool              `json:"write_requested"`
	Events         []podFailureEvent `json:"events"`
	Gaps           []podFailureGap   `json:"gaps"`
}

type podFailureEvent struct {
	ID         int    `json:"id"`
	FailureID  int    `json:"failure_id"`
	EventUID   string `json:"event_uid"`
	Reason     string `json:"reason"`
	ObservedAt string `json:"observed_at"`
}

type podFailureGap struct {
	ID        int    `json:"id"`
	FailureID int    `json:"failure_id"`
	Reason    string `json:"reason"`
}

type podFailureInput struct {
	ProjectID   int
	Namespace   string
	PodUID      string
	ExitReason  string
	StartedAt   string
	FinishedAt  string
	Workload    string
	Revision    string
	ImageDigest string
	Mutate      bool
}

var (
	savePodFailure       = savePodFailureToDB
	findPodFailure       = findPodFailureFromDB
	loadPodFailure       = loadPodFailureFromDB
	updatePodFailureLogs = updatePodFailureLogsInDB
	listPodFailures      = listPodFailuresFromDB
	saveFailureEvent     = saveFailureEventToDB
	findFailureEvent     = findFailureEventFromDB
	listFailureEvents    = listFailureEventsFromDB
	saveFailureGap       = saveFailureGapToDB
	findFailureGap       = findFailureGapFromDB
	listFailureGaps      = listFailureGapsFromDB
	saveFailureRetention = saveFailureRetentionToDB
	loadFailureRetention = loadFailureRetentionFromDB
	saveFailureAudit     = saveFailureAuditToDB
)

func recordPodFailure(actor authzSubject, input podFailureInput) (podFailure, error) {
	if input.Mutate {
		return podFailure{}, errFailureInvalid
	}
	if input.ProjectID <= 0 {
		return podFailure{}, errFailureHidden
	}
	namespace := strings.ToLower(strings.TrimSpace(input.Namespace))
	if !singleEnvironment(namespace) {
		return podFailure{}, errFailureInvalid
	}
	if !catalogEnvironmentsAllowed(actor, input.ProjectID, []string{namespace}, authzRead) {
		return podFailure{}, errFailureHidden
	}
	if !catalogEnvironmentsAllowed(actor, input.ProjectID, []string{namespace}, authzWrite) {
		return podFailure{}, errFailureDenied
	}
	item, err := normalizePodFailure(input, namespace)
	if err != nil {
		return podFailure{}, err
	}
	existing, err := findPodFailure(item.ProjectID, item.Namespace, item.PodUID)
	if err != nil {
		return podFailure{}, err
	}
	if existing.ID > 0 {
		return presentPodFailure(existing)
	}
	saved, err := savePodFailure(item)
	if err != nil {
		return podFailure{}, err
	}
	_ = saveFailureAudit(failureAuditRecord{ProjectID: saved.ProjectID, PodUID: saved.PodUID, ActorUserID: actor.UserID, Summary: "pod failure retained"})
	return presentPodFailure(saved)
}

func normalizePodFailure(input podFailureInput, namespace string) (podFailure, error) {
	item := podFailure{
		ProjectID: input.ProjectID, Namespace: namespace, PodUID: strings.ToLower(strings.TrimSpace(input.PodUID)),
		ExitReason: strings.TrimSpace(input.ExitReason), StartedAt: strings.TrimSpace(input.StartedAt), FinishedAt: strings.TrimSpace(input.FinishedAt),
		Workload: strings.TrimSpace(input.Workload), Revision: strings.TrimSpace(input.Revision), ImageDigest: strings.TrimSpace(input.ImageDigest),
		LogState: failureLogMissing,
	}
	if !podUIDPattern.MatchString(item.PodUID) || item.ExitReason == "" || strings.EqualFold(item.ExitReason, "healthy") || len(item.ExitReason) > 500 {
		return podFailure{}, errFailureInvalid
	}
	if _, err := time.Parse(time.RFC3339, item.StartedAt); err != nil {
		return podFailure{}, errFailureInvalid
	}
	if _, err := time.Parse(time.RFC3339, item.FinishedAt); err != nil {
		return podFailure{}, errFailureInvalid
	}
	if item.Workload == "" || strings.ContainsAny(item.Workload, " \n") || len(item.Workload) > 128 || item.Revision == "" || len(item.Revision) > 128 {
		return podFailure{}, errFailureInvalid
	}
	if !artifactDigestPattern.MatchString(item.ImageDigest) {
		return podFailure{}, errFailureInvalid
	}
	return item, nil
}

func presentPodFailure(item podFailure) (podFailure, error) {
	item.WriteRequested = false
	item.PodPresent = false
	if strings.TrimSpace(item.LogLink) == "" {
		item.LogState = failureLogMissing
		item.LogLink = ""
	}
	if item.Events == nil {
		events, err := listFailureEvents(item.ID)
		if err != nil {
			return podFailure{}, err
		}
		item.Events = events
	}
	if item.Gaps == nil {
		gaps, err := listFailureGaps(item.ID)
		if err != nil {
			return podFailure{}, err
		}
		item.Gaps = gaps
	}
	if item.Events == nil {
		item.Events = []podFailureEvent{}
	}
	if item.Gaps == nil {
		item.Gaps = []podFailureGap{}
	}
	days, err := retentionWindow(item.ProjectID, item.Namespace)
	if err != nil {
		return podFailure{}, err
	}
	item.Retention = "active"
	if failureExpired(item.FinishedAt, days, failureClock()) {
		item.Retention = "expired"
	}
	return item, nil
}

func recordFailureEvent(actor authzSubject, failureID int, eventUID, reason, observedAt string) (podFailureEvent, error) {
	current, err := authorizedFailure(actor, failureID, true)
	if err != nil {
		return podFailureEvent{}, err
	}
	eventUID = strings.ToLower(strings.TrimSpace(eventUID))
	reason = strings.TrimSpace(reason)
	observedAt = strings.TrimSpace(observedAt)
	if !podUIDPattern.MatchString(eventUID) || reason == "" || strings.EqualFold(reason, "healthy") || len(reason) > 500 {
		return podFailureEvent{}, errFailureInvalid
	}
	if _, err := time.Parse(time.RFC3339, observedAt); err != nil {
		return podFailureEvent{}, errFailureInvalid
	}
	existing, err := findFailureEvent(current.ID, eventUID)
	if err != nil {
		return podFailureEvent{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	return saveFailureEvent(podFailureEvent{FailureID: current.ID, EventUID: eventUID, Reason: reason, ObservedAt: observedAt})
}

func recordFailureLogs(actor authzSubject, failureID int, link string) (podFailure, error) {
	current, err := authorizedFailure(actor, failureID, true)
	if err != nil {
		return podFailure{}, err
	}
	link = strings.TrimSpace(link)
	if strings.EqualFold(link, "healthy") || strings.Contains(link, "\n") || len(link) > 500 {
		return podFailure{}, errFailureInvalid
	}
	if link == "" {
		current.LogState = failureLogMissing
		current.LogLink = ""
	} else {
		current.LogState = failureLogLinked
		current.LogLink = link
	}
	updated, err := updatePodFailureLogs(current)
	if err != nil {
		return podFailure{}, err
	}
	if link == "" {
		if _, err := ensureFailureGap(updated.ID, failureGapLogs); err != nil {
			return podFailure{}, err
		}
	}
	return presentPodFailure(updated)
}

func recordFailureGap(actor authzSubject, failureID int, reason string) (podFailureGap, error) {
	current, err := authorizedFailure(actor, failureID, true)
	if err != nil {
		return podFailureGap{}, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.EqualFold(reason, "healthy") || len(reason) > 500 {
		return podFailureGap{}, errFailureInvalid
	}
	return ensureFailureGap(current.ID, reason)
}

func ensureFailureGap(failureID int, reason string) (podFailureGap, error) {
	existing, err := findFailureGap(failureID, reason)
	if err != nil {
		return podFailureGap{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	return saveFailureGap(podFailureGap{FailureID: failureID, Reason: reason})
}

func setFailureRetention(actor authzSubject, projectID int, namespace string, days int) (int, error) {
	if projectID <= 0 {
		return 0, errFailureHidden
	}
	namespace = strings.ToLower(strings.TrimSpace(namespace))
	if !singleEnvironment(namespace) {
		return 0, errFailureInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{namespace}, authzRead) {
		return 0, errFailureHidden
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{namespace}, authzWrite) {
		return 0, errFailureDenied
	}
	if days < 1 || days > failureRetainMax {
		return 0, errFailureInvalid
	}
	if err := saveFailureRetention(projectID, namespace, days); err != nil {
		return 0, err
	}
	return days, nil
}

func readPodFailure(actor authzSubject, projectID int, namespace, podUID string) (podFailure, error) {
	if projectID <= 0 {
		return podFailure{}, errFailureHidden
	}
	namespace = strings.ToLower(strings.TrimSpace(namespace))
	podUID = strings.ToLower(strings.TrimSpace(podUID))
	if !singleEnvironment(namespace) || !podUIDPattern.MatchString(podUID) {
		return podFailure{}, errFailureInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{namespace}, authzRead) {
		return podFailure{}, errFailureHidden
	}
	item, err := findPodFailure(projectID, namespace, podUID)
	if err != nil || item.ID == 0 {
		return podFailure{}, errFailureHidden
	}
	return presentPodFailure(item)
}

func failureHistory(actor authzSubject, projectID int, namespace string) ([]podFailure, error) {
	if projectID <= 0 {
		return nil, errFailureHidden
	}
	namespace = strings.ToLower(strings.TrimSpace(namespace))
	if !singleEnvironment(namespace) {
		return nil, errFailureInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{namespace}, authzRead) {
		return nil, errFailureHidden
	}
	rows, err := listPodFailures(projectID, namespace)
	if err != nil {
		return nil, err
	}
	history := []podFailure{}
	for _, item := range rows {
		presented, err := presentPodFailure(item)
		if err != nil {
			return nil, err
		}
		if presented.Retention == "expired" {
			continue
		}
		history = append(history, presented)
	}
	return history, nil
}

func authorizedFailure(actor authzSubject, failureID int, write bool) (podFailure, error) {
	current, err := loadPodFailure(failureID)
	if err != nil || current.ID == 0 {
		return podFailure{}, errFailureHidden
	}
	if !catalogEnvironmentsAllowed(actor, current.ProjectID, []string{current.Namespace}, authzRead) {
		return podFailure{}, errFailureHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, current.ProjectID, []string{current.Namespace}, authzWrite) {
		return podFailure{}, errFailureDenied
	}
	return current, nil
}

func retentionWindow(projectID int, namespace string) (int, error) {
	days, err := loadFailureRetention(projectID, namespace)
	if err != nil {
		return 0, err
	}
	if days < 1 || days > failureRetainMax {
		return failureRetainDays, nil
	}
	return days, nil
}

func failureExpired(finishedAt string, days int, now time.Time) bool {
	finished, err := time.Parse(time.RFC3339, finishedAt)
	if err != nil {
		return true
	}
	return finished.Before(now.Add(-time.Duration(days) * 24 * time.Hour))
}

type failureAuditRecord struct {
	ProjectID   int
	PodUID      string
	ActorUserID int
	Summary     string
}

func migratePodFailureSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pod_failures (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			namespace VARCHAR(64) NOT NULL,
			pod_uid VARCHAR(64) NOT NULL,
			exit_reason TEXT NOT NULL,
			started_at VARCHAR(64) NOT NULL,
			finished_at VARCHAR(64) NOT NULL,
			workload VARCHAR(128) NOT NULL,
			revision VARCHAR(128) NOT NULL,
			image_digest VARCHAR(80) NOT NULL,
			pod_present BOOLEAN NOT NULL DEFAULT FALSE,
			log_state VARCHAR(32) NOT NULL,
			log_link TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, namespace, pod_uid)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pod_failure_events (
			id SERIAL PRIMARY KEY,
			failure_id INTEGER NOT NULL,
			event_uid VARCHAR(64) NOT NULL,
			reason TEXT NOT NULL,
			observed_at VARCHAR(64) NOT NULL,
			UNIQUE (failure_id, event_uid)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pod_failure_gaps (
			id SERIAL PRIMARY KEY,
			failure_id INTEGER NOT NULL,
			reason TEXT NOT NULL,
			UNIQUE (failure_id, reason)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS pod_failure_retention (
			project_id INTEGER NOT NULL,
			namespace VARCHAR(64) NOT NULL,
			retain_days INTEGER NOT NULL,
			PRIMARY KEY (project_id, namespace)
		)
	`)
}

func savePodFailureToDB(item podFailure) (podFailure, error) {
	if DB == nil {
		return podFailure{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO pod_failures (
			project_id, namespace, pod_uid, exit_reason, started_at, finished_at, workload, revision, image_digest, pod_present, log_state, log_link
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,$11) RETURNING id
	`, item.ProjectID, item.Namespace, item.PodUID, item.ExitReason, item.StartedAt, item.FinishedAt, item.Workload, item.Revision, item.ImageDigest, item.LogState, item.LogLink).Scan(&item.ID)
	return item, err
}

const podFailureSelect = `SELECT id, project_id, namespace, pod_uid, exit_reason, started_at, finished_at, workload, revision, image_digest, pod_present, log_state, log_link FROM pod_failures`

func scanPodFailure(query string, args ...interface{}) (podFailure, error) {
	var item podFailure
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.ProjectID, &item.Namespace, &item.PodUID, &item.ExitReason, &item.StartedAt, &item.FinishedAt,
		&item.Workload, &item.Revision, &item.ImageDigest, &item.PodPresent, &item.LogState, &item.LogLink,
	)
	return item, err
}

func findPodFailureFromDB(projectID int, namespace, podUID string) (podFailure, error) {
	if DB == nil {
		return podFailure{}, nil
	}
	item, err := scanPodFailure(podFailureSelect+` WHERE project_id = $1 AND namespace = $2 AND pod_uid = $3`, projectID, namespace, podUID)
	if err != nil {
		return podFailure{}, nil
	}
	return item, nil
}

func loadPodFailureFromDB(id int) (podFailure, error) {
	if DB == nil || id <= 0 {
		return podFailure{}, errFailureHidden
	}
	item, err := scanPodFailure(podFailureSelect+` WHERE id = $1`, id)
	if err != nil || item.ID == 0 {
		return podFailure{}, errFailureHidden
	}
	return item, nil
}

func updatePodFailureLogsInDB(item podFailure) (podFailure, error) {
	if DB == nil {
		return podFailure{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE pod_failures SET log_state = $2, log_link = $3, pod_present = FALSE WHERE id = $1`, item.ID, item.LogState, item.LogLink)
	return item, err
}

func listPodFailuresFromDB(projectID int, namespace string) ([]podFailure, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(podFailureSelect+` WHERE project_id = $1 AND namespace = $2 ORDER BY id`, projectID, namespace)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []podFailure{}
	for rows.Next() {
		var item podFailure
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.Namespace, &item.PodUID, &item.ExitReason, &item.StartedAt, &item.FinishedAt,
			&item.Workload, &item.Revision, &item.ImageDigest, &item.PodPresent, &item.LogState, &item.LogLink,
		); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveFailureEventToDB(item podFailureEvent) (podFailureEvent, error) {
	if DB == nil {
		return podFailureEvent{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO pod_failure_events (failure_id, event_uid, reason, observed_at) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.FailureID, item.EventUID, item.Reason, item.ObservedAt).Scan(&item.ID)
	return item, err
}

func findFailureEventFromDB(failureID int, eventUID string) (podFailureEvent, error) {
	if DB == nil {
		return podFailureEvent{}, nil
	}
	var item podFailureEvent
	err := DB.QueryRow(`SELECT id, failure_id, event_uid, reason, observed_at FROM pod_failure_events WHERE failure_id = $1 AND event_uid = $2`, failureID, eventUID).Scan(&item.ID, &item.FailureID, &item.EventUID, &item.Reason, &item.ObservedAt)
	if err != nil {
		return podFailureEvent{}, nil
	}
	return item, nil
}

func listFailureEventsFromDB(failureID int) ([]podFailureEvent, error) {
	if DB == nil || failureID <= 0 {
		return []podFailureEvent{}, nil
	}
	rows, err := DB.Query(`SELECT id, failure_id, event_uid, reason, observed_at FROM pod_failure_events WHERE failure_id = $1 ORDER BY id`, failureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []podFailureEvent{}
	for rows.Next() {
		var item podFailureEvent
		if err := rows.Scan(&item.ID, &item.FailureID, &item.EventUID, &item.Reason, &item.ObservedAt); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveFailureGapToDB(item podFailureGap) (podFailureGap, error) {
	if DB == nil {
		return podFailureGap{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO pod_failure_gaps (failure_id, reason) VALUES ($1,$2) RETURNING id`, item.FailureID, item.Reason).Scan(&item.ID)
	return item, err
}

func findFailureGapFromDB(failureID int, reason string) (podFailureGap, error) {
	if DB == nil {
		return podFailureGap{}, nil
	}
	var item podFailureGap
	err := DB.QueryRow(`SELECT id, failure_id, reason FROM pod_failure_gaps WHERE failure_id = $1 AND reason = $2`, failureID, reason).Scan(&item.ID, &item.FailureID, &item.Reason)
	if err != nil {
		return podFailureGap{}, nil
	}
	return item, nil
}

func listFailureGapsFromDB(failureID int) ([]podFailureGap, error) {
	if DB == nil || failureID <= 0 {
		return []podFailureGap{}, nil
	}
	rows, err := DB.Query(`SELECT id, failure_id, reason FROM pod_failure_gaps WHERE failure_id = $1 ORDER BY id`, failureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []podFailureGap{}
	for rows.Next() {
		var item podFailureGap
		if err := rows.Scan(&item.ID, &item.FailureID, &item.Reason); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func saveFailureRetentionToDB(projectID int, namespace string, days int) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO pod_failure_retention (project_id, namespace, retain_days) VALUES ($1,$2,$3)
		ON CONFLICT (project_id, namespace) DO UPDATE SET retain_days = EXCLUDED.retain_days
	`, projectID, namespace, days)
	return err
}

func loadFailureRetentionFromDB(projectID int, namespace string) (int, error) {
	if DB == nil {
		return 0, nil
	}
	var days int
	err := DB.QueryRow(`SELECT retain_days FROM pod_failure_retention WHERE project_id = $1 AND namespace = $2`, projectID, namespace).Scan(&days)
	if err != nil {
		return 0, nil
	}
	return days, nil
}

func saveFailureAuditToDB(item failureAuditRecord) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "pod_failure",
		ResourceID: item.PodUID, Action: "pod_failure", Result: "success", Summary: item.Summary,
	})
	return nil
}

func podFailureHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	if r.Method == http.MethodGet {
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		item, err := readPodFailure(actor, projectID, r.URL.Query().Get("namespace"), r.URL.Query().Get("pod_uid"))
		if err != nil {
			writeFailureError(w, r, err)
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
		Namespace   string `json:"namespace"`
		PodUID      string `json:"pod_uid"`
		ExitReason  string `json:"exit_reason"`
		StartedAt   string `json:"started_at"`
		FinishedAt  string `json:"finished_at"`
		Workload    string `json:"workload"`
		Revision    string `json:"revision"`
		ImageDigest string `json:"image_digest"`
		Mutate      bool   `json:"mutate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFailureError(w, r, errFailureInvalid)
		return
	}
	saved, err := recordPodFailure(actor, podFailureInput{
		ProjectID: body.ProjectID, Namespace: body.Namespace, PodUID: body.PodUID, ExitReason: body.ExitReason,
		StartedAt: body.StartedAt, FinishedAt: body.FinishedAt, Workload: body.Workload, Revision: body.Revision,
		ImageDigest: body.ImageDigest, Mutate: body.Mutate,
	})
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func podFailureEventHandler(w http.ResponseWriter, r *http.Request) {
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
		FailureID  int    `json:"failure_id"`
		EventUID   string `json:"event_uid"`
		Reason     string `json:"reason"`
		ObservedAt string `json:"observed_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFailureError(w, r, errFailureInvalid)
		return
	}
	saved, err := recordFailureEvent(actor, body.FailureID, body.EventUID, body.Reason, body.ObservedAt)
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func podFailureLogHandler(w http.ResponseWriter, r *http.Request) {
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
		FailureID int    `json:"failure_id"`
		LogLink   string `json:"log_link"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFailureError(w, r, errFailureInvalid)
		return
	}
	saved, err := recordFailureLogs(actor, body.FailureID, body.LogLink)
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func podFailureGapHandler(w http.ResponseWriter, r *http.Request) {
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
		FailureID int    `json:"failure_id"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFailureError(w, r, errFailureInvalid)
		return
	}
	saved, err := recordFailureGap(actor, body.FailureID, body.Reason)
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func podFailureRetentionHandler(w http.ResponseWriter, r *http.Request) {
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
		Namespace  string `json:"namespace"`
		RetainDays int    `json:"retain_days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFailureError(w, r, errFailureInvalid)
		return
	}
	days, err := setFailureRetention(actor, body.ProjectID, body.Namespace, body.RetainDays)
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, map[string]interface{}{"project_id": body.ProjectID, "namespace": strings.ToLower(strings.TrimSpace(body.Namespace)), "retain_days": days})
}

func podFailureHistoryHandler(w http.ResponseWriter, r *http.Request) {
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
	history, err := failureHistory(actor, projectID, r.URL.Query().Get("namespace"))
	if err != nil {
		writeFailureError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, history)
}

func writeFailureError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errFailureHidden):
		writeAPIError(w, r, http.StatusNotFound, errFailureHidden.Error(), nil)
	case errors.Is(err, errFailureDenied):
		writeAPIError(w, r, http.StatusForbidden, errFailureDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errFailureInvalid.Error(), nil)
	}
}
