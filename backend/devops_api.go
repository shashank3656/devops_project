package main

import (
	"encoding/json"
	"net/http"
)

// requireDevopsUser validates Bearer token and ensures user is devops_user. Returns userID and ok.
func requireDevopsUser(w http.ResponseWriter, r *http.Request) (userID int, ok bool) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return 0, false
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return 0, false
	}
	token := authHeader[7:]
	uid, err := validateToken(token)
	if err != nil || uid <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid or expired token", "status": "error"})
		return 0, false
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return 0, false
	}
	user, err := GetUserByID(uid)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user not found", "status": "error"})
		return 0, false
	}
	if user.UserType != "devops_user" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "DevOps portal access is for DevOps users only", "status": "error"})
		return 0, false
	}
	return uid, true
}

// requireDevopsManager validates Bearer token, ensures devops_user and is_manager. Returns userID and ok.
func requireDevopsManager(w http.ResponseWriter, r *http.Request) (userID int, ok bool) {
	uid, ok := requireDevopsUser(w, r)
	if !ok {
		return 0, false
	}
	prof, err := GetDevopsProfile(uid)
	if err != nil || prof == nil || !prof.IsManager {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "DevOps manager access required", "status": "error"})
		return 0, false
	}
	return uid, true
}

// devopsMeHandler GET /api/devops/me - current DevOps user + profile
func devopsMeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	user, _ := GetUserByID(userID)
	prof, _ := GetDevopsProfile(userID)
	resp := map[string]interface{}{
		"id": user.ID, "username": user.Username, "email": user.Email,
		"user_type": user.UserType,
	}
	if prof != nil {
		resp["devops_profile"] = map[string]interface{}{
			"is_manager": prof.IsManager, "position": prof.Position,
			"onboard_date": prof.OnboardDate, "level": prof.Level,
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"user": resp, "status": "ok"})
}

// devopsTicketsHandler GET /api/devops/tickets - my assigned tickets (assigned_to = me)
func devopsTicketsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	// Get requests where assigned_to = userID; use GetPRRequests with a filter. We don't have assigned_to filter yet - add it or query directly.
	requests, err := GetPRRequestsByAssignedTo(userID, 100, 0)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"tickets": requests, "status": "ok"})
}

// devopsWorkloadHandler GET /api/devops/workload - manager only; requests with assigned_to set, optionally grouped by assignee
func devopsWorkloadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		enableCORS(w)
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	workload, err := GetWorkloadAssignedRequests()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"workload": workload, "status": "ok"})
}
