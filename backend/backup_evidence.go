package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	errBackupHidden  = errors.New("backup hidden")
	errBackupDenied  = errors.New("backup denied")
	errBackupInvalid = errors.New("backup invalid")
)

type backupRecord struct {
	ID            int    `json:"id"`
	ProjectID     int    `json:"project_id"`
	Environment   string `json:"environment"`
	Service       string `json:"service"`
	Scope         string `json:"scope"`
	Provider      string `json:"provider"`
	RetentionDays int    `json:"retention_days"`
	State         string `json:"state"`
	Verified      bool   `json:"verified"`
	Observed      string `json:"observed"`
	Applied       bool   `json:"applied"`
}

type backupDependency struct {
	ID       int    `json:"id"`
	BackupID int    `json:"backup_id"`
	Service  string `json:"service"`
	Applied  bool   `json:"applied"`
}

type backupDrill struct {
	ID              int    `json:"id"`
	BackupID        int    `json:"backup_id"`
	ReviewerID      int    `json:"reviewer_id"`
	AssigneeID      int    `json:"assignee_id"`
	Isolated        bool   `json:"isolated"`
	SampleValid     bool   `json:"sample_valid"`
	DurationSeconds int    `json:"duration_seconds"`
	DurationSet     bool   `json:"duration_set"`
	DataGap         int    `json:"data_gap"`
	GapSet          bool   `json:"gap_set"`
	State           string `json:"state"`
	FollowUp        bool   `json:"follow_up"`
	CanLaunch       bool   `json:"can_launch"`
	Applied         bool   `json:"applied"`
}

var (
	findBackupRecord     = findBackupRecordFromDB
	saveBackupRecord     = saveBackupRecordToDB
	loadBackupRecord     = loadBackupRecordFromDB
	updateBackupRecord   = updateBackupRecordToDB
	listBackupRecords    = listBackupRecordsFromDB
	findBackupDependency = findBackupDependencyFromDB
	saveBackupDependency = saveBackupDependencyToDB
	findBackupDrill      = findBackupDrillFromDB
	saveBackupDrill      = saveBackupDrillToDB
	saveBackupAudit      = saveBackupAuditToDB
)

func recordBackupEvidence(actor authzSubject, projectID int, environment, service, scope, provider string, retentionDays int) (backupRecord, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	service = strings.TrimSpace(service)
	scope = strings.ToLower(strings.TrimSpace(scope))
	provider = strings.ToLower(strings.TrimSpace(provider))
	if err := backupAccess(actor, projectID, environment, true); err != nil || !incidentToken(service) || !backupScope(scope) || provider != "sandbox" || retentionDays <= 0 || pilotSensitive(service) {
		if err == nil {
			err = errBackupInvalid
		}
		return backupRecord{}, err
	}
	current, err := findBackupRecord(projectID, environment, service, scope)
	if err != nil {
		return backupRecord{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	item := backupRecord{ProjectID: projectID, Environment: environment, Service: service, Scope: scope, Provider: provider, RetentionDays: retentionDays, State: "succeeded", Observed: "unknown"}
	saved, err := saveBackupRecord(item)
	if err != nil {
		return backupRecord{}, err
	}
	_ = saveBackupAudit(projectID, service, actor.UserID, "backup evidence recorded")
	return saved, nil
}

func linkBackupService(actor authzSubject, backupID int, service string) (backupDependency, error) {
	service = strings.TrimSpace(service)
	item, err := loadBackupRecord(backupID)
	if err != nil || item.ID == 0 {
		return backupDependency{}, errBackupHidden
	}
	if err := backupAccess(actor, item.ProjectID, item.Environment, true); err != nil || !incidentToken(service) || pilotSensitive(service) || service == item.Service {
		if err == nil {
			err = errBackupInvalid
		}
		return backupDependency{}, err
	}
	current, err := findBackupDependency(item.ID, service)
	if err != nil {
		return backupDependency{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	return saveBackupDependency(backupDependency{BackupID: item.ID, Service: service})
}

func recordBackupDrill(actor authzSubject, backupID, reviewerID int, isolated, sampleValid, durationSet bool, duration int, gapSet bool, gap int, outcome string) (backupDrill, error) {
	outcome = strings.ToLower(strings.TrimSpace(outcome))
	item, err := loadBackupRecord(backupID)
	if err != nil || item.ID == 0 {
		return backupDrill{}, errBackupHidden
	}
	if err := backupAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return backupDrill{}, err
	}
	if !isolated || reviewerID <= 0 || reviewerID == actor.UserID || !backupOutcome(outcome) || duration < 0 || gap < 0 || pilotSensitive(outcome) {
		return backupDrill{}, errBackupInvalid
	}
	current, err := findBackupDrill(item.ID)
	if err != nil {
		return backupDrill{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		current.CanLaunch = false
		return current, nil
	}
	drill := backupDrill{BackupID: item.ID, ReviewerID: reviewerID, Isolated: true, SampleValid: sampleValid, DurationSet: durationSet, GapSet: gapSet}
	if durationSet {
		drill.DurationSeconds = duration
	}
	if gapSet {
		drill.DataGap = gap
	}
	switch outcome {
	case "failed":
		drill.State = "failed"
		drill.FollowUp = true
		drill.AssigneeID = reviewerID
	default:
		if !sampleValid && durationSet && gapSet {
			drill.State = "unverified"
		} else if !sampleValid || !durationSet || !gapSet {
			drill.State = "unknown"
		} else {
			drill.State = "restored"
		}
	}
	saved, err := saveBackupDrill(drill)
	if err != nil {
		return backupDrill{}, err
	}
	if saved.State == "restored" {
		item.Verified = true
		if _, err := updateBackupRecord(item); err != nil {
			return backupDrill{}, err
		}
	}
	_ = saveBackupAudit(item.ProjectID, item.Service, actor.UserID, "backup drill recorded")
	return saved, nil
}

func readBackupEvidence(actor authzSubject, projectID int, environment string) ([]backupRecord, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := backupAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listBackupRecords(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []backupRecord{}
	}
	return items, nil
}

func backupAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errBackupInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errBackupHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errBackupDenied
	}
	return nil
}

func backupScope(scope string) bool {
	return scope == "database" || scope == "evidence"
}

func backupOutcome(outcome string) bool {
	return outcome == "succeeded" || outcome == "failed"
}

func migrateBackupSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS backup_records (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			service_key TEXT NOT NULL,
			scope_name TEXT NOT NULL,
			provider_name TEXT NOT NULL,
			retention_days INTEGER NOT NULL,
			state TEXT NOT NULL,
			verified BOOLEAN NOT NULL,
			observed TEXT NOT NULL,
			UNIQUE (project_id, environment, service_key, scope_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS backup_dependencies (
			id SERIAL PRIMARY KEY,
			backup_id INTEGER NOT NULL,
			service_key TEXT NOT NULL,
			UNIQUE (backup_id, service_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS backup_drills (
			id SERIAL PRIMARY KEY,
			backup_id INTEGER NOT NULL UNIQUE,
			reviewer_id INTEGER NOT NULL,
			assignee_id INTEGER NOT NULL DEFAULT 0,
			isolated BOOLEAN NOT NULL,
			sample_valid BOOLEAN NOT NULL,
			duration_seconds INTEGER NOT NULL DEFAULT 0,
			duration_set BOOLEAN NOT NULL,
			data_gap INTEGER NOT NULL DEFAULT 0,
			gap_set BOOLEAN NOT NULL,
			state TEXT NOT NULL,
			follow_up BOOLEAN NOT NULL
		)
	`)
}

func findBackupRecordFromDB(projectID int, environment, service, scope string) (backupRecord, error) {
	if DB == nil {
		return backupRecord{}, errInboxStored
	}
	var item backupRecord
	err := DB.QueryRow(`SELECT id, project_id, environment, service_key, scope_name, provider_name, retention_days, state, verified, observed FROM backup_records WHERE project_id = $1 AND environment = $2 AND service_key = $3 AND scope_name = $4`, projectID, environment, service, scope).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Scope, &item.Provider, &item.RetentionDays, &item.State, &item.Verified, &item.Observed)
	if err != nil {
		return backupRecord{}, nil
	}
	return item, nil
}

func saveBackupRecordToDB(item backupRecord) (backupRecord, error) {
	if DB == nil {
		return backupRecord{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO backup_records (project_id, environment, service_key, scope_name, provider_name, retention_days, state, verified, observed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, item.ProjectID, item.Environment, item.Service, item.Scope, item.Provider, item.RetentionDays, item.State, item.Verified, item.Observed).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func loadBackupRecordFromDB(id int) (backupRecord, error) {
	if DB == nil {
		return backupRecord{}, errInboxStored
	}
	var item backupRecord
	err := DB.QueryRow(`SELECT id, project_id, environment, service_key, scope_name, provider_name, retention_days, state, verified, observed FROM backup_records WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Scope, &item.Provider, &item.RetentionDays, &item.State, &item.Verified, &item.Observed)
	if err != nil {
		return backupRecord{}, nil
	}
	return item, nil
}

func updateBackupRecordToDB(item backupRecord) (backupRecord, error) {
	if DB == nil {
		return backupRecord{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE backup_records SET verified = $2 WHERE id = $1`, item.ID, item.Verified)
	return item, err
}

func listBackupRecordsFromDB(projectID int, environment string) ([]backupRecord, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, service_key, scope_name, provider_name, retention_days, state, verified, observed FROM backup_records WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []backupRecord
	for rows.Next() {
		var item backupRecord
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Service, &item.Scope, &item.Provider, &item.RetentionDays, &item.State, &item.Verified, &item.Observed); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func findBackupDependencyFromDB(backupID int, service string) (backupDependency, error) {
	if DB == nil {
		return backupDependency{}, errInboxStored
	}
	var item backupDependency
	err := DB.QueryRow(`SELECT id, backup_id, service_key FROM backup_dependencies WHERE backup_id = $1 AND service_key = $2`, backupID, service).Scan(&item.ID, &item.BackupID, &item.Service)
	if err != nil {
		return backupDependency{}, nil
	}
	return item, nil
}

func saveBackupDependencyToDB(item backupDependency) (backupDependency, error) {
	if DB == nil {
		return backupDependency{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO backup_dependencies (backup_id, service_key) VALUES ($1,$2) RETURNING id`, item.BackupID, item.Service).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func findBackupDrillFromDB(backupID int) (backupDrill, error) {
	if DB == nil {
		return backupDrill{}, errInboxStored
	}
	var item backupDrill
	err := DB.QueryRow(`SELECT id, backup_id, reviewer_id, assignee_id, isolated, sample_valid, duration_seconds, duration_set, data_gap, gap_set, state, follow_up FROM backup_drills WHERE backup_id = $1`, backupID).Scan(&item.ID, &item.BackupID, &item.ReviewerID, &item.AssigneeID, &item.Isolated, &item.SampleValid, &item.DurationSeconds, &item.DurationSet, &item.DataGap, &item.GapSet, &item.State, &item.FollowUp)
	if err != nil {
		return backupDrill{}, nil
	}
	return item, nil
}

func saveBackupDrillToDB(item backupDrill) (backupDrill, error) {
	if DB == nil {
		return backupDrill{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO backup_drills (backup_id, reviewer_id, assignee_id, isolated, sample_valid, duration_seconds, duration_set, data_gap, gap_set, state, follow_up) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, item.BackupID, item.ReviewerID, item.AssigneeID, item.Isolated, item.SampleValid, item.DurationSeconds, item.DurationSet, item.DataGap, item.GapSet, item.State, item.FollowUp).Scan(&item.ID)
	item.Applied = true
	return item, err
}

func saveBackupAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "backup_record",
		ResourceID: resourceID, Action: "backup_record", Result: "success", Summary: summary,
	})
	return nil
}

func backupRecordHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBackupError(w, errBackupHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeBackupError(w, errBackupInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readBackupEvidence(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeBackupError(w, err)
			return
		}
		writeBackupJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeBackupError(w, errBackupInvalid)
		return
	}
	var body struct {
		ProjectID     int    `json:"project_id"`
		Environment   string `json:"environment"`
		Service       string `json:"service"`
		Scope         string `json:"scope"`
		Provider      string `json:"provider"`
		RetentionDays int    `json:"retention_days"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeBackupError(w, errBackupInvalid)
		return
	}
	item, err := recordBackupEvidence(actor, body.ProjectID, body.Environment, body.Service, body.Scope, body.Provider, body.RetentionDays)
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeBackupJSON(w, item)
}

func backupDependencyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeBackupError(w, errBackupInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBackupError(w, errBackupHidden)
		return
	}
	var body struct {
		BackupID int    `json:"backup_id"`
		Service  string `json:"service"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeBackupError(w, errBackupInvalid)
		return
	}
	item, err := linkBackupService(actor, body.BackupID, body.Service)
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeBackupJSON(w, item)
}

func backupDrillHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeBackupError(w, errBackupInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeBackupError(w, errBackupHidden)
		return
	}
	var body struct {
		BackupID    int    `json:"backup_id"`
		ReviewerID  int    `json:"reviewer_id"`
		Isolated    bool   `json:"isolated"`
		SampleValid bool   `json:"sample_valid"`
		DurationSet bool   `json:"duration_set"`
		Duration    int    `json:"duration_seconds"`
		GapSet      bool   `json:"gap_set"`
		Gap         int    `json:"data_gap"`
		Outcome     string `json:"outcome"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeBackupError(w, errBackupInvalid)
		return
	}
	item, err := recordBackupDrill(actor, body.BackupID, body.ReviewerID, body.Isolated, body.SampleValid, body.DurationSet, body.Duration, body.GapSet, body.Gap, body.Outcome)
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeBackupJSON(w, item)
}

func writeBackupJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeBackupError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errBackupHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errBackupDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "backup request failed"})
}
