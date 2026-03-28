package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// templatesListHandler GET /api/templates - list admin-defined templates (auth required)
func templatesListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := checkAuth(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"templates": []interface{}{}, "status": "ok"})
		return
	}
	list, err := ListRequestTemplatesForUser(userID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list templates", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"templates": list, "status": "ok"})
}

// templatesDetailHandler GET /api/templates/:id - get one template (auth required)
func templatesDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := checkAuth(w, r)
	if !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/templates/")
	id, err := strconv.Atoi(strings.Trim(path, "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid template id", nil)
		return
	}
	t, err := GetRequestTemplateForUser(id, userID)
	if err != nil || t == nil {
		writeAPIError(w, r, http.StatusNotFound, "template not found", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"template": t, "status": "ok"})
}

// adminTemplatesRouter GET/POST /api/admin/templates, GET/PUT/DELETE /api/admin/templates/:id
func adminTemplatesRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	var adminIDPtr *int
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/admin/templates")
	path = strings.Trim(path, "/")
	w.Header().Set("Content-Type", "application/json")
	if path == "" {
		switch r.Method {
		case "GET":
			list, err := ListRequestTemplates()
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to list templates", err)
				return
			}
			encodeJSON(w, map[string]interface{}{"templates": list, "status": "ok"})
			return
		case "POST":
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Cloud       string `json:"cloud"`
				Env         string `json:"env"`
				Service     string `json:"service"`
				Config      string `json:"config"`
				Status      string `json:"status"`
				TeamIDs     []int  `json:"team_ids"`
				ProjectIDs  []int  `json:"project_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
				return
			}
			name := strings.TrimSpace(body.Name)
			if name == "" || strings.TrimSpace(body.Cloud) == "" || strings.TrimSpace(body.Env) == "" || strings.TrimSpace(body.Service) == "" {
				writeAPIError(w, r, http.StatusBadRequest, "name, cloud, env, service required", nil)
				return
			}
			config := body.Config
			if config == "" {
				config = "{}"
			}
			teamIDs, err := ValidatePortalTemplateTeamIDs(body.TeamIDs)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			t, err := CreateRequestTemplate(name, strings.TrimSpace(body.Description), strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service), config, body.Status, adminIDPtr)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to create template", err)
				return
			}
			if err := SetRequestTemplateTeams(t.ID, teamIDs); err != nil {
				_ = DeleteRequestTemplate(t.ID)
				writeAPIError(w, r, http.StatusInternalServerError, "failed to map template teams", err)
				return
			}
			projectIDs, err := ValidateTemplateProjectIDs(body.ProjectIDs)
			if err != nil {
				_ = DeleteRequestTemplate(t.ID)
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			if err := SetRequestTemplateProjects(t.ID, projectIDs); err != nil {
				_ = DeleteRequestTemplate(t.ID)
				writeAPIError(w, r, http.StatusInternalServerError, "failed to map template projects", err)
				return
			}
			if refreshed, err := GetRequestTemplateByID(t.ID); err == nil && refreshed != nil {
				t = refreshed
			}
			AppendAuditLog(adminIDPtr, "template_create", "request_template", strconv.Itoa(t.ID), name)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			encodeJSON(w, map[string]interface{}{"template": t, "status": "ok"})
			return
		default:
			writeMethodNotAllowed(w, r)
			return
		}
	}

	id, err := strconv.Atoi(path)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	t, err := GetRequestTemplateByID(id)
	if err != nil || t == nil {
		writeAPIError(w, r, http.StatusNotFound, "template not found", err)
		return
	}

	switch r.Method {
	case "GET":
		encodeJSON(w, map[string]interface{}{"template": t, "status": "ok"})
		return
	case "PUT", "PATCH":
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Cloud       string `json:"cloud"`
			Env         string `json:"env"`
			Service     string `json:"service"`
			Config      string `json:"config"`
			Status      string `json:"status"`
			TeamIDs     *[]int `json:"team_ids"`
			ProjectIDs  *[]int `json:"project_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			name = t.Name
		}
		cloud, env, service, config := strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service), body.Config
		if cloud == "" {
			cloud = t.Cloud
		}
		if env == "" {
			env = t.Env
		}
		if service == "" {
			service = t.Service
		}
		if config == "" {
			config = t.Config
		}
		status := body.Status
		if strings.TrimSpace(status) == "" {
			status = t.Status
		}
		if err := UpdateRequestTemplate(id, name, strings.TrimSpace(body.Description), cloud, env, service, config, status, adminIDPtr); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to update template", err)
			return
		}
		if body.TeamIDs != nil {
			teamIDs, err := ValidatePortalTemplateTeamIDs(*body.TeamIDs)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			if err := SetRequestTemplateTeams(id, teamIDs); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to update template teams", err)
				return
			}
		}
		if body.ProjectIDs != nil {
			projectIDs, err := ValidateTemplateProjectIDs(*body.ProjectIDs)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			if err := SetRequestTemplateProjects(id, projectIDs); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to update template projects", err)
				return
			}
		}
		AppendAuditLog(adminIDPtr, "template_update", "request_template", strconv.Itoa(id), name)
		updated := t
		if refreshed, err := GetRequestTemplateByID(id); err == nil && refreshed != nil {
			updated = refreshed
		}
		encodeJSON(w, map[string]interface{}{"template": updated, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteRequestTemplate(id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to delete template", err)
			return
		}
		AppendAuditLog(adminIDPtr, "template_delete", "request_template", strconv.Itoa(id), t.Name)
		encodeJSON(w, map[string]interface{}{"status": "ok", "message": "deleted"})
		return
	default:
		writeMethodNotAllowed(w, r)
		return
	}
}

// checkAuth returns (userID, true) if request has valid Bearer token
func checkAuth(w http.ResponseWriter, r *http.Request) (int, bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "authorization required", nil)
		return 0, false
	}
	id, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return 0, false
	}
	return id, true
}

// savedConfigsHandler GET/POST /api/me/saved-configs
func savedConfigsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := checkAuth(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"saved_configs": []interface{}{}, "status": "ok"})
		return
	}

	switch r.Method {
	case "GET":
		list, err := ListUserSavedConfigs(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list saved configs", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"saved_configs": list, "status": "ok"})
		return
	case "POST":
		var body struct {
			Name    string `json:"name"`
			Config  string `json:"config"`
			Cloud   string `json:"cloud"`
			Env     string `json:"env"`
			Service string `json:"service"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			writeAPIError(w, r, http.StatusBadRequest, "name required", nil)
			return
		}
		config := body.Config
		if config == "" {
			config = "{}"
		}
		c, err := CreateUserSavedConfig(userID, name, config, strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to create saved config", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		encodeJSON(w, map[string]interface{}{"saved_config": c, "status": "ok"})
		return
	default:
		writeMethodNotAllowed(w, r)
		return
	}
}

// savedConfigDetailHandler GET /api/me/saved-configs/:id, DELETE /api/me/saved-configs/:id
func savedConfigDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := checkAuth(w, r)
	if !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/saved-configs/")
	id, err := strconv.Atoi(strings.Trim(path, "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid id", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	switch r.Method {
	case "GET":
		c, err := GetUserSavedConfigByID(id, userID)
		if err != nil || c == nil {
			writeAPIError(w, r, http.StatusNotFound, "not found", err)
			return
		}
		encodeJSON(w, map[string]interface{}{"saved_config": c, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteUserSavedConfig(id, userID); err != nil {
			if err.Error() == "not found" {
				writeAPIError(w, r, http.StatusNotFound, "not found", err)
				return
			}
			writeAPIError(w, r, http.StatusInternalServerError, "failed to delete saved config", err)
			return
		}
		encodeJSON(w, map[string]interface{}{"status": "ok", "message": "deleted"})
		return
	default:
		writeMethodNotAllowed(w, r)
		return
	}
}
