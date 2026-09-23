package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type oncallRotation struct {
	ID       int       `json:"id"`
	TeamID   *int      `json:"team_id,omitempty"`
	TeamName string    `json:"team_name,omitempty"`
	UserID   int       `json:"user_id"`
	Username string    `json:"username,omitempty"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Active   bool      `json:"active"`
}

type deploymentFreeze struct {
	ID          int       `json:"id"`
	ProjectID   *int      `json:"project_id,omitempty"`
	ProjectName string    `json:"project_name,omitempty"`
	Environment string    `json:"environment"`
	Reason      string    `json:"reason"`
	StartsAt    time.Time `json:"starts_at"`
	EndsAt      time.Time `json:"ends_at"`
	Active      bool      `json:"active"`
}

func devopsOncallHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "rotations": listOncallRotations()})
	case http.MethodPost:
		var body struct {
			TeamID   *int   `json:"team_id"`
			UserID   int    `json:"user_id"`
			StartsAt string `json:"starts_at"`
			EndsAt   string `json:"ends_at"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.UserID <= 0 {
			body.UserID = userID
		}
		starts, ends := parseTimeWindow(body.StartsAt, body.EndsAt, 8*time.Hour)
		if err := insertOncallRotation(body.TeamID, body.UserID, starts, ends); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save on-call", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
	}
}

func devopsFreezesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "freezes": listDeploymentFreezes(), "active_reason": activeFreezeReason()})
	case http.MethodPost:
		var body struct {
			ProjectID   *int   `json:"project_id"`
			Environment string `json:"environment"`
			Reason      string `json:"reason"`
			StartsAt    string `json:"starts_at"`
			EndsAt      string `json:"ends_at"`
			Action      string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if strings.EqualFold(strings.TrimSpace(body.Action), "clear") {
			clearActiveFreezes()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
			return
		}
		if strings.TrimSpace(body.Environment) == "" {
			body.Environment = "prod"
		}
		if strings.TrimSpace(body.Reason) == "" {
			body.Reason = "Production freeze"
		}
		starts, ends := parseTimeWindow(body.StartsAt, body.EndsAt, 24*time.Hour)
		if err := insertDeploymentFreeze(body.ProjectID, body.Environment, body.Reason, starts, ends, userID); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save freeze", err)
			return
		}
		SendSlackNotification("🧊 Production freeze started: "+body.Reason, nil)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
	}
}

func slackCommandsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	if err := r.ParseForm(); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid form", err)
		return
	}
	if !chatOpsAuthorized(r) {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	text := strings.TrimSpace(r.FormValue("text"))
	if text == "" {
		raw, _ := io.ReadAll(r.Body)
		var body struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(raw, &body)
		text = strings.TrimSpace(body.Text)
	}
	reply := runChatOpsCommand(text)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"response_type": "ephemeral",
		"text":          reply,
	})
}

func teamsCommandsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost)
		return
	}
	if !chatOpsAuthorized(r) {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		Text    string `json:"text"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		text = strings.TrimSpace(body.Message)
	}
	reply := runChatOpsCommand(text)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "text": reply})
}

func runChatOpsCommand(text string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(text)))
	if len(fields) == 0 {
		return "Commands: ack INC0000001, freeze prod <reason>, unfreeze, approve <request-id> <note>, oncall, impact <request-id>, rollback <request-id>"
	}
	switch fields[0] {
	case "ack", "acknowledge":
		if len(fields) < 2 {
			return "Usage: ack INC0000001"
		}
		return acknowledgeIncidentByRef(fields[1])
	case "freeze":
		reason := "ChatOps freeze"
		if len(fields) > 2 {
			reason = strings.Join(fields[2:], " ")
		}
		_ = insertDeploymentFreeze(nil, "prod", reason, time.Now(), time.Now().Add(24*time.Hour), 0)
		SendSlackNotification("🧊 Production freeze started: "+reason, nil)
		return "Production freeze started: " + reason
	case "unfreeze":
		clearActiveFreezes()
		return "Production freeze cleared."
	case "approve":
		if len(fields) < 2 {
			return "Usage: approve <request-id> <note>"
		}
		return chatOpsApproveGate(fields)
	case "oncall":
		return currentOncallSummary()
	case "impact":
		if len(fields) < 2 {
			return "Usage: impact <request-id>"
		}
		id := atoiDefault(fields[1], 0)
		req, _ := GetPRRequestByID(id)
		if req == nil {
			return "Request not found."
		}
		brief := loadOrBuildPRImpact(req)
		return fmt.Sprintf("Request #%d is %s risk (%d/100). %s", req.ID, brief.RiskLevel, brief.Score, brief.RecommendedAction)
	case "rollback":
		if len(fields) < 2 {
			return "Usage: rollback <request-id>. Open the rollback console to choose a revision; ChatOps will not apply it automatically."
		}
		return "Rollback requested for request #" + fields[1] + ". Open the DevOps rollback console to choose a revision. ChatOps will not apply rollback automatically."
	default:
		return "Commands: ack INC0000001, freeze prod <reason>, unfreeze, approve <request-id> <note>, oncall, impact <request-id>, rollback <request-id>"
	}
}

func chatOpsApproveGate(fields []string) string {
	id := atoiDefault(fields[1], 0)
	if id <= 0 {
		return "Usage: approve <request-id> <note>"
	}
	note := "ChatOps approval"
	if len(fields) > 2 {
		note = strings.Join(fields[2:], " ")
	}
	userID := currentOncallUserID()
	if userID == 0 {
		return "No active on-call user to record this approval. Set an on-call rotation first."
	}
	_, gate, err := approvePromotionGateAsDevops(id, userID, note, 24)
	if err != nil {
		return err.Error()
	}
	if gate != nil && gate.Status == "blocked" {
		return "Promotion is still blocked by deployment gate policy."
	}
	return fmt.Sprintf("Gate approved for request #%d.", id)
}

func chatOpsAuthorized(r *http.Request) bool {
	secret := strings.TrimSpace(os.Getenv("CHATOPS_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("CI_WEBHOOK_SECRET"))
	}
	if secret == "" {
		return true
	}
	got := strings.TrimSpace(r.Header.Get("X-ChatOps-Secret"))
	if got == "" {
		got = strings.TrimSpace(r.FormValue("token"))
	}
	return got == secret
}

func currentOncallUserID() int {
	for _, rotation := range listOncallRotations() {
		if rotation.Active {
			return rotation.UserID
		}
	}
	return 0
}

func clearActiveFreezes() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`UPDATE deployment_freezes SET ends_at = NOW() WHERE ends_at > NOW()`)
}

func acknowledgeIncidentByRef(ref string) string {
	if DB == nil {
		return "Database unavailable."
	}
	ref = strings.ToUpper(strings.TrimSpace(ref))
	res, err := DB.Exec(`
		UPDATE request_incidents
		SET status = 'acknowledged', updated_at = CURRENT_TIMESTAMP
		WHERE UPPER(COALESCE(incident_number, '')) = $1
		   OR CAST(id AS TEXT) = $2
	`, ref, strings.TrimPrefix(strings.ToLower(ref), "inc"))
	if err != nil {
		return "Could not acknowledge that incident."
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return "Incident not found."
	}
	return "Incident " + ref + " acknowledged."
}

func currentOncallSummary() string {
	rotations := listOncallRotations()
	for _, rotation := range rotations {
		if rotation.Active {
			name := rotation.Username
			if name == "" {
				name = fmt.Sprintf("user %d", rotation.UserID)
			}
			return name + " is on call now."
		}
	}
	return "No active on-call rotation."
}

func listOncallRotations() []oncallRotation {
	out := []oncallRotation{}
	if DB == nil {
		return out
	}
	rows, err := DB.Query(`
		SELECT r.id, r.team_id, COALESCE(t.name, ''), r.user_id, COALESCE(u.username, ''), r.starts_at, r.ends_at
		FROM oncall_rotations r
		LEFT JOIN teams t ON t.id = r.team_id
		LEFT JOIN users u ON u.id = r.user_id
		ORDER BY r.starts_at DESC
		LIMIT 20
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var item oncallRotation
		var teamID *int
		if err := rows.Scan(&item.ID, &teamID, &item.TeamName, &item.UserID, &item.Username, &item.StartsAt, &item.EndsAt); err != nil {
			continue
		}
		item.TeamID = teamID
		item.Active = !now.Before(item.StartsAt) && !now.After(item.EndsAt)
		out = append(out, item)
	}
	return out
}

func listDeploymentFreezes() []deploymentFreeze {
	out := []deploymentFreeze{}
	if DB == nil {
		return out
	}
	rows, err := DB.Query(`
		SELECT f.id, f.project_id, COALESCE(p.name, ''), f.environment, f.reason, f.starts_at, f.ends_at
		FROM deployment_freezes f
		LEFT JOIN projects p ON p.id = f.project_id
		ORDER BY f.starts_at DESC
		LIMIT 20
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var item deploymentFreeze
		var projectID *int
		if err := rows.Scan(&item.ID, &projectID, &item.ProjectName, &item.Environment, &item.Reason, &item.StartsAt, &item.EndsAt); err != nil {
			continue
		}
		item.ProjectID = projectID
		item.Active = !now.Before(item.StartsAt) && !now.After(item.EndsAt)
		out = append(out, item)
	}
	return out
}

func insertOncallRotation(teamID *int, userID int, starts, ends time.Time) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`
		INSERT INTO oncall_rotations (team_id, user_id, starts_at, ends_at)
		VALUES ($1, $2, $3, $4)
	`, teamID, userID, starts, ends)
	return err
}

func insertDeploymentFreeze(projectID *int, env, reason string, starts, ends time.Time, createdBy int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	var created interface{}
	if createdBy > 0 {
		created = createdBy
	}
	_, err := DB.Exec(`
		INSERT INTO deployment_freezes (project_id, environment, reason, starts_at, ends_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, projectID, env, reason, starts, ends, created)
	return err
}

func parseTimeWindow(startRaw, endRaw string, fallback time.Duration) (time.Time, time.Time) {
	starts := time.Now()
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(startRaw)); err == nil {
		starts = parsed
	}
	ends := starts.Add(fallback)
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(endRaw)); err == nil {
		ends = parsed
	}
	return starts, ends
}
