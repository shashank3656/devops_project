package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	errReadinessHidden  = errors.New("readiness hidden")
	errReadinessDenied  = errors.New("readiness denied")
	errReadinessInvalid = errors.New("readiness invalid")
)

type readinessSignal struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Kind        string `json:"kind"`
	Count       int    `json:"count"`
	AgeSeconds  int    `json:"age_seconds"`
	Coverage    string `json:"coverage"`
	State       string `json:"state"`
}

type readinessTarget struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	SLO         string `json:"slo"`
	RPOSeconds  int    `json:"rpo_seconds"`
	RTOSeconds  int    `json:"rto_seconds"`
	OwnerUserID int    `json:"owner_user_id"`
	State       string `json:"state"`
}

type readinessBackup struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Scope       string `json:"scope"`
	State       string `json:"state"`
}

type readinessRestore struct {
	ID             int    `json:"id"`
	BackupID       int    `json:"backup_id"`
	ProjectID      int    `json:"project_id"`
	Environment    string `json:"environment"`
	ElapsedSeconds int    `json:"elapsed_seconds"`
	LossCount      int    `json:"loss_count"`
	ElapsedSet     bool   `json:"elapsed_set"`
	LossSet        bool   `json:"loss_set"`
	State          string `json:"state"`
}

type readinessJob struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	JobKey      string `json:"job_key"`
	State       string `json:"state"`
}

type readinessAudit struct {
	ProjectID   int
	ResourceID  string
	ActorUserID int
	Summary     string
}

var (
	saveReadinessSignal    = saveReadinessSignalToDB
	loadReadinessSignal    = loadReadinessSignalFromDB
	saveReadinessTarget    = saveReadinessTargetToDB
	loadReadinessBackup    = loadReadinessBackupFromDB
	saveReadinessBackup    = saveReadinessBackupToDB
	saveReadinessRestore   = saveReadinessRestoreToDB
	loadReadinessQueue     = loadReadinessQueueFromDB
	saveReadinessQueue     = saveReadinessQueueToDB
	findReadinessJob       = findReadinessJobFromDB
	saveReadinessJobRecord = saveReadinessJobToDB
	listReadinessJobRows   = listReadinessJobsFromDB
	saveReadinessAudit     = saveReadinessAuditToDB
)

func recordReadiness(actor authzSubject, projectID int, environment, kind, coverage, detail string, count, age int, observed bool) (readinessSignal, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	kind = strings.ToLower(strings.TrimSpace(kind))
	coverage = strings.ToLower(strings.TrimSpace(coverage))
	if err := readinessAccess(actor, projectID, environment, true); err != nil || !readinessKind(kind) || readinessSensitive(detail) || strings.EqualFold(coverage, "healthy") {
		if err == nil {
			err = errReadinessInvalid
		}
		return readinessSignal{}, err
	}
	item := readinessSignal{ProjectID: projectID, Environment: environment, Kind: kind, State: "unknown", Coverage: "unknown"}
	if observed {
		if count < 0 || age < 0 || !readinessCoverage(kind, coverage) {
			return readinessSignal{}, errReadinessInvalid
		}
		item.Count = count
		item.AgeSeconds = age
		item.Coverage = coverage
		item.State = "recorded"
	}
	saved, err := saveReadinessSignal(item)
	if err != nil {
		return readinessSignal{}, err
	}
	_ = saveReadinessAudit(readinessAudit{ProjectID: projectID, ResourceID: kind + "-" + environment, ActorUserID: actor.UserID, Summary: "readiness signal saved"})
	return saved, nil
}

func saveRecoveryTarget(actor authzSubject, projectID int, environment string, rpo, rto, ownerUserID int) (readinessTarget, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := readinessAccess(actor, projectID, environment, true); err != nil || rpo <= 0 || rto <= 0 || ownerUserID <= 0 {
		if err == nil {
			err = errReadinessInvalid
		}
		return readinessTarget{}, err
	}
	item := readinessTarget{
		ProjectID: projectID, Environment: environment, SLO: "proposed",
		RPOSeconds: rpo, RTOSeconds: rto, OwnerUserID: ownerUserID, State: "proposed",
	}
	saved, err := saveReadinessTarget(item)
	if err != nil {
		return readinessTarget{}, err
	}
	_ = saveReadinessAudit(readinessAudit{ProjectID: projectID, ResourceID: "target-" + environment, ActorUserID: actor.UserID, Summary: "recovery target saved"})
	return saved, nil
}

func declareReadinessBackup(actor authzSubject, projectID int, environment, scope string) (readinessBackup, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	scope = strings.ToLower(strings.TrimSpace(scope))
	if err := readinessAccess(actor, projectID, environment, true); err != nil || (scope != "database" && scope != "evidence") {
		if err == nil {
			err = errReadinessInvalid
		}
		return readinessBackup{}, err
	}
	item := readinessBackup{ProjectID: projectID, Environment: environment, Scope: scope, State: "declared"}
	saved, err := saveReadinessBackup(item)
	if err != nil {
		return readinessBackup{}, err
	}
	_ = saveReadinessAudit(readinessAudit{ProjectID: projectID, ResourceID: "backup-" + environment, ActorUserID: actor.UserID, Summary: "backup declared"})
	return saved, nil
}

func rehearseReadiness(actor authzSubject, backupID, elapsed int, elapsedSet bool, loss int, lossSet bool) (readinessRestore, error) {
	backup, err := loadReadinessBackup(backupID)
	if err != nil || backup.ID == 0 {
		return readinessRestore{}, errReadinessHidden
	}
	if err := readinessAccess(actor, backup.ProjectID, backup.Environment, true); err != nil {
		return readinessRestore{}, err
	}
	if (elapsedSet && elapsed < 0) || (lossSet && loss < 0) {
		return readinessRestore{}, errReadinessInvalid
	}
	item := readinessRestore{
		BackupID: backup.ID, ProjectID: backup.ProjectID, Environment: backup.Environment,
		ElapsedSet: elapsedSet, LossSet: lossSet, State: "unknown",
	}
	if elapsedSet && lossSet {
		item.ElapsedSeconds = elapsed
		item.LossCount = loss
		item.State = "restored"
	}
	saved, err := saveReadinessRestore(item)
	if err != nil {
		return readinessRestore{}, err
	}
	_ = saveReadinessAudit(readinessAudit{ProjectID: backup.ProjectID, ResourceID: "restore-" + backup.Environment, ActorUserID: actor.UserID, Summary: "restore rehearsed"})
	return saved, nil
}

func setReadinessQueue(actor authzSubject, projectID int, environment string, open bool) error {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := readinessAccess(actor, projectID, environment, true); err != nil {
		return err
	}
	return saveReadinessQueue(projectID, environment, open)
}

func keepReadinessJob(actor authzSubject, projectID int, environment, jobKey string) (readinessJob, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	jobKey = strings.TrimSpace(jobKey)
	if err := readinessAccess(actor, projectID, environment, true); err != nil || !incidentToken(jobKey) {
		if err == nil {
			err = errReadinessInvalid
		}
		return readinessJob{}, err
	}
	current, err := findReadinessJob(projectID, environment, jobKey)
	if err != nil {
		return readinessJob{}, err
	}
	if current.ID > 0 {
		current.State = "queued"
		return current, nil
	}
	return saveReadinessJobRecord(readinessJob{ProjectID: projectID, Environment: environment, JobKey: jobKey, State: "queued"})
}

func reconcileReadiness(actor authzSubject, projectID int, environment string) ([]readinessJob, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := readinessAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listReadinessJobRows(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []readinessJob{}
	}
	return items, nil
}

func readinessAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errReadinessInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errReadinessHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errReadinessDenied
	}
	return nil
}

func readinessKind(kind string) bool {
	switch kind {
	case "api_error", "queue_age", "scan_coverage", "sync_lag":
		return true
	default:
		return false
	}
}

func readinessCoverage(kind, coverage string) bool {
	if kind != "scan_coverage" {
		return coverage == "" || coverage == "unknown"
	}
	switch coverage {
	case "unknown", "partial", "empty", "ready":
		return true
	default:
		return false
	}
}

func readinessSensitive(detail string) bool {
	lower := strings.ToLower(detail)
	return strings.TrimSpace(detail) != "" || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token")
}

func migrateReadinessSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_signals (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			signal_name TEXT NOT NULL,
			error_count INTEGER NOT NULL,
			age_seconds INTEGER NOT NULL,
			coverage TEXT NOT NULL,
			state TEXT NOT NULL,
			UNIQUE (project_id, environment, signal_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_targets (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			slo_label TEXT NOT NULL,
			rpo_seconds INTEGER NOT NULL,
			rto_seconds INTEGER NOT NULL,
			owner_user_id INTEGER NOT NULL,
			state TEXT NOT NULL,
			UNIQUE (project_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_backups (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			scope_name TEXT NOT NULL,
			state TEXT NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_restores (
			id SERIAL PRIMARY KEY,
			backup_id INTEGER NOT NULL,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			elapsed_seconds INTEGER NOT NULL,
			loss_count INTEGER NOT NULL,
			elapsed_set BOOLEAN NOT NULL,
			loss_set BOOLEAN NOT NULL,
			state TEXT NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_queues (
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			open_queue BOOLEAN NOT NULL,
			PRIMARY KEY (project_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS readiness_jobs (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			job_key TEXT NOT NULL,
			state TEXT NOT NULL,
			UNIQUE (project_id, environment, job_key)
		)
	`)
}

func saveReadinessSignalToDB(item readinessSignal) (readinessSignal, error) {
	if DB == nil {
		return readinessSignal{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO readiness_signals (project_id, environment, signal_name, error_count, age_seconds, coverage, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (project_id, environment, signal_name)
		DO UPDATE SET error_count = EXCLUDED.error_count, age_seconds = EXCLUDED.age_seconds, coverage = EXCLUDED.coverage, state = EXCLUDED.state
		RETURNING id
	`, item.ProjectID, item.Environment, item.Kind, item.Count, item.AgeSeconds, item.Coverage, item.State).Scan(&item.ID)
	return item, err
}

func loadReadinessSignalFromDB(projectID int, environment, kind string) (readinessSignal, error) {
	if DB == nil {
		return readinessSignal{}, errInboxStored
	}
	var item readinessSignal
	err := DB.QueryRow(`
		SELECT id, project_id, environment, signal_name, error_count, age_seconds, coverage, state
		FROM readiness_signals WHERE project_id = $1 AND environment = $2 AND signal_name = $3
	`, projectID, environment, kind).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Kind, &item.Count, &item.AgeSeconds, &item.Coverage, &item.State)
	if err != nil {
		return readinessSignal{}, nil
	}
	return item, nil
}

func saveReadinessTargetToDB(item readinessTarget) (readinessTarget, error) {
	if DB == nil {
		return readinessTarget{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO readiness_targets (project_id, environment, slo_label, rpo_seconds, rto_seconds, owner_user_id, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (project_id, environment)
		DO UPDATE SET slo_label = EXCLUDED.slo_label, rpo_seconds = EXCLUDED.rpo_seconds, rto_seconds = EXCLUDED.rto_seconds, owner_user_id = EXCLUDED.owner_user_id, state = EXCLUDED.state
		RETURNING id
	`, item.ProjectID, item.Environment, item.SLO, item.RPOSeconds, item.RTOSeconds, item.OwnerUserID, item.State).Scan(&item.ID)
	return item, err
}

func saveReadinessBackupToDB(item readinessBackup) (readinessBackup, error) {
	if DB == nil {
		return readinessBackup{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO readiness_backups (project_id, environment, scope_name, state) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.ProjectID, item.Environment, item.Scope, item.State).Scan(&item.ID)
	return item, err
}

func loadReadinessBackupFromDB(id int) (readinessBackup, error) {
	if DB == nil {
		return readinessBackup{}, errInboxStored
	}
	var item readinessBackup
	err := DB.QueryRow(`SELECT id, project_id, environment, scope_name, state FROM readiness_backups WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Scope, &item.State)
	if err != nil {
		return readinessBackup{}, nil
	}
	return item, nil
}

func saveReadinessRestoreToDB(item readinessRestore) (readinessRestore, error) {
	if DB == nil {
		return readinessRestore{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO readiness_restores (backup_id, project_id, environment, elapsed_seconds, loss_count, elapsed_set, loss_set, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
	`, item.BackupID, item.ProjectID, item.Environment, item.ElapsedSeconds, item.LossCount, item.ElapsedSet, item.LossSet, item.State).Scan(&item.ID)
	return item, err
}

func loadReadinessQueueFromDB(projectID int, environment string) (bool, error) {
	if DB == nil {
		return true, errInboxStored
	}
	var open bool
	err := DB.QueryRow(`SELECT open_queue FROM readiness_queues WHERE project_id = $1 AND environment = $2`, projectID, environment).Scan(&open)
	if err != nil {
		return true, nil
	}
	return open, nil
}

func saveReadinessQueueToDB(projectID int, environment string, open bool) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO readiness_queues (project_id, environment, open_queue) VALUES ($1,$2,$3)
		ON CONFLICT (project_id, environment) DO UPDATE SET open_queue = EXCLUDED.open_queue
	`, projectID, environment, open)
	return err
}

func findReadinessJobFromDB(projectID int, environment, jobKey string) (readinessJob, error) {
	if DB == nil {
		return readinessJob{}, errInboxStored
	}
	var item readinessJob
	err := DB.QueryRow(`
		SELECT id, project_id, environment, job_key, state FROM readiness_jobs
		WHERE project_id = $1 AND environment = $2 AND job_key = $3
	`, projectID, environment, jobKey).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.JobKey, &item.State)
	if err != nil {
		return readinessJob{}, nil
	}
	return item, nil
}

func saveReadinessJobToDB(item readinessJob) (readinessJob, error) {
	if DB == nil {
		return readinessJob{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO readiness_jobs (project_id, environment, job_key, state) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.ProjectID, item.Environment, item.JobKey, item.State).Scan(&item.ID)
	return item, err
}

func listReadinessJobsFromDB(projectID int, environment string) ([]readinessJob, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, job_key, state FROM readiness_jobs WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []readinessJob
	for rows.Next() {
		var item readinessJob
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.JobKey, &item.State); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveReadinessAuditToDB(item readinessAudit) error {
	if DB == nil {
		return nil
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "readiness_signal",
		ResourceID: item.ResourceID, Action: "readiness_signal", Result: "success", Summary: item.Summary,
	})
	return nil
}

func readinessSignalHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Kind        string `json:"kind"`
		Coverage    string `json:"coverage"`
		Detail      string `json:"detail"`
		Count       int    `json:"count"`
		AgeSeconds  int    `json:"age_seconds"`
		Observed    bool   `json:"observed"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	item, err := recordReadiness(actor, body.ProjectID, body.Environment, body.Kind, body.Coverage, body.Detail, body.Count, body.AgeSeconds, body.Observed)
	if err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, item)
}

func readinessTargetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		RPOSeconds  int    `json:"rpo_seconds"`
		RTOSeconds  int    `json:"rto_seconds"`
		OwnerUserID int    `json:"owner_user_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	item, err := saveRecoveryTarget(actor, body.ProjectID, body.Environment, body.RPOSeconds, body.RTOSeconds, body.OwnerUserID)
	if err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, item)
}

func readinessBackupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Scope       string `json:"scope"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	item, err := declareReadinessBackup(actor, body.ProjectID, body.Environment, body.Scope)
	if err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, item)
}

func readinessRestoreHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	var body struct {
		BackupID   int  `json:"backup_id"`
		Elapsed    int  `json:"elapsed_seconds"`
		ElapsedSet bool `json:"elapsed_set"`
		Loss       int  `json:"loss_count"`
		LossSet    bool `json:"loss_set"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	item, err := rehearseReadiness(actor, body.BackupID, body.Elapsed, body.ElapsedSet, body.Loss, body.LossSet)
	if err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, item)
}

func readinessQueueHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Open        bool   `json:"open"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	if err := setReadinessQueue(actor, body.ProjectID, body.Environment, body.Open); err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, map[string]bool{"open": body.Open})
}

func readinessJobHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeReadinessError(w, errReadinessHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		raw := r.URL.Query().Get("project_id")
		for _, ch := range raw {
			if ch < '0' || ch > '9' {
				writeReadinessError(w, errReadinessInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := reconcileReadiness(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeReadinessError(w, err)
			return
		}
		writeReadinessJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		JobKey      string `json:"job_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeReadinessError(w, errReadinessInvalid)
		return
	}
	item, err := keepReadinessJob(actor, body.ProjectID, body.Environment, body.JobKey)
	if err != nil {
		writeReadinessError(w, err)
		return
	}
	writeReadinessJSON(w, item)
}

func writeReadinessJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeReadinessError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errReadinessHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errReadinessDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "readiness request failed"})
}
