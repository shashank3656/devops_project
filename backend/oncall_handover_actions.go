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

func acknowledgeHandover(id, userID, expectedRevision int, reviewed []int, reasons map[string]string) (handoverView, error) {
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
	notifyHandover(row, "oncall_handover_acknowledged", "Handover acknowledged",
		fmt.Sprintf("%s acknowledged the %s handover. Incident assignment is unchanged.", row.IncomingName, row.TeamName),
		[]int{row.OutgoingUserID})
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

func escalateOverdueHandovers(now time.Time) int {
	if DB == nil {
		return 0
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, team_id, team_name, project_id, incoming_user_id, incoming_name, outgoing_user_id, outgoing_name, revision, shift_end_at
		FROM oncall_handovers
		WHERE state = 'submitted' AND acknowledged_at IS NULL AND escalated_at IS NULL AND shift_end_at <= $1
	`, now.Add(-15*time.Minute))
	if err != nil {
		return 0
	}
	defer cancel()
	defer rows.Close()
	count := 0
	for rows.Next() {
		var row handoverView
		if err := rows.Scan(&row.ID, &row.TeamID, &row.TeamName, &row.ProjectID, &row.IncomingUserID, &row.IncomingName, &row.OutgoingUserID, &row.OutgoingName, &row.Revision, &row.ShiftEndAt); err != nil {
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
		SELECT DISTINCT t.id, COALESCE(p.project_id, 0), COALESCE(s.timezone, 'Asia/Kolkata')
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
		var teamID, projectID int
		var timezone string
		if err := rows.Scan(&teamID, &projectID, &timezone); err != nil {
			continue
		}
		if !oncallTimezoneAllowed(timezone) {
			timezone = "Asia/Kolkata"
		}
		loc := handoverLocation(timezone)
		local := now.In(loc)
		boundary := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
		if local.Before(boundary.Add(-30*time.Minute)) || local.After(boundary.Add(15*time.Minute)) {
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
