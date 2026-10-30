package main

import (
	"fmt"
	"strings"
	"time"
)

const errChangeScopeRequired = "Project and environment are required before this change can enter execution. The title is not used as scope."

func changeEnvironmentMissing(env string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(env))
	return trimmed == "" || trimmed == "unspecified" || trimmed == "unknown" || trimmed == "—" || trimmed == "-"
}

func changeProjectMissing(item changeRequestRecord) bool {
	if strings.TrimSpace(item.ProjectName) != "" || strings.TrimSpace(item.ProjectCode) != "" {
		return false
	}
	return item.ProjectID == nil || *item.ProjectID <= 0
}

func changeScopeIncomplete(item changeRequestRecord) bool {
	return changeEnvironmentMissing(item.Environment) || changeProjectMissing(item)
}

func changeHoldIfExecutingWithoutScope(status string) bool {
	switch normalizeChangeStatus(status) {
	case "scheduled", "implementing":
		return true
	default:
		return false
	}
}

func changeRequiresCompleteScope(status string) bool {
	switch normalizeChangeStatus(status) {
	case "scheduled", "implementing", "implemented", "monitoring":
		return true
	default:
		return false
	}
}

func clampChangeStatusToScope(status string, projectID *int, environment string) string {
	normalized := normalizeChangeStatus(status)
	if !changeRequiresCompleteScope(normalized) {
		return normalized
	}
	if projectID == nil || *projectID <= 0 || changeEnvironmentMissing(environment) {
		return "new"
	}
	return normalized
}

func fillChangeScopeFromCatalog(item *changeRequestRecord) bool {
	if item == nil {
		return false
	}
	env := item.Environment
	if changeEnvironmentMissing(env) {
		env = ""
	}
	mapped := lookupServiceMap(item.Service, item.Repo, env)
	if mapped == nil {
		return false
	}
	changed := false
	if changeProjectMissing(*item) && mapped.ProjectID != nil {
		if validated := lookupProjectID(*mapped.ProjectID, ""); validated != nil {
			item.ProjectID = validated
			changed = true
		}
	}
	if changeEnvironmentMissing(item.Environment) && strings.TrimSpace(mapped.Environment) != "" {
		item.Environment = strings.ToLower(strings.TrimSpace(mapped.Environment))
		changed = true
	}
	return changed
}

func updateChangeWindow(id int, start, end *time.Time) (*changeRequestRecord, error) {
	if id <= 0 || DB == nil {
		return nil, fmt.Errorf("change not found")
	}
	if start == nil && end == nil {
		return nil, fmt.Errorf("select a deployment window")
	}
	if start != nil && end != nil && end.Before(*start) {
		return nil, fmt.Errorf("planned end must be after planned start")
	}
	var startAny any
	var endAny any
	if start != nil {
		startAny = start.UTC()
	}
	if end != nil {
		endAny = end.UTC()
	}
	if _, err := execContext(`
		UPDATE change_requests
		SET cab_window_start = $2, cab_window_end = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, startAny, endAny); err != nil {
		return nil, err
	}
	return getChangeRequestByID(id)
}

func persistChangeScope(item *changeRequestRecord) error {
	if item == nil || item.ID <= 0 || DB == nil {
		return fmt.Errorf("change not found")
	}
	var projectAny any
	if item.ProjectID != nil && *item.ProjectID > 0 {
		projectAny = *item.ProjectID
	}
	_, err := execContext(`
		UPDATE change_requests
		SET project_id = $2, environment = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, item.ID, projectAny, strings.TrimSpace(item.Environment))
	return err
}

func updateChangeScope(id, projectID int, environment string) (*changeRequestRecord, error) {
	item, err := getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if projectID > 0 {
		validated := lookupProjectID(projectID, "")
		if validated == nil {
			return nil, fmt.Errorf("selected project is not valid")
		}
		item.ProjectID = validated
	}
	env := strings.ToLower(strings.TrimSpace(environment))
	if env != "" && !changeEnvironmentMissing(env) {
		item.Environment = env
	}
	if err := persistChangeScope(item); err != nil {
		return nil, err
	}
	item, err = getChangeRequestByID(id)
	if err != nil {
		return nil, err
	}
	if changeHoldIfExecutingWithoutScope(item.Status) && changeScopeIncomplete(*item) {
		if fillChangeScopeFromCatalog(item) {
			_ = persistChangeScope(item)
			item, err = getChangeRequestByID(id)
			if err != nil {
				return nil, err
			}
		}
		if changeScopeIncomplete(*item) {
			if err := setChangeStatus(id, "new"); err != nil {
				return nil, err
			}
			return getChangeRequestByID(id)
		}
	}
	return item, nil
}

func requireChangeScopeForExecution(item *changeRequestRecord, want string) error {
	if item == nil {
		return fmt.Errorf("change not found")
	}
	if !changeRequiresCompleteScope(want) {
		return nil
	}
	if changeScopeIncomplete(*item) {
		fillChangeScopeFromCatalog(item)
		if !changeScopeIncomplete(*item) {
			_ = persistChangeScope(item)
			return nil
		}
		return fmt.Errorf("%s", errChangeScopeRequired)
	}
	return nil
}

func correctIncompleteExecutingChanges() {
	if DB == nil {
		return
	}
	rows, err := DB.Query(`SELECT id FROM change_requests WHERE LOWER(status) IN ('scheduled', 'implementing')`)
	if err != nil {
		return
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return
	}
	for _, id := range ids {
		item, err := getChangeRequestByID(id)
		if err != nil || item == nil {
			continue
		}
		if !changeHoldIfExecutingWithoutScope(item.Status) || !changeScopeIncomplete(*item) {
			continue
		}
		if fillChangeScopeFromCatalog(item) {
			_ = persistChangeScope(item)
			reloaded, reloadErr := getChangeRequestByID(id)
			if reloadErr == nil && reloaded != nil && !changeScopeIncomplete(*reloaded) {
				continue
			}
		}
		_ = setChangeStatus(id, "new")
	}
}
