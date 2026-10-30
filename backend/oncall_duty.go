package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type oncallDutyDay struct {
	Date         string `json:"date"`
	Label        string `json:"label"`
	Weekday      string `json:"weekday"`
	UserID       int    `json:"user_id"`
	Name         string `json:"name"`
	BackupUserID int    `json:"backup_user_id,omitempty"`
	BackupName   string `json:"backup_name,omitempty"`
	Today        bool   `json:"today"`
	Status       string `json:"status"`
	RequestID    int    `json:"request_id,omitempty"`
	CoverUser    int    `json:"cover_user_id,omitempty"`
	CoverName    string `json:"cover_name,omitempty"`
	FromUserID   int    `json:"from_user_id,omitempty"`
	FromName     string `json:"from_name,omitempty"`
	CoverEnd     string `json:"cover_end_date,omitempty"`
}

type oncallDutyPerson struct {
	UserID int    `json:"user_id"`
	Name   string `json:"name"`
}

func migrateOncallDutySchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_oncall (
			project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
			enabled BOOLEAN NOT NULL DEFAULT FALSE,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_roster (
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			position INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (team_id, user_id)
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE project_oncall ADD COLUMN IF NOT EXISTS teams_set BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS project_oncall_teams (
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			PRIMARY KEY (project_id, team_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_cover_requests (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
			cover_date DATE NOT NULL,
			from_user_id INTEGER NOT NULL,
			to_user_id INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE oncall_cover_requests ADD COLUMN IF NOT EXISTS cover_end_date DATE`)
	_, _ = DB.Exec(`UPDATE oncall_cover_requests SET cover_end_date = cover_date WHERE cover_end_date IS NULL`)
}

func setProjectOncall(projectID int, enabled bool) {
	if DB == nil || projectID <= 0 {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO project_oncall (project_id, enabled)
		VALUES ($1, $2)
		ON CONFLICT (project_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP
	`, projectID, enabled)
}

func oncallRosterUser(roster []int, day int) int {
	if len(roster) == 0 || day < 1 {
		return 0
	}
	return roster[(day-1)%len(roster)]
}

func oncallRosterBackup(roster []int, day int) int {
	if len(roster) < 2 || day < 1 {
		return 0
	}
	primary := oncallRosterUser(roster, day)
	backup := oncallRosterUser(roster, day+1)
	if backup == primary {
		return 0
	}
	return backup
}

func teamHasMissionCriticalService(teamID, projectID int) bool {
	if DB == nil || teamID <= 0 {
		return false
	}
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil {
		return false
	}
	items, err := listServiceMap(projectID, "", "")
	if err != nil {
		return false
	}
	name := strings.TrimSpace(team.Name)
	slug := strings.TrimSpace(team.Slug)
	for _, item := range items {
		if normalizeServiceCriticality(item.Criticality) != serviceClassMissionCritical {
			continue
		}
		mapped := strings.TrimSpace(item.Team)
		if mapped == "" {
			continue
		}
		if strings.EqualFold(mapped, name) || (slug != "" && strings.EqualFold(mapped, slug)) {
			return true
		}
	}
	return false
}

func oncallKnownName(names map[int]string, userID int) string {
	name := strings.TrimSpace(names[userID])
	if name == "" {
		return "Unknown"
	}
	return name
}

func listOncallRoster(teamID int) ([]int, error) {
	rows, err := DB.Query(`SELECT user_id FROM oncall_roster WHERE team_id = $1 ORDER BY position, user_id`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if id > 0 {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

func teamMemberIDs(teamID int) (map[int]bool, error) {
	members, err := GetTeamMembers(teamID)
	if err != nil {
		return nil, err
	}
	allowed := map[int]bool{}
	for _, member := range members {
		if member.UserID > 0 {
			allowed[member.UserID] = true
		}
	}
	return allowed, nil
}

func canSaveOncallRoster(userID, teamID int) bool {
	if userID <= 0 || teamID <= 0 {
		return false
	}
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil {
		return false
	}
	if user, userErr := GetUserByID(userID); userErr == nil && user != nil && user.Role == "admin" {
		return true
	}
	if prof, profErr := GetDevopsProfile(userID); profErr == nil && prof != nil && prof.IsManager {
		return true
	}
	return CanUserManageDevopsTeam(userID, teamID)
}

func saveOncallRoster(teamID int, userIDs []int) ([]int, error) {
	if DB == nil || teamID <= 0 {
		return nil, errOncallInvalid
	}
	allowed, err := teamMemberIDs(teamID)
	if err != nil || len(allowed) == 0 {
		return nil, errOncallInvalid
	}
	clean := make([]int, 0, len(userIDs))
	seen := map[int]bool{}
	for _, id := range userIDs {
		if id <= 0 || seen[id] || !allowed[id] {
			continue
		}
		seen[id] = true
		clean = append(clean, id)
	}
	if len(clean) == 0 {
		return nil, errOncallInvalid
	}
	if teamHasMissionCriticalService(teamID, 0) && len(clean) < 2 {
		return nil, errOncallNeedBackup
	}
	tx, err := DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM oncall_roster WHERE team_id = $1`, teamID); err != nil {
		return nil, err
	}
	for index, id := range clean {
		if _, err := tx.Exec(`INSERT INTO oncall_roster (team_id, user_id, position) VALUES ($1, $2, $3)`, teamID, id, index); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return clean, nil
}

type oncallCoverRow struct {
	ID         int
	Date       string
	EndDate    string
	FromUserID int
	ToUserID   int
	Status     string
	CreatedAt  string
}

func oncallCoverCoversDate(row oncallCoverRow, date string) bool {
	if date == "" || row.Date == "" {
		return false
	}
	end := row.EndDate
	if end == "" {
		end = row.Date
	}
	return row.Date <= date && date <= end
}

func listOncallCovers(projectID, teamID int, start, end time.Time) ([]oncallCoverRow, error) {
	rows, err := DB.Query(`
		SELECT id, to_char(cover_date, 'YYYY-MM-DD'), to_char(COALESCE(cover_end_date, cover_date), 'YYYY-MM-DD'),
		       from_user_id, to_user_id, status, COALESCE(to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
		FROM oncall_cover_requests
		WHERE project_id = $1 AND team_id = $2
		  AND cover_date < $4
		  AND COALESCE(cover_end_date, cover_date) >= $3
		ORDER BY id
	`, projectID, teamID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []oncallCoverRow{}
	for rows.Next() {
		var row oncallCoverRow
		if err := rows.Scan(&row.ID, &row.Date, &row.EndDate, &row.FromUserID, &row.ToUserID, &row.Status, &row.CreatedAt); err != nil {
			return nil, err
		}
		if row.EndDate == "" {
			row.EndDate = row.Date
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func buildOncallDays(projectID, teamID int, monthValue, timezone string) ([]oncallDutyDay, []oncallDutyPerson, string, error) {
	if !oncallTimezoneAllowed(timezone) {
		return nil, nil, "", errOncallInvalid
	}
	parsed, err := time.Parse("2006-01", monthValue)
	if err != nil {
		return nil, nil, "", errOncallInvalid
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	start := time.Date(parsed.Year(), parsed.Month(), 1, 12, 0, 0, 0, loc)
	end := start.AddDate(0, 1, 0)
	roster, err := listOncallRoster(teamID)
	if err != nil {
		return nil, nil, "", err
	}
	covers, err := listOncallCovers(projectID, teamID, start, end)
	if err != nil {
		return nil, nil, "", err
	}
	ids := append([]int{}, roster...)
	for _, cover := range covers {
		ids = append(ids, cover.FromUserID, cover.ToUserID)
	}
	names := oncallUserNames(ids)
	people := make([]oncallDutyPerson, 0, len(roster))
	for _, id := range roster {
		people = append(people, oncallDutyPerson{UserID: id, Name: oncallKnownName(names, id)})
	}
	weekly := lookupOncallSchedule(teamID, projectID)
	useWeekly := weekly != nil && oncallScheduleHasAssignment(weekly)
	if useWeekly {
		seen := map[int]bool{}
		for _, person := range people {
			seen[person.UserID] = true
		}
		for _, day := range weekly.Days {
			ids = append(ids, day.UserID, day.BackupUserID)
		}
		names = oncallUserNames(ids)
		for _, day := range weekly.Days {
			for _, id := range []int{day.UserID, day.BackupUserID} {
				if id <= 0 || seen[id] {
					continue
				}
				seen[id] = true
				people = append(people, oncallDutyPerson{UserID: id, Name: oncallKnownName(names, id)})
			}
		}
	}
	today := time.Now().In(loc).Format("2006-01-02")
	days := []oncallDutyDay{}
	for cursor := start; cursor.Before(end); cursor = cursor.AddDate(0, 0, 1) {
		key := cursor.Format("2006-01-02")
		userID := oncallRosterUser(roster, cursor.Day())
		backupID := oncallRosterBackup(roster, cursor.Day())
		if useWeekly {
			userID, backupID = oncallScheduleAssignment(weekly, cursor.Weekday())
		}
		status := "scheduled"
		fromID := userID
		requestID := 0
		coverID := 0
		coverEnd := ""
		for _, row := range covers {
			if row.Status == "approved" && oncallCoverCoversDate(row, key) {
				fromID = row.FromUserID
				userID = row.ToUserID
				status = "covered"
				requestID = row.ID
				coverEnd = row.EndDate
			}
		}
		for _, row := range covers {
			if row.Status == "pending" && oncallCoverCoversDate(row, key) {
				status = "pending"
				requestID = row.ID
				coverID = row.ToUserID
				fromID = row.FromUserID
				userID = row.FromUserID
				coverEnd = row.EndDate
			}
		}
		backupName := ""
		if backupID > 0 {
			backupName = oncallKnownName(names, backupID)
		}
		days = append(days, oncallDutyDay{
			Date:         key,
			Label:        cursor.Format("2 Jan"),
			Weekday:      cursor.Weekday().String(),
			UserID:       userID,
			Name:         oncallKnownName(names, userID),
			BackupUserID: backupID,
			BackupName:   backupName,
			Today:        key == today,
			Status:       status,
			RequestID:    requestID,
			CoverUser:    coverID,
			CoverName:    oncallKnownName(names, coverID),
			FromUserID:   fromID,
			FromName:     oncallKnownName(names, fromID),
			CoverEnd:     coverEnd,
		})
	}
	return days, people, today, nil
}

type oncallProjectTeam struct {
	ID   int
	Name string
}

type oncallDutyShift struct {
	TeamID       int    `json:"team_id"`
	TeamName     string `json:"team_name"`
	UserID       int    `json:"user_id"`
	Name         string `json:"name"`
	BackupUserID int    `json:"backup_user_id,omitempty"`
	BackupName   string `json:"backup_name,omitempty"`
	Status       string `json:"status"`
	RequestID    int    `json:"request_id,omitempty"`
	CoverUser    int    `json:"cover_user_id,omitempty"`
	CoverName    string `json:"cover_name,omitempty"`
	FromUserID   int    `json:"from_user_id,omitempty"`
	FromName     string `json:"from_name,omitempty"`
	CoverEnd     string `json:"cover_end_date,omitempty"`
}

type oncallProjectDay struct {
	Date    string            `json:"date"`
	Label   string            `json:"label"`
	Weekday string            `json:"weekday"`
	Today   bool              `json:"today"`
	Teams   []oncallDutyShift `json:"teams"`
}

type oncallProjectTeamView struct {
	TeamID   int                `json:"team_id"`
	TeamName string             `json:"team_name"`
	Roster   []oncallDutyPerson `json:"roster"`
}

func projectOncallTeamsConfigured(projectID int) (bool, error) {
	var set bool
	err := DB.QueryRow(`SELECT teams_set FROM project_oncall WHERE project_id = $1`, projectID).Scan(&set)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return set, err
}

func listStoredOncallTeams(projectID int) ([]oncallProjectTeam, error) {
	rows, err := DB.Query(`
		SELECT t.id, COALESCE(t.name, '')
		FROM project_oncall_teams p
		INNER JOIN teams t ON t.id = p.team_id
		WHERE p.project_id = $1
		ORDER BY t.name, t.id
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	teams := []oncallProjectTeam{}
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			name = "Unknown"
		}
		teams = append(teams, oncallProjectTeam{ID: id, Name: name})
	}
	return teams, rows.Err()
}

func materializeProjectOncallTeams(projectID int) error {
	set, err := projectOncallTeamsConfigured(projectID)
	if err != nil || set {
		return err
	}
	current, err := listImplicitOncallTeams(projectID)
	if err != nil {
		return err
	}
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, team := range current {
		if _, err := tx.Exec(`
			INSERT INTO project_oncall_teams (project_id, team_id) VALUES ($1, $2)
			ON CONFLICT (project_id, team_id) DO NOTHING
		`, projectID, team.ID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
		INSERT INTO project_oncall (project_id, enabled, teams_set)
		VALUES ($1, FALSE, TRUE)
		ON CONFLICT (project_id) DO UPDATE SET teams_set = TRUE, updated_at = CURRENT_TIMESTAMP
	`, projectID); err != nil {
		return err
	}
	return tx.Commit()
}

func addProjectOncallTeam(projectID, teamID int) error {
	if DB == nil || projectID <= 0 || teamID <= 0 {
		return errOncallInvalid
	}
	team, err := GetTeamByID(teamID)
	if err != nil || team == nil {
		return errOncallInvalid
	}
	if err := materializeProjectOncallTeams(projectID); err != nil {
		return err
	}
	_, err = DB.Exec(`
		INSERT INTO project_oncall_teams (project_id, team_id) VALUES ($1, $2)
		ON CONFLICT (project_id, team_id) DO NOTHING
	`, projectID, teamID)
	return err
}

func removeProjectOncallTeam(projectID, teamID int) error {
	if DB == nil || projectID <= 0 || teamID <= 0 {
		return errOncallInvalid
	}
	if err := materializeProjectOncallTeams(projectID); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM project_oncall_teams WHERE project_id = $1 AND team_id = $2`, projectID, teamID)
	return err
}

func listProjectOncallTeams(projectID int) ([]oncallProjectTeam, error) {
	if DB == nil || projectID <= 0 {
		return nil, errOncallInvalid
	}
	set, err := projectOncallTeamsConfigured(projectID)
	if err != nil {
		return nil, err
	}
	if set {
		return listStoredOncallTeams(projectID)
	}
	return listImplicitOncallTeams(projectID)
}

func listImplicitOncallTeams(projectID int) ([]oncallProjectTeam, error) {
	if DB == nil || projectID <= 0 {
		return nil, errOncallInvalid
	}
	var ownerID int
	var ownerName string
	err := DB.QueryRow(`
		SELECT COALESCE(p.owner_team_id, 0), COALESCE(t.name, '')
		FROM projects p
		LEFT JOIN teams t ON t.id = p.owner_team_id
		WHERE p.id = $1
	`, projectID).Scan(&ownerID, &ownerName)
	if err != nil {
		if err == sql.ErrNoRows {
			return []oncallProjectTeam{}, nil
		}
		return nil, err
	}
	teams := []oncallProjectTeam{}
	seen := map[int]bool{}
	add := func(id int, name string) {
		if id <= 0 || seen[id] {
			return
		}
		seen[id] = true
		name = strings.TrimSpace(name)
		if name == "" {
			name = "Unknown"
		}
		teams = append(teams, oncallProjectTeam{ID: id, Name: name})
	}
	add(ownerID, ownerName)
	rows, err := DB.Query(`
		SELECT a.team_id, COALESCE(t.name, '')
		FROM project_team_access a
		INNER JOIN teams t ON t.id = a.team_id
		WHERE a.project_id = $1
		ORDER BY t.name, a.team_id
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		add(id, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return teams, nil
}

func shiftFromDutyDay(team oncallProjectTeam, day oncallDutyDay) oncallDutyShift {
	return oncallDutyShift{
		TeamID:       team.ID,
		TeamName:     team.Name,
		UserID:       day.UserID,
		Name:         day.Name,
		BackupUserID: day.BackupUserID,
		BackupName:   day.BackupName,
		Status:       day.Status,
		RequestID:    day.RequestID,
		CoverUser:    day.CoverUser,
		CoverName:    day.CoverName,
		FromUserID:   day.FromUserID,
		FromName:     day.FromName,
		CoverEnd:     day.CoverEnd,
	}
}

func assembleOncallProjectDays(teams []oncallProjectTeam, series [][]oncallDutyDay) []oncallProjectDay {
	byDate := map[string]*oncallProjectDay{}
	order := []string{}
	for index, team := range teams {
		if index >= len(series) {
			break
		}
		for _, day := range series[index] {
			slot := byDate[day.Date]
			if slot == nil {
				slot = &oncallProjectDay{
					Date:    day.Date,
					Label:   day.Label,
					Weekday: day.Weekday,
					Today:   day.Today,
					Teams:   []oncallDutyShift{},
				}
				byDate[day.Date] = slot
				order = append(order, day.Date)
			}
			slot.Teams = append(slot.Teams, shiftFromDutyDay(team, day))
		}
	}
	out := make([]oncallProjectDay, 0, len(order))
	for _, key := range order {
		out = append(out, *byDate[key])
	}
	return out
}

func buildOncallProjectDays(projectID int, monthValue, timezone string) ([]oncallProjectDay, []oncallProjectTeamView, string, error) {
	teams, err := listProjectOncallTeams(projectID)
	if err != nil {
		return nil, nil, "", err
	}
	series := make([][]oncallDutyDay, 0, len(teams))
	views := make([]oncallProjectTeamView, 0, len(teams))
	today := ""
	for _, team := range teams {
		days, roster, dayToday, err := buildOncallDays(projectID, team.ID, monthValue, timezone)
		if err != nil {
			return nil, nil, "", err
		}
		if roster == nil {
			roster = []oncallDutyPerson{}
		}
		if days == nil {
			days = []oncallDutyDay{}
		}
		today = dayToday
		views = append(views, oncallProjectTeamView{TeamID: team.ID, TeamName: team.Name, Roster: roster})
		series = append(series, days)
	}
	days := assembleOncallProjectDays(teams, series)
	if days == nil {
		days = []oncallProjectDay{}
	}
	return days, views, today, nil
}

func oncallFlagHandler(w http.ResponseWriter, r *http.Request) {
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
		rows, err := DB.Query(`SELECT project_id, enabled FROM project_oncall ORDER BY project_id`)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load on-call projects", err)
			return
		}
		defer rows.Close()
		flags := []map[string]any{}
		for rows.Next() {
			var projectID int
			var enabled bool
			if err := rows.Scan(&projectID, &enabled); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to load on-call projects", err)
				return
			}
			flags = append(flags, map[string]any{"project_id": projectID, "enabled": enabled})
		}
		writeJSON(w, http.StatusOK, map[string]any{"flags": flags, "status": "ok"})
	case "PUT":
		if _, ok := requireDevopsManager(w, r); !ok {
			return
		}
		var body struct {
			ProjectID int  `json:"project_id"`
			Enabled   bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ProjectID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "project is required", err)
			return
		}
		setProjectOncall(body.ProjectID, body.Enabled)
		writeJSON(w, http.StatusOK, map[string]any{"project_id": body.ProjectID, "enabled": body.Enabled, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func oncallRosterHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	teamID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("team_id")))
	switch r.Method {
	case "GET":
		if teamID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "team is required", nil)
			return
		}
		ids, err := listOncallRoster(teamID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load the on-call set", err)
			return
		}
		names := oncallUserNames(ids)
		people := make([]oncallDutyPerson, 0, len(ids))
		for _, id := range ids {
			people = append(people, oncallDutyPerson{UserID: id, Name: oncallKnownName(names, id)})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"team_id":          teamID,
			"users":            people,
			"mission_critical": teamHasMissionCriticalService(teamID, 0),
			"status":           "ok",
		})
	case "PUT":
		var body struct {
			TeamID  int   `json:"team_id"`
			UserIDs []int `json:"user_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.TeamID <= 0 {
			body.TeamID = teamID
		}
		if body.TeamID <= 0 || !canSaveOncallRoster(userID, body.TeamID) {
			writeAPIError(w, r, http.StatusForbidden, "you cannot manage this team", nil)
			return
		}
		saved, err := saveOncallRoster(body.TeamID, body.UserIDs)
		if err != nil {
			if err == errOncallInvalid {
				writeAPIError(w, r, http.StatusBadRequest, "Choose people who belong to this team.", nil)
				return
			}
			if err == errOncallNeedBackup {
				writeAPIError(w, r, http.StatusBadRequest, "Mission-critical teams need a primary and a different backup.", nil)
				return
			}
			writeAPIError(w, r, http.StatusInternalServerError, "The on-call set could not be saved.", err)
			return
		}
		names := oncallUserNames(saved)
		people := make([]oncallDutyPerson, 0, len(saved))
		for _, id := range saved {
			people = append(people, oncallDutyPerson{UserID: id, Name: oncallKnownName(names, id)})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"team_id":          body.TeamID,
			"users":            people,
			"mission_critical": teamHasMissionCriticalService(body.TeamID, 0),
			"status":           "ok",
		})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func oncallProjectTeamsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method == "GET" {
		if _, ok := requireDevopsUser(w, r); !ok {
			return
		}
		projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
		if projectID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "project is required", nil)
			return
		}
		teams, err := listProjectOncallTeams(projectID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Teams for this project could not be loaded.", err)
			return
		}
		catalog, err := GetTeams()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Teams could not be loaded.", err)
			return
		}
		choices := make([]map[string]any, 0, len(catalog))
		for _, team := range catalog {
			name := strings.TrimSpace(team.Name)
			if name == "" {
				name = "Unknown"
			}
			choices = append(choices, map[string]any{"team_id": team.ID, "team_name": name})
		}
		onCall := make([]map[string]any, 0, len(teams))
		for _, team := range teams {
			onCall = append(onCall, map[string]any{"team_id": team.ID, "team_name": team.Name})
		}
		writeJSON(w, http.StatusOK, map[string]any{"teams": onCall, "choices": choices, "status": "ok"})
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	var body struct {
		ProjectID int `json:"project_id"`
		TeamID    int `json:"team_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ProjectID <= 0 || body.TeamID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "Choose a project and a team.", err)
		return
	}
	var err error
	switch r.Method {
	case "POST":
		err = addProjectOncallTeam(body.ProjectID, body.TeamID)
	case "DELETE":
		err = removeProjectOncallTeam(body.ProjectID, body.TeamID)
	default:
		writeMethodNotAllowed(w, r)
		return
	}
	if err != nil {
		if err == errOncallInvalid {
			writeAPIError(w, r, http.StatusBadRequest, "Choose a team that exists.", nil)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "The team could not be updated.", err)
		return
	}
	teams, err := listProjectOncallTeams(body.ProjectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "The team could not be updated.", err)
		return
	}
	onCall := make([]map[string]any, 0, len(teams))
	for _, team := range teams {
		onCall = append(onCall, map[string]any{"team_id": team.ID, "team_name": team.Name})
	}
	writeJSON(w, http.StatusOK, map[string]any{"teams": onCall, "status": "ok"})
}

func oncallDaysHandler(w http.ResponseWriter, r *http.Request) {
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
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	teamID, _ := strconv.Atoi(r.URL.Query().Get("team_id"))
	monthValue := strings.TrimSpace(r.URL.Query().Get("month"))
	timezone := strings.TrimSpace(r.URL.Query().Get("timezone"))
	if timezone == "" {
		timezone = "Asia/Kolkata"
	}
	if projectID <= 0 || monthValue == "" {
		writeAPIError(w, r, http.StatusBadRequest, "project and month are required", nil)
		return
	}
	if teamID <= 0 {
		days, teams, today, err := buildOncallProjectDays(projectID, monthValue, timezone)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That month could not be built.", err)
			return
		}
		if days == nil {
			days = []oncallProjectDay{}
		}
		if teams == nil {
			teams = []oncallProjectTeamView{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"days": days, "teams": teams, "today": today, "status": "ok"})
		return
	}
	days, roster, today, err := buildOncallDays(projectID, teamID, monthValue, timezone)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That month could not be built.", err)
		return
	}
	if days == nil {
		days = []oncallDutyDay{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"days": days, "roster": roster, "today": today, "status": "ok"})
}

func oncallCoverHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if r.Method == "GET" {
		listOncallCoverHistory(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if strings.Contains(r.URL.Path, "/decision") {
		decideOncallCover(w, r, userID)
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		TeamID      int    `json:"team_id"`
		Date        string `json:"date"`
		UntilDate   string `json:"until_date"`
		CoverUserID int    `json:"cover_user_id"`
		Timezone    string `json:"timezone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	if body.Timezone == "" {
		body.Timezone = "Asia/Kolkata"
	}
	if body.ProjectID <= 0 || body.TeamID <= 0 || body.CoverUserID <= 0 || !oncallTimezoneAllowed(body.Timezone) {
		writeAPIError(w, r, http.StatusBadRequest, "Choose the day and the person who can cover.", nil)
		return
	}
	when, err := time.Parse("2006-01-02", body.Date)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "Choose the day and the person who can cover.", err)
		return
	}
	until := when
	if strings.TrimSpace(body.UntilDate) != "" {
		parsed, untilErr := time.Parse("2006-01-02", strings.TrimSpace(body.UntilDate))
		if untilErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "Choose the last day of cover.", untilErr)
			return
		}
		until = parsed
	}
	if until.Before(when) {
		writeAPIError(w, r, http.StatusBadRequest, "Cover must end on or after the start day.", nil)
		return
	}
	span := 0
	for cursor := when; !cursor.After(until); cursor = cursor.AddDate(0, 0, 1) {
		span++
	}
	if span > 30 {
		writeAPIError(w, r, http.StatusBadRequest, "Temporary cover is at most 30 days.", nil)
		return
	}
	loc, locErr := time.LoadLocation(body.Timezone)
	if locErr != nil {
		loc = time.UTC
	}
	today := time.Now().In(loc).Format("2006-01-02")
	if body.Date < today {
		writeAPIError(w, r, http.StatusBadRequest, "A past day cannot be changed.", nil)
		return
	}
	months := map[string][]oncallDutyDay{}
	loadMonth := func(monthValue string) ([]oncallDutyDay, error) {
		if cached, ok := months[monthValue]; ok {
			return cached, nil
		}
		days, _, _, err := buildOncallDays(body.ProjectID, body.TeamID, monthValue, body.Timezone)
		if err != nil {
			return nil, err
		}
		months[monthValue] = days
		return days, nil
	}
	assigned := 0
	for cursor := when; !cursor.After(until); cursor = cursor.AddDate(0, 0, 1) {
		days, err := loadMonth(cursor.Format("2006-01"))
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That day could not be checked.", err)
			return
		}
		key := cursor.Format("2006-01-02")
		found := false
		for _, day := range days {
			if day.Date != key {
				continue
			}
			found = true
			if day.Status == "pending" {
				writeAPIError(w, r, http.StatusConflict, "A cover request is already waiting for this interval.", nil)
				return
			}
			if day.UserID <= 0 {
				writeAPIError(w, r, http.StatusBadRequest, "Assign coverage before asking for a temporary override.", nil)
				return
			}
			if assigned == 0 {
				assigned = day.UserID
			} else if assigned != day.UserID {
				writeAPIError(w, r, http.StatusBadRequest, "Ask for cover on days assigned to one person.", nil)
				return
			}
		}
		if !found {
			writeAPIError(w, r, http.StatusBadRequest, "That interval could not be checked.", nil)
			return
		}
	}
	profile, _ := GetDevopsProfile(userID)
	manager := profile != nil && profile.IsManager
	if assigned <= 0 || (userID != assigned && !manager) {
		writeAPIError(w, r, http.StatusForbidden, "Only the person on that day can ask for cover.", nil)
		return
	}
	if body.CoverUserID == assigned {
		writeAPIError(w, r, http.StatusBadRequest, "Choose a different person.", nil)
		return
	}
	_, people, _, err := buildOncallDays(body.ProjectID, body.TeamID, when.Format("2006-01"), body.Timezone)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "The on-call set could not be loaded.", err)
		return
	}
	allowed := false
	for _, person := range people {
		if person.UserID == body.CoverUserID {
			allowed = true
		}
	}
	if !allowed {
		writeAPIError(w, r, http.StatusBadRequest, "That person is not in the on-call set.", nil)
		return
	}
	endDate := until.Format("2006-01-02")
	var id int
	if err := DB.QueryRow(`
		INSERT INTO oncall_cover_requests (project_id, team_id, cover_date, cover_end_date, from_user_id, to_user_id, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending')
		RETURNING id
	`, body.ProjectID, body.TeamID, body.Date, endDate, assigned, body.CoverUserID).Scan(&id); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "The cover request could not be saved.", err)
		return
	}
	notifyOncallCoverRequest(body.CoverUserID, assigned, body.ProjectID, body.Date, endDate)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "pending", "cover_date": body.Date, "cover_end_date": endDate})
}

func decideOncallCover(w http.ResponseWriter, r *http.Request, userID int) {
	var body struct {
		ID       int    `json:"id"`
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	decision := strings.ToLower(strings.TrimSpace(body.Decision))
	if decision != "approve" && decision != "decline" {
		writeAPIError(w, r, http.StatusBadRequest, "Approve or decline the request.", nil)
		return
	}
	var projectID, teamID, fromUserID, toUserID int
	var coverDate time.Time
	var coverEnd sql.NullTime
	var status string
	err := DB.QueryRow(`
		SELECT project_id, team_id, cover_date, cover_end_date, from_user_id, to_user_id, status
		FROM oncall_cover_requests WHERE id = $1
	`, body.ID).Scan(&projectID, &teamID, &coverDate, &coverEnd, &fromUserID, &toUserID, &status)
	if err != nil || status != "pending" {
		writeAPIError(w, r, http.StatusNotFound, "That request is no longer waiting.", err)
		return
	}
	if userID != toUserID {
		writeAPIError(w, r, http.StatusForbidden, "Only the person asked to cover can approve.", nil)
		return
	}
	endDate := coverDate
	if coverEnd.Valid {
		endDate = coverEnd.Time
	}
	next := "declined"
	if decision == "approve" {
		next = "approved"
	}
	if _, err := DB.Exec(`UPDATE oncall_cover_requests SET status = $2 WHERE id = $1 AND status = 'pending'`, body.ID, next); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "The decision could not be saved.", err)
		return
	}
	if next == "approved" {
		_, _ = DB.Exec(`
			UPDATE oncall_cover_requests
			SET status = 'declined'
			WHERE project_id = $1 AND team_id = $2 AND id <> $4 AND status = 'pending'
			  AND cover_date <= $5
			  AND COALESCE(cover_end_date, cover_date) >= $3
		`, projectID, teamID, coverDate, body.ID, endDate)
	}
	notifyOncallCoverDecision(fromUserID, toUserID, projectID, coverDate.Format("2006-01-02"), endDate.Format("2006-01-02"), next)
	writeJSON(w, http.StatusOK, map[string]any{"id": body.ID, "status": next})
}

func notifyOncallUser(userID, projectID int, kind, subject, message string) {
	if userID <= 0 || strings.TrimSpace(message) == "" {
		return
	}
	var project *int
	if projectID > 0 {
		project = &projectID
	}
	_ = InsertUserNotification(userID, nil, project, kind, message)
	sendNotificationEmailIfConfigured(userID, kind, subject, message)
}

func notifyOncallCoverRequest(toUserID, fromUserID, projectID int, date, until string) {
	fromName := "Someone"
	if user, err := GetUserByID(fromUserID); err == nil && user != nil && strings.TrimSpace(user.Username) != "" {
		fromName = user.Username
	}
	interval := date
	if until != "" && until != date {
		interval = date + " to " + until
	}
	message := fmt.Sprintf("%s asked you to cover on-call on %s. Open On-call to approve or decline. The original rotation is not rewritten.", fromName, interval)
	notifyOncallUser(toUserID, projectID, "oncall_cover", "On-call cover request", message)
}

func notifyOncallCoverDecision(fromUserID, toUserID, projectID int, date, until, status string) {
	toName := "The person you asked"
	if user, err := GetUserByID(toUserID); err == nil && user != nil && strings.TrimSpace(user.Username) != "" {
		toName = user.Username
	}
	verb := "declined"
	if status == "approved" {
		verb = "approved"
	}
	interval := date
	if until != "" && until != date {
		interval = date + " to " + until
	}
	message := fmt.Sprintf("%s %s the on-call cover for %s.", toName, verb, interval)
	notifyOncallUser(fromUserID, projectID, "oncall_cover", "On-call cover "+verb, message)
}

func listOncallCoverHistory(w http.ResponseWriter, r *http.Request) {
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	teamID, _ := strconv.Atoi(r.URL.Query().Get("team_id"))
	if projectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project is required", nil)
		return
	}
	if DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"covers": []any{}, "status": "ok"})
		return
	}
	rows, err := DB.Query(`
		SELECT id, project_id, team_id, to_char(cover_date, 'YYYY-MM-DD'),
		       to_char(COALESCE(cover_end_date, cover_date), 'YYYY-MM-DD'),
		       from_user_id, to_user_id, status,
		       COALESCE(to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
		FROM oncall_cover_requests
		WHERE project_id = $1 AND ($2 = 0 OR team_id = $2)
		ORDER BY created_at DESC, id DESC
		LIMIT 80
	`, projectID, teamID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cover history could not be loaded.", err)
		return
	}
	defer rows.Close()
	type coverHistory struct {
		ID        int    `json:"id"`
		ProjectID int    `json:"project_id"`
		TeamID    int    `json:"team_id"`
		Date      string `json:"cover_date"`
		EndDate   string `json:"cover_end_date"`
		FromID    int    `json:"from_user_id"`
		FromName  string `json:"from_name"`
		ToID      int    `json:"to_user_id"`
		ToName    string `json:"to_name"`
		Status    string `json:"status"`
		CreatedAt string `json:"created_at"`
	}
	items := []coverHistory{}
	ids := []int{}
	for rows.Next() {
		var item coverHistory
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.TeamID, &item.Date, &item.EndDate, &item.FromID, &item.ToID, &item.Status, &item.CreatedAt); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Cover history could not be loaded.", err)
			return
		}
		ids = append(ids, item.FromID, item.ToID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Cover history could not be loaded.", err)
		return
	}
	names := oncallUserNames(ids)
	for i := range items {
		items[i].FromName = oncallKnownName(names, items[i].FromID)
		items[i].ToName = oncallKnownName(names, items[i].ToID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"covers": items, "status": "ok"})
}

func oncallUsersToPage(item *requestIncident) []int {
	if item == nil {
		return nil
	}
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	seen := map[int]struct{}{}
	ids := []int{}
	add := func(id int) {
		if id <= 0 {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	projectID := 0
	if item.ProjectID != nil {
		projectID = *item.ProjectID
	}
	teams := []oncallProjectTeam{}
	if projectID > 0 {
		if listed, listErr := listProjectOncallTeams(projectID); listErr == nil {
			teams = listed
		}
	}
	if len(teams) == 0 && item.TeamID != nil && *item.TeamID > 0 {
		teams = []oncallProjectTeam{{ID: *item.TeamID, Name: item.TeamName}}
	}
	for _, team := range teams {
		if projectID > 0 {
			days, _, today, dayErr := buildOncallDays(projectID, team.ID, now.Format("2006-01"), "Asia/Kolkata")
			if dayErr == nil {
				for _, day := range days {
					if day.Date == today {
						add(day.UserID)
					}
				}
				continue
			}
		}
		roster, rosterErr := listOncallRoster(team.ID)
		if rosterErr == nil {
			add(oncallRosterUser(roster, now.Day()))
		}
	}
	if len(ids) == 0 {
		if owner := activeOncallUserID(); owner != nil {
			add(*owner)
		}
	}
	return ids
}

func pageMajorIncidentOncall(item *requestIncident, note, conferenceURL string) {
	if item == nil {
		return
	}
	number := firstNonEmpty(item.IncidentNumber, formatIncidentNumber(item.ID))
	message := "Major incident " + number + ": " + firstNonEmpty(note, item.Summary)
	if strings.TrimSpace(conferenceURL) != "" {
		message += " Conference: " + strings.TrimSpace(conferenceURL)
	}
	message += " Open the incident to take it."
	projectID := 0
	if item.ProjectID != nil {
		projectID = *item.ProjectID
	}
	for _, userID := range oncallUsersToPage(item) {
		notifyOncallUser(userID, projectID, "major_incident", "Major incident "+number, message)
	}
}
