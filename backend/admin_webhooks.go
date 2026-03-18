package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func encodeAdminWebhookJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("admin webhooks response encode failed: %v", err)
	}
}

// adminWebhooksHandler GET /api/admin/webhooks (list), POST /api/admin/webhooks (create)
func adminWebhooksHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAdminWebhookJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	if r.Method == "GET" {
		list, err := GetOutboundWebhooks()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminWebhookJSON(w, map[string]interface{}{"webhooks": list, "status": "ok"})
		return
	}
	if r.Method == "POST" {
		var body struct {
			URL    string `json:"url"`
			Secret string `json:"secret"`
			Events string `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		url := strings.TrimSpace(body.URL)
		if url == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": "url is required", "status": "error"})
			return
		}
		events := strings.TrimSpace(body.Events)
		if events == "" {
			events = "approved,pr_created,rejected,assigned"
		}
		webhook, err := CreateOutboundWebhook(url, strings.TrimSpace(body.Secret), events)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminWebhookJSON(w, map[string]interface{}{"webhook": webhook, "status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r)
}

// adminWebhookDetailHandler PATCH /api/admin/webhooks/:id, DELETE /api/admin/webhooks/:id
func adminWebhookDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeAdminWebhookJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/webhooks/")
	idStr := strings.Split(path, "/")[0]
	id, _ := strconv.Atoi(idStr)
	if id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeAdminWebhookJSON(w, map[string]interface{}{"error": "invalid webhook id", "status": "error"})
		return
	}
	if r.Method == "DELETE" {
		if err := DeleteOutboundWebhook(id); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminWebhookJSON(w, map[string]interface{}{"message": "webhook deleted", "status": "ok"})
		return
	}
	if r.Method == "PATCH" || r.Method == "PUT" {
		var body struct {
			URL     string `json:"url"`
			Secret  string `json:"secret"`
			Events  string `json:"events"`
			Enabled *bool  `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		list, _ := GetOutboundWebhooks()
		var current *OutboundWebhook
		for i := range list {
			if list[i].ID == id {
				current = &list[i]
				break
			}
		}
		if current == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": "webhook not found", "status": "error"})
			return
		}
		url := strings.TrimSpace(body.URL)
		if url == "" {
			url = current.URL
		}
		events := strings.TrimSpace(body.Events)
		if events == "" {
			events = current.Events
		}
		enabled := current.Enabled
		if body.Enabled != nil {
			enabled = *body.Enabled
		}
		secret := strings.TrimSpace(body.Secret)
		if err := UpdateOutboundWebhook(id, url, secret, events, enabled); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeAdminWebhookJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		list2, _ := GetOutboundWebhooks()
		var updated *OutboundWebhook
		for i := range list2 {
			if list2[i].ID == id {
				updated = &list2[i]
				break
			}
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminWebhookJSON(w, map[string]interface{}{"webhook": updated, "status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r)
}
