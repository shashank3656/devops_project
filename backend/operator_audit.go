package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type operatorAuditRow struct {
	ID            int       `json:"id"`
	ActorUserID   *int      `json:"actor_user_id,omitempty"`
	ActorUsername string    `json:"actor_username,omitempty"`
	TeamSlug      string    `json:"team_slug,omitempty"`
	ProjectID     *int      `json:"project_id,omitempty"`
	ProjectName   string    `json:"project_name,omitempty"`
	ProjectCode   string    `json:"project_code,omitempty"`
	Environment   string    `json:"environment,omitempty"`
	ResourceType  string    `json:"resource_type"`
	ResourceID    string    `json:"resource_id"`
	Action        string    `json:"action"`
	Result        string    `json:"result"`
	Summary       string    `json:"summary,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

const (
	operatorAuditDefaultLimit = 50
	operatorAuditMaxLimit     = 200
	operatorAuditMaxOffset    = 10_000
	operatorAuditResourceMax  = 10
)

var operatorAuditSecretPattern = regexp.MustCompile(`(?i)(password|secret|token|bearer|kubeconfig|api[_-]?key|authorization)\s*[:=]\s*\S+`)

func normalizeOperatorAuditLimit(limit int) int {
	if limit <= 0 {
		return operatorAuditDefaultLimit
	}
	if limit > operatorAuditMaxLimit {
		return operatorAuditMaxLimit
	}
	return limit
}

func normalizeOperatorAuditOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	if offset > operatorAuditMaxOffset {
		return operatorAuditMaxOffset
	}
	return offset
}

func migrateOperatorAuditSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS devops_operator_audit_log (
			id SERIAL PRIMARY KEY,
			actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			team_slug VARCHAR(120) NOT NULL DEFAULT '',
			project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
			environment VARCHAR(80) NOT NULL DEFAULT '',
			resource_type VARCHAR(64) NOT NULL DEFAULT '',
			resource_id VARCHAR(256) NOT NULL DEFAULT '',
			action VARCHAR(80) NOT NULL DEFAULT '',
			result VARCHAR(32) NOT NULL DEFAULT 'success',
			summary TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_devops_operator_audit_created ON devops_operator_audit_log(created_at DESC)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_devops_operator_audit_project ON devops_operator_audit_log(project_id, created_at DESC)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_devops_operator_audit_resource ON devops_operator_audit_log(resource_type, resource_id, created_at DESC)`)
}

func sanitizeOperatorAuditSummary(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = operatorAuditSecretPattern.ReplaceAllString(raw, "$1=[redacted]")
	if len(raw) > 500 {
		raw = raw[:497] + "..."
	}
	return raw
}

func operatorAuditActionTracked(action string) bool {
	action = strings.TrimSpace(strings.ToLower(action))
	if action == "" {
		return false
	}
	if strings.HasPrefix(action, "k8s_") {
		return true
	}
	switch action {
	case "request_approve", "request_reject", "request_promote", "promotion_exception",
		"deployment_gate_approve", "deployment_gate_revoke",
		"request_rollback_prepare", "environment_catalog_update",
		"cloud_account_onboard", "cloud_account_disable", "cloud_account_enable",
		"cloud_account_trust_update", "cloud_account_test",
		"template_create", "template_update", "template_delete",
		"security_gate_policy", "security_gate_override", "finding_due_date", "risk_exception":
		return true
	default:
		return false
	}
}

func insertOperatorAudit(row operatorAuditRow) {
	if DB == nil {
		return
	}
	var actor interface{}
	if row.ActorUserID != nil && *row.ActorUserID > 0 {
		actor = *row.ActorUserID
	}
	var project interface{}
	if row.ProjectID != nil && *row.ProjectID > 0 {
		project = *row.ProjectID
	}
	result := strings.TrimSpace(row.Result)
	if result == "" {
		result = "success"
	}
	_, _ = DB.Exec(`
		INSERT INTO devops_operator_audit_log (
			actor_user_id, team_slug, project_id, environment,
			resource_type, resource_id, action, result, summary
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, actor, strings.TrimSpace(row.TeamSlug), project, strings.TrimSpace(row.Environment),
		strings.TrimSpace(row.ResourceType), strings.TrimSpace(row.ResourceID),
		strings.TrimSpace(row.Action), result, sanitizeOperatorAuditSummary(row.Summary))
}

func enrichOperatorAuditContext(actorUserID *int, action, resourceType, resourceID, details string) operatorAuditRow {
	row := operatorAuditRow{
		ActorUserID:  actorUserID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Action:       action,
		Result:       "success",
		Summary:      details,
	}
	if strings.Contains(strings.ToLower(details), "fail") || strings.Contains(strings.ToLower(details), "error") {
		// legacy details sometimes encode status; explicit failures use RecordOperatorAuditFailure
	}
	switch resourceType {
	case "pr_request":
		if id, err := strconv.Atoi(strings.TrimSpace(resourceID)); err == nil && id > 0 {
			if req, err := GetPRRequestByID(id); err == nil && req != nil {
				row.TeamSlug = strings.TrimSpace(req.Team)
				row.Environment = strings.TrimSpace(req.Env)
				row.ProjectID = req.ProjectID
				if req.ProjectID != nil {
					if project, _ := getProjectCatalogByID(*req.ProjectID); project != nil {
						row.ProjectName = project.Name
						row.ProjectCode = project.Code
					}
				}
			}
		}
	case "cloud_account":
		if id, err := strconv.Atoi(strings.TrimSpace(resourceID)); err == nil && id > 0 {
			if acct, err := getCloudAccountByID(id); err == nil && acct != nil {
				row.TeamSlug = acct.TeamSlug
			}
		}
	case "project":
		if id, err := strconv.Atoi(strings.TrimSpace(resourceID)); err == nil && id > 0 {
			row.ProjectID = &id
			if project, _ := getProjectCatalogByID(id); project != nil {
				row.ProjectName = project.Name
				row.ProjectCode = project.Code
			}
		}
	case "request_template":
		// summary often devops:name — no project
	}
	if strings.HasPrefix(action, "k8s_") {
		for _, part := range strings.Split(details, ",") {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, "environment=") {
				row.Environment = strings.TrimPrefix(part, "environment=")
			}
			if strings.HasPrefix(part, "cluster=") {
				if row.Summary == details {
					row.Summary = part
				}
			}
		}
	}
	if actorUserID != nil && *actorUserID > 0 {
		if user, err := GetUserByID(*actorUserID); err == nil && user != nil {
			row.ActorUsername = user.Username
		}
	}
	return row
}

func parsePromoteSourceRequestID(details string) int {
	details = strings.TrimSpace(details)
	if !strings.HasPrefix(details, "devops:") {
		return 0
	}
	rest := strings.TrimPrefix(details, "devops:")
	idx := strings.Index(rest, "->")
	if idx <= 0 {
		return 0
	}
	id, err := strconv.Atoi(strings.TrimSpace(rest[:idx]))
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func mirrorAdminAuditToOperatorLog(adminUserID *int, action, resourceType, resourceID, details string) {
	if !operatorAuditActionTracked(action) {
		return
	}
	row := enrichOperatorAuditContext(adminUserID, action, resourceType, resourceID, details)
	if action == "cloud_account_test" {
		status := strings.ToLower(strings.TrimSpace(details))
		if status == "error" || strings.Contains(status, "fail") {
			row.Result = "failed"
		}
	}
	insertOperatorAudit(row)
	if action == "request_promote" {
		if sourceID := parsePromoteSourceRequestID(details); sourceID > 0 {
			sourceRow := enrichOperatorAuditContext(adminUserID, action, "pr_request", strconv.Itoa(sourceID), details)
			if childID := strings.TrimSpace(resourceID); childID != "" {
				sourceRow.Summary = sanitizeOperatorAuditSummary(fmt.Sprintf("promoted to request #%s (%s)", childID, promoteTargetEnvFromDetails(details)))
			}
			insertOperatorAudit(sourceRow)
		}
	}
}

func promoteTargetEnvFromDetails(details string) string {
	if idx := strings.Index(details, "->"); idx >= 0 && idx+2 < len(details) {
		env := strings.TrimSpace(details[idx+2:])
		if colon := strings.Index(env, ":"); colon >= 0 {
			env = env[:colon]
		}
		return env
	}
	return ""
}

// RecordOperatorAuditFailure writes a failed/blocked operator event (e.g. promote blocked).
func RecordOperatorAuditFailure(actorUserID int, action, resourceType, resourceID, result, summary string, projectID *int, environment, teamSlug string) {
	if actorUserID <= 0 {
		return
	}
	actor := actorUserID
	row := operatorAuditRow{
		ActorUserID:  &actor,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Result:       firstNonEmpty(strings.TrimSpace(result), "failed"),
		Summary:      summary,
		ProjectID:    projectID,
		Environment:  environment,
		TeamSlug:     teamSlug,
	}
	if projectID != nil {
		if project, _ := getProjectCatalogByID(*projectID); project != nil {
			row.ProjectName = project.Name
			row.ProjectCode = project.Code
		}
	}
	if user, err := GetUserByID(actorUserID); err == nil && user != nil {
		row.ActorUsername = user.Username
	}
	insertOperatorAudit(row)
}

func listOperatorAuditForDevops(userID, limit, offset int, projectIDFilter int, environmentFilter, resourceType, resourceID string) ([]operatorAuditRow, error) {
	if DB == nil {
		return []operatorAuditRow{}, nil
	}
	limit = normalizeOperatorAuditLimit(limit)
	offset = normalizeOperatorAuditOffset(offset)
	query := `
		SELECT o.id, o.actor_user_id, COALESCE(u.username, ''), COALESCE(o.team_slug, ''),
		       o.project_id, COALESCE(p.name, ''), COALESCE(p.code, ''),
		       COALESCE(o.environment, ''), o.resource_type, o.resource_id,
		       o.action, o.result, COALESCE(o.summary, ''), o.created_at
		FROM devops_operator_audit_log o
		LEFT JOIN users u ON u.id = o.actor_user_id
		LEFT JOIN projects p ON p.id = o.project_id
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1
	if projectIDFilter > 0 {
		query += fmt.Sprintf(" AND o.project_id = $%d", argPos)
		args = append(args, projectIDFilter)
		argPos++
	}
	if environmentFilter != "" {
		query += fmt.Sprintf(" AND LOWER(o.environment) = LOWER($%d)", argPos)
		args = append(args, environmentFilter)
		argPos++
	}
	if resourceType != "" {
		query += fmt.Sprintf(" AND o.resource_type = $%d", argPos)
		args = append(args, resourceType)
		argPos++
	}
	if resourceID != "" {
		query += fmt.Sprintf(" AND o.resource_id = $%d", argPos)
		args = append(args, resourceID)
		argPos++
	}
	query += fmt.Sprintf(" ORDER BY o.created_at DESC LIMIT $%d OFFSET $%d", argPos, argPos+1)
	args = append(args, limit, offset)

	rows, err := DB.Query(query, args...)
	if err != nil {
		if isMissingDatabaseRelation(err, "devops_operator_audit_log") {
			return []operatorAuditRow{}, nil
		}
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	candidates := make([]operatorAuditRow, 0, operatorAuditMaxLimit)
	for rows.Next() {
		var row operatorAuditRow
		var actorID, projectID sql.NullInt64
		if err := rows.Scan(
			&row.ID, &actorID, &row.ActorUsername, &row.TeamSlug,
			&projectID, &row.ProjectName, &row.ProjectCode,
			&row.Environment, &row.ResourceType, &row.ResourceID,
			&row.Action, &row.Result, &row.Summary, &row.CreatedAt,
		); err != nil {
			continue
		}
		if actorID.Valid {
			v := int(actorID.Int64)
			row.ActorUserID = &v
		}
		if projectID.Valid {
			v := int(projectID.Int64)
			row.ProjectID = &v
		}
		candidates = append(candidates, row)
	}
	if projectIDFilter > 0 {
		return filterOperatorAuditVisible(userID, candidates), nil
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		return filterOperatorAuditVisible(userID, candidates), nil
	}
	projectByID := map[int]ProjectCatalog{}
	for _, p := range projects {
		projectByID[p.ID] = p
	}
	out := make([]operatorAuditRow, 0, operatorAuditMaxLimit)
	for _, row := range candidates {
		if row.ProjectID == nil || *row.ProjectID <= 0 {
			out = append(out, row)
			continue
		}
		if project, ok := projectByID[*row.ProjectID]; ok && devopsUserCanViewProject(userID, project) {
			out = append(out, row)
		}
	}
	return out, nil
}

func filterOperatorAuditVisible(userID int, rows []operatorAuditRow) []operatorAuditRow {
	projects, err := listProjectCatalogs()
	if err != nil {
		return rows
	}
	projectByID := map[int]ProjectCatalog{}
	for _, p := range projects {
		projectByID[p.ID] = p
	}
	out := make([]operatorAuditRow, 0, operatorAuditMaxLimit)
	for _, row := range rows {
		if len(out) >= operatorAuditMaxLimit {
			break
		}
		if row.ProjectID == nil || *row.ProjectID <= 0 {
			out = append(out, row)
			continue
		}
		if project, ok := projectByID[*row.ProjectID]; ok && devopsUserCanViewProject(userID, project) {
			out = append(out, row)
		}
	}
	return out
}

func devopsOperatorActivityHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	q := r.URL.Query()
	limit := normalizeOperatorAuditLimit(parseIntQueryDefault(q.Get("limit"), operatorAuditDefaultLimit))
	offset := normalizeOperatorAuditOffset(parseIntQueryDefault(q.Get("offset"), 0))
	projectID, _ := strconv.Atoi(strings.TrimSpace(q.Get("project_id")))
	environment := strings.TrimSpace(q.Get("environment"))
	resourceType := strings.TrimSpace(q.Get("resource_type"))
	resourceID := strings.TrimSpace(q.Get("resource_id"))
	if resourceType != "" && resourceID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "resource_id required with resource_type", nil)
		return
	}
	items, err := listOperatorAuditForDevops(userID, limit, offset, projectID, environment, resourceType, resourceID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list operator activity", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "events": items})
}

func parseIntQueryDefault(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func operatorAuditEventsForResource(userID int, resourceType, resourceID string, limit int) ([]operatorAuditRow, error) {
	if limit <= 0 {
		limit = operatorAuditResourceMax
	}
	if limit > operatorAuditResourceMax {
		limit = operatorAuditResourceMax
	}
	return listOperatorAuditForDevops(userID, limit, 0, 0, "", resourceType, resourceID)
}

func operatorAuditToWorkspaceActivity(op operatorAuditRow, portal string) workspaceActivity {
	summary := strings.ReplaceAll(op.Action, "_", " ")
	if op.Result != "" && op.Result != "success" {
		summary += " (" + op.Result + ")"
	}
	href := "/activity"
	if op.ResourceType == "pr_request" && strings.TrimSpace(op.ResourceID) != "" {
		if id, err := strconv.Atoi(op.ResourceID); err == nil && id > 0 {
			href = workspaceRequestHref(portal, id, false)
		}
	}
	if op.ResourceType == "cloud_account" && strings.TrimSpace(op.ResourceID) != "" {
		href = "/cloud-accounts/" + op.ResourceID
	}
	detail := strings.Join(nonEmptyStrings(op.ActorUsername, op.Environment, truncateWorkspaceText(op.Summary, 80)), " · ")
	tone := "neutral"
	switch op.Result {
	case "success":
		tone = "ok"
	case "failed":
		tone = "danger"
	case "blocked":
		tone = "high"
	}
	return workspaceActivity{
		ID:      fmt.Sprintf("operator-audit-%d", op.ID),
		Actor:   op.ActorUsername,
		Summary: summary,
		Detail:  detail,
		Href:    href,
		Tone:    tone,
		At:      op.CreatedAt.UTC().Format(time.RFC3339),
		sortAt:  op.CreatedAt,
	}
}

func recordPromotionOperatorFailure(managerID, requestID int, action string, gate *promotionGateDecision, err error) {
	if managerID <= 0 || requestID <= 0 {
		return
	}
	req, reqErr := GetPRRequestByID(requestID)
	if reqErr != nil || req == nil {
		return
	}
	result := "failed"
	summary := sanitizeOperatorAuditSummary(err.Error())
	if gate != nil && gate.Status == "blocked" {
		result = "blocked"
		if msg := firstNonEmpty(strings.TrimSpace(gate.ReviewMessage), strings.TrimSpace(gate.Summary)); msg != "" {
			summary = sanitizeOperatorAuditSummary(msg)
		} else if summary == "" {
			summary = "Promotion blocked by deployment gate"
		}
	}
	RecordOperatorAuditFailure(managerID, action, "pr_request", strconv.Itoa(requestID), result, summary, req.ProjectID, req.Env, req.Team)
}
