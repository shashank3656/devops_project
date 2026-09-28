package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func visibleProjectIDsForUser(userID int) []int {
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		return nil
	}
	ids := make([]int, 0, len(projects))
	for _, project := range projects {
		if project.ID > 0 {
			ids = append(ids, project.ID)
		}
	}
	return ids
}

func projectIDSet(ids []int) map[int]struct{} {
	out := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id > 0 {
			out[id] = struct{}{}
		}
	}
	return out
}

func changeVisibleToUser(item changeRequestRecord, projectIDs map[int]struct{}) bool {
	if item.ProjectID == nil || *item.ProjectID <= 0 {
		return false
	}
	_, ok := projectIDs[*item.ProjectID]
	return ok
}

func incidentVisibleToUser(item requestIncident, userID int, projectIDs map[int]struct{}) bool {
	if userID > 0 && item.OwnerUserID != nil && *item.OwnerUserID == userID {
		return true
	}
	if item.ProjectID != nil && *item.ProjectID > 0 {
		_, ok := projectIDs[*item.ProjectID]
		return ok
	}
	return false
}

func applyChangeTypeFilter(items []changeRequestRecord, changeType string) []changeRequestRecord {
	if strings.TrimSpace(changeType) == "" {
		return items
	}
	needle := normalizeChangeType(changeType)
	filtered := make([]changeRequestRecord, 0, len(items))
	for _, item := range items {
		if normalizeChangeType(item.ChangeType) == needle {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterChangesForUser(items []changeRequestRecord, projectIDs map[int]struct{}) []changeRequestRecord {
	filtered := make([]changeRequestRecord, 0, len(items))
	for _, item := range items {
		if changeVisibleToUser(item, projectIDs) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterIncidentsForUser(items []requestIncident, userID int, projectIDs map[int]struct{}) []requestIncident {
	filtered := make([]requestIncident, 0, len(items))
	for _, item := range items {
		if incidentVisibleToUser(item, userID, projectIDs) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterIncidentsForPortal(items []requestIncident, projectID int, environment, source, query string) []requestIncident {
	needle := strings.ToLower(strings.TrimSpace(query))
	env := strings.ToLower(strings.TrimSpace(environment))
	src := strings.ToLower(strings.TrimSpace(source))
	filtered := make([]requestIncident, 0, len(items))
	for _, item := range items {
		if projectID > 0 && (item.ProjectID == nil || *item.ProjectID != projectID) {
			continue
		}
		itemEnv := strings.ToLower(strings.TrimSpace(item.Environment))
		if itemEnv == "" {
			itemEnv = strings.ToLower(strings.TrimSpace(item.RequestEnv))
		}
		if env != "" && itemEnv != env {
			continue
		}
		if src != "" && strings.ToLower(strings.TrimSpace(item.Source)) != src {
			continue
		}
		if needle != "" {
			haystack := strings.ToLower(strings.Join([]string{
				item.IncidentNumber,
				item.Summary,
				item.Fingerprint,
				item.AlertSource,
				item.Service,
				item.RequestService,
				item.SuspectedChangeNumber,
			}, " "))
			if !strings.Contains(haystack, needle) {
				continue
			}
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func parsePositiveQueryID(r *http.Request, key string) int {
	id, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get(key)))
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func requestQueryEnv(r *http.Request) string {
	env := strings.TrimSpace(r.URL.Query().Get("environment"))
	if env == "" {
		env = strings.TrimSpace(r.URL.Query().Get("env"))
	}
	return env
}

func portalRecordIDFromPath(prefix string, r *http.Request) int {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, prefix), "/")
	if path == "" {
		return 0
	}
	id, err := strconv.Atoi(strings.Split(path, "/")[0])
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func writeChangeCatalog(w http.ResponseWriter, items []changeRequestRecord, changeType string) {
	items = applyChangeTypeFilter(items, changeType)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"changes": items,
		"status":  "ok",
	})
}

func writeChangeDetailJSON(w http.ResponseWriter, item *changeRequestRecord) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"change":           item,
		"change_brief":     changeBriefFromChangeRequest(*item),
		"linked_incidents": listIncidentsForChange(item.ID),
		"blast_radius":     blastRadiusForChange(*item),
		"drift":            detectServiceDrift(item.Service, item.Environment, item.SHA, item.ImageDigest),
		"delivery":         buildChangeDeliveryVisibility(item),
		"status":           "ok",
	})
}

func writeIncidentCatalog(w http.ResponseWriter, items []requestIncident) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"incidents": items,
		"status":    "ok",
	})
}

func writeIncidentDetailJSON(w http.ResponseWriter, item *requestIncident) {
	review, postmortem := incidentReviewPayload(item)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"incident":   item,
		"review":     review,
		"postmortem": postmortem,
		"status":     "ok",
	})
}

func listPortalChanges(r *http.Request) ([]changeRequestRecord, error) {
	return listChangeRequests(
		parsePositiveQueryID(r, "project_id"),
		r.URL.Query().Get("environment"),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("q"),
	)
}

func listPortalIncidents(r *http.Request) ([]requestIncident, error) {
	items, err := listRequestIncidentsFiltered(strings.TrimSpace(r.URL.Query().Get("status")), nil, false)
	if err != nil {
		return nil, err
	}
	return filterIncidentsForPortal(
		items,
		parsePositiveQueryID(r, "project_id"),
		r.URL.Query().Get("environment"),
		r.URL.Query().Get("source"),
		r.URL.Query().Get("q"),
	), nil
}

func adminChangesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := listPortalChanges(r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list changes", err)
		return
	}
	writeChangeCatalog(w, items, r.URL.Query().Get("change_type"))
}

func applyChangePortalAction(id, userID int, action string) (*changeRequestRecord, error) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "cab-approve", "approve":
		return approveChangeCAB(id, userID)
	case "schedule":
		return scheduleChangeRequest(id, userID)
	case "implement":
		return startChangeImplementation(id, userID)
	case "resolve":
		return transitionChangeStatus(id, "resolved")
	case "close":
		return transitionChangeStatus(id, "closed")
	case "fail":
		return transitionChangeStatus(id, "failed")
	case "cancel":
		return transitionChangeStatus(id, "cancelled")
	case "reopen":
		return transitionChangeStatus(id, "reopen")
	default:
		return nil, fmt.Errorf("unsupported change action %q", action)
	}
}

func writeChangeActionResult(w http.ResponseWriter, r *http.Request, item *changeRequestRecord, err error) {
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"change": item, "status": "ok"})
}

func adminChangeDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	adminID, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/admin/changes/"), "/")
	if r.Method == http.MethodPost && path == "bulk" {
		var body struct {
			IDs    []int  `json:"ids"`
			Action string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		updated := []changeRequestRecord{}
		errors := []string{}
		for _, changeID := range body.IDs {
			if changeID <= 0 {
				continue
			}
			item, err := applyChangePortalAction(changeID, adminID, body.Action)
			if err != nil {
				errors = append(errors, fmt.Sprintf("%d: %s", changeID, err.Error()))
				continue
			}
			if item != nil {
				updated = append(updated, *item)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"changes": updated,
			"errors":  errors,
			"status":  "ok",
		})
		return
	}
	id := portalRecordIDFromPath("/api/admin/changes/", r)
	if id == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid change id", nil)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 2 {
		action := strings.ToLower(strings.TrimSpace(parts[1]))
		switch action {
		case "cab-approve", "approve", "schedule", "implement", "resolve", "close", "fail", "cancel", "reopen":
			if r.Method != http.MethodPost {
				writeMethodNotAllowed(w, r)
				return
			}
			item, err := applyChangePortalAction(id, adminID, action)
			writeChangeActionResult(w, r, item, err)
			return
		}
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	item, err := getChangeRequestByID(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "change not found", err)
		return
	}
	writeChangeDetailJSON(w, item)
}

func adminIncidentsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := listPortalIncidents(r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list incidents", err)
		return
	}
	writeIncidentCatalog(w, items)
}

func adminIncidentDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	id := portalRecordIDFromPath("/api/admin/incidents/", r)
	if id == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid incident id", nil)
		return
	}
	item, err := getRequestIncidentByID(id)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
		return
	}
	writeIncidentDetailJSON(w, item)
}

func meChangesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	items, err := listPortalChanges(r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to list changes", err)
		return
	}
	writeChangeCatalog(w, filterChangesForUser(items, projectIDSet(visibleProjectIDsForUser(userID))), r.URL.Query().Get("change_type"))
}

func meChangeDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	id := portalRecordIDFromPath("/api/me/changes/", r)
	if id == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid change id", nil)
		return
	}
	item, err := getChangeRequestByID(id)
	if err != nil || !changeVisibleToUser(*item, projectIDSet(visibleProjectIDsForUser(userID))) {
		writeAPIError(w, r, http.StatusNotFound, "change not found", err)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/me/changes/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 {
		action := strings.ToLower(strings.TrimSpace(parts[1]))
		switch action {
		case "cab-approve", "approve", "schedule", "implement", "close", "cancel":
			if r.Method != http.MethodPost {
				writeMethodNotAllowed(w, r)
				return
			}
			if !userCanAuthorizeChange(userID) {
				writeAPIError(w, r, http.StatusForbidden, "not authorized to update changes", nil)
				return
			}
			updated, actionErr := applyChangePortalAction(id, userID, action)
			writeChangeActionResult(w, r, updated, actionErr)
			return
		}
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	writeChangeDetailJSON(w, item)
}

func meIncidentDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	id := portalRecordIDFromPath("/api/me/incidents/", r)
	if id == 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid incident id", nil)
		return
	}
	item, err := getRequestIncidentByID(id)
	if err != nil || !incidentVisibleToUser(*item, userID, projectIDSet(visibleProjectIDsForUser(userID))) {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
		return
	}
	writeIncidentDetailJSON(w, item)
}
