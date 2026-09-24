package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type savedFilterViewRecord struct {
	ID      int             `json:"id"`
	Name    string          `json:"name"`
	Scope   string          `json:"scope"`
	Filters json.RawMessage `json:"filters"`
}

func normalizeSavedViewScope(scope string) string {
	scope = strings.TrimSpace(strings.ToLower(scope))
	if scope == "" {
		return "admin_requests"
	}
	return scope
}

func listSavedFilterViews(userID int, scope string) ([]savedFilterViewRecord, error) {
	rows, err := DB.Query(`
		SELECT id, name, COALESCE(scope, 'admin_requests'), filters
		FROM saved_filter_views
		WHERE user_id = $1 AND COALESCE(scope, 'admin_requests') = $2
		ORDER BY name ASC
	`, userID, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]savedFilterViewRecord, 0)
	for rows.Next() {
		var item savedFilterViewRecord
		var filters []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.Scope, &filters); err != nil {
			return nil, err
		}
		item.Filters = json.RawMessage(filters)
		out = append(out, item)
	}
	return out, nil
}

func upsertSavedFilterView(userID int, scope, name string, filters json.RawMessage) (*savedFilterViewRecord, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("view name is required")
	}
	if len(name) > 200 {
		name = name[:200]
	}
	if len(filters) == 0 {
		filters = json.RawMessage("{}")
	}
	var existingID int
	err := DB.QueryRow(`
		SELECT id FROM saved_filter_views
		WHERE user_id = $1 AND COALESCE(scope, 'admin_requests') = $2 AND lower(name) = lower($3)
	`, userID, scope, name).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == sql.ErrNoRows {
		err = DB.QueryRow(`
			INSERT INTO saved_filter_views (user_id, name, scope, filters)
			VALUES ($1, $2, $3, $4::jsonb)
			RETURNING id
		`, userID, name, scope, string(filters)).Scan(&existingID)
	} else {
		_, err = DB.Exec(`UPDATE saved_filter_views SET filters = $2::jsonb WHERE id = $1`, existingID, string(filters))
	}
	if err != nil {
		return nil, err
	}
	return &savedFilterViewRecord{ID: existingID, Name: name, Scope: scope, Filters: filters}, nil
}

func deleteSavedFilterView(userID int, viewID int) (bool, error) {
	res, err := DB.Exec(`DELETE FROM saved_filter_views WHERE id = $1 AND user_id = $2`, viewID, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func savedFilterViewsHandler(w http.ResponseWriter, r *http.Request, requireUser func(w http.ResponseWriter, r *http.Request) (int, bool)) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/admin/saved-views")
	if strings.HasPrefix(r.URL.Path, "/api/devops/saved-views") {
		path = strings.TrimPrefix(r.URL.Path, "/api/devops/saved-views")
	}
	path = strings.Trim(path, "/")

	if path != "" {
		viewID, err := strconv.Atoi(path)
		if err != nil || viewID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid view id", err)
			return
		}
		if r.Method != http.MethodDelete {
			writeMethodNotAllowed(w, r)
			return
		}
		deleted, err := deleteSavedFilterView(userID, viewID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to delete view", err)
			return
		}
		if !deleted {
			writeAPIError(w, r, http.StatusNotFound, "saved view not found", nil)
			return
		}
		encodeAdminJSON(w, map[string]interface{}{"status": "ok"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		scope := normalizeSavedViewScope(r.URL.Query().Get("scope"))
		views, err := listSavedFilterViews(userID, scope)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list views", err)
			return
		}
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "views": views})
	case http.MethodPost:
		var body struct {
			Name    string          `json:"name"`
			Scope   string          `json:"scope"`
			Filters json.RawMessage `json:"filters"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		scope := normalizeSavedViewScope(body.Scope)
		if r.URL.Query().Get("scope") != "" {
			scope = normalizeSavedViewScope(r.URL.Query().Get("scope"))
		}
		view, err := upsertSavedFilterView(userID, scope, body.Name, body.Filters)
		if err != nil {
			if strings.Contains(err.Error(), "required") {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save view", err)
			return
		}
		encodeAdminJSON(w, map[string]interface{}{"status": "ok", "view": view})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func adminSavedFilterViewsHandler(w http.ResponseWriter, r *http.Request) {
	savedFilterViewsHandler(w, r, func(w http.ResponseWriter, r *http.Request) (int, bool) {
		return requireAdmin(w, r)
	})
}

func devopsSavedFilterViewsHandler(w http.ResponseWriter, r *http.Request) {
	savedFilterViewsHandler(w, r, requireDevopsUser)
}
