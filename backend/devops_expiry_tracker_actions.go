package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type expiryTrackerActionRecord struct {
	ID                int       `json:"id"`
	ItemKey           string    `json:"item_key"`
	WorkflowState     string    `json:"workflow_state"`
	Note              string    `json:"note"`
	UpdatedBy         *int      `json:"updated_by,omitempty"`
	UpdatedByUsername string    `json:"updated_by_username,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type expiryTrackerActionRequest struct {
	ItemKey       string `json:"item_key"`
	WorkflowState string `json:"workflow_state"`
	Note          string `json:"note"`
}

func normalizeExpiryTrackerWorkflowState(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "open", "todo", "pending":
		return "open"
	case "acknowledged", "ack", "acked":
		return "acknowledged"
	case "in_progress", "in-progress", "inprogress", "working":
		return "in_progress"
	case "rotated", "done", "completed", "resolved":
		return "rotated"
	default:
		return ""
	}
}

func expiryTrackerActionWorkflowOptions() []string {
	return []string{"open", "acknowledged", "in_progress", "rotated"}
}

func listExpiryTrackerActions(itemKeys []string) (map[string]expiryTrackerActionRecord, error) {
	actions := make(map[string]expiryTrackerActionRecord)
	if len(itemKeys) == 0 {
		return actions, nil
	}

	uniqueKeys := make([]string, 0, len(itemKeys))
	seen := make(map[string]struct{}, len(itemKeys))
	for _, itemKey := range itemKeys {
		trimmed := strings.TrimSpace(itemKey)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		uniqueKeys = append(uniqueKeys, trimmed)
	}
	if len(uniqueKeys) == 0 {
		return actions, nil
	}

	placeholders := make([]string, 0, len(uniqueKeys))
	args := make([]interface{}, 0, len(uniqueKeys))
	for _, itemKey := range uniqueKeys {
		args = append(args, itemKey)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}

	rows, cancel, err := queryRowsWithTimeout(fmt.Sprintf(`
		SELECT a.id,
		       a.item_key,
		       COALESCE(a.workflow_state, 'open'),
		       COALESCE(a.note, ''),
		       a.updated_by,
		       COALESCE(u.username, ''),
		       a.created_at,
		       a.updated_at
		FROM expiry_tracker_actions a
		LEFT JOIN users u ON u.id = a.updated_by
		WHERE a.item_key IN (%s)
	`, strings.Join(placeholders, ", ")), args...)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return actions, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	for rows.Next() {
		var record expiryTrackerActionRecord
		var updatedBy sql.NullInt64
		if err := rows.Scan(
			&record.ID,
			&record.ItemKey,
			&record.WorkflowState,
			&record.Note,
			&updatedBy,
			&record.UpdatedByUsername,
			&record.CreatedAt,
			&record.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if updatedBy.Valid {
			value := int(updatedBy.Int64)
			record.UpdatedBy = &value
		}
		record.WorkflowState = normalizeExpiryTrackerWorkflowState(record.WorkflowState)
		if record.WorkflowState == "" {
			record.WorkflowState = "open"
		}
		actions[record.ItemKey] = record
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return actions, nil
}

func upsertExpiryTrackerAction(itemKey, workflowState, note string, updatedBy int) (*expiryTrackerActionRecord, error) {
	itemKey = strings.TrimSpace(itemKey)
	if itemKey == "" {
		return nil, fmt.Errorf("item key is required")
	}
	if updatedBy <= 0 {
		return nil, fmt.Errorf("updated by user is required")
	}

	normalizedState := normalizeExpiryTrackerWorkflowState(workflowState)
	if normalizedState == "" {
		return nil, fmt.Errorf("workflow state must be one of: %s", strings.Join(expiryTrackerActionWorkflowOptions(), ", "))
	}

	trimmedNote := strings.TrimSpace(note)
	if len(trimmedNote) > 1000 {
		trimmedNote = trimmedNote[:1000]
	}

	if normalizedState == "open" {
		if _, err := execContext(`
			DELETE FROM expiry_tracker_actions
			WHERE item_key = $1
		`, itemKey); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
				return nil, fmt.Errorf("expiry tracker actions table is missing; run database migration")
			}
			return nil, err
		}
		record := &expiryTrackerActionRecord{
			ItemKey:       itemKey,
			WorkflowState: "open",
			Note:          trimmedNote,
			UpdatedBy:     &updatedBy,
			UpdatedAt:     time.Now(),
		}
		if user, err := GetUserByID(updatedBy); err == nil && user != nil {
			record.UpdatedByUsername = user.Username
		}
		return record, nil
	}

	var record expiryTrackerActionRecord
	var updatedByValue sql.NullInt64
	err := queryRowContext(`
		WITH upserted AS (
			INSERT INTO expiry_tracker_actions (
				item_key,
				workflow_state,
				note,
				updated_by
			)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (item_key) DO UPDATE
			SET workflow_state = EXCLUDED.workflow_state,
			    note = EXCLUDED.note,
			    updated_by = EXCLUDED.updated_by,
			    updated_at = CURRENT_TIMESTAMP
			RETURNING id, item_key, workflow_state, note, updated_by, created_at, updated_at
		)
		SELECT u.id,
		       u.item_key,
		       u.workflow_state,
		       u.note,
		       u.updated_by,
		       COALESCE(owner.username, ''),
		       u.created_at,
		       u.updated_at
		FROM upserted u
		LEFT JOIN users owner ON owner.id = u.updated_by
	`, itemKey, normalizedState, trimmedNote, updatedBy).Scan(
		&record.ID,
		&record.ItemKey,
		&record.WorkflowState,
		&record.Note,
		&updatedByValue,
		&record.UpdatedByUsername,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return nil, fmt.Errorf("expiry tracker actions table is missing; run database migration")
		}
		return nil, err
	}
	if updatedByValue.Valid {
		value := int(updatedByValue.Int64)
		record.UpdatedBy = &value
	}
	return &record, nil
}

func expiryTrackerItemKeys(items []expiryTrackerItem) []string {
	keys := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ItemKey) == "" {
			continue
		}
		keys = append(keys, item.ItemKey)
	}
	return keys
}

func applyExpiryTrackerActions(payload *expiryTrackerPayload, actions map[string]expiryTrackerActionRecord) {
	if payload == nil {
		return
	}

	payload.Summary.ActionableCount = 0
	payload.Summary.AcknowledgedCount = 0
	payload.Summary.InProgressCount = 0
	payload.Summary.RotatedCount = 0

	for index := range payload.Items {
		item := &payload.Items[index]
		item.WorkflowState = "open"
		item.WorkflowNote = ""
		item.WorkflowUpdatedAt = nil
		item.WorkflowUpdatedByUsername = ""

		if action, ok := actions[item.ItemKey]; ok {
			item.WorkflowState = action.WorkflowState
			item.WorkflowNote = action.Note
			item.WorkflowUpdatedAt = timePointer(action.UpdatedAt)
			item.WorkflowUpdatedByUsername = action.UpdatedByUsername
		}

		switch item.WorkflowState {
		case "acknowledged":
			payload.Summary.AcknowledgedCount++
		case "in_progress":
			payload.Summary.InProgressCount++
		case "rotated":
			payload.Summary.RotatedCount++
		}

		if item.Status != "healthy" && item.WorkflowState != "rotated" {
			payload.Summary.ActionableCount++
		}
	}
}

func devopsExpiryTrackerActionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost, http.MethodOptions)
		return
	}

	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	var payload expiryTrackerActionRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}

	record, err := upsertExpiryTrackerAction(payload.ItemKey, payload.WorkflowState, payload.Note, userID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "failed to update expiry tracker workflow", err)
		return
	}

	if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"item":   record,
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write expiry tracker response", err)
	}
}
