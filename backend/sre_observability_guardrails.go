package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type monitorGuardrailPolicy struct {
	ID               int    `json:"id"`
	ServiceID        int    `json:"service_id"`
	Environment      string `json:"environment"`
	Mode             string `json:"mode"`
	BlockOnCritical  bool   `json:"block_on_critical"`
	MinBudgetBPS     int    `json:"min_budget_bps"`
	FreshnessMinutes int    `json:"freshness_minutes"`
	PolicyVersion    int    `json:"policy_version"`
}

type monitorGuardrailDecision struct {
	ID             int            `json:"id"`
	ChangeID       int            `json:"change_id"`
	ServiceID      int            `json:"service_id"`
	Environment    string         `json:"environment"`
	ArtifactSHA    string         `json:"artifact_sha"`
	Mode           string         `json:"mode"`
	Outcome        string         `json:"outcome"`
	Reason         string         `json:"reason"`
	Evidence       map[string]any `json:"evidence"`
	PolicyVersion  int            `json:"policy_version"`
	ExpiresAt      *string        `json:"expires_at,omitempty"`
	OverrideReason string         `json:"override_reason,omitempty"`
}

func loadGuardrailPolicy(serviceID int, environment string) monitorGuardrailPolicy {
	policy := monitorGuardrailPolicy{
		ServiceID: serviceID, Environment: environment, Mode: "observation",
		BlockOnCritical: true, MinBudgetBPS: 2000, FreshnessMinutes: 1440, PolicyVersion: 1,
	}
	if DB == nil {
		return policy
	}
	_ = queryRowContext(`
		SELECT id, mode, block_on_critical, min_budget_bps, freshness_minutes, policy_version
		FROM monitor_guardrail_policies
		WHERE service_id = $1 AND LOWER(environment) = LOWER($2)
	`, serviceID, environment).Scan(&policy.ID, &policy.Mode, &policy.BlockOnCritical, &policy.MinBudgetBPS, &policy.FreshnessMinutes, &policy.PolicyVersion)
	if policy.Mode != "enforced" {
		policy.Mode = "observation"
	}
	return policy
}

func saveGuardrailPolicy(userID int, service *serviceMapEntry, body monitorGuardrailPolicy) monitorGuardrailPolicy {
	env := strings.TrimSpace(body.Environment)
	if env == "" {
		env = service.Environment
	}
	mode := "observation"
	if strings.EqualFold(strings.TrimSpace(body.Mode), "enforced") {
		mode = "enforced"
	}
	minBudget := body.MinBudgetBPS
	if minBudget <= 0 {
		minBudget = 2000
	}
	fresh := body.FreshnessMinutes
	if fresh <= 0 {
		fresh = 1440
	}
	_, _ = execContext(`
		INSERT INTO monitor_guardrail_policies (service_id, environment, mode, block_on_critical, min_budget_bps, freshness_minutes, policy_version, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,1,$7)
		ON CONFLICT (service_id, environment) DO UPDATE SET
			mode = EXCLUDED.mode,
			block_on_critical = EXCLUDED.block_on_critical,
			min_budget_bps = EXCLUDED.min_budget_bps,
			freshness_minutes = EXCLUDED.freshness_minutes,
			policy_version = monitor_guardrail_policies.policy_version + 1,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`, service.ID, env, mode, body.BlockOnCritical, minBudget, fresh, userID)
	return loadGuardrailPolicy(service.ID, env)
}

func evaluateServiceGuardrail(service *serviceMapEntry, sha string) monitorGuardrailDecision {
	policy := loadGuardrailPolicy(service.ID, service.Environment)
	decision := monitorGuardrailDecision{
		ServiceID: service.ID, Environment: service.Environment, ArtifactSHA: strings.TrimSpace(sha),
		Mode: policy.Mode, PolicyVersion: policy.PolicyVersion, Evidence: map[string]any{},
	}
	monitors, _ := listServiceMonitors(service.ID, service.Environment)
	openCritical := 0
	stale := false
	unknown := false
	lowestBudget := 10000
	evaluated := 0
	now := time.Now().UTC()
	for _, monitor := range monitors {
		if !monitor.Enabled {
			continue
		}
		if monitor.Latest == nil {
			unknown = true
			continue
		}
		evaluated++
		decision.Evidence[monitor.Name] = monitor.Latest.Measurement.State
		if monitor.Latest.Measurement.State == measureQueryFailed || monitor.Latest.Measurement.State == measureUnknown {
			unknown = true
		}
		if monitor.Latest.EvaluatedAt != nil {
			stamp, err := time.Parse(time.RFC3339, *monitor.Latest.EvaluatedAt)
			if err == nil && policy.FreshnessMinutes > 0 && now.Sub(stamp) > time.Duration(policy.FreshnessMinutes)*time.Minute {
				stale = true
			}
		}
		if monitor.Latest.Measurement.BudgetRemainBPS > 0 && monitor.Latest.Measurement.BudgetRemainBPS < lowestBudget {
			lowestBudget = monitor.Latest.Measurement.BudgetRemainBPS
		}
	}
	findings, _ := listMonitorFindings(service.ID, service.Environment, findingCritical, "")
	for _, finding := range findings {
		if finding.Lifecycle != lifecycleResolved {
			openCritical++
		}
	}
	decision.Evidence["open_critical"] = openCritical
	decision.Evidence["evaluated_monitors"] = evaluated
	decision.Evidence["budget_remaining_bps"] = lowestBudget
	switch {
	case evaluated == 0 || unknown:
		decision.Outcome = "insufficient_evidence"
		decision.Reason = "Monitoring evidence is missing, unknown, or failed. This is not a healthy result."
	case stale:
		decision.Outcome = "stale"
		decision.Reason = "The latest evaluation is older than the freshness limit."
	case policy.BlockOnCritical && openCritical > 0:
		decision.Outcome = "block"
		decision.Reason = "Open critical findings exist for this service and environment."
	case lowestBudget < policy.MinBudgetBPS:
		decision.Outcome = "block"
		decision.Reason = "Error budget remaining is below the guardrail threshold."
	default:
		decision.Outcome = "allow"
		decision.Reason = "Current evidence meets the guardrail policy."
	}
	if policy.Mode == "observation" && decision.Outcome != "allow" {
		decision.Outcome = "proposed_" + decision.Outcome
		decision.Reason = "Observation only: " + decision.Reason
	}
	return decision
}

func persistGuardrailDecision(changeID int, decision monitorGuardrailDecision) monitorGuardrailDecision {
	if DB == nil {
		return decision
	}
	raw, _ := json.Marshal(decision.Evidence)
	expires := time.Now().UTC().Add(30 * time.Minute)
	_ = queryRowContext(`
		INSERT INTO monitor_guardrail_decisions (change_id, service_id, environment, artifact_sha, mode, outcome, reason, evidence, policy_version, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
		RETURNING id
	`, changeID, decision.ServiceID, decision.Environment, decision.ArtifactSHA, decision.Mode, decision.Outcome, decision.Reason, string(raw), decision.PolicyVersion, expires).Scan(&decision.ID)
	stamp := expires.Format(time.RFC3339)
	decision.ExpiresAt = &stamp
	return decision
}

func evaluateChangeGuardrail(change *changeRequestRecord) *monitorGuardrailDecision {
	if change == nil || strings.TrimSpace(change.Service) == "" {
		return nil
	}
	service := lookupServiceMap(change.Service, change.Repo, change.Environment)
	if service == nil {
		return nil
	}
	decision := evaluateServiceGuardrail(service, change.SHA)
	decision.ChangeID = change.ID
	stored := persistGuardrailDecision(change.ID, decision)
	return &stored
}

func latestServiceGuardrailDecision(serviceID int, environment string) *monitorGuardrailDecision {
	if DB == nil || serviceID <= 0 {
		return nil
	}
	var item monitorGuardrailDecision
	var evidence []byte
	var expires sql.NullTime
	err := queryRowContext(`
		SELECT id, change_id, service_id, environment, artifact_sha, mode, outcome, reason, evidence, policy_version, expires_at, override_reason
		FROM monitor_guardrail_decisions
		WHERE service_id = $1 AND ($2 = '' OR LOWER(environment) = LOWER($2))
		ORDER BY id DESC LIMIT 1
	`, serviceID, environment).Scan(&item.ID, &item.ChangeID, &item.ServiceID, &item.Environment, &item.ArtifactSHA, &item.Mode, &item.Outcome, &item.Reason, &evidence, &item.PolicyVersion, &expires, &item.OverrideReason)
	if err != nil {
		return nil
	}
	_ = json.Unmarshal(evidence, &item.Evidence)
	if expires.Valid {
		stamp := expires.Time.UTC().Format(time.RFC3339)
		item.ExpiresAt = &stamp
	}
	return &item
}

func latestGuardrailOverride(changeID int, sha string) *monitorGuardrailDecision {
	if DB == nil || changeID <= 0 {
		return nil
	}
	var item monitorGuardrailDecision
	var evidence []byte
	var expires sql.NullTime
	err := queryRowContext(`
		SELECT id, change_id, service_id, environment, artifact_sha, mode, outcome, reason, evidence, policy_version, expires_at, override_reason
		FROM monitor_guardrail_decisions
		WHERE change_id = $1 AND outcome = 'overridden'
		ORDER BY id DESC LIMIT 1
	`, changeID).Scan(&item.ID, &item.ChangeID, &item.ServiceID, &item.Environment, &item.ArtifactSHA, &item.Mode, &item.Outcome, &item.Reason, &evidence, &item.PolicyVersion, &expires, &item.OverrideReason)
	if err != nil {
		return nil
	}
	_ = json.Unmarshal(evidence, &item.Evidence)
	exp := time.Time{}
	if expires.Valid {
		exp = expires.Time.UTC()
		stamp := exp.Format(time.RFC3339)
		item.ExpiresAt = &stamp
	}
	if ok, _ := artifactDecisionUsable(item.ArtifactSHA, sha, exp, time.Now().UTC(), item.Outcome); !ok {
		return nil
	}
	return &item
}

func releaseBlockedByGuardrail(change *changeRequestRecord) *monitorGuardrailDecision {
	decision := evaluateChangeGuardrail(change)
	if decision == nil {
		return nil
	}
	if latestGuardrailOverride(change.ID, change.SHA) != nil {
		return nil
	}
	if !decision.blocksRelease() {
		return nil
	}
	return decision
}

func (d monitorGuardrailDecision) blocksRelease() bool {
	return d.Mode == "enforced" && (d.Outcome == "block" || d.Outcome == "stale" || d.Outcome == "insufficient_evidence")
}

func overrideGuardrailDecision(userID, id int, reason string) (*monitorGuardrailDecision, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, fmt.Errorf("override reason is required")
	}
	_, err := execContext(`
		UPDATE monitor_guardrail_decisions
		SET outcome = 'overridden', override_reason = $2, override_by = $3
		WHERE id = $1
	`, id, reason, userID)
	if err != nil {
		return nil, err
	}
	var item monitorGuardrailDecision
	var evidence []byte
	var expires sql.NullTime
	err = queryRowContext(`
		SELECT id, change_id, service_id, environment, artifact_sha, mode, outcome, reason, evidence, policy_version, expires_at, override_reason
		FROM monitor_guardrail_decisions WHERE id = $1
	`, id).Scan(&item.ID, &item.ChangeID, &item.ServiceID, &item.Environment, &item.ArtifactSHA, &item.Mode, &item.Outcome, &item.Reason, &evidence, &item.PolicyVersion, &expires, &item.OverrideReason)
	if err != nil {
		return nil, fmt.Errorf("decision not found")
	}
	_ = json.Unmarshal(evidence, &item.Evidence)
	if expires.Valid {
		stamp := expires.Time.UTC().Format(time.RFC3339)
		item.ExpiresAt = &stamp
	}
	return &item, nil
}

func devopsGuardrailDecisionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	id, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/monitoring/guardrail-decisions/"), "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid decision id", err)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	item, err := overrideGuardrailDecision(userID, id, body.Reason)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"decision": item, "status": "ok"})
}
