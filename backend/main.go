package main

import (
	"context"
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
		writeMethodNotAllowed(w, r)
		return
	}

	// Require auth and user-based access: verified + role contributor or admin
	userID, canCreate := checkCanCreatePR(r)
	if !canCreate {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeJSON(w, map[string]interface{}{
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
		encodeJSON(w, errorResponse)
		return
	}
	serviceBundleEntries, err := canonicalizeRequestBundlePayload(payload)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
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
		encodeJSON(w, errorResponse)
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
				writeAPIError(w, r, http.StatusForbidden, "you can only create PRs for a team you belong to", nil)
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
		encodeJSON(w, errorResponse)
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
		encodeJSON(w, errorResponse)
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
		encodeJSON(w, errorResponse)
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
		encodeJSON(w, errorResponse)
		return
	}
	projectID := parseProjectIDFromPayload(payload)
	clientName, _ := payload["client_name"].(string)
	payload["client_name"] = clientName

	log.Printf("Creating PR for: team=%s, env=%s, cloud=%s, service=%s", team, env, cloud, service)

	appID, appErr := GenerateApplicationID()
	if appErr != nil {
		log.Printf("GenerateApplicationID: %v", appErr)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to generate application id", nil)
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(func() *int {
		if projectID > 0 {
			id := projectID
			return &id
		}
		return nil
	}(), team, cloud, env, service, appID)

	// Save to database (use authenticated user ID)
	var userIDPtr *int
	if userID > 0 {
		userIDPtr = &userID
	}
	if projectID > 0 {
		if _, err := validateProjectBundleRequestForUser(userID, projectID, team, env, cloud, service, serviceBundleEntries); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}
	}
	ensureRequestPayloadApplicationID(payload, appID)

	// Marshal payload with indentation for readability after defaults/validation are applied.
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  "error processing request",
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		encodeJSON(w, errorResponse)
		return
	}

	prURL, err := CreateGitHubPR(branchName, filePath, content, appID)
	if err != nil {
		log.Printf("Error creating PR: %v", err)
		w.Header().Set("Content-Type", "application/json")
		errorResponse := map[string]interface{}{
			"error":  fmt.Sprintf("failed to create PR: %v", err),
			"status": "error",
		}
		w.WriteHeader(http.StatusInternalServerError)
		encodeJSON(w, errorResponse)
		return
	}

	prRequest := &PRRequest{
		ProjectID: func() *int {
			if projectID > 0 {
				id := projectID
				return &id
			}
			return nil
		}(),
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
	applyRequestBundleEntries(prRequest, serviceBundleEntries)

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
		requestID := requestIDFromContext(r.Context())
		traceID, spanID := traceAndSpanIDs(r.Context())
		log.Printf(
			"[HTTP] error_response_encode_failed request_id=%s trace_id=%s span_id=%s method=%s path=%s err=%v",
			requestID,
			traceID,
			spanID,
			r.Method,
			r.URL.Path,
			err,
		)
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
		writeMethodNotAllowed(w, r)
		return
	}

	userID, canCreate := checkCanCreatePR(r)
	if !canCreate {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeJSON(w, map[string]interface{}{
			"error":  "you do not have permission to create requests. Verify your email and ensure your account has contributor or admin role.",
			"status": "error",
		})
		return
	}

	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	serviceBundleEntries, err := canonicalizeRequestBundlePayload(payload)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
		return
	}
	if err := validatePayload(payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
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
				writeAPIError(w, r, http.StatusForbidden, "you can only create requests for a team you belong to", nil)
				return
			}
		}
	}

	team, _ := payload["team"].(string)
	env, _ := payload["env"].(string)
	cloud, _ := payload["cloud"].(string)
	service, _ := payload["service"].(string)
	projectID := parseProjectIDFromPayload(payload)
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
		writeAPIError(w, r, http.StatusInternalServerError, "failed to generate application id", nil)
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(func() *int {
		if projectID > 0 {
			id := projectID
			return &id
		}
		return nil
	}(), team, cloud, env, service, appID)
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	var userIDPtr *int
	if userID > 0 {
		userIDPtr = &userID
	}
	if projectID > 0 {
		validation, err := validateProjectBundleRequestForUser(userID, projectID, team, env, cloud, service, serviceBundleEntries)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "request failed", err)
			return
		}
		if clientName == "" && validation != nil {
			clientName = validation.Project.Name
			payload["client_name"] = clientName
		}
	}
	ensureRequestPayloadApplicationID(payload, appID)
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "error processing request", nil)
		return
	}
	status := "pending_devops_approval"
	if !draft && userID > 0 {
		status = determineApprovalStatusForRequest(intPointerIfPositive(projectID), userID, team, env)
	}
	if draft {
		status = "draft"
	}
	prRequest := &PRRequest{
		ProjectID: func() *int {
			if projectID > 0 {
				id := projectID
				return &id
			}
			return nil
		}(),
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
	applyRequestBundleEntries(prRequest, serviceBundleEntries)
	if err := SavePRRequest(prRequest); err != nil {
		log.Printf("Failed to save request: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to save request", nil)
		return
	}
	applyProjectDefaultLifetimeIfEligible(prRequest.ID, prRequest.ProjectID, prRequest.Env)
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
	encodeJSON(w, map[string]interface{}{
		"id":      prRequest.ID,
		"status":  status,
		"message": msg,
	})
}

func main() {
	loadBackendEnvFiles()
	reloadConfigFromEnv()

	otelShutdown, otelErr := initOpenTelemetry(context.Background())
	if otelErr != nil {
		log.Printf("[OTEL] initialization failed: %v", otelErr)
	} else {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := otelShutdown(shutdownCtx); err != nil {
				log.Printf("[OTEL] shutdown failed: %v", err)
			}
		}()
	}

	allowStartWithoutDB := strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_START_WITHOUT_DB")), "true")

	// Initialize database
	if err := InitDB(); err != nil {
		if !allowStartWithoutDB {
			log.Fatalf("Database initialization failed: %v", err)
		}
		log.Printf("Warning: Database initialization failed: %v", err)
		log.Println("ALLOW_START_WITHOUT_DB=true, continuing without database - database-backed features will fail")
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
		startLifecycleScheduler()
		startCostDigestScheduler()
		startDriftAutomationScheduler()
		startDeployIntelSlackDigestScheduler()
		startChangeWatcherScheduler()
		startSSOSyncScheduler()
	}
	InitRuntimeResilience()

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
	http.HandleFunc("/api/auth/sso/login", authSSOLoginHandler)
	http.HandleFunc("/api/auth/oidc/start", oidcStartHandler)
	http.HandleFunc("/api/auth/oidc/callback", oidcCallbackHandler)
	http.HandleFunc("/api/auth/workload/github", workloadGitHubHandler)
	http.HandleFunc("/api/auth/workload/gitlab", workloadGitLabHandler)
	http.HandleFunc("/api/public/sso/options", publicSSOOptionsHandler)
	http.HandleFunc("/api/auth/forgot-password", forgotPasswordHandler)
	http.HandleFunc("/api/auth/reset-password", resetPasswordHandler)
	http.HandleFunc("/api/me", meHandler)
	http.HandleFunc("/api/me/workspace", meWorkspaceHandler)
	http.HandleFunc("/api/search", searchHandler)
	http.HandleFunc("/api/golden-paths", goldenPathsHandler)
	http.HandleFunc("/api/cost-guardrail", costGuardrailHandler)
	http.HandleFunc("/api/copilot", copilotHandler)
	http.HandleFunc("/api/me/projects", meProjectsHandler)
	http.HandleFunc("/api/me/projects/", meProjectDetailHandler)
	http.HandleFunc("/api/me/incidents", meIncidentsHandler)
	http.HandleFunc("/api/me/incidents/", meIncidentDetailHandler)
	http.HandleFunc("/api/me/changes", meChangesHandler)
	http.HandleFunc("/api/me/changes/", meChangeDetailHandler)
	http.HandleFunc("/api/me/scorecards", meScorecardsHandler)
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
	http.HandleFunc("/api/admin/workspace", adminWorkspaceHandler)
	http.HandleFunc("/api/admin/dashboard-stats", adminDashboardStatsHandler)
	http.HandleFunc("/api/admin/analytics/requests", adminAnalyticsHandler)
	http.HandleFunc("/api/admin/sla-breach-check", adminSLABreachCheckHandler)
	http.HandleFunc("/api/admin/audit-log", adminAuditLogHandler)
	http.HandleFunc("/api/admin/access-review", adminAccessReviewHandler)
	http.HandleFunc("/api/admin/team-ownership", adminTeamOwnershipHandler)
	http.HandleFunc("/api/admin/user-activity", adminUserActivityHandler)
	http.HandleFunc("/api/admin/sso/settings", adminSSOSettingsHandler)
	http.HandleFunc("/api/admin/sso/sync", adminSSOSyncHandler)
	http.HandleFunc("/api/admin/sso/audit", adminSSOAuditHandler)
	http.HandleFunc("/api/admin/webhooks", adminWebhooksHandler)
	http.HandleFunc("/api/admin/webhooks/", adminWebhookDetailHandler)
	http.HandleFunc("/api/admin/inbound-sources", adminInboundSourcesHandler)
	http.HandleFunc("/api/admin/inbound-sources/", adminInboundSourceDetailHandler)
	http.HandleFunc("/api/admin/changes", adminChangesHandler)
	http.HandleFunc("/api/admin/changes/", adminChangeDetailHandler)
	http.HandleFunc("/api/admin/scorecards", adminScorecardsHandler)
	http.HandleFunc("/api/admin/evidence", adminEvidenceHandler)
	http.HandleFunc("/api/admin/incidents", adminIncidentsHandler)
	http.HandleFunc("/api/admin/incidents/", adminIncidentDetailHandler)
	http.HandleFunc("/api/admin/projects", adminProjectsHandler)
	http.HandleFunc("/api/admin/project-analytics", adminProjectAnalyticsHandler)
	http.HandleFunc("/api/admin/projects/", adminProjectDetailHandler)
	http.HandleFunc("/api/admin/templates", adminTemplatesRouter)
	http.HandleFunc("/api/admin/templates/", adminTemplatesRouter)
	http.HandleFunc("/api/admin/request-bundle-normalization", adminRequestBundleNormalizationHandler)
	http.HandleFunc("/api/admin/saved-views", adminSavedFilterViewsHandler)
	http.HandleFunc("/api/admin/saved-views/", adminSavedFilterViewsHandler)
	http.HandleFunc("/api/admin/deploy-intelligence/feed", adminDeployIntelligenceFeedHandler)
	http.HandleFunc("/api/devops/workspace", devopsWorkspaceHandler)
	http.HandleFunc("/api/devops/pr-impact", devopsPRImpactHandler)
	http.HandleFunc("/api/devops/deploy-intelligence", devopsDeployIntelligenceHandler)
	http.HandleFunc("/api/devops/deploy-intelligence/repos", devopsDeployIntelReposHandler)
	http.HandleFunc("/api/devops/deploy-intelligence/suggest-ticket", devopsDeployIntelSuggestTicketHandler)
	http.HandleFunc("/api/devops/deploy-intelligence/protect-branch", devopsDeployIntelProtectBranchHandler)
	http.HandleFunc("/api/devops/saved-views", devopsSavedFilterViewsHandler)
	http.HandleFunc("/api/devops/saved-views/", devopsSavedFilterViewsHandler)
	http.HandleFunc("/api/devops/prs/", devopsPRNumberImpactHandler)
	http.HandleFunc("/api/devops/oncall", devopsOncallHandler)
	http.HandleFunc("/api/devops/freezes", devopsFreezesHandler)
	http.HandleFunc("/api/devops/me", devopsMeHandler)
	http.HandleFunc("/api/devops/my-teams", devopsMyTeamsHandler)
	http.HandleFunc("/api/devops/teams/", devopsTeamsRouter)
	http.HandleFunc("/api/devops/tickets", devopsTicketsHandler)
	http.HandleFunc("/api/devops/users", devopsUsersHandler)
	http.HandleFunc("/api/devops/workload", devopsWorkloadHandler)
	http.HandleFunc("/api/devops/dashboard-stats", devopsDashboardStatsHandler)
	http.HandleFunc("/api/devops/notifications", devopsNotificationsHandler)
	http.HandleFunc("/api/devops/pending-approvals", devopsPendingApprovalsHandler)
	http.HandleFunc("/api/devops/deployment-gate-approvals", devopsDeploymentGateApprovalsHandler)
	http.HandleFunc("/api/devops/notification-settings", devopsNotificationSettingsHandler)
	http.HandleFunc("/api/devops/approval-notification-analytics", devopsApprovalNotificationAnalyticsHandler)
	http.HandleFunc("/api/devops/requests", devopsRequestsListHandler)
	http.HandleFunc("/api/devops/requests/", devopsRequestActionHandler)
	http.HandleFunc("/api/devops/project-options", devopsProjectOptionsHandler)
	http.HandleFunc("/api/devops/project-analytics", devopsProjectAnalyticsHandler)
	http.HandleFunc("/api/devops/change-calendar", devopsChangeCalendarHandler)
	http.HandleFunc("/api/devops/approval-sla", devopsApprovalSLAHandler)
	http.HandleFunc("/api/devops/service-heatmap", devopsServiceHeatmapHandler)
	http.HandleFunc("/api/devops/change-risk", devopsChangeRiskHandler)
	http.HandleFunc("/api/devops/environment-drift", devopsEnvironmentDriftHandler)
	http.HandleFunc("/api/devops/environment-drift/fix", devopsEnvironmentDriftFixHandler)
	http.HandleFunc("/api/devops/ops-command-center", devopsOpsCommandCenterHandler)
	http.HandleFunc("/api/devops/cost-digest", devopsCostDigestHandler)
	http.HandleFunc("/api/devops/project-dependencies", devopsProjectDependenciesHandler)
	http.HandleFunc("/api/devops/k8s-connections", devopsK8sConnectionsHandler)
	http.HandleFunc("/api/devops/k8s-overview", devopsK8sOverviewHandler)
	http.HandleFunc("/api/devops/k8s-clusters", devopsK8sClustersHandler)
	http.HandleFunc("/api/devops/k8s-cluster-detail", devopsK8sClusterDetailHandler)
	http.HandleFunc("/api/devops/k8s-workloads", devopsK8sWorkloadsHandler)
	http.HandleFunc("/api/devops/k8s-rollout-detail", devopsK8sRolloutDetailHandler)
	http.HandleFunc("/api/devops/k8s-pods", devopsK8sPodsHandler)
	http.HandleFunc("/api/devops/k8s-pod-detail", devopsK8sPodDetailHandler)
	http.HandleFunc("/api/devops/k8s-activity", devopsK8sActivityHandler)
	http.HandleFunc("/api/devops/k8s-pod-exec-profile", devopsK8sPodExecProfileHandler)
	http.HandleFunc("/api/devops/k8s-logs", devopsK8sLogsHandler)
	http.HandleFunc("/api/devops/k8s-log-stream", devopsK8sLogStreamHandler)
	http.HandleFunc("/api/devops/k8s-log-attach", devopsK8sLogAttachHandler)
	http.HandleFunc("/api/devops/k8s-services", devopsK8sServicesHandler)
	http.HandleFunc("/api/devops/k8s-ingresses", devopsK8sIngressesHandler)
	http.HandleFunc("/api/devops/k8s-ingress-detail", devopsK8sIngressDetailHandler)
	http.HandleFunc("/api/devops/k8s-secrets", devopsK8sSecretsHandler)
	http.HandleFunc("/api/devops/k8s-configmaps", devopsK8sConfigMapsHandler)
	http.HandleFunc("/api/devops/k8s-storage", devopsK8sStorageHandler)
	http.HandleFunc("/api/devops/k8s-events", devopsK8sEventsHandler)
	http.HandleFunc("/api/devops/k8s-certificates", devopsK8sCertificatesHandler)
	http.HandleFunc("/api/devops/k8s-workload-actions", devopsK8sWorkloadActionsHandler)
	http.HandleFunc("/api/devops/k8s-terminal-launch", devopsK8sTerminalLaunchHandler)
	http.HandleFunc("/api/devops/k8s-terminal-session", devopsK8sTerminalSessionHandler)
	http.HandleFunc("/api/devops/k8s-terminal-attach", devopsK8sTerminalAttachHandler)
	http.HandleFunc("/api/devops/k8s-terminal-command", devopsK8sTerminalCommandHandler)
	http.HandleFunc("/api/devops/runbooks", devopsRunbooksHandler)
	http.HandleFunc("/api/devops/runbooks/", devopsRunbookDetailHandler)
	http.HandleFunc("/api/devops/incidents", devopsIncidentsHandler)
	http.HandleFunc("/api/devops/incidents/", devopsIncidentDetailHandler)
	http.HandleFunc("/api/devops/changes", devopsChangesHandler)
	http.HandleFunc("/api/devops/changes/", devopsChangeDetailHandler)
	http.HandleFunc("/api/devops/health", devopsHealthHandler)
	http.HandleFunc("/api/devops/slos", devopsSLOsHandler)
	http.HandleFunc("/api/devops/services", devopsServiceMapHandler)
	http.HandleFunc("/api/devops/services/", devopsServiceMapDetailHandler)
	http.HandleFunc("/api/devops/problems", devopsProblemsHandler)
	http.HandleFunc("/api/devops/problems/", devopsProblemDetailHandler)
	http.HandleFunc("/api/devops/release-notes", devopsReleaseNotesHandler)
	http.HandleFunc("/api/devops/incident-workspace", devopsIncidentWorkspaceHandler)
	http.HandleFunc("/api/devops/access-overrides", devopsAccessOverridesHandler)
	http.HandleFunc("/api/devops/access-overrides/", devopsAccessOverrideDetailHandler)
	http.HandleFunc("/api/devops/promotions", devopsPromotionsHandler)
	http.HandleFunc("/api/devops/promotions/", devopsPromotionsHandler)
	http.HandleFunc("/api/devops/rollback-console", devopsRollbackConsoleHandler)
	http.HandleFunc("/api/devops/retry-center", devopsRetryCenterHandler)
	http.HandleFunc("/api/devops/retry-center/", devopsRetryCenterDetailHandler)
	http.HandleFunc("/api/devops/projects/bulk", devopsProjectsBulkHandler)
	http.HandleFunc("/api/devops/projects/team-access/bulk", devopsProjectBulkTeamAccessHandler)
	http.HandleFunc("/api/devops/projects", devopsProjectsHandler)
	http.HandleFunc("/api/devops/projects/", devopsProjectDetailHandler)
	http.HandleFunc("/api/devops/gitops/projects", devopsGitOpsProjectsHandler)
	http.HandleFunc("/api/devops/gitops/preview", devopsGitOpsPreviewHandler)
	http.HandleFunc("/api/devops/gitops/manage", devopsGitOpsManagementHandler)
	http.HandleFunc("/api/devops/gitops/manage/projects", devopsGitOpsProjectCreateHandler)
	http.HandleFunc("/api/devops/gitops/manage/projects/", devopsGitOpsProjectUpdateHandler)
	http.HandleFunc("/api/devops/gitops/manage/project-files", devopsGitOpsProjectFileCreateHandler)
	http.HandleFunc("/api/devops/gitops/manage/access", devopsGitOpsAccessCreateHandler)
	http.HandleFunc("/api/devops/gitops/manage/access/", devopsGitOpsAccessDeleteHandler)
	http.HandleFunc("/api/devops/templates", devopsTemplatesRouter)
	http.HandleFunc("/api/devops/templates/", devopsTemplatesRouter)
	http.HandleFunc("/api/devops/identity", devopsIdentityHandler)
	http.HandleFunc("/api/devops/previews", devopsPreviewsHandler)
	http.HandleFunc("/api/devops/scorecards", devopsScorecardsHandler)
	http.HandleFunc("/api/devops/evidence", devopsEvidenceHandler)
	http.HandleFunc("/api/devops/policies", devopsPoliciesHandler)
	http.HandleFunc("/api/devops/credential-audit", devopsCredentialAuditHandler)
	http.HandleFunc("/api/devops/expiry-tracker/actions", devopsExpiryTrackerActionsHandler)
	http.HandleFunc("/api/webhooks/github", githubWebhookHandler)
	http.HandleFunc("/api/webhooks/ci", ciWebhookHandler)
	http.HandleFunc("/api/webhooks/change", changeWebhookHandler)
	http.HandleFunc("/api/webhooks/alerts", alertWebhookHandler)
	http.HandleFunc("/api/webhooks/irm", irmWebhookHandler)
	http.HandleFunc("/api/webhooks/irm/", irmWebhookHandler)
	http.HandleFunc("/api/webhooks/pagerduty", irmWebhookHandler)
	http.HandleFunc("/api/webhooks/flags", flagWebhookHandler)
	http.HandleFunc("/api/otlp/v1/metrics", otlpMetricsHandler)
	http.HandleFunc("/v1/metrics", otlpMetricsHandler)
	http.HandleFunc("/mcp", mcpHandler)
	http.HandleFunc("/api/webhooks/watch-metrics", watchMetricsWebhookHandler)
	http.HandleFunc("/api/webhooks/slack", slackCommandsHandler)
	http.HandleFunc("/api/webhooks/teams", teamsCommandsHandler)
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/ready", readyHandler)

	// Swagger/OpenAPI endpoint (will be served from static files or generated)
	http.HandleFunc("/swagger.json", swaggerHandler)
	http.HandleFunc("/api-docs", swaggerUIHandler)

	addr := listenAddr()
	log.Printf("Backend server starting on %s", addr)
	log.Printf("Public API URL: %s", strings.TrimRight(os.Getenv("NEXT_PUBLIC_API_URL"), "/"))
	log.Printf("Frontend URL: %s", FrontendURL)
	log.Printf("Admin frontend URL: %s", AdminFrontendURL)
	log.Printf("DevOps frontend URL: %s", DevOpsFrontendURL)
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
	log.Println("  GET  /api/me/changes - Change requests on the user's projects")
	log.Println("  GET  /api/me/incidents - Incidents assigned to the user or on their projects")
	log.Println("  GET  /api/admin/changes - Change request catalog (admin, read-only)")
	log.Println("  GET  /api/admin/incidents - Incident catalog (admin, read-only)")
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
	log.Println("  GET  /api/admin/access-review - Access review directory (admin only)")
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
	log.Println("  GET  /api/admin/request-bundle-normalization - Preview legacy bundle normalization (admin only)")
	log.Println("  POST /api/admin/request-bundle-normalization - Apply legacy bundle normalization (admin only)")
	log.Println("  GET  /api/admin/stats     - Dashboard stats for all PRs (admin only)")
	log.Println("  GET  /health         - Health check")
	log.Println("  GET  /swagger.json    - OpenAPI spec")
	log.Println("  GET  /api-docs       - Swagger UI")

	if err := http.ListenAndServe(addr, withObservability(withRecovery(http.DefaultServeMux))); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func listenAddr() string {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	if strings.HasPrefix(port, ":") {
		return port
	}
	return ":" + port
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	status := map[string]interface{}{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	}
	dependencies := map[string]healthDependency{}
	// Database
	if DB != nil {
		ctx, cancel := dbTimeoutContext()
		err := DB.PingContext(ctx)
		cancel()
		if err == nil {
			status["database"] = "connected"
			dependencies["database"] = healthDependency{Status: "connected"}
			if n, err := GetPendingApprovalCount(); err == nil {
				status["pending_approval_count"] = n
			}
		} else {
			status["database"] = "disconnected"
			dependencies["database"] = healthDependency{Status: "disconnected", Error: err.Error()}
			status["status"] = "degraded"
		}
	} else {
		status["database"] = "not_initialized"
		dependencies["database"] = healthDependency{Status: "not_initialized"}
		status["status"] = "degraded"
	}
	if redisClient != nil && redisClient.enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := redisClient.Ping(ctx)
		cancel()
		if err == nil {
			status["cache"] = "connected"
			dependencies["cache"] = healthDependency{Status: "connected"}
		} else {
			status["cache"] = "disconnected"
			dependencies["cache"] = healthDependency{Status: "disconnected", Error: err.Error()}
			status["status"] = "degraded"
		}
	} else {
		status["cache"] = "disabled"
		dependencies["cache"] = healthDependency{Status: "disabled"}
	}
	// GitHub (optional)
	if ok, err := CheckGitHubConnectivity(); err != nil {
		status["github"] = "error"
		status["github_error"] = err.Error()
		dependencies["github"] = healthDependency{Status: "error", Error: err.Error()}
	} else if !ok {
		status["github"] = "disabled"
		dependencies["github"] = healthDependency{Status: "disabled"}
	} else {
		status["github"] = "ok"
		dependencies["github"] = healthDependency{Status: "ok"}
	}
	status["dependencies"] = dependencies
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, status)
}

// readyHandler GET /ready - readiness probe (DB must be up)
func readyHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if DB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	ctx, cancel := dbTimeoutContext()
	err := DB.PingContext(ctx)
	cancel()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]string{"status": "not_ready", "reason": "database ping failed"})
		return
	}
	cacheStatus := "disabled"
	if redisClient != nil && redisClient.enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := redisClient.Ping(ctx)
		cancel()
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Header().Set("Content-Type", "application/json")
			encodeJSON(w, map[string]string{"status": "not_ready", "reason": "cache ping failed"})
			return
		}
		cacheStatus = "ready"
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]string{"status": "ready", "cache": cacheStatus})
}
