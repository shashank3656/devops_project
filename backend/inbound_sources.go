package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type inboundWebhookSource struct {
	ID        int       `json:"id"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	HasSecret bool      `json:"has_secret"`
	Enabled   bool      `json:"enabled"`
	ProjectID *int      `json:"project_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

const inboundWebhookSecretRevealSeconds = 300

func generateInboundWebhookSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func normalizeInboundSourceKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "change":
		return "change"
	case "grafana":
		return "grafana"
	case "alertmanager":
		return "alertmanager"
	case "generic_log", "generic", "log", "logging":
		return "generic_log"
	case "alert", "alerts":
		return "alert"
	case "zenduty", "zd":
		return "zenduty"
	case "pagerduty", "pd":
		return "pagerduty"
	default:
		return ""
	}
}

func listEnabledInboundWebhookSecrets(kind string) []string {
	if DB == nil {
		return nil
	}
	normalized := normalizeInboundSourceKind(kind)
	rows, err := DB.Query(`
		SELECT COALESCE(secret,'')
		FROM inbound_webhook_sources
		WHERE enabled = TRUE
		  AND COALESCE(secret,'') <> ''
		  AND (
		    $1 = ''
		    OR kind = $1
		    OR ($1 IN ('alert', 'grafana', 'alertmanager', 'generic_log', 'zenduty', 'pagerduty') AND kind IN ('alert', 'grafana', 'alertmanager', 'generic_log', 'zenduty', 'pagerduty'))
		    OR ($1 = 'change' AND kind = 'change')
		  )
	`, normalized)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		log.Printf("list inbound webhook secrets: %v", err)
		return nil
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var secret string
		if err := rows.Scan(&secret); err != nil {
			continue
		}
		if trimmed := strings.TrimSpace(secret); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func listInboundWebhookSources() ([]inboundWebhookSource, error) {
	if DB == nil {
		return []inboundWebhookSource{}, nil
	}
	rows, err := DB.Query(`
		SELECT id, kind, name, COALESCE(secret,''), enabled, project_id, created_at, updated_at
		FROM inbound_webhook_sources
		ORDER BY id
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []inboundWebhookSource{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []inboundWebhookSource{}
	for rows.Next() {
		var item inboundWebhookSource
		var secret string
		var projectID *int
		if err := rows.Scan(&item.ID, &item.Kind, &item.Name, &secret, &item.Enabled, &projectID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.HasSecret = strings.TrimSpace(secret) != ""
		item.ProjectID = projectID
		out = append(out, item)
	}
	return out, nil
}

func createInboundWebhookSource(kind, name, secret string, projectID *int) (*inboundWebhookSource, error) {
	kind = normalizeInboundSourceKind(kind)
	name = strings.TrimSpace(name)
	if kind == "" {
		return nil, errInboundSource("kind must be change, grafana, alertmanager, generic_log, alert, or zenduty")
	}
	if name == "" {
		return nil, errInboundSource("name is required")
	}
	if strings.TrimSpace(secret) == "" {
		return nil, errInboundSource("X-CI-Secret is required")
	}
	var item inboundWebhookSource
	var storedSecret string
	err := DB.QueryRow(`
		INSERT INTO inbound_webhook_sources (kind, name, secret, project_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, kind, name, COALESCE(secret,''), enabled, project_id, created_at, updated_at
	`, kind, name, strings.TrimSpace(secret), projectID).Scan(&item.ID, &item.Kind, &item.Name, &storedSecret, &item.Enabled, &item.ProjectID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	item.HasSecret = strings.TrimSpace(storedSecret) != ""
	return &item, nil
}

func updateInboundWebhookSource(id int, kind, name, secret string, enabled bool, projectID *int) error {
	kind = normalizeInboundSourceKind(kind)
	name = strings.TrimSpace(name)
	if kind == "" || name == "" {
		return errInboundSource("kind and name are required")
	}
	if strings.TrimSpace(secret) == "" {
		_, err := DB.Exec(`
			UPDATE inbound_webhook_sources
			SET kind = $1, name = $2, enabled = $3, project_id = $4, updated_at = CURRENT_TIMESTAMP
			WHERE id = $5
		`, kind, name, enabled, projectID, id)
		return err
	}
	_, err := DB.Exec(`
		UPDATE inbound_webhook_sources
		SET kind = $1, name = $2, secret = $3, enabled = $4, project_id = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $6
	`, kind, name, strings.TrimSpace(secret), enabled, projectID, id)
	return err
}

func deleteInboundWebhookSource(id int) error {
	_, err := DB.Exec(`DELETE FROM inbound_webhook_sources WHERE id = $1`, id)
	return err
}

type inboundSourceError string

func (e inboundSourceError) Error() string { return string(e) }

func errInboundSource(message string) error { return inboundSourceError(message) }

func encodeInboundSourceJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("inbound sources response encode failed: %v", err)
	}
}

func devopsInboundSourcesHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	serveInboundSources(w, r)
}

func devopsInboundSourceDetailHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	serveInboundSourceDetail(w, r, "/api/devops/inbound-sources/")
}

func adminInboundSourcesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	serveInboundSources(w, r)
}

func serveInboundSources(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	switch r.Method {
	case "GET":
		list, err := listInboundWebhookSources()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to list inbound sources", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeInboundSourceJSON(w, map[string]any{"sources": list, "status": "ok"})
	case "POST":
		var body struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Secret    string `json:"secret"`
			Generate  bool   `json:"generate"`
			ProjectID *int   `json:"project_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		plaintext := strings.TrimSpace(body.Secret)
		if plaintext == "" && body.Generate {
			generated, err := generateInboundWebhookSecret()
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "unable to generate secret", err)
				return
			}
			plaintext = generated
		}
		item, err := createInboundWebhookSource(body.Kind, body.Name, plaintext, body.ProjectID)
		if err != nil {
			if _, ok := err.(inboundSourceError); ok {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
				return
			}
			writeAPIError(w, r, http.StatusBadRequest, "could not save the CI secret", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeInboundSourceJSON(w, map[string]any{
			"source":         item,
			"secret":         plaintext,
			"reveal_seconds": inboundWebhookSecretRevealSeconds,
			"note":           "Send this value in the X-CI-Secret header. Copy it now; it cannot be shown again after five minutes.",
			"status":         "ok",
		})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func adminInboundSourceDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	serveInboundSourceDetail(w, r, "/api/admin/inbound-sources/")
}

func serveInboundSourceDetail(w http.ResponseWriter, r *http.Request, prefix string) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, prefix)
	id, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid source id", nil)
		return
	}
	if r.Method == "DELETE" {
		if err := deleteInboundWebhookSource(id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to delete source", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeInboundSourceJSON(w, map[string]any{"status": "ok"})
		return
	}
	if r.Method != "PATCH" && r.Method != "PUT" {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Secret    string `json:"secret"`
		Enabled   *bool  `json:"enabled"`
		ProjectID *int   `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	if err := updateInboundWebhookSource(id, body.Kind, body.Name, body.Secret, enabled, body.ProjectID); err != nil {
		if _, ok := err.(inboundSourceError); ok {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
			return
		}
		writeAPIError(w, r, http.StatusBadRequest, "could not update the CI secret", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeInboundSourceJSON(w, map[string]any{"status": "ok"})
}
