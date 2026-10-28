package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func jiraListRemediationRulesHandler(w http.ResponseWriter, r *http.Request, userID, spaceID int) {
	if spaceID > 0 {
		access, err := jiraAccessForSpace(userID, spaceID)
		if err != nil || !access.CanView {
			writeAPIError(w, r, http.StatusForbidden, "you cannot view remediation rules for this space", nil)
			return
		}
	}
	rules, err := listJiraRemediationRules(spaceID, r.URL.Query().Get("source_type"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "remediation rules could not be loaded", err)
		return
	}
	visible := []jiraRemediationRule{}
	for _, rule := range rules {
		access, err := jiraAccessForSpace(userID, rule.SpaceID)
		if err != nil || !access.CanView {
			continue
		}
		visible = append(visible, rule)
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status": "ok",
		"rules":  visible,
		"note":   "Rules never mark a finding Fixed or a cost recommendation as verified savings. Jira Done stays informational.",
	})
}

func jiraSaveRemediationRuleHandler(w http.ResponseWriter, r *http.Request, userID, spaceID int) {
	access, err := jiraAccessForSpace(userID, spaceID)
	if err != nil || !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot change remediation rules for this space", nil)
		return
	}
	var req jiraRemediationRule
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	req.SpaceID = spaceID
	if req.SourceType != jiraSourceFinding && req.SourceType != jiraSourceCost {
		writeAPIError(w, r, http.StatusBadRequest, "rules can only target security findings or cost recommendations", nil)
		return
	}
	if strings.TrimSpace(req.IssueTypeID) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "issue_type_id is required", nil)
		return
	}
	if req.Relationship == "" {
		req.Relationship = jiraRelRemediates
	}
	if req.DailyLimit <= 0 {
		req.DailyLimit = 10
	}
	saved, err := upsertJiraRemediationRule(req, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "rule could not be saved", err)
		return
	}
	insertJiraAudit(0, userID, "remediation_rule_saved", req.SourceType, 0, "", "", "ok", fmt.Sprintf("space %d", spaceID))
	writeJSONResponse(w, http.StatusCreated, map[string]any{"status": "ok", "rule": saved})
}

func jiraDeleteRemediationRuleHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	rule, err := getJiraRemediationRule(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "rule not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, rule.SpaceID)
	if !access.CanAdminister {
		writeAPIError(w, r, http.StatusForbidden, "you cannot remove this rule", nil)
		return
	}
	if err := deleteJiraRemediationRule(id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "rule could not be removed", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func jiraApplyRemediationRuleHandler(w http.ResponseWriter, r *http.Request, userID, id int) {
	var req struct {
		SourceType  string `json:"source_type"`
		SourceID    int    `json:"source_id"`
		SourceKey   string `json:"source_key"`
		Summary     string `json:"summary"`
		Description string `json:"description"`
		Approved    bool   `json:"approved"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if !req.Approved {
		writeAPIError(w, r, http.StatusConflict, "confirm the selected summary before creating Jira work", nil)
		return
	}
	op, err := applyJiraRemediationRule(userID, id, req.SourceType, req.SourceKey, req.Summary, req.Description, req.SourceID, false)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	go processJiraOperation(op.OperationID)
	writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"status":    "ok",
		"operation": op,
		"note":      "A Jira issue does not mark the finding Fixed or the savings verified.",
	})
}

func applyJiraRemediationRule(userID, ruleID int, sourceType, sourceKey, summary, description string, sourceID int, automatic bool) (jiraOperationView, error) {
	rule, err := getJiraRemediationRule(ruleID)
	if err != nil {
		return jiraOperationView{}, fmt.Errorf("remediation rule was not found")
	}
	if !rule.Enabled {
		return jiraOperationView{}, fmt.Errorf("this remediation rule is paused")
	}
	if automatic && !rule.AutoCreate {
		return jiraOperationView{}, fmt.Errorf("automatic create is off for this rule")
	}
	if rule.SourceType != sourceType {
		return jiraOperationView{}, fmt.Errorf("this rule does not apply to that record")
	}
	if jiraHasRemediationLink(sourceType, sourceID, sourceKey) {
		return jiraOperationView{}, fmt.Errorf("this record already has remediation work in Jira")
	}
	if n := jiraRuleCreatesToday(rule.ID); n >= rule.DailyLimit {
		return jiraOperationView{}, fmt.Errorf("this rule reached its daily limit of %d issues", rule.DailyLimit)
	}
	if match := strings.TrimSpace(rule.MatchText); match != "" && !strings.Contains(strings.ToLower(summary+" "+description+" "+sourceKey), strings.ToLower(match)) {
		return jiraOperationView{}, fmt.Errorf("this record does not match the rule filter")
	}
	req := jiraCreateRequest{
		SpaceID:      rule.SpaceID,
		IssueTypeID:  rule.IssueTypeID,
		Summary:      summary,
		Description:  description,
		Relationship: rule.Relationship,
		SourceType:   sourceType,
		SourceID:     sourceID,
		SourceKey:    sourceKey,
		RuleID:       rule.ID,
	}
	if strings.TrimSpace(req.Summary) == "" {
		req.Summary = "Remediation from OpsTrellis"
	}
	op, err := enqueueJiraCreate(userID, req)
	if err != nil {
		return op, err
	}
	_, _ = DB.Exec(`UPDATE jira_sync_operations SET kind = 'remediate_create' WHERE operation_id = $1`, op.OperationID)
	op.Kind = "remediate_create"
	return op, nil
}

func jiraHasRemediationLink(sourceType string, sourceID int, sourceKey string) bool {
	if DB == nil {
		return false
	}
	var n int
	_ = DB.QueryRow(`
		SELECT COUNT(*) FROM jira_issue_links
		WHERE source_type = $1 AND source_id = $2 AND ($3 = '' OR source_key = $3) AND relationship = $4
	`, sourceType, sourceID, sourceKey, jiraRelRemediates).Scan(&n)
	return n > 0
}

func jiraRuleCreatesToday(ruleID int) int {
	if DB == nil {
		return 0
	}
	var n int
	needle := fmt.Sprintf(`"rule_id":%d`, ruleID)
	_ = DB.QueryRow(`
		SELECT COUNT(*) FROM jira_sync_operations
		WHERE kind = 'remediate_create' AND created_at >= CURRENT_DATE AND payload_json LIKE '%' || $1 || '%'
		  AND state NOT IN ('failed')
	`, needle).Scan(&n)
	return n
}

func listJiraRemediationRules(spaceID int, sourceType string) ([]jiraRemediationRule, error) {
	query := `
		SELECT r.id, r.space_id, s.name, s.jira_project_key, c.site_name, r.source_type, r.match_text,
		       r.issue_type_id, r.issue_type_name, r.relationship, r.enabled, r.auto_create, r.daily_limit
		FROM jira_remediation_rules r
		JOIN jira_spaces s ON s.id = r.space_id
		JOIN jira_connections c ON c.id = s.connection_id
		WHERE ($1 = 0 OR r.space_id = $1) AND ($2 = '' OR r.source_type = $2)
		ORDER BY s.name, r.id
	`
	rows, err := DB.Query(query, spaceID, strings.TrimSpace(sourceType))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jiraRemediationRule{}
	for rows.Next() {
		var rule jiraRemediationRule
		if err := rows.Scan(
			&rule.ID, &rule.SpaceID, &rule.SpaceName, &rule.SpaceKey, &rule.SiteName, &rule.SourceType, &rule.MatchText,
			&rule.IssueTypeID, &rule.IssueTypeName, &rule.Relationship, &rule.Enabled, &rule.AutoCreate, &rule.DailyLimit,
		); err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func getJiraRemediationRule(id int) (jiraRemediationRule, error) {
	var rule jiraRemediationRule
	err := DB.QueryRow(`
		SELECT r.id, r.space_id, s.name, s.jira_project_key, c.site_name, r.source_type, r.match_text,
		       r.issue_type_id, r.issue_type_name, r.relationship, r.enabled, r.auto_create, r.daily_limit
		FROM jira_remediation_rules r
		JOIN jira_spaces s ON s.id = r.space_id
		JOIN jira_connections c ON c.id = s.connection_id
		WHERE r.id = $1
	`, id).Scan(
		&rule.ID, &rule.SpaceID, &rule.SpaceName, &rule.SpaceKey, &rule.SiteName, &rule.SourceType, &rule.MatchText,
		&rule.IssueTypeID, &rule.IssueTypeName, &rule.Relationship, &rule.Enabled, &rule.AutoCreate, &rule.DailyLimit,
	)
	return rule, err
}

func upsertJiraRemediationRule(rule jiraRemediationRule, userID int) (jiraRemediationRule, error) {
	if rule.ID > 0 {
		_, err := DB.Exec(`
			UPDATE jira_remediation_rules
			SET source_type = $2, match_text = $3, issue_type_id = $4, issue_type_name = $5, relationship = $6,
			    enabled = $7, auto_create = $8, daily_limit = $9, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, rule.ID, rule.SourceType, strings.TrimSpace(rule.MatchText), rule.IssueTypeID, rule.IssueTypeName, rule.Relationship,
			rule.Enabled, rule.AutoCreate, rule.DailyLimit)
		if err != nil {
			return rule, err
		}
		return getJiraRemediationRule(rule.ID)
	}
	err := DB.QueryRow(`
		INSERT INTO jira_remediation_rules (
			space_id, source_type, match_text, issue_type_id, issue_type_name, relationship, enabled, auto_create, daily_limit, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,0))
		RETURNING id
	`, rule.SpaceID, rule.SourceType, strings.TrimSpace(rule.MatchText), rule.IssueTypeID, rule.IssueTypeName, rule.Relationship,
		rule.Enabled, rule.AutoCreate, rule.DailyLimit, userID).Scan(&rule.ID)
	if err != nil {
		return rule, err
	}
	return getJiraRemediationRule(rule.ID)
}

func deleteJiraRemediationRule(id int) error {
	_, err := DB.Exec(`DELETE FROM jira_remediation_rules WHERE id = $1`, id)
	return err
}

func runJiraRemediationCycle() {
	if DB == nil {
		return
	}
	rules, err := listJiraRemediationRules(0, "")
	if err != nil {
		return
	}
	created := 0
	for _, rule := range rules {
		if !rule.Enabled || !rule.AutoCreate || created >= 5 {
			continue
		}
		space, err := getJiraSpace(rule.SpaceID)
		if err != nil || !space.Enabled {
			continue
		}
		conn, err := getJiraConnection(space.ConnectionID)
		if err != nil || !conn.Enabled || conn.OwnerUserID <= 0 {
			continue
		}
		candidates := jiraRemediationCandidates(rule)
		for _, item := range candidates {
			if created >= 5 {
				break
			}
			op, err := applyJiraRemediationRule(conn.OwnerUserID, rule.ID, item.sourceType, item.sourceKey, item.summary, item.description, item.sourceID, true)
			if err != nil {
				continue
			}
			go processJiraOperation(op.OperationID)
			created++
		}
	}
}

type jiraRemediationCandidate struct {
	sourceType  string
	sourceID    int
	sourceKey   string
	summary     string
	description string
}

func jiraRemediationCandidates(rule jiraRemediationRule) []jiraRemediationCandidate {
	out := []jiraRemediationCandidate{}
	if rule.SourceType == jiraSourceFinding {
		rows, err := DB.Query(`
			SELECT f.id, COALESCE(NULLIF(a.title, ''), f.package_name, 'Security finding')
			FROM vuln_findings f
			JOIN vuln_advisories a ON a.id = f.advisory_id
			WHERE f.lifecycle IN ('acknowledged', 'in_remediation')
			ORDER BY f.id DESC
			LIMIT 25
		`)
		if err != nil {
			return out
		}
		defer rows.Close()
		for rows.Next() {
			var item jiraRemediationCandidate
			item.sourceType = jiraSourceFinding
			if err := rows.Scan(&item.sourceID, &item.summary); err != nil {
				continue
			}
			item.description = item.summary
			if jiraHasRemediationLink(item.sourceType, item.sourceID, "") {
				continue
			}
			out = append(out, item)
		}
		return out
	}
	if rule.SourceType == jiraSourceCost {
		rows, err := DB.Query(`
			SELECT calc_id FROM cost_recommendation_reviews
			WHERE LOWER(lifecycle) IN ('accepted', 'approved')
			ORDER BY updated_at DESC
			LIMIT 25
		`)
		if err != nil {
			return out
		}
		defer rows.Close()
		for rows.Next() {
			var item jiraRemediationCandidate
			item.sourceType = jiraSourceCost
			if err := rows.Scan(&item.sourceKey); err != nil {
				continue
			}
			item.summary = "Cost recommendation " + item.sourceKey
			item.description = item.summary
			if jiraHasRemediationLink(item.sourceType, 0, item.sourceKey) {
				continue
			}
			out = append(out, item)
		}
	}
	return out
}
