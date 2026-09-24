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
	ID              int        `json:"id"`
	ProblemNumber   string     `json:"problem_number"`
	Fingerprint     string     `json:"fingerprint"`
	Service         string     `json:"service"`
	Environment     string     `json:"environment"`
	Summary         string     `json:"summary"`
	Status          string     `json:"status"`
	OccurrenceCount int        `json:"occurrence_count"`
	FirstSeenAt     *time.Time `json:"first_seen_at,omitempty"`
	LastSeenAt      *time.Time `json:"last_seen_at,omitempty"`
	ProjectID       *int       `json:"project_id,omitempty"`
}

func listProblemRecords(status, query string) ([]problemRecord, error) {
	if DB == nil {
		return []problemRecord{}, nil
	}
	sqlQuery := `
		SELECT id, COALESCE(problem_number,''), COALESCE(fingerprint,''), COALESCE(service,''), COALESCE(environment,''),
		       COALESCE(summary,''), COALESCE(status,'open'), occurrence_count, first_seen_at, last_seen_at, project_id
		FROM problem_records
	`
	args := []any{}
	where := []string{}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		args = append(args, strings.ToLower(trimmed))
		where = append(where, fmt.Sprintf("LOWER(status) = $%d", len(args)))
	}
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("(LOWER(fingerprint) LIKE $%d OR LOWER(service) LIKE $%d OR LOWER(problem_number) LIKE $%d OR LOWER(summary) LIKE $%d)", len(args), len(args), len(args), len(args)))
	}
	if len(where) > 0 {
		sqlQuery += " WHERE " + strings.Join(where, " AND ")
	}
	sqlQuery += " ORDER BY last_seen_at DESC NULLS LAST, id DESC LIMIT 200"
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
	for rows.Next() {
		var item problemRecord
		var first, last sql.NullTime
		var projectID sql.NullInt64
		if err := rows.Scan(&item.ID, &item.ProblemNumber, &item.Fingerprint, &item.Service, &item.Environment, &item.Summary, &item.Status, &item.OccurrenceCount, &first, &last, &projectID); err != nil {
			return nil, err
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
		INSERT INTO problem_records (fingerprint, service, environment, summary, status, occurrence_count, first_seen_at, last_seen_at, project_id)
		VALUES ($1, $2, $3, $4, 'open', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5)
		RETURNING id
	`, incident.Fingerprint, incident.Service, incident.Environment, incident.Summary, projectAny).Scan(&id)
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

func devopsProblemsHandler(w http.ResponseWriter, r *http.Request) {
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
	items, err := listProblemRecords(r.URL.Query().Get("status"), r.URL.Query().Get("q"))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list problems", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"problems": items, "status": "ok"})
}

func devopsProblemDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/devops/problems/"), "/")
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid problem id", err)
		return
	}
	if r.Method == "GET" {
		item, err := getProblemByID(id)
		if err != nil {
			writeAPIError(w, r, http.StatusNotFound, "problem not found", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"problem": item, "status": "ok"})
		return
	}
	if r.Method == "PATCH" && len(parts) == 1 {
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		status := strings.ToLower(strings.TrimSpace(body.Status))
		if status == "" {
			status = "open"
		}
		if _, err := execContext(`UPDATE problem_records SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, status); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update problem", err)
			return
		}
		item, err := getProblemByID(id)
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
