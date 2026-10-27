package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

type itsmCategory struct {
	Value         string   `json:"value"`
	Label         string   `json:"label"`
	Subcategories []string `json:"subcategories"`
}

type itsmSLAPolicy struct {
	Priority       string `json:"priority"`
	RespondMinutes int    `json:"respond_minutes"`
	ResolveMinutes int    `json:"resolve_minutes"`
}

type incidentSLA struct {
	Priority          string     `json:"priority"`
	RespondMinutes    int        `json:"respond_minutes"`
	ResolveMinutes    int        `json:"resolve_minutes"`
	RespondBy         *time.Time `json:"respond_by,omitempty"`
	ResolveBy         *time.Time `json:"resolve_by,omitempty"`
	RespondedAt       *time.Time `json:"responded_at,omitempty"`
	ResolvedAt        *time.Time `json:"resolved_at,omitempty"`
	ResponseBreached  bool       `json:"response_breached"`
	ResolveBreached   bool       `json:"resolve_breached"`
	ResponseRemaining string     `json:"response_remaining,omitempty"`
	ResolveRemaining  string     `json:"resolve_remaining,omitempty"`
}

type itsmJournalEntry struct {
	ID             int       `json:"id"`
	RecordType     string    `json:"record_type"`
	RecordID       int       `json:"record_id"`
	Kind           string    `json:"kind"`
	Body           string    `json:"body"`
	AuthorID       *int      `json:"author_id,omitempty"`
	AuthorUsername string    `json:"author_username,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type knowledgeArticle struct {
	ID            int       `json:"id"`
	ArticleNumber string    `json:"article_number"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	ProblemID     *int      `json:"problem_id,omitempty"`
	ProblemNumber string    `json:"problem_number,omitempty"`
	Published     bool      `json:"published"`
	CreatedBy     *int      `json:"created_by,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type incidentChildRef struct {
	ID             int    `json:"id"`
	IncidentNumber string `json:"incident_number"`
	Summary        string `json:"summary"`
	Status         string `json:"status"`
	Severity       string `json:"severity"`
}

func itsmCategoryCatalog() []itsmCategory {
	return []itsmCategory{
		{Value: "software", Label: "Software", Subcategories: []string{"application", "database", "middleware", "integration", "os"}},
		{Value: "hardware", Label: "Hardware", Subcategories: []string{"server", "storage", "network-device", "peripheral"}},
		{Value: "network", Label: "Network", Subcategories: []string{"connectivity", "dns", "vpn", "load-balancer", "firewall"}},
		{Value: "database", Label: "Database", Subcategories: []string{"performance", "availability", "backup", "replication"}},
		{Value: "inquiry", Label: "Inquiry / help", Subcategories: []string{"access", "how-to", "other"}},
	}
}

func slaPolicyForPriority(priority string) itsmSLAPolicy {
	switch normalizeITSMPriority(priority) {
	case "p1":
		return itsmSLAPolicy{Priority: "p1", RespondMinutes: 15, ResolveMinutes: 4 * 60}
	case "p2":
		return itsmSLAPolicy{Priority: "p2", RespondMinutes: 30, ResolveMinutes: 8 * 60}
	case "p4":
		return itsmSLAPolicy{Priority: "p4", RespondMinutes: 8 * 60, ResolveMinutes: 5 * 24 * 60}
	default:
		return itsmSLAPolicy{Priority: "p3", RespondMinutes: 4 * 60, ResolveMinutes: 3 * 24 * 60}
	}
}

const slaStaleAfter = 72 * time.Hour

func formatSLARemaining(deadline *time.Time, now time.Time) string {
	if deadline == nil {
		return ""
	}
	delta := deadline.Sub(now)
	if delta < 0 {
		over := -delta
		if over >= slaStaleAfter {
			return "stale"
		}
		if over < time.Hour {
			return fmt.Sprintf("breached %dm ago", int(over.Minutes()))
		}
		return fmt.Sprintf("breached %dh ago", int(over.Hours()))
	}
	if delta < time.Hour {
		return fmt.Sprintf("%dm left", int(delta.Minutes()))
	}
	if delta < 24*time.Hour {
		return fmt.Sprintf("%dh left", int(delta.Hours()))
	}
	return fmt.Sprintf("%dd left", int(delta.Hours()/24))
}

func buildIncidentSLA(priority string, respondBy, resolveBy, respondedAt, resolvedAt *time.Time, now time.Time) incidentSLA {
	policy := slaPolicyForPriority(priority)
	sla := incidentSLA{
		Priority:       policy.Priority,
		RespondMinutes: policy.RespondMinutes,
		ResolveMinutes: policy.ResolveMinutes,
		RespondBy:      respondBy,
		ResolveBy:      resolveBy,
		RespondedAt:    respondedAt,
		ResolvedAt:     resolvedAt,
	}
	if respondedAt == nil && respondBy != nil && now.After(*respondBy) {
		sla.ResponseBreached = true
	}
	if resolvedAt == nil && resolveBy != nil && now.After(*resolveBy) {
		sla.ResolveBreached = true
	}
	if respondedAt == nil {
		sla.ResponseRemaining = formatSLARemaining(respondBy, now)
	}
	if resolvedAt == nil {
		sla.ResolveRemaining = formatSLARemaining(resolveBy, now)
	}
	return sla
}

func upsertIncidentITSM(incidentID int, callerID, parentID int, category, subcategory, conferenceURL, conferenceNotes, priority string, createdAt time.Time, status string) error {
	if incidentID <= 0 || DB == nil {
		return nil
	}
	policy := slaPolicyForPriority(priority)
	respondBy := createdAt.Add(time.Duration(policy.RespondMinutes) * time.Minute)
	resolveBy := createdAt.Add(time.Duration(policy.ResolveMinutes) * time.Minute)
	var callerAny, parentAny any
	if callerID > 0 {
		callerAny = callerID
	}
	if parentID > 0 && parentID != incidentID {
		parentAny = parentID
	}
	normalized := normalizeIncidentStatus(status)
	var respondedAt, resolvedAt any
	if normalized != "open" && normalized != "new" && normalized != "draft" {
		respondedAt = time.Now()
	}
	if normalized == "resolved" || normalized == "closed" || normalized == "cancelled" {
		resolvedAt = time.Now()
		if respondedAt == nil {
			respondedAt = time.Now()
		}
	}
	_, err := execContext(`
		INSERT INTO incident_itsm (
			incident_id, caller_user_id, category, subcategory, parent_incident_id,
			conference_url, conference_notes, sla_respond_by, sla_resolve_by, sla_responded_at, sla_resolved_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (incident_id) DO UPDATE SET
			caller_user_id = COALESCE(EXCLUDED.caller_user_id, incident_itsm.caller_user_id),
			category = CASE WHEN EXCLUDED.category = '' THEN incident_itsm.category ELSE EXCLUDED.category END,
			subcategory = CASE WHEN EXCLUDED.subcategory = '' THEN incident_itsm.subcategory ELSE EXCLUDED.subcategory END,
			parent_incident_id = COALESCE(EXCLUDED.parent_incident_id, incident_itsm.parent_incident_id),
			conference_url = CASE WHEN EXCLUDED.conference_url = '' THEN incident_itsm.conference_url ELSE EXCLUDED.conference_url END,
			conference_notes = CASE WHEN EXCLUDED.conference_notes = '' THEN incident_itsm.conference_notes ELSE EXCLUDED.conference_notes END,
			sla_respond_by = COALESCE(incident_itsm.sla_respond_by, EXCLUDED.sla_respond_by),
			sla_resolve_by = COALESCE(incident_itsm.sla_resolve_by, EXCLUDED.sla_resolve_by),
			sla_responded_at = COALESCE(incident_itsm.sla_responded_at, EXCLUDED.sla_responded_at),
			sla_resolved_at = COALESCE(incident_itsm.sla_resolved_at, EXCLUDED.sla_resolved_at),
			updated_at = CURRENT_TIMESTAMP
	`, incidentID, callerAny, strings.TrimSpace(category), strings.TrimSpace(subcategory), parentAny,
		strings.TrimSpace(conferenceURL), strings.TrimSpace(conferenceNotes), respondBy, resolveBy, respondedAt, resolvedAt)
	return err
}

func applyIncidentSLATransition(incidentID int, status string) {
	if incidentID <= 0 || DB == nil {
		return
	}
	normalized := normalizeIncidentStatus(status)
	if normalized != "open" && normalized != "new" && normalized != "draft" {
		_, _ = execContext(`UPDATE incident_itsm SET sla_responded_at = COALESCE(sla_responded_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE incident_id = $1`, incidentID)
	}
	if normalized == "resolved" || normalized == "closed" || normalized == "cancelled" {
		_, _ = execContext(`UPDATE incident_itsm SET sla_responded_at = COALESCE(sla_responded_at, CURRENT_TIMESTAMP), sla_resolved_at = COALESCE(sla_resolved_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE incident_id = $1`, incidentID)
	}
}

func hydrateIncidentsITSM(items []requestIncident) []requestIncident {
	if len(items) == 0 || DB == nil {
		return items
	}
	ids := make([]int, 0, len(items))
	index := map[int]int{}
	for i, item := range items {
		ids = append(ids, item.ID)
		index[item.ID] = i
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT i.incident_id, i.caller_user_id, COALESCE(u.username,''), COALESCE(i.category,''), COALESCE(i.subcategory,''),
		       i.parent_incident_id, COALESCE(p.incident_number,''), COALESCE(i.conference_url,''), COALESCE(i.conference_notes,''),
		       i.sla_respond_by, i.sla_resolve_by, i.sla_responded_at, i.sla_resolved_at
		FROM incident_itsm i
		LEFT JOIN users u ON u.id = i.caller_user_id
		LEFT JOIN request_incidents p ON p.id = i.parent_incident_id
		WHERE i.incident_id = ANY($1)
	`, pq.Array(ids))
	now := time.Now()
	if err != nil {
		for i := range items {
			if items[i].SLA == nil {
				items[i].SLA = virtualIncidentSLA(items[i], now)
			}
		}
		return items
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var incidentID int
		var callerID, parentID sql.NullInt64
		var callerName, category, subcategory, parentNumber, conferenceURL, conferenceNotes string
		var respondBy, resolveBy, respondedAt, resolvedAt sql.NullTime
		if err := rows.Scan(&incidentID, &callerID, &callerName, &category, &subcategory, &parentID, &parentNumber, &conferenceURL, &conferenceNotes, &respondBy, &resolveBy, &respondedAt, &resolvedAt); err != nil {
			continue
		}
		pos, ok := index[incidentID]
		if !ok {
			continue
		}
		if callerID.Valid {
			value := int(callerID.Int64)
			items[pos].CallerUserID = &value
			items[pos].CallerUsername = callerName
		}
		items[pos].Category = category
		items[pos].Subcategory = subcategory
		if parentID.Valid {
			value := int(parentID.Int64)
			items[pos].ParentIncidentID = &value
			items[pos].ParentIncidentNumber = parentNumber
		}
		items[pos].ConferenceURL = conferenceURL
		items[pos].ConferenceNotes = conferenceNotes
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
		sla := buildIncidentSLA(severityToITSMPriority(items[pos].Severity), rb, rsb, rda, rsa, now)
		items[pos].SLA = &sla
	}
	children := listIncidentChildren(ids)
	for parentID, kids := range children {
		if pos, ok := index[parentID]; ok {
			items[pos].ChildIncidents = kids
		}
	}
	for i := range items {
		if items[i].SLA != nil {
			continue
		}
		items[i].SLA = virtualIncidentSLA(items[i], now)
	}
	return items
}

func virtualIncidentSLA(item requestIncident, now time.Time) *incidentSLA {
	policy := slaPolicyForPriority(severityToITSMPriority(item.Severity))
	created := item.CreatedAt
	if created.IsZero() {
		created = now
	}
	respondBy := created.Add(time.Duration(policy.RespondMinutes) * time.Minute)
	resolveBy := created.Add(time.Duration(policy.ResolveMinutes) * time.Minute)
	status := normalizeIncidentStatus(item.Status)
	var respondedAt, resolvedAt *time.Time
	if status != "" && status != "open" && status != "new" && status != "draft" {
		respondedAt = &created
	}
	if status == "resolved" || status == "closed" || status == "cancelled" {
		resolvedAt = &item.UpdatedAt
		if resolvedAt.IsZero() {
			resolvedAt = &now
		}
		if respondedAt == nil {
			respondedAt = resolvedAt
		}
	}
	sla := buildIncidentSLA(policy.Priority, &respondBy, &resolveBy, respondedAt, resolvedAt, now)
	return &sla
}

func hydrateOneIncidentITSM(item *requestIncident) *requestIncident {
	if item == nil {
		return nil
	}
	hydrated := hydrateIncidentsITSM([]requestIncident{*item})
	if len(hydrated) == 0 {
		return item
	}
	return &hydrated[0]
}

func applyCreatedIncidentITSM(item *requestIncident, callerID, parentID int, category, subcategory, conferenceURL, conferenceNotes, workNote, comment string, authorID int) *requestIncident {
	if item == nil {
		return nil
	}
	_ = upsertIncidentITSM(item.ID, callerID, parentID, category, subcategory, conferenceURL, conferenceNotes, severityToITSMPriority(item.Severity), item.CreatedAt, item.Status)
	if strings.TrimSpace(workNote) != "" {
		_, _ = addITSMJournal("incident", item.ID, "work_note", workNote, authorID)
	}
	if strings.TrimSpace(comment) != "" {
		_, _ = addITSMJournal("incident", item.ID, "comment", comment, authorID)
	}
	return hydrateOneIncidentITSM(item)
}

func listITSMCallers() ([]simpleUserOption, error) {
	if DB == nil {
		return []simpleUserOption{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT id, username, COALESCE(email,'') FROM users ORDER BY username LIMIT 500`)
	if err != nil {
		return []simpleUserOption{}, err
	}
	defer cancel()
	defer rows.Close()
	out := []simpleUserOption{}
	for rows.Next() {
		var user simpleUserOption
		if err := rows.Scan(&user.ID, &user.Username, &user.Email); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, nil
}

func handleITSMJournal(w http.ResponseWriter, r *http.Request, recordType string, recordID, authorID int) {
	switch r.Method {
	case "GET":
		items, err := listITSMJournal(recordType, recordID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list notes", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"journal": items, "status": "ok"})
	case "POST":
		var body struct {
			Kind string `json:"kind"`
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		entry, err := addITSMJournal(recordType, recordID, body.Kind, body.Body, authorID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"entry": entry, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func applyProblemSLA(problemID int, priority, status string, createdAt time.Time) {
	if problemID <= 0 || DB == nil {
		return
	}
	policy := slaPolicyForPriority(priority)
	respondBy := createdAt.Add(time.Duration(policy.RespondMinutes) * time.Minute)
	resolveBy := createdAt.Add(time.Duration(policy.ResolveMinutes) * time.Minute)
	normalized := normalizeProblemStatus(status)
	var respondedAt, resolvedAt any
	if normalized != "" && normalized != "new" && normalized != "open" {
		respondedAt = time.Now()
	}
	if normalized == "resolved" || normalized == "closed" {
		resolvedAt = time.Now()
		if respondedAt == nil {
			respondedAt = time.Now()
		}
	}
	_, _ = execContext(`
		UPDATE problem_records
		SET sla_respond_by = COALESCE(sla_respond_by, $2),
		    sla_resolve_by = COALESCE(sla_resolve_by, $3),
		    sla_responded_at = COALESCE(sla_responded_at, $4),
		    sla_resolved_at = COALESCE(sla_resolved_at, $5),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, problemID, respondBy, resolveBy, respondedAt, resolvedAt)
}

func problemSLAFromRecord(priority string, respondBy, resolveBy, respondedAt, resolvedAt *time.Time, now time.Time) incidentSLA {
	return buildIncidentSLA(priority, respondBy, resolveBy, respondedAt, resolvedAt, now)
}

func listIncidentChildren(parentIDs []int) map[int][]incidentChildRef {
	out := map[int][]incidentChildRef{}
	if len(parentIDs) == 0 || DB == nil {
		return out
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT i.parent_incident_id, r.id, COALESCE(r.incident_number,''), COALESCE(r.summary,''), COALESCE(r.status,''), COALESCE(r.severity,'')
		FROM incident_itsm i
		JOIN request_incidents r ON r.id = i.incident_id
		WHERE i.parent_incident_id = ANY($1)
		ORDER BY r.id
	`, pq.Array(parentIDs))
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var parentID int
		var child incidentChildRef
		if err := rows.Scan(&parentID, &child.ID, &child.IncidentNumber, &child.Summary, &child.Status, &child.Severity); err != nil {
			continue
		}
		if child.IncidentNumber == "" {
			child.IncidentNumber = formatIncidentNumber(child.ID)
		}
		out[parentID] = append(out[parentID], child)
	}
	return out
}

func addITSMJournal(recordType string, recordID int, kind, body string, authorID int) (*itsmJournalEntry, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "comment" {
		kind = "work_note"
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("note text is required")
	}
	var id int
	var created time.Time
	err := queryRowContext(`
		INSERT INTO itsm_journal (record_type, record_id, kind, body, author_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`, recordType, recordID, kind, body, authorID).Scan(&id, &created)
	if err != nil {
		return nil, err
	}
	entry := &itsmJournalEntry{ID: id, RecordType: recordType, RecordID: recordID, Kind: kind, Body: body, CreatedAt: created}
	if authorID > 0 {
		entry.AuthorID = &authorID
	}
	return entry, nil
}

func listITSMJournal(recordType string, recordID int) ([]itsmJournalEntry, error) {
	if DB == nil {
		return []itsmJournalEntry{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT j.id, j.record_type, j.record_id, j.kind, j.body, j.author_id, COALESCE(u.username,''), j.created_at
		FROM itsm_journal j
		LEFT JOIN users u ON u.id = j.author_id
		WHERE j.record_type = $1 AND j.record_id = $2
		ORDER BY j.created_at ASC, j.id ASC
	`, recordType, recordID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []itsmJournalEntry{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []itsmJournalEntry{}
	for rows.Next() {
		var item itsmJournalEntry
		var authorID sql.NullInt64
		if err := rows.Scan(&item.ID, &item.RecordType, &item.RecordID, &item.Kind, &item.Body, &authorID, &item.AuthorUsername, &item.CreatedAt); err != nil {
			return nil, err
		}
		if authorID.Valid {
			value := int(authorID.Int64)
			item.AuthorID = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func formatKBNumber(id int) string {
	return fmt.Sprintf("KB%07d", id)
}

func createKnowledgeFromProblem(problem problemRecord, authorID int) (*knowledgeArticle, error) {
	title := strings.TrimSpace(problem.Summary)
	if title == "" {
		title = problem.ProblemNumber + " known error"
	}
	body := strings.TrimSpace(strings.Join([]string{
		"## Symptom",
		firstNonEmpty(problem.Description, problem.Summary),
		"",
		"## Workaround",
		firstNonEmpty(problem.Workaround, "None recorded."),
		"",
		"## Root cause",
		firstNonEmpty(problem.RootCause, "Still under investigation."),
		"",
		"Source problem: " + problem.ProblemNumber,
	}, "\n"))
	var id int
	err := queryRowContext(`
		INSERT INTO knowledge_articles (title, body, problem_id, published, created_by)
		VALUES ($1, $2, $3, TRUE, $4)
		RETURNING id
	`, title, body, problem.ID, authorID).Scan(&id)
	if err != nil {
		return nil, err
	}
	number := formatKBNumber(id)
	_, _ = execContext(`UPDATE knowledge_articles SET article_number = $2 WHERE id = $1 AND COALESCE(article_number,'') = ''`, id, number)
	_, _ = execContext(`UPDATE problem_records SET knowledge_article_id = $2, known_error = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, problem.ID, id)
	return getKnowledgeArticle(id)
}

func getKnowledgeArticle(id int) (*knowledgeArticle, error) {
	items, err := listKnowledgeArticles()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("knowledge article not found")
}

func listKnowledgeArticles() ([]knowledgeArticle, error) {
	if DB == nil {
		return []knowledgeArticle{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT k.id, COALESCE(k.article_number,''), k.title, k.body, k.problem_id, COALESCE(p.problem_number,''), k.published, k.created_by, k.created_at
		FROM knowledge_articles k
		LEFT JOIN problem_records p ON p.id = k.problem_id
		ORDER BY k.created_at DESC, k.id DESC
		LIMIT 200
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []knowledgeArticle{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []knowledgeArticle{}
	for rows.Next() {
		var item knowledgeArticle
		var problemID, createdBy sql.NullInt64
		if err := rows.Scan(&item.ID, &item.ArticleNumber, &item.Title, &item.Body, &problemID, &item.ProblemNumber, &item.Published, &createdBy, &item.CreatedAt); err != nil {
			return nil, err
		}
		if item.ArticleNumber == "" {
			item.ArticleNumber = formatKBNumber(item.ID)
		}
		if problemID.Valid {
			value := int(problemID.Int64)
			item.ProblemID = &value
		}
		if createdBy.Valid {
			value := int(createdBy.Int64)
			item.CreatedBy = &value
		}
		out = append(out, item)
	}
	return out, nil
}

func devopsITSMCatalogHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"categories": itsmCategoryCatalog(),
		"sla":        []itsmSLAPolicy{slaPolicyForPriority("p1"), slaPolicyForPriority("p2"), slaPolicyForPriority("p3"), slaPolicyForPriority("p4")},
		"status":     "ok",
	})
}

func devopsKnowledgeHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := listKnowledgeArticles()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list knowledge articles", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"articles": items, "status": "ok"})
}

func devopsKnowledgeDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	id, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/knowledge/"), "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid article id", err)
		return
	}
	item, err := getKnowledgeArticle(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "knowledge article not found", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"article": item, "status": "ok"})
}
