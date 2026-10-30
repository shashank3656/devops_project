package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var oncallWeekdays = []string{"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

var oncallTimezones = []string{
	"UTC",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"Europe/London",
	"Europe/Berlin",
	"Asia/Kolkata",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Australia/Sydney",
}

type oncallScheduleDay struct {
	Day          string `json:"day"`
	UserID       int    `json:"user_id"`
	Name         string `json:"name"`
	BackupUserID int    `json:"backup_user_id,omitempty"`
	BackupName   string `json:"backup_name,omitempty"`
}

type oncallSchedule struct {
	ID                      int                 `json:"id"`
	TeamID                  int                 `json:"team_id"`
	TeamName                string              `json:"team_name"`
	ProjectID               int                 `json:"project_id"`
	ProjectName             string              `json:"project_name"`
	Timezone                string              `json:"timezone"`
	Today                   string              `json:"today"`
	Days                    []oncallScheduleDay `json:"days"`
	HandoverRemindMinutes   int                 `json:"handover_remind_minutes"`
	HandoverEscalateMinutes int                 `json:"handover_escalate_minutes"`
	ReassignIncidentsOnAck  bool                `json:"reassign_incidents_on_ack"`
}

type oncallScheduleInput struct {
	TeamID                  int            `json:"team_id"`
	ProjectID               int            `json:"project_id"`
	Timezone                string         `json:"timezone"`
	Days                    map[string]int `json:"days"`
	BackupDays              map[string]int `json:"backup_days"`
	HandoverRemindMinutes   int            `json:"handover_remind_minutes"`
	HandoverEscalateMinutes int            `json:"handover_escalate_minutes"`
	ReassignIncidentsOnAck  bool           `json:"reassign_incidents_on_ack"`
}

func migrateOncallScheduleSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_schedules (
			id SERIAL PRIMARY KEY,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			timezone VARCHAR(80) NOT NULL,
			days TEXT NOT NULL DEFAULT '{}',
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (team_id, project_id)
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE oncall_schedules ADD COLUMN IF NOT EXISTS handover_remind_minutes INTEGER NOT NULL DEFAULT 30`)
	_, _ = DB.Exec(`ALTER TABLE oncall_schedules ADD COLUMN IF NOT EXISTS handover_escalate_minutes INTEGER NOT NULL DEFAULT 15`)
	_, _ = DB.Exec(`ALTER TABLE oncall_schedules ADD COLUMN IF NOT EXISTS reassign_incidents_on_ack BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`ALTER TABLE oncall_schedules ADD COLUMN IF NOT EXISTS backup_days TEXT NOT NULL DEFAULT '{}'`)
}

func clampHandoverMinutes(value, fallback, min, max int) int {
	if value <= 0 {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func handoverRemindMinutes(value int) int {
	return clampHandoverMinutes(value, 30, 5, 120)
}

func handoverEscalateMinutes(value int) int {
	return clampHandoverMinutes(value, 15, 5, 120)
}

func lookupOncallSchedule(teamID, projectID int) *oncallSchedule {
	if DB == nil || teamID <= 0 || projectID <= 0 {
		return nil
	}
	var id int
	var timezone, daysJSON, backupJSON string
	err := DB.QueryRow(`
		SELECT id, timezone, days, COALESCE(backup_days, '{}')
		FROM oncall_schedules
		WHERE team_id = $1 AND project_id = $2
	`, teamID, projectID).Scan(&id, &timezone, &daysJSON, &backupJSON)
	if err != nil {
		return nil
	}
	ids := []int{}
	stored := map[string]int{}
	backup := map[string]int{}
	_ = json.Unmarshal([]byte(daysJSON), &stored)
	_ = json.Unmarshal([]byte(backupJSON), &backup)
	for _, userID := range stored {
		ids = append(ids, userID)
	}
	for _, userID := range backup {
		ids = append(ids, userID)
	}
	return &oncallSchedule{
		ID:        id,
		TeamID:    teamID,
		ProjectID: projectID,
		Timezone:  timezone,
		Days:      oncallDaysFromJSON(daysJSON, backupJSON, oncallUserNames(ids)),
	}
}

func oncallScheduleHasAssignment(item *oncallSchedule) bool {
	if item == nil {
		return false
	}
	for _, day := range item.Days {
		if day.UserID > 0 {
			return true
		}
	}
	return false
}

func oncallScheduleAssignment(item *oncallSchedule, weekday time.Weekday) (int, int) {
	if item == nil {
		return 0, 0
	}
	name := strings.ToLower(weekday.String())
	for _, day := range item.Days {
		if day.Day == name {
			return day.UserID, day.BackupUserID
		}
	}
	return 0, 0
}

func oncallTimezoneAllowed(value string) bool {
	for _, zone := range oncallTimezones {
		if zone == value {
			return true
		}
	}
	return false
}

func oncallToday(timezone string) string {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	switch time.Now().In(loc).Weekday() {
	case time.Monday:
		return "monday"
	case time.Tuesday:
		return "tuesday"
	case time.Wednesday:
		return "wednesday"
	case time.Thursday:
		return "thursday"
	case time.Friday:
		return "friday"
	case time.Saturday:
		return "saturday"
	default:
		return "sunday"
	}
}

func oncallUserNames(ids []int) map[int]string {
	names := map[int]string{}
	if DB == nil || len(ids) == 0 {
		return names
	}
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	seen := map[int]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		args = append(args, id)
		placeholders = append(placeholders, "$"+strconv.Itoa(len(args)))
	}
	if len(args) == 0 {
		return names
	}
	rows, err := DB.Query(`SELECT id, username FROM users WHERE id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return names
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err == nil {
			names[id] = strings.TrimSpace(name)
		}
	}
	return names
}

func oncallDaysFromJSON(raw, backupRaw string, names map[int]string) []oncallScheduleDay {
	stored := map[string]int{}
	backup := map[string]int{}
	_ = json.Unmarshal([]byte(raw), &stored)
	_ = json.Unmarshal([]byte(backupRaw), &backup)
	days := make([]oncallScheduleDay, 0, len(oncallWeekdays))
	for _, day := range oncallWeekdays {
		userID := stored[day]
		name := ""
		if userID > 0 {
			name = names[userID]
			if name == "" {
				name = "Unknown"
			}
		}
		backupID := backup[day]
		backupName := ""
		if backupID > 0 {
			backupName = names[backupID]
			if backupName == "" {
				backupName = "Unknown"
			}
		}
		days = append(days, oncallScheduleDay{Day: day, UserID: userID, Name: name, BackupUserID: backupID, BackupName: backupName})
	}
	return days
}

func listOncallSchedules() ([]oncallSchedule, error) {
	if DB == nil {
		return []oncallSchedule{}, nil
	}
	rows, err := DB.Query(`
		SELECT s.id, s.team_id, COALESCE(t.name, ''), s.project_id, COALESCE(p.name, ''), s.timezone, s.days,
		       COALESCE(s.backup_days, '{}'),
		       COALESCE(s.handover_remind_minutes, 30), COALESCE(s.handover_escalate_minutes, 15), COALESCE(s.reassign_incidents_on_ack, FALSE)
		FROM oncall_schedules s
		LEFT JOIN teams t ON t.id = s.team_id
		LEFT JOIN projects p ON p.id = s.project_id
		ORDER BY t.name, p.name, s.id
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "oncall_schedules") {
			return []oncallSchedule{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	type rawSchedule struct {
		item   oncallSchedule
		days   string
		backup string
	}
	raw := []rawSchedule{}
	ids := []int{}
	for rows.Next() {
		var row rawSchedule
		if err := rows.Scan(&row.item.ID, &row.item.TeamID, &row.item.TeamName, &row.item.ProjectID, &row.item.ProjectName, &row.item.Timezone, &row.days, &row.backup, &row.item.HandoverRemindMinutes, &row.item.HandoverEscalateMinutes, &row.item.ReassignIncidentsOnAck); err != nil {
			return nil, err
		}
		row.item.HandoverRemindMinutes = handoverRemindMinutes(row.item.HandoverRemindMinutes)
		row.item.HandoverEscalateMinutes = handoverEscalateMinutes(row.item.HandoverEscalateMinutes)
		if row.item.TeamName == "" {
			row.item.TeamName = "Unknown"
		}
		if row.item.ProjectName == "" {
			row.item.ProjectName = "Unknown"
		}
		stored := map[string]int{}
		backup := map[string]int{}
		_ = json.Unmarshal([]byte(row.days), &stored)
		_ = json.Unmarshal([]byte(row.backup), &backup)
		for _, id := range stored {
			ids = append(ids, id)
		}
		for _, id := range backup {
			ids = append(ids, id)
		}
		raw = append(raw, row)
	}
	names := oncallUserNames(ids)
	out := make([]oncallSchedule, 0, len(raw))
	for _, row := range raw {
		row.item.Today = oncallToday(row.item.Timezone)
		row.item.Days = oncallDaysFromJSON(row.days, row.backup, names)
		out = append(out, row.item)
	}
	return out, nil
}

func getOncallSchedule(id int) (*oncallSchedule, error) {
	items, err := listOncallSchedules()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, errOncallHidden
}

func normalizeOncallDays(teamID int, days map[string]int) (string, error) {
	members, err := GetTeamMembers(teamID)
	if err != nil {
		return "", err
	}
	allowed := map[int]bool{}
	for _, member := range members {
		if member.UserID > 0 {
			allowed[member.UserID] = true
		}
	}
	clean := map[string]int{}
	for _, day := range oncallWeekdays {
		userID := days[day]
		if userID == 0 {
			clean[day] = 0
			continue
		}
		if !allowed[userID] {
			return "", errOncallInvalid
		}
		clean[day] = userID
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func requireMissionCriticalOncallCoverage(teamID, projectID int, primary, backup map[string]int) error {
	if !teamHasMissionCriticalService(teamID, projectID) {
		return nil
	}
	for _, day := range oncallWeekdays {
		if primary[day] <= 0 || backup[day] <= 0 || backup[day] == primary[day] {
			return errOncallNeedBackup
		}
	}
	return nil
}

func oncallScheduleSaveError(err error) string {
	if err == errOncallNeedBackup {
		return "Mission-critical teams need a primary and a different backup for every day. Confirm the handover reminder and overdue minutes."
	}
	return "That rotation could not be saved."
}

func saveOncallSchedule(id int, input oncallScheduleInput) (*oncallSchedule, int, error) {
	if DB == nil {
		return nil, 0, errOncallInvalid
	}
	if input.TeamID <= 0 || input.ProjectID <= 0 || !oncallTimezoneAllowed(input.Timezone) {
		return nil, 0, errOncallInvalid
	}
	remind := handoverRemindMinutes(input.HandoverRemindMinutes)
	escalate := handoverEscalateMinutes(input.HandoverEscalateMinutes)
	if _, err := GetTeamByID(input.TeamID); err != nil || input.TeamID == 0 {
		return nil, 0, errOncallInvalid
	}
	days, err := normalizeOncallDays(input.TeamID, input.Days)
	if err != nil {
		return nil, 0, err
	}
	backupDays, err := normalizeOncallDays(input.TeamID, input.BackupDays)
	if err != nil {
		return nil, 0, err
	}
	if err := requireMissionCriticalOncallCoverage(input.TeamID, input.ProjectID, input.Days, input.BackupDays); err != nil {
		return nil, 0, err
	}
	var existingID int
	err = DB.QueryRow(`SELECT id FROM oncall_schedules WHERE team_id = $1 AND project_id = $2`, input.TeamID, input.ProjectID).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, 0, err
	}
	if existingID > 0 && existingID != id {
		return nil, existingID, errOncallInvalid
	}
	if id > 0 {
		result, err := DB.Exec(`
			UPDATE oncall_schedules
			SET team_id = $2, project_id = $3, timezone = $4, days = $5, backup_days = $6, handover_remind_minutes = $7, handover_escalate_minutes = $8, reassign_incidents_on_ack = $9, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, id, input.TeamID, input.ProjectID, input.Timezone, days, backupDays, remind, escalate, input.ReassignIncidentsOnAck)
		if err != nil {
			return nil, 0, err
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			return nil, 0, errOncallHidden
		}
		item, err := getOncallSchedule(id)
		return item, 0, err
	}
	var created int
	if err := DB.QueryRow(`
		INSERT INTO oncall_schedules (team_id, project_id, timezone, days, backup_days, handover_remind_minutes, handover_escalate_minutes, reassign_incidents_on_ack)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, input.TeamID, input.ProjectID, input.Timezone, days, backupDays, remind, escalate, input.ReassignIncidentsOnAck).Scan(&created); err != nil {
		return nil, existingID, err
	}
	item, err := getOncallSchedule(created)
	return item, 0, err
}

func oncallScheduleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	switch r.Method {
	case "GET":
		items, err := listOncallSchedules()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load on-call schedules", err)
			return
		}
		if items == nil {
			items = []oncallSchedule{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"schedules": items, "timezones": oncallTimezones, "status": "ok"})
	case "POST":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body oncallScheduleInput
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, existingID, err := saveOncallSchedule(0, body)
		if err != nil {
			status := http.StatusBadRequest
			if existingID > 0 {
				status = http.StatusConflict
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": oncallScheduleSaveError(err), "schedule_id": existingID, "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"schedule": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func oncallScheduleDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	id, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/oncall/schedules/"), "/"))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid schedule id", err)
		return
	}
	switch r.Method {
	case "GET":
		item, err := getOncallSchedule(id)
		if err != nil || item == nil {
			writeAPIError(w, r, http.StatusNotFound, "schedule not found", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"schedule": item, "timezones": oncallTimezones, "status": "ok"})
	case "PATCH":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body oncallScheduleInput
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, existingID, err := saveOncallSchedule(id, body)
		if err != nil {
			status := http.StatusBadRequest
			if err == errOncallHidden {
				status = http.StatusNotFound
			}
			if existingID > 0 {
				status = http.StatusConflict
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": oncallScheduleSaveError(err), "schedule_id": existingID, "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"schedule": item, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func oncallTeamMembersHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	teamID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("team_id")))
	if teamID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "team is required", nil)
		return
	}
	members, err := GetTeamMembers(teamID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load team members", err)
		return
	}
	out := make([]map[string]any, 0, len(members))
	for _, member := range members {
		name := strings.TrimSpace(member.Username)
		if name == "" {
			name = "Unknown"
		}
		out = append(out, map[string]any{"user_id": member.UserID, "name": name})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"members": out, "status": "ok"})
}
