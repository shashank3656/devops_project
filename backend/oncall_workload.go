package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

const (
	oncallShiftHours     = 24
	oncallOvernightHours = 8
)

type oncallPersonLoad struct {
	UserID         int    `json:"user_id"`
	Name           string `json:"name"`
	PrimaryDays    int    `json:"primary_days"`
	BackupDays     int    `json:"backup_days"`
	AssignedHours  int    `json:"assigned_hours"`
	OvernightHours int    `json:"overnight_hours"`
	WeekendHours   int    `json:"weekend_hours"`
	IncidentCount  int    `json:"incident_count"`
}

type oncallWorkload struct {
	People         []oncallPersonLoad `json:"people"`
	SuggestedDays  map[string]int     `json:"suggested_days"`
	SuggestionNote string             `json:"suggestion_note"`
	Note           string             `json:"note"`
}

func oncallWeekend(day string) bool {
	return day == "saturday" || day == "sunday"
}

func buildOncallPersonLoads(days, backup map[string]int, names map[int]string, incidents map[int]int, memberIDs []int) []oncallPersonLoad {
	seen := map[int]*oncallPersonLoad{}
	ensure := func(id int) *oncallPersonLoad {
		if id <= 0 {
			return nil
		}
		if item, ok := seen[id]; ok {
			return item
		}
		item := &oncallPersonLoad{UserID: id, Name: oncallKnownName(names, id), IncidentCount: incidents[id]}
		seen[id] = item
		return item
	}
	for _, id := range memberIDs {
		ensure(id)
	}
	for _, day := range oncallWeekdays {
		if person := ensure(days[day]); person != nil {
			person.PrimaryDays++
			person.AssignedHours += oncallShiftHours
			person.OvernightHours += oncallOvernightHours
			if oncallWeekend(day) {
				person.WeekendHours += oncallShiftHours
			}
		}
		if person := ensure(backup[day]); person != nil {
			person.BackupDays++
		}
	}
	out := make([]oncallPersonLoad, 0, len(seen))
	for _, item := range seen {
		out = append(out, *item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].AssignedHours != out[j].AssignedHours {
			return out[i].AssignedHours > out[j].AssignedHours
		}
		if out[i].IncidentCount != out[j].IncidentCount {
			return out[i].IncidentCount > out[j].IncidentCount
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func suggestFairerOncallDays(days, backup map[string]int, memberIDs []int) (map[string]int, string) {
	suggested := map[string]int{}
	if len(memberIDs) == 0 {
		return suggested, "Add another eligible team member before a fairer rotation can be suggested."
	}
	counts := map[int]int{}
	for _, id := range memberIDs {
		if id > 0 {
			counts[id] = 0
		}
	}
	pick := func(avoid int) int {
		best, bestCount := 0, 1<<30
		for _, id := range memberIDs {
			if id <= 0 || id == avoid {
				continue
			}
			if counts[id] < bestCount || (counts[id] == bestCount && (best == 0 || id < best)) {
				best = id
				bestCount = counts[id]
			}
		}
		return best
	}
	for _, day := range oncallWeekdays {
		id := pick(backup[day])
		if id == 0 {
			id = days[day]
		}
		suggested[day] = id
		if id > 0 {
			counts[id]++
		}
	}
	same := true
	for _, day := range oncallWeekdays {
		if suggested[day] != days[day] {
			same = false
			break
		}
	}
	if same {
		return suggested, "Current primary days are already as even as this team allows. Review before publishing."
	}
	return suggested, "Suggested primary days spread assigned hours more evenly. Review before publishing. This does not page anyone."
}

func oncallIncidentCounts(projectID int, memberIDs []int) map[int]int {
	counts := map[int]int{}
	if DB == nil || projectID <= 0 || len(memberIDs) == 0 {
		return counts
	}
	placeholders := make([]string, 0, len(memberIDs))
	args := []any{projectID}
	seen := map[int]bool{}
	for _, id := range memberIDs {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		args = append(args, id)
		placeholders = append(placeholders, "$"+strconv.Itoa(len(args)))
	}
	if len(placeholders) == 0 {
		return counts
	}
	rows, err := DB.Query(`
		SELECT owner_user_id, COUNT(*)
		FROM request_incidents
		WHERE project_id = $1
		  AND owner_user_id IN (`+strings.Join(placeholders, ",")+`)
		  AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
		GROUP BY owner_user_id
	`, args...)
	if err != nil {
		return counts
	}
	defer rows.Close()
	for rows.Next() {
		var userID, count int
		if err := rows.Scan(&userID, &count); err == nil {
			counts[userID] = count
		}
	}
	return counts
}

func buildOncallWorkload(teamID, projectID int, days, backup map[string]int) oncallWorkload {
	memberIDs := []int{}
	names := map[int]string{}
	if members, err := GetTeamMembers(teamID); err == nil {
		for _, member := range members {
			if member.UserID > 0 {
				memberIDs = append(memberIDs, member.UserID)
				names[member.UserID] = strings.TrimSpace(member.Username)
			}
		}
	}
	for _, day := range oncallWeekdays {
		if days[day] > 0 {
			memberIDs = append(memberIDs, days[day])
		}
		if backup[day] > 0 {
			memberIDs = append(memberIDs, backup[day])
		}
	}
	unique := []int{}
	seen := map[int]bool{}
	for _, id := range memberIDs {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	for id, name := range oncallUserNames(unique) {
		if strings.TrimSpace(names[id]) == "" {
			names[id] = name
		}
	}
	incidents := oncallIncidentCounts(projectID, unique)
	suggested, note := suggestFairerOncallDays(days, backup, unique)
	return oncallWorkload{
		People:         buildOncallPersonLoads(days, backup, names, incidents, unique),
		SuggestedDays:  suggested,
		SuggestionNote: note,
		Note:           "Assigned hours count a 24-hour primary day. Overnight is 22:00–06:00. Weekend is Saturday and Sunday. Incident load is owned incidents in the last 30 days. Review a fairer rotation before publishing.",
	}
}

func oncallWorkloadHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	teamID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("team_id")))
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	days := map[string]int{}
	backup := map[string]int{}
	if r.Method == http.MethodPost {
		var body struct {
			TeamID     int            `json:"team_id"`
			ProjectID  int            `json:"project_id"`
			Days       map[string]int `json:"days"`
			BackupDays map[string]int `json:"backup_days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if body.TeamID > 0 {
			teamID = body.TeamID
		}
		if body.ProjectID > 0 {
			projectID = body.ProjectID
		}
		if body.Days != nil {
			days = body.Days
		}
		if body.BackupDays != nil {
			backup = body.BackupDays
		}
	} else if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if teamID <= 0 || projectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "team and project are required", nil)
		return
	}
	if r.Method == http.MethodGet || len(days) == 0 {
		if item := lookupOncallSchedule(teamID, projectID); item != nil {
			for _, day := range item.Days {
				days[day.Day] = day.UserID
				backup[day.Day] = day.BackupUserID
			}
		}
	}
	payload := buildOncallWorkload(teamID, projectID, days, backup)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"workload": payload, "status": "ok"})
}
