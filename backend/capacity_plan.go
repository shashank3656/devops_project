package main

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// E17 contract. The adapter is an in-process calculation. There is no cloud
// scaler and no autonomous scaling. Read is allowed for a viewer or operator
// with a grant. Preview is a read. Approve is a write, and a viewer is denied.
// Another project is hidden. Execute is rejected: an approved plan does not
// change production.
//
// Formula: ceil(target_rps / sustainable_rps * (1 + headroom)).
// The minimum uses the expected target. The maximum uses the stress target
// when it is positive, and otherwise equals the minimum. Both round up.
// The unit must be rps. Sustainable throughput must be greater than zero.
// Headroom is from 0 through 1. Evidence older than seven days is stale.
// A missing observed time is missing evidence. A workload revision that
// differs from the evidence revision is not comparable and is not extrapolated.
// Missing or non-positive node capacity, database quota, or dependency limit
// is a blocker. Readiness is unknown, blocked, review, or approved. It is
// never healthy. One plan is kept per project, environment, and service.
// Bottleneck text is limited to 200 characters. List reads stay on the
// existing API timeout. No latency target is set because there is no baseline.

const (
	capacityFormula    = "ceil(target_rps / sustainable_rps * (1 + headroom))"
	capacityLimitation = "Replicas round up from measured throughput and declared headroom. This does not guarantee linear scaling and does not change production."
	capacityFreshFor   = 7 * 24 * time.Hour
	capacityNoteLimit  = 200
)

var (
	errCapacityHidden  = errors.New("capacity hidden")
	errCapacityDenied  = errors.New("capacity denied")
	errCapacityInvalid = errors.New("capacity invalid")
)

type capacityEvidence struct {
	Unit             string    `json:"unit"`
	SustainableRPS   float64   `json:"sustainable_rps"`
	ErrorRate        float64   `json:"error_rate"`
	ObservedAt       time.Time `json:"observed_at"`
	WorkloadRevision string    `json:"workload_revision"`
	Bottleneck       string    `json:"bottleneck"`
	Failed           bool      `json:"failed"`
}

type capacityAssumptions struct {
	Headroom    float64 `json:"headroom"`
	ExpectedRPS float64 `json:"expected_rps"`
	StressRPS   float64 `json:"stress_rps"`
	Note        string  `json:"note"`
}

type capacityLimits struct {
	NodeCapacity    int `json:"node_capacity"`
	DatabaseQuota   int `json:"database_quota"`
	DependencyLimit int `json:"dependency_limit"`
}

type capacityInput struct {
	Service          string              `json:"service"`
	Timezone         string              `json:"timezone"`
	TrafficSource    string              `json:"traffic_source"`
	WorkloadRevision string              `json:"workload_revision"`
	Assumptions      capacityAssumptions `json:"assumptions"`
	Evidence         *capacityEvidence   `json:"evidence"`
	Limits           capacityLimits      `json:"limits"`
}

type capacityResult struct {
	Readiness  string   `json:"readiness"`
	Minimum    int      `json:"minimum"`
	Maximum    int      `json:"maximum"`
	Formula    string   `json:"formula"`
	Limitation string   `json:"limitation"`
	Blockers   []string `json:"blockers"`
	Approved   bool     `json:"approved"`
	Executed   bool     `json:"executed"`
	ChangeRef  string   `json:"change_ref,omitempty"`
}

type capacityPlan struct {
	Input               capacityInput
	Result              capacityResult
	ApprovedFingerprint string
	ChangeRefs          []string
}

func capacityBase(blockers []string, readiness string) capacityResult {
	return capacityResult{
		Readiness:  readiness,
		Formula:    capacityFormula,
		Limitation: capacityLimitation,
		Blockers:   blockers,
	}
}

func capacityReplicas(target, sustainable, headroom float64) (int, error) {
	if target <= 0 || sustainable <= 0 || headroom < 0 || headroom > 1 || math.IsNaN(target) || math.IsNaN(sustainable) || math.IsNaN(headroom) {
		return 0, errCapacityInvalid
	}
	replicas := int(math.Ceil(target / sustainable * (1 + headroom)))
	if replicas < 1 {
		return 0, errCapacityInvalid
	}
	return replicas, nil
}

func capacityFingerprint(input capacityInput) string {
	return strings.Join([]string{
		strings.TrimSpace(input.Service),
		strings.TrimSpace(input.WorkloadRevision),
		strconv.FormatFloat(input.Assumptions.ExpectedRPS, 'f', -1, 64),
		strconv.FormatFloat(input.Assumptions.StressRPS, 'f', -1, 64),
		strconv.FormatFloat(input.Assumptions.Headroom, 'f', -1, 64),
		strings.TrimSpace(input.Assumptions.Note),
	}, "|")
}

func planCapacity(at time.Time, input capacityInput) (capacityResult, error) {
	if strings.TrimSpace(input.Timezone) == "" {
		return capacityResult{}, errCapacityInvalid
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		return capacityResult{}, errCapacityInvalid
	}
	if _, ok := oncallPublicName(input.Service); !ok {
		return capacityResult{}, errCapacityInvalid
	}
	note := strings.TrimSpace(input.Assumptions.Note)
	if len(note) > capacityNoteLimit || !capacityPublicText(note) {
		return capacityResult{}, errCapacityInvalid
	}
	if input.Evidence == nil {
		return capacityBase([]string{"load evidence missing"}, "unknown"), nil
	}
	evidence := input.Evidence
	if evidence.Failed {
		return capacityBase([]string{"load evidence failed"}, "unknown"), nil
	}
	if !capacityPublicText(evidence.Bottleneck) || len(evidence.Bottleneck) > capacityNoteLimit {
		return capacityResult{}, errCapacityInvalid
	}
	if !strings.EqualFold(strings.TrimSpace(evidence.Unit), "rps") {
		return capacityResult{}, errCapacityInvalid
	}
	if evidence.ObservedAt.IsZero() {
		return capacityBase([]string{"load evidence missing"}, "unknown"), nil
	}
	if evidence.ObservedAt.Before(at.Add(-capacityFreshFor)) {
		return capacityBase([]string{"load evidence stale"}, "unknown"), nil
	}
	if strings.TrimSpace(evidence.WorkloadRevision) == "" || evidence.WorkloadRevision != strings.TrimSpace(input.WorkloadRevision) {
		return capacityBase([]string{"workload revision differs"}, "unknown"), nil
	}
	minimum, err := capacityReplicas(input.Assumptions.ExpectedRPS, evidence.SustainableRPS, input.Assumptions.Headroom)
	if err != nil {
		return capacityResult{}, err
	}
	maximum := minimum
	if input.Assumptions.StressRPS > 0 {
		maximum, err = capacityReplicas(input.Assumptions.StressRPS, evidence.SustainableRPS, input.Assumptions.Headroom)
		if err != nil {
			return capacityResult{}, err
		}
	}
	blockers := make([]string, 0, 3)
	if input.Limits.NodeCapacity <= 0 {
		blockers = append(blockers, "node capacity missing")
	}
	if input.Limits.DatabaseQuota <= 0 {
		blockers = append(blockers, "database quota missing")
	}
	if input.Limits.DependencyLimit <= 0 {
		blockers = append(blockers, "dependency capacity missing")
	}
	result := capacityBase(blockers, "review")
	result.Minimum = minimum
	result.Maximum = maximum
	if len(blockers) > 0 {
		result.Readiness = "blocked"
	}
	return result, nil
}

func capacityPublicText(value string) bool {
	lower := strings.ToLower(value)
	return !strings.Contains(lower, "password") && !strings.Contains(lower, "secret") && !strings.Contains(lower, "token")
}

func applyCapacityInput(plan *capacityPlan, input capacityInput, at time.Time) (capacityResult, error) {
	result, err := planCapacity(at, input)
	if err != nil {
		return capacityResult{}, err
	}
	plan.Input = input
	if capacityFingerprint(input) != plan.ApprovedFingerprint {
		result.Approved = false
		if result.Readiness == "approved" {
			result.Readiness = "review"
		}
	} else if plan.ApprovedFingerprint != "" && result.Readiness == "review" {
		result.Approved = true
		result.Readiness = "approved"
		if len(plan.ChangeRefs) > 0 {
			result.ChangeRef = plan.ChangeRefs[len(plan.ChangeRefs)-1]
		}
	}
	plan.Result = result
	return result, nil
}

func approveCapacity(plan *capacityPlan, key string, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errCapacityHidden
	}
	if !memberAllowed {
		return errCapacityDenied
	}
	key = strings.TrimSpace(key)
	if key == "" || plan.Result.Readiness == "unknown" || plan.Result.Readiness == "blocked" || plan.Result.Readiness == "" {
		return errCapacityInvalid
	}
	plan.ApprovedFingerprint = capacityFingerprint(plan.Input)
	plan.Result.Approved = true
	plan.Result.Readiness = "approved"
	plan.Result.Executed = false
	for _, existing := range plan.ChangeRefs {
		if existing == key {
			plan.Result.ChangeRef = key
			return nil
		}
	}
	plan.ChangeRefs = append(plan.ChangeRefs, key)
	plan.Result.ChangeRef = key
	return nil
}

func executeCapacity(plan *capacityPlan) error {
	plan.Result.Executed = false
	return errCapacityInvalid
}

type capacityStore struct {
	mu    sync.Mutex
	plans map[string]capacityPlan
}

var capacityPlans = &capacityStore{plans: map[string]capacityPlan{}}

func capacityKey(projectID int, environment, service string) string {
	return strings.TrimSpace(environment) + ":" + strconv.Itoa(projectID) + ":" + strings.TrimSpace(service)
}

func capacityPlanHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	subject := authzSubjectForUser(userID)
	projectID, environment, action, input, changeKey, err := readCapacityRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
		return
	}
	write := action == "approve" || action == "execute"
	decision := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Environment:    environment,
			Kind:           "capacity",
			ResourceID:     capacityKey(projectID, environment, input.Service),
		},
		Action: map[bool]authzAction{true: authzWrite, false: authzRead}[write],
	})
	if !decision.Allowed {
		status := http.StatusNotFound
		if write && decision.Reason == "role cannot perform this action" {
			status = http.StatusForbidden
		}
		writeAPIError(w, r, status, "Capacity readiness is not available for this scope.", nil)
		return
	}
	switch action {
	case "", "read":
		writeCapacityRead(w, projectID, environment, input.Service)
	case "preview":
		result, planErr := planCapacity(time.Now().UTC(), input)
		if planErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "preview", "approved": false, "executed": false, "result": result})
	case "approve":
		key := capacityKey(projectID, environment, input.Service)
		capacityPlans.mu.Lock()
		plan := capacityPlans.plans[key]
		result, planErr := applyCapacityInput(&plan, input, time.Now().UTC())
		if planErr != nil {
			capacityPlans.mu.Unlock()
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		if err := approveCapacity(&plan, changeKey, true, true); err != nil {
			capacityPlans.mu.Unlock()
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		capacityPlans.plans[key] = plan
		capacityPlans.mu.Unlock()
		persistCapacityPlan(projectID, environment, plan)
		result = plan.Result
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "approved", "approved": true, "executed": false, "result": result})
	case "execute":
		writeAPIError(w, r, http.StatusBadRequest, "An approved plan does not change production.", nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
	}
}

func writeCapacityRead(w http.ResponseWriter, projectID int, environment, service string) {
	capacityPlans.mu.Lock()
	plan, ok := capacityPlans.plans[capacityKey(projectID, environment, service)]
	capacityPlans.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusOK, map[string]interface{}{"state": "empty", "result": capacityBase([]string{"No capacity plan is active for this project."}, "unknown")})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"state": plan.Result.Readiness, "result": plan.Result})
}

func readCapacityRequest(r *http.Request) (int, string, string, capacityInput, string, error) {
	var body struct {
		ProjectID   int           `json:"project_id"`
		Environment string        `json:"environment"`
		Action      string        `json:"action"`
		ChangeKey   string        `json:"change_key"`
		Input       capacityInput `json:"input"`
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, part := range []byte(r.URL.Query().Get("project_id")) {
			if part < '0' || part > '9' {
				return 0, "", "", capacityInput{}, "", errCapacityInvalid
			}
			projectID = projectID*10 + int(part-'0')
		}
		environment := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("environment")))
		service := strings.TrimSpace(r.URL.Query().Get("service"))
		if projectID <= 0 || !singleEnvironment(environment) || service == "" {
			return 0, "", "", capacityInput{}, "", errCapacityInvalid
		}
		return projectID, environment, "read", capacityInput{Service: service}, "", nil
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return 0, "", "", capacityInput{}, "", errCapacityInvalid
	}
	environment := strings.ToLower(strings.TrimSpace(body.Environment))
	if body.ProjectID <= 0 || !singleEnvironment(environment) {
		return 0, "", "", capacityInput{}, "", errCapacityInvalid
	}
	return body.ProjectID, environment, strings.ToLower(strings.TrimSpace(body.Action)), body.Input, strings.TrimSpace(body.ChangeKey), nil
}

func persistCapacityPlan(projectID int, environment string, plan capacityPlan) {
	if DB == nil {
		return
	}
	raw, err := json.Marshal(plan.Result)
	if err != nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO capacity_plan_versions (project_id, environment, service, readiness, payload)
		VALUES ($1, $2, $3, $4, $5)
	`, projectID, environment, plan.Input.Service, plan.Result.Readiness, string(raw))
}

func migrateCapacityPlanSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS capacity_plan_versions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(80) NOT NULL,
			service VARCHAR(120) NOT NULL,
			readiness VARCHAR(20) NOT NULL,
			payload TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
}
