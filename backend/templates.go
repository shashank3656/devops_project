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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := checkAuth(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"templates": []interface{}{}, "status": "ok"})
		return
	}
	list, err := ListRequestTemplates()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list templates", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"templates": list, "status": "ok"})
}

// templatesDetailHandler GET /api/templates/:id - get one template (auth required)
func templatesDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := checkAuth(w, r); !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/templates/")
	id, err := strconv.Atoi(strings.Trim(path, "/"))
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid template id", "status": "error"})
		return
	}
	t, err := GetRequestTemplateByID(id)
	if err != nil || t == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "template not found", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"template": t, "status": "ok"})
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
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
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"templates": list, "status": "ok"})
			return
		case "POST":
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Cloud       string `json:"cloud"`
				Env         string `json:"env"`
				Service     string `json:"service"`
				Config      string `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
				return
			}
			name := strings.TrimSpace(body.Name)
			if name == "" || strings.TrimSpace(body.Cloud) == "" || strings.TrimSpace(body.Env) == "" || strings.TrimSpace(body.Service) == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "name, cloud, env, service required", "status": "error"})
				return
			}
			config := body.Config
			if config == "" {
				config = "{}"
			}
			t, err := CreateRequestTemplate(name, strings.TrimSpace(body.Description), strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service), config, adminIDPtr)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
				return
			}
			AppendAuditLog(adminIDPtr, "template_create", "request_template", strconv.Itoa(t.ID), name)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"template": t, "status": "ok"})
			return
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "template not found", "status": "error"})
		return
	}

	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(map[string]interface{}{"template": t, "status": "ok"})
		return
	case "PUT", "PATCH":
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Cloud       string `json:"cloud"`
			Env         string `json:"env"`
			Service     string `json:"service"`
			Config      string `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
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
		if err := UpdateRequestTemplate(id, name, strings.TrimSpace(body.Description), cloud, env, service, config); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		AppendAuditLog(adminIDPtr, "template_update", "request_template", strconv.Itoa(id), name)
		updated, _ := GetRequestTemplateByID(id)
		json.NewEncoder(w).Encode(map[string]interface{}{"template": updated, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteRequestTemplate(id); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		AppendAuditLog(adminIDPtr, "template_delete", "request_template", strconv.Itoa(id), t.Name)
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "deleted"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

// checkAuth returns (userID, true) if request has valid Bearer token
func checkAuth(w http.ResponseWriter, r *http.Request) (int, bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "authorization required", "status": "error"})
		return 0, false
	}
	id, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid token", "status": "error"})
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
		json.NewEncoder(w).Encode(map[string]interface{}{"saved_configs": []interface{}{}, "status": "ok"})
		return
	}

	switch r.Method {
	case "GET":
		list, err := ListUserSavedConfigs(userID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to list", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"saved_configs": list, "status": "ok"})
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
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "name required", "status": "error"})
			return
		}
		config := body.Config
		if config == "" {
			config = "{}"
		}
		c, err := CreateUserSavedConfig(userID, name, config, strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service))
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{"saved_config": c, "status": "ok"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid id", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if DB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	switch r.Method {
	case "GET":
		c, err := GetUserSavedConfigByID(id, userID)
		if err != nil || c == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found", "status": "error"})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"saved_config": c, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteUserSavedConfig(id, userID); err != nil {
			if err.Error() == "not found" {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusInternalServerError)
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "deleted"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}
