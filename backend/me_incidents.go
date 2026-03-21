package main

import (
	"net/http"
	"strings"
)

// meIncidentsHandler lists incidents assigned to the authenticated portal user.
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

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		writeAPIError(w, r, http.StatusUnauthorized, "missing or invalid authorization", nil)
		return
	}
	token := strings.TrimSpace(authHeader[7:])
	userID, err := validateToken(token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, err.Error(), err)
		return
	}

	items, err := listAssignedRequestIncidents(userID, strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load assigned incidents", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, sanitizeJSONValue(map[string]any{
		"incidents": items,
		"status":    "ok",
	}))
}
