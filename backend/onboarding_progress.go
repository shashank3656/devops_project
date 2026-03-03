package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type OnboardingMilestone struct {
	Key       string     `json:"key"`
	Title     string     `json:"title"`
	Detail    string     `json:"detail"`
	State     string     `json:"state"` // completed | current | upcoming | attention
	Timestamp *time.Time `json:"timestamp,omitempty"`
}

type OnboardingRequestSummary struct {
	ID        int       `json:"id"`
	Team      string    `json:"team"`
	Env       string    `json:"env"`
	Cloud     string    `json:"cloud"`
	Service   string    `json:"service"`
	Status    string    `json:"status"`
	PRURL     string    `json:"pr_url"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OnboardingProgress struct {
	UserID            int                       `json:"user_id"`
	Username          string                    `json:"username"`
	Email             string                    `json:"email"`
	UserType          string                    `json:"user_type"`
	Role              string                    `json:"role"`
	Verified          bool                      `json:"verified"`
	CreatedAt         time.Time                 `json:"created_at"`
	ManagerUsername   string                    `json:"manager_username,omitempty"`
	Teams             []Team                    `json:"teams"`
	RequestsByStatus  map[string]int            `json:"requests_by_status"`
	RequestsTotal     int                       `json:"requests_total"`
	SubmittedRequests int                       `json:"submitted_requests"`
	LatestRequest     *OnboardingRequestSummary `json:"latest_request,omitempty"`
	Milestones        []OnboardingMilestone     `json:"milestones"`
	NextAction        string                    `json:"next_action"`
	CompletionPercent int                       `json:"completion_percent"`
}

func onboardingProgressHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing or invalid authorization", "status": "error"})
		return
	}
	userID, err := validateToken(strings.TrimSpace(authHeader[7:]))
	if err != nil || userID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid token", "status": "error"})
		return
	}
	progress, err := BuildOnboardingProgressForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to build onboarding progress", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"progress": progress, "status": "ok"})
}

func adminUserOnboardingProgressHandler(w http.ResponseWriter, r *http.Request, userID int) {
	enableCORS(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	progress, err := BuildOnboardingProgressForUser(userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to build onboarding progress", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"progress": progress, "status": "ok"})
}

func BuildOnboardingProgressForUser(userID int) (*OnboardingProgress, error) {
	user, err := GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, sql.ErrNoRows
	}

	teams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return nil, err
	}

	managerUsername := ""
	if user.ManagerID != nil && *user.ManagerID > 0 {
		if mgr, err := GetUserByID(*user.ManagerID); err == nil && mgr != nil {
			managerUsername = mgr.Username
		}
	} else if user.UserType == "portal_user" {
		if groupManagerID := GetGroupManagerForUser(userID); groupManagerID > 0 {
			if mgr, err := GetUserByID(groupManagerID); err == nil && mgr != nil {
				managerUsername = mgr.Username
			}
		}
	}

	requestsByStatus, err := getRequestStatusCountsForUser(userID)
	if err != nil {
		return nil, err
	}
	latestRequest, err := getLatestRequestForUser(userID)
	if err != nil {
		return nil, err
	}

	progress := &OnboardingProgress{
		UserID:           user.ID,
		Username:         user.Username,
		Email:            user.Email,
		UserType:         user.UserType,
		Role:             user.Role,
		Verified:         user.Verified,
		CreatedAt:        user.CreatedAt,
		ManagerUsername:  managerUsername,
		Teams:            teams,
		RequestsByStatus: requestsByStatus,
	}
	progress.RequestsTotal = sumStatusCounts(requestsByStatus)
	progress.SubmittedRequests = progress.RequestsTotal - requestsByStatus["draft"]
	if latestRequest != nil {
		progress.LatestRequest = &OnboardingRequestSummary{
			ID:        latestRequest.ID,
			Team:      latestRequest.Team,
			Env:       latestRequest.Env,
			Cloud:     latestRequest.Cloud,
			Service:   latestRequest.Service,
			Status:    latestRequest.Status,
			PRURL:     latestRequest.PRURL,
			CreatedAt: latestRequest.CreatedAt,
			UpdatedAt: latestRequest.UpdatedAt,
		}
	}

	progress.Milestones = buildOnboardingMilestones(user, teams, requestsByStatus, latestRequest, managerUsername)
	progress.CompletionPercent = computeOnboardingCompletion(progress.Milestones)
	progress.NextAction = deriveOnboardingNextAction(user, teams, requestsByStatus, latestRequest)
	return progress, nil
}

func getRequestStatusCountsForUser(userID int) (map[string]int, error) {
	rows, err := DB.Query(`SELECT status, COUNT(*) FROM pr_requests WHERE created_by = $1 GROUP BY status`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]int{
		"draft":                         0,
		"pending_user_manager_approval": 0,
		"pending_devops_approval":       0,
		"pending_approval":              0,
		"in_progress":                   0,
		"completed":                     0,
		"rejected":                      0,
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		out[status] = count
	}
	return out, nil
}

func getLatestRequestForUser(userID int) (*PRRequest, error) {
	row := DB.QueryRow(`
		SELECT id, team, env, cloud, service, COALESCE(client_name,''), COALESCE(application_id,''), COALESCE(priority,'medium'),
		       due_date, COALESCE(pr_url,''), COALESCE(branch,''), COALESCE(file_path,''), status, COALESCE(reject_reason,''),
		       COALESCE(config,''), created_by, assigned_to, created_at, updated_at
		FROM pr_requests
		WHERE created_by = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, userID)

	var req PRRequest
	err := row.Scan(
		&req.ID,
		&req.Team,
		&req.Env,
		&req.Cloud,
		&req.Service,
		&req.ClientName,
		&req.ApplicationID,
		&req.Priority,
		&req.DueDate,
		&req.PRURL,
		&req.Branch,
		&req.FilePath,
		&req.Status,
		&req.RejectReason,
		&req.Config,
		&req.CreatedBy,
		&req.AssignedTo,
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func buildOnboardingMilestones(user *User, teams []Team, counts map[string]int, latestRequest *PRRequest, managerUsername string) []OnboardingMilestone {
	nowCreated := user.CreatedAt
	submittedCount := sumStatusCounts(counts) - counts["draft"]
	pendingCount := counts["pending_user_manager_approval"] + counts["pending_devops_approval"] + counts["pending_approval"]
	inProgressCount := counts["in_progress"]
	completedCount := counts["completed"]
	rejectedCount := counts["rejected"]

	teamDetail := "No team assignment yet. An admin needs to add this user to the right team."
	teamState := "current"
	if len(teams) > 0 {
		teamNames := make([]string, 0, len(teams))
		for _, team := range teams {
			teamNames = append(teamNames, team.Name)
			if len(teamNames) == 3 {
				break
			}
		}
		teamDetail = fmt.Sprintf("Assigned to %s.", strings.Join(teamNames, ", "))
		if len(teams) > 3 {
			teamDetail = fmt.Sprintf("%s and %d more team(s).", strings.TrimSuffix(teamDetail, "."), len(teams)-3)
		}
		teamState = "completed"
	}

	submitState := "upcoming"
	submitDetail := "No requests submitted yet."
	if counts["draft"] > 0 && submittedCount == 0 {
		submitState = "current"
		submitDetail = fmt.Sprintf("%d draft request(s) are waiting to be submitted.", counts["draft"])
	} else if submittedCount > 0 {
		submitState = "completed"
		submitDetail = fmt.Sprintf("%d request(s) submitted for review or delivery.", submittedCount)
	}

	reviewState := "upcoming"
	reviewDetail := "Review starts after the first request is submitted."
	if pendingCount > 0 {
		reviewState = "current"
		reviewDetail = fmt.Sprintf("%d request(s) are currently under review.", pendingCount)
	} else if inProgressCount > 0 || completedCount > 0 || rejectedCount > 0 {
		reviewState = "completed"
		reviewDetail = "At least one request has already passed through review."
	}

	decisionState := "upcoming"
	decisionDetail := "Approval or rejection appears here after review."
	if latestRequest != nil {
		switch latestRequest.Status {
		case "rejected":
			decisionState = "attention"
			decisionDetail = fmt.Sprintf("Latest request #%d was rejected. Review the reason and resubmit.", latestRequest.ID)
		case "in_progress", "completed":
			decisionState = "completed"
			decisionDetail = fmt.Sprintf("Latest request #%d was approved and moved into delivery.", latestRequest.ID)
		case "pending_user_manager_approval", "pending_devops_approval", "pending_approval":
			decisionState = "current"
			decisionDetail = fmt.Sprintf("Latest request #%d is still waiting for a final decision.", latestRequest.ID)
		case "draft":
			decisionState = "upcoming"
			decisionDetail = fmt.Sprintf("Latest request #%d is still a draft and has not entered review yet.", latestRequest.ID)
		}
	}

	deliveryState := "upcoming"
	deliveryDetail := "Provisioning completes after approval and execution."
	if completedCount > 0 {
		deliveryState = "completed"
		deliveryDetail = fmt.Sprintf("%d request(s) already reached completed delivery.", completedCount)
	} else if inProgressCount > 0 {
		deliveryState = "current"
		deliveryDetail = fmt.Sprintf("%d approved request(s) are currently being delivered.", inProgressCount)
	}

	createdDetail := "Account created and ready for onboarding."
	if !user.Verified {
		createdDetail = "Account created, but email verification is still pending."
	} else if managerUsername != "" {
		createdDetail = fmt.Sprintf("Account created and linked to manager %s.", managerUsername)
	}

	return []OnboardingMilestone{
		{
			Key:       "user_created",
			Title:     "User created",
			Detail:    createdDetail,
			State:     "completed",
			Timestamp: &nowCreated,
		},
		{
			Key:    "team_assigned",
			Title:  "Team assigned",
			Detail: teamDetail,
			State:  teamState,
		},
		{
			Key:    "request_submitted",
			Title:  "Request submitted",
			Detail: submitDetail,
			State:  submitState,
		},
		{
			Key:    "under_review",
			Title:  "Under review",
			Detail: reviewDetail,
			State:  reviewState,
		},
		{
			Key:    "decision",
			Title:  "Approved / rejected",
			Detail: decisionDetail,
			State:  decisionState,
		},
		{
			Key:    "provisioned",
			Title:  "Provisioned / completed",
			Detail: deliveryDetail,
			State:  deliveryState,
		},
	}
}

func deriveOnboardingNextAction(user *User, teams []Team, counts map[string]int, latestRequest *PRRequest) string {
	if !user.Verified {
		return "Verify the account first so the user can sign in and continue onboarding."
	}
	if len(teams) == 0 {
		return "Assign the user to a team so they can start using the right request paths."
	}
	if counts["draft"] > 0 && sumStatusCounts(counts)-counts["draft"] == 0 {
		return "Submit the existing draft request to move onboarding into review."
	}
	if sumStatusCounts(counts) == 0 {
		return "Create the first infrastructure request or start from an approved template."
	}
	if latestRequest != nil {
		switch latestRequest.Status {
		case "pending_user_manager_approval", "pending_devops_approval", "pending_approval":
			return "Watch the latest request while it moves through approval."
		case "rejected":
			return "Review the rejection notes on the latest request and resubmit with the required changes."
		case "in_progress":
			return "Track delivery on the latest approved request until provisioning completes."
		}
	}
	if counts["completed"] > 0 {
		return "Use the completed request as a baseline and clone or template it for the next onboarding action."
	}
	return "Continue the latest onboarding task from the request history."
}

func computeOnboardingCompletion(milestones []OnboardingMilestone) int {
	if len(milestones) == 0 {
		return 0
	}
	score := 0.0
	for _, milestone := range milestones {
		switch milestone.State {
		case "completed":
			score += 1
		case "current":
			score += 0.5
		case "attention":
			score += 0.25
		}
	}
	return int((score / float64(len(milestones))) * 100)
}

func sumStatusCounts(counts map[string]int) int {
	total := 0
	for _, count := range counts {
		total += count
	}
	return total
}
