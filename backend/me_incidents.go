package main

import (
	"net/http"
)

// meIncidentsHandler lists incidents assigned to the user or on their projects.
func meIncidentsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}

	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}

	items, err := listPortalIncidents(r)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load incidents", err)
		return
	}
	visible := filterIncidentsForUser(items, userID, projectIDSet(visibleProjectIDsForUser(userID)))
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, sanitizeJSONValue(map[string]any{
		"incidents": visible,
		"status":    "ok",
	}))
}
