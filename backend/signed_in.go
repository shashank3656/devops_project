package main

import (
	"net/http"
	"strings"
)

func bearerToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(auth) > 7 && strings.EqualFold(auth[:7], "Bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
}

func requireSignedIn(w http.ResponseWriter, r *http.Request) (int, *User, bool) {
	id, _, err := validateTokenOrAPIKey(bearerToken(r))
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", err)
		return 0, nil, false
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", err)
		return 0, nil, false
	}
	return id, user, true
}
