package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	errHandoverNotFound = errors.New("handover not found")
	errHandoverConflict = errors.New("handover revision changed")
	errHandoverState    = errors.New("handover state does not allow this action")
	errHandoverDenied   = errors.New("handover denied")
)

type handoverItemView struct {
	ID          int        `json:"id"`
	SourceType  string     `json:"source_type"`
	SourceID    int        `json:"source_id"`
	SourceRef   string     `json:"source_ref"`
	ProjectID   int        `json:"project_id,omitempty"`
	Title       string     `json:"title"`
	OwnerName   string     `json:"owner_name"`
	State       string     `json:"state"`
	NextAction  string     `json:"next_action"`
	Deadline    *time.Time `json:"deadline,omitempty"`
	Href        string     `json:"href"`
	Critical    bool       `json:"critical"`
	Section     string     `json:"section"`
	CollectedAt time.Time  `json:"collected_at"`
}

type handoverActionView struct {
	ID         int        `json:"id"`
	SourceType string     `json:"source_type"`
	SourceID   int        `json:"source_id"`
	SourceRef  string     `json:"source_ref"`
	Title      string     `json:"title"`
	OwnerName  string     `json:"owner_name"`
	NextAction string     `json:"next_action"`
	Status     string     `json:"status"`
	DueAt      *time.Time `json:"due_at,omitempty"`
	Carried    bool       `json:"carried"`
}

type handoverRevisionView struct {
	Revision  int       `json:"revision"`
	State     string    `json:"state"`
	Notes     string    `json:"notes"`
	CreatedBy int       `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

type handoverView struct {
	ID                     int                    `json:"id"`
	TeamID                 int                    `json:"team_id"`
	TeamName               string                 `json:"team_name"`
	ProjectID              int                    `json:"project_id"`
	Timezone               string                 `json:"timezone"`
	ShiftDate              string                 `json:"shift_date"`
	ShiftEndAt             time.Time              `json:"shift_end_at"`
	OutgoingUserID         int                    `json:"outgoing_user_id"`
	IncomingUserID         int                    `json:"incoming_user_id"`
	OutgoingName           string                 `json:"outgoing_name"`
	IncomingName           string                 `json:"incoming_name"`
	State                  string                 `json:"state"`
	Revision               int                    `json:"revision"`
	Notes                  string                 `json:"notes"`
	CollectionStatus       string                 `json:"collection_status"`
	MissingSections        []string               `json:"missing_sections"`
	CancelReason           string                 `json:"cancel_reason,omitempty"`
	CollectedAt            *time.Time             `json:"collected_at,omitempty"`
	SubmittedAt            *time.Time             `json:"submitted_at,omitempty"`
	AcknowledgedAt         *time.Time             `json:"acknowledged_at,omitempty"`
	EscalatedAt            *time.Time             `json:"escalated_at,omitempty"`
	CriticalCount          int                    `json:"critical_count"`
	OpenItemCount          int                    `json:"open_item_count"`
	Freshness              string                 `json:"freshness"`
	Items                  []handoverItemView     `json:"items,omitempty"`
	Actions                []handoverActionView   `json:"actions,omitempty"`
	Revisions              []handoverRevisionView `json:"revisions,omitempty"`
	CanEdit                bool                   `json:"can_edit"`
	CanSubmit              bool                   `json:"can_submit"`
	CanAcknowledge         bool                   `json:"can_acknowledge"`
	CanCancel              bool                   `json:"can_cancel"`
	CanReassign            bool                   `json:"can_reassign"`
	People                 []handoverPerson       `json:"people,omitempty"`
	Delta                  *handoverDeltaView     `json:"delta,omitempty"`
	IncidentAssignment     string                 `json:"incident_assignment"`
	ReassignIncidentsOnAck bool                   `json:"reassign_incidents_on_ack"`
	IncidentsReassigned    int                    `json:"incidents_reassigned,omitempty"`
	IncidentReassignNote   string                 `json:"incident_reassign_note,omitempty"`
}

type handoverPerson struct {
	UserID int    `json:"user_id"`
	Name   string `json:"name"`
}

type handoverDeltaChange struct {
	SourceRef string `json:"source_ref"`
	Title     string `json:"title"`
	Before    string `json:"before"`
	After     string `json:"after"`
}

type handoverDeltaView struct {
	Added       []handoverItemView    `json:"added"`
	Removed     []handoverItemView    `json:"removed"`
	Changed     []handoverDeltaChange `json:"changed"`
	CollectedAt *time.Time            `json:"collected_at,omitempty"`
	Note        string                `json:"note"`
}

type handoverSummary struct {
	AwaitingAck int `json:"awaiting_acknowledgement"`
	Overdue     int `json:"overdue"`
	Critical    int `json:"critical_open_items"`
	Missing     int `json:"missing_owners"`
}

func handoverLocation(timezone string) *time.Location {
	if !oncallTimezoneAllowed(timezone) {
		timezone = "Asia/Kolkata"
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

func handoverShiftBoundary(shiftDate, timezone string) (outgoingDate string, endAt time.Time, err error) {
	day, parseErr := time.Parse("2006-01-02", strings.TrimSpace(shiftDate))
	if parseErr != nil {
		return "", time.Time{}, errOncallInvalid
	}
	loc := handoverLocation(timezone)
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	endAt = start.AddDate(0, 0, 1)
	return start.Format("2006-01-02"), endAt.UTC(), nil
}

func nextHandoverShiftDate(timezone string, at time.Time) string {
	loc := handoverLocation(timezone)
	now := at.In(loc)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Format("2006-01-02")
}

func resolveHandoverParticipants(projectID, teamID int, shiftDate, timezone string) (outgoing, incoming oncallDutyDay, err error) {
	if projectID <= 0 || teamID <= 0 {
		return oncallDutyDay{}, oncallDutyDay{}, errOncallInvalid
	}
	outgoingDate, endAt, err := handoverShiftBoundary(shiftDate, timezone)
	if err != nil {
		return oncallDutyDay{}, oncallDutyDay{}, err
	}
	incomingDate := endAt.In(handoverLocation(timezone)).Format("2006-01-02")
	month := outgoingDate[:7]
	days, _, _, err := buildOncallDays(projectID, teamID, month, timezone)
	if err != nil {
		return oncallDutyDay{}, oncallDutyDay{}, err
	}
	incomingMonth := incomingDate[:7]
	incomingDays := days
	if incomingMonth != month {
		incomingDays, _, _, err = buildOncallDays(projectID, teamID, incomingMonth, timezone)
		if err != nil {
			return oncallDutyDay{}, oncallDutyDay{}, err
		}
	}
	for _, day := range days {
		if day.Date == outgoingDate {
			outgoing = day
		}
	}
	for _, day := range incomingDays {
		if day.Date == incomingDate {
			incoming = day
		}
	}
	if outgoing.Name == "" {
		outgoing.Name = "Unknown"
	}
	if incoming.Name == "" {
		incoming.Name = "Unknown"
	}
	return outgoing, incoming, nil
}

func decodeJSONStringList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	var items []string
	if err := json.Unmarshal([]byte(raw), &items); err != nil || items == nil {
		return []string{}
	}
	return items
}

func encodeJSONStringList(items []string) string {
	if len(items) == 0 {
		return "[]"
	}
	body, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(body)
}

func handoverFreshness(collectedAt *time.Time, now time.Time) string {
	if collectedAt == nil || collectedAt.IsZero() {
		return "Unknown"
	}
	age := now.Sub(*collectedAt)
	if age < 30*time.Minute {
		return "Fresh"
	}
	if age < 6*time.Hour {
		return "Aging"
	}
	return "Stale"
}

func canManageHandoverTeam(userID, teamID int) bool {
	if userID <= 0 {
		return false
	}
	if user, err := GetUserByID(userID); err == nil && user != nil && user.Role == "admin" {
		return true
	}
	if prof, err := GetDevopsProfile(userID); err == nil && prof != nil && prof.IsManager {
		return true
	}
	return CanUserManageDevopsTeam(userID, teamID)
}

func handoverVisibleToUser(row handoverView, userID int, visible map[int]struct{}) bool {
	if userID > 0 && (row.OutgoingUserID == userID || row.IncomingUserID == userID) {
		return true
	}
	if canManageHandoverTeam(userID, row.TeamID) {
		return true
	}
	if row.ProjectID > 0 {
		_, ok := visible[row.ProjectID]
		return ok
	}
	return false
}

func filterHandoverItems(items []handoverItemView, visible map[int]struct{}, unscoped bool) []handoverItemView {
	out := make([]handoverItemView, 0, len(items))
	for _, item := range items {
		if item.ProjectID <= 0 {
			if unscoped {
				out = append(out, item)
			}
			continue
		}
		if _, ok := visible[item.ProjectID]; ok {
			out = append(out, item)
		}
	}
	return out
}

func scanHandover(scanner interface {
	Scan(dest ...any) error
}) (handoverView, error) {
	var row handoverView
	var shiftDate time.Time
	var missing string
	var collected, submitted, acked, escalated sql.NullTime
	err := scanner.Scan(
		&row.ID, &row.TeamID, &row.TeamName, &row.ProjectID, &row.Timezone, &shiftDate, &row.ShiftEndAt,
		&row.OutgoingUserID, &row.IncomingUserID, &row.OutgoingName, &row.IncomingName, &row.State, &row.Revision,
		&row.Notes, &row.CollectionStatus, &missing, &row.CancelReason, &collected, &submitted, &acked, &escalated,
		&row.IncidentsReassigned, &row.IncidentReassignNote,
	)
	if err != nil {
		return handoverView{}, err
	}
	row.ShiftDate = shiftDate.Format("2006-01-02")
	row.OutgoingName = oncallKnownName(map[int]string{row.OutgoingUserID: row.OutgoingName}, row.OutgoingUserID)
	row.IncomingName = oncallKnownName(map[int]string{row.IncomingUserID: row.IncomingName}, row.IncomingUserID)
	row.MissingSections = decodeJSONStringList(missing)
	if collected.Valid {
		row.CollectedAt = &collected.Time
	}
	if submitted.Valid {
		row.SubmittedAt = &submitted.Time
	}
	if acked.Valid {
		row.AcknowledgedAt = &acked.Time
	}
	if escalated.Valid {
		row.EscalatedAt = &escalated.Time
	}
	row.Freshness = handoverFreshness(row.CollectedAt, time.Now().UTC())
	row.ReassignIncidentsOnAck = handoverReassignIncidentsEnabled(row.TeamID, row.ProjectID)
	row.IncidentAssignment = handoverIncidentAssignmentCopy(row)
	return row, nil
}

const handoverSelect = `
	SELECT id, team_id, team_name, project_id, timezone, shift_date, shift_end_at,
	       outgoing_user_id, incoming_user_id, outgoing_name, incoming_name, state, revision,
	       notes, collection_status, missing_sections, cancel_reason, collected_at, submitted_at,
	       acknowledged_at, escalated_at,
	       COALESCE(incidents_reassigned, 0), COALESCE(incident_reassign_note, '')
	FROM oncall_handovers
`

func loadHandoverItems(handoverID int) ([]handoverItemView, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, source_type, source_id, source_ref, project_id, title, owner_name, state, next_action, deadline, href, critical, section, collected_at
		FROM oncall_handover_items WHERE handover_id = $1 ORDER BY critical DESC, id
	`, handoverID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	items := []handoverItemView{}
	for rows.Next() {
		var item handoverItemView
		var deadline sql.NullTime
		if err := rows.Scan(&item.ID, &item.SourceType, &item.SourceID, &item.SourceRef, &item.ProjectID, &item.Title, &item.OwnerName, &item.State, &item.NextAction, &deadline, &item.Href, &item.Critical, &item.Section, &item.CollectedAt); err != nil {
			return nil, err
		}
		if deadline.Valid {
			item.Deadline = &deadline.Time
		}
		if strings.TrimSpace(item.OwnerName) == "" {
			item.OwnerName = "Unknown"
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadHandoverActions(handoverID int) ([]handoverActionView, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, source_type, source_id, source_ref, title, owner_name, next_action, status, due_at, carried
		FROM oncall_handover_actions WHERE handover_id = $1 ORDER BY id
	`, handoverID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	actions := []handoverActionView{}
	for rows.Next() {
		var item handoverActionView
		var due sql.NullTime
		if err := rows.Scan(&item.ID, &item.SourceType, &item.SourceID, &item.SourceRef, &item.Title, &item.OwnerName, &item.NextAction, &item.Status, &due, &item.Carried); err != nil {
			return nil, err
		}
		if due.Valid {
			item.DueAt = &due.Time
		}
		if strings.TrimSpace(item.OwnerName) == "" {
			item.OwnerName = "Unknown"
		}
		actions = append(actions, item)
	}
	return actions, rows.Err()
}

func decorateHandover(row *handoverView, userID int, visible map[int]struct{}, unscoped bool) {
	row.Items = filterHandoverItems(row.Items, visible, unscoped)
	critical := 0
	for _, item := range row.Items {
		if item.Critical && !strings.EqualFold(item.State, "resolved") && !strings.EqualFold(item.State, "closed") && !strings.EqualFold(item.State, "done") {
			critical++
		}
	}
	row.CriticalCount = critical
	row.OpenItemCount = len(row.Items)
	row.CanEdit = row.State == "draft" && (userID == row.OutgoingUserID || canManageHandoverTeam(userID, row.TeamID))
	row.CanSubmit = row.State == "draft" && (userID == row.OutgoingUserID || canManageHandoverTeam(userID, row.TeamID))
	row.CanAcknowledge = row.State == "submitted" && (userID == row.IncomingUserID || canManageHandoverTeam(userID, row.TeamID))
	row.CanCancel = (row.State == "draft" || row.State == "submitted") && (userID == row.OutgoingUserID || canManageHandoverTeam(userID, row.TeamID))
	row.CanReassign = canManageHandoverTeam(userID, row.TeamID) && (row.State == "draft" || row.State == "submitted")
}

func getHandover(id, userID int) (handoverView, error) {
	if DB == nil || id <= 0 {
		return handoverView{}, errHandoverNotFound
	}
	row, err := scanHandover(queryRowContext(handoverSelect+` WHERE id = $1`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return handoverView{}, errHandoverNotFound
		}
		return handoverView{}, err
	}
	visibleIDs := []int{}
	if userID > 0 {
		visibleIDs = visibleProjectIDsForUser(userID)
	}
	visible := projectIDSet(visibleIDs)
	if userID > 0 && !handoverVisibleToUser(row, userID, visible) {
		return handoverView{}, errHandoverDenied
	}
	items, err := loadHandoverItems(id)
	if err != nil {
		return handoverView{}, err
	}
	actions, err := loadHandoverActions(id)
	if err != nil {
		return handoverView{}, err
	}
	row.Items = items
	row.Actions = actions
	revRows, cancel, err := queryRowsWithTimeout(`
		SELECT revision, state, notes, created_by, created_at
		FROM oncall_handover_revisions WHERE handover_id = $1 ORDER BY revision DESC
	`, id)
	if err == nil {
		defer cancel()
		defer revRows.Close()
		for revRows.Next() {
			var rev handoverRevisionView
			if err := revRows.Scan(&rev.Revision, &rev.State, &rev.Notes, &rev.CreatedBy, &rev.CreatedAt); err == nil {
				row.Revisions = append(row.Revisions, rev)
			}
		}
	}
	unscoped := false
	if user, userErr := GetUserByID(userID); userErr == nil && user != nil && user.Role == "admin" {
		unscoped = true
	}
	decorateHandover(&row, userID, visible, unscoped)
	row.People = handoverPeople(row.TeamID)
	delta := liveHandoverDelta(row, visible)
	row.Delta = &delta
	return row, nil
}

func listHandovers(userID int, teamID, projectID int, state, shiftDate string, waitingForMe bool) ([]handoverView, handoverSummary, error) {
	summary := handoverSummary{}
	if DB == nil {
		return []handoverView{}, summary, nil
	}
	query := handoverSelect + ` WHERE state <> 'cancelled'`
	args := []any{}
	if waitingForMe {
		query = handoverSelect + ` WHERE ((state = 'draft' AND outgoing_user_id = $1) OR (state = 'submitted' AND incoming_user_id = $1))`
		args = append(args, userID)
	}
	if teamID > 0 {
		args = append(args, teamID)
		query += fmt.Sprintf(` AND team_id = $%d`, len(args))
	}
	if projectID > 0 {
		args = append(args, projectID)
		query += fmt.Sprintf(` AND project_id = $%d`, len(args))
	}
	if strings.TrimSpace(state) != "" {
		args = append(args, strings.TrimSpace(state))
		query += fmt.Sprintf(` AND state = $%d`, len(args))
	}
	if strings.TrimSpace(shiftDate) != "" {
		args = append(args, strings.TrimSpace(shiftDate))
		query += fmt.Sprintf(` AND to_char(shift_date, 'YYYY-MM-DD') = $%d`, len(args))
	}
	query += ` ORDER BY shift_end_at DESC, id DESC LIMIT 200`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil, summary, err
	}
	defer cancel()
	defer rows.Close()
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	unscoped := false
	if user, userErr := GetUserByID(userID); userErr == nil && user != nil && user.Role == "admin" {
		unscoped = true
	}
	now := time.Now().UTC()
	out := []handoverView{}
	for rows.Next() {
		row, err := scanHandover(rows)
		if err != nil {
			return nil, summary, err
		}
		if !handoverVisibleToUser(row, userID, visible) {
			continue
		}
		items, _ := loadHandoverItems(row.ID)
		row.Items = items
		decorateHandover(&row, userID, visible, unscoped)
		row.Items = nil
		if row.State == "submitted" {
			summary.AwaitingAck++
			if now.After(row.ShiftEndAt.Add(15 * time.Minute)) {
				summary.Overdue++
			}
		}
		summary.Critical += row.CriticalCount
		if row.OutgoingUserID <= 0 || row.IncomingUserID <= 0 {
			summary.Missing++
		}
		out = append(out, row)
	}
	return out, summary, rows.Err()
}

func firstHandoverProject(teamID int, preferred int, visible map[int]struct{}) int {
	if preferred > 0 {
		if _, ok := visible[preferred]; ok || len(visible) == 0 {
			return preferred
		}
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT project_id FROM project_oncall_teams WHERE team_id = $1 ORDER BY project_id
	`, teamID)
	if err != nil {
		return preferred
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return preferred
		}
		if _, ok := visible[id]; ok || len(visible) == 0 {
			return id
		}
	}
	return preferred
}

func generateHandover(userID, teamID, projectID int, timezone, shiftDate, notes string) (handoverView, error) {
	if DB == nil {
		return handoverView{}, fmt.Errorf("database not available")
	}
	if teamID <= 0 {
		return handoverView{}, errOncallInvalid
	}
	if timezone == "" {
		timezone = "Asia/Kolkata"
	}
	if !oncallTimezoneAllowed(timezone) {
		return handoverView{}, errOncallInvalid
	}
	if strings.TrimSpace(shiftDate) == "" {
		shiftDate = nextHandoverShiftDate(timezone, time.Now())
	}
	outgoingDate, endAt, err := handoverShiftBoundary(shiftDate, timezone)
	if err != nil {
		return handoverView{}, err
	}
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	projectID = firstHandoverProject(teamID, projectID, visible)
	if projectID <= 0 {
		return handoverView{}, errOncallInvalid
	}
	if userID > 0 {
		if _, ok := visible[projectID]; !ok {
			if user, userErr := GetUserByID(userID); userErr != nil || user == nil || user.Role != "admin" {
				if !canManageHandoverTeam(userID, teamID) {
					return handoverView{}, errHandoverDenied
				}
			}
		}
	}
	outgoing, incoming, err := resolveHandoverParticipants(projectID, teamID, outgoingDate, timezone)
	if err != nil {
		return handoverView{}, err
	}
	teamName := "Unknown"
	if team, teamErr := GetTeamByID(teamID); teamErr == nil && team != nil {
		if strings.TrimSpace(team.Name) != "" {
			teamName = strings.TrimSpace(team.Name)
		}
	}
	var existingID int
	var existingState string
	err = queryRowContext(`SELECT id, state FROM oncall_handovers WHERE team_id = $1 AND shift_end_at = $2`, teamID, endAt).Scan(&existingID, &existingState)
	if err == nil && existingID > 0 {
		if !strings.EqualFold(existingState, "cancelled") {
			return getHandover(existingID, userID)
		}
		_, err = execContext(`
			UPDATE oncall_handovers
			SET state = 'draft', cancel_reason = '', collected_at = NULL, collection_status = 'pending',
			    notes = CASE WHEN $2 <> '' THEN $2 ELSE notes END,
			    outgoing_user_id = $3, incoming_user_id = $4, outgoing_name = $5, incoming_name = $6,
			    submitted_at = NULL, submitted_by = 0, acknowledged_at = NULL, acknowledged_by = 0,
			    escalated_at = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND state = 'cancelled'
		`, existingID, strings.TrimSpace(notes), outgoing.UserID, incoming.UserID, outgoing.Name, incoming.Name)
		if err != nil {
			return handoverView{}, err
		}
		if collectErr := collectHandoverSnapshot(existingID, teamID, projectID, visible); collectErr != nil {
			_, _ = execContext(`UPDATE oncall_handovers SET collection_status = 'partial', missing_sections = $2, collected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, existingID, encodeJSONStringList([]string{collectErr.Error()}))
		}
		_ = carryForwardHandoverActions(existingID, teamID, endAt)
		row, getErr := getHandover(existingID, userID)
		if getErr == nil {
			remindHandoverDraft(row)
		}
		return row, getErr
	}
	var id int
	err = queryRowContext(`
		INSERT INTO oncall_handovers (
			team_id, team_name, project_id, timezone, shift_date, shift_end_at,
			outgoing_user_id, incoming_user_id, outgoing_name, incoming_name, state, notes
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
		ON CONFLICT (team_id, shift_end_at) DO UPDATE SET updated_at = oncall_handovers.updated_at
		RETURNING id
	`, teamID, teamName, projectID, timezone, outgoingDate, endAt, outgoing.UserID, incoming.UserID, outgoing.Name, incoming.Name, strings.TrimSpace(notes)).Scan(&id)
	if err != nil {
		return handoverView{}, err
	}
	var state string
	var collected sql.NullTime
	_ = queryRowContext(`SELECT state, collected_at FROM oncall_handovers WHERE id = $1`, id).Scan(&state, &collected)
	if state == "draft" && !collected.Valid {
		if collectErr := collectHandoverSnapshot(id, teamID, projectID, visible); collectErr != nil {
			_, _ = execContext(`UPDATE oncall_handovers SET collection_status = 'partial', missing_sections = $2, collected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, encodeJSONStringList([]string{collectErr.Error()}))
		}
		_ = carryForwardHandoverActions(id, teamID, endAt)
	}
	row, getErr := getHandover(id, userID)
	if getErr == nil && row.State == "draft" && row.CollectedAt != nil {
		remindHandoverDraft(row)
	}
	return row, getErr
}

func generateHandoversForVisibleTeams(userID int, timezone, shiftDate string) ([]handoverView, error) {
	if timezone == "" {
		timezone = "Asia/Kolkata"
	}
	visible := visibleProjectIDsForUser(userID)
	if len(visible) == 0 {
		return []handoverView{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT DISTINCT t.id, COALESCE(p.project_id, 0)
		FROM teams t
		LEFT JOIN project_oncall_teams p ON p.team_id = t.id
		WHERE p.project_id = ANY($1)
		ORDER BY t.id
	`, pq.Array(visible))
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	seen := map[int]bool{}
	out := []handoverView{}
	for rows.Next() {
		var teamID, projectID int
		if err := rows.Scan(&teamID, &projectID); err != nil {
			return nil, err
		}
		if teamID <= 0 || seen[teamID] {
			continue
		}
		seen[teamID] = true
		item, genErr := generateHandover(userID, teamID, projectID, timezone, shiftDate, "")
		if genErr != nil {
			continue
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
