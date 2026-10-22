package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var errK8sReadDenied = errors.New("kubernetes read denied")

func k8sRank(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "write":
		return 2
	case "read":
		return 1
	default:
		return 0
	}
}

func k8sLevel(rank int) string {
	switch {
	case rank >= 2:
		return "write"
	case rank == 1:
		return "read"
	default:
		return "none"
	}
}

func normalizeK8sChoice(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "none", "read", "write":
		return strings.ToLower(strings.TrimSpace(value)), true
	default:
		return "", false
	}
}

func teamK8sLevel(stored, teamType string) string {
	if level, ok := normalizeK8sChoice(stored); ok {
		return level
	}
	if strings.TrimSpace(teamType) == "devops" {
		return "read"
	}
	return "none"
}

func projectK8sLevel(stored string) string {
	if level, ok := normalizeK8sChoice(stored); ok {
		return level
	}
	return "read"
}

func k8sEffective(teamLevel, projectLevel string) string {
	teamRank := k8sRank(teamLevel)
	projectRank := k8sRank(projectLevel)
	if projectRank < teamRank {
		return k8sLevel(projectRank)
	}
	return k8sLevel(teamRank)
}

func k8sStronger(left, right string) string {
	if k8sRank(right) > k8sRank(left) {
		return k8sLevel(k8sRank(right))
	}
	return k8sLevel(k8sRank(left))
}

func k8sSeesAll(userID int) bool {
	if userID <= 0 || DB == nil {
		return false
	}
	user, err := GetUserByID(userID)
	return err == nil && user != nil && user.Role == "admin"
}

// k8sAccessByProject returns nil when the user is an admin and may see every project.
// An empty map means the user has no readable project.
func k8sAccessByProject(userID int) map[int]string {
	if userID <= 0 || DB == nil {
		return map[int]string{}
	}
	if k8sSeesAll(userID) {
		return nil
	}
	rows, err := DB.Query(`
		SELECT pta.project_id,
		       COALESCE(t.team_type, 'portal'),
		       COALESCE(t.k8s_access, ''),
		       COALESCE(pta.k8s_access, 'read')
		FROM team_members tm
		JOIN teams t ON t.id = tm.team_id
		JOIN project_team_access pta ON pta.team_id = tm.team_id
		WHERE tm.user_id = $1`, userID)
	if err != nil {
		return map[int]string{}
	}
	defer rows.Close()
	best := map[int]int{}
	for rows.Next() {
		var projectID int
		var teamType, teamAccess, linkAccess string
		if err := rows.Scan(&projectID, &teamType, &teamAccess, &linkAccess); err != nil {
			continue
		}
		level := k8sEffective(teamK8sLevel(teamAccess, teamType), projectK8sLevel(linkAccess))
		rank := k8sRank(level)
		if rank > best[projectID] {
			best[projectID] = rank
		}
	}
	out := map[int]string{}
	for projectID, rank := range best {
		if rank > 0 {
			out[projectID] = k8sLevel(rank)
		}
	}
	return out
}

func userK8sAccessForProject(userID, projectID int) string {
	if k8sSeesAll(userID) {
		return "write"
	}
	access := k8sAccessByProject(userID)
	if access == nil {
		return "write"
	}
	level := access[projectID]
	if level == "" {
		return "none"
	}
	return level
}

func k8sProjectReadable(access map[int]string, projectID int) bool {
	if access == nil {
		return true
	}
	return k8sRank(access[projectID]) >= 1
}

func scopeK8sReadProject(userID, projectID int) (int, error) {
	if k8sSeesAll(userID) {
		return projectID, nil
	}
	access := k8sAccessByProject(userID)
	if projectID > 0 {
		if !k8sProjectReadable(access, projectID) {
			return 0, errK8sReadDenied
		}
		return projectID, nil
	}
	best := 0
	for id, level := range access {
		if k8sRank(level) < 1 {
			continue
		}
		if best == 0 || id < best {
			best = id
		}
	}
	if best == 0 {
		return 0, errK8sReadDenied
	}
	return best, nil
}

func loadK8sDashboardForReader(userID, projectID int, clusterName, namespace, environment string, applyDefaults bool) (*k8sDashboardResponse, error) {
	scoped, err := scopeK8sReadProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	payload, err := buildK8sDashboard(scoped, clusterName, namespace, environment, applyDefaults)
	if err != nil {
		return nil, err
	}
	filterDashboardForReader(userID, payload)
	return payload, nil
}

func filterDashboardForReader(userID int, payload *k8sDashboardResponse) {
	if payload == nil {
		return
	}
	access := k8sAccessByProject(userID)
	if access == nil {
		payload.K8sAccess = "write"
		for i := range payload.Projects {
			payload.Projects[i].K8sAccess = "write"
		}
		return
	}
	projects := make([]k8sProjectOption, 0, len(payload.Projects))
	for _, project := range payload.Projects {
		if !k8sProjectReadable(access, project.ID) {
			continue
		}
		project.K8sAccess = access[project.ID]
		projects = append(projects, project)
	}
	connections := make([]k8sConnectionRecord, 0, len(payload.Connections))
	for _, item := range payload.Connections {
		if k8sProjectReadable(access, item.ProjectID) {
			connections = append(connections, item)
		}
	}
	payload.Projects = projects
	payload.Connections = connections
	level := access[payload.SelectedProjectID]
	if level == "" {
		level = "none"
	}
	payload.K8sAccess = level
}

func filterK8sConnectionCatalog(userID int, projects []k8sProjectOption, connections []k8sConnectionRecord) ([]k8sProjectOption, []k8sConnectionRecord, string) {
	access := k8sAccessByProject(userID)
	if access == nil {
		for i := range projects {
			projects[i].K8sAccess = "write"
		}
		return projects, connections, "write"
	}
	keptProjects := make([]k8sProjectOption, 0, len(projects))
	strongest := "none"
	for _, project := range projects {
		if !k8sProjectReadable(access, project.ID) {
			continue
		}
		project.K8sAccess = access[project.ID]
		strongest = k8sStronger(strongest, project.K8sAccess)
		keptProjects = append(keptProjects, project)
	}
	keptConnections := make([]k8sConnectionRecord, 0, len(connections))
	for _, item := range connections {
		if k8sProjectReadable(access, item.ProjectID) {
			keptConnections = append(keptConnections, item)
		}
	}
	return keptProjects, keptConnections, strongest
}

func writeK8sLoadError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errK8sReadDenied) {
		writeAPIError(w, r, http.StatusForbidden, "This cluster is not included for your group.", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
}

func ensureK8sWrite(w http.ResponseWriter, r *http.Request, userID, projectID int) bool {
	if projectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project is required", nil)
		return false
	}
	if k8sRank(userK8sAccessForProject(userID, projectID)) < 2 {
		writeAPIError(w, r, http.StatusForbidden, "Write access is not granted for this project.", nil)
		return false
	}
	return true
}

func migrateK8sAccessSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS k8s_access TEXT NOT NULL DEFAULT ''`)
	_, _ = DB.Exec(`ALTER TABLE project_team_access ADD COLUMN IF NOT EXISTS k8s_access TEXT NOT NULL DEFAULT 'read'`)
}

type k8sAccessProjectBody struct {
	ProjectID int    `json:"project_id"`
	Access    string `json:"k8s_access"`
}

func adminTeamK8sAccessHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/teams/")
	id, _ := strconv.Atoi(strings.Split(path, "/")[0])
	if id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid team id", nil)
		return
	}
	team, err := GetTeamByID(id)
	if err != nil || team == nil {
		writeAPIError(w, r, http.StatusNotFound, "team not found", err)
		return
	}
	if r.Method == http.MethodGet {
		payload, loadErr := loadTeamK8sAccessPayload(id, team.TeamType)
		if loadErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes access could not be loaded", loadErr)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeAdminTeamJSON(w, payload)
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		K8sAccess string                 `json:"k8s_access"`
		Projects  []k8sAccessProjectBody `json:"projects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	level, valid := normalizeK8sChoice(body.K8sAccess)
	if !valid {
		writeAPIError(w, r, http.StatusBadRequest, "Choose none, read, or write.", nil)
		return
	}
	for _, item := range body.Projects {
		if _, ok := normalizeK8sChoice(item.Access); !ok || item.ProjectID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "Choose none, read, or write.", nil)
			return
		}
	}
	if err := saveTeamK8sAccess(id, level, body.Projects); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeAPIError(w, r, http.StatusBadRequest, "That project was not found.", nil)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes access could not be saved", err)
		return
	}
	AppendAuditLog(&adminID, "team_k8s_access", "team", strconv.Itoa(id), team.Name)
	payload, loadErr := loadTeamK8sAccessPayload(id, team.TeamType)
	if loadErr != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Kubernetes access could not be loaded", loadErr)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAdminTeamJSON(w, payload)
}

func loadTeamK8sAccessPayload(teamID int, teamType string) (map[string]interface{}, error) {
	var stored string
	if err := DB.QueryRow(`SELECT COALESCE(k8s_access, '') FROM teams WHERE id = $1`, teamID).Scan(&stored); err != nil {
		return nil, err
	}
	linkRows, err := DB.Query(`
		SELECT p.id, p.name, COALESCE(pta.k8s_access, 'read')
		FROM project_team_access pta
		JOIN projects p ON p.id = pta.project_id
		WHERE pta.team_id = $1
		ORDER BY p.name, p.id`, teamID)
	if err != nil {
		return nil, err
	}
	defer linkRows.Close()
	links := make([]map[string]interface{}, 0)
	for linkRows.Next() {
		var projectID int
		var name, access string
		if err := linkRows.Scan(&projectID, &name, &access); err != nil {
			return nil, err
		}
		links = append(links, map[string]interface{}{
			"project_id": projectID,
			"name":       name,
			"k8s_access": projectK8sLevel(access),
		})
	}
	if err := linkRows.Err(); err != nil {
		return nil, err
	}
	projectRows, err := DB.Query(`SELECT id, name FROM projects ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	defer projectRows.Close()
	projects := make([]map[string]interface{}, 0)
	for projectRows.Next() {
		var projectID int
		var name string
		if err := projectRows.Scan(&projectID, &name); err != nil {
			return nil, err
		}
		projects = append(projects, map[string]interface{}{
			"id":   projectID,
			"name": name,
		})
	}
	if err := projectRows.Err(); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"status":     "ok",
		"k8s_access": teamK8sLevel(stored, teamType),
		"links":      links,
		"projects":   projects,
	}, nil
}

func saveTeamK8sAccess(teamID int, level string, projects []k8sAccessProjectBody) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE teams SET k8s_access = $2 WHERE id = $1`, teamID, level); err != nil {
		return err
	}
	for _, item := range projects {
		access, _ := normalizeK8sChoice(item.Access)
		var projectID int
		err := tx.QueryRow(`SELECT id FROM projects WHERE id = $1`, item.ProjectID).Scan(&projectID)
		if err != nil {
			return err
		}
		var existing int
		err = tx.QueryRow(`SELECT id FROM project_team_access WHERE project_id = $1 AND team_id = $2`, projectID, teamID).Scan(&existing)
		if err == sql.ErrNoRows {
			if access == "none" {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO project_team_access (project_id, team_id, k8s_access) VALUES ($1, $2, $3)`, projectID, teamID, access); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE project_team_access SET k8s_access = $3 WHERE project_id = $1 AND team_id = $2`, projectID, teamID, access); err != nil {
			return err
		}
	}
	return tx.Commit()
}
