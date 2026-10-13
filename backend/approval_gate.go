package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errApprovalHidden      = errors.New("approval not found")
	errApprovalDenied      = errors.New("approval is not permitted")
	errApprovalInvalid     = errors.New("approval subject is invalid")
	errApprovalInvalidated = errors.New("changed plan cannot reuse approval")
	errPromotionDeclined   = errors.New("declined promotion creates no execution request")
)

type approvalSubject struct {
	ID               int    `json:"id"`
	ProjectID        int    `json:"project_id"`
	CommitHash       string `json:"commit_hash"`
	PlanHash         string `json:"plan_hash"`
	Environment      string `json:"environment"`
	TemplateKey      string `json:"template_key"`
	SchemaVersion    int    `json:"schema_version"`
	GeneratorVersion string `json:"generator_version"`
	ModuleVersion    string `json:"module_version"`
	SubjectHash      string `json:"subject_hash"`
	State            string `json:"state"`
}

type promotionGate struct {
	Name   string `json:"name"`
	State  string `json:"state"`
	Reason string `json:"reason"`
}

type promotionDecision struct {
	Decision           string          `json:"decision"`
	Gates              []promotionGate `json:"gates"`
	Blockers           []string        `json:"blockers"`
	ExecutionRequested bool            `json:"execution_requested"`
}

type promotionExecution struct {
	ID         int `json:"id"`
	ProjectID  int `json:"project_id"`
	ApprovalID int `json:"approval_id"`
}

type promotionException struct {
	ID          int       `json:"id"`
	ProjectID   int       `json:"project_id"`
	ApprovalID  int       `json:"approval_id"`
	Gate        string    `json:"gate"`
	Reason      string    `json:"reason"`
	ActorUserID int       `json:"actor_user_id"`
	ExpiresAt   time.Time `json:"expires_at"`
}

var (
	saveApprovalSubject     = saveApprovalSubjectToDB
	loadApprovalSubject     = loadApprovalSubjectFromDB
	invalidateApproval      = invalidateApprovalInDB
	savePromotionExecution  = savePromotionExecutionToDB
	savePromotionException  = savePromotionExceptionToDB
	listPromotionExceptions = listPromotionExceptionsFromDB
	promotionClock          = time.Now
)

func approvalDigest(item approvalSubject) string {
	canonical := strings.Join([]string{
		strings.TrimSpace(item.CommitHash),
		strings.TrimSpace(item.PlanHash),
		strings.ToLower(strings.TrimSpace(item.Environment)),
		strings.TrimSpace(item.TemplateKey),
		strconv.Itoa(item.SchemaVersion),
		strings.TrimSpace(item.GeneratorVersion),
		strings.TrimSpace(item.ModuleVersion),
	}, "\n")
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

func recordApprovalSubject(actor authzSubject, item approvalSubject) (approvalSubject, error) {
	item.CommitHash = strings.TrimSpace(item.CommitHash)
	item.PlanHash = strings.TrimSpace(item.PlanHash)
	item.Environment = strings.ToLower(strings.TrimSpace(item.Environment))
	item.TemplateKey = strings.TrimSpace(item.TemplateKey)
	item.GeneratorVersion = strings.TrimSpace(item.GeneratorVersion)
	item.ModuleVersion = strings.TrimSpace(item.ModuleVersion)
	if item.ProjectID <= 0 || item.CommitHash == "" || item.PlanHash == "" || item.Environment == "" {
		return approvalSubject{}, errApprovalInvalid
	}
	if !mappingAllowed(actor, item.ProjectID, authzRead) {
		return approvalSubject{}, errApprovalHidden
	}
	if !mappingAllowed(actor, item.ProjectID, authzWrite) {
		return approvalSubject{}, errApprovalDenied
	}
	if _, err := pinTemplateContract(templateVersionPin{
		TemplateKey: item.TemplateKey, SchemaVersion: item.SchemaVersion,
		GeneratorVersion: item.GeneratorVersion, ModuleVersion: item.ModuleVersion,
	}); err != nil {
		return approvalSubject{}, err
	}
	item.SubjectHash = approvalDigest(item)
	item.State = "approved"
	return saveApprovalSubject(item)
}

func reuseApprovalSubject(actor authzSubject, approvalID int, current approvalSubject) (approvalSubject, error) {
	saved, err := loadApprovalSubject(approvalID)
	if err != nil || saved.ID <= 0 {
		return approvalSubject{}, errApprovalHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return approvalSubject{}, errApprovalHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return approvalSubject{}, errApprovalDenied
	}
	current.ProjectID = saved.ProjectID
	current.Environment = strings.ToLower(strings.TrimSpace(current.Environment))
	if saved.State != "approved" || approvalDigest(saved) != approvalDigest(current) {
		saved.State = "invalidated"
		if err := invalidateApproval(saved.ID); err != nil {
			return approvalSubject{}, err
		}
		return saved, errApprovalInvalidated
	}
	return saved, nil
}

func recordPromotionException(actor authzSubject, approvalID int, gate, reason string, expiresAt time.Time) (promotionException, error) {
	saved, err := loadApprovalSubject(approvalID)
	if err != nil || saved.ID <= 0 {
		return promotionException{}, errApprovalHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return promotionException{}, errApprovalHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return promotionException{}, errApprovalDenied
	}
	gate = strings.ToLower(strings.TrimSpace(gate))
	reason = strings.TrimSpace(reason)
	if reason == "" || !expiresAt.After(promotionClock()) || (gate != "policy" && gate != "telemetry" && gate != "database compatibility") {
		return promotionException{}, errApprovalInvalid
	}
	return savePromotionException(promotionException{
		ProjectID: saved.ProjectID, ApprovalID: saved.ID, Gate: gate,
		Reason: reason, ActorUserID: actor.UserID, ExpiresAt: expiresAt.UTC(),
	})
}

func evaluatePromotionGates(environment, policy, approvalState, telemetry, databaseCompatibility string, approvalID int, now time.Time) []promotionGate {
	environment = strings.ToLower(strings.TrimSpace(environment))
	policy = strings.ToLower(strings.TrimSpace(policy))
	approvalState = strings.ToLower(strings.TrimSpace(approvalState))
	telemetry = strings.ToLower(strings.TrimSpace(telemetry))
	databaseCompatibility = strings.ToLower(strings.TrimSpace(databaseCompatibility))
	gates := []promotionGate{
		policyGate(environment, policy, activePromotionException(approvalID, "policy", now)),
		approvalGate(approvalState),
		evidenceGate("telemetry", telemetry, "fresh", "stale", "stale telemetry blocks release", "telemetry is unknown"),
		evidenceGate("database compatibility", databaseCompatibility, "verified", "unverified", "database compatibility is unverified", "database compatibility is unknown"),
	}
	return gates
}

func activePromotionException(approvalID int, gate string, now time.Time) *promotionException {
	if approvalID <= 0 {
		return nil
	}
	rows, err := listPromotionExceptions(approvalID)
	if err != nil {
		return nil
	}
	for index := range rows {
		if rows[index].Gate == gate && strings.TrimSpace(rows[index].Reason) != "" && rows[index].ExpiresAt.After(now) {
			return &rows[index]
		}
	}
	return nil
}

func policyGate(environment, policy string, exception *promotionException) promotionGate {
	if environment == "prod" && (policy == "" || policy == "unknown") {
		if exception != nil {
			return promotionGate{Name: "policy", State: "exception", Reason: "audited exception until " + exception.ExpiresAt.UTC().Format(time.RFC3339) + ": " + exception.Reason}
		}
		return promotionGate{Name: "policy", State: "unknown", Reason: "production policy is unknown"}
	}
	switch policy {
	case "allow":
		return promotionGate{Name: "policy", State: "pass", Reason: "policy allows promotion"}
	case "deny":
		return promotionGate{Name: "policy", State: "fail", Reason: "policy denies promotion"}
	default:
		return promotionGate{Name: "policy", State: "unknown", Reason: "policy is unknown"}
	}
}

func approvalGate(state string) promotionGate {
	switch state {
	case "approved":
		return promotionGate{Name: "approval", State: "pass", Reason: "approval matches the current plan"}
	case "invalidated":
		return promotionGate{Name: "approval", State: "fail", Reason: "material change invalidated the approval"}
	default:
		return promotionGate{Name: "approval", State: "unknown", Reason: "approval is unknown"}
	}
}

func evidenceGate(name, value, passValue, failValue, failReason, unknownReason string) promotionGate {
	switch value {
	case passValue:
		return promotionGate{Name: name, State: "pass", Reason: name + " is " + passValue}
	case failValue:
		return promotionGate{Name: name, State: "fail", Reason: failReason}
	default:
		return promotionGate{Name: name, State: "unknown", Reason: unknownReason}
	}
}

func promotionPreflight(environment, policy, approvalState, telemetry, databaseCompatibility string) promotionDecision {
	return promotionPreflightAt(environment, policy, approvalState, telemetry, databaseCompatibility, 0, time.Time{})
}

func promotionPreflightAt(environment, policy, approvalState, telemetry, databaseCompatibility string, approvalID int, now time.Time) promotionDecision {
	gates := evaluatePromotionGates(environment, policy, approvalState, telemetry, databaseCompatibility, approvalID, now)
	decision := "pass"
	blockers := []string{}
	for _, gate := range gates {
		if gate.State == "fail" {
			decision = "fail"
			blockers = append(blockers, gate.Reason)
			continue
		}
		if gate.State == "unknown" {
			if decision != "fail" {
				decision = "unknown"
			}
			blockers = append(blockers, gate.Reason)
		}
	}
	if blockers == nil {
		blockers = []string{}
	}
	return promotionDecision{Decision: decision, Gates: gates, Blockers: blockers, ExecutionRequested: false}
}

func releasePromotion(actor authzSubject, approvalID int, current approvalSubject, policy, telemetry, databaseCompatibility string) (promotionExecution, error) {
	saved, err := reuseApprovalSubject(actor, approvalID, current)
	if err != nil {
		if errors.Is(err, errApprovalHidden) || errors.Is(err, errApprovalDenied) {
			return promotionExecution{}, err
		}
		return promotionExecution{}, errPromotionDeclined
	}
	decision := promotionPreflightAt(saved.Environment, policy, saved.State, telemetry, databaseCompatibility, saved.ID, promotionClock())
	if decision.Decision != "pass" {
		return promotionExecution{}, errPromotionDeclined
	}
	return savePromotionExecution(promotionExecution{ProjectID: saved.ProjectID, ApprovalID: saved.ID})
}

func migrateApprovalSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS approval_subjects (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			commit_hash VARCHAR(128) NOT NULL,
			plan_hash VARCHAR(128) NOT NULL,
			environment VARCHAR(64) NOT NULL,
			template_key VARCHAR(120) NOT NULL,
			schema_version INTEGER NOT NULL,
			generator_version VARCHAR(64) NOT NULL,
			module_version VARCHAR(64) NOT NULL,
			subject_hash VARCHAR(64) NOT NULL,
			state VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS promotion_executions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			approval_id INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS promotion_exceptions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			approval_id INTEGER NOT NULL,
			gate_name VARCHAR(64) NOT NULL,
			reason TEXT NOT NULL,
			actor_user_id INTEGER NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveApprovalSubjectToDB(item approvalSubject) (approvalSubject, error) {
	if DB == nil {
		return approvalSubject{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO approval_subjects (
			project_id, commit_hash, plan_hash, environment, template_key, schema_version, generator_version, module_version, subject_hash, state
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')
		RETURNING id
	`, item.ProjectID, item.CommitHash, item.PlanHash, item.Environment, item.TemplateKey, item.SchemaVersion, item.GeneratorVersion, item.ModuleVersion, item.SubjectHash).Scan(&item.ID)
	if err != nil {
		return approvalSubject{}, err
	}
	item.State = "approved"
	return item, nil
}

func loadApprovalSubjectFromDB(id int) (approvalSubject, error) {
	if DB == nil || id <= 0 {
		return approvalSubject{}, errApprovalHidden
	}
	var item approvalSubject
	err := DB.QueryRow(`
		SELECT id, project_id, commit_hash, plan_hash, environment, template_key, schema_version, generator_version, module_version, subject_hash, state
		FROM approval_subjects WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.CommitHash, &item.PlanHash, &item.Environment, &item.TemplateKey, &item.SchemaVersion, &item.GeneratorVersion, &item.ModuleVersion, &item.SubjectHash, &item.State)
	if err != nil {
		return approvalSubject{}, errApprovalHidden
	}
	return item, nil
}

func invalidateApprovalInDB(id int) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`UPDATE approval_subjects SET state = 'invalidated' WHERE id = $1`, id)
	return err
}

func savePromotionExceptionToDB(item promotionException) (promotionException, error) {
	if DB == nil {
		return promotionException{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO promotion_exceptions (project_id, approval_id, gate_name, reason, actor_user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
	`, item.ProjectID, item.ApprovalID, item.Gate, item.Reason, item.ActorUserID, item.ExpiresAt).Scan(&item.ID)
	if err != nil {
		return promotionException{}, err
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "approval_subject",
		ResourceID: strconv.Itoa(item.ApprovalID), Action: "promotion_exception", Result: "success",
		Summary: fmt.Sprintf("gate %s until %s: %s", item.Gate, item.ExpiresAt.UTC().Format(time.RFC3339), item.Reason),
	})
	return item, nil
}

func listPromotionExceptionsFromDB(approvalID int) ([]promotionException, error) {
	if DB == nil || approvalID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, approval_id, gate_name, reason, actor_user_id, expires_at
		FROM promotion_exceptions WHERE approval_id = $1 ORDER BY id
	`, approvalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []promotionException
	for rows.Next() {
		var item promotionException
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.ApprovalID, &item.Gate, &item.Reason, &item.ActorUserID, &item.ExpiresAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func savePromotionExecutionToDB(item promotionExecution) (promotionExecution, error) {
	if DB == nil {
		return promotionExecution{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO promotion_executions (project_id, approval_id) VALUES ($1, $2) RETURNING id
	`, item.ProjectID, item.ApprovalID).Scan(&item.ID)
	return item, err
}

func approvalSubjectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var item approvalSubject
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeApprovalError(w, r, errApprovalInvalid)
		return
	}
	saved, err := recordApprovalSubject(actor, item)
	if err != nil {
		writeApprovalError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func promotionPreflightHandler(w http.ResponseWriter, r *http.Request) {
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
		ProjectID             int    `json:"project_id"`
		ApprovalID            int    `json:"approval_id"`
		Environment           string `json:"environment"`
		Policy                string `json:"policy"`
		ApprovalState         string `json:"approval_state"`
		Telemetry             string `json:"telemetry"`
		DatabaseCompatibility string `json:"database_compatibility"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeApprovalError(w, r, errApprovalInvalid)
		return
	}
	if body.ProjectID <= 0 || !mappingAllowed(actor, body.ProjectID, authzRead) {
		writeApprovalError(w, r, errApprovalHidden)
		return
	}
	if body.ApprovalID > 0 {
		saved, err := loadApprovalSubject(body.ApprovalID)
		if err != nil || saved.ProjectID != body.ProjectID || !mappingAllowed(actor, saved.ProjectID, authzRead) {
			writeApprovalError(w, r, errApprovalHidden)
			return
		}
	}
	_ = writeJSONResponse(w, http.StatusOK, promotionPreflightAt(body.Environment, body.Policy, body.ApprovalState, body.Telemetry, body.DatabaseCompatibility, body.ApprovalID, promotionClock()))
}

func promotionExceptionHandler(w http.ResponseWriter, r *http.Request) {
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
		ApprovalID int    `json:"approval_id"`
		Gate       string `json:"gate"`
		Reason     string `json:"reason"`
		ExpiresAt  string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeApprovalError(w, r, errApprovalInvalid)
		return
	}
	expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(body.ExpiresAt))
	if err != nil {
		writeApprovalError(w, r, errApprovalInvalid)
		return
	}
	saved, err := recordPromotionException(actor, body.ApprovalID, body.Gate, body.Reason, expiresAt)
	if err != nil {
		writeApprovalError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func promotionReleaseHandler(w http.ResponseWriter, r *http.Request) {
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
		ApprovalID            int             `json:"approval_id"`
		Current               approvalSubject `json:"current"`
		Policy                string          `json:"policy"`
		Telemetry             string          `json:"telemetry"`
		DatabaseCompatibility string          `json:"database_compatibility"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeApprovalError(w, r, errApprovalInvalid)
		return
	}
	item, err := releasePromotion(actor, body.ApprovalID, body.Current, body.Policy, body.Telemetry, body.DatabaseCompatibility)
	if err != nil {
		writeApprovalError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, item)
}

func writeApprovalError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errApprovalHidden):
		writeAPIError(w, r, http.StatusNotFound, errApprovalHidden.Error(), nil)
	case errors.Is(err, errApprovalDenied):
		writeAPIError(w, r, http.StatusForbidden, errApprovalDenied.Error(), nil)
	case errors.Is(err, errApprovalInvalidated), errors.Is(err, errPromotionDeclined):
		writeAPIError(w, r, http.StatusConflict, err.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
