package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// requireDevopsUser validates Bearer token and ensures user is devops_user or admin. Returns userID and ok.
// Admin users (role=admin) can access DevOps endpoints for template management.
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
	// Allow devops_user OR admin (for template management from either portal)
	if user.UserType != "devops_user" && user.Role != "admin" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "DevOps portal access is for DevOps users or admins only", "status": "error"})
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
		"user_type": user.UserType, "role": user.Role,
	}
	if prof != nil {
		resp["devops_profile"] = map[string]interface{}{
			"is_manager": prof.IsManager, "position": prof.Position,
			"onboard_date": prof.OnboardDate, "level": prof.Level,
		}
	}
	teams, _ := GetDevopsTeamsForUser(userID)
	if len(teams) > 0 {
		resp["teams"] = teams
	} else {
		resp["teams"] = []interface{}{}
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

// devopsUsersHandler GET /api/devops/users - manager only; list of DevOps users for workload filter
func devopsUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"users": []interface{}{}, "status": "ok"})
		return
	}
	users, err := GetDevopsUsers()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"users": users, "status": "ok"})
}

// devopsWorkloadHandler GET /api/devops/workload - manager only; in-progress list + summary by_team and by_person (open, in_progress, completed_this_week)
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
	workload, err := GetWorkloadAllInProgress()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	byTeam, _ := GetWorkloadSummaryByTeam()
	byPerson, _ := GetWorkloadSummaryByPerson()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workload":  workload,
		"by_team":   byTeam,
		"by_person": byPerson,
		"status":    "ok",
	})
}

// dueStatus returns "overdue", "due_soon", or "" for SLA display
func dueStatus(due *time.Time) string {
	if due == nil {
		return ""
	}
	now := time.Now()
	if due.Before(now) {
		return "overdue"
	}
	if due.Before(now.Add(24 * time.Hour)) {
		return "due_soon"
	}
	return ""
}

// devopsRequestsListHandler GET /api/devops/requests - manager only; list tickets with filters (id, team, cloud, status, requester), sort, at_risk
func devopsRequestsListHandler(w http.ResponseWriter, r *http.Request) {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	team := strings.TrimSpace(r.URL.Query().Get("team"))
	cloud := strings.TrimSpace(r.URL.Query().Get("cloud"))
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	prID := 0
	if idStr := r.URL.Query().Get("id"); idStr != "" {
		if n, err := strconv.Atoi(idStr); err == nil && n > 0 {
			prID = n
		}
	}
	requesterID := 0
	if reqStr := r.URL.Query().Get("requester"); reqStr != "" {
		if n, err := strconv.Atoi(reqStr); err == nil && n > 0 {
			requesterID = n
		}
	}
	var createdByIn []int
	if requesterID > 0 {
		createdByIn = []int{requesterID}
	}
	sortBy := strings.TrimSpace(r.URL.Query().Get("sort_by"))
	if sortBy != "created_at" && sortBy != "updated_at" && sortBy != "priority" && sortBy != "due_date" {
		sortBy = "created_at"
	}
	sortOrder := strings.TrimSpace(r.URL.Query().Get("sort_order"))
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "desc"
	}
	atRiskOnly := r.URL.Query().Get("at_risk") == "1" || strings.ToLower(r.URL.Query().Get("at_risk")) == "true"
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	requests, err := GetPRRequests(team, "", cloud, statusFilter, "", search, prID, 0, createdByIn, limit, offset, sortBy, sortOrder, atRiskOnly, "", "")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	totalCount, _ := GetTotalCount(team, "", cloud, statusFilter, "", search, prID, 0, createdByIn, atRiskOnly, "", "")
	userIDs := make([]int, 0)
	for _, req := range requests {
		if req.CreatedBy != nil && *req.CreatedBy > 0 {
			userIDs = append(userIDs, *req.CreatedBy)
		}
	}
	usernames, _ := GetUsernamesByUserIDs(userIDs)
	out := make([]map[string]interface{}, 0, len(requests))
	for _, req := range requests {
		obj := map[string]interface{}{
			"id": req.ID, "team": req.Team, "env": req.Env, "cloud": req.Cloud, "service": req.Service,
			"client_name": req.ClientName, "application_id": req.ApplicationID, "priority": req.Priority,
			"due_date": req.DueDate, "pr_url": req.PRURL, "branch": req.Branch, "status": req.Status,
			"created_by": req.CreatedBy, "assigned_to": req.AssignedTo, "created_at": req.CreatedAt, "updated_at": req.UpdatedAt,
		}
		obj["due_status"] = dueStatus(req.DueDate)
		if req.CreatedBy != nil && usernames != nil {
			obj["created_by_username"] = usernames[*req.CreatedBy]
		}
		out = append(out, obj)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"requests": out, "total_count": totalCount, "limit": limit, "offset": offset, "status": "ok",
	})
}

// devopsDashboardStatsHandler GET /api/devops/dashboard-stats - manager only; counts for DevOps manager dashboard
func devopsDashboardStatsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"pending_approval": 0, "in_progress": 0, "status": "ok",
		})
		return
	}
	pending, _ := GetPendingDevopsApprovalCount()
	var inProgress int
	_ = DB.QueryRow("SELECT COUNT(*) FROM pr_requests WHERE status = 'in_progress'").Scan(&inProgress)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pending_approval": pending,
		"in_progress":      inProgress,
		"status":           "ok",
	})
}

// devopsNotificationsHandler GET /api/devops/notifications - manager only; count of requests pending DevOps approval (for badge)
func devopsNotificationsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"pending_approval_count": 0, "status": "ok"})
		return
	}
	count, _ := GetPendingDevopsApprovalCount()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"pending_approval_count": count, "status": "ok"})
}

// devopsPendingApprovalsHandler GET /api/devops/pending-approvals - manager only; list of requests pending_devops_approval
func devopsPendingApprovalsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
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
	requests, err := GetPRRequests("", "", "", "pending_devops_approval", "", "", 0, 0, nil, 100, 0, "", "", false, "", "")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"requests": requests, "status": "ok"})
}

// devopsMyTeamsHandler GET /api/devops/my-teams - DevOps teams the current user belongs to
func devopsMyTeamsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
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
	teams, err := GetDevopsTeamsForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"teams": teams, "status": "ok"})
}

// devopsTeamsRouter handles /api/devops/teams/:id/members - POST add member (DevOps manager only)
func devopsTeamsRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/teams/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[1] != "members" {
		http.NotFound(w, r)
		return
	}
	teamID, _ := strconv.Atoi(parts[0])
	if teamID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid team id", "status": "error"})
		return
	}
	userID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if !CanUserManageDevopsTeam(userID, teamID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "you cannot manage this team", "status": "error"})
		return
	}
	if r.Method == "GET" {
		members, err := GetTeamMembers(teamID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"members": members, "status": "ok"})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		UserID int    `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	var targetUserID int
	if body.UserID > 0 {
		targetUserID = body.UserID
	} else if body.Email != "" {
		u, err := GetUserByEmailOrUsername(strings.TrimSpace(body.Email))
		if err != nil || u == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "user not found", "status": "error"})
			return
		}
		targetUserID = u.ID
	}
	if targetUserID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "user_id or email required", "status": "error"})
		return
	}
	role := strings.TrimSpace(body.Role)
	if role == "" {
		role = "member"
	}
	if !ValidDevopsRole(role) {
		role = "member"
	}
	member, err := AddTeamMember(teamID, targetUserID, role)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"member": member, "status": "ok"})
}

// devopsTemplatesRouter handles /api/devops/templates - Any devops_user can list, create, update, delete templates
func devopsTemplatesRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	var userIDPtr *int
	if userID > 0 {
		userIDPtr = &userID
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/devops/templates/")
	path = strings.Trim(path, "/")
	w.Header().Set("Content-Type", "application/json")
	if path == "" {
		switch r.Method {
		case "GET":
			list, err := ListRequestTemplates()
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"templates": list, "status": "ok"})
			return
		case "POST":
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Cloud       string `json:"cloud"`
				Env         string `json:"env"`
				Service     string `json:"service"`
				Config      string `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
				return
			}
			name := strings.TrimSpace(body.Name)
			if name == "" || strings.TrimSpace(body.Cloud) == "" || strings.TrimSpace(body.Env) == "" || strings.TrimSpace(body.Service) == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "name, cloud, env, service required", "status": "error"})
				return
			}
			config := body.Config
			if config == "" {
				config = "{}"
			}
			t, err := CreateRequestTemplate(name, strings.TrimSpace(body.Description), strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service), config, userIDPtr)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
				return
			}
			AppendAuditLog(userIDPtr, "template_create", "request_template", strconv.Itoa(t.ID), "devops:"+name)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"template": t, "status": "ok"})
			return
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
	}

	id, err := strconv.Atoi(path)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	t, err := GetRequestTemplateByID(id)
	if err != nil || t == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "template not found", "status": "error"})
		return
	}

	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(map[string]interface{}{"template": t, "status": "ok"})
		return
	case "PUT", "PATCH":
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Cloud       string `json:"cloud"`
			Env         string `json:"env"`
			Service     string `json:"service"`
			Config      string `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			name = t.Name
		}
		cloud, env, service, config := strings.TrimSpace(body.Cloud), strings.TrimSpace(body.Env), strings.TrimSpace(body.Service), body.Config
		if cloud == "" {
			cloud = t.Cloud
		}
		if env == "" {
			env = t.Env
		}
		if service == "" {
			service = t.Service
		}
		if config == "" {
			config = t.Config
		}
		if err := UpdateRequestTemplate(id, name, strings.TrimSpace(body.Description), cloud, env, service, config); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		AppendAuditLog(userIDPtr, "template_update", "request_template", strconv.Itoa(id), "devops:"+name)
		updated, _ := GetRequestTemplateByID(id)
		json.NewEncoder(w).Encode(map[string]interface{}{"template": updated, "status": "ok"})
		return
	case "DELETE":
		if err := DeleteRequestTemplate(id); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		AppendAuditLog(userIDPtr, "template_delete", "request_template", strconv.Itoa(id), "devops:"+t.Name)
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "deleted"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

// devopsBulkActionHandler handles POST /api/devops/requests/bulk-approve and bulk-reject
func devopsBulkActionHandler(w http.ResponseWriter, r *http.Request, managerID int, action string) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		IDs    []int  `json:"ids"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if len(body.IDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "ids array is required and must not be empty", "status": "error"})
		return
	}
	if len(body.IDs) > 50 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "maximum 50 requests per bulk action", "status": "error"})
		return
	}
	adminIDPtr := &managerID
	approved := 0
	rejected := 0
	var errs []string
	for _, id := range body.IDs {
		if id <= 0 {
			continue
		}
		req, err := GetPRRequestByID(id)
		if err != nil || req == nil {
			errs = append(errs, fmt.Sprintf("#%d: not found", id))
			continue
		}
		if req.Status != "pending_devops_approval" {
			errs = append(errs, fmt.Sprintf("#%d: not pending_devops_approval", id))
			continue
		}
		if action == "bulk-approve" {
			prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config), req.ApplicationID)
			if err != nil {
				errs = append(errs, fmt.Sprintf("#%d: %v", id, err))
				continue
			}
			if err := UpdatePRRequestWithPR(id, prURL); err != nil {
				errs = append(errs, fmt.Sprintf("#%d: update failed", id))
				continue
			}
			_ = AssignRequestByPriority(id)
			updated, _ := GetPRRequestByID(id)
			if updated != nil {
				NotifyPRCreated(updated, prURL)
				p := RequestPayloadForWebhook(updated)
				p["pr_url"] = prURL
				FireOutboundWebhooks("pr_created", p)
				if updated.AssignedTo != nil && *updated.AssignedTo > 0 {
					NotifyTicketAssigned(updated, *updated.AssignedTo)
					FireOutboundWebhooks("assigned", RequestPayloadForWebhook(updated))
				}
			}
			AppendAuditLog(adminIDPtr, "request_approve", "pr_request", strconv.Itoa(id), "devops_manager:"+prURL)
			LogCredentialAuditFromConfig(id, req.Team, req.Env, req.Cloud, req.Config, req.CreatedBy, adminIDPtr)
			approved++
		} else {
			reason := strings.TrimSpace(body.Reason)
			if err := UpdatePRRequestReject(id, reason); err != nil {
				errs = append(errs, fmt.Sprintf("#%d: reject failed", id))
				continue
			}
			NotifyRequestRejected(req, reason)
			p := RequestPayloadForWebhook(req)
			p["reject_reason"] = reason
			FireOutboundWebhooks("rejected", p)
			AppendAuditLog(adminIDPtr, "request_reject", "pr_request", strconv.Itoa(id), "devops_manager:"+reason)
			rejected++
		}
	}
	resp := map[string]interface{}{"status": "ok"}
	if action == "bulk-approve" {
		resp["approved"] = approved
		resp["message"] = fmt.Sprintf("%d request(s) approved", approved)
	} else {
		resp["rejected"] = rejected
		resp["message"] = fmt.Sprintf("%d request(s) rejected", rejected)
	}
	if len(errs) > 0 {
		resp["errors"] = errs
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func devopsRequestDetailHandler(w http.ResponseWriter, id int) {
	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request not found", "status": "error"})
		return
	}
	createdByUsername := ""
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		names, _ := GetUsernamesByUserIDs([]int{*req.CreatedBy})
		if names != nil {
			createdByUsername = names[*req.CreatedBy]
		}
	}
	resp := map[string]interface{}{
		"id": req.ID, "team": req.Team, "env": req.Env, "cloud": req.Cloud, "service": req.Service,
		"client_name": req.ClientName, "application_id": req.ApplicationID, "priority": req.Priority,
		"due_date": req.DueDate, "due_status": dueStatus(req.DueDate), "pr_url": req.PRURL, "branch": req.Branch, "file_path": req.FilePath,
		"status": req.Status, "reject_reason": req.RejectReason,
		"created_at": req.CreatedAt, "updated_at": req.UpdatedAt,
		"created_by": req.CreatedBy, "created_by_username": createdByUsername,
		"assigned_to":           req.AssignedTo,
		"config":                maskConfigForAdmin(req.Config),
		"terraform_plan_output": req.TerraformPlanOutput,
		"jira_ticket_id":        req.JiraTicketID,
	}
	dependsOn, _ := GetRequestDependencies(id)
	blockedBy, _ := GetRequestsThatDependOn(id)
	blockedByWithStatus, _ := GetBlockedByWithStatus(id)
	resp["depends_on"] = dependsOn
	resp["blocked_by"] = blockedBy
	resp["blocked_by_with_status"] = blockedByWithStatus
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"request": resp, "status": "ok"})
}

func devopsRequestCommentsHandler(w http.ResponseWriter, r *http.Request, requestID int, userID int) {
	switch r.Method {
	case "GET":
		comments, err := GetRequestComments(requestID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch comments", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "comments": comments})
		return
	case "POST":
		var body struct {
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Body) == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "body is required", "status": "error"})
			return
		}
		if err := AddRequestComment(requestID, userID, strings.TrimSpace(body.Body)); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to add comment", "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Comment added"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func devopsRequestTimelineHandler(w http.ResponseWriter, requestID int) {
	timeline, err := GetRequestTimeline(requestID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch timeline", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "timeline": timeline})
}

func devopsRequestDependenciesHandler(w http.ResponseWriter, requestID int) {
	dependsOn, err := GetRequestDependencies(requestID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch dependencies", "status": "error"})
		return
	}
	blockedBy, _ := GetRequestsThatDependOn(requestID)
	blockedByWithStatus, _ := GetBlockedByWithStatus(requestID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                 "ok",
		"depends_on":             dependsOn,
		"blocked_by":             blockedBy,
		"blocked_by_with_status": blockedByWithStatus,
	})
}

// devopsRequestActionHandler handles /api/devops/requests/:id/approve, :id/reject, bulk-approve, bulk-reject (DevOps manager only)
func devopsRequestActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/devops/requests/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")

	// Bulk actions: /api/devops/requests/bulk-approve, bulk-reject
	if len(parts) >= 1 && (parts[0] == "bulk-approve" || parts[0] == "bulk-reject") {
		devopsBulkActionHandler(w, r, managerID, parts[0])
		return
	}

	if len(parts) == 1 && parts[0] != "" && r.Method == "GET" {
		id, err := strconv.Atoi(parts[0])
		if err == nil && id > 0 {
			devopsRequestDetailHandler(w, id)
			return
		}
	}

	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	idStr, action := parts[0], parts[1]
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request id", "status": "error"})
		return
	}
	req, err := GetPRRequestByID(id)
	if err != nil || req == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "request not found", "status": "error"})
		return
	}
	var adminIDPtr *int
	if managerID > 0 {
		adminIDPtr = &managerID
	}
	switch action {
	case "comments":
		devopsRequestCommentsHandler(w, r, id, managerID)
		return
	case "timeline":
		if r.Method != "GET" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		devopsRequestTimelineHandler(w, id)
		return
	case "dependencies":
		if r.Method != "GET" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		devopsRequestDependenciesHandler(w, id)
		return
	case "approve":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if req.Status != "pending_devops_approval" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "only pending_devops_approval requests can be approved", "status": "error"})
			return
		}
		prURL, err := CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config), req.ApplicationID)
		if err != nil {
			log.Printf("DevOps approve: create PR failed: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": fmt.Sprintf("failed to create PR: %v", err), "status": "error"})
			return
		}
		if err := UpdatePRRequestWithPR(id, prURL); err != nil {
			log.Printf("DevOps approve: update request failed: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_ = AssignRequestByPriority(id)
		updated, _ := GetPRRequestByID(id)
		if updated != nil {
			NotifyPRCreated(updated, prURL)
			p := RequestPayloadForWebhook(updated)
			p["pr_url"] = prURL
			FireOutboundWebhooks("pr_created", p)
			if updated.AssignedTo != nil && *updated.AssignedTo > 0 {
				NotifyTicketAssigned(updated, *updated.AssignedTo)
				FireOutboundWebhooks("assigned", RequestPayloadForWebhook(updated))
			}
		}
		AppendAuditLog(adminIDPtr, "request_approve", "pr_request", strconv.Itoa(id), "devops_manager:"+prURL)
		LogCredentialAuditFromConfig(id, req.Team, req.Env, req.Cloud, req.Config, req.CreatedBy, adminIDPtr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "pr_url": prURL, "message": "PR created and request set to in_progress"})
		return
	case "reject":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if req.Status != "pending_devops_approval" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "only pending_devops_approval requests can be rejected", "status": "error"})
			return
		}
		reason := ""
		var bodyReject struct {
			Reason string `json:"reason"`
		}
		if json.NewDecoder(r.Body).Decode(&bodyReject) == nil && bodyReject.Reason != "" {
			reason = strings.TrimSpace(bodyReject.Reason)
		}
		if err := UpdatePRRequestReject(id, reason); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		NotifyRequestRejected(req, reason)
		p := RequestPayloadForWebhook(req)
		p["reject_reason"] = reason
		FireOutboundWebhooks("rejected", p)
		AppendAuditLog(adminIDPtr, "request_reject", "pr_request", strconv.Itoa(id), "devops_manager:"+reason)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Request rejected"})
		return
	default:
		http.NotFound(w, r)
	}
}

// devopsCredentialAuditHandler GET /api/devops/credential-audit - list credential audit log (AWS access keys, GCP SA keys, etc.)
func devopsCredentialAuditHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset, _ := strconv.Atoi(q.Get("offset"))
	cloudFilter := strings.TrimSpace(q.Get("cloud"))
	fromDate := strings.TrimSpace(q.Get("from"))
	toDate := strings.TrimSpace(q.Get("to"))
	if q.Get("format") == "csv" {
		allEntries, _ := GetCredentialAuditLogs(10000, 0, cloudFilter, fromDate, toDate)
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=credential-audit.csv")
		w.Write([]byte("id,request_id,cloud,credential_type,team,env,created_by,approved_by,created_at\n"))
		for _, e := range allEntries {
			reqID := ""
			if e.RequestID != nil {
				reqID = strconv.Itoa(*e.RequestID)
			}
			line := fmt.Sprintf("%d,%s,%s,%s,%s,%s,%s,%s,%s\n",
				e.ID, reqID, e.Cloud, e.CredentialType, e.Team, e.Env,
				e.CreatedByUsername, e.ApprovedByUsername, e.CreatedAt.Format("2006-01-02 15:04:05"))
			w.Write([]byte(line))
		}
		return
	}
	entries, err := GetCredentialAuditLogs(limit, offset, cloudFilter, fromDate, toDate)
	if err != nil {
		log.Printf("credential audit: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to fetch credential audit", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"entries": entries, "status": "ok"})
}
