package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type InfraRequest map[string]interface{}

// enableCORS adds CORS headers to allow frontend requests
func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

// handleOptions handles preflight CORS requests
func handleOptions(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.WriteHeader(http.StatusOK)
}

// validatePayload checks if required fields are present
func validatePayload(payload InfraRequest) error {
	required := []string{"team", "env", "cloud", "service"}
	for _, field := range required {
		val, ok := payload[field]
		if !ok || val == nil {
			return fmt.Errorf("missing required field: %s", field)
		}
		str, ok := val.(string)
		if !ok || strings.TrimSpace(str) == "" {
			return fmt.Errorf("field %s must be a non-empty string", field)
		}
	}
	return nil
}

// adminUsersHandler dispatches /api/users/:id/role and /api/users/:id/verify to the appropriate handler
func adminUsersHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/verify") {
		setVerifiedHandler(w, r)
		return
	}
	setRoleHandler(w, r)
}

// checkCanCreatePR returns (userID, true) if the request has a valid Bearer token (or API key with request:create scope) and the user is verified and has role contributor or admin
func checkCanCreatePR(r *http.Request) (userID int, ok bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		return 0, false
	}
	token := strings.TrimSpace(authHeader[7:])
	id, scopes, err := validateTokenOrAPIKey(token)
	if err != nil || id <= 0 {
		return 0, false
	}
	if scopes != "" && !hasScope(scopes, "request:create") {
		return 0, false
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil {
		return 0, false
	}
	if !user.Verified {
		return id, false
	}
	if user.Role != "contributor" && user.Role != "admin" {
		return id, false
	}
	return id, true
}

func createPRHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Require auth and user-based access: verified + role contributor or admin
	userID, canCreate := checkCanCreatePR(r)
	if !canCreate {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "you do not have permission to create PRs. Verify your email and ensure your account has contributor or admin role.",
			"status": "error",
		})
		return
	}

	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		log.Printf("Error decoding JSON: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  fmt.Sprintf("invalid json: %v", err),
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Validate required fields
	if err := validatePayload(payload); err != nil {
		log.Printf("Validation error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  err.Error(),
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Ensure user can only create PRs for a team they belong to
	if userID > 0 && DB != nil {
		userTeams, err := GetTeamsForUserWithDetails(userID)
		if err == nil && len(userTeams) > 0 {
			teamStr, _ := payload["team"].(string)
			allowed := false
			for _, t := range userTeams {
				if t.Slug == teamStr || t.Name == teamStr {
					allowed = true
					break
				}
			}
			if !allowed {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "you can only create PRs for a team you belong to", "status": "error"})
				return
			}
		}
	}

	// Safely extract fields with type checking
	team, ok := payload["team"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "team must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	env, ok := payload["env"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "env must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	cloud, ok := payload["cloud"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "cloud must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	service, ok := payload["service"].(string)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "service must be a string",
			"status": "error",
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}
	clientName, _ := payload["client_name"].(string)
	payload["client_name"] = clientName

	// Marshal payload with indentation for readability
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "error processing request",
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	log.Printf("Creating PR for: team=%s, env=%s, cloud=%s, service=%s", team, env, cloud, service)

	appID, appErr := GenerateApplicationID()
	if appErr != nil {
		log.Printf("GenerateApplicationID: %v", appErr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to generate application id", "status": "error"})
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(team, env, appID)

	prURL, err := CreateGitHubPR(branchName, filePath, content, appID)
	if err != nil {
		log.Printf("Error creating PR: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  fmt.Sprintf("failed to create PR: %v", err),
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Save to database (use authenticated user ID)
	var userIDPtr *int
	if userID > 0 {
		userIDPtr = &userID
	}

	prRequest := &PRRequest{
		Team:          team,
		Env:           env,
		Cloud:         cloud,
		Service:       service,
		ClientName:    clientName,
		ApplicationID: appID,
		PRURL:         prURL,
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "pending",
		Config:        string(content),
		CreatedBy:     userIDPtr,
	}

	if err := SavePRRequest(prRequest); err != nil {
		log.Printf("Warning: failed to save PR request to database: %v", err)
		// Don't fail the request, just log the warning
	}
	AppendUserActivity(userIDPtr, "request_create", "pr_request", strconv.Itoa(prRequest.ID), "direct PR created")

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"pr_url": prURL,
		"status": "created",
		"branch": branchName,
		"id":     prRequest.ID,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "error encoding response", http.StatusInternalServerError)
		return
	}
}

// createRequestHandler creates a request in pending_approval state (no PR yet). Admin must approve to create PR.
func createRequestHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, canCreate := checkCanCreatePR(r)
	if !canCreate {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "you do not have permission to create requests. Verify your email and ensure your account has contributor or admin role.",
			"status": "error",
		})
		return
	}

	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid json", "status": "error"})
		return
	}
	if err := validatePayload(payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	// Ensure user can only submit requests for a team they belong to
	if userID > 0 && DB != nil {
		userTeams, err := GetTeamsForUserWithDetails(userID)
		if err == nil && len(userTeams) > 0 {
			teamStr, _ := payload["team"].(string)
			allowed := false
			for _, t := range userTeams {
				if t.Slug == teamStr || t.Name == teamStr {
					allowed = true
					break
				}
			}
			if !allowed {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "you can only create requests for a team you belong to", "status": "error"})
				return
			}
		}
	}

	team, _ := payload["team"].(string)
	env, _ := payload["env"].(string)
	cloud, _ := payload["cloud"].(string)
	service, _ := payload["service"].(string)
	clientName, _ := payload["client_name"].(string)
	payload["client_name"] = clientName
	priority, _ := payload["priority"].(string)
	if priority == "" {
		priority = "medium"
	}
	if priority != "low" && priority != "medium" && priority != "high" && priority != "critical" {
		priority = "medium"
	}
	var dueDate *time.Time
	if d, ok := payload["due_date"].(string); ok && d != "" {
		if t, err := time.Parse("2006-01-02", d); err == nil {
			dueDate = &t
		}
	}
	draft, _ := payload["draft"].(bool)

	appID, appErr := GenerateApplicationID()
	if appErr != nil {
		log.Printf("GenerateApplicationID: %v", appErr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to generate application id", "status": "error"})
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(team, env, appID)
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "error processing request", "status": "error"})
		return
	}

	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}

	var userIDPtr *int
	if userID > 0 {
		userIDPtr = &userID
	}
	status := "pending_devops_approval"
	if !draft && userID > 0 {
		if GetGroupManagerForUser(userID) != 0 {
			status = "pending_user_manager_approval"
		} else if creator, _ := GetUserByID(userID); creator != nil && creator.ManagerID != nil {
			status = "pending_user_manager_approval"
		}
	}
	if draft {
		status = "draft"
	}
	prRequest := &PRRequest{
		Team:          team,
		Env:           env,
		Cloud:         cloud,
		Service:       service,
		ClientName:    clientName,
		ApplicationID: appID,
		Priority:      priority,
		DueDate:       dueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        status,
		Config:        string(content),
		CreatedBy:     userIDPtr,
	}
	if err := SavePRRequest(prRequest); err != nil {
		log.Printf("Failed to save request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to save request", "status": "error"})
		return
	}
	AppendUserActivity(userIDPtr, "request_create", "pr_request", strconv.Itoa(prRequest.ID), status)

	// Optional initial comment when raising the PR (saved as first request comment)
	if userID > 0 {
		if ic, ok := payload["initial_comment"].(string); ok && strings.TrimSpace(ic) != "" {
			_ = AddRequestComment(prRequest.ID, userID, strings.TrimSpace(ic))
		} else if ic, ok := payload["comment"].(string); ok && strings.TrimSpace(ic) != "" {
			_ = AddRequestComment(prRequest.ID, userID, strings.TrimSpace(ic))
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	msg := "Request submitted. An admin will approve it and the PR will be created."
	if draft {
		msg = "Draft saved. You can edit or submit it from History."
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      prRequest.ID,
		"status":  status,
		"message": msg,
	})
}

func main() {
	// Initialize database
	if err := InitDB(); err != nil {
		log.Printf("Warning: Database initialization failed: %v", err)
		log.Println("Continuing without database - history features will not work")
	} else {
		// Run migration to update schema if needed
		if err := MigrateDatabase(); err != nil {
			log.Printf("Warning: Database migration failed: %v", err)
			log.Println("Continuing - some features may not work correctly")
		}
		// Verify user_activity table exists (for admin activity feed)
		if DB != nil {
			var n int
			if err := DB.QueryRow("SELECT COUNT(*) FROM user_activity").Scan(&n); err != nil {
				log.Printf("Warning: user_activity table check failed (%v) - User activity feed will not work", err)
			} else {
				log.Printf("user_activity table OK (%d rows)", n)
			}
		}
		// Ensure default admin exists (credentials from env or admin/admin123)
		EnsureDefaultAdmin()
	}

	// Log email configuration status
	if os.Getenv("SMTP_HOST") != "" {
		log.Printf("[Email] SMTP configured: host=%s port=%s from=%s", os.Getenv("SMTP_HOST"), os.Getenv("SMTP_PORT"), os.Getenv("SMTP_FROM"))
		log.Printf("[Email] Password reset links will use FRONTEND_URL=%s", os.Getenv("FRONTEND_URL"))
	} else {
		log.Printf("[Email] SMTP not configured (SMTP_HOST empty) - notification emails disabled")
	}

	// API endpoints
	http.HandleFunc("/create-pr", createPRHandler)
	http.HandleFunc("/api/request", createRequestHandler)
	http.HandleFunc("/api/request/", requestDetailHandler)
	http.HandleFunc("/api/history", historyHandler)
	http.HandleFunc("/api/history/", historyDetailHandler)
	http.HandleFunc("/api/stats", statsHandler)
	http.HandleFunc("/api/logs/cloud", logsCloudHandler)
	http.HandleFunc("/api/logs/github", logsGitHubHandler)
	http.HandleFunc("/api/auth/signup", signupHandler)
	http.HandleFunc("/api/auth/login", loginHandler)
	http.HandleFunc("/api/auth/forgot-password", forgotPasswordHandler)
	http.HandleFunc("/api/auth/reset-password", resetPasswordHandler)
	http.HandleFunc("/api/me", meHandler)
	http.HandleFunc("/api/me/teams", meTeamsHandler)
	http.HandleFunc("/api/me/teams/", meTeamMembersRouter)
	http.HandleFunc("/api/me/managed-teams", meManagedTeamsHandler)
	http.HandleFunc("/api/me/notifications", meNotificationsHandler)
	http.HandleFunc("/api/me/notification-preferences", meNotificationPreferencesHandler)
	http.HandleFunc("/api/cost-estimate", costEstimateHandler)
	http.HandleFunc("/api/me/pending-manager-approval", mePendingManagerApprovalHandler)
	http.HandleFunc("/api/me/saved-configs", savedConfigsHandler)
	http.HandleFunc("/api/me/saved-configs/", savedConfigDetailHandler)
	http.HandleFunc("/api/me/api-keys", meAPIKeysHandler)
	http.HandleFunc("/api/me/api-keys/", meAPIKeyDetailHandler)
	http.HandleFunc("/api/me/2fa", me2faHandler)
	http.HandleFunc("/api/change-password", changePasswordHandler)
	http.HandleFunc("/api/templates", templatesListHandler)
	http.HandleFunc("/api/templates/", templatesDetailHandler)
	http.HandleFunc("/api/verify-email", verifyEmailHandler)
	http.HandleFunc("/api/verify-otp", verifyOtpHandler)
	http.HandleFunc("/api/auth/verify-2fa", verify2faHandler)
	http.HandleFunc("/api/resend-verification", resendVerificationHandler)
	http.HandleFunc("/api/users/", adminUsersHandler)
	http.HandleFunc("/api/admin/users", adminUsersRouter)
	http.HandleFunc("/api/admin/users/", adminUserDetailHandler)
	http.HandleFunc("/api/admin/teams", adminTeamsRouter)
	http.HandleFunc("/api/admin/teams/", adminTeamsRouter)
	http.HandleFunc("/api/admin/requests", adminRequestsHandler)
	http.HandleFunc("/api/admin/requests/", adminRequestActionHandler)
	http.HandleFunc("/api/admin/devops-users", adminDevopsUsersHandler)
	http.HandleFunc("/api/admin/notifications", adminNotificationsHandler)
	http.HandleFunc("/api/admin/stats", adminStatsHandler)
	http.HandleFunc("/api/admin/dashboard-stats", adminDashboardStatsHandler)
	http.HandleFunc("/api/admin/analytics/requests", adminAnalyticsHandler)
	http.HandleFunc("/api/admin/sla-breach-check", adminSLABreachCheckHandler)
	http.HandleFunc("/api/admin/audit-log", adminAuditLogHandler)
	http.HandleFunc("/api/admin/user-activity", adminUserActivityHandler)
	http.HandleFunc("/api/admin/webhooks", adminWebhooksHandler)
	http.HandleFunc("/api/admin/webhooks/", adminWebhookDetailHandler)
	http.HandleFunc("/api/admin/templates", adminTemplatesRouter)
	http.HandleFunc("/api/admin/templates/", adminTemplatesRouter)
	http.HandleFunc("/api/devops/me", devopsMeHandler)
	http.HandleFunc("/api/devops/my-teams", devopsMyTeamsHandler)
	http.HandleFunc("/api/devops/teams/", devopsTeamsRouter)
	http.HandleFunc("/api/devops/tickets", devopsTicketsHandler)
	http.HandleFunc("/api/devops/users", devopsUsersHandler)
	http.HandleFunc("/api/devops/workload", devopsWorkloadHandler)
	http.HandleFunc("/api/devops/dashboard-stats", devopsDashboardStatsHandler)
	http.HandleFunc("/api/devops/notifications", devopsNotificationsHandler)
	http.HandleFunc("/api/devops/pending-approvals", devopsPendingApprovalsHandler)
	http.HandleFunc("/api/devops/requests", devopsRequestsListHandler)
	http.HandleFunc("/api/devops/requests/", devopsRequestActionHandler)
	http.HandleFunc("/api/devops/templates", devopsTemplatesRouter)
	http.HandleFunc("/api/devops/templates/", devopsTemplatesRouter)
	http.HandleFunc("/api/devops/credential-audit", devopsCredentialAuditHandler)
	http.HandleFunc("/api/webhooks/github", githubWebhookHandler)
	http.HandleFunc("/api/webhooks/ci", ciWebhookHandler)
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/ready", readyHandler)

	// Swagger/OpenAPI endpoint (will be served from static files or generated)
	http.HandleFunc("/swagger.json", swaggerHandler)
	http.HandleFunc("/api-docs", swaggerUIHandler)

	log.Println("Backend server starting on :8080")
	if SlackWebhookURL != "" {
		log.Println("Slack notifications: enabled")
	} else {
		log.Println("Slack notifications: disabled (set SLACK_WEBHOOK_URL to enable)")
	}
	log.Println("Endpoints:")
	log.Println("  POST /create-pr      - Create infrastructure PR directly (verified contributor/admin only)")
	log.Println("  POST /api/request    - Submit request for approval (pending_approval; admin approves to create PR)")
	log.Println("  GET  /api/history     - Get PR request history")
	log.Println("  GET  /api/history/:id - Get single PR request details")
	log.Println("  GET  /api/stats       - Get dashboard statistics")
	log.Println("  GET  /api/logs/cloud  - Cloud activity logs (by cloud name)")
	log.Println("  GET  /api/logs/github - GitHub activity logs")
	log.Println("  POST /api/auth/signup - User signup")
	log.Println("  POST /api/auth/login  - User login")
	log.Println("  GET  /api/me         - Current user (auth required)")
	log.Println("  GET  /api/me/teams   - Current user's teams (auth required; empty = not in any team)")
	log.Println("  POST /api/change-password - Change password (auth required)")
	log.Println("  GET  /api/verify-email?token= - Verify email")
	log.Println("  POST /api/verify-otp - Verify OTP (email + otp)")
	log.Println("  POST /api/resend-verification - Resend verification (auth required)")
	log.Println("  PATCH /api/users/:id/role - Set user role (X-Admin-Secret required)")
	log.Println("  PATCH /api/users/:id/verify - Set user verified (X-Admin-Secret required)")
	log.Println("  GET  /api/admin/users - List users (admin only)")
	log.Println("  POST /api/admin/users - Create user (admin only)")
	log.Println("  GET  /api/admin/users/:id - Get user (admin only)")
	log.Println("  PATCH /api/admin/users/:id - Update user profile (admin only)")
	log.Println("  DELETE /api/admin/users/:id - Delete user (admin only)")
	log.Println("  GET  /api/admin/teams - List teams (admin only)")
	log.Println("  POST /api/admin/teams - Create team (admin only)")
	log.Println("  GET  /api/admin/teams/:id - Team detail + members (admin only)")
	log.Println("  POST /api/admin/teams/:id/members - Add member (admin only)")
	log.Println("  PATCH  /api/admin/teams/:id/members/:user_id - Update member role (admin only)")
	log.Println("  DELETE /api/admin/teams/:id/members/:user_id - Remove member (admin only)")
	log.Println("  GET  /api/admin/requests     - List all PR requests (admin only)")
	log.Println("  POST /api/admin/requests/:id/approve - Approve request, create PR (admin only)")
	log.Println("  POST /api/admin/requests/:id/reject  - Reject request (admin only)")
	log.Println("  PATCH /api/admin/requests/:id/status - Set status in_progress|completed|rejected (admin only)")
	log.Println("  GET  /api/admin/stats     - Dashboard stats for all PRs (admin only)")
	log.Println("  GET  /health         - Health check")
	log.Println("  GET  /swagger.json    - OpenAPI spec")
	log.Println("  GET  /api-docs       - Swagger UI")

	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	status := map[string]interface{}{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	}
	// Database
	if DB != nil {
		if err := DB.Ping(); err == nil {
			status["database"] = "connected"
			if n, err := GetPendingApprovalCount(); err == nil {
				status["pending_approval_count"] = n
			}
		} else {
			status["database"] = "disconnected"
		}
	} else {
		status["database"] = "not_initialized"
	}
	// GitHub (optional)
	if ok, err := CheckGitHubConnectivity(); err != nil {
		status["github"] = "error"
		status["github_error"] = err.Error()
	} else if !ok {
		status["github"] = "disabled"
	} else {
		status["github"] = "ok"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// readyHandler GET /ready - readiness probe (DB must be up)
func readyHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if DB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	if err := DB.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database ping failed"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
