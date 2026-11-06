package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

type expiryCollectorView struct {
	ID         int        `json:"id"`
	Name       string     `json:"name"`
	ProjectID  int        `json:"project_id,omitempty"`
	Status     string     `json:"status"`
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
	LastError  string     `json:"last_error,omitempty"`
	Coverage   string     `json:"coverage"`
	TokenHint  string     `json:"token_hint"`
}

func expiryCollectorTokenHint() string {
	return "Shown once. Store it on the collector host. It is never displayed again."
}

func listExpiryCollectors(userID int) ([]expiryCollectorView, error) {
	if DB == nil {
		return []expiryCollectorView{}, nil
	}
	projects := map[int]struct{}{}
	for _, id := range visibleProjectIDsForUser(userID) {
		projects[id] = struct{}{}
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, name, COALESCE(project_id, 0), status, last_seen_at, COALESCE(last_error, '')
		FROM expiry_collectors ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []expiryCollectorView{}
	for rows.Next() {
		var item expiryCollectorView
		var lastSeen sql.NullTime
		if err := rows.Scan(&item.ID, &item.Name, &item.ProjectID, &item.Status, &lastSeen, &item.LastError); err != nil {
			return nil, err
		}
		if item.ProjectID > 0 && !expiryAssetVisible(item.ProjectID, userID, projects) {
			continue
		}
		if lastSeen.Valid {
			item.LastSeenAt = &lastSeen.Time
		}
		item.Coverage = expiryCoverageCopy("private")
		item.TokenHint = "Token is not stored in the portal after create."
		if strings.TrimSpace(item.Status) == "" {
			item.Status = "pending"
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func createExpiryCollector(userID, projectID int, name string) (expiryCollectorView, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return expiryCollectorView{}, "", errOncallInvalid
	}
	if projectID > 0 && !expiryAssetVisible(projectID, userID, loadExpiryProjectVisibility(userID)) {
		return expiryCollectorView{}, "", errExpiryDenied
	}
	token, err := randomVulnToken("ost_expiry_")
	if err != nil {
		return expiryCollectorView{}, "", err
	}
	var id int
	err = queryRowContext(`
		INSERT INTO expiry_collectors (name, project_id, token_hash, status, created_by)
		VALUES ($1,$2,$3,'pending',$4) RETURNING id
	`, name, projectID, hashVulnToken(token), userID).Scan(&id)
	if err != nil {
		return expiryCollectorView{}, "", err
	}
	return expiryCollectorView{
		ID:        id,
		Name:      name,
		ProjectID: projectID,
		Status:    "pending",
		Coverage:  expiryCoverageCopy("private"),
		TokenHint: expiryCollectorTokenHint(),
	}, token, nil
}

func lookupExpiryCollectorByToken(raw string) (int, int, bool) {
	hash := hashVulnToken(strings.TrimSpace(raw))
	var id, projectID int
	err := queryRowContext(`SELECT id, COALESCE(project_id, 0) FROM expiry_collectors WHERE token_hash = $1`, hash).Scan(&id, &projectID)
	return id, projectID, err == nil && id > 0
}

func requireExpiryCollector(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || !strings.HasPrefix(header, "Bearer ") {
		writeAPIError(w, r, http.StatusUnauthorized, "collector identity required", nil)
		return 0, 0, false
	}
	id, projectID, ok := lookupExpiryCollectorByToken(token)
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "collector identity required", nil)
		return 0, 0, false
	}
	return id, projectID, true
}

func markExpiryCollectorSeen(id int, status, lastError string) {
	status = strings.TrimSpace(status)
	if status == "" {
		status = "online"
	}
	_, _ = execContext(`
		UPDATE expiry_collectors
		SET last_seen_at = CURRENT_TIMESTAMP, status = $2, last_error = $3
		WHERE id = $1
	`, id, status, strings.TrimSpace(lastError))
}

func lookupPrivateExpiryAsset(assetID, collectorProjectID int, hostname string, port int) (expiryAssetView, error) {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	query := expiryAssetSelect + ` WHERE state <> 'archived' AND LOWER(COALESCE(collector, '')) = 'private'`
	args := []any{}
	if assetID > 0 {
		query += ` AND id = $1`
		args = append(args, assetID)
	} else {
		if hostname == "" || !expiryPortAllowed(port) {
			return expiryAssetView{}, errOncallInvalid
		}
		query += ` AND LOWER(hostname) = $1 AND port = $2`
		args = append(args, hostname, port)
	}
	query += ` ORDER BY id DESC LIMIT 1`
	row, err := scanExpiryAsset(queryRowContext(query, args...))
	if err != nil {
		return expiryAssetView{}, errHandoverNotFound
	}
	if collectorProjectID > 0 && row.ProjectID != collectorProjectID {
		return expiryAssetView{}, errHandoverDenied
	}
	if hostname != "" && strings.ToLower(strings.TrimSpace(row.Hostname)) != hostname {
		return expiryAssetView{}, errOncallInvalid
	}
	if port > 0 && row.Port != port {
		return expiryAssetView{}, errOncallInvalid
	}
	return row, nil
}

func parseExpiryCollectorTime(raw string) *time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	when, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil
	}
	when = when.UTC()
	return &when
}

func applyPrivateCollectorObservation(collectorID, collectorProjectID int, body []byte) error {
	lower := strings.ToLower(string(body))
	if strings.Contains(lower, "begin ") && (strings.Contains(lower, "private") || strings.Contains(lower, "private key")) {
		return errOncallInvalid
	}
	var req struct {
		AssetID         int    `json:"asset_id"`
		Hostname        string `json:"hostname"`
		Port            int    `json:"port"`
		NotAfter        string `json:"not_after"`
		NotBefore       string `json:"not_before"`
		Issuer          string `json:"issuer"`
		SANs            string `json:"sans"`
		LeafFingerprint string `json:"leaf_fingerprint"`
		HostnameOK      *bool  `json:"hostname_ok"`
		ChainOK         *bool  `json:"chain_ok"`
		Detail          string `json:"detail"`
		PrivateKey      string `json:"private_key"`
		PEM             string `json:"pem"`
	}
	if json.Unmarshal(body, &req) != nil {
		return errOncallInvalid
	}
	if strings.TrimSpace(req.PrivateKey) != "" || strings.TrimSpace(req.PEM) != "" {
		return errOncallInvalid
	}
	port := req.Port
	if req.AssetID <= 0 && port == 0 {
		port = 443
	}
	asset, err := lookupPrivateExpiryAsset(req.AssetID, collectorProjectID, req.Hostname, port)
	if err != nil {
		return err
	}
	notAfter := parseExpiryCollectorTime(req.NotAfter)
	if notAfter == nil {
		return errOncallInvalid
	}
	hostnameOK := true
	chainOK := true
	if req.HostnameOK != nil {
		hostnameOK = *req.HostnameOK
	}
	if req.ChainOK != nil {
		chainOK = *req.ChainOK
	}
	detail := strings.TrimSpace(req.Detail)
	if detail == "" {
		detail = "Leaf certificate observed by a private collector."
	}
	obs := expiryObservation{
		Source:           "tls",
		ObservedAt:       time.Now().UTC(),
		ObservationPoint: "private",
		LeafFingerprint:  strings.TrimSpace(req.LeafFingerprint),
		Issuer:           strings.TrimSpace(req.Issuer),
		SANs:             strings.TrimSpace(req.SANs),
		NotBefore:        parseExpiryCollectorTime(req.NotBefore),
		NotAfter:         notAfter,
		HostnameOK:       hostnameOK,
		ChainOK:          chainOK,
		Detail:           detail,
	}
	applyExpiryObservation(asset, obs)
	markExpiryCollectorSeen(collectorID, "online", "")
	return nil
}

func serveExpiryCollectors(w http.ResponseWriter, r *http.Request, userID int) {
	switch r.Method {
	case http.MethodGet:
		items, err := listExpiryCollectors(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Private collectors could not be loaded.", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"collectors": items, "status": "ok"})
	case http.MethodPost:
		var body struct {
			Name      string `json:"name"`
			ProjectID int    `json:"project_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, token, err := createExpiryCollector(userID, body.ProjectID, body.Name)
		if err != nil {
			status := http.StatusBadRequest
			if err == errHandoverDenied || err == errExpiryDenied {
				status = http.StatusForbidden
			}
			writeAPIError(w, r, status, "The private collector could not be created.", err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"collector":     item,
			"token":         token,
			"token_warning": expiryCollectorTokenHint(),
			"status":        "ok",
		})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func expiryCollectorAgentHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/expiry/collector/"), "/")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	id, projectID, ok := requireExpiryCollector(w, r)
	if !ok {
		return
	}
	switch {
	case path == "heartbeat" && r.Method == http.MethodPost:
		markExpiryCollectorSeen(id, "online", "")
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	case path == "observations" && r.Method == http.MethodPost:
		if err := applyPrivateCollectorObservation(id, projectID, body); err != nil {
			markExpiryCollectorSeen(id, "degraded", "The observation was rejected.")
			status := http.StatusBadRequest
			if err == errHandoverNotFound {
				status = http.StatusNotFound
			}
			if err == errHandoverDenied {
				status = http.StatusForbidden
			}
			writeAPIError(w, r, status, "That observation could not be stored. Private keys are not accepted.", err)
			return
		}
		markExpiryCollectorSeen(id, "online", "")
		writeJSON(w, http.StatusAccepted, map[string]any{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}
