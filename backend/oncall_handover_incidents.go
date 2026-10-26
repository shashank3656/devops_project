package main

import (
	"fmt"
	"strings"
)

func handoverReassignIncidentsEnabled(teamID, projectID int) bool {
	if DB == nil || teamID <= 0 {
		return false
	}
	var enabled bool
	query := `SELECT COALESCE(reassign_incidents_on_ack, FALSE) FROM oncall_schedules WHERE team_id = $1`
	args := []any{teamID}
	if projectID > 0 {
		query += ` AND project_id = $2`
		args = append(args, projectID)
	}
	query += ` ORDER BY id DESC LIMIT 1`
	if err := queryRowContext(query, args...).Scan(&enabled); err != nil {
		return false
	}
	return enabled
}

func handoverShouldReassignIncidents(requested *bool, teamID, projectID int) bool {
	if requested != nil {
		return *requested
	}
	return handoverReassignIncidentsEnabled(teamID, projectID)
}

func handoverIncidentIDs(items []handoverItemView) []int {
	out := []int{}
	seen := map[int]bool{}
	for _, item := range items {
		if !strings.EqualFold(item.SourceType, "incident") || item.SourceID <= 0 || seen[item.SourceID] {
			continue
		}
		if incidentStatusClosed(item.State) {
			continue
		}
		seen[item.SourceID] = true
		out = append(out, item.SourceID)
	}
	return out
}

func incidentStatusClosed(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "resolved", "closed", "cancelled", "canceled", "done":
		return true
	default:
		return false
	}
}

func incidentReassignmentNote(outgoing, incoming string, handoverID int) string {
	outgoing = strings.TrimSpace(outgoing)
	incoming = strings.TrimSpace(incoming)
	if outgoing == "" {
		outgoing = "Unknown"
	}
	if incoming == "" {
		incoming = "Unknown"
	}
	return fmt.Sprintf("Reassigned during handover %d from %s to %s. Incident status was not changed.", handoverID, outgoing, incoming)
}

func handoverIncidentAssignmentCopy(row handoverView) string {
	if row.IncidentsReassigned > 0 {
		return fmt.Sprintf("%d open incident(s) were reassigned to %s. Status was not changed to Fixed.", row.IncidentsReassigned, oncallKnownName(map[int]string{row.IncomingUserID: row.IncomingName}, row.IncomingUserID))
	}
	if row.ReassignIncidentsOnAck {
		return "Acknowledgement reassigns open incidents on this handover to the incoming person. Status is not changed to Fixed."
	}
	return "Acknowledgement transfers handover responsibility only. Open incidents stay assigned unless this acknowledgement reassigns them."
}

func reassignHandoverIncidents(row handoverView) (int, string) {
	if row.IncomingUserID <= 0 {
		return 0, ""
	}
	ids := handoverIncidentIDs(row.Items)
	if len(ids) == 0 {
		return 0, "No open incidents were on this handover."
	}
	note := incidentReassignmentNote(row.OutgoingName, row.IncomingName, row.ID)
	moved := 0
	refs := []string{}
	for _, id := range ids {
		res, err := execContext(`
			UPDATE request_incidents
			SET owner_user_id = $2,
			    notes = TRIM(BOTH FROM CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, $3)),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
			  AND LOWER(COALESCE(status, '')) NOT IN ('resolved', 'closed', 'cancelled', 'canceled')
		`, id, row.IncomingUserID, note)
		if err != nil {
			continue
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			continue
		}
		moved++
		refs = append(refs, formatIncidentNumber(id))
	}
	summary := "No open incidents were reassigned."
	if moved > 0 {
		summary = fmt.Sprintf("Reassigned %d open incident(s) to %s: %s. Status was not changed.", moved, oncallKnownName(map[int]string{row.IncomingUserID: row.IncomingName}, row.IncomingUserID), strings.Join(refs, ", "))
	}
	_, _ = execContext(`UPDATE oncall_handovers SET incidents_reassigned = $2, incident_reassign_note = $3 WHERE id = $1`, row.ID, moved, summary)
	return moved, summary
}
