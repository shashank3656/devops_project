package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	errDriftHidden  = errors.New("drift hidden")
	errDriftDenied  = errors.New("drift denied")
	errDriftInvalid = errors.New("drift invalid")
)

type driftPlan struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Environment string `json:"environment"`
	Workspace   string `json:"workspace"`
	Kind        string `json:"kind"`
	Evidence    string `json:"evidence"`
	State       string `json:"state"`
	Observed    string `json:"observed"`
	ReadOnly    bool   `json:"read_only"`
	CanApply    bool   `json:"can_apply"`
	Applied     bool   `json:"applied"`
	Reason      string `json:"reason"`
}

type driftReview struct {
	ID         int    `json:"id"`
	PlanID     int    `json:"plan_id"`
	ReviewerID int    `json:"reviewer_id"`
	State      string `json:"state"`
	Applied    bool   `json:"applied"`
}

var (
	findDriftPlan   = findDriftPlanFromDB
	saveDriftPlan   = saveDriftPlanToDB
	loadDriftPlan   = loadDriftPlanFromDB
	updateDriftPlan = updateDriftPlanToDB
	listDriftPlans  = listDriftPlansFromDB
	driftLockHeld   = driftLockHeldFromDB
	setDriftLock    = setDriftLockToDB
	saveDriftReview = saveDriftReviewToDB
	findDriftReview = findDriftReviewFromDB
	saveDriftAudit  = saveDriftAuditToDB
)

func recordDriftPlan(actor authzSubject, projectID int, environment, workspace, kind string, accessible bool, detail string) (driftPlan, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	workspace = strings.TrimSpace(workspace)
	kind = strings.ToLower(strings.TrimSpace(kind))
	detail = strings.TrimSpace(detail)
	if err := driftAccess(actor, projectID, environment, true); err != nil || !incidentToken(workspace) || !driftKind(kind) || pilotSensitive(detail) {
		if err == nil {
			err = errDriftInvalid
		}
		return driftPlan{}, err
	}
	current, err := findDriftPlan(projectID, environment, workspace, kind)
	if err != nil {
		return driftPlan{}, err
	}
	held, err := driftLockHeld(projectID, environment, workspace)
	if err != nil {
		return driftPlan{}, err
	}
	if held {
		if current.ID > 0 {
			current.Applied = false
			current.CanApply = false
			current.Reason = "apply in progress"
			return current, nil
		}
		item := driftPlan{ProjectID: projectID, Environment: environment, Workspace: workspace, Kind: kind, State: "blocked", Observed: "unknown", ReadOnly: true, Reason: "apply in progress"}
		return saveDriftPlan(item)
	}
	if current.ID > 0 && current.Evidence == detail && ((accessible && current.State != "unknown" && current.State != "blocked") || (!accessible && current.State == "unknown")) {
		current.Applied = false
		current.CanApply = false
		current.ReadOnly = true
		return current, nil
	}
	item := driftPlan{ProjectID: projectID, Environment: environment, Workspace: workspace, Kind: kind, ReadOnly: true, Observed: "unknown"}
	if current.ID > 0 {
		item.ID = current.ID
		item.Evidence = current.Evidence
	}
	if !accessible {
		item.State = "unknown"
		item.Reason = "state inaccessible"
		saved, err := persistDriftPlan(item)
		return saved, err
	}
	if detail == "" {
		item.State = "unchanged"
		item.Evidence = ""
	} else if kind == "refresh" {
		item.State = "refresh"
		item.Evidence = detail
		item.Reason = "refresh only"
	} else {
		item.State = "drifted"
		item.Evidence = detail
		item.Reason = "configuration differs"
	}
	saved, err := persistDriftPlan(item)
	if err != nil {
		return driftPlan{}, err
	}
	if saved.Applied {
		_ = saveDriftAudit(projectID, workspace, actor.UserID, "drift plan recorded")
	}
	return saved, nil
}

func persistDriftPlan(item driftPlan) (driftPlan, error) {
	item.CanApply = false
	item.ReadOnly = true
	item.Applied = true
	if item.ID > 0 {
		return updateDriftPlan(item)
	}
	return saveDriftPlan(item)
}

func holdDriftApply(actor authzSubject, projectID int, environment, workspace string, held bool) error {
	environment = strings.ToLower(strings.TrimSpace(environment))
	workspace = strings.TrimSpace(workspace)
	if err := driftAccess(actor, projectID, environment, true); err != nil || !incidentToken(workspace) {
		if err == nil {
			err = errDriftInvalid
		}
		return err
	}
	return setDriftLock(projectID, environment, workspace, held)
}

func applyDriftPlan(actor authzSubject, planID int) (driftPlan, error) {
	item, err := loadDriftPlan(planID)
	if err != nil || item.ID == 0 {
		return driftPlan{}, errDriftHidden
	}
	if err := driftAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return driftPlan{}, err
	}
	item.CanApply = false
	item.Applied = false
	item.ReadOnly = true
	item.Reason = "scan does not apply"
	return item, errDriftInvalid
}

func openDriftReview(actor authzSubject, planID, reviewerID int) (driftReview, error) {
	item, err := loadDriftPlan(planID)
	if err != nil || item.ID == 0 {
		return driftReview{}, errDriftHidden
	}
	if err := driftAccess(actor, item.ProjectID, item.Environment, true); err != nil {
		return driftReview{}, err
	}
	if item.State != "drifted" || item.Kind != "configuration" || reviewerID <= 0 || reviewerID == actor.UserID {
		return driftReview{}, errDriftInvalid
	}
	current, err := findDriftReview(item.ID)
	if err != nil {
		return driftReview{}, err
	}
	if current.ID > 0 {
		current.Applied = false
		return current, nil
	}
	saved, err := saveDriftReview(driftReview{PlanID: item.ID, ReviewerID: reviewerID, State: "proposed"})
	if err != nil {
		return driftReview{}, err
	}
	kept, err := loadDriftPlan(item.ID)
	if err != nil || kept.State != "drifted" || kept.CanApply {
		return driftReview{}, errDriftInvalid
	}
	_ = saveDriftAudit(item.ProjectID, item.Workspace, actor.UserID, "drift review proposed")
	return saved, nil
}

func readDriftPlans(actor authzSubject, projectID int, environment string) ([]driftPlan, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if err := driftAccess(actor, projectID, environment, false); err != nil {
		return nil, err
	}
	items, err := listDriftPlans(projectID, environment)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []driftPlan{}
	}
	return items, nil
}

func driftAccess(actor authzSubject, projectID int, environment string, write bool) error {
	if projectID <= 0 || !singleEnvironment(environment) {
		return errDriftInvalid
	}
	if !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzRead) {
		return errDriftHidden
	}
	if write && !catalogEnvironmentsAllowed(actor, projectID, []string{environment}, authzWrite) {
		return errDriftDenied
	}
	return nil
}

func driftKind(kind string) bool {
	return kind == "configuration" || kind == "refresh"
}

func migrateDriftSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS drift_plans (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			workspace_key TEXT NOT NULL,
			kind_name TEXT NOT NULL,
			evidence TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL,
			observed TEXT NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			UNIQUE (project_id, environment, workspace_key, kind_name)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS drift_locks (
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			workspace_key TEXT NOT NULL,
			held BOOLEAN NOT NULL,
			PRIMARY KEY (project_id, environment, workspace_key)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS drift_reviews (
			id SERIAL PRIMARY KEY,
			plan_id INTEGER NOT NULL UNIQUE,
			reviewer_id INTEGER NOT NULL,
			state TEXT NOT NULL
		)
	`)
}

func findDriftPlanFromDB(projectID int, environment, workspace, kind string) (driftPlan, error) {
	if DB == nil {
		return driftPlan{}, errInboxStored
	}
	var item driftPlan
	err := DB.QueryRow(`SELECT id, project_id, environment, workspace_key, kind_name, evidence, state, observed, reason FROM drift_plans WHERE project_id = $1 AND environment = $2 AND workspace_key = $3 AND kind_name = $4`, projectID, environment, workspace, kind).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Workspace, &item.Kind, &item.Evidence, &item.State, &item.Observed, &item.Reason)
	if err != nil {
		return driftPlan{}, nil
	}
	item.ReadOnly = true
	return item, nil
}

func saveDriftPlanToDB(item driftPlan) (driftPlan, error) {
	if DB == nil {
		return driftPlan{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO drift_plans (project_id, environment, workspace_key, kind_name, evidence, state, observed, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, item.ProjectID, item.Environment, item.Workspace, item.Kind, item.Evidence, item.State, item.Observed, item.Reason).Scan(&item.ID)
	item.ReadOnly = true
	item.CanApply = false
	return item, err
}

func loadDriftPlanFromDB(id int) (driftPlan, error) {
	if DB == nil {
		return driftPlan{}, errInboxStored
	}
	var item driftPlan
	err := DB.QueryRow(`SELECT id, project_id, environment, workspace_key, kind_name, evidence, state, observed, reason FROM drift_plans WHERE id = $1`, id).Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Workspace, &item.Kind, &item.Evidence, &item.State, &item.Observed, &item.Reason)
	if err != nil {
		return driftPlan{}, nil
	}
	item.ReadOnly = true
	return item, nil
}

func updateDriftPlanToDB(item driftPlan) (driftPlan, error) {
	if DB == nil {
		return driftPlan{}, errInboxStored
	}
	_, err := DB.Exec(`UPDATE drift_plans SET evidence = $2, state = $3, observed = $4, reason = $5 WHERE id = $1`, item.ID, item.Evidence, item.State, item.Observed, item.Reason)
	item.ReadOnly = true
	item.CanApply = false
	return item, err
}

func listDriftPlansFromDB(projectID int, environment string) ([]driftPlan, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`SELECT id, project_id, environment, workspace_key, kind_name, evidence, state, observed, reason FROM drift_plans WHERE project_id = $1 AND environment = $2 ORDER BY id`, projectID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []driftPlan
	for rows.Next() {
		var item driftPlan
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Environment, &item.Workspace, &item.Kind, &item.Evidence, &item.State, &item.Observed, &item.Reason); err != nil {
			return nil, err
		}
		item.ReadOnly = true
		items = append(items, item)
	}
	return items, rows.Err()
}

func driftLockHeldFromDB(projectID int, environment, workspace string) (bool, error) {
	if DB == nil {
		return false, errInboxStored
	}
	var held bool
	err := DB.QueryRow(`SELECT held FROM drift_locks WHERE project_id = $1 AND environment = $2 AND workspace_key = $3`, projectID, environment, workspace).Scan(&held)
	if err != nil {
		return false, nil
	}
	return held, nil
}

func setDriftLockToDB(projectID int, environment, workspace string, held bool) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO drift_locks (project_id, environment, workspace_key, held) VALUES ($1,$2,$3,$4)
		ON CONFLICT (project_id, environment, workspace_key) DO UPDATE SET held = EXCLUDED.held
	`, projectID, environment, workspace, held)
	return err
}

func saveDriftReviewToDB(item driftReview) (driftReview, error) {
	if DB == nil {
		return driftReview{}, errInboxStored
	}
	err := DB.QueryRow(`INSERT INTO drift_reviews (plan_id, reviewer_id, state) VALUES ($1,$2,$3) RETURNING id`, item.PlanID, item.ReviewerID, item.State).Scan(&item.ID)
	return item, err
}

func findDriftReviewFromDB(planID int) (driftReview, error) {
	if DB == nil {
		return driftReview{}, errInboxStored
	}
	var item driftReview
	err := DB.QueryRow(`SELECT id, plan_id, reviewer_id, state FROM drift_reviews WHERE plan_id = $1`, planID).Scan(&item.ID, &item.PlanID, &item.ReviewerID, &item.State)
	if err != nil {
		return driftReview{}, nil
	}
	return item, nil
}

func saveDriftAuditToDB(projectID int, resourceID string, actorUserID int, summary string) error {
	if DB == nil {
		return nil
	}
	actor := actorUserID
	project := projectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "drift_plan",
		ResourceID: resourceID, Action: "drift_plan", Result: "success", Summary: summary,
	})
	return nil
}

func driftPlanHandler(w http.ResponseWriter, r *http.Request) {
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeDriftError(w, errDriftHidden)
		return
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, ch := range r.URL.Query().Get("project_id") {
			if ch < '0' || ch > '9' {
				writeDriftError(w, errDriftInvalid)
				return
			}
			projectID = projectID*10 + int(ch-'0')
		}
		items, err := readDriftPlans(actor, projectID, r.URL.Query().Get("environment"))
		if err != nil {
			writeDriftError(w, err)
			return
		}
		writeDriftJSON(w, items)
		return
	}
	if r.Method != http.MethodPost {
		writeDriftError(w, errDriftInvalid)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Workspace   string `json:"workspace"`
		Kind        string `json:"kind"`
		Accessible  bool   `json:"accessible"`
		Detail      string `json:"detail"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2048)).Decode(&body); err != nil {
		writeDriftError(w, errDriftInvalid)
		return
	}
	item, err := recordDriftPlan(actor, body.ProjectID, body.Environment, body.Workspace, body.Kind, body.Accessible, body.Detail)
	if err != nil {
		writeDriftError(w, err)
		return
	}
	writeDriftJSON(w, item)
}

func driftLockHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeDriftError(w, errDriftInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeDriftError(w, errDriftHidden)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		Environment string `json:"environment"`
		Workspace   string `json:"workspace"`
		Held        bool   `json:"held"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&body); err != nil {
		writeDriftError(w, errDriftInvalid)
		return
	}
	if err := holdDriftApply(actor, body.ProjectID, body.Environment, body.Workspace, body.Held); err != nil {
		writeDriftError(w, err)
		return
	}
	writeDriftJSON(w, map[string]bool{"held": body.Held})
}

func driftReviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeDriftError(w, errDriftInvalid)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeDriftError(w, errDriftHidden)
		return
	}
	var body struct {
		PlanID     int `json:"plan_id"`
		ReviewerID int `json:"reviewer_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256)).Decode(&body); err != nil {
		writeDriftError(w, errDriftInvalid)
		return
	}
	item, err := openDriftReview(actor, body.PlanID, body.ReviewerID)
	if err != nil {
		writeDriftError(w, err)
		return
	}
	writeDriftJSON(w, item)
}

func writeDriftJSON(w http.ResponseWriter, item any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

func writeDriftError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, errDriftHidden) {
		status = http.StatusNotFound
	}
	if errors.Is(err, errDriftDenied) {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "drift request failed"})
}
