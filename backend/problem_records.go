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

type problemRecord struct {
	ID                  int          `json:"id"`
	ProblemNumber       string       `json:"problem_number"`
	Fingerprint         string       `json:"fingerprint"`
	Service             string       `json:"service"`
	Environment         string       `json:"environment"`
	Summary             string       `json:"summary"`
	Description         string       `json:"description,omitempty"`
	Category            string       `json:"category,omitempty"`
	Subcategory         string       `json:"subcategory,omitempty"`
	Priority            string       `json:"priority"`
	Status              string       `json:"status"`
	OccurrenceCount     int          `json:"occurrence_count"`
	KnownError          bool         `json:"known_error,omitempty"`
	Workaround          string       `json:"workaround,omitempty"`
	RootCause           string       `json:"root_cause,omitempty"`
	AssigneeUserID      *int         `json:"assignee_user_id,omitempty"`
	AssigneeUsername    string       `json:"assignee_username,omitempty"`
	CallerUserID        *int         `json:"caller_user_id,omitempty"`
	CallerUsername      string       `json:"caller_username,omitempty"`
	AssignmentGroupID   *int         `json:"assignment_group_id,omitempty"`
	AssignmentGroupName string       `json:"assignment_group_name,omitempty"`
	RelatedIncidentID   *int         `json:"related_incident_id,omitempty"`
	KnowledgeArticleID  *int         `json:"knowledge_article_id,omitempty"`
	FirstSeenAt         *time.Time   `json:"first_seen_at,omitempty"`
	LastSeenAt          *time.Time   `json:"last_seen_at,omitempty"`
	ProjectID           *int         `json:"project_id,omitempty"`
	SLA                 *incidentSLA `json:"sla,omitempty"`
}

func listProblemRecords(status, query string) ([]problemRecord, error) {
	if DB == nil {
		return []problemRecord{}, nil
	}
	sqlQuery := `
		SELECT p.id, COALESCE(p.problem_number,''), COALESCE(p.fingerprint,''), COALESCE(p.service,''), COALESCE(p.environment,''),
		       COALESCE(p.summary,''), COALESCE(p.description,''), COALESCE(p.category,''), COALESCE(p.subcategory,''), COALESCE(p.priority,'p3'),
		       COALESCE(p.status,'new'), p.occurrence_count, COALESCE(p.known_error, false), COALESCE(p.workaround,''), COALESCE(p.root_cause,''),
		       p.assignee_user_id, COALESCE(u.username,''), p.caller_user_id, COALESCE(cu.username,''), p.assignment_group_id, COALESCE(t.name,''),
		       p.related_incident_id, p.knowledge_article_id, p.first_seen_at, p.last_seen_at, p.project_id,
		       p.sla_respond_by, p.sla_resolve_by, p.sla_responded_at, p.sla_resolved_at
		FROM problem_records p
		LEFT JOIN users u ON u.id = p.assignee_user_id
		LEFT JOIN users cu ON cu.id = p.caller_user_id
		LEFT JOIN teams t ON t.id = p.assignment_group_id
	`
	args := []any{}
	where := []string{}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("LOWER(p.status) = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("(LOWER(p.fingerprint) LIKE $%d OR LOWER(p.service) LIKE $%d OR LOWER(p.problem_number) LIKE $%d OR LOWER(p.summary) LIKE $%d)", len(args), len(args), len(args), len(args)))
	}
	if len(where) > 0 {
		sqlQuery += " WHERE " + strings.Join(where, " AND ")
	}
	sqlQuery += " ORDER BY p.last_seen_at DESC NULLS LAST, p.id DESC LIMIT 200"
	rows, cancel, err := queryRowsWithTimeout(sqlQuery, args...)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []problemRecord{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []problemRecord{}
	now := time.Now()
	for rows.Next() {
		var item problemRecord
		var first, last sql.NullTime
		var projectID, assigneeID, relatedIncidentID, callerID, groupID, knowledgeID sql.NullInt64
		var respondBy, resolveBy, respondedAt, resolvedAt sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.ProblemNumber, &item.Fingerprint, &item.Service, &item.Environment,
			&item.Summary, &item.Description, &item.Category, &item.Subcategory, &item.Priority, &item.Status, &item.OccurrenceCount,
			&item.KnownError, &item.Workaround, &item.RootCause, &assigneeID, &item.AssigneeUsername,
			&callerID, &item.CallerUsername, &groupID, &item.AssignmentGroupName, &relatedIncidentID, &knowledgeID,
			&first, &last, &projectID, &respondBy, &resolveBy, &respondedAt, &resolvedAt,
		); err != nil {
			return nil, err
		}
		item.Priority = normalizeITSMPriority(item.Priority)
		if assigneeID.Valid {
			value := int(assigneeID.Int64)
			item.AssigneeUserID = &value
		}
		if callerID.Valid {
			value := int(callerID.Int64)
			item.CallerUserID = &value
		}
		if groupID.Valid {
			value := int(groupID.Int64)
			item.AssignmentGroupID = &value
		}
		if relatedIncidentID.Valid {
			value := int(relatedIncidentID.Int64)
			item.RelatedIncidentID = &value
		}
		if knowledgeID.Valid {
			value := int(knowledgeID.Int64)
			item.KnowledgeArticleID = &value
		}
		if first.Valid {
			item.FirstSeenAt = &first.Time
		}
		if last.Valid {
			item.LastSeenAt = &last.Time
		}
		if projectID.Valid {
			value := int(projectID.Int64)
			item.ProjectID = &value
		}
		if item.ProblemNumber == "" {
			item.ProblemNumber = formatProblemNumber(item.ID)
		}
		var rb, rsb, rda, rsa *time.Time
		if respondBy.Valid {
			rb = &respondBy.Time
		}
		if resolveBy.Valid {
			rsb = &resolveBy.Time
		}
		if respondedAt.Valid {
			rda = &respondedAt.Time
		}
		if resolvedAt.Valid {
			rsa = &resolvedAt.Time
		}
		if rb != nil || rsb != nil {
			sla := problemSLAFromRecord(item.Priority, rb, rsb, rda, rsa, now)
			item.SLA = &sla
		} else {
			created := now
			if item.FirstSeenAt != nil {
				created = *item.FirstSeenAt
			}
			item.SLA = virtualIncidentSLA(requestIncident{Severity: itsmPriorityToSeverity(item.Priority), Status: item.Status, CreatedAt: created}, now)
		}
		out = append(out, item)
	}
	return out, nil
}

func upsertProblemFromIncident(incident requestIncident) (*problemRecord, error) {
	if DB == nil || strings.TrimSpace(incident.Fingerprint) == "" {
		return nil, nil
	}
	now := time.Now()
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	if !shouldOpenProblem(incident.Fingerprint, items, now) {
		return nil, nil
	}
	var existingID int
	err = queryRowContext(`SELECT id FROM problem_records WHERE fingerprint = $1`, incident.Fingerprint).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	var projectAny any
	if incident.ProjectID != nil {
		projectAny = *incident.ProjectID
	}
	if existingID > 0 {
		_, err = execContext(`
			UPDATE problem_records
			SET occurrence_count = occurrence_count + 1,
			    last_seen_at = CURRENT_TIMESTAMP,
			    summary = CASE WHEN COALESCE($2,'') = '' THEN summary ELSE $2 END,
			    service = CASE WHEN COALESCE($3,'') = '' THEN service ELSE $3 END,
			    environment = CASE WHEN COALESCE($4,'') = '' THEN environment ELSE $4 END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, existingID, incident.Summary, incident.Service, incident.Environment)
		if err != nil {
			return nil, err
		}
		_, _ = execContext(`UPDATE request_incidents SET problem_id = $2 WHERE id = $1`, incident.ID, existingID)
		return getProblemByID(existingID)
	}
	var id int
	err = queryRowContext(`
		INSERT INTO problem_records (fingerprint, service, environment, summary, status, priority, occurrence_count, first_seen_at, last_seen_at, project_id)
		VALUES ($1, $2, $3, $4, 'new', $6, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5)
		RETURNING id
	`, incident.Fingerprint, incident.Service, incident.Environment, incident.Summary, projectAny, severityToITSMPriority(incident.Severity)).Scan(&id)
	if err != nil {
		return nil, err
	}
	_, _ = execContext(`UPDATE problem_records SET problem_number = $2 WHERE id = $1 AND COALESCE(problem_number,'') = ''`, id, formatProblemNumber(id))
	_, _ = execContext(`UPDATE request_incidents SET problem_id = $2 WHERE fingerprint = $1`, incident.Fingerprint, id)
	return getProblemByID(id)
}

func getProblemByID(id int) (*problemRecord, error) {
	items, err := listProblemRecords("", "")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("problem not found")
}

func createManualProblem(body createProblemRequest, createdBy int) (*problemRecord, error) {
	summary := strings.TrimSpace(body.Summary)
	if summary == "" {
		summary = strings.TrimSpace(body.Title)
	}
	if summary == "" {
		return nil, fmt.Errorf("summary is required")
	}
	fingerprint := strings.TrimSpace(body.Fingerprint)
	if fingerprint == "" {
		fingerprint = fmt.Sprintf("manual-%d", time.Now().UnixNano())
	}
	status := normalizeProblemStatus(body.Status)
	priority := normalizeITSMPriority(body.Priority)
	var projectAny any
	if body.ProjectID > 0 {
		projectAny = body.ProjectID
	}
	var assigneeAny any
	if body.AssigneeUserID > 0 {
		assigneeAny = body.AssigneeUserID
	}
	var callerAny any
	if body.CallerUserID > 0 {
		callerAny = body.CallerUserID
	}
	var groupAny any
	if body.AssignmentGroupID > 0 {
		groupAny = body.AssignmentGroupID
	}
	var relatedAny any
	if body.RelatedIncidentID > 0 {
		relatedAny = body.RelatedIncidentID
	}
	var id int
	err := queryRowContext(`
		INSERT INTO problem_records (
			fingerprint, service, environment, summary, description, category, subcategory, priority, status,
			occurrence_count, known_error, workaround, root_cause, assignee_user_id, caller_user_id, assignment_group_id, related_incident_id,
			first_seen_at, last_seen_at, project_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $17)
		RETURNING id
	`, fingerprint, strings.TrimSpace(body.Service), strings.TrimSpace(body.Environment), summary,
		strings.TrimSpace(body.Description), strings.TrimSpace(body.Category), strings.TrimSpace(body.Subcategory), priority, status,
		body.KnownError != nil && *body.KnownError, strings.TrimSpace(body.Workaround), strings.TrimSpace(body.RootCause),
		assigneeAny, callerAny, groupAny, relatedAny, projectAny,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	_, _ = execContext(`UPDATE problem_records SET problem_number = $2 WHERE id = $1 AND COALESCE(problem_number,'') = ''`, id, formatProblemNumber(id))
	if body.RelatedIncidentID > 0 {
		_, _ = execContext(`UPDATE request_incidents SET problem_id = $2 WHERE id = $1`, body.RelatedIncidentID, id)
	}
	applyProblemSLA(id, priority, status, time.Now())
	if strings.TrimSpace(body.WorkNote) != "" {
		_, _ = addITSMJournal("problem", id, "work_note", body.WorkNote, createdBy)
	}
	if strings.TrimSpace(body.Comment) != "" {
		_, _ = addITSMJournal("problem", id, "comment", body.Comment, createdBy)
	}
	return getProblemByID(id)
}

type createProblemRequest struct {
	Title             string `json:"title"`
	Summary           string `json:"summary"`
	Description       string `json:"description"`
	Category          string `json:"category"`
	Subcategory       string `json:"subcategory"`
	Service           string `json:"service"`
	Environment       string `json:"environment"`
	Priority          string `json:"priority"`
	Status            string `json:"status"`
	Fingerprint       string `json:"fingerprint"`
	ProjectID         int    `json:"project_id"`
	AssigneeUserID    int    `json:"assignee_user_id"`
	CallerUserID      int    `json:"caller_user_id"`
	AssignmentGroupID int    `json:"assignment_group_id"`
	RelatedIncidentID int    `json:"related_incident_id"`
	KnownError        *bool  `json:"known_error"`
	Workaround        string `json:"workaround"`
	RootCause         string `json:"root_cause"`
	WorkNote          string `json:"work_note"`
	Comment           string `json:"comment"`
}

func devopsProblemsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case "GET":
		if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("mode")), "preview") {
			number, err := nextProblemNumber()
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to prepare problem number", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"problem_number": number, "status": "ok"})
			return
		}
		items, err := listProblemRecords(r.URL.Query().Get("status"), r.URL.Query().Get("q"))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list problems", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"problems": items, "status": "ok"})
	case "POST":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		capture, finish, handled := beginIdempotentPost(w, r, userID, "problem")
		if handled {
			return
		}
		defer finish()
		w = capture
		var body createProblemRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		item, err := createManualProblem(body, userID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"problem": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func devopsProblemDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/problems/"), "/")
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid problem id", err)
		return
	}
	if len(parts) == 2 && strings.EqualFold(parts[1], "journal") {
		handleITSMJournal(w, r, "problem", id, userID)
		return
	}
	if len(parts) == 2 && strings.EqualFold(parts[1], "knowledge") {
		if r.Method != "POST" {
			writeMethodNotAllowed(w, r)
			return
		}
		item, err := getProblemByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "problem not found", err)
			return
		}
		if !item.KnownError && strings.TrimSpace(item.Workaround) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "mark the problem as a known error or add a workaround first", nil)
			return
		}
		article, err := createKnowledgeFromProblem(*item, userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to publish knowledge article", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"article": article, "status": "ok"})
		return
	}
	if r.Method == "GET" {
		item, err := getProblemByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "problem not found", err)
			return
		}
		journal, _ := listITSMJournal("problem", id)
		var article *knowledgeArticle
		if item.KnowledgeArticleID != nil {
			article, _ = getKnowledgeArticle(*item.KnowledgeArticleID)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"problem": item, "journal": journal, "article": article, "status": "ok"})
		return
	}
	if r.Method == "PATCH" && len(parts) == 1 {
		var body createProblemRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		status := ""
		if strings.TrimSpace(body.Status) != "" {
			status = normalizeProblemStatus(body.Status)
		}
		priority := ""
		if strings.TrimSpace(body.Priority) != "" {
			priority = normalizeITSMPriority(body.Priority)
		}
		var assigneeAny, callerAny, groupAny any
		if body.AssigneeUserID > 0 {
			assigneeAny = body.AssigneeUserID
		}
		if body.CallerUserID > 0 {
			callerAny = body.CallerUserID
		}
		if body.AssignmentGroupID > 0 {
			groupAny = body.AssignmentGroupID
		}
		if _, err := execContext(`
			UPDATE problem_records
			SET status = CASE WHEN $2 = '' THEN status ELSE $2 END,
			    priority = CASE WHEN $3 = '' THEN priority ELSE $3 END,
			    summary = CASE WHEN $4 = '' THEN summary ELSE $4 END,
			    description = CASE WHEN $5 = '' THEN description ELSE $5 END,
			    workaround = CASE WHEN $6 = '' THEN workaround ELSE $6 END,
			    root_cause = CASE WHEN $7 = '' THEN root_cause ELSE $7 END,
			    known_error = CASE WHEN $8::boolean IS NULL THEN known_error ELSE $8 END,
			    category = CASE WHEN $9 = '' THEN category ELSE $9 END,
			    subcategory = CASE WHEN $10 = '' THEN subcategory ELSE $10 END,
			    assignee_user_id = COALESCE($11, assignee_user_id),
			    caller_user_id = COALESCE($12, caller_user_id),
			    assignment_group_id = COALESCE($13, assignment_group_id),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, id, status, priority, strings.TrimSpace(body.Summary), strings.TrimSpace(body.Description), strings.TrimSpace(body.Workaround), strings.TrimSpace(body.RootCause), body.KnownError, strings.TrimSpace(body.Category), strings.TrimSpace(body.Subcategory), assigneeAny, callerAny, groupAny); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update problem", err)
			return
		}
		item, err := getProblemByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "problem not found", err)
			return
		}
		createdAt := time.Now()
		if item.FirstSeenAt != nil {
			createdAt = *item.FirstSeenAt
		}
		applyProblemSLA(item.ID, item.Priority, item.Status, createdAt)
		item, err = getProblemByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "problem not found", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"problem": item, "status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r)
}
