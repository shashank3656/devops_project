package main

import (
	"net/http"
	"strconv"
	"strings"
)

// meDbQueryRequestsRouter handles /api/me/db-query-requests and /api/me/db-query-requests/:id
func meDbQueryRequestsRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/me/db-query-requests")
	path = strings.Trim(path, "/")
	if path == "" {
		if r.Method == "GET" {
			dbQueryMyRequestsHandler(w, r)
		} else {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	id, err := strconv.Atoi(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if r.Method == "GET" {
		dbQueryResultHandler(w, r, id)
	} else {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
