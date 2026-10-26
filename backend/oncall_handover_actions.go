package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func snapshotHandoverRevision(handoverID, revision, userID int, state, notes string) error {
	items, _ := loadHandoverItems(handoverID)
	actions, _ := loadHandoverActions(handoverID)
	itemJSON, _ := json.Marshal(items)
	actionJSON, _ := json.Marshal(actions)
	_, err := execContext(`
		INSERT INTO oncall_handover_revisions (handover_id, revision, state, notes, items_json, actions_json, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (handover_id, revision) DO NOTHING
	`, handoverID, revision, state, notes, string(itemJSON), string(actionJSON), userID)
	return err
}

func updateHandoverDraft(id, userID int, notes string, incomingUserID int) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !row.CanEdit {
		return handoverView{}, errHandoverState
	}
	incomingName := row.IncomingName
	if incomingUserID > 0 && incomingUserID != row.IncomingUserID {
		names := oncallUserNames([]int{incomingUserID})
		incomingName = oncallKnownName(names, incomingUserID)
		row.IncomingUserID = incomingUserID
		row.IncomingName = incomingName
	}
	_, err = execContext(`
		UPDATE oncall_handovers
		SET notes = $2, incoming_user_id = $3, incoming_name = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND state = 'draft' AND revision = $5
	`, id, strings.TrimSpace(notes), row.IncomingUserID, incomingName, row.Revision)
	if err != nil {
		return handoverView{}, err
	}
	return getHandover(id, userID)
}

func submitHandover(id, userID int) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !row.CanSubmit {
		return handoverView{}, errHandoverState
	}
	if row.IncomingUserID <= 0 {
		return handoverView{}, fmt.Errorf("incoming responder is missing")
	}
	if err := snapshotHandoverRevision(id, row.Revision, userID, "submitted", row.Notes); err != nil {
		return handoverView{}, err
	}
	res, err := execContext(`
		UPDATE oncall_handovers
		SET state = 'submitted', submitted_at = CURRENT_TIMESTAMP, submitted_by = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND state = 'draft' AND revision = $3
	`, id, userID, row.Revision)
	if err != nil {
		return handoverView{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return handoverView{}, errHandoverConflict
	}
	notifyHandover(row, "oncall_handover_submitted", "Handover ready for acknowledgement",
		fmt.Sprintf("%s handed over %s to %s. Acknowledgement does not reassign incidents.", row.OutgoingName, row.TeamName, row.IncomingName),
		[]int{row.IncomingUserID})
	return getHandover(id, userID)
}

func criticalHandoverItems(items []handoverItemView) []handoverItemView {
	out := []handoverItemView{}
	for _, item := range items {
		if item.Critical {
			out = append(out, item)
		}
	}
	return out
}

func acknowledgeHandover(id, userID, expectedRevision int, reviewed []int, reasons map[string]string, reassignIncidents *bool) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !row.CanAcknowledge {
		return handoverView{}, errHandoverState
	}
	if expectedRevision != row.Revision {
		return handoverView{}, errHandoverConflict
	}
	reviewedSet := map[int]bool{}
	for _, itemID := range reviewed {
		reviewedSet[itemID] = true
	}
	for _, item := range criticalHandoverItems(row.Items) {
		if reviewedSet[item.ID] {
			continue
		}
		reason := strings.TrimSpace(reasons[fmt.Sprintf("%d", item.ID)])
		if reason == "" {
			return handoverView{}, fmt.Errorf("critical item %s needs a review checkbox or a reason", item.SourceRef)
		}
	}
	if err := snapshotHandoverRevision(id, row.Revision, userID, "acknowledged", row.Notes); err != nil {
		return handoverView{}, err
	}
	res, err := execContext(`
		UPDATE oncall_handovers
		SET state = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND state = 'submitted' AND revision = $3
	`, id, userID, row.Revision)
	if err != nil {
		return handoverView{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return handoverView{}, errHandoverConflict
	}
	moved := 0
	summary := "Incident assignment is unchanged."
	if handoverShouldReassignIncidents(reassignIncidents, row.TeamID, row.ProjectID) {
		moved, summary = reassignHandoverIncidents(row)
		if strings.TrimSpace(summary) == "" {
			summary = "Incident assignment is unchanged."
		}
	}
	notifyHandover(row, "oncall_handover_acknowledged", "Handover acknowledged",
		fmt.Sprintf("%s acknowledged the %s handover. %s", row.IncomingName, row.TeamName, summary),
		[]int{row.OutgoingUserID})
	_ = moved
	return getHandover(id, userID)
}

func cancelHandover(id, userID int, reason string) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !row.CanCancel {
		return handoverView{}, errHandoverState
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return handoverView{}, fmt.Errorf("a cancel reason is required")
	}
	_, err = execContext(`
		UPDATE oncall_handovers
		SET state = 'cancelled', cancel_reason = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND state IN ('draft', 'submitted')
	`, id, reason)
	if err != nil {
		return handoverView{}, err
	}
	return getHandover(id, userID)
}

func upsertHandoverAction(id, userID int, actionID int, title, sourceType, sourceRef, owner, next, status string, sourceID int, due *time.Time) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !(row.CanEdit || row.CanAcknowledge || canManageHandoverTeam(userID, row.TeamID)) {
		return handoverView{}, errHandoverDenied
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		status = "open"
	}
	if status != "open" && status != "done" && status != "cancelled" {
		return handoverView{}, errOncallInvalid
	}
	if actionID > 0 {
		_, err = execContext(`
			UPDATE oncall_handover_actions
			SET status = $2, next_action = COALESCE(NULLIF($3, ''), next_action), updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND handover_id = $4
		`, actionID, status, strings.TrimSpace(next), id)
	} else {
		if strings.TrimSpace(title) == "" {
			return handoverView{}, errOncallInvalid
		}
		_, err = execContext(`
			INSERT INTO oncall_handover_actions (
				handover_id, source_type, source_id, source_ref, title, owner_name, next_action, status, due_at, carried
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, FALSE)
		`, id, sourceType, sourceID, sourceRef, title, owner, next, status, due)
	}
	if err != nil {
		return handoverView{}, err
	}
	return getHandover(id, userID)
}

func reopenHandoverAfterEdit(id, userID int, notes string) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if row.State != "acknowledged" || !(userID == row.OutgoingUserID || canManageHandoverTeam(userID, row.TeamID)) {
		return handoverView{}, errHandoverState
	}
	nextRevision := row.Revision + 1
	_, err = execContext(`
		UPDATE oncall_handovers
		SET notes = $2, state = 'submitted', revision = $3, acknowledged_at = NULL, acknowledged_by = 0,
		    submitted_at = CURRENT_TIMESTAMP, submitted_by = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND revision = $5 AND state = 'acknowledged'
	`, id, strings.TrimSpace(notes), nextRevision, userID, row.Revision)
	if err != nil {
		return handoverView{}, err
	}
	_ = snapshotHandoverRevision(id, nextRevision, userID, "submitted", strings.TrimSpace(notes))
	row.Revision = nextRevision
	notifyHandover(row, "oncall_handover_revised", "Handover revised",
		fmt.Sprintf("The %s handover changed after acknowledgement and needs a new acknowledgement.", row.TeamName),
		[]int{row.IncomingUserID})
	return getHandover(id, userID)
}

func reassignHandover(id, userID, incomingUserID int, reason string) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !row.CanReassign {
		return handoverView{}, errHandoverDenied
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || incomingUserID <= 0 {
		return handoverView{}, errOncallInvalid
	}
	allowed := false
	for _, person := range row.People {
		if person.UserID == incomingUserID {
			allowed = true
			break
		}
	}
	if !allowed {
		return handoverView{}, errOncallInvalid
	}
	names := oncallUserNames([]int{incomingUserID})
	incomingName := oncallKnownName(names, incomingUserID)
	nextRevision := row.Revision
	nextState := row.State
	if row.State == "submitted" {
		nextRevision = row.Revision + 1
		nextState = "submitted"
	}
	res, err := execContext(`
		UPDATE oncall_handovers
		SET incoming_user_id = $2, incoming_name = $3, revision = $4, state = $5,
		    acknowledged_at = NULL, acknowledged_by = 0, notes = CASE WHEN $6 <> '' THEN notes || E'\n' || $6 ELSE notes END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND revision = $7 AND state IN ('draft', 'submitted')
	`, id, incomingUserID, incomingName, nextRevision, nextState, "Reassigned: "+reason, row.Revision)
	if err != nil {
		return handoverView{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return handoverView{}, errHandoverConflict
	}
	row.IncomingUserID = incomingUserID
	row.IncomingName = incomingName
	row.Revision = nextRevision
	notifyHandover(row, "oncall_handover_revised", "Handover incoming person reassigned",
		fmt.Sprintf("A lead reassigned the %s handover to %s. Acknowledgement does not reassign incidents. Reason: %s", row.TeamName, incomingName, reason),
		[]int{incomingUserID, row.OutgoingUserID})
	return getHandover(id, userID)
}

func notifyHandover(row handoverView, category, title, message string, recipients []int) {
	if row.IncomingUserID > 0 {
		recipients = append(recipients, row.IncomingUserID)
	}
	if row.OutgoingUserID > 0 {
		recipients = append(recipients, row.OutgoingUserID)
	}
	if team, err := GetTeamByID(row.TeamID); err == nil && team != nil {
		if leads, leadErr := GetPortalManagerUserIDsByTeamNameOrSlug(team.Name); leadErr == nil {
			recipients = append(recipients, leads...)
		}
	}
	var projectPtr *int
	if row.ProjectID > 0 {
		projectPtr = &row.ProjectID
	}
	key := fmt.Sprintf("handover:%s:%d:%d", category, row.ID, row.Revision)
	_ = dispatchOpsNotification(key, category, title, message, nil, projectPtr, recipients, map[string]any{
		"handover_id": row.ID,
		"team_id":     row.TeamID,
		"revision":    row.Revision,
		"state":       row.State,
	})
}

func pingHandoverShift(id, userID int) (handoverView, error) {
	row, err := getHandover(id, userID)
	if err != nil {
		return handoverView{}, err
	}
	if !(row.CanEdit || row.CanSubmit || row.CanAcknowledge || row.CanReassign || userID == row.OutgoingUserID || userID == row.IncomingUserID) {
		return handoverView{}, errHandoverDenied
	}
	recipients := []int{row.IncomingUserID, row.OutgoingUserID}
	var projectPtr *int
	if row.ProjectID > 0 {
		projectPtr = &row.ProjectID
	}
	if team, teamErr := GetTeamByID(row.TeamID); teamErr == nil && team != nil {
		if leads, leadErr := GetPortalManagerUserIDsByTeamNameOrSlug(team.Name); leadErr == nil {
			recipients = append(recipients, leads...)
		}
	}
	_ = dispatchOpsNotification(
		fmt.Sprintf("handover:shift:%d:%d", row.ID, time.Now().UTC().Unix()),
		"oncall_handover_reminder",
		"Handover for this shift",
		fmt.Sprintf("%s handover for %s is ready. %s to %s. Acknowledgement does not reassign incidents.", row.TeamName, row.ShiftDate, row.OutgoingName, row.IncomingName),
		nil,
		projectPtr,
		recipients,
		map[string]any{"handover_id": row.ID, "team_id": row.TeamID, "revision": row.Revision, "state": row.State},
	)
	return row, nil
}

func remindHandoverDraft(row handoverView) {
	if row.ID <= 0 || !strings.EqualFold(row.State, "draft") {
		return
	}
	notifyHandover(row, "oncall_handover_reminder", "Handover draft is ready",
		fmt.Sprintf("Complete the %s handover before the shift ends. Acknowledgement does not reassign incidents.", row.TeamName),
		[]int{row.OutgoingUserID})
}

func remindDueHandoverDrafts(now time.Time) int {
	if DB == nil {
		return 0
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT h.id, h.shift_end_at, COALESCE(s.handover_remind_minutes, 30)
		FROM oncall_handovers h
		LEFT JOIN oncall_schedules s ON s.team_id = h.team_id AND (h.project_id = 0 OR s.project_id = h.project_id)
		WHERE h.state = 'draft' AND h.shift_end_at > $1
	`, now)
	if err != nil {
		return 0
	}
	defer cancel()
	defer rows.Close()
	seen := map[int]bool{}
	count := 0
	for rows.Next() {
		var id, remind int
		var endAt time.Time
		if err := rows.Scan(&id, &endAt, &remind); err != nil {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		if endAt.After(now.Add(time.Duration(handoverRemindMinutes(remind)) * time.Minute)) {
			continue
		}
		row, getErr := getHandover(id, 0)
		if getErr != nil {
			continue
		}
		remindHandoverDraft(row)
		count++
	}
	return count
}

func escalateOverdueHandovers(now time.Time) int {
	if DB == nil {
		return 0
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT h.id, h.team_id, h.team_name, h.project_id, h.incoming_user_id, h.incoming_name, h.outgoing_user_id, h.outgoing_name, h.revision, h.shift_end_at,
		       COALESCE(s.handover_escalate_minutes, 15)
		FROM oncall_handovers h
		LEFT JOIN oncall_schedules s ON s.team_id = h.team_id AND (h.project_id = 0 OR s.project_id = h.project_id)
		WHERE h.state = 'submitted' AND h.acknowledged_at IS NULL AND h.escalated_at IS NULL
	`)
	if err != nil {
		return 0
	}
	defer cancel()
	defer rows.Close()
	seen := map[int]bool{}
	count := 0
	for rows.Next() {
		var row handoverView
		var escalate int
		if err := rows.Scan(&row.ID, &row.TeamID, &row.TeamName, &row.ProjectID, &row.IncomingUserID, &row.IncomingName, &row.OutgoingUserID, &row.OutgoingName, &row.Revision, &row.ShiftEndAt, &escalate); err != nil {
			continue
		}
		if seen[row.ID] {
			continue
		}
		seen[row.ID] = true
		if now.Before(row.ShiftEndAt.Add(time.Duration(handoverEscalateMinutes(escalate)) * time.Minute)) {
			continue
		}
		_, _ = execContext(`UPDATE oncall_handovers SET escalated_at = CURRENT_TIMESTAMP WHERE id = $1 AND escalated_at IS NULL`, row.ID)
		notifyHandover(row, "oncall_handover_escalated", "Handover acknowledgement overdue",
			fmt.Sprintf("The %s handover is still waiting for acknowledgement. Incidents were not reassigned.", row.TeamName),
			nil)
		count++
	}
	return count
}

func generateDueHandoverDrafts(now time.Time) int {
	if DB == nil {
		return 0
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT DISTINCT t.id, COALESCE(p.project_id, 0), COALESCE(s.timezone, 'Asia/Kolkata'),
		       COALESCE(s.handover_remind_minutes, 30), COALESCE(s.handover_escalate_minutes, 15)
		FROM oncall_roster r
		INNER JOIN teams t ON t.id = r.team_id
		LEFT JOIN project_oncall_teams p ON p.team_id = t.id
		LEFT JOIN oncall_schedules s ON s.team_id = t.id AND s.project_id = p.project_id
	`)
	if err != nil {
		return 0
	}
	defer cancel()
	defer rows.Close()
	count := 0
	seen := map[string]bool{}
	for rows.Next() {
		var teamID, projectID, remind, escalate int
		var timezone string
		if err := rows.Scan(&teamID, &projectID, &timezone, &remind, &escalate); err != nil {
			continue
		}
		if !oncallTimezoneAllowed(timezone) {
			timezone = "Asia/Kolkata"
		}
		loc := handoverLocation(timezone)
		local := now.In(loc)
		boundary := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
		if local.Before(boundary.Add(-time.Duration(handoverRemindMinutes(remind))*time.Minute)) || local.After(boundary.Add(time.Duration(handoverEscalateMinutes(escalate))*time.Minute)) {
			continue
		}
		shiftDate := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).Format("2006-01-02")
		key := fmt.Sprintf("%d:%s", teamID, shiftDate)
		if seen[key] {
			continue
		}
		seen[key] = true
		if _, err := generateHandover(0, teamID, projectID, timezone, shiftDate, ""); err == nil {
			count++
		}
	}
	return count
}
