package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

type handoverCollectItem struct {
	SourceType string
	SourceID   int
	SourceRef  string
	ProjectID  int
	Title      string
	OwnerName  string
	State      string
	NextAction string
	Deadline   *time.Time
	Href       string
	Critical   bool
	Section    string
}

func handoverProjectIDsForTeam(teamID, fallback int, visible map[int]struct{}) []int {
	ids := []int{}
	rows, cancel, err := queryRowsWithTimeout(`SELECT project_id FROM project_oncall_teams WHERE team_id = $1`, teamID)
	if err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var id int
			if err := rows.Scan(&id); err == nil && id > 0 {
				if _, ok := visible[id]; ok || len(visible) == 0 {
					ids = append(ids, id)
				}
			}
		}
	}
	if fallback > 0 {
		found := false
		for _, id := range ids {
			if id == fallback {
				found = true
				break
			}
		}
		if !found {
			if _, ok := visible[fallback]; ok || len(visible) == 0 {
				ids = append(ids, fallback)
			}
		}
	}
	return ids
}

func insertHandoverItem(handoverID int, item handoverCollectItem, now time.Time) error {
	owner := strings.TrimSpace(item.OwnerName)
	if owner == "" {
		owner = "Unknown"
	}
	_, err := execContext(`
		INSERT INTO oncall_handover_items (
			handover_id, source_type, source_id, source_ref, project_id, title, owner_name, state, next_action, deadline, href, critical, section, collected_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`, handoverID, item.SourceType, item.SourceID, item.SourceRef, item.ProjectID, item.Title, owner, item.State, item.NextAction, item.Deadline, item.Href, item.Critical, item.Section, now)
	return err
}

func collectHandoverSnapshot(handoverID, teamID, projectID int, visible map[int]struct{}) error {
	now := time.Now().UTC()
	_, _ = execContext(`DELETE FROM oncall_handover_items WHERE handover_id = $1`, handoverID)
	missing := []string{}
	projects := handoverProjectIDsForTeam(teamID, projectID, visible)
	if len(projects) == 0 {
		missing = append(missing, "No authorized projects were in scope.")
		_, _ = execContext(`UPDATE oncall_handovers SET collection_status = $2, missing_sections = $3, collected_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, handoverID, "partial", encodeJSONStringList(missing), now)
		return nil
	}

	if err := collectHandoverIncidents(handoverID, projects, now); err != nil {
		missing = append(missing, "Open incidents could not be read.")
	}
	if err := collectHandoverFindings(handoverID, projects, now); err != nil {
		missing = append(missing, "Actionable findings could not be read.")
	}
	if err := collectHandoverChanges(handoverID, projects, now); err != nil {
		missing = append(missing, "Upcoming changes could not be read.")
	}
	if err := collectHandoverMaintenance(handoverID, projects, now); err != nil {
		missing = append(missing, "Maintenance windows could not be read.")
	}

	status := "complete"
	if len(missing) > 0 {
		status = "partial"
	}
	_, err := execContext(`UPDATE oncall_handovers SET collection_status = $2, missing_sections = $3, collected_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, handoverID, status, encodeJSONStringList(missing), now)
	return err
}

func collectHandoverIncidents(handoverID int, projects []int, now time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT i.id, COALESCE(i.project_id, 0), COALESCE(i.severity, ''), COALESCE(i.status, ''),
		       COALESCE(i.summary, ''), COALESCE(u.username, ''), COALESCE(i.major, FALSE), i.updated_at
		FROM request_incidents i
		LEFT JOIN users u ON u.id = i.owner_user_id
		WHERE COALESCE(i.project_id, 0) = ANY($1)
		  AND LOWER(COALESCE(i.status, '')) NOT IN ('resolved', 'closed', 'cancelled')
		ORDER BY CASE WHEN LOWER(COALESCE(i.severity, '')) IN ('critical', 'high') OR COALESCE(i.major, FALSE) THEN 0 ELSE 1 END, i.id
		LIMIT 80
	`, pq.Array(projects))
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, projectID int
		var severity, status, summary, owner string
		var major bool
		var updated time.Time
		if err := rows.Scan(&id, &projectID, &severity, &status, &summary, &owner, &major, &updated); err != nil {
			return err
		}
		title := strings.TrimSpace(summary)
		if title == "" {
			title = formatIncidentNumber(id)
		}
		critical := major || strings.EqualFold(severity, "critical") || strings.EqualFold(severity, "high")
		item := handoverCollectItem{
			SourceType: "incident",
			SourceID:   id,
			SourceRef:  formatIncidentNumber(id),
			ProjectID:  projectID,
			Title:      title,
			OwnerName:  owner,
			State:      status,
			NextAction: "Review current state before the incoming shift starts.",
			Href:       fmt.Sprintf("/incidents/%d/edit", id),
			Critical:   critical,
			Section:    "open_work",
		}
		if err := insertHandoverItem(handoverID, item, now); err != nil {
			return err
		}
	}
	return rows.Err()
}

func collectHandoverFindings(handoverID int, projects []int, now time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT f.id, COALESCE(r.project_id, 0), COALESCE(a.canonical_id, ''), COALESCE(a.title, ''),
		       COALESCE(a.severity, ''), COALESCE(f.package_name, ''), COALESCE(f.lifecycle, ''), f.due_at
		FROM vuln_findings f
		JOIN vuln_advisories a ON a.id = f.advisory_id
		JOIN vuln_repositories r ON r.id = f.repo_id
		WHERE COALESCE(r.project_id, 0) = ANY($1)
		  AND f.confidence = 'confirmed'
		  AND f.lifecycle NOT IN ('fixed', 'withdrawn', 'false_positive', 'risk_accepted')
		ORDER BY CASE WHEN LOWER(COALESCE(a.severity, '')) IN ('critical', 'high') THEN 0 ELSE 1 END, f.id
		LIMIT 80
	`, pq.Array(projects))
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, projectID int
		var canonical, title, severity, pkg, lifecycle string
		var due *time.Time
		if err := rows.Scan(&id, &projectID, &canonical, &title, &severity, &pkg, &lifecycle, &due); err != nil {
			return err
		}
		label := strings.TrimSpace(title)
		if label == "" {
			label = canonical
		}
		if pkg != "" {
			label = label + " · " + pkg
		}
		item := handoverCollectItem{
			SourceType: "finding",
			SourceID:   id,
			SourceRef:  canonical,
			ProjectID:  projectID,
			Title:      label,
			State:      lifecycle,
			NextAction: "Keep the finding open until it is closed in Vulnerabilities.",
			Deadline:   due,
			Href:       fmt.Sprintf("/security/vulnerabilities?finding=%d", id),
			Critical:   strings.EqualFold(severity, "critical") || strings.EqualFold(severity, "high"),
			Section:    "open_work",
		}
		if err := insertHandoverItem(handoverID, item, now); err != nil {
			return err
		}
	}
	return rows.Err()
}

func collectHandoverChanges(handoverID int, projects []int, now time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT c.id, COALESCE(c.project_id, 0), COALESCE(c.change_number, ''), COALESCE(c.title, ''),
		       COALESCE(c.status, ''), COALESCE(c.service, ''), COALESCE(u.username, ''), c.cab_window_start
		FROM change_requests c
		LEFT JOIN users u ON u.id = c.assignee_user_id
		WHERE COALESCE(c.project_id, 0) = ANY($1)
		  AND LOWER(COALESCE(c.status, '')) NOT IN ('closed', 'cancelled', 'rolled_back', 'completed', 'done')
		ORDER BY c.cab_window_start NULLS LAST, c.id DESC
		LIMIT 40
	`, pq.Array(projects))
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, projectID int
		var number, title, status, service, owner string
		var window *time.Time
		if err := rows.Scan(&id, &projectID, &number, &title, &status, &service, &owner, &window); err != nil {
			return err
		}
		ref := strings.TrimSpace(number)
		if ref == "" {
			ref = formatChangeNumber(id)
		}
		label := strings.TrimSpace(title)
		if label == "" {
			label = ref
		}
		if service != "" {
			label = label + " · " + service
		}
		item := handoverCollectItem{
			SourceType: "change",
			SourceID:   id,
			SourceRef:  ref,
			ProjectID:  projectID,
			Title:      label,
			OwnerName:  owner,
			State:      status,
			NextAction: "Watch the change window. Do not treat a merged PR as done.",
			Deadline:   window,
			Href:       fmt.Sprintf("/changes/%d", id),
			Section:    "upcoming_risk",
		}
		if err := insertHandoverItem(handoverID, item, now); err != nil {
			return err
		}
	}
	return rows.Err()
}

func collectHandoverMaintenance(handoverID int, projects []int, now time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, project_id, COALESCE(service, ''), COALESCE(status, ''), COALESCE(owner_name, ''), starts_at, ends_at
		FROM maintenance_windows
		WHERE project_id = ANY($1)
		  AND ends_at > $2
		  AND starts_at < $3
		ORDER BY starts_at
		LIMIT 40
	`, pq.Array(projects), now, now.Add(7*24*time.Hour))
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, projectID int
		var service, status, owner string
		var start, end time.Time
		if err := rows.Scan(&id, &projectID, &service, &status, &owner, &start, &end); err != nil {
			return err
		}
		title := maintenanceWindowNumber(id)
		if strings.TrimSpace(service) != "" {
			title = title + " · " + service
		}
		deadline := end
		item := handoverCollectItem{
			SourceType: "maintenance",
			SourceID:   id,
			SourceRef:  maintenanceWindowNumber(id),
			ProjectID:  projectID,
			Title:      title,
			OwnerName:  owner,
			State:      status,
			NextAction: "Confirm the window still applies before the incoming shift.",
			Deadline:   &deadline,
			Href:       fmt.Sprintf("/maintenance/%d", id),
			Section:    "upcoming_risk",
		}
		if err := insertHandoverItem(handoverID, item, now); err != nil {
			return err
		}
	}
	return rows.Err()
}

func carryForwardHandoverActions(handoverID, teamID int, shiftEnd time.Time) error {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT a.source_type, a.source_id, a.source_ref, a.title, a.owner_name, a.next_action, a.due_at
		FROM oncall_handover_actions a
		INNER JOIN oncall_handovers h ON h.id = a.handover_id
		WHERE h.team_id = $1 AND h.id <> $2 AND h.shift_end_at < $3
		  AND LOWER(a.status) NOT IN ('done', 'completed', 'cancelled')
		ORDER BY h.shift_end_at DESC, a.id
		LIMIT 40
	`, teamID, handoverID, shiftEnd)
	if err != nil {
		return err
	}
	defer cancel()
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var sourceType, sourceRef, title, owner, next string
		var sourceID int
		var due *time.Time
		if err := rows.Scan(&sourceType, &sourceID, &sourceRef, &title, &owner, &next, &due); err != nil {
			return err
		}
		key := sourceType + ":" + strings.TrimSpace(sourceRef)
		if sourceID > 0 {
			key = fmt.Sprintf("%s:%d", sourceType, sourceID)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		_, err := execContext(`
			INSERT INTO oncall_handover_actions (
				handover_id, source_type, source_id, source_ref, title, owner_name, next_action, status, due_at, carried
			) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8, TRUE)
		`, handoverID, sourceType, sourceID, sourceRef, title, owner, next, due)
		if err != nil {
			return err
		}
	}
	return rows.Err()
}
