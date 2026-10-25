package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var errCostOperateRequired = errors.New("Cost operate is required for this project")

func migrateCostAccessSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`ALTER TABLE project_team_access ADD COLUMN IF NOT EXISTS cost_access TEXT NOT NULL DEFAULT 'operate'`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS cost_ai_proofs (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			status VARCHAR(16) NOT NULL DEFAULT 'safe',
			dropped_key_count INTEGER NOT NULL DEFAULT 0,
			redacted_count INTEGER NOT NULL DEFAULT 0,
			calc_ids_present BOOLEAN NOT NULL DEFAULT FALSE,
			cost_path BOOLEAN NOT NULL DEFAULT FALSE
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cost_ai_proofs_user ON cost_ai_proofs(user_id, created_at DESC)`)
}

func normalizeCostAccess(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "view") {
		return "view"
	}
	return "operate"
}

func costAccessRank(value string) int {
	if normalizeCostAccess(value) == "operate" {
		return 2
	}
	return 1
}

func userCostRoleForProject(userID, projectID int) string {
	if userID <= 0 || projectID <= 0 {
		return ""
	}
	if !userCanSeeCostProject(userID, projectID) {
		return ""
	}
	if costSeesAll(userID) {
		return "operate"
	}
	if DB == nil {
		return "view"
	}
	rows, err := DB.Query(`
		SELECT COALESCE(pta.cost_access, 'operate')
		  FROM team_members tm
		  JOIN teams t ON t.id = tm.team_id
		  JOIN project_team_access pta ON pta.team_id = tm.team_id
		 WHERE tm.user_id = $1 AND pta.project_id = $2
	`, userID, projectID)
	if err != nil {
		return "view"
	}
	defer rows.Close()
	best := 0
	role := "view"
	for rows.Next() {
		var stored string
		if err := rows.Scan(&stored); err != nil {
			continue
		}
		rank := costAccessRank(stored)
		if rank > best {
			best = rank
			role = normalizeCostAccess(stored)
		}
	}
	if best == 0 {
		return "view"
	}
	return role
}

func costSeesAll(userID int) bool {
	if userID <= 0 || DB == nil {
		return false
	}
	user, err := GetUserByID(userID)
	return err == nil && user != nil && user.Role == "admin"
}

func userCanOperateCost(userID, projectID int) bool {
	return userCostRoleForProject(userID, projectID) == "operate"
}

func userHasCostOperateAnywhere(userID int) bool {
	if costSeesAll(userID) {
		return true
	}
	for _, projectID := range visibleProjectIDsForUser(userID) {
		if userCanOperateCost(userID, projectID) {
			return true
		}
	}
	return false
}

func writeCostOperateDenied(w http.ResponseWriter, r *http.Request) {
	writeAPIError(w, r, http.StatusForbidden, "Cost operate is required for this project.", nil)
}

func requireCostOperateOnProject(w http.ResponseWriter, r *http.Request, userID, projectID int) bool {
	if !userCanOperateCost(userID, projectID) {
		writeCostOperateDenied(w, r)
		return false
	}
	return true
}

func requireCostOperateOnConnection(w http.ResponseWriter, r *http.Request, userID, connectionID int) bool {
	conn, err := getCostConnection(userID, connectionID)
	if err != nil || conn == nil {
		writeAPIError(w, r, http.StatusNotFound, "Cost connection not found.", err)
		return false
	}
	return requireCostOperateOnProject(w, r, userID, conn.ProjectID)
}

func costRolePayload(userID, projectID int) map[string]any {
	role := userCostRoleForProject(userID, projectID)
	if role == "" {
		role = "view"
	}
	return map[string]any{
		"rbac":        "project",
		"cost_role":   role,
		"can_operate": role == "operate",
	}
}

type costAccessProjectBody struct {
	ProjectID  int    `json:"project_id"`
	CostAccess string `json:"cost_access"`
}

func adminTeamCostAccessHandler(w http.ResponseWriter, r *http.Request) {
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
		payload, loadErr := loadTeamCostAccessPayload(id)
		if loadErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Cost access could not be loaded", loadErr)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(payload)
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		writeMethodNotAllowed(w, r)
		return
	}
	var body struct {
		Projects []costAccessProjectBody `json:"projects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if err := saveTeamCostAccess(id, body.Projects); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeAPIError(w, r, http.StatusBadRequest, "That project was not found.", nil)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "Cost access could not be saved", err)
		return
	}
	AppendAuditLog(&adminID, "team_cost_access", "team", strconv.Itoa(id), team.Name)
	payload, loadErr := loadTeamCostAccessPayload(id)
	if loadErr != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cost access could not be loaded", loadErr)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func loadTeamCostAccessPayload(teamID int) (map[string]any, error) {
	linkRows, err := DB.Query(`
		SELECT p.id, p.name, COALESCE(pta.cost_access, 'operate')
		  FROM project_team_access pta
		  JOIN projects p ON p.id = pta.project_id
		 WHERE pta.team_id = $1
		 ORDER BY p.name, p.id`, teamID)
	if err != nil {
		return nil, err
	}
	defer linkRows.Close()
	links := make([]map[string]any, 0)
	for linkRows.Next() {
		var projectID int
		var name, access string
		if err := linkRows.Scan(&projectID, &name, &access); err != nil {
			return nil, err
		}
		links = append(links, map[string]any{
			"project_id":  projectID,
			"name":        name,
			"cost_access": normalizeCostAccess(access),
		})
	}
	projectRows, err := DB.Query(`SELECT id, name FROM projects WHERE COALESCE(status, 'active') = 'active' ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	defer projectRows.Close()
	projects := make([]map[string]any, 0)
	for projectRows.Next() {
		var projectID int
		var name string
		if err := projectRows.Scan(&projectID, &name); err != nil {
			return nil, err
		}
		projects = append(projects, map[string]any{"id": projectID, "name": name})
	}
	return map[string]any{
		"status":   "ok",
		"links":    links,
		"projects": projects,
		"note":     "Cost view can see spend and graphs. Cost operate can enable, import, accept, or dismiss. The Cost page grant is still required.",
	}, nil
}

func saveTeamCostAccess(teamID int, projects []costAccessProjectBody) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, item := range projects {
		if item.ProjectID <= 0 {
			continue
		}
		access := normalizeCostAccess(item.CostAccess)
		var projectID int
		if err := tx.QueryRow(`SELECT id FROM projects WHERE id = $1`, item.ProjectID).Scan(&projectID); err != nil {
			return err
		}
		var existing int
		err := tx.QueryRow(`SELECT id FROM project_team_access WHERE project_id = $1 AND team_id = $2`, projectID, teamID).Scan(&existing)
		if err == sql.ErrNoRows {
			if _, err := tx.Exec(`INSERT INTO project_team_access (project_id, team_id, cost_access) VALUES ($1, $2, $3)`, projectID, teamID, access); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE project_team_access SET cost_access = $3 WHERE project_id = $1 AND team_id = $2`, projectID, teamID, access); err != nil {
			return err
		}
	}
	return tx.Commit()
}
