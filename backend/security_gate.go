package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	pinnedGateMode       = "new-versus-baseline"
	defaultGateThreshold = "high"
	gateGuidance         = "Review the finding on this revision. A scoped exception stays separate and does not turn an unavailable scan into a pass."
)

var (
	errGateHidden  = errors.New("security gate not found")
	errGateDenied  = errors.New("security gate is not permitted")
	errGateInvalid = errors.New("security gate is invalid")
	gateClock      = func() time.Time { return time.Now() }
)

type securityGatePolicy struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Version     int    `json:"version"`
	Mode        string `json:"mode"`
	Threshold   string `json:"threshold"`
	ActorUserID int    `json:"actor_user_id"`
}

type securityGateFinding struct {
	ID             int    `json:"id"`
	DecisionID     int    `json:"decision_id"`
	CommitSHA      string `json:"commit_sha"`
	RuleID         string `json:"rule_id"`
	Path           string `json:"path"`
	Severity       string `json:"severity"`
	Classification string `json:"classification"`
}

type securityGateDecision struct {
	ID            int                   `json:"id"`
	ProjectID     int                   `json:"project_id"`
	Repository    string                `json:"repository"`
	CommitSHA     string                `json:"commit_sha"`
	BaselineSHA   string                `json:"baseline_sha"`
	PolicyID      int                   `json:"policy_id"`
	PolicyVersion int                   `json:"policy_version"`
	ScanState     string                `json:"scan_state"`
	Decision      string                `json:"decision"`
	Reason        string                `json:"reason"`
	Guidance      string                `json:"guidance"`
	Pass          bool                  `json:"pass"`
	ExceptionID   int                   `json:"exception_id,omitempty"`
	Findings      []securityGateFinding `json:"findings"`
}

type securityGateOverride struct {
	ID          int       `json:"id"`
	ProjectID   int       `json:"project_id"`
	DecisionID  int       `json:"decision_id"`
	Reason      string    `json:"reason"`
	ActorUserID int       `json:"actor_user_id"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type gateAuditRecord struct {
	ProjectID   int
	PolicyID    int
	Version     int
	ActorUserID int
	Action      string
	Summary     string
}

type gateSummaryInput struct {
	ProjectID   int
	Repository  string
	CommitSHA   string
	BaselineSHA string
	ScanState   string
	Findings    []securityGateFinding
	Baseline    []securityGateFinding
}

var (
	saveGatePolicy        = saveGatePolicyToDB
	findCurrentGatePolicy = findCurrentGatePolicyFromDB
	saveGateDecision      = saveGateDecisionToDB
	findGateDecision      = findGateDecisionFromDB
	insertGateFinding     = insertGateFindingToDB
	listGateFindings      = listGateFindingsFromDB
	saveGateAudit         = saveGateAuditToDB
	saveGateOverride      = saveGateOverrideToDB
	findGateOverride      = findGateOverrideFromDB
)

func severityRank(value string) int {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low":
		return 1
	case "medium":
		return 2
	case "high":
		return 3
	case "critical":
		return 4
	default:
		return 0
	}
}

func recordGatePolicy(actor authzSubject, projectID int, mode, threshold string) (securityGatePolicy, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return securityGatePolicy{}, errGateHidden
	}
	if !mappingAllowed(actor, projectID, authzWrite) {
		return securityGatePolicy{}, errGateDenied
	}
	mode = strings.TrimSpace(mode)
	if mode == "" {
		mode = pinnedGateMode
	}
	if mode != pinnedGateMode {
		return securityGatePolicy{}, errGateInvalid
	}
	current, err := findCurrentGatePolicy(projectID)
	if err != nil {
		return securityGatePolicy{}, err
	}
	threshold = strings.ToLower(strings.TrimSpace(threshold))
	if threshold == "" {
		if current.ID > 0 {
			return current, nil
		}
		threshold = defaultGateThreshold
	}
	if severityRank(threshold) == 0 {
		return securityGatePolicy{}, errGateInvalid
	}
	if current.ID > 0 && current.Threshold == threshold && current.Mode == mode {
		return current, nil
	}
	previous := "none"
	version := 1
	if current.ID > 0 {
		previous = current.Threshold
		version = current.Version + 1
	}
	saved, err := saveGatePolicy(securityGatePolicy{
		ProjectID: projectID, Version: version, Mode: mode, Threshold: threshold, ActorUserID: actor.UserID,
	})
	if err != nil {
		return securityGatePolicy{}, err
	}
	if err := saveGateAudit(gateAuditRecord{
		ProjectID: projectID, PolicyID: saved.ID, Version: saved.Version, ActorUserID: actor.UserID,
		Action: "security_gate_policy", Summary: fmt.Sprintf("threshold %s to %s", previous, threshold),
	}); err != nil {
		return securityGatePolicy{}, err
	}
	return saved, nil
}

func publishGateSummary(actor authzSubject, input gateSummaryInput) (securityGateDecision, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return securityGateDecision{}, errGateHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return securityGateDecision{}, errGateDenied
	}
	policy, err := findCurrentGatePolicy(input.ProjectID)
	if err != nil {
		return securityGateDecision{}, err
	}
	if policy.ID <= 0 {
		return securityGateDecision{}, errGateInvalid
	}
	normalized, findings, err := normalizeGateSummary(input)
	if err != nil {
		return securityGateDecision{}, err
	}
	existing, err := findGateDecision(normalized.ProjectID, normalized.Repository, normalized.CommitSHA, policy.Version)
	if err != nil {
		return securityGateDecision{}, err
	}
	if existing.ID > 0 {
		return presentGateDecision(existing)
	}
	decisionName, reason := evaluateGate(normalized.ScanState, policy.Threshold, findings)
	saved, err := saveGateDecision(securityGateDecision{
		ProjectID: normalized.ProjectID, Repository: normalized.Repository, CommitSHA: normalized.CommitSHA,
		BaselineSHA: normalized.BaselineSHA, PolicyID: policy.ID, PolicyVersion: policy.Version,
		ScanState: strings.ToLower(strings.TrimSpace(normalized.ScanState)), Decision: decisionName, Reason: reason,
	})
	if err != nil {
		return securityGateDecision{}, err
	}
	for _, finding := range findings {
		finding.DecisionID = saved.ID
		stored, err := insertGateFinding(finding)
		if err != nil {
			return securityGateDecision{}, err
		}
		saved.Findings = append(saved.Findings, stored)
	}
	return presentGateDecision(saved)
}

func normalizeGateSummary(input gateSummaryInput) (securityGateDecision, []securityGateFinding, error) {
	decision := securityGateDecision{
		ProjectID:   input.ProjectID,
		Repository:  strings.TrimSpace(input.Repository),
		CommitSHA:   strings.ToLower(strings.TrimSpace(input.CommitSHA)),
		BaselineSHA: strings.ToLower(strings.TrimSpace(input.BaselineSHA)),
		ScanState:   strings.ToLower(strings.TrimSpace(input.ScanState)),
	}
	if decision.Repository == "" || strings.Contains(decision.Repository, " ") || strings.Contains(decision.Repository, "\n") || !reportSHAPattern.MatchString(decision.CommitSHA) {
		return securityGateDecision{}, nil, errGateInvalid
	}
	if decision.BaselineSHA != "" && (!reportSHAPattern.MatchString(decision.BaselineSHA) || decision.BaselineSHA == decision.CommitSHA) {
		return securityGateDecision{}, nil, errGateInvalid
	}
	if decision.BaselineSHA == "" && len(input.Baseline) > 0 {
		return securityGateDecision{}, nil, errGateInvalid
	}
	baseline := map[string]struct{}{}
	for _, finding := range input.Baseline {
		key, err := gateFindingKey(finding)
		if err != nil {
			return securityGateDecision{}, nil, err
		}
		baseline[key] = struct{}{}
	}
	seen := map[string]struct{}{}
	var findings []securityGateFinding
	for _, finding := range input.Findings {
		key, err := gateFindingKey(finding)
		if err != nil {
			return securityGateDecision{}, nil, err
		}
		if _, ok := seen[key]; ok {
			return securityGateDecision{}, nil, errGateInvalid
		}
		seen[key] = struct{}{}
		classification := "new"
		if _, ok := baseline[key]; ok {
			classification = "baseline"
		}
		findings = append(findings, securityGateFinding{
			CommitSHA: decision.CommitSHA, RuleID: strings.TrimSpace(finding.RuleID), Path: strings.TrimSpace(finding.Path),
			Severity: strings.ToLower(strings.TrimSpace(finding.Severity)), Classification: classification,
		})
	}
	return decision, findings, nil
}

func gateFindingKey(finding securityGateFinding) (string, error) {
	ruleID := strings.TrimSpace(finding.RuleID)
	path := strings.TrimSpace(finding.Path)
	if ruleID == "" || path == "" || strings.Contains(ruleID, "\n") || strings.Contains(path, "\n") || severityRank(finding.Severity) == 0 {
		return "", errGateInvalid
	}
	return ruleID + "\n" + path, nil
}

func evaluateGate(scanState, threshold string, findings []securityGateFinding) (string, string) {
	if strings.ToLower(strings.TrimSpace(scanState)) != "available" {
		return "unknown", "unavailable scan"
	}
	limit := severityRank(threshold)
	for _, finding := range findings {
		if finding.Classification == "new" && severityRank(finding.Severity) >= limit {
			return "fail", "new finding meets threshold"
		}
	}
	return "pass", "no new finding meets threshold"
}

func recordGateOverride(actor authzSubject, decisionID int, reason string, expiresAt time.Time) (securityGateDecision, error) {
	decision, err := findGateDecisionByID(decisionID)
	if err != nil || decision.ID <= 0 {
		return securityGateDecision{}, errGateHidden
	}
	if !mappingAllowed(actor, decision.ProjectID, authzRead) {
		return securityGateDecision{}, errGateHidden
	}
	if !mappingAllowed(actor, decision.ProjectID, authzWrite) {
		return securityGateDecision{}, errGateDenied
	}
	existing, err := findGateOverride(decision.ID)
	if err != nil {
		return securityGateDecision{}, err
	}
	if existing.ID > 0 {
		return presentGateDecision(decision)
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.Contains(reason, "\n") || strings.EqualFold(reason, "pass") || strings.EqualFold(reason, "healthy") || !expiresAt.After(gateClock()) {
		return securityGateDecision{}, errGateInvalid
	}
	if decision.Decision != "fail" {
		return securityGateDecision{}, errGateInvalid
	}
	saved, err := saveGateOverride(securityGateOverride{
		ProjectID: decision.ProjectID, DecisionID: decision.ID, Reason: reason, ActorUserID: actor.UserID, ExpiresAt: expiresAt.UTC(),
	})
	if err != nil {
		return securityGateDecision{}, err
	}
	if err := saveGateAudit(gateAuditRecord{
		ProjectID: decision.ProjectID, PolicyID: decision.PolicyID, Version: decision.PolicyVersion, ActorUserID: actor.UserID,
		Action: "security_gate_override", Summary: fmt.Sprintf("decision %d until %s", decision.ID, saved.ExpiresAt.Format(time.RFC3339)),
	}); err != nil {
		return securityGateDecision{}, err
	}
	return presentGateDecision(decision)
}

func loadGateSummary(actor authzSubject, projectID int, repository, commitSHA string) (securityGateDecision, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return securityGateDecision{}, errGateHidden
	}
	policy, err := findCurrentGatePolicy(projectID)
	if err != nil || policy.ID <= 0 {
		return securityGateDecision{}, errGateHidden
	}
	repository = strings.TrimSpace(repository)
	commitSHA = strings.ToLower(strings.TrimSpace(commitSHA))
	decision, err := findGateDecision(projectID, repository, commitSHA, policy.Version)
	if err != nil || decision.ID <= 0 {
		return securityGateDecision{}, errGateHidden
	}
	return presentGateDecision(decision)
}

func presentGateDecision(decision securityGateDecision) (securityGateDecision, error) {
	if decision.Findings == nil {
		findings, err := listGateFindings(decision.ID)
		if err != nil {
			return securityGateDecision{}, err
		}
		decision.Findings = findings
	}
	decision.Guidance = gateGuidance
	decision.Pass = decision.Decision == "pass"
	decision.ExceptionID = 0
	if decision.Decision != "fail" {
		return decision, nil
	}
	override, err := findGateOverride(decision.ID)
	if err != nil {
		return securityGateDecision{}, err
	}
	if override.ID > 0 && override.ExpiresAt.After(gateClock()) {
		decision.Decision = "exception"
		decision.Reason = "scoped exception"
		decision.Pass = false
		decision.ExceptionID = override.ID
	}
	return decision, nil
}

func findGateDecisionByID(id int) (securityGateDecision, error) {
	if id <= 0 {
		return securityGateDecision{}, errGateHidden
	}
	return loadGateDecisionByID(id)
}

var loadGateDecisionByID = loadGateDecisionByIDFromDB

func migrateSecurityGateSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_gate_policies (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			version INTEGER NOT NULL,
			mode VARCHAR(64) NOT NULL,
			threshold VARCHAR(16) NOT NULL,
			actor_user_id INTEGER NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_gate_decisions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			repository VARCHAR(200) NOT NULL,
			commit_sha CHAR(40) NOT NULL,
			baseline_sha VARCHAR(40) NOT NULL DEFAULT '',
			policy_id INTEGER NOT NULL,
			policy_version INTEGER NOT NULL,
			scan_state VARCHAR(32) NOT NULL,
			decision VARCHAR(32) NOT NULL,
			reason VARCHAR(200) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, repository, commit_sha, policy_version)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_gate_findings (
			id SERIAL PRIMARY KEY,
			decision_id INTEGER NOT NULL,
			commit_sha CHAR(40) NOT NULL,
			rule_id VARCHAR(128) NOT NULL,
			path TEXT NOT NULL,
			severity VARCHAR(16) NOT NULL,
			classification VARCHAR(16) NOT NULL
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS security_gate_overrides (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			decision_id INTEGER NOT NULL UNIQUE,
			reason TEXT NOT NULL,
			actor_user_id INTEGER NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveGatePolicyToDB(item securityGatePolicy) (securityGatePolicy, error) {
	if DB == nil {
		return securityGatePolicy{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_gate_policies (project_id, version, mode, threshold, actor_user_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, item.ProjectID, item.Version, item.Mode, item.Threshold, item.ActorUserID).Scan(&item.ID)
	return item, err
}

func findCurrentGatePolicyFromDB(projectID int) (securityGatePolicy, error) {
	if DB == nil || projectID <= 0 {
		return securityGatePolicy{}, nil
	}
	var item securityGatePolicy
	err := DB.QueryRow(`
		SELECT id, project_id, version, mode, threshold, actor_user_id
		FROM security_gate_policies WHERE project_id = $1 ORDER BY version DESC LIMIT 1
	`, projectID).Scan(&item.ID, &item.ProjectID, &item.Version, &item.Mode, &item.Threshold, &item.ActorUserID)
	if err != nil {
		return securityGatePolicy{}, nil
	}
	return item, nil
}

func saveGateDecisionToDB(item securityGateDecision) (securityGateDecision, error) {
	if DB == nil {
		return securityGateDecision{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_gate_decisions (project_id, repository, commit_sha, baseline_sha, policy_id, policy_version, scan_state, decision, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, item.ProjectID, item.Repository, item.CommitSHA, item.BaselineSHA, item.PolicyID, item.PolicyVersion, item.ScanState, item.Decision, item.Reason).Scan(&item.ID)
	return item, err
}

func findGateDecisionFromDB(projectID int, repository, commitSHA string, policyVersion int) (securityGateDecision, error) {
	if DB == nil {
		return securityGateDecision{}, nil
	}
	var item securityGateDecision
	err := DB.QueryRow(`
		SELECT id, project_id, repository, commit_sha, baseline_sha, policy_id, policy_version, scan_state, decision, reason
		FROM security_gate_decisions
		WHERE project_id = $1 AND repository = $2 AND commit_sha = $3 AND policy_version = $4
	`, projectID, repository, commitSHA, policyVersion).Scan(
		&item.ID, &item.ProjectID, &item.Repository, &item.CommitSHA, &item.BaselineSHA, &item.PolicyID, &item.PolicyVersion, &item.ScanState, &item.Decision, &item.Reason,
	)
	if err != nil {
		return securityGateDecision{}, nil
	}
	return item, nil
}

func loadGateDecisionByIDFromDB(id int) (securityGateDecision, error) {
	if DB == nil || id <= 0 {
		return securityGateDecision{}, errGateHidden
	}
	var item securityGateDecision
	err := DB.QueryRow(`
		SELECT id, project_id, repository, commit_sha, baseline_sha, policy_id, policy_version, scan_state, decision, reason
		FROM security_gate_decisions WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.Repository, &item.CommitSHA, &item.BaselineSHA, &item.PolicyID, &item.PolicyVersion, &item.ScanState, &item.Decision, &item.Reason)
	if err != nil {
		return securityGateDecision{}, errGateHidden
	}
	return item, nil
}

func insertGateFindingToDB(item securityGateFinding) (securityGateFinding, error) {
	if DB == nil {
		return securityGateFinding{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_gate_findings (decision_id, commit_sha, rule_id, path, severity, classification)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.DecisionID, item.CommitSHA, item.RuleID, item.Path, item.Severity, item.Classification).Scan(&item.ID)
	return item, err
}

func listGateFindingsFromDB(decisionID int) ([]securityGateFinding, error) {
	if DB == nil || decisionID <= 0 {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, decision_id, commit_sha, rule_id, path, severity, classification
		FROM security_gate_findings WHERE decision_id = $1 ORDER BY id
	`, decisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []securityGateFinding
	for rows.Next() {
		var item securityGateFinding
		if err := rows.Scan(&item.ID, &item.DecisionID, &item.CommitSHA, &item.RuleID, &item.Path, &item.Severity, &item.Classification); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveGateAuditToDB(item gateAuditRecord) error {
	if DB == nil {
		return errInboxStored
	}
	actor := item.ActorUserID
	project := item.ProjectID
	insertOperatorAudit(operatorAuditRow{
		ActorUserID: &actor, ProjectID: &project, ResourceType: "security_gate_policy",
		ResourceID: strconv.Itoa(item.PolicyID), Action: item.Action, Result: "success", Summary: item.Summary,
	})
	return nil
}

func saveGateOverrideToDB(item securityGateOverride) (securityGateOverride, error) {
	if DB == nil {
		return securityGateOverride{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO security_gate_overrides (project_id, decision_id, reason, actor_user_id, expires_at)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, item.ProjectID, item.DecisionID, item.Reason, item.ActorUserID, item.ExpiresAt).Scan(&item.ID)
	return item, err
}

func findGateOverrideFromDB(decisionID int) (securityGateOverride, error) {
	if DB == nil || decisionID <= 0 {
		return securityGateOverride{}, nil
	}
	var item securityGateOverride
	err := DB.QueryRow(`
		SELECT id, project_id, decision_id, reason, actor_user_id, expires_at
		FROM security_gate_overrides WHERE decision_id = $1
	`, decisionID).Scan(&item.ID, &item.ProjectID, &item.DecisionID, &item.Reason, &item.ActorUserID, &item.ExpiresAt)
	if err != nil {
		return securityGateOverride{}, nil
	}
	return item, nil
}

func securityGatePolicyHandler(w http.ResponseWriter, r *http.Request) {
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
		ProjectID int    `json:"project_id"`
		Mode      string `json:"mode"`
		Threshold string `json:"threshold"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeGateError(w, r, errGateInvalid)
		return
	}
	saved, err := recordGatePolicy(actor, body.ProjectID, body.Mode, body.Threshold)
	if err != nil {
		writeGateError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func securityGateSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		actor, err := catalogSubjectFromRequest(r)
		if err != nil {
			writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
			return
		}
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		saved, err := loadGateSummary(actor, projectID, r.URL.Query().Get("repository"), r.URL.Query().Get("commit_sha"))
		if err != nil {
			writeGateError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, saved)
		return
	}
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
		ProjectID   int                   `json:"project_id"`
		Repository  string                `json:"repository"`
		CommitSHA   string                `json:"commit_sha"`
		BaselineSHA string                `json:"baseline_sha"`
		ScanState   string                `json:"scan_state"`
		Findings    []securityGateFinding `json:"findings"`
		Baseline    []securityGateFinding `json:"baseline"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeGateError(w, r, errGateInvalid)
		return
	}
	saved, err := publishGateSummary(actor, gateSummaryInput{
		ProjectID: body.ProjectID, Repository: body.Repository, CommitSHA: body.CommitSHA,
		BaselineSHA: body.BaselineSHA, ScanState: body.ScanState, Findings: body.Findings, Baseline: body.Baseline,
	})
	if err != nil {
		writeGateError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func securityGateOverrideHandler(w http.ResponseWriter, r *http.Request) {
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
		DecisionID int    `json:"decision_id"`
		Reason     string `json:"reason"`
		ExpiresAt  string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeGateError(w, r, errGateInvalid)
		return
	}
	expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(body.ExpiresAt))
	if err != nil {
		writeGateError(w, r, errGateInvalid)
		return
	}
	saved, err := recordGateOverride(actor, body.DecisionID, body.Reason, expiresAt)
	if err != nil {
		writeGateError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func writeGateError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errGateHidden):
		writeAPIError(w, r, http.StatusNotFound, errGateHidden.Error(), nil)
	case errors.Is(err, errGateDenied):
		writeAPIError(w, r, http.StatusForbidden, errGateDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errGateInvalid.Error(), nil)
	}
}
