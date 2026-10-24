package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type vulnAgentView struct {
	ID            int     `json:"id"`
	Name          string  `json:"name"`
	ProjectID     int     `json:"project_id,omitempty"`
	Status        string  `json:"status"`
	Version       string  `json:"version,omitempty"`
	Capabilities  string  `json:"capabilities"`
	LastHeartbeat *string `json:"last_heartbeat_at,omitempty"`
	LastError     string  `json:"last_error,omitempty"`
}

func hashVulnToken(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

func randomVulnToken(prefix string) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(buf), nil
}

func listVulnAgents(userID int) ([]vulnAgentView, error) {
	if DB == nil {
		return []vulnAgentView{}, nil
	}
	seeAll, ids, err := visibleServiceProjectIDs(userID)
	if err != nil {
		return nil, err
	}
	args := []any{}
	extra, args := vulnProjectFilter(seeAll, ids, "project_id", args)
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, name, COALESCE(project_id,0), status, version, capabilities, last_heartbeat_at, last_error
		FROM vuln_agents WHERE 1=1 `+extra+` ORDER BY id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []vulnAgentView{}
	for rows.Next() {
		var item vulnAgentView
		var last sql.NullTime
		if rows.Scan(&item.ID, &item.Name, &item.ProjectID, &item.Status, &item.Version, &item.Capabilities, &last, &item.LastError) == nil {
			item.LastHeartbeat = nullTimePtr(last)
			out = append(out, item)
		}
	}
	return out, nil
}

func createVulnAgent(userID, projectID int, name string) (vulnAgentView, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return vulnAgentView{}, "", fmt.Errorf("agent name is required")
	}
	bootstrap, err := randomVulnToken("ost_enroll_")
	if err != nil {
		return vulnAgentView{}, "", err
	}
	placeholder, err := randomVulnToken("ost_pending_")
	if err != nil {
		return vulnAgentView{}, "", err
	}
	var projectAny any
	if projectID > 0 {
		projectAny = projectID
	}
	var id int
	err = queryRowContext(`
		INSERT INTO vuln_agents (name, project_id, token_hash, status, created_by)
		VALUES ($1,$2,$3,'pending',$4) RETURNING id
	`, name, projectAny, hashVulnToken(placeholder), userID).Scan(&id)
	if err != nil {
		return vulnAgentView{}, "", err
	}
	_, _ = execContext(`INSERT INTO vuln_agent_bootstraps (agent_id, token_hash, expires_at) VALUES ($1,$2,$3)`, id, hashVulnToken(bootstrap), time.Now().UTC().Add(24*time.Hour))
	items, _ := listVulnAgents(userID)
	for _, item := range items {
		if item.ID == id {
			return item, bootstrap, nil
		}
	}
	return vulnAgentView{ID: id, Name: name, Status: "pending"}, bootstrap, nil
}

func lookupAgentByToken(raw string) (int, int, bool) {
	hash := hashVulnToken(raw)
	var id, projectID int
	err := queryRowContext(`SELECT id, COALESCE(project_id,0) FROM vuln_agents WHERE token_hash = $1`, hash).Scan(&id, &projectID)
	return id, projectID, err == nil && id > 0
}

func securityVulnAgentHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/security/agent/"), "/")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	switch {
	case path == "enroll" && r.Method == http.MethodPost:
		var req struct {
			Bootstrap string `json:"bootstrap_token"`
			Version   string `json:"version"`
		}
		if json.Unmarshal(body, &req) != nil || strings.TrimSpace(req.Bootstrap) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "bootstrap_token is required", nil)
			return
		}
		var agentID int
		err := queryRowContext(`
			SELECT agent_id FROM vuln_agent_bootstraps
			WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
		`, hashVulnToken(req.Bootstrap)).Scan(&agentID)
		if err != nil || agentID <= 0 {
			writeAPIError(w, r, http.StatusUnauthorized, "bootstrap token is invalid or expired", nil)
			return
		}
		token, err := randomVulnToken("ost_agent_")
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "agent identity could not be issued", err)
			return
		}
		_, _ = execContext(`UPDATE vuln_agents SET token_hash=$2, status='online', version=$3 WHERE id=$1`, agentID, hashVulnToken(token), strings.TrimSpace(req.Version))
		_, _ = execContext(`UPDATE vuln_agent_bootstraps SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1`, hashVulnToken(req.Bootstrap))
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"agent_id": agentID, "token": token, "status": "ok"})
	case path == "heartbeat" && r.Method == http.MethodPost:
		agentID, _, ok := requireVulnAgent(w, r)
		if !ok {
			return
		}
		var req struct {
			Version string `json:"version"`
			Error   string `json:"error"`
		}
		_ = json.Unmarshal(body, &req)
		status := "online"
		if strings.TrimSpace(req.Error) != "" {
			status = "degraded"
		}
		_, _ = execContext(`UPDATE vuln_agents SET last_heartbeat_at=CURRENT_TIMESTAMP, version=CASE WHEN $2='' THEN version ELSE $2 END, last_error=$3, status=$4 WHERE id=$1`, agentID, strings.TrimSpace(req.Version), strings.TrimSpace(req.Error), status)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ok"})
	case path == "jobs/claim" && r.Method == http.MethodPost:
		agentID, projectID, ok := requireVulnAgent(w, r)
		if !ok {
			return
		}
		var jobID, repoID int
		var owner, name, branch string
		q := `
			UPDATE vuln_scan_jobs
			SET state='running', started_at=COALESCE(started_at, CURRENT_TIMESTAMP), stage='clone'
			WHERE id = (
				SELECT j2.id FROM vuln_scan_jobs j2
				WHERE j2.state='queued' AND COALESCE(j2.collection_mode,'hosted')='agent'
				  AND (
				    ($1 = 0 AND (j2.project_id IS NULL OR j2.project_id = 0))
				    OR j2.project_id = $1
				  )
				ORDER BY j2.id
				LIMIT 1
			) AND state='queued'
			RETURNING id, repo_id`
		if err := queryRowContext(q, projectID).Scan(&jobID, &repoID); err != nil {
			_ = writeJSONResponse(w, http.StatusOK, map[string]any{"job": nil, "status": "ok"})
			return
		}
		_ = queryRowContext(`SELECT owner, name, branch FROM vuln_repositories WHERE id=$1`, repoID).Scan(&owner, &name, &branch)
		_, _ = execContext(`UPDATE vuln_agents SET last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=$1`, agentID)
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{
			"job":    map[string]any{"id": jobID, "repo_id": repoID, "owner": owner, "name": name, "branch": branch},
			"status": "ok",
		})
	case strings.HasPrefix(path, "jobs/") && strings.HasSuffix(path, "/results") && r.Method == http.MethodPost:
		agentID, _, ok := requireVulnAgent(w, r)
		if !ok {
			return
		}
		id, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(path, "jobs/"), "/results"))
		handleVulnInventoryUpload(w, r, 0, agentID, id, body)
	default:
		writeAPIError(w, r, http.StatusNotFound, "not found", nil)
	}
}

func requireVulnAgent(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || !strings.HasPrefix(header, "Bearer ") {
		writeAPIError(w, r, http.StatusUnauthorized, "agent identity required", nil)
		return 0, 0, false
	}
	id, projectID, ok := lookupAgentByToken(token)
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "agent identity required", nil)
		return 0, 0, false
	}
	return id, projectID, true
}

func acceptedVulnInventorySchema(raw string) bool {
	schema := strings.TrimSpace(raw)
	return schema == "" || schema == "1" || schema == "opstrellis.inventory.v1"
}

func handleVulnInventoryUpload(w http.ResponseWriter, r *http.Request, userID, agentID, jobID int, raw []byte) {
	var req struct {
		SchemaVersion string            `json:"schema_version"`
		JobID         int               `json:"job_id"`
		RepoID        int               `json:"repository_id"`
		CommitSHA     string            `json:"commit_sha"`
		Components    []vulnComponent   `json:"components"`
		Coverage      []vulnCoverageGap `json:"coverage"`
		SBOM          json.RawMessage   `json:"sbom"`
	}
	if json.Unmarshal(raw, &req) != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid inventory envelope", nil)
		return
	}
	if jobID <= 0 {
		jobID = req.JobID
	}
	if req.RepoID <= 0 || strings.TrimSpace(req.CommitSHA) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "repository_id and commit_sha are required", nil)
		return
	}
	if !acceptedVulnInventorySchema(req.SchemaVersion) {
		writeAPIError(w, r, http.StatusBadRequest, "schema_version is not supported", nil)
		return
	}
	if jobID <= 0 {
		err := queryRowContext(`
			INSERT INTO vuln_scan_jobs (repo_id, trigger, state, stage, commit_sha, created_by, collection_mode)
			VALUES ($1,'ci','running','correlation',$2,$3,'ci') RETURNING id
		`, req.RepoID, req.CommitSHA, userID).Scan(&jobID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "scan could not be queued", err)
			return
		}
	}
	var boundRepo int
	if err := queryRowContext(`SELECT repo_id FROM vuln_scan_jobs WHERE id=$1`, jobID).Scan(&boundRepo); err != nil || boundRepo != req.RepoID {
		writeAPIError(w, r, http.StatusConflict, "job is not bound to that repository", nil)
		return
	}
	parsed := vulnParsedInventory{Components: req.Components, Coverage: req.Coverage}
	if len(req.SBOM) > 0 {
		sbom := parseSBOM("upload.sbom.json", "", string(req.SBOM))
		parsed = mergeParsedInventories([]vulnParsedInventory{parsed, sbom})
	}
	_, _ = execContext(`UPDATE vuln_scan_jobs SET state='running', stage='correlation', commit_sha=$2 WHERE id=$1`, jobID, req.CommitSHA)
	appendVulnScanLog(jobID, "correlation", "Uploaded inventory received for commit "+req.CommitSHA+".")
	if err := saveInventoryAndCorrelate(jobID, req.RepoID, req.CommitSHA, parsed); err != nil {
		failVulnScan(jobID, "correlation", "Uploaded inventory could not be saved.")
		writeAPIError(w, r, http.StatusInternalServerError, "inventory could not be saved", err)
		return
	}
	state := "succeeded"
	if len(parsed.Coverage) > 0 {
		state = "partial"
	}
	_, _ = execContext(`UPDATE vuln_scan_jobs SET state=$2, stage='done', coverage_json=$3, finished_at=CURRENT_TIMESTAMP WHERE id=$1`, jobID, state, encodeJSONString(parsed.Coverage))
	appendVulnScanLog(jobID, "done", "Uploaded inventory scan "+state+".")
	if agentID > 0 {
		_, _ = execContext(`UPDATE vuln_agents SET last_heartbeat_at=CURRENT_TIMESTAMP, status='online' WHERE id=$1`, agentID)
	}
	_ = writeJSONResponse(w, http.StatusAccepted, map[string]any{"job_id": jobID, "status": "accepted"})
}
