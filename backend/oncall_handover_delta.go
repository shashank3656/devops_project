package main

import (
	"fmt"
	"strings"
	"time"
)

func handoverItemKey(sourceType string, sourceID int, sourceRef string) string {
	if sourceID > 0 {
		return fmt.Sprintf("%s:%d", sourceType, sourceID)
	}
	return sourceType + ":" + strings.TrimSpace(sourceRef)
}

func handoverPeople(teamID int) []handoverPerson {
	ids := []int{}
	if roster, err := listOncallRoster(teamID); err == nil {
		ids = append(ids, roster...)
	}
	if members, err := GetTeamMembers(teamID); err == nil {
		for _, member := range members {
			if member.UserID > 0 {
				ids = append(ids, member.UserID)
			}
		}
	}
	names := oncallUserNames(ids)
	seen := map[int]bool{}
	out := []handoverPerson{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, handoverPerson{UserID: id, Name: oncallKnownName(names, id)})
	}
	return out
}

func collectItemAsView(item handoverCollectItem) handoverItemView {
	return handoverItemView{
		SourceType: item.SourceType,
		SourceID:   item.SourceID,
		SourceRef:  item.SourceRef,
		ProjectID:  item.ProjectID,
		Title:      item.Title,
		OwnerName:  item.OwnerName,
		State:      item.State,
		NextAction: item.NextAction,
		Deadline:   item.Deadline,
		Href:       item.Href,
		Critical:   item.Critical,
		Section:    item.Section,
	}
}

func liveHandoverDelta(row handoverView, visible map[int]struct{}) handoverDeltaView {
	delta := handoverDeltaView{
		Added:       []handoverItemView{},
		Removed:     []handoverItemView{},
		Changed:     []handoverDeltaChange{},
		CollectedAt: row.CollectedAt,
		Note:        "Live changes since collection. The snapshot is unchanged.",
	}
	if DB == nil {
		return delta
	}
	projects := handoverProjectIDsForTeam(row.TeamID, row.ProjectID, visible)
	now := time.Now().UTC()
	live := []handoverCollectItem{}
	_ = collectHandoverIncidents(0, projects, now, &live)
	_ = collectHandoverFindings(0, projects, now, &live)
	_ = collectHandoverChanges(0, projects, now, &live)
	_ = collectHandoverMaintenance(0, projects, now, &live)
	liveByKey := map[string]handoverItemView{}
	for _, item := range live {
		view := collectItemAsView(item)
		liveByKey[handoverItemKey(view.SourceType, view.SourceID, view.SourceRef)] = view
	}
	snapByKey := map[string]handoverItemView{}
	for _, item := range row.Items {
		snapByKey[handoverItemKey(item.SourceType, item.SourceID, item.SourceRef)] = item
	}
	for key, liveItem := range liveByKey {
		snap, ok := snapByKey[key]
		if !ok {
			delta.Added = append(delta.Added, liveItem)
			continue
		}
		if snap.State != liveItem.State || snap.OwnerName != liveItem.OwnerName || snap.Title != liveItem.Title {
			delta.Changed = append(delta.Changed, handoverDeltaChange{
				SourceRef: liveItem.SourceRef,
				Title:     liveItem.Title,
				Before:    strings.TrimSpace(snap.State + " · " + snap.OwnerName),
				After:     strings.TrimSpace(liveItem.State + " · " + liveItem.OwnerName),
			})
		}
	}
	for key, snap := range snapByKey {
		if _, ok := liveByKey[key]; !ok {
			delta.Removed = append(delta.Removed, snap)
		}
	}
	return delta
}

func workspaceHandoverQueue(projectID string, viewerID int) []workspaceQueueItem {
	items := []workspaceQueueItem{}
	if DB == nil || viewerID <= 0 {
		return items
	}
	query := `
		SELECT id, team_name, state, shift_date, incoming_user_id, outgoing_user_id, incoming_name, outgoing_name
		FROM oncall_handovers
		WHERE ((state = 'draft' AND outgoing_user_id = $1) OR (state = 'submitted' AND incoming_user_id = $1))
	`
	args := []any{viewerID}
	if id := workspaceProjectID(projectID); id > 0 {
		query += ` AND project_id = $2`
		args = append(args, id)
	}
	query += ` ORDER BY shift_end_at ASC, id ASC LIMIT 8`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return items
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, incomingID, outgoingID int
		var team, state, incomingName, outgoingName string
		var shiftDate time.Time
		if err := rows.Scan(&id, &team, &state, &shiftDate, &incomingID, &outgoingID, &incomingName, &outgoingName); err != nil {
			continue
		}
		title := "On-call handover waiting"
		action := "Open"
		tone := "warning"
		if strings.EqualFold(state, "draft") && outgoingID == viewerID {
			title = "Submit handover for " + team
			action = "Submit"
		} else if strings.EqualFold(state, "submitted") && incomingID == viewerID {
			title = "Acknowledge handover for " + team
			action = "Acknowledge"
			tone = "danger"
		} else if strings.EqualFold(state, "draft") {
			title = "Handover draft for " + team
		} else {
			title = "Handover awaiting acknowledgement for " + team
		}
		items = append(items, workspaceQueueItem{
			ID:     fmt.Sprintf("handover-%d", id),
			Kind:   "handover",
			Title:  title,
			Meta:   fmt.Sprintf("%s · %s", shiftDate.Format("2006-01-02"), oncallKnownName(map[int]string{incomingID: incomingName, outgoingID: outgoingName}, incomingID)),
			Href:   fmt.Sprintf("/on-call/handovers/%d", id),
			Action: action,
			Tone:   tone,
		})
	}
	return items
}
