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

func corsAllowedOrigins() []string {
	origins := []string{
		strings.TrimRight(strings.TrimSpace(FrontendURL), "/"),
		strings.TrimRight(strings.TrimSpace(AdminFrontendURL), "/"),
		strings.TrimRight(strings.TrimSpace(DevOpsFrontendURL), "/"),
	}
	for _, part := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		part = strings.TrimRight(strings.TrimSpace(part), "/")
		if part == "" || part == "*" {
			continue
		}
		origins = append(origins, part)
	}
	return origins
}

func corsOriginAllowed(origin string) bool {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	if origin == "" {
		return false
	}
	for _, allowed := range corsAllowedOrigins() {
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	return false
}

func applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Secret")
	if r == nil {
		return
	}
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin != "" && corsOriginAllowed(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
}

func enableCORS(w http.ResponseWriter) {
	applyCORSHeaders(w, nil)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		applyCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
			if origin != "" && !corsOriginAllowed(origin) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func browserMutation(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func browserMutationAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		return corsOriginAllowed(origin)
	}
	return !strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site")
}

func withBrowserCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if browserMutation(r.Method) && !browserMutationAllowed(r) {
			writeAPIError(w, r, http.StatusForbidden, "cross-site request blocked", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleOptions(w http.ResponseWriter, r *http.Request) {
	applyCORSHeaders(w, r)
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin != "" && !corsOriginAllowed(origin) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
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

// checkPortalUser returns a verified portal user (viewer, contributor, or admin). Used for history, manager approval, and read-only request actions.
func checkPortalUser(r *http.Request) (userID int, ok bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		return 0, false
	}
	token := strings.TrimSpace(authHeader[7:])
	id, scopes, err := validateTokenOrAPIKey(token)
	if err != nil || id <= 0 {
		return 0, false
	}
	if scopes != "" && !hasScope(scopes, "history:read") && !hasScope(scopes, "request:create") {
		return 0, false
	}
	user, err := GetUserByID(id)
	if err != nil || user == nil {
		return 0, false
	}
	if !user.Verified {
		return id, false
	}
	if user.Role != "contributor" && user.Role != "admin" && user.Role != "viewer" {
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
	if err := applyTemplateRender(payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := recordSandboxVerification(payload, "9c7c3a7a", listSandboxObservations()); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
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
	if err := applyTemplateRender(payload); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if err := recordSandboxVerification(payload, "9c7c3a7a", listSandboxObservations()); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
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
	if !draft {
		NotifyRequestRaised(prRequest)
	}

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
	if err := validateRuntimeSecrets(); err != nil {
		log.Fatalf("Refusing to start: %v", err)
	}

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
		// Ensure default admin exists only when DEFAULT_ADMIN_PASSWORD is set to a non-default value.
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
	http.HandleFunc("/api/auth/logout", logoutHandler)
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
	http.HandleFunc("/api/me/ticket-audience", meTicketAudienceHandler)
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
	http.HandleFunc("/api/auth/resend-2fa", resend2faHandler)
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
	http.HandleFunc("/api/admin/cloud/accounts", adminCloudAccountsHandler)
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
	http.HandleFunc("/api/devops/inbound-sources", devopsInboundSourcesHandler)
	http.HandleFunc("/api/devops/inbound-sources/", devopsInboundSourceDetailHandler)
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
	http.HandleFunc("/api/oncall/coverage", oncallCoverageHandler)
	http.HandleFunc("/api/oncall/schedules", oncallScheduleHandler)
	http.HandleFunc("/api/oncall/schedules/", oncallScheduleDetailHandler)
	http.HandleFunc("/api/oncall/team-members", oncallTeamMembersHandler)
	http.HandleFunc("/api/oncall/flags", oncallFlagHandler)
	http.HandleFunc("/api/oncall/roster", oncallRosterHandler)
	http.HandleFunc("/api/oncall/days", oncallDaysHandler)
	http.HandleFunc("/api/oncall/covers", oncallCoverHandler)
	http.HandleFunc("/api/oncall/covers/", oncallCoverHandler)
	http.HandleFunc("/api/maintenance/notices", maintenanceNoticeHandler)
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
	http.HandleFunc("/api/devops/cloud/accounts", devopsCloudAccountsRouter)
	http.HandleFunc("/api/devops/cloud/accounts/", devopsCloudAccountsRouter)
	http.HandleFunc("/api/devops/environment-catalog", devopsEnvironmentCatalogHandler)
	http.HandleFunc("/api/devops/guarded-action-context", devopsGuardedActionContextHandler)
	http.HandleFunc("/api/devops/resource-context", devopsResourceContextHandler)
	http.HandleFunc("/api/devops/operator-activity", devopsOperatorActivityHandler)
	http.HandleFunc("/api/devops/cloud/resources", devopsCloudResourcesRouter)
	http.HandleFunc("/api/devops/cloud/resources/", devopsCloudResourcesRouter)
	http.HandleFunc("/api/devops/project-options", devopsProjectOptionsHandler)
	http.HandleFunc("/api/devops/project-analytics", devopsProjectAnalyticsHandler)
	http.HandleFunc("/api/devops/change-calendar", devopsChangeCalendarHandler)
	http.HandleFunc("/api/devops/approval-sla", devopsApprovalSLAHandler)
	http.HandleFunc("/api/devops/service-heatmap", devopsServiceHeatmapHandler)
	http.HandleFunc("/api/devops/change-risk", devopsChangeRiskHandler)
	http.HandleFunc("/api/devops/cost-digest", devopsCostDigestHandler)
	http.HandleFunc("/api/devops/project-dependencies", devopsProjectDependenciesHandler)
	http.HandleFunc("/api/devops/k8s-connections", devopsK8sConnectionsHandler)
	http.HandleFunc("/api/devops/k8s-connections/test", devopsK8sConnectionsTestHandler)
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
	http.HandleFunc("/api/devops/iam", iamHandler)
	http.HandleFunc("/api/devops/iam/", iamHandler)
	http.HandleFunc("/api/devops/incidents", devopsIncidentsHandler)
	http.HandleFunc("/api/devops/incidents/", devopsIncidentDetailHandler)
	http.HandleFunc("/api/devops/changes", devopsChangesHandler)
	http.HandleFunc("/api/devops/changes/", devopsChangeDetailHandler)
	http.HandleFunc("/api/devops/slos", devopsSLOsHandler)
	http.HandleFunc("/api/devops/services", devopsServiceMapHandler)
	http.HandleFunc("/api/devops/services/", devopsServiceMapDetailHandler)
	http.HandleFunc("/api/connections", connectionListHandler)
	http.HandleFunc("/api/connections/", connectionDetailHandler)
	http.HandleFunc("/api/outbox/events", outboxEventsHandler)
	http.HandleFunc("/api/jobs/", jobActionHandler)
	http.HandleFunc("/api/webhooks/inbox/", webhookInboxHandler)
	http.HandleFunc("/api/webhooks/activity", webhookActivityHandler)
	http.HandleFunc("/api/webhooks/mappings", webhookMappingHandler)
	http.HandleFunc("/api/webhooks/mappings/", webhookMappingHandler)
	http.HandleFunc("/api/templates/requests", templateRequestsHandler)
	http.HandleFunc("/api/templates/certify", templateCertifyHandler)
	http.HandleFunc("/api/templates/catalog", templateCatalogHandler)
	http.HandleFunc("/api/approvals/subjects", approvalSubjectHandler)
	http.HandleFunc("/api/approvals/exceptions", promotionExceptionHandler)
	http.HandleFunc("/api/approvals/preflight", promotionPreflightHandler)
	http.HandleFunc("/api/approvals/release", promotionReleaseHandler)
	http.HandleFunc("/api/deployments/attempts", deploymentAttemptHandler)
	http.HandleFunc("/api/deployments/callbacks", deploymentCallbackHandler)
	http.HandleFunc("/api/deployments/runtime", deploymentRuntimeHandler)
	http.HandleFunc("/api/changes", changeSubmitHandler)
	http.HandleFunc("/api/changes/webhook", lifecycleChangeWebhookHandler)
	http.HandleFunc("/api/changes/approval", changeApprovalHandler)
	http.HandleFunc("/api/changes/close", changeCloseHandler)
	http.HandleFunc("/api/changes/release", changeReleaseHandler)
	http.HandleFunc("/api/scans/profiles", scanProfileHandler)
	http.HandleFunc("/api/scans/assume", scanAssumeHandler)
	http.HandleFunc("/api/scans/jobs", scanJobHandler)
	http.HandleFunc("/api/scans/jobs/progress", scanProgressReportHandler)
	http.HandleFunc("/api/findings/observations", findingObservationHandler)
	http.HandleFunc("/api/findings", findingDetailHandler)
	http.HandleFunc("/api/findings/close", findingCloseHandler)
	http.HandleFunc("/api/coverage/pack", policyPackHandler)
	http.HandleFunc("/api/coverage/native", nativeFindingHandler)
	http.HandleFunc("/api/coverage/gaps", coverageGapHandler)
	http.HandleFunc("/api/coverage", coverageReportHandler)
	http.HandleFunc("/api/security/reports", securityReportHandler)
	http.HandleFunc("/api/artifacts/sboms", sbomHandler)
	http.HandleFunc("/api/artifacts/exposures", artifactExposureHandler)
	http.HandleFunc("/api/artifacts/findings", artifactFindingHandler)
	http.HandleFunc("/api/artifacts/context", artifactContextHandler)
	http.HandleFunc("/api/security/gates/policies", securityGatePolicyHandler)
	http.HandleFunc("/api/security/gates/summaries", securityGateSummaryHandler)
	http.HandleFunc("/api/security/gates/overrides", securityGateOverrideHandler)
	http.HandleFunc("/api/remediation/assignments", findingAssignmentHandler)
	http.HandleFunc("/api/remediation/assignments/reassign", findingReassignHandler)
	http.HandleFunc("/api/remediation/assignments/due", findingDueHandler)
	http.HandleFunc("/api/remediation/triage", findingTriageHandler)
	http.HandleFunc("/api/remediation/links", remediationLinkHandler)
	http.HandleFunc("/api/remediation/links/delivery", remediationDeliveryHandler)
	http.HandleFunc("/api/remediation/links/verification", remediationVerificationHandler)
	http.HandleFunc("/api/remediation/exceptions", riskExceptionHandler)
	http.HandleFunc("/api/remediation/exceptions/renew", riskExceptionRenewHandler)
	http.HandleFunc("/api/remediation/exceptions/review", riskExceptionReviewHandler)
	http.HandleFunc("/api/sre/slo/definitions", sloDefinitionHandler)
	http.HandleFunc("/api/sre/slo/evaluations", sloEvaluationHandler)
	http.HandleFunc("/api/sre/watches", serviceWatchHandler)
	http.HandleFunc("/api/sre/watches/samples", serviceWatchSampleHandler)
	http.HandleFunc("/api/sre/watches/freeze", serviceWatchFreezeHandler)
	http.HandleFunc("/api/sre/health", serviceHealthHandler)
	http.HandleFunc("/api/sre/failures", podFailureHandler)
	http.HandleFunc("/api/sre/failures/events", podFailureEventHandler)
	http.HandleFunc("/api/sre/failures/logs", podFailureLogHandler)
	http.HandleFunc("/api/sre/failures/gaps", podFailureGapHandler)
	http.HandleFunc("/api/sre/failures/retention", podFailureRetentionHandler)
	http.HandleFunc("/api/sre/failures/history", podFailureHistoryHandler)
	http.HandleFunc("/api/sre/incidents", sreIncidentHandler)
	http.HandleFunc("/api/sre/incidents/timeline", sreIncidentTimelineHandler)
	http.HandleFunc("/api/sre/incidents/runbooks", sreIncidentRunbookHandler)
	http.HandleFunc("/api/sre/incidents/close", sreIncidentCloseHandler)
	http.HandleFunc("/api/sre/incidents/reviews", sreIncidentReviewHandler)
	http.HandleFunc("/api/sre/incidents/followups", sreIncidentFollowUpHandler)
	http.HandleFunc("/api/sre/episodes", alertEpisodeHandler)
	http.HandleFunc("/api/sre/episodes/manual", alertEpisodeManualHandler)
	http.HandleFunc("/api/sre/problems", sreProblemHandler)
	http.HandleFunc("/api/sre/problems/link", sreProblemLinkHandler)
	http.HandleFunc("/api/sre/problems/known-error", sreProblemKnownErrorHandler)
	http.HandleFunc("/api/sre/problems/verify", sreProblemVerifyHandler)
	http.HandleFunc("/api/workspace", workspaceHandler)
	http.HandleFunc("/api/workspace/work", workspaceWorkHandler)
	http.HandleFunc("/api/workspace/services", workspaceServiceHandler)
	http.HandleFunc("/api/automation/rules", automationRuleHandler)
	http.HandleFunc("/api/automation/rules/disable", automationDisableHandler)
	http.HandleFunc("/api/automation/runs", automationRunHandler)
	http.HandleFunc("/api/automation/runs/retry", automationRetryHandler)
	http.HandleFunc("/api/reports/definitions", reportDefinitionHandler)
	http.HandleFunc("/api/reports/views", reportViewHandler)
	http.HandleFunc("/api/reports/drafts", reportDraftHandler)
	http.HandleFunc("/api/reports/drafts/publish", reportPublishHandler)
	http.HandleFunc("/api/outbound-sync/gate", outboundSyncGateHandler)
	http.HandleFunc("/api/outbound-sync/deliver", outboundSyncDeliverHandler)
	http.HandleFunc("/api/outbound-sync/reconcile", outboundSyncReconcileHandler)
	http.HandleFunc("/api/devops/problems", devopsProblemsHandler)
	http.HandleFunc("/api/devops/problems/", devopsProblemDetailHandler)
	http.HandleFunc("/api/devops/itsm-catalog", devopsITSMCatalogHandler)
	http.HandleFunc("/api/devops/knowledge", devopsKnowledgeHandler)
	http.HandleFunc("/api/devops/knowledge/", devopsKnowledgeDetailHandler)
	http.HandleFunc("/api/devops/release-notes", devopsReleaseNotesHandler)
	http.HandleFunc("/api/devops/incident-workspace", devopsIncidentWorkspaceHandler)
	http.HandleFunc("/api/devops/promotions", devopsPromotionsHandler)
	http.HandleFunc("/api/devops/promotions/", devopsPromotionsHandler)
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
	http.HandleFunc("/api/devops/previews", devopsPreviewsHandler)
	http.HandleFunc("/api/devops/scorecards", devopsScorecardsHandler)
	http.HandleFunc("/api/devops/evidence", devopsEvidenceHandler)
	http.HandleFunc("/api/devops/credential-audit", devopsCredentialAuditHandler)
	http.HandleFunc("/api/devops/expiry-tracker/actions", devopsExpiryTrackerActionsHandler)
	http.HandleFunc("/api/webhooks/github", githubWebhookHandler)
	http.HandleFunc("/api/webhooks/ci", ciWebhookHandler)
	http.HandleFunc("/api/webhooks/change", changeWebhookHandler)
	http.HandleFunc("/api/webhooks/alerts", alertWebhookHandler)
	http.HandleFunc("/api/webhooks/iam-access", iamAccessWebhookHandler)
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
	log.Println("  PATCH /api/users/:id/role - Set user role (admin Bearer or break-glass)")
	log.Println("  PATCH /api/users/:id/verify - Set user verified (admin Bearer or break-glass)")
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
	log.Println("  GET  /api-docs       - Swagger UI")

	if err := http.ListenAndServe(addr, withCORS(withBrowserCSRF(withCanonicalWebhookPath(withObservability(withRecovery(withSectionGate(http.DefaultServeMux))))))); err != nil {
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
