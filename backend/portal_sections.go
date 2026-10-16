package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type sectionGrants struct {
	Requests       bool            `json:"requests"`
	Daily          bool            `json:"daily"`
	Operations     bool            `json:"operations"`
	Infrastructure bool            `json:"infrastructure"`
	Security       bool            `json:"security"`
	Records        bool            `json:"records"`
	PortalAccess   bool            `json:"portalAccess"`
	Manager        bool            `json:"manager"`
	Pages          map[string]bool `json:"pages,omitempty"`
}

func allSectionGrants() sectionGrants {
	return sectionGrants{
		Requests: true, Daily: true, Operations: true, Infrastructure: true,
		Security: true, Records: true, PortalAccess: true, Manager: true,
	}
}

func defaultSectionGrants(teamType string) sectionGrants {
	if strings.TrimSpace(teamType) == "devops" {
		return sectionGrants{Daily: true, Operations: true, Infrastructure: true, Security: true}
	}
	return sectionGrants{Requests: true}
}

func fallbackSectionGrants(user *User) sectionGrants {
	if user == nil {
		return sectionGrants{}
	}
	if user.Role == "admin" {
		return allSectionGrants()
	}
	if user.UserType == "devops_user" {
		grants := defaultSectionGrants("devops")
		if DB != nil {
			if prof, err := GetDevopsProfile(user.ID); err == nil && prof != nil && prof.IsManager {
				grants.Records = true
				grants.Manager = true
			}
		}
		return grants
	}
	return defaultSectionGrants("portal")
}

func (g sectionGrants) merge(other sectionGrants) sectionGrants {
	g.Requests = g.Requests || other.Requests
	g.Daily = g.Daily || other.Daily
	g.Operations = g.Operations || other.Operations
	g.Infrastructure = g.Infrastructure || other.Infrastructure
	g.Security = g.Security || other.Security
	g.Records = g.Records || other.Records
	g.PortalAccess = g.PortalAccess || other.PortalAccess
	g.Manager = g.Manager || other.Manager
	if g.Pages == nil || other.Pages == nil {
		g.Pages = nil
		return g
	}
	pages := make(map[string]bool, len(g.Pages)+len(other.Pages))
	for key, allowed := range g.Pages {
		if allowed {
			pages[key] = true
		}
	}
	for key, allowed := range other.Pages {
		if allowed {
			pages[key] = true
		}
	}
	g.Pages = pages
	return g
}

func (g sectionGrants) allowsPage(page string) bool {
	if page == "" || g.Pages == nil {
		return true
	}
	return g.Pages[page]
}

func pageForPath(path string) string {
	path = strings.Split(path, "?")[0]
	switch {
	case strings.HasPrefix(path, "/api/devops/iam"):
		return "iam"
	case strings.HasPrefix(path, "/api/devops/k8s"):
		return "kubernetes"
	case strings.HasPrefix(path, "/api/devops/projects"), strings.HasPrefix(path, "/api/devops/project-"):
		return "projects"
	case strings.HasPrefix(path, "/api/devops/promotions"), strings.HasPrefix(path, "/api/deployments/"):
		return "releases"
	case path == "/api/devops/environment-catalog":
		return "environments"
	case strings.HasPrefix(path, "/api/devops/cloud/accounts"):
		return "cloud-accounts"
	case strings.HasPrefix(path, "/api/devops/cloud/"):
		return "cloud-inventory"
	default:
		return ""
	}
}

func (g sectionGrants) allows(section string) bool {
	switch section {
	case "", "session":
		return true
	case "portal":
		return g.PortalAccess
	case "requests":
		return g.Requests
	case "daily":
		return g.Daily
	case "operations":
		return g.Operations
	case "infrastructure":
		return g.Infrastructure
	case "security":
		return g.Security
	case "records":
		return g.Records
	case "requests-or-daily":
		return g.Requests || g.Daily
	case "catalog":
		return g.Daily || g.Infrastructure
	case "projects":
		return g.Daily || g.Infrastructure || g.Security
	case "sre":
		return g.Daily || g.Operations
	case "desk-or-requests":
		return g.Daily || g.Requests
	default:
		return false
	}
}

func (g sectionGrants) opensDevopsAPI() bool {
	return g.PortalAccess || g.Daily || g.Operations || g.Infrastructure || g.Security || g.Records
}

func sectionForPath(path string) string {
	path = strings.Split(path, "?")[0]
	if strings.Contains(path, "/webhook") || path == "/api/deployments/callbacks" || strings.HasPrefix(path, "/api/deployments/callbacks/") {
		return ""
	}
	switch {
	case strings.HasPrefix(path, "/api/webhooks/"),
		strings.HasPrefix(path, "/api/auth/"),
		strings.HasPrefix(path, "/api/public/"),
		path == "/api/devops/me",
		path == "/api/me",
		strings.HasPrefix(path, "/api/me/api-keys"),
		strings.HasPrefix(path, "/api/me/notifications"),
		strings.HasPrefix(path, "/api/me/notification-preferences"),
		path == "/api/me/2fa",
		path == "/api/change-password",
		path == "/health",
		path == "/ready":
		return ""
	case strings.HasPrefix(path, "/api/admin/"), strings.HasPrefix(path, "/api/users/"):
		return "portal"
	case path == "/api/request" || strings.HasPrefix(path, "/api/request/"):
		return "requests-or-daily"
	case strings.HasPrefix(path, "/api/history"),
		strings.HasPrefix(path, "/api/golden-paths"),
		strings.HasPrefix(path, "/api/me/projects"),
		strings.HasPrefix(path, "/api/me/managed-teams"),
		strings.HasPrefix(path, "/api/me/teams"),
		strings.HasPrefix(path, "/api/me/saved-configs"),
		strings.HasPrefix(path, "/api/me/workspace"),
		strings.HasPrefix(path, "/api/me/pending-manager-approval"),
		path == "/api/cost-guardrail",
		path == "/api/cost-estimate":
		return "requests"
	case strings.HasPrefix(path, "/api/me/incidents"), strings.HasPrefix(path, "/api/me/changes"):
		return "desk-or-requests"
	case strings.HasPrefix(path, "/api/oncall/"),
		strings.HasPrefix(path, "/api/devops/oncall"),
		strings.HasPrefix(path, "/api/maintenance/"),
		strings.HasPrefix(path, "/api/devops/freezes"),
		strings.HasPrefix(path, "/api/devops/runbooks"),
		strings.HasPrefix(path, "/api/devops/notification-settings"),
		strings.HasPrefix(path, "/api/devops/approval-notification-analytics"),
		strings.HasPrefix(path, "/api/devops/inbound-sources"),
		strings.HasPrefix(path, "/api/reports/"):
		return "operations"
	case strings.HasPrefix(path, "/api/devops/projects"):
		return "projects"
	case path == "/api/devops/environment-catalog":
		return "catalog"
	case strings.HasPrefix(path, "/api/devops/iam"),
		strings.HasPrefix(path, "/api/devops/cloud/"),
		strings.HasPrefix(path, "/api/devops/k8s"),
		strings.HasPrefix(path, "/api/devops/project-"),
		strings.HasPrefix(path, "/api/devops/promotions"),
		strings.HasPrefix(path, "/api/approvals/"),
		strings.HasPrefix(path, "/api/deployments/"):
		return "infrastructure"
	case strings.HasPrefix(path, "/api/devops/credential-audit"),
		strings.HasPrefix(path, "/api/devops/expiry-tracker/"),
		strings.HasPrefix(path, "/api/scans/"),
		strings.HasPrefix(path, "/api/findings"),
		strings.HasPrefix(path, "/api/security/"),
		strings.HasPrefix(path, "/api/remediation/"),
		strings.HasPrefix(path, "/api/connections"),
		strings.HasPrefix(path, "/api/artifacts/"):
		return "security"
	case strings.HasPrefix(path, "/api/sre/"):
		return "sre"
	case strings.HasPrefix(path, "/api/devops/previews"),
		strings.HasPrefix(path, "/api/devops/scorecards"),
		strings.HasPrefix(path, "/api/devops/evidence"),
		strings.HasPrefix(path, "/api/devops/templates"),
		strings.HasPrefix(path, "/api/templates"):
		return "records"
	case strings.HasPrefix(path, "/api/devops/incidents"),
		strings.HasPrefix(path, "/api/devops/changes"),
		strings.HasPrefix(path, "/api/devops/services"),
		strings.HasPrefix(path, "/api/devops/tickets"),
		strings.HasPrefix(path, "/api/devops/dashboard"),
		strings.HasPrefix(path, "/api/devops/requests"),
		strings.HasPrefix(path, "/api/devops/slos"),
		strings.HasPrefix(path, "/api/devops/workspace"),
		strings.HasPrefix(path, "/api/changes"):
		return "daily"
	default:
		return ""
	}
}

func sectionGrantsForUser(user *User) sectionGrants {
	if user == nil {
		return sectionGrants{}
	}
	if user.Role == "admin" {
		return allSectionGrants()
	}
	if DB == nil {
		return fallbackSectionGrants(user)
	}
	rows, err := DB.Query(`
		SELECT COALESCE(t.team_type,'portal'), t.section_grants
		FROM team_members m
		JOIN teams t ON t.id = m.team_id
		WHERE m.user_id = $1
	`, user.ID)
	if err != nil {
		return fallbackSectionGrants(user)
	}
	defer rows.Close()
	manager := false
	if user.UserType == "devops_user" {
		if prof, profErr := GetDevopsProfile(user.ID); profErr == nil && prof != nil && prof.IsManager {
			manager = true
		}
	}
	combined := sectionGrants{}
	found := false
	for rows.Next() {
		var teamType string
		var raw sql.NullString
		if err := rows.Scan(&teamType, &raw); err != nil {
			continue
		}
		found = true
		combined = combined.merge(grantsFromTeam(teamType, raw, manager))
	}
	if !found {
		return fallbackSectionGrants(user)
	}
	combined.Manager = manager
	return combined
}

func grantsFromTeam(teamType string, raw sql.NullString, manager bool) sectionGrants {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		grants := defaultSectionGrants(teamType)
		if manager && teamType == "devops" {
			grants.Records = true
		}
		return grants
	}
	var saved sectionGrants
	if err := json.Unmarshal([]byte(raw.String), &saved); err != nil {
		return defaultSectionGrants(teamType)
	}
	saved.PortalAccess = false
	saved.Manager = false
	return saved
}

func parseSectionGrantBody(body []byte) (sectionGrants, error) {
	var saved sectionGrants
	if err := json.Unmarshal(body, &saved); err != nil {
		return sectionGrants{}, err
	}
	saved.PortalAccess = false
	saved.Manager = false
	return saved, nil
}

func loadSavedSectionGrants() (map[int]sectionGrants, error) {
	out := map[int]sectionGrants{}
	if DB == nil {
		return out, nil
	}
	rows, err := DB.Query(`SELECT id, section_grants FROM teams`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var raw sql.NullString
		if err := rows.Scan(&id, &raw); err != nil {
			continue
		}
		if !raw.Valid || strings.TrimSpace(raw.String) == "" {
			continue
		}
		var saved sectionGrants
		if err := json.Unmarshal([]byte(raw.String), &saved); err != nil {
			continue
		}
		saved.PortalAccess = false
		saved.Manager = false
		out[id] = saved
	}
	return out, nil
}

func saveTeamSectionGrants(teamID int, grants sectionGrants) error {
	grants.PortalAccess = false
	grants.Manager = false
	payload, err := json.Marshal(grants)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`UPDATE teams SET section_grants = $2 WHERE id = $1`, teamID, string(payload))
	return err
}

func migrateSectionGrantsSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS section_grants TEXT`)
}

func withSectionGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		section := sectionForPath(r.URL.Path)
		if section == "" {
			next.ServeHTTP(w, r)
			return
		}
		if section == "portal" && strings.TrimSpace(r.Header.Get("X-Admin-Secret")) != "" {
			next.ServeHTTP(w, r)
			return
		}
		authHeader := r.Header.Get("Authorization")
		if len(authHeader) < 8 || !strings.HasPrefix(authHeader, "Bearer ") {
			next.ServeHTTP(w, r)
			return
		}
		userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
		if err != nil || userID <= 0 || DB == nil {
			next.ServeHTTP(w, r)
			return
		}
		user, err := GetUserByID(userID)
		if err != nil || user == nil {
			next.ServeHTTP(w, r)
			return
		}
		grants := sectionGrantsForUser(user)
		if !grants.allows(section) || !grants.allowsPage(pageForPath(r.URL.Path)) {
			writeAPIError(w, r, http.StatusForbidden, "This section is not included for your group.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func adminTeamGrantsHandler(w http.ResponseWriter, r *http.Request) {
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
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		saved, loadErr := loadSavedSectionGrants()
		if loadErr != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "section access could not be loaded", loadErr)
			return
		}
		grants, custom := saved[id]
		if !custom {
			grants = defaultSectionGrants(team.TeamType)
		}
		encodeAdminTeamJSON(w, map[string]interface{}{"grants": grants, "grants_saved": custom, "status": "ok"})
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		writeMethodNotAllowed(w, r)
		return
	}
	var body json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	grants, err := parseSectionGrantBody(body)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if err := saveTeamSectionGrants(id, grants); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "section access could not be saved", err)
		return
	}
	AppendAuditLog(&adminID, "team_grants_update", "team", strconv.Itoa(id), team.Name)
	encodeAdminTeamJSON(w, map[string]interface{}{"grants": grants, "grants_saved": true, "status": "ok"})
}

func meTicketAudienceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) < 8 || !strings.HasPrefix(authHeader, "Bearer ") {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid token", nil)
		return
	}
	scope := "own"
	names := []string{}
	if user.Username != "" {
		names = append(names, user.Username)
	}
	if user.Role == "admin" || user.UserType == "devops_user" {
		scope = "all"
		names = []string{}
	} else if DB != nil {
		if ids, memberErr := GetTeamMemberUserIDsForManager(userID); memberErr == nil && len(ids) > 1 {
			scope = "team"
			if mapped, nameErr := GetUsernamesByUserIDs(ids); nameErr == nil {
				names = []string{}
				for _, name := range mapped {
					if name != "" {
						names = append(names, name)
					}
				}
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"scope": scope, "usernames": names, "status": "ok"})
}
