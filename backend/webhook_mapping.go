package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errMappingHidden  = errors.New("mapping not found")
	errMappingDenied  = errors.New("mapping is not permitted")
	errMappingInvalid = errors.New("mapping is invalid")
)

type webhookMapping struct {
	ID        int
	ProjectID int
	Alias     string
	ServiceID int
	Version   int
	Active    bool
}

type mappingPreview struct {
	ProjectID      int    `json:"project_id"`
	Alias          string `json:"alias"`
	ServiceID      int    `json:"service_id"`
	CurrentVersion int    `json:"current_version"`
	NextVersion    int    `json:"next_version"`
	DryRun         bool   `json:"dry_run"`
	Effects        int    `json:"effects"`
}

type replayResult struct {
	InboxID        int    `json:"inbox_id"`
	RecordID       int    `json:"record_id"`
	ProjectID      int    `json:"project_id"`
	EventID        string `json:"event_id"`
	ActorID        int    `json:"actor_id"`
	Reason         string `json:"reason"`
	MappingVersion int    `json:"mapping_version"`
	ApprovalState  string `json:"approval_state"`
	Duplicate      bool   `json:"duplicate"`
	Stale          bool   `json:"stale"`
	Quarantined    bool   `json:"quarantined"`
}

type webhookActivity struct {
	InboxID         int    `json:"inbox_id"`
	ProjectID       int    `json:"project_id"`
	EventID         string `json:"event_id"`
	ExternalID      string `json:"external_id"`
	ReceivedAt      string `json:"received_at"`
	ProcessingState string `json:"processing_state"`
	ServiceAlias    string `json:"service_alias"`
	RecordID        int    `json:"record_id"`
	ServiceID       int    `json:"service_id"`
	MappingVersion  int    `json:"mapping_version"`
	CanReplay       bool   `json:"can_replay"`
}

type replayTarget struct {
	ID             int
	ProjectID      int
	Revision       int
	RecordID       int
	RecordRevision int
	MappingVersion int
	EventID        string
	ExternalID     string
	Alias          string
	Approval       string
	ReplayApplied  bool
}

var (
	loadMappingVersions  = loadMappingVersionsFromDB
	insertMappingVersion = insertMappingVersionToDB
	loadReplayTarget     = loadReplayTargetFromDB
	commitReplay         = commitReplayToDB
	noteReplay           = noteReplayToDB
	listActivityRows     = listActivityRowsFromDB
	activeWebhookMapping = activeWebhookMappingFromDB
)

func mappingAllowed(subject authzSubject, projectID int, action authzAction) bool {
	return catalogEnvironmentsAllowed(subject, projectID, nil, action)
}

func previewWebhookMapping(subject authzSubject, projectID int, alias string, serviceID int) (mappingPreview, error) {
	if !mappingAllowed(subject, projectID, authzRead) {
		return mappingPreview{}, errMappingHidden
	}
	alias = strings.ToLower(strings.TrimSpace(alias))
	if !outboxTypePattern.MatchString(alias) || serviceID <= 0 {
		return mappingPreview{}, errMappingInvalid
	}
	current := 0
	for _, version := range loadMappingVersions(projectID, alias) {
		if version > current {
			current = version
		}
	}
	return mappingPreview{
		ProjectID: projectID, Alias: alias, ServiceID: serviceID,
		CurrentVersion: current, NextVersion: current + 1, DryRun: true, Effects: 0,
	}, nil
}

func activateWebhookMapping(subject authzSubject, projectID int, alias string, serviceID int) (webhookMapping, error) {
	if !mappingAllowed(subject, projectID, authzRead) {
		return webhookMapping{}, errMappingHidden
	}
	if !mappingAllowed(subject, projectID, authzWrite) {
		return webhookMapping{}, errMappingDenied
	}
	preview, err := previewWebhookMapping(subject, projectID, alias, serviceID)
	if err != nil {
		return webhookMapping{}, err
	}
	return insertMappingVersion(webhookMapping{
		ProjectID: projectID, Alias: preview.Alias, ServiceID: serviceID, Version: preview.NextVersion, Active: true,
	})
}

func replayWebhookEvent(subject authzSubject, inboxID int, reason string) (replayResult, error) {
	target, err := loadReplayTarget(inboxID)
	if err != nil || target.ID <= 0 || target.ProjectID <= 0 {
		return replayResult{}, errMappingHidden
	}
	if !mappingAllowed(subject, target.ProjectID, authzRead) {
		return replayResult{}, errMappingHidden
	}
	if !mappingAllowed(subject, target.ProjectID, authzWrite) {
		return replayResult{}, errMappingDenied
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len(reason) > 200 {
		return replayResult{}, errMappingInvalid
	}
	mapping, ok := activeWebhookMapping(target.ProjectID, target.Alias)
	if target.Alias == "" || !ok {
		return replayResult{
			InboxID: target.ID, ProjectID: target.ProjectID, EventID: target.EventID,
			ActorID: subject.UserID, Reason: reason, Quarantined: true, ApprovalState: "pending",
		}, nil
	}
	if target.ReplayApplied {
		approval := target.Approval
		if approval == "" {
			approval = "pending"
		}
		return replayResult{
			InboxID: target.ID, RecordID: target.RecordID, ProjectID: target.ProjectID, EventID: target.EventID,
			ActorID: subject.UserID, Reason: reason, MappingVersion: mapping.Version,
			ApprovalState: approval, Duplicate: true,
		}, nil
	}
	if target.RecordID > 0 && target.RecordRevision > target.Revision {
		if err := noteReplay(target, subject.UserID, reason, mapping.Version, "stale"); err != nil {
			return replayResult{}, err
		}
		approval := target.Approval
		if approval == "" {
			approval = "pending"
		}
		return replayResult{
			InboxID: target.ID, RecordID: target.RecordID, ProjectID: target.ProjectID, EventID: target.EventID,
			ActorID: subject.UserID, Reason: reason, MappingVersion: mapping.Version,
			ApprovalState: approval, Stale: true,
		}, nil
	}
	if target.RecordID > 0 && target.MappingVersion > 0 {
		approval := target.Approval
		if approval == "" {
			approval = "pending"
		}
		return replayResult{
			InboxID: target.ID, RecordID: target.RecordID, ProjectID: target.ProjectID, EventID: target.EventID,
			ActorID: subject.UserID, Reason: reason, MappingVersion: target.MappingVersion,
			ApprovalState: approval, Duplicate: true,
		}, nil
	}
	return commitReplay(target, mapping, subject.UserID, reason)
}

func listWebhookActivity(subject authzSubject, projectID int, state string) ([]webhookActivity, error) {
	state = strings.ToLower(strings.TrimSpace(state))
	rows, err := listActivityRows(projectID, state)
	if err != nil {
		return nil, err
	}
	visible := make([]webhookActivity, 0, len(rows))
	for _, row := range rows {
		if row.ProjectID <= 0 || !mappingAllowed(subject, row.ProjectID, authzRead) {
			continue
		}
		if projectID > 0 && row.ProjectID != projectID {
			continue
		}
		if state != "" && row.ProcessingState != state {
			continue
		}
		row.CanReplay = mappingAllowed(subject, row.ProjectID, authzWrite)
		visible = append(visible, row)
	}
	return visible, nil
}

func activeWebhookMappingFromDB(projectID int, alias string) (webhookMapping, bool) {
	if DB == nil || projectID <= 0 || alias == "" {
		return webhookMapping{}, false
	}
	var item webhookMapping
	err := DB.QueryRow(`
		SELECT id, project_id, alias, service_id, version, active
		FROM webhook_mappings
		WHERE project_id = $1 AND alias = $2 AND active = TRUE
		ORDER BY version DESC
		LIMIT 1
	`, projectID, alias).Scan(&item.ID, &item.ProjectID, &item.Alias, &item.ServiceID, &item.Version, &item.Active)
	if err != nil {
		return webhookMapping{}, false
	}
	return item, true
}

func loadMappingVersionsFromDB(projectID int, alias string) []int {
	if DB == nil {
		return nil
	}
	rows, err := DB.Query(`SELECT version FROM webhook_mappings WHERE project_id = $1 AND alias = $2`, projectID, alias)
	if err != nil {
		return nil
	}
	defer rows.Close()
	versions := []int{}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return versions
		}
		versions = append(versions, version)
	}
	return versions
}

func insertMappingVersionToDB(item webhookMapping) (webhookMapping, error) {
	if DB == nil {
		return webhookMapping{}, errInboxStored
	}
	tx, err := DB.Begin()
	if err != nil {
		return webhookMapping{}, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`UPDATE webhook_mappings SET active = FALSE WHERE project_id = $1 AND alias = $2`, item.ProjectID, item.Alias); err != nil {
		return webhookMapping{}, err
	}
	err = tx.QueryRow(`
		INSERT INTO webhook_mappings (project_id, alias, service_id, version, active)
		VALUES ($1, $2, $3, $4, TRUE)
		RETURNING id
	`, item.ProjectID, item.Alias, item.ServiceID, item.Version).Scan(&item.ID)
	if err != nil {
		return webhookMapping{}, err
	}
	item.Active = true
	if err := tx.Commit(); err != nil {
		return webhookMapping{}, err
	}
	return item, nil
}

func loadReplayTargetFromDB(inboxID int) (replayTarget, error) {
	if DB == nil || inboxID <= 0 {
		return replayTarget{}, errMappingHidden
	}
	var target replayTarget
	var approval sql.NullString
	err := DB.QueryRow(`
		SELECT i.id, i.project_id, i.event_id, i.external_id, i.source_revision, i.service_alias,
			COALESCE(r.id, 0), COALESCE(r.revision, 0), COALESCE(r.mapping_version, 0), r.approval_state,
			EXISTS (
				SELECT 1 FROM webhook_replays p
				WHERE p.project_id = i.project_id AND p.event_id = i.event_id AND p.result = 'applied'
			)
		FROM webhook_inbox i
		LEFT JOIN webhook_records r ON r.project_id = i.project_id AND r.external_id = i.external_id
		WHERE i.id = $1
	`, inboxID).Scan(&target.ID, &target.ProjectID, &target.EventID, &target.ExternalID, &target.Revision, &target.Alias, &target.RecordID, &target.RecordRevision, &target.MappingVersion, &approval, &target.ReplayApplied)
	if errors.Is(err, sql.ErrNoRows) {
		return replayTarget{}, errMappingHidden
	}
	if err != nil {
		return replayTarget{}, err
	}
	target.Approval = "pending"
	if approval.Valid && approval.String != "" {
		target.Approval = approval.String
	}
	return target, nil
}

func commitReplayToDB(target replayTarget, mapping webhookMapping, actorID int, reason string) (replayResult, error) {
	if DB == nil {
		return replayResult{}, errInboxStored
	}
	tx, err := DB.Begin()
	if err != nil {
		return replayResult{}, err
	}
	defer tx.Rollback()
	recordID := target.RecordID
	if recordID <= 0 {
		err = tx.QueryRow(`
			INSERT INTO webhook_records (project_id, external_id, revision, event_type, inbox_id, service_id, mapping_version, approval_state)
			VALUES ($1, $2, $3, 'source.event', $4, $5, $6, 'pending')
			ON CONFLICT (project_id, external_id) DO UPDATE
			SET service_id = EXCLUDED.service_id, mapping_version = EXCLUDED.mapping_version, inbox_id = EXCLUDED.inbox_id, approval_state = 'pending', updated_at = CURRENT_TIMESTAMP
			RETURNING id
		`, target.ProjectID, target.ExternalID, target.Revision, target.ID, mapping.ServiceID, mapping.Version).Scan(&recordID)
	} else {
		err = tx.QueryRow(`
			UPDATE webhook_records
			SET service_id = $2, mapping_version = $3, approval_state = 'pending', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
			RETURNING id
		`, recordID, mapping.ServiceID, mapping.Version).Scan(&recordID)
	}
	if err != nil {
		return replayResult{}, err
	}
	if _, err = tx.Exec(`
		INSERT INTO webhook_replays (project_id, inbox_id, event_id, actor_id, reason, mapping_version, result)
		VALUES ($1, $2, $3, $4, $5, $6, 'applied')
	`, target.ProjectID, target.ID, target.EventID, actorID, reason, mapping.Version); err != nil {
		return replayResult{}, err
	}
	if _, err = tx.Exec(`UPDATE webhook_inbox SET processing_state = 'mapped', service_alias = $2 WHERE id = $1`, target.ID, mapping.Alias); err != nil {
		return replayResult{}, err
	}
	if err := notifyInboxApplied(inboxReceipt{ProjectID: target.ProjectID, EventID: target.EventID, ExternalID: target.ExternalID, Revision: target.Revision}); err != nil {
		return replayResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return replayResult{}, err
	}
	return replayResult{
		InboxID: target.ID, RecordID: recordID, ProjectID: target.ProjectID, EventID: target.EventID,
		ActorID: actorID, Reason: reason, MappingVersion: mapping.Version, ApprovalState: "pending",
	}, nil
}

func noteReplayToDB(target replayTarget, actorID int, reason string, version int, result string) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`
		INSERT INTO webhook_replays (project_id, inbox_id, event_id, actor_id, reason, mapping_version, result)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, target.ProjectID, target.ID, target.EventID, actorID, reason, version, result)
	return err
}

func listActivityRowsFromDB(projectID int, state string) ([]webhookActivity, error) {
	if DB == nil {
		return nil, errInboxStored
	}
	rows, err := DB.Query(`
		SELECT i.id, i.project_id, i.event_id, i.external_id, i.received_at, i.processing_state, i.service_alias,
			COALESCE(r.id, 0), COALESCE(r.service_id, 0), COALESCE(r.mapping_version, 0)
		FROM webhook_inbox i
		LEFT JOIN webhook_records r ON r.project_id = i.project_id AND r.external_id = i.external_id
		ORDER BY i.id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []webhookActivity{}
	for rows.Next() {
		var item webhookActivity
		var received time.Time
		if err := rows.Scan(&item.InboxID, &item.ProjectID, &item.EventID, &item.ExternalID, &received, &item.ProcessingState, &item.ServiceAlias, &item.RecordID, &item.ServiceID, &item.MappingVersion); err != nil {
			return nil, err
		}
		item.ReceivedAt = received.UTC().Format(time.RFC3339)
		if projectID > 0 && item.ProjectID != projectID {
			continue
		}
		if state != "" && item.ProcessingState != state {
			continue
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func webhookActivityHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	items, err := listWebhookActivity(subject, projectID, r.URL.Query().Get("state"))
	if err != nil {
		writeMappingError(w, r, err)
		return
	}
	if items == nil {
		items = []webhookActivity{}
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{"activity": items})
}

func webhookMappingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ProjectID int    `json:"project_id"`
		Alias     string `json:"alias"`
		ServiceID int    `json:"service_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeMappingError(w, r, errMappingInvalid)
		return
	}
	if strings.HasSuffix(strings.TrimRight(r.URL.Path, "/"), "/preview") {
		preview, err := previewWebhookMapping(subject, body.ProjectID, body.Alias, body.ServiceID)
		if err != nil {
			writeMappingError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, preview)
		return
	}
	item, err := activateWebhookMapping(subject, body.ProjectID, body.Alias, body.ServiceID)
	if err != nil {
		writeMappingError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, map[string]any{
		"id": item.ID, "project_id": item.ProjectID, "alias": item.Alias,
		"service_id": item.ServiceID, "version": item.Version, "active": item.Active,
	})
}

func replayWebhookHandler(w http.ResponseWriter, r *http.Request, inboxID int) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeMappingError(w, r, errMappingInvalid)
		return
	}
	result, err := replayWebhookEvent(subject, inboxID, body.Reason)
	if err != nil {
		writeMappingError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, result)
}

func writeMappingError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errMappingHidden):
		writeAPIError(w, r, http.StatusNotFound, errMappingHidden.Error(), nil)
	case errors.Is(err, errMappingDenied):
		writeAPIError(w, r, http.StatusForbidden, errMappingDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
