package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errImprovementInvalid = errors.New("improvement action is invalid")
	errImprovementHidden  = errors.New("improvement action not found")
)

type incidentImprovementAction struct {
	ID            int        `json:"id"`
	IncidentID    int        `json:"incident_id"`
	Title         string     `json:"title"`
	OwnerUserID   *int       `json:"owner_user_id,omitempty"`
	OwnerUsername string     `json:"owner_username,omitempty"`
	DueAt         *time.Time `json:"due_at,omitempty"`
	Status        string     `json:"status"`
	EvidenceRef   string     `json:"evidence_ref,omitempty"`
	ImplementedAt *time.Time `json:"implemented_at,omitempty"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func migrateIncidentImprovementSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS incident_improvement_actions (
			id SERIAL PRIMARY KEY,
			incident_id INTEGER NOT NULL REFERENCES request_incidents(id) ON DELETE CASCADE,
			title VARCHAR(180) NOT NULL,
			owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			due_at TIMESTAMP,
			status VARCHAR(32) NOT NULL DEFAULT 'open',
			evidence_ref TEXT NOT NULL DEFAULT '',
			implemented_at TIMESTAMP,
			verified_at TIMESTAMP,
			created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_incident_improvement_actions_incident ON incident_improvement_actions(incident_id)`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_incident_improvement_actions_owner ON incident_improvement_actions(owner_user_id)`)
}

func normalizeImprovementStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "implemented":
		return "implemented"
	case "verified", "verified_effective":
		return "verified"
	default:
		return "open"
	}
}

func improvementEvidenceAllowed(value string) bool {
	text := strings.TrimSpace(value)
	if text == "" || len(text) > 300 {
		return false
	}
	lower := strings.ToLower(text)
	for _, word := range []string{"password", "secret", "token", "database_url", "hmac", "bearer"} {
		if strings.Contains(lower, word) {
			return false
		}
	}
	return true
}

func parseImprovementDue(value string) (*time.Time, error) {
	text := strings.TrimSpace(value)
	if text == "" {
		return nil, nil
	}
	if parsed, err := time.Parse("2006-01-02", text); err == nil {
		utc := parsed.UTC()
		return &utc, nil
	}
	if parsed, err := time.Parse(time.RFC3339, text); err == nil {
		utc := parsed.UTC()
		return &utc, nil
	}
	return nil, errImprovementInvalid
}

func listIncidentImprovementActions(incidentID int) ([]incidentImprovementAction, error) {
	if DB == nil || incidentID <= 0 {
		return []incidentImprovementAction{}, nil
	}
	rows, err := DB.Query(`
		SELECT a.id, a.incident_id, a.title, a.owner_user_id, COALESCE(u.username, ''), a.due_at, a.status,
		       COALESCE(a.evidence_ref, ''), a.implemented_at, a.verified_at, a.created_at, a.updated_at
		FROM incident_improvement_actions a
		LEFT JOIN users u ON u.id = a.owner_user_id
		WHERE a.incident_id = $1
		ORDER BY a.due_at NULLS LAST, a.id
	`, incidentID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return []incidentImprovementAction{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []incidentImprovementAction{}
	for rows.Next() {
		var item incidentImprovementAction
		var owner sql.NullInt64
		var due, implemented, verified sql.NullTime
		if err := rows.Scan(&item.ID, &item.IncidentID, &item.Title, &owner, &item.OwnerUsername, &due, &item.Status, &item.EvidenceRef, &implemented, &verified, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if owner.Valid && owner.Int64 > 0 {
			id := int(owner.Int64)
			item.OwnerUserID = &id
		}
		if due.Valid {
			item.DueAt = &due.Time
		}
		if implemented.Valid {
			item.ImplementedAt = &implemented.Time
		}
		if verified.Valid {
			item.VerifiedAt = &verified.Time
		}
		item.Status = normalizeImprovementStatus(item.Status)
		out = append(out, item)
	}
	return out, rows.Err()
}

func getIncidentImprovementAction(id int) (*incidentImprovementAction, error) {
	if DB == nil || id <= 0 {
		return nil, errImprovementHidden
	}
	var item incidentImprovementAction
	var owner sql.NullInt64
	var due, implemented, verified sql.NullTime
	err := DB.QueryRow(`
		SELECT a.id, a.incident_id, a.title, a.owner_user_id, COALESCE(u.username, ''), a.due_at, a.status,
		       COALESCE(a.evidence_ref, ''), a.implemented_at, a.verified_at, a.created_at, a.updated_at
		FROM incident_improvement_actions a
		LEFT JOIN users u ON u.id = a.owner_user_id
		WHERE a.id = $1
	`, id).Scan(&item.ID, &item.IncidentID, &item.Title, &owner, &item.OwnerUsername, &due, &item.Status, &item.EvidenceRef, &implemented, &verified, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, errImprovementHidden
	}
	if owner.Valid && owner.Int64 > 0 {
		value := int(owner.Int64)
		item.OwnerUserID = &value
	}
	if due.Valid {
		item.DueAt = &due.Time
	}
	if implemented.Valid {
		item.ImplementedAt = &implemented.Time
	}
	if verified.Valid {
		item.VerifiedAt = &verified.Time
	}
	item.Status = normalizeImprovementStatus(item.Status)
	return &item, nil
}

func createIncidentImprovementAction(incidentID, actorID int, title string, ownerUserID *int, due *time.Time) (*incidentImprovementAction, error) {
	title = strings.TrimSpace(title)
	if incidentID <= 0 || title == "" || len(title) > 180 {
		return nil, errImprovementInvalid
	}
	var owner any
	if ownerUserID != nil && *ownerUserID > 0 {
		owner = *ownerUserID
	}
	var dueAny any
	if due != nil {
		dueAny = *due
	}
	var id int
	err := DB.QueryRow(`
		INSERT INTO incident_improvement_actions (incident_id, title, owner_user_id, due_at, status, created_by)
		VALUES ($1, $2, $3, $4, 'open', $5)
		RETURNING id
	`, incidentID, title, owner, dueAny, actorID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return getIncidentImprovementAction(id)
}

func applyImprovementStatus(current incidentImprovementAction, next, evidence string) (incidentImprovementAction, error) {
	next = normalizeImprovementStatus(next)
	evidence = strings.TrimSpace(evidence)
	if next == "verified" {
		if current.Status != "implemented" && current.Status != "verified" {
			return current, errImprovementInvalid
		}
		if !improvementEvidenceAllowed(firstNonEmpty(evidence, current.EvidenceRef)) {
			return current, errImprovementInvalid
		}
		if evidence != "" {
			current.EvidenceRef = evidence
		}
		now := time.Now().UTC()
		if current.ImplementedAt == nil {
			current.ImplementedAt = &now
		}
		current.VerifiedAt = &now
		current.Status = "verified"
		return current, nil
	}
	if next == "implemented" {
		if current.Status == "verified" {
			return current, errImprovementInvalid
		}
		now := time.Now().UTC()
		current.Status = "implemented"
		current.ImplementedAt = &now
		current.VerifiedAt = nil
		if evidence != "" {
			if !improvementEvidenceAllowed(evidence) {
				return current, errImprovementInvalid
			}
			current.EvidenceRef = evidence
		}
		return current, nil
	}
	current.Status = "open"
	current.ImplementedAt = nil
	current.VerifiedAt = nil
	return current, nil
}

func updateIncidentImprovementAction(id, actorID int, title string, ownerUserID *int, due *time.Time, status, evidence string) (*incidentImprovementAction, error) {
	current, err := getIncidentImprovementAction(id)
	if err != nil || current == nil {
		return nil, errImprovementHidden
	}
	if strings.TrimSpace(title) != "" {
		if len(strings.TrimSpace(title)) > 180 {
			return nil, errImprovementInvalid
		}
		current.Title = strings.TrimSpace(title)
	}
	if ownerUserID != nil {
		if *ownerUserID <= 0 {
			current.OwnerUserID = nil
		} else {
			current.OwnerUserID = ownerUserID
		}
	}
	if due != nil {
		current.DueAt = due
	}
	if status != "" {
		updated, err := applyImprovementStatus(*current, status, evidence)
		if err != nil {
			return nil, err
		}
		*current = updated
	} else if evidence != "" {
		if !improvementEvidenceAllowed(evidence) {
			return nil, errImprovementInvalid
		}
		current.EvidenceRef = evidence
	}
	var owner any
	if current.OwnerUserID != nil {
		owner = *current.OwnerUserID
	}
	var dueAny, implemented, verified any
	if current.DueAt != nil {
		dueAny = *current.DueAt
	}
	if current.ImplementedAt != nil {
		implemented = *current.ImplementedAt
	}
	if current.VerifiedAt != nil {
		verified = *current.VerifiedAt
	}
	if _, err := DB.Exec(`
		UPDATE incident_improvement_actions
		SET title = $2, owner_user_id = $3, due_at = $4, status = $5, evidence_ref = $6,
		    implemented_at = $7, verified_at = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, current.Title, owner, dueAny, current.Status, current.EvidenceRef, implemented, verified); err != nil {
		return nil, err
	}
	_ = actorID
	return getIncidentImprovementAction(id)
}

func handleIncidentImprovementActions(w http.ResponseWriter, r *http.Request, actorID, incidentID int, rest []string) {
	switch {
	case len(rest) == 0 && r.Method == http.MethodGet:
		items, err := listIncidentImprovementActions(incidentID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "improvement actions could not be loaded", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"actions": items, "status": "ok"})
	case len(rest) == 0 && r.Method == http.MethodPost:
		var body struct {
			Title       string `json:"title"`
			OwnerUserID *int   `json:"owner_user_id"`
			DueAt       string `json:"due_at"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		due, err := parseImprovementDue(body.DueAt)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Due date is invalid.", err)
			return
		}
		item, err := createIncidentImprovementAction(incidentID, actorID, body.Title, body.OwnerUserID, due)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That improvement action could not be created.", err)
			return
		}
		AppendAuditLog(&actorID, "incident_improvement_create", "request_incident", strconv.Itoa(incidentID), item.Title)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"action": item, "status": "ok"})
	case len(rest) == 1 && r.Method == http.MethodPatch:
		id, err := strconv.Atoi(rest[0])
		if err != nil || id <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid action id", err)
			return
		}
		var body struct {
			Title       string `json:"title"`
			OwnerUserID *int   `json:"owner_user_id"`
			DueAt       string `json:"due_at"`
			Status      string `json:"status"`
			EvidenceRef string `json:"evidence_ref"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		var due *time.Time
		if strings.TrimSpace(body.DueAt) != "" {
			parsed, err := parseImprovementDue(body.DueAt)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "Due date is invalid.", err)
				return
			}
			due = parsed
		}
		item, err := updateIncidentImprovementAction(id, actorID, body.Title, body.OwnerUserID, due, body.Status, body.EvidenceRef)
		if err != nil {
			message := "That improvement action could not be updated."
			if errors.Is(err, errImprovementInvalid) {
				message = "Verified effective needs an implemented action and source evidence. Implemented is not verified."
			}
			writeAPIError(w, r, http.StatusBadRequest, message, err)
			return
		}
		AppendAuditLog(&actorID, "incident_improvement_update", "request_incident", strconv.Itoa(incidentID), item.Status)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"action": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}
