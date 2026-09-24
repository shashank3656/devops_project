package main

import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type projectReleaseSummary struct {
	TotalRequests       int        `json:"total_requests"`
	CompletedRequests   int        `json:"completed_requests"`
	PendingRequests     int        `json:"pending_requests"`
	InProgressRequests  int        `json:"in_progress_requests"`
	PromotionReadyCount int        `json:"promotion_ready_count"`
	OpenIncidentCount   int        `json:"open_incident_count"`
	RunbookCount        int        `json:"runbook_count"`
	ActiveOverrideCount int        `json:"active_override_count"`
	LastReleaseAt       *time.Time `json:"last_release_at,omitempty"`
}

type projectReleaseEnvironmentStatus struct {
	Environment     string     `json:"environment"`
	LatestRequestID *int       `json:"latest_request_id,omitempty"`
	LatestStatus    string     `json:"latest_status,omitempty"`
	LatestService   string     `json:"latest_service,omitempty"`
	LatestCloud     string     `json:"latest_cloud,omitempty"`
	LatestUpdatedAt *time.Time `json:"latest_updated_at,omitempty"`
	PendingCount    int        `json:"pending_count"`
	CompletedCount  int        `json:"completed_count"`
	IncidentCount   int        `json:"incident_count"`
	Health          string     `json:"health"`
}

type projectReleaseActivityItem struct {
	RequestID   int        `json:"request_id"`
	Team        string     `json:"team"`
	Environment string     `json:"environment"`
	Cloud       string     `json:"cloud"`
	Service     string     `json:"service"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	ClientName  string     `json:"client_name"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	PRURL       string     `json:"pr_url,omitempty"`
}

type projectReleaseTrendPoint struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type projectReleaseDashboard struct {
	Summary             projectReleaseSummary             `json:"summary"`
	EnvironmentStatuses []projectReleaseEnvironmentStatus `json:"environment_statuses"`
	RecentActivity      []projectReleaseActivityItem      `json:"recent_activity"`
	ReleaseTrend        []projectReleaseTrendPoint        `json:"release_trend"`
	PromotionQueue      []promotionCenterItem             `json:"promotion_queue"`
	Incidents           []requestIncident                 `json:"incidents"`
	Runbooks            []projectRunbook                  `json:"runbooks"`
	ActiveOverrides     []projectAccessOverride           `json:"active_overrides"`
	DeploymentGates     deploymentGatePolicyEngine        `json:"deployment_gates"`
	K8sPreview          *projectK8sPreview                `json:"k8s_preview,omitempty"`
	ExpiryPreview       *projectExpiryPreview             `json:"expiry_preview,omitempty"`
}

type projectK8sPreview struct {
	ConnectionCount    int                      `json:"connection_count"`
	ClusterCount       int                      `json:"cluster_count"`
	NamespaceCount     int                      `json:"namespace_count"`
	HealthSummary      k8sWorkloadHealthSummary `json:"health_summary"`
	NamespaceWatchlist []k8sNamespaceHealth     `json:"namespace_watchlist"`
	WorkloadSpotlights []k8sWorkloadSpotlight   `json:"workload_spotlights"`
}

type projectExpiryPreview struct {
	Summary       expiryTrackerSummary `json:"summary"`
	PriorityItems []expiryTrackerItem  `json:"priority_items"`
}

type deploymentGatePolicySummary struct {
	ReadyEnvironments     int `json:"ready_environments"`
	AttentionEnvironments int `json:"attention_environments"`
	BlockedEnvironments   int `json:"blocked_environments"`
}

type deploymentGateCheck struct {
	Key         string                  `json:"key"`
	Label       string                  `json:"label"`
	Status      string                  `json:"status"`
	Detail      string                  `json:"detail"`
	PRURL       string                  `json:"pr_url,omitempty"`
	ChangeBrief *deployIntelChangeBrief `json:"change_brief,omitempty"`
}

type deploymentGateEnvironment struct {
	Environment             string                `json:"environment"`
	Status                  string                `json:"status"`
	Summary                 string                `json:"summary"`
	RequiresManagerApproval bool                  `json:"requires_manager_approval"`
	RequiresDevopsApproval  bool                  `json:"requires_devops_approval"`
	PromotionCandidateCount int                   `json:"promotion_candidate_count"`
	IncidentCount           int                   `json:"incident_count"`
	ActiveOverrideCount     int                   `json:"active_override_count"`
	Checks                  []deploymentGateCheck `json:"checks"`
}

type deploymentGatePolicyEngine struct {
	Summary      deploymentGatePolicySummary `json:"summary"`
	Environments []deploymentGateEnvironment `json:"environments"`
}

type promotionGateDecision struct {
	TargetEnvironment       string                         `json:"target_environment"`
	Status                  string                         `json:"status"`
	Summary                 string                         `json:"summary"`
	CanPromote              bool                           `json:"can_promote"`
	RequiresAcknowledgement bool                           `json:"requires_acknowledgement"`
	CommentRequired         bool                           `json:"comment_required"`
	ReviewMessage           string                         `json:"review_message"`
	BlockingCheckCount      int                            `json:"blocking_check_count"`
	AttentionCheckCount     int                            `json:"attention_check_count"`
	Checks                  []deploymentGateCheck          `json:"checks"`
	Approved                bool                           `json:"approved"`
	Approval                *deploymentGateApprovalRecord  `json:"approval,omitempty"`
	ApprovalHistory         []deploymentGateApprovalRecord `json:"approval_history,omitempty"`
}

type expiryTrackerSummary struct {
	TotalItems           int `json:"total_items"`
	CredentialItems      int `json:"credential_items"`
	SecretItems          int `json:"secret_items"`
	CertificateItems     int `json:"certificate_items"`
	ExpiredCount         int `json:"expired_count"`
	ExpiringWithin30Days int `json:"expiring_within_30_days"`
	ExpiringWithin60Days int `json:"expiring_within_60_days"`
	HealthyCount         int `json:"healthy_count"`
	ActionableCount      int `json:"actionable_count"`
	AcknowledgedCount    int `json:"acknowledged_count"`
	InProgressCount      int `json:"in_progress_count"`
	RotatedCount         int `json:"rotated_count"`
}

type expiryTrackerItem struct {
	ItemKey                   string     `json:"item_key"`
	Category                  string     `json:"category"`
	Source                    string     `json:"source"`
	ProjectID                 *int       `json:"project_id,omitempty"`
	ProjectName               string     `json:"project_name,omitempty"`
	ProjectCode               string     `json:"project_code,omitempty"`
	Cloud                     string     `json:"cloud,omitempty"`
	Environment               string     `json:"environment,omitempty"`
	ClusterName               string     `json:"cluster_name,omitempty"`
	Namespace                 string     `json:"namespace,omitempty"`
	ResourceName              string     `json:"resource_name"`
	ResourceType              string     `json:"resource_type"`
	Owner                     string     `json:"owner,omitempty"`
	CreatedAt                 *time.Time `json:"created_at,omitempty"`
	ExpiresAt                 *time.Time `json:"expires_at,omitempty"`
	DaysRemaining             int        `json:"days_remaining"`
	Status                    string     `json:"status"`
	Recommendation            string     `json:"recommendation"`
	WorkflowState             string     `json:"workflow_state"`
	WorkflowNote              string     `json:"workflow_note,omitempty"`
	WorkflowUpdatedAt         *time.Time `json:"workflow_updated_at,omitempty"`
	WorkflowUpdatedByUsername string     `json:"workflow_updated_by_username,omitempty"`
}

type expiryTrackerPayload struct {
	Summary expiryTrackerSummary `json:"summary"`
	Items   []expiryTrackerItem  `json:"items"`
}

type k8sWorkloadHealthSummary struct {
	HealthyDeployments    int `json:"healthy_deployments"`
	DegradedDeployments   int `json:"degraded_deployments"`
	BlockedDeployments    int `json:"blocked_deployments"`
	ScaledDownDeployments int `json:"scaled_down_deployments"`
	RestartingPods        int `json:"restarting_pods"`
	NonRunningPods        int `json:"non_running_pods"`
	WarningLogs           int `json:"warning_logs"`
	UnhealthyNamespaces   int `json:"unhealthy_namespaces"`
}

type k8sNamespaceHealth struct {
	Namespace           string `json:"namespace"`
	ClusterName         string `json:"cluster_name"`
	Status              string `json:"status"`
	IssueCount          int    `json:"issue_count"`
	RestartingPods      int    `json:"restarting_pods"`
	WarningLogs         int    `json:"warning_logs"`
	AffectedDeployments int    `json:"affected_deployments"`
}

type k8sWorkloadSpotlight struct {
	Name          string `json:"name"`
	Namespace     string `json:"namespace"`
	ClusterName   string `json:"cluster_name"`
	Status        string `json:"status"`
	ReadyReplicas int    `json:"ready_replicas"`
	Replicas      int    `json:"replicas"`
	RestartCount  int    `json:"restart_count"`
	WarningCount  int    `json:"warning_count"`
}

func buildProjectReleaseDashboard(project ProjectCatalog) (*projectReleaseDashboard, error) {
	requests, err := GetPRRequests("", "", "", project.ID, "", "", "", 0, 0, nil, 150, 0, "updated_at", "desc", false, "", "")
	if err != nil {
		return nil, err
	}

	promotionItems, err := listPromotionCenterItems()
	if err != nil {
		return nil, err
	}
	filteredPromotions := make([]promotionCenterItem, 0)
	for _, item := range promotionItems {
		if item.ProjectID != nil && *item.ProjectID == project.ID {
			filteredPromotions = append(filteredPromotions, item)
		}
	}
	displayPromotions := filteredPromotions
	if len(displayPromotions) > 5 {
		displayPromotions = displayPromotions[:5]
	}

	incidentItems, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	projectRequestIDs := make(map[int]struct{}, len(requests))
	for _, req := range requests {
		projectRequestIDs[req.ID] = struct{}{}
	}
	filteredIncidents := make([]requestIncident, 0)
	for _, item := range incidentItems {
		if item.ProjectID != nil && *item.ProjectID == project.ID {
			filteredIncidents = append(filteredIncidents, item)
			continue
		}
		if _, ok := projectRequestIDs[item.RequestID]; ok {
			filteredIncidents = append(filteredIncidents, item)
		}
	}
	displayIncidents := filteredIncidents
	if len(displayIncidents) > 5 {
		displayIncidents = displayIncidents[:5]
	}

	runbooks, err := listProjectRunbooks(project.ID)
	if err != nil {
		return nil, err
	}
	displayRunbooks := runbooks
	if len(displayRunbooks) > 5 {
		displayRunbooks = displayRunbooks[:5]
	}

	overrideItems, err := listProjectAccessOverrides(true)
	if err != nil {
		return nil, err
	}
	filteredOverrides := make([]projectAccessOverride, 0)
	for _, item := range overrideItems {
		if item.ProjectID == project.ID {
			filteredOverrides = append(filteredOverrides, item)
		}
	}
	displayOverrides := filteredOverrides
	if len(displayOverrides) > 5 {
		displayOverrides = displayOverrides[:5]
	}

	summary := projectReleaseSummary{
		TotalRequests:       len(requests),
		PromotionReadyCount: len(filteredPromotions),
		OpenIncidentCount:   len(filteredIncidents),
		RunbookCount:        len(runbooks),
		ActiveOverrideCount: len(filteredOverrides),
	}

	recentActivity := make([]projectReleaseActivityItem, 0, minInt(len(requests), 8))
	environmentSet := make(map[string]struct{}, len(project.Environments))
	environmentOrder := make([]string, 0, len(project.Environments))
	for _, env := range project.Environments {
		normalized := strings.ToLower(strings.TrimSpace(env))
		if normalized == "" {
			continue
		}
		if _, ok := environmentSet[normalized]; ok {
			continue
		}
		environmentSet[normalized] = struct{}{}
		environmentOrder = append(environmentOrder, normalized)
	}

	type envAggregate struct {
		LatestRequestID *int
		LatestStatus    string
		LatestService   string
		LatestCloud     string
		LatestUpdatedAt *time.Time
		PendingCount    int
		CompletedCount  int
		IncidentCount   int
	}
	envStats := make(map[string]*envAggregate)

	now := time.Now()
	releaseTrendByDay := make(map[string]int, 7)
	for day := 6; day >= 0; day-- {
		label := now.AddDate(0, 0, -day).Format("02 Jan")
		releaseTrendByDay[label] = 0
	}

	for _, incident := range filteredIncidents {
		if !incidentBlocksPromotion(incident) {
			continue
		}
		envKey := incidentEnvironmentKey(incident)
		if envKey == "" {
			continue
		}
		if _, ok := envStats[envKey]; !ok {
			envStats[envKey] = &envAggregate{}
		}
		envStats[envKey].IncidentCount++
		if _, ok := environmentSet[envKey]; !ok {
			environmentSet[envKey] = struct{}{}
			environmentOrder = append(environmentOrder, envKey)
		}
	}

	for index, req := range requests {
		status := strings.ToLower(strings.TrimSpace(req.Status))
		envKey := strings.ToLower(strings.TrimSpace(req.Env))
		if envKey == "" {
			envKey = "unknown"
		}
		if _, ok := envStats[envKey]; !ok {
			envStats[envKey] = &envAggregate{}
		}
		stats := envStats[envKey]
		if stats.LatestUpdatedAt == nil || req.UpdatedAt.After(*stats.LatestUpdatedAt) {
			latestUpdatedAt := req.UpdatedAt
			stats.LatestUpdatedAt = &latestUpdatedAt
			latestRequestID := req.ID
			stats.LatestRequestID = &latestRequestID
			stats.LatestStatus = req.Status
			stats.LatestService = req.Service
			stats.LatestCloud = req.Cloud
		}

		switch {
		case strings.Contains(status, "pending"):
			summary.PendingRequests++
			stats.PendingCount++
		case status == "in_progress":
			summary.InProgressRequests++
		case status == "completed":
			summary.CompletedRequests++
			stats.CompletedCount++
			label := req.UpdatedAt.Format("02 Jan")
			if _, ok := releaseTrendByDay[label]; ok {
				releaseTrendByDay[label]++
			}
			if summary.LastReleaseAt == nil || req.UpdatedAt.After(*summary.LastReleaseAt) {
				lastReleaseAt := req.UpdatedAt
				summary.LastReleaseAt = &lastReleaseAt
			}
		}

		if _, ok := environmentSet[envKey]; !ok {
			environmentSet[envKey] = struct{}{}
			environmentOrder = append(environmentOrder, envKey)
		}

		if index < 8 {
			recentActivity = append(recentActivity, projectReleaseActivityItem{
				RequestID:   req.ID,
				Team:        req.Team,
				Environment: req.Env,
				Cloud:       req.Cloud,
				Service:     req.Service,
				Status:      req.Status,
				Priority:    req.Priority,
				ClientName:  req.ClientName,
				UpdatedAt:   req.UpdatedAt,
				DueDate:     req.DueDate,
				PRURL:       req.PRURL,
			})
		}
	}

	environmentStatuses := make([]projectReleaseEnvironmentStatus, 0, len(environmentOrder))
	for _, env := range environmentOrder {
		stats := envStats[env]
		if stats == nil {
			stats = &envAggregate{}
		}
		environmentStatuses = append(environmentStatuses, projectReleaseEnvironmentStatus{
			Environment:     env,
			LatestRequestID: stats.LatestRequestID,
			LatestStatus:    stats.LatestStatus,
			LatestService:   stats.LatestService,
			LatestCloud:     stats.LatestCloud,
			LatestUpdatedAt: stats.LatestUpdatedAt,
			PendingCount:    stats.PendingCount,
			CompletedCount:  stats.CompletedCount,
			IncidentCount:   stats.IncidentCount,
			Health:          deriveProjectReleaseHealth(stats.LatestStatus, stats.PendingCount, stats.IncidentCount),
		})
	}

	releaseTrend := make([]projectReleaseTrendPoint, 0, len(releaseTrendByDay))
	for day := 6; day >= 0; day-- {
		label := now.AddDate(0, 0, -day).Format("02 Jan")
		releaseTrend = append(releaseTrend, projectReleaseTrendPoint{
			Label: label,
			Count: releaseTrendByDay[label],
		})
	}

	k8sPreview, err := buildProjectK8sPreview(project)
	if err != nil {
		log.Printf("project k8s preview: %v", err)
		k8sPreview = nil
	}
	expiryPreview, err := buildProjectExpiryPreview(project)
	if err != nil {
		log.Printf("project expiry preview: %v", err)
		expiryPreview = nil
	}

	return &projectReleaseDashboard{
		Summary:             summary,
		EnvironmentStatuses: environmentStatuses,
		RecentActivity:      recentActivity,
		ReleaseTrend:        releaseTrend,
		PromotionQueue:      displayPromotions,
		Incidents:           displayIncidents,
		Runbooks:            displayRunbooks,
		ActiveOverrides:     displayOverrides,
		DeploymentGates:     buildDeploymentGatePolicyEngine(project, environmentStatuses, filteredPromotions, runbooks, filteredOverrides),
		K8sPreview:          k8sPreview,
		ExpiryPreview:       expiryPreview,
	}, nil
}

func buildProjectK8sPreview(project ProjectCatalog) (*projectK8sPreview, error) {
	overview, err := buildK8sDashboard(project.ID, "", "", "", true)
	if err != nil {
		return nil, err
	}
	if overview == nil {
		return &projectK8sPreview{}, nil
	}

	namespaceWatchlist := append([]k8sNamespaceHealth(nil), overview.NamespaceHealth...)
	workloadSpotlights := append([]k8sWorkloadSpotlight(nil), overview.WorkloadSpotlights...)
	if len(namespaceWatchlist) > 4 {
		namespaceWatchlist = namespaceWatchlist[:4]
	}
	if len(workloadSpotlights) > 4 {
		workloadSpotlights = workloadSpotlights[:4]
	}

	return &projectK8sPreview{
		ConnectionCount:    len(overview.Connections),
		ClusterCount:       len(overview.Clusters),
		NamespaceCount:     overview.Summary.NamespaceCount,
		HealthSummary:      overview.HealthSummary,
		NamespaceWatchlist: namespaceWatchlist,
		WorkloadSpotlights: workloadSpotlights,
	}, nil
}

func buildProjectExpiryPreview(project ProjectCatalog) (*projectExpiryPreview, error) {
	entries, err := GetCredentialAuditLogs(200, 0, "", "", "", project.ID)
	if err != nil {
		return nil, err
	}

	payload, err := buildExpiryTracker(entries, "", project.ID, "", "")
	if err != nil {
		return nil, err
	}
	if payload == nil {
		return &projectExpiryPreview{}, nil
	}

	actions, err := listExpiryTrackerActions(expiryTrackerItemKeys(payload.Items))
	if err != nil {
		return nil, err
	}
	applyExpiryTrackerActions(payload, actions)

	priorityItems := make([]expiryTrackerItem, 0, len(payload.Items))
	for _, item := range payload.Items {
		if item.Status == "healthy" && item.WorkflowState == "open" {
			continue
		}
		priorityItems = append(priorityItems, item)
	}
	if len(priorityItems) == 0 {
		priorityItems = append(priorityItems, payload.Items...)
	}
	if len(priorityItems) > 5 {
		priorityItems = priorityItems[:5]
	}

	return &projectExpiryPreview{
		Summary:       payload.Summary,
		PriorityItems: priorityItems,
	}, nil
}

func buildDeploymentGatePolicyEngine(
	project ProjectCatalog,
	environmentStatuses []projectReleaseEnvironmentStatus,
	promotionQueue []promotionCenterItem,
	runbooks []projectRunbook,
	activeOverrides []projectAccessOverride,
) deploymentGatePolicyEngine {
	summary := deploymentGatePolicySummary{}
	statusByEnvironment := make(map[string]projectReleaseEnvironmentStatus, len(environmentStatuses))
	for _, item := range environmentStatuses {
		statusByEnvironment[strings.ToLower(strings.TrimSpace(item.Environment))] = item
	}

	promotionCandidatesByEnvironment := make(map[string]int)
	for _, item := range promotionQueue {
		targetEnv := strings.ToLower(strings.TrimSpace(item.NextEnvironment))
		if targetEnv == "" {
			continue
		}
		promotionCandidatesByEnvironment[targetEnv]++
	}

	overrideCountsByEnvironment := make(map[string]int)
	normalizedProjectEnvironments := make([]string, 0, len(project.Environments))
	seenEnvironments := make(map[string]struct{}, len(project.Environments))
	for _, environment := range project.Environments {
		normalized := strings.ToLower(strings.TrimSpace(environment))
		if normalized == "" {
			continue
		}
		if _, ok := seenEnvironments[normalized]; ok {
			continue
		}
		seenEnvironments[normalized] = struct{}{}
		normalizedProjectEnvironments = append(normalizedProjectEnvironments, normalized)
	}
	for _, item := range activeOverrides {
		appliesToAll := false
		for _, environment := range item.Environments {
			normalized := strings.ToLower(strings.TrimSpace(environment))
			if normalized == "" {
				continue
			}
			if normalized == "*" || normalized == "all" {
				appliesToAll = true
				break
			}
			overrideCountsByEnvironment[normalized]++
		}
		if appliesToAll {
			for _, environment := range normalizedProjectEnvironments {
				overrideCountsByEnvironment[environment]++
			}
		}
	}

	environments := make([]deploymentGateEnvironment, 0, len(normalizedProjectEnvironments))
	for index, environment := range normalizedProjectEnvironments {
		rule := findProjectApprovalRule(&project, environment)
		if rule == nil {
			defaultRule := defaultProjectApprovalRule(environment)
			rule = &defaultRule
		}
		envStatus, hasStatus := statusByEnvironment[environment]
		incidentCount := 0
		if hasStatus {
			incidentCount = envStatus.IncidentCount
		}
		promotionCandidateCount := 0
		if index > 0 {
			promotionCandidateCount = promotionCandidatesByEnvironment[environment]
		}
		overrideCount := overrideCountsByEnvironment[environment]

		checks := make([]deploymentGateCheck, 0, 6)
		approvalDetail := "Manager approval is bypassed."
		switch {
		case rule.RequireManagerApproval && rule.RequireDevopsApproval:
			approvalDetail = "Manager approval and DevOps approval are both required before promotion."
		case rule.RequireManagerApproval:
			approvalDetail = "Manager approval is required before the request can continue."
		case rule.RequireDevopsApproval:
			approvalDetail = "The request routes directly to DevOps approval."
		default:
			approvalDetail = "The project rule allows promotion without manager or DevOps gate after submission."
		}
		checks = append(checks, deploymentGateCheck{
			Key:    "approval_policy",
			Label:  "Approval policy",
			Status: "ready",
			Detail: approvalDetail,
		})

		if index == 0 {
			checks = append(checks, deploymentGateCheck{
				Key:    "promotion_source",
				Label:  "Environment intake",
				Status: "ready",
				Detail: "This is the first project environment, so requests can enter this stage directly.",
			})
		} else if promotionCandidateCount > 0 {
			checks = append(checks, deploymentGateCheck{
				Key:    "promotion_source",
				Label:  "Promotion source",
				Status: "ready",
				Detail: fmt.Sprintf("%d completed request(s) are currently ready to promote into this environment.", promotionCandidateCount),
			})
		} else {
			checks = append(checks, deploymentGateCheck{
				Key:    "promotion_source",
				Label:  "Promotion source",
				Status: "attention",
				Detail: fmt.Sprintf("No completed upstream request is currently queued to promote into %s.", strings.ToUpper(environment)),
			})
		}

		if incidentCount > 0 {
			checks = append(checks, deploymentGateCheck{
				Key:    "incident_guard",
				Label:  "Incident guard",
				Status: "blocked",
				Detail: fmt.Sprintf("%d active incident(s) are linked to this environment and should be resolved before promotion.", incidentCount),
			})
		} else {
			checks = append(checks, deploymentGateCheck{
				Key:    "incident_guard",
				Label:  "Incident guard",
				Status: "ready",
				Detail: "No active incidents are blocking this environment.",
			})
		}
		if reason := sloBudgetFreezeReason(environment); reason != "" {
			checks = append(checks, deploymentGateCheck{
				Key:    "slo_budget",
				Label:  "Error budget",
				Status: "blocked",
				Detail: reason,
			})
		}

		productionLike := isHighControlEnvironment(environment)
		if len(runbooks) == 0 && productionLike {
			checks = append(checks, deploymentGateCheck{
				Key:    "rollback_plan",
				Label:  "Rollback coverage",
				Status: "blocked",
				Detail: "No project runbook is available yet. Higher-control environments require rollback guidance before deployment.",
			})
		} else if len(runbooks) == 0 {
			checks = append(checks, deploymentGateCheck{
				Key:    "rollback_plan",
				Label:  "Rollback coverage",
				Status: "attention",
				Detail: "No project runbook is linked yet. Add at least one runbook before this environment becomes operationally risky.",
			})
		} else {
			checks = append(checks, deploymentGateCheck{
				Key:    "rollback_plan",
				Label:  "Rollback coverage",
				Status: "ready",
				Detail: fmt.Sprintf("%d project runbook(s) are available to support rollback and recovery.", len(runbooks)),
			})
		}

		if productionLike {
			checks = append(checks, deploymentGateCheck{
				Key:    "change_window",
				Label:  "Change window",
				Status: "attention",
				Detail: "Manual change-window confirmation is still required here. Calendar-backed enforcement can be layered on later.",
			})
		}

		if overrideCount > 0 {
			checks = append(checks, deploymentGateCheck{
				Key:    "temporary_access",
				Label:  "Temporary access",
				Status: "attention",
				Detail: fmt.Sprintf("%d active access override(s) exist for this environment. Review them before deployment.", overrideCount),
			})
		} else {
			checks = append(checks, deploymentGateCheck{
				Key:    "temporary_access",
				Label:  "Temporary access",
				Status: "ready",
				Detail: "No temporary access overrides are active for this environment.",
			})
		}

		gateStatus := "ready"
		for _, check := range checks {
			switch check.Status {
			case "blocked":
				gateStatus = "blocked"
			case "attention":
				if gateStatus != "blocked" {
					gateStatus = "attention"
				}
			}
		}

		gateSummary := "Ready for promotion under the current project policy."
		switch gateStatus {
		case "blocked":
			gateSummary = "Blocked until the active incident or rollback coverage issue is resolved."
		case "attention":
			gateSummary = "Needs operational review before promotion can proceed cleanly."
		}

		environments = append(environments, deploymentGateEnvironment{
			Environment:             environment,
			Status:                  gateStatus,
			Summary:                 gateSummary,
			RequiresManagerApproval: rule.RequireManagerApproval,
			RequiresDevopsApproval:  rule.RequireDevopsApproval,
			PromotionCandidateCount: promotionCandidateCount,
			IncidentCount:           incidentCount,
			ActiveOverrideCount:     overrideCount,
			Checks:                  checks,
		})

		switch gateStatus {
		case "blocked":
			summary.BlockedEnvironments++
		case "attention":
			summary.AttentionEnvironments++
		default:
			summary.ReadyEnvironments++
		}
	}

	return deploymentGatePolicyEngine{
		Summary:      summary,
		Environments: environments,
	}
}

func isHighControlEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "prod", "production", "uat", "stage", "staging", "preprod", "pre-production":
		return true
	default:
		return false
	}
}

func findDeploymentGateEnvironment(engine deploymentGatePolicyEngine, environment string) *deploymentGateEnvironment {
	normalizedEnvironment := strings.ToLower(strings.TrimSpace(environment))
	if normalizedEnvironment == "" {
		return nil
	}
	for _, item := range engine.Environments {
		if strings.ToLower(strings.TrimSpace(item.Environment)) == normalizedEnvironment {
			gate := item
			return &gate
		}
	}
	return nil
}

func buildUngatedPromotionDecision(targetEnvironment string) *promotionGateDecision {
	summary := fmt.Sprintf(
		"No deployment gate target is configured for %s yet. Promotion can continue without an additional gate review.",
		strings.ToUpper(strings.TrimSpace(targetEnvironment)),
	)
	decision := buildPromotionGateDecision(targetEnvironment, nil, nil, summary, false)
	decision.Status = "ready"
	decision.CanPromote = true
	decision.RequiresAcknowledgement = false
	decision.CommentRequired = false
	decision.ReviewMessage = "No deployment gate target is configured for this environment, so promotion can continue."
	decision.Summary = summary
	return decision
}

func buildPromotionGateDecision(targetEnvironment string, gate *deploymentGateEnvironment, approval *deploymentGateApprovalRecord, fallbackSummary string, fallbackBlocked bool) *promotionGateDecision {
	targetEnvironment = strings.ToLower(strings.TrimSpace(targetEnvironment))
	if targetEnvironment == "" {
		targetEnvironment = "unknown"
	}

	decision := &promotionGateDecision{
		TargetEnvironment: targetEnvironment,
		Status:            "attention",
		Summary:           strings.TrimSpace(fallbackSummary),
		CanPromote:        !fallbackBlocked,
		Approval:          approval,
	}

	if fallbackBlocked {
		decision.Status = "blocked"
		decision.ReviewMessage = "This promotion is blocked by deployment gate policy and cannot continue until the blocking issue is resolved."
	} else {
		decision.RequiresAcknowledgement = true
		decision.ReviewMessage = "This promotion needs an explicit operator acknowledgement before continuing."
	}

	if gate != nil {
		decision.Status = strings.ToLower(strings.TrimSpace(gate.Status))
		if decision.Status == "" {
			decision.Status = "attention"
		}
		decision.Summary = strings.TrimSpace(gate.Summary)
		decision.Checks = append([]deploymentGateCheck(nil), gate.Checks...)
		for _, check := range gate.Checks {
			switch strings.ToLower(strings.TrimSpace(check.Status)) {
			case "blocked":
				decision.BlockingCheckCount++
			case "attention":
				decision.AttentionCheckCount++
			}
		}
		switch decision.Status {
		case "blocked":
			decision.CanPromote = false
			decision.RequiresAcknowledgement = false
			decision.ReviewMessage = "This promotion is blocked by deployment gate policy and cannot continue until the blocking issue is resolved."
		case "attention":
			if approval != nil {
				decision.Status = "ready"
				decision.CanPromote = true
				decision.RequiresAcknowledgement = false
				decision.Approved = true
				decision.ReviewMessage = "A deployment gate approval has already been recorded for this promotion candidate."
				username := strings.TrimSpace(approval.ApprovedByUsername)
				if username == "" {
					username = "the assigned reviewer"
				}
				decision.Summary = fmt.Sprintf("%s Approval recorded by %s.", strings.TrimSpace(gate.Summary), username)
			} else {
				decision.CanPromote = false
				decision.RequiresAcknowledgement = true
				decision.CommentRequired = targetEnvironment == "prod"
				if decision.CommentRequired {
					decision.ReviewMessage = "This promotion requires a persisted deployment gate approval and a justification note before continuing."
				} else {
					decision.ReviewMessage = "This promotion requires a persisted deployment gate approval before continuing."
				}
			}
		default:
			decision.Status = "ready"
			decision.CanPromote = true
			decision.RequiresAcknowledgement = false
			decision.ReviewMessage = "This promotion is ready to proceed under the current deployment gate policy."
		}
	}

	if strings.TrimSpace(decision.Summary) == "" {
		if decision.Status == "blocked" {
			decision.Summary = "Promotion is currently blocked by deployment gate policy."
		} else if decision.Status == "attention" {
			decision.Summary = "Promotion needs an operational review before it proceeds."
		} else {
			decision.Summary = "Promotion is ready under the current deployment gate policy."
		}
	}

	return decision
}

func deriveProjectReleaseHealth(latestStatus string, pendingCount, incidentCount int) string {
	status := strings.ToLower(strings.TrimSpace(latestStatus))
	switch {
	case incidentCount > 0 || status == "rejected":
		return "blocked"
	case pendingCount > 0 || status == "in_progress" || strings.Contains(status, "pending") || status == "draft":
		return "degraded"
	case status == "completed":
		return "healthy"
	default:
		return "planned"
	}
}

func buildK8sWorkloadHealth(namespaceItems []k8sNamespaceItem, deployments []k8sDeploymentItem, pods []k8sPodItem, logs []k8sLogItem) (k8sWorkloadHealthSummary, []k8sNamespaceHealth, []k8sWorkloadSpotlight) {
	summary := k8sWorkloadHealthSummary{}

	namespaceLookup := make(map[string]*k8sNamespaceHealth, len(namespaceItems))
	deploymentRestarts := make(map[string]int, len(deployments))
	deploymentWarnings := make(map[string]int, len(deployments))

	namespaceKey := func(clusterName, namespace string) string {
		return strings.ToLower(strings.TrimSpace(clusterName)) + "::" + strings.ToLower(strings.TrimSpace(namespace))
	}
	deploymentKey := func(clusterName, namespace, name string) string {
		return namespaceKey(clusterName, namespace) + "::" + strings.ToLower(strings.TrimSpace(name))
	}
	getNamespaceHealth := func(clusterName, namespace string) *k8sNamespaceHealth {
		key := namespaceKey(clusterName, namespace)
		if existing, ok := namespaceLookup[key]; ok {
			return existing
		}
		item := &k8sNamespaceHealth{
			Namespace:   namespace,
			ClusterName: clusterName,
			Status:      "healthy",
		}
		namespaceLookup[key] = item
		return item
	}

	for _, item := range deployments {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		namespaceHealth := getNamespaceHealth(item.ClusterName, item.Namespace)
		switch status {
		case "healthy":
			summary.HealthyDeployments++
		case "blocked":
			summary.BlockedDeployments++
			namespaceHealth.IssueCount += 2
			namespaceHealth.AffectedDeployments++
			namespaceHealth.Status = "blocked"
		case "scaled-down":
			summary.ScaledDownDeployments++
		default:
			summary.DegradedDeployments++
			namespaceHealth.IssueCount++
			namespaceHealth.AffectedDeployments++
			if namespaceHealth.Status != "blocked" {
				namespaceHealth.Status = "degraded"
			}
		}
	}

	for _, item := range pods {
		namespaceHealth := getNamespaceHealth(item.ClusterName, item.Namespace)
		deploymentName := strings.TrimSpace(item.Deployment)
		if item.Restarts > 0 {
			summary.RestartingPods++
			namespaceHealth.RestartingPods++
			namespaceHealth.IssueCount++
			if namespaceHealth.Status == "healthy" {
				namespaceHealth.Status = "degraded"
			}
			if deploymentName != "" {
				deploymentRestarts[deploymentKey(item.ClusterName, item.Namespace, deploymentName)] += item.Restarts
			}
		}

		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status != "running" && status != "completed" && status != "succeeded" {
			summary.NonRunningPods++
			namespaceHealth.IssueCount++
			if namespaceHealth.Status != "blocked" {
				namespaceHealth.Status = "degraded"
			}
		}
	}

	for _, item := range logs {
		level := strings.ToLower(strings.TrimSpace(item.Level))
		if level == "" || level == "info" {
			continue
		}
		summary.WarningLogs++
		namespaceHealth := getNamespaceHealth(item.ClusterName, item.Namespace)
		namespaceHealth.WarningLogs++
		namespaceHealth.IssueCount++
		if namespaceHealth.Status == "healthy" {
			namespaceHealth.Status = "degraded"
		}
		deploymentWarnings[deploymentKey(item.ClusterName, item.Namespace, item.Name)]++
	}

	namespaceHealthItems := make([]k8sNamespaceHealth, 0, len(namespaceLookup))
	for _, item := range namespaceLookup {
		if item.IssueCount <= 0 {
			continue
		}
		namespaceHealthItems = append(namespaceHealthItems, *item)
	}
	sort.Slice(namespaceHealthItems, func(i, j int) bool {
		left := k8sHealthSeverityRank(namespaceHealthItems[i].Status)
		right := k8sHealthSeverityRank(namespaceHealthItems[j].Status)
		if left != right {
			return left > right
		}
		if namespaceHealthItems[i].IssueCount != namespaceHealthItems[j].IssueCount {
			return namespaceHealthItems[i].IssueCount > namespaceHealthItems[j].IssueCount
		}
		return namespaceHealthItems[i].Namespace < namespaceHealthItems[j].Namespace
	})
	summary.UnhealthyNamespaces = len(namespaceHealthItems)

	spotlights := make([]k8sWorkloadSpotlight, 0, len(deployments))
	for _, item := range deployments {
		key := deploymentKey(item.ClusterName, item.Namespace, item.Name)
		restartCount := deploymentRestarts[key]
		warningCount := deploymentWarnings[key]
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status == "healthy" && restartCount == 0 && warningCount == 0 {
			continue
		}
		spotlights = append(spotlights, k8sWorkloadSpotlight{
			Name:          item.Name,
			Namespace:     item.Namespace,
			ClusterName:   item.ClusterName,
			Status:        item.Status,
			ReadyReplicas: item.ReadyReplicas,
			Replicas:      item.Replicas,
			RestartCount:  restartCount,
			WarningCount:  warningCount,
		})
	}
	sort.Slice(spotlights, func(i, j int) bool {
		left := k8sHealthSeverityRank(spotlights[i].Status)
		right := k8sHealthSeverityRank(spotlights[j].Status)
		if left != right {
			return left > right
		}
		leftSignalCount := spotlights[i].RestartCount + spotlights[i].WarningCount
		rightSignalCount := spotlights[j].RestartCount + spotlights[j].WarningCount
		if leftSignalCount != rightSignalCount {
			return leftSignalCount > rightSignalCount
		}
		return spotlights[i].Name < spotlights[j].Name
	})
	if len(spotlights) > 8 {
		spotlights = spotlights[:8]
	}
	if len(namespaceHealthItems) > 8 {
		namespaceHealthItems = namespaceHealthItems[:8]
	}

	return summary, namespaceHealthItems, spotlights
}

func k8sHealthSeverityRank(status string) int {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "blocked":
		return 3
	case "degraded":
		return 2
	case "scaled-down":
		return 1
	default:
		return 0
	}
}

func buildExpiryTracker(entries []CredentialAuditEntry, cloudFilter string, projectIDFilter int, fromDate, toDate string) (*expiryTrackerPayload, error) {
	connections, err := listK8sConnections()
	if err != nil {
		return nil, err
	}
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	projectLookup := make(map[int]ProjectCatalog, len(projects))
	for _, project := range projects {
		projectLookup[project.ID] = project
	}

	var fromTime time.Time
	var toTime time.Time
	var hasFrom bool
	var hasTo bool
	if _, parsedFrom, ok := normalizeDateOnlyQuery(fromDate); ok {
		fromTime = parsedFrom
		hasFrom = true
	}
	if _, parsedTo, ok := normalizeDateOnlyQuery(toDate); ok {
		toTime = parsedTo.Add(24*time.Hour - time.Nanosecond)
		hasTo = true
	}

	items := make([]expiryTrackerItem, 0, len(entries)+(len(connections)*2))
	now := time.Now()

	appendItem := func(item expiryTrackerItem) {
		if item.ProjectID != nil && projectIDFilter > 0 && *item.ProjectID != projectIDFilter {
			return
		}
		if strings.TrimSpace(cloudFilter) != "" && !strings.EqualFold(strings.TrimSpace(item.Cloud), strings.TrimSpace(cloudFilter)) {
			return
		}
		if hasFrom && item.CreatedAt != nil && item.CreatedAt.Before(fromTime) {
			return
		}
		if hasTo && item.CreatedAt != nil && item.CreatedAt.After(toTime) {
			return
		}
		item.ItemKey = buildExpiryTrackerItemKey(item)
		item.WorkflowState = "open"
		items = append(items, item)
	}

	for _, entry := range entries {
		window := credentialExpiryWindow(entry.CredentialType)
		expiresAt := entry.CreatedAt.Add(window)
		projectID := entry.ProjectID
		owner := entry.CreatedByUsername
		if owner == "" {
			owner = entry.ApprovedByUsername
		}
		appendItem(expiryTrackerItem{
			Category:       "credential",
			Source:         "credential_audit",
			ProjectID:      projectID,
			ProjectName:    entry.ProjectName,
			ProjectCode:    entry.ProjectCode,
			Cloud:          entry.Cloud,
			Environment:    entry.Env,
			ResourceName:   fmt.Sprintf("%s request", entry.CredentialType),
			ResourceType:   entry.CredentialType,
			Owner:          owner,
			CreatedAt:      timePointer(entry.CreatedAt),
			ExpiresAt:      timePointer(expiresAt),
			DaysRemaining:  daysUntil(expiresAt, now),
			Status:         expiryStatus(expiresAt, now),
			Recommendation: expiryRecommendation("credential", expiresAt, now),
		})
	}

	for _, connection := range connections {
		if projectIDFilter > 0 && connection.ProjectID != projectIDFilter {
			continue
		}
		project, ok := projectLookup[connection.ProjectID]
		if !ok {
			continue
		}
		if strings.TrimSpace(cloudFilter) != "" && !strings.EqualFold(connection.Cloud, cloudFilter) {
			continue
		}

		reviewBase := connection.UpdatedAt
		if reviewBase.IsZero() {
			reviewBase = connection.CreatedAt
		}
		if hasFrom && reviewBase.Before(fromTime) {
			continue
		}
		if hasTo && reviewBase.After(toTime) {
			continue
		}

		certExpiry := reviewBase.Add(120 * 24 * time.Hour)
		appendItem(expiryTrackerItem{
			Category:       "certificate",
			Source:         "k8s_connection",
			ProjectID:      intPointerIfPositive(connection.ProjectID),
			ProjectName:    connection.ProjectName,
			ProjectCode:    connection.ProjectCode,
			Cloud:          connection.Cloud,
			Environment:    connection.Environment,
			ClusterName:    connection.ClusterName,
			Namespace:      connection.Namespace,
			ResourceName:   fmt.Sprintf("%s cluster API certificate", connection.ClusterName),
			ResourceType:   "Cluster certificate review",
			Owner:          project.OwnerTeam,
			CreatedAt:      timePointer(reviewBase),
			ExpiresAt:      timePointer(certExpiry),
			DaysRemaining:  daysUntil(certExpiry, now),
			Status:         expiryStatus(certExpiry, now),
			Recommendation: expiryRecommendation("certificate", certExpiry, now),
		})

		secretExpiry := reviewBase.Add(90 * 24 * time.Hour)
		appendItem(expiryTrackerItem{
			Category:       "secret",
			Source:         "k8s_connection",
			ProjectID:      intPointerIfPositive(connection.ProjectID),
			ProjectName:    connection.ProjectName,
			ProjectCode:    connection.ProjectCode,
			Cloud:          connection.Cloud,
			Environment:    connection.Environment,
			ClusterName:    connection.ClusterName,
			Namespace:      connection.Namespace,
			ResourceName:   fmt.Sprintf("%s shared namespace secret set", connection.Namespace),
			ResourceType:   "K8s secret rotation review",
			Owner:          project.OwnerTeam,
			CreatedAt:      timePointer(reviewBase),
			ExpiresAt:      timePointer(secretExpiry),
			DaysRemaining:  daysUntil(secretExpiry, now),
			Status:         expiryStatus(secretExpiry, now),
			Recommendation: expiryRecommendation("secret", secretExpiry, now),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].DaysRemaining == items[j].DaysRemaining {
			return items[i].ResourceName < items[j].ResourceName
		}
		return items[i].DaysRemaining < items[j].DaysRemaining
	})

	summary := expiryTrackerSummary{
		TotalItems:      len(items),
		ActionableCount: len(items),
	}
	for _, item := range items {
		switch item.Category {
		case "credential":
			summary.CredentialItems++
		case "secret":
			summary.SecretItems++
		case "certificate":
			summary.CertificateItems++
		}
		switch item.Status {
		case "expired":
			summary.ExpiredCount++
		case "expiring_30d":
			summary.ExpiringWithin30Days++
			summary.ExpiringWithin60Days++
		case "expiring_60d":
			summary.ExpiringWithin60Days++
		default:
			summary.HealthyCount++
		}
	}

	return &expiryTrackerPayload{
		Summary: summary,
		Items:   items,
	}, nil
}

func credentialExpiryWindow(credentialType string) time.Duration {
	normalized := strings.ToLower(strings.TrimSpace(credentialType))
	switch {
	case strings.Contains(normalized, "access key"), strings.Contains(normalized, "service account key"):
		return 90 * 24 * time.Hour
	case strings.Contains(normalized, "login"), strings.Contains(normalized, "identity"):
		return 180 * 24 * time.Hour
	default:
		return 120 * 24 * time.Hour
	}
}

func expiryStatus(expiresAt, now time.Time) string {
	days := daysUntil(expiresAt, now)
	switch {
	case days < 0:
		return "expired"
	case days <= 30:
		return "expiring_30d"
	case days <= 60:
		return "expiring_60d"
	default:
		return "healthy"
	}
}

func expiryRecommendation(category string, expiresAt, now time.Time) string {
	switch expiryStatus(expiresAt, now) {
	case "expired":
		return fmt.Sprintf("Rotate this %s immediately and validate downstream consumers.", category)
	case "expiring_30d":
		return fmt.Sprintf("Plan a %s rotation in the next 30 days.", category)
	case "expiring_60d":
		return fmt.Sprintf("Schedule a %s review window before it reaches the 30-day threshold.", category)
	default:
		return fmt.Sprintf("No immediate action required. Keep the %s in the regular review cycle.", category)
	}
}

func daysUntil(expiresAt, now time.Time) int {
	return int(expiresAt.Sub(now).Hours() / 24)
}

func timePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	copyValue := value
	return &copyValue
}

func buildExpiryTrackerItemKey(item expiryTrackerItem) string {
	projectID := ""
	if item.ProjectID != nil && *item.ProjectID > 0 {
		projectID = strconv.Itoa(*item.ProjectID)
	}
	parts := []string{
		normalizeExpiryTrackerKeyPart(item.Category),
		normalizeExpiryTrackerKeyPart(item.Source),
		projectID,
		normalizeExpiryTrackerKeyPart(item.ProjectCode),
		normalizeExpiryTrackerKeyPart(item.Cloud),
		normalizeExpiryTrackerKeyPart(item.Environment),
		normalizeExpiryTrackerKeyPart(item.ClusterName),
		normalizeExpiryTrackerKeyPart(item.Namespace),
		normalizeExpiryTrackerKeyPart(item.ResourceName),
		normalizeExpiryTrackerKeyPart(item.ResourceType),
	}
	return strings.Join(parts, "|")
}

func normalizeExpiryTrackerKeyPart(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return "-"
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	lastUnderscore := false
	for _, character := range trimmed {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			builder.WriteRune(character)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	normalized := strings.Trim(builder.String(), "_")
	if normalized == "" {
		return "-"
	}
	return normalized
}
