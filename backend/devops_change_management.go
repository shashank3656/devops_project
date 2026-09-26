package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type changeRiskFactor struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
	Weight   int    `json:"weight"`
	Detail   string `json:"detail"`
}

type changeRiskEnvironmentScore struct {
	Environment     string `json:"environment"`
	Score           int    `json:"score"`
	RiskLevel       string `json:"risk_level"`
	Summary         string `json:"summary"`
	DriftState      string `json:"drift_state"`
	LatestStatus    string `json:"latest_status"`
	GateStatus      string `json:"gate_status"`
	IncidentCount   int    `json:"incident_count"`
	PendingCount    int    `json:"pending_count"`
	NamespaceAlerts int    `json:"namespace_alerts"`
}

type changeRiskProjectItem struct {
	ProjectID               int                          `json:"project_id"`
	ProjectName             string                       `json:"project_name"`
	ProjectCode             string                       `json:"project_code"`
	OwnerTeam               string                       `json:"owner_team,omitempty"`
	Score                   int                          `json:"score"`
	RiskLevel               string                       `json:"risk_level"`
	Summary                 string                       `json:"summary"`
	RecommendedAction       string                       `json:"recommended_action"`
	BlockedPromotionCount   int                          `json:"blocked_promotion_count"`
	AttentionPromotionCount int                          `json:"attention_promotion_count"`
	OpenIncidentCount       int                          `json:"open_incident_count"`
	ActionableExpiryCount   int                          `json:"actionable_expiry_count"`
	NamespaceAlertCount     int                          `json:"namespace_alert_count"`
	DriftState              string                       `json:"drift_state"`
	CostRiskLevel           string                       `json:"cost_risk_level,omitempty"`
	Factors                 []changeRiskFactor           `json:"factors"`
	Environments            []changeRiskEnvironmentScore `json:"environments"`
}

type changeRiskSummary struct {
	ProjectCount           int `json:"project_count"`
	LowRiskCount           int `json:"low_risk_count"`
	MediumRiskCount        int `json:"medium_risk_count"`
	HighRiskCount          int `json:"high_risk_count"`
	BlockedProjects        int `json:"blocked_projects"`
	IncidentLinkedProjects int `json:"incident_linked_projects"`
	DriftedProjects        int `json:"drifted_projects"`
}

type changeRiskPayload struct {
	Projects []ProjectSummary        `json:"projects"`
	Summary  changeRiskSummary       `json:"summary"`
	Items    []changeRiskProjectItem `json:"items"`
}

type incidentWorkspaceSummary struct {
	TotalIncidents       int `json:"total_incidents"`
	OpenIncidents        int `json:"open_incidents"`
	CriticalIncidents    int `json:"critical_incidents"`
	PostmortemDrafts     int `json:"postmortem_drafts"`
	CompletedPostmortems int `json:"completed_postmortems"`
}

type incidentWorkspaceTimelineEvent struct {
	Key       string    `json:"key"`
	Timestamp time.Time `json:"timestamp"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	Actor     string    `json:"actor,omitempty"`
}

type incidentPostmortemRecord struct {
	ID                    int       `json:"id"`
	IncidentID            int       `json:"incident_id"`
	RequestID             int       `json:"request_id"`
	ProjectID             *int      `json:"project_id,omitempty"`
	Status                string    `json:"status"`
	ImpactSummary         string    `json:"impact_summary"`
	RootCause             string    `json:"root_cause"`
	DetectionSummary      string    `json:"detection_summary"`
	MitigationSummary     string    `json:"mitigation_summary"`
	CorrectiveActions     string    `json:"corrective_actions"`
	FollowUpOwnerUserID   *int      `json:"follow_up_owner_user_id,omitempty"`
	FollowUpOwnerUsername string    `json:"follow_up_owner_username,omitempty"`
	ReviewNotes           string    `json:"review_notes"`
	UpdatedBy             *int      `json:"updated_by,omitempty"`
	UpdatedByUsername     string    `json:"updated_by_username,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type incidentWorkspaceDetail struct {
	Incident           requestIncident                  `json:"incident"`
	Request            *PRRequest                       `json:"request,omitempty"`
	Timeline           []incidentWorkspaceTimelineEvent `json:"timeline"`
	Review             *incidentReviewDraft             `json:"review,omitempty"`
	Postmortem         *incidentPostmortemRecord        `json:"postmortem,omitempty"`
	Runbooks           []projectRunbook                 `json:"runbooks"`
	GateApprovals      []deploymentGateApprovalRecord   `json:"gate_approvals"`
	RollbackOperations []rollbackOperationRecord        `json:"rollback_operations"`
}

type incidentWorkspacePayload struct {
	Projects        []ProjectSummary         `json:"projects"`
	Owners          []DevopsUserListItem     `json:"owners"`
	Summary         incidentWorkspaceSummary `json:"summary"`
	Incidents       []requestIncident        `json:"incidents"`
	FocusIncidentID int                      `json:"focus_incident_id,omitempty"`
	Detail          *incidentWorkspaceDetail `json:"detail,omitempty"`
}

type rollbackSnapshot struct {
	ID        int       `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Note      string    `json:"note"`
	Preview   string    `json:"preview"`
}

type rollbackCandidate struct {
	RequestID         int                `json:"request_id"`
	ProjectID         *int               `json:"project_id,omitempty"`
	ProjectName       string             `json:"project_name,omitempty"`
	ProjectCode       string             `json:"project_code,omitempty"`
	Team              string             `json:"team"`
	Environment       string             `json:"environment"`
	Cloud             string             `json:"cloud"`
	Service           string             `json:"service"`
	Status            string             `json:"status"`
	Priority          string             `json:"priority"`
	ClientName        string             `json:"client_name"`
	UpdatedAt         time.Time          `json:"updated_at"`
	PRURL             string             `json:"pr_url,omitempty"`
	SnapshotCount     int                `json:"snapshot_count"`
	IncidentCount     int                `json:"incident_count"`
	RunbookCount      int                `json:"runbook_count"`
	RollbackCount     int                `json:"rollback_count"`
	Eligible          bool               `json:"eligible"`
	EligibilityReason string             `json:"eligibility_reason"`
	Snapshots         []rollbackSnapshot `json:"snapshots"`
}

type rollbackOperationRecord struct {
	ID                 int       `json:"id"`
	SourceRequestID    int       `json:"source_request_id"`
	RollbackRequestID  int       `json:"rollback_request_id"`
	HistoryID          *int      `json:"history_id,omitempty"`
	ProjectID          *int      `json:"project_id,omitempty"`
	ProjectName        string    `json:"project_name,omitempty"`
	ProjectCode        string    `json:"project_code,omitempty"`
	Team               string    `json:"team,omitempty"`
	Environment        string    `json:"environment,omitempty"`
	Service            string    `json:"service,omitempty"`
	Reason             string    `json:"reason"`
	Notes              string    `json:"notes"`
	ApprovedBy         int       `json:"approved_by"`
	ApprovedByUsername string    `json:"approved_by_username"`
	CreatedAt          time.Time `json:"created_at"`
}

type rollbackConsoleSummary struct {
	CandidateCount       int `json:"candidate_count"`
	ReadyCount           int `json:"ready_count"`
	OperationCount       int `json:"operation_count"`
	ProductionCandidates int `json:"production_candidates"`
	IncidentLinkedCount  int `json:"incident_linked_count"`
}

type rollbackConsolePayload struct {
	Projects         []ProjectSummary          `json:"projects"`
	Summary          rollbackConsoleSummary    `json:"summary"`
	Items            []rollbackCandidate       `json:"items"`
	FocusRequestID   int                       `json:"focus_request_id,omitempty"`
	FocusCandidate   *rollbackCandidate        `json:"focus_candidate,omitempty"`
	RecentOperations []rollbackOperationRecord `json:"recent_operations"`
}

func clampChangeRiskScore(score int) int {
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func classifyChangeRiskScore(score int) string {
	switch {
	case score >= 65:
		return "high"
	case score >= 35:
		return "medium"
	default:
		return "low"
	}
}

func isRollbackEligibleStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "in_progress":
		return true
	default:
		return false
	}
}

func summarizeTextPreview(value string) string {
	trimmed := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(trimmed) > 140 {
		return trimmed[:140] + "..."
	}
	return trimmed
}

func deriveChangeRiskRecommendedAction(item changeRiskProjectItem) string {
	switch {
	case item.BlockedPromotionCount > 0:
		return "Resolve deployment gate blockers before approving the next release."
	case item.OpenIncidentCount > 0:
		return "Review the linked incident workspace before moving any production changes."
	case item.DriftState == "drifted":
		return "Investigate environment drift and reconcile configuration differences."
	case item.ActionableExpiryCount > 0:
		return "Acknowledge or rotate expiring secrets and certificates before the next release."
	case item.NamespaceAlertCount > 0:
		return "Check Kubernetes workload health and clear namespace alerts before promotion."
	default:
		return "Risk is acceptable. Continue with normal change review and promotion checks."
	}
}

func summarizeChangeRiskProject(project ProjectCatalog, riskLevel string, score int, factors []changeRiskFactor) string {
	if len(factors) == 0 {
		return fmt.Sprintf("%s is low risk right now. No significant change blockers were detected.", project.Name)
	}
	primary := factors[0]
	return fmt.Sprintf("%s is %s risk (%d/100). Primary concern: %s.", project.Name, riskLevel, score, primary.Label)
}

func buildChangeRiskEnvironmentScores(project ProjectCatalog, dashboard *projectReleaseDashboard, driftItem *environmentDriftProjectItem) []changeRiskEnvironmentScore {
	driftByEnv := make(map[string]environmentDriftSnapshot)
	if driftItem != nil {
		for _, item := range driftItem.Environments {
			driftByEnv[strings.ToLower(strings.TrimSpace(item.Environment))] = item
		}
	}
	statusByEnv := make(map[string]projectReleaseEnvironmentStatus)
	gateByEnv := make(map[string]deploymentGateEnvironment)
	namespaceAlertsByEnv := make(map[string]int)

	if dashboard != nil {
		for _, item := range dashboard.EnvironmentStatuses {
			statusByEnv[strings.ToLower(strings.TrimSpace(item.Environment))] = item
		}
		for _, gate := range dashboard.DeploymentGates.Environments {
			gateByEnv[strings.ToLower(strings.TrimSpace(gate.Environment))] = gate
		}
		if dashboard.K8sPreview != nil {
			for _, namespace := range dashboard.K8sPreview.NamespaceWatchlist {
				namespaceAlertsByEnv[strings.ToLower(strings.TrimSpace(namespace.Namespace))] += namespace.IssueCount
			}
		}
	}

	environments := uniqueLowerSorted(project.Environments)
	out := make([]changeRiskEnvironmentScore, 0, len(environments))
	for _, env := range environments {
		score := 0
		driftState := ""
		latestStatus := ""
		gateStatus := ""
		incidentCount := 0
		pendingCount := 0

		if drift, ok := driftByEnv[env]; ok {
			driftState = drift.State
			switch drift.State {
			case "drifted":
				score += 20
			case "attention":
				score += 10
			}
		}
		if status, ok := statusByEnv[env]; ok {
			latestStatus = status.LatestStatus
			incidentCount = status.IncidentCount
			pendingCount = status.PendingCount
			if status.Health == "attention" {
				score += 10
			}
			score += minInt(status.IncidentCount*6, 18)
			score += minInt(status.PendingCount*2, 8)
		}
		if gate, ok := gateByEnv[env]; ok {
			gateStatus = gate.Status
			switch gate.Status {
			case "blocked":
				score += 18
			case "attention":
				score += 9
			}
		}
		score += minInt(namespaceAlertsByEnv[env], 12)
		score = clampChangeRiskScore(score)
		riskLevel := classifyChangeRiskScore(score)
		summary := fmt.Sprintf("%s risk in %s due to release state, drift, and operational signals.", strings.Title(riskLevel), strings.ToUpper(env))
		out = append(out, changeRiskEnvironmentScore{
			Environment:     env,
			Score:           score,
			RiskLevel:       riskLevel,
			Summary:         summary,
			DriftState:      driftState,
			LatestStatus:    latestStatus,
			GateStatus:      gateStatus,
			IncidentCount:   incidentCount,
			PendingCount:    pendingCount,
			NamespaceAlerts: namespaceAlertsByEnv[env],
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].Environment < out[j].Environment
		}
		return out[i].Score > out[j].Score
	})
	return out
}

func buildChangeRiskFactors(project ProjectCatalog, dashboard *projectReleaseDashboard, driftItem *environmentDriftProjectItem) []changeRiskFactor {
	factors := make([]changeRiskFactor, 0, 8)
	appendFactor := func(key, label, severity string, weight int, detail string) {
		factors = append(factors, changeRiskFactor{
			Key:      key,
			Label:    label,
			Severity: severity,
			Weight:   weight,
			Detail:   detail,
		})
	}

	if project.CostRiskSummary != nil {
		switch strings.ToLower(strings.TrimSpace(project.CostRiskSummary.OverallRisk)) {
		case "high":
			appendFactor("cost-risk", "High service cost/risk profile", "high", 12, project.CostRiskSummary.Summary)
		case "medium":
			appendFactor("cost-risk", "Elevated service cost/risk profile", "medium", 7, project.CostRiskSummary.Summary)
		}
	}

	if driftItem != nil {
		switch driftItem.State {
		case "drifted":
			appendFactor("environment-drift", "Environment drift detected", "high", 18, driftItem.Summary)
		case "attention":
			appendFactor("environment-drift", "Environment alignment needs review", "medium", 10, driftItem.Summary)
		}
	}

	if dashboard != nil {
		if dashboard.DeploymentGates.Summary.BlockedEnvironments > 0 {
			appendFactor(
				"blocked-gates",
				"Blocked deployment gates",
				"high",
				minInt(20, dashboard.DeploymentGates.Summary.BlockedEnvironments*10),
				fmt.Sprintf("%d environment(s) are blocked by deployment policy.", dashboard.DeploymentGates.Summary.BlockedEnvironments),
			)
		}
		if dashboard.DeploymentGates.Summary.AttentionEnvironments > 0 {
			appendFactor(
				"attention-gates",
				"Manual release review required",
				"medium",
				minInt(12, dashboard.DeploymentGates.Summary.AttentionEnvironments*6),
				fmt.Sprintf("%d environment(s) require manager acknowledgement before promotion.", dashboard.DeploymentGates.Summary.AttentionEnvironments),
			)
		}
		if dashboard.Summary.OpenIncidentCount > 0 {
			appendFactor(
				"active-incidents",
				"Active incidents linked to project",
				"high",
				minInt(18, dashboard.Summary.OpenIncidentCount*9),
				fmt.Sprintf("%d active incident(s) are still open against this project.", dashboard.Summary.OpenIncidentCount),
			)
		}
		if dashboard.K8sPreview != nil && dashboard.K8sPreview.HealthSummary.UnhealthyNamespaces > 0 {
			appendFactor(
				"k8s-health",
				"Unhealthy Kubernetes namespaces",
				"medium",
				minInt(12, dashboard.K8sPreview.HealthSummary.UnhealthyNamespaces*6),
				fmt.Sprintf("%d namespace(s) are degraded or blocked in the workload view.", dashboard.K8sPreview.HealthSummary.UnhealthyNamespaces),
			)
		}
		if dashboard.ExpiryPreview != nil && dashboard.ExpiryPreview.Summary.ActionableCount > 0 {
			appendFactor(
				"expiry",
				"Secrets or certificates need action",
				"medium",
				minInt(10, dashboard.ExpiryPreview.Summary.ActionableCount*3),
				fmt.Sprintf("%d tracked secret/certificate item(s) need acknowledgement or rotation.", dashboard.ExpiryPreview.Summary.ActionableCount),
			)
		}
		if dashboard.Summary.ActiveOverrideCount > 0 {
			appendFactor(
				"overrides",
				"Temporary access overrides are active",
				"medium",
				minInt(8, dashboard.Summary.ActiveOverrideCount*2),
				fmt.Sprintf("%d active access override(s) may expand change scope during rollout.", dashboard.Summary.ActiveOverrideCount),
			)
		}
		if dashboard.Summary.PendingRequests > 0 {
			appendFactor(
				"queue-pressure",
				"Pending delivery pressure",
				"low",
				minInt(6, dashboard.Summary.PendingRequests*2),
				fmt.Sprintf("%d request(s) are still pending in this project queue.", dashboard.Summary.PendingRequests),
			)
		}
	}

	sort.Slice(factors, func(i, j int) bool {
		if factors[i].Weight == factors[j].Weight {
			return factors[i].Label < factors[j].Label
		}
		return factors[i].Weight > factors[j].Weight
	})
	return factors
}

func buildChangeRiskPayload(projectID int) (*changeRiskPayload, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	if projectID > 0 {
		filtered := make([]ProjectCatalog, 0, 1)
		for _, project := range projects {
			if project.ID == projectID {
				filtered = append(filtered, project)
				break
			}
		}
		projects = filtered
	}

	driftPayload, err := buildEnvironmentDriftPayload(projectID)
	if err != nil {
		return nil, err
	}
	driftByProject := make(map[int]*environmentDriftProjectItem, len(driftPayload.Items))
	for index := range driftPayload.Items {
		item := driftPayload.Items[index]
		driftByProject[item.ProjectID] = &item
	}

	payload := &changeRiskPayload{
		Projects: buildProjectSummaries(projects),
		Items:    make([]changeRiskProjectItem, 0, len(projects)),
	}
	for _, project := range projects {
		dashboard, err := buildProjectReleaseDashboard(project)
		if err != nil {
			return nil, err
		}
		driftItem := driftByProject[project.ID]
		factors := buildChangeRiskFactors(project, dashboard, driftItem)
		score := 8
		for _, factor := range factors {
			score += factor.Weight
		}
		score = clampChangeRiskScore(score)
		riskLevel := classifyChangeRiskScore(score)
		environments := buildChangeRiskEnvironmentScores(project, dashboard, driftItem)
		driftState := ""
		if driftItem != nil {
			driftState = driftItem.State
		}
		costRiskLevel := ""
		if project.CostRiskSummary != nil {
			costRiskLevel = project.CostRiskSummary.OverallRisk
		}
		item := changeRiskProjectItem{
			ProjectID:               project.ID,
			ProjectName:             project.Name,
			ProjectCode:             project.Code,
			OwnerTeam:               project.OwnerTeam,
			Score:                   score,
			RiskLevel:               riskLevel,
			Summary:                 summarizeChangeRiskProject(project, riskLevel, score, factors),
			BlockedPromotionCount:   dashboard.DeploymentGates.Summary.BlockedEnvironments,
			AttentionPromotionCount: dashboard.DeploymentGates.Summary.AttentionEnvironments,
			OpenIncidentCount:       dashboard.Summary.OpenIncidentCount,
			ActionableExpiryCount: func() int {
				if dashboard.ExpiryPreview != nil {
					return dashboard.ExpiryPreview.Summary.ActionableCount
				}
				return 0
			}(),
			NamespaceAlertCount: func() int {
				if dashboard.K8sPreview != nil {
					return dashboard.K8sPreview.HealthSummary.UnhealthyNamespaces
				}
				return 0
			}(),
			DriftState:    driftState,
			CostRiskLevel: costRiskLevel,
			Factors:       factors,
			Environments:  environments,
		}
		item.RecommendedAction = deriveChangeRiskRecommendedAction(item)
		payload.Items = append(payload.Items, item)
		payload.Summary.ProjectCount++
		switch item.RiskLevel {
		case "high":
			payload.Summary.HighRiskCount++
		case "medium":
			payload.Summary.MediumRiskCount++
		default:
			payload.Summary.LowRiskCount++
		}
		if item.BlockedPromotionCount > 0 {
			payload.Summary.BlockedProjects++
		}
		if item.OpenIncidentCount > 0 {
			payload.Summary.IncidentLinkedProjects++
		}
		if item.DriftState == "drifted" {
			payload.Summary.DriftedProjects++
		}
	}

	sort.Slice(payload.Items, func(i, j int) bool {
		if payload.Items[i].Score == payload.Items[j].Score {
			return payload.Items[i].ProjectName < payload.Items[j].ProjectName
		}
		return payload.Items[i].Score > payload.Items[j].Score
	})
	return payload, nil
}

func listDeploymentGateApprovalsForRequest(requestID int) ([]deploymentGateApprovalRecord, error) {
	if requestID <= 0 {
		return []deploymentGateApprovalRecord{}, nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT a.id,
		       a.request_id,
		       a.project_id,
		       COALESCE(a.source_environment, ''),
		       COALESCE(a.target_environment, ''),
		       COALESCE(a.gate_status, ''),
		       COALESCE(a.summary, ''),
		       COALESCE(a.note, ''),
		       a.approved_by,
		       COALESCE(u.username, ''),
		       a.source_request_updated_at,
		       a.approved_at,
		       a.expires_at,
		       a.revoked_at,
		       a.revoked_by,
		       COALESCE(revoker.username, ''),
		       COALESCE(a.revoke_note, '')
		FROM deployment_gate_approvals a
		LEFT JOIN users u ON u.id = a.approved_by
		LEFT JOIN users revoker ON revoker.id = a.revoked_by
		WHERE a.request_id = $1
		ORDER BY a.approved_at DESC, a.id DESC
	`, requestID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return []deploymentGateApprovalRecord{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	now := time.Now()
	out := make([]deploymentGateApprovalRecord, 0)
	for rows.Next() {
		var record deploymentGateApprovalRecord
		var projectIDValue sql.NullInt64
		var expiresAt sql.NullTime
		var revokedAt sql.NullTime
		var revokedBy sql.NullInt64
		if err := rows.Scan(
			&record.ID,
			&record.RequestID,
			&projectIDValue,
			&record.SourceEnvironment,
			&record.TargetEnvironment,
			&record.GateStatus,
			&record.Summary,
			&record.Note,
			&record.ApprovedBy,
			&record.ApprovedByUsername,
			&record.SourceRequestUpdatedAt,
			&record.ApprovedAt,
			&expiresAt,
			&revokedAt,
			&revokedBy,
			&record.RevokedByUsername,
			&record.RevokeNote,
		); err != nil {
			return nil, err
		}
		if projectIDValue.Valid {
			value := int(projectIDValue.Int64)
			record.ProjectID = &value
		}
		if expiresAt.Valid {
			record.ExpiresAt = &expiresAt.Time
		}
		if revokedAt.Valid {
			record.RevokedAt = &revokedAt.Time
		}
		if revokedBy.Valid {
			value := int(revokedBy.Int64)
			record.RevokedBy = &value
		}
		record.State = deriveDeploymentGateApprovalState(record.ExpiresAt, record.RevokedAt, now)
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func getIncidentPostmortem(incidentID int) (*incidentPostmortemRecord, error) {
	if incidentID <= 0 {
		return nil, nil
	}
	var record incidentPostmortemRecord
	var projectID sql.NullInt64
	var followUpOwner sql.NullInt64
	var updatedBy sql.NullInt64
	err := queryRowContext(`
		SELECT p.id,
		       p.incident_id,
		       p.request_id,
		       p.project_id,
		       COALESCE(p.status, 'draft'),
		       COALESCE(p.impact_summary, ''),
		       COALESCE(p.root_cause, ''),
		       COALESCE(p.detection_summary, ''),
		       COALESCE(p.mitigation_summary, ''),
		       COALESCE(p.corrective_actions, ''),
		       p.follow_up_owner_user_id,
		       COALESCE(owner.username, ''),
		       COALESCE(p.review_notes, ''),
		       p.updated_by,
		       COALESCE(editor.username, ''),
		       p.created_at,
		       p.updated_at
		FROM incident_postmortems p
		LEFT JOIN users owner ON owner.id = p.follow_up_owner_user_id
		LEFT JOIN users editor ON editor.id = p.updated_by
		WHERE p.incident_id = $1
	`, incidentID).Scan(
		&record.ID,
		&record.IncidentID,
		&record.RequestID,
		&projectID,
		&record.Status,
		&record.ImpactSummary,
		&record.RootCause,
		&record.DetectionSummary,
		&record.MitigationSummary,
		&record.CorrectiveActions,
		&followUpOwner,
		&record.FollowUpOwnerUsername,
		&record.ReviewNotes,
		&updatedBy,
		&record.UpdatedByUsername,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return nil, nil
		}
		return nil, err
	}
	if projectID.Valid {
		value := int(projectID.Int64)
		record.ProjectID = &value
	}
	if followUpOwner.Valid {
		value := int(followUpOwner.Int64)
		record.FollowUpOwnerUserID = &value
	}
	if updatedBy.Valid {
		value := int(updatedBy.Int64)
		record.UpdatedBy = &value
	}
	return &record, nil
}

func upsertIncidentPostmortem(incident requestIncident, status, impactSummary, rootCause, detectionSummary, mitigationSummary, correctiveActions string, followUpOwnerUserID *int, reviewNotes string, updatedBy int) (*incidentPostmortemRecord, error) {
	if incident.ID <= 0 {
		return nil, fmt.Errorf("incident is required")
	}
	if updatedBy <= 0 {
		return nil, fmt.Errorf("editor is required")
	}
	normalizedStatus := strings.ToLower(strings.TrimSpace(status))
	switch normalizedStatus {
	case "", "draft":
		normalizedStatus = "draft"
	case "review", "completed":
	default:
		return nil, fmt.Errorf("invalid postmortem status")
	}

	var projectID any
	if incident.ProjectID != nil && *incident.ProjectID > 0 {
		projectID = *incident.ProjectID
	}
	var followUpOwner any
	if followUpOwnerUserID != nil && *followUpOwnerUserID > 0 {
		followUpOwner = *followUpOwnerUserID
	}

	_, err := execContext(`
		INSERT INTO incident_postmortems (
			incident_id,
			request_id,
			project_id,
			status,
			impact_summary,
			root_cause,
			detection_summary,
			mitigation_summary,
			corrective_actions,
			follow_up_owner_user_id,
			review_notes,
			updated_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (incident_id)
		DO UPDATE SET
			status = EXCLUDED.status,
			impact_summary = EXCLUDED.impact_summary,
			root_cause = EXCLUDED.root_cause,
			detection_summary = EXCLUDED.detection_summary,
			mitigation_summary = EXCLUDED.mitigation_summary,
			corrective_actions = EXCLUDED.corrective_actions,
			follow_up_owner_user_id = EXCLUDED.follow_up_owner_user_id,
			review_notes = EXCLUDED.review_notes,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`, incident.ID, incident.RequestID, projectID, normalizedStatus, strings.TrimSpace(impactSummary), strings.TrimSpace(rootCause), strings.TrimSpace(detectionSummary), strings.TrimSpace(mitigationSummary), strings.TrimSpace(correctiveActions), followUpOwner, strings.TrimSpace(reviewNotes), updatedBy)
	if err != nil {
		return nil, err
	}
	return getIncidentPostmortem(incident.ID)
}

func sortIncidentWorkspaceTimeline(events []incidentWorkspaceTimelineEvent) {
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].Timestamp.Equal(events[j].Timestamp) {
			return events[i].Key < events[j].Key
		}
		return events[i].Timestamp.Before(events[j].Timestamp)
	})
}

func buildIncidentWorkspaceTimeline(incident requestIncident, request *PRRequest, approvals []deploymentGateApprovalRecord, rollbacks []rollbackOperationRecord) []incidentWorkspaceTimelineEvent {
	events := make([]incidentWorkspaceTimelineEvent, 0, 12)
	events = append(events, incidentWorkspaceTimelineEvent{
		Key:       fmt.Sprintf("incident-created-%d", incident.ID),
		Timestamp: incident.CreatedAt,
		Kind:      "incident",
		Title:     "Incident opened",
		Detail:    incident.Summary,
		Actor:     incident.OwnerUsername,
	})
	if !incident.UpdatedAt.Equal(incident.CreatedAt) {
		events = append(events, incidentWorkspaceTimelineEvent{
			Key:       fmt.Sprintf("incident-updated-%d", incident.ID),
			Timestamp: incident.UpdatedAt,
			Kind:      "incident",
			Title:     "Incident updated",
			Detail:    fmt.Sprintf("Severity %s, status %s.", incident.Severity, incident.Status),
			Actor:     incident.OwnerUsername,
		})
	}
	if request != nil {
		timeline, _ := GetRequestTimeline(request.ID)
		for _, item := range timeline {
			detail := item.Details
			if item.Body != "" {
				detail = item.Body
			}
			events = append(events, incidentWorkspaceTimelineEvent{
				Key:       fmt.Sprintf("request-%s-%d", item.Kind, item.ID),
				Timestamp: item.CreatedAt,
				Kind:      item.Kind,
				Title:     strings.ReplaceAll(item.Action, "_", " "),
				Detail:    detail,
				Actor:     item.Username,
			})
		}
	}
	for _, approval := range approvals {
		title := "Deployment gate approved"
		detail := approval.Summary
		if approval.State == "revoked" {
			title = "Deployment gate revoked"
			detail = approval.RevokeNote
		}
		if detail == "" {
			detail = fmt.Sprintf("%s → %s", approval.SourceEnvironment, approval.TargetEnvironment)
		}
		timestamp := approval.ApprovedAt
		actor := approval.ApprovedByUsername
		if approval.State == "revoked" && approval.RevokedAt != nil {
			timestamp = *approval.RevokedAt
			actor = approval.RevokedByUsername
		}
		events = append(events, incidentWorkspaceTimelineEvent{
			Key:       fmt.Sprintf("gate-%d-%s", approval.ID, approval.State),
			Timestamp: timestamp,
			Kind:      "gate",
			Title:     title,
			Detail:    detail,
			Actor:     actor,
		})
	}
	for _, operation := range rollbacks {
		events = append(events, incidentWorkspaceTimelineEvent{
			Key:       fmt.Sprintf("rollback-%d", operation.ID),
			Timestamp: operation.CreatedAt,
			Kind:      "rollback",
			Title:     "Rollback request prepared",
			Detail:    operation.Reason,
			Actor:     operation.ApprovedByUsername,
		})
	}
	sortIncidentWorkspaceTimeline(events)
	return events
}

func buildIncidentWorkspacePayload(projectID, incidentID int, statusFilter string) (*incidentWorkspacePayload, error) {
	incidents, err := listRequestIncidents(statusFilter)
	if err != nil {
		return nil, err
	}
	if projectID > 0 {
		filtered := make([]requestIncident, 0)
		for _, incident := range incidents {
			if incident.ProjectID != nil && *incident.ProjectID == projectID {
				filtered = append(filtered, incident)
			}
		}
		incidents = filtered
	}
	owners, _ := GetDevopsUsers()
	projects, _ := listProjectCatalogs()
	payload := &incidentWorkspacePayload{
		Projects:  buildProjectSummaries(projects),
		Owners:    owners,
		Incidents: incidents,
	}
	postmortemByIncident := make(map[int]*incidentPostmortemRecord)
	for _, incident := range incidents {
		if incident.Status != "resolved" && incident.Status != "closed" {
			payload.Summary.OpenIncidents++
		}
		if strings.EqualFold(incident.Severity, "critical") {
			payload.Summary.CriticalIncidents++
		}
		if postmortem, err := getIncidentPostmortem(incident.ID); err == nil && postmortem != nil {
			postmortemByIncident[incident.ID] = postmortem
			switch postmortem.Status {
			case "completed":
				payload.Summary.CompletedPostmortems++
			default:
				payload.Summary.PostmortemDrafts++
			}
		}
	}
	payload.Summary.TotalIncidents = len(incidents)

	var selected *requestIncident
	if incidentID > 0 {
		for index := range incidents {
			if incidents[index].ID == incidentID {
				selected = &incidents[index]
				break
			}
		}
	}
	if selected == nil && len(incidents) > 0 {
		selected = &incidents[0]
	}
	if selected == nil {
		return payload, nil
	}

	payload.FocusIncidentID = selected.ID
	request, _ := GetPRRequestByID(selected.RequestID)
	runbooks := []projectRunbook{}
	if selected.ProjectID != nil && *selected.ProjectID > 0 {
		runbooks, _ = listProjectRunbooks(*selected.ProjectID)
	}
	approvals, _ := listDeploymentGateApprovalsForRequest(selected.RequestID)
	rollbacks, _ := listRollbackOperationRecords(0, selected.RequestID, 25)
	review := buildIncidentReview(*selected)
	payload.Detail = &incidentWorkspaceDetail{
		Incident:           *selected,
		Request:            request,
		Timeline:           buildIncidentWorkspaceTimeline(*selected, request, approvals, rollbacks),
		Review:             &review,
		Postmortem:         postmortemByIncident[selected.ID],
		Runbooks:           runbooks,
		GateApprovals:      approvals,
		RollbackOperations: rollbacks,
	}
	return payload, nil
}

func listRollbackOperationRecords(projectID, requestID, limit int) ([]rollbackOperationRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 250 {
		limit = 250
	}
	whereParts := []string{"1=1"}
	args := make([]interface{}, 0, 4)
	addArg := func(value interface{}) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}
	if projectID > 0 {
		whereParts = append(whereParts, fmt.Sprintf("ro.project_id = %s", addArg(projectID)))
	}
	if requestID > 0 {
		arg := addArg(requestID)
		whereParts = append(whereParts, fmt.Sprintf("(ro.source_request_id = %s OR ro.rollback_request_id = %s)", arg, arg))
	}
	rows, cancel, err := queryRowsWithTimeout(fmt.Sprintf(`
		SELECT ro.id,
		       ro.source_request_id,
		       ro.rollback_request_id,
		       ro.history_id,
		       ro.project_id,
		       COALESCE(p.name, ''),
		       COALESCE(p.code, ''),
		       COALESCE(r.team, ''),
		       COALESCE(r.env, ''),
		       COALESCE(r.service, ''),
		       COALESCE(ro.reason, ''),
		       COALESCE(ro.notes, ''),
		       ro.approved_by,
		       COALESCE(u.username, ''),
		       ro.created_at
		FROM rollback_operations ro
		LEFT JOIN projects p ON p.id = ro.project_id
		LEFT JOIN pr_requests r ON r.id = ro.source_request_id
		LEFT JOIN users u ON u.id = ro.approved_by
		WHERE %s
		ORDER BY ro.created_at DESC, ro.id DESC
		LIMIT %s
	`, strings.Join(whereParts, " AND "), addArg(limit)), args...)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return []rollbackOperationRecord{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	out := make([]rollbackOperationRecord, 0)
	for rows.Next() {
		var record rollbackOperationRecord
		var projectIDValue sql.NullInt64
		var historyID sql.NullInt64
		if err := rows.Scan(
			&record.ID,
			&record.SourceRequestID,
			&record.RollbackRequestID,
			&historyID,
			&projectIDValue,
			&record.ProjectName,
			&record.ProjectCode,
			&record.Team,
			&record.Environment,
			&record.Service,
			&record.Reason,
			&record.Notes,
			&record.ApprovedBy,
			&record.ApprovedByUsername,
			&record.CreatedAt,
		); err != nil {
			return nil, err
		}
		if projectIDValue.Valid {
			value := int(projectIDValue.Int64)
			record.ProjectID = &value
		}
		if historyID.Valid {
			value := int(historyID.Int64)
			record.HistoryID = &value
		}
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func buildRollbackCandidate(req PRRequest, incidentCount, runbookCount, rollbackCount int) rollbackCandidate {
	history, _ := GetRequestConfigHistory(req.ID, 8)
	snapshots := make([]rollbackSnapshot, 0, len(history))
	for _, item := range history {
		snapshots = append(snapshots, rollbackSnapshot{
			ID:        item.ID,
			CreatedAt: item.CreatedAt,
			Note:      item.Note,
			Preview:   summarizeTextPreview(item.Config),
		})
	}
	eligible := isRollbackEligibleStatus(req.Status) && len(snapshots) > 0
	reason := "Rollback can be prepared from a saved configuration snapshot."
	if !eligible {
		if len(snapshots) == 0 {
			reason = "No saved configuration snapshots are available for this request."
		} else {
			reason = "Only completed or in-progress requests can be prepared for rollback."
		}
	}
	return rollbackCandidate{
		RequestID:         req.ID,
		ProjectID:         req.ProjectID,
		ProjectName:       req.ProjectName,
		ProjectCode:       req.ProjectCode,
		Team:              req.Team,
		Environment:       req.Env,
		Cloud:             req.Cloud,
		Service:           req.Service,
		Status:            req.Status,
		Priority:          req.Priority,
		ClientName:        req.ClientName,
		UpdatedAt:         req.UpdatedAt,
		PRURL:             req.PRURL,
		SnapshotCount:     len(snapshots),
		IncidentCount:     incidentCount,
		RunbookCount:      runbookCount,
		RollbackCount:     rollbackCount,
		Eligible:          eligible,
		EligibilityReason: reason,
		Snapshots:         snapshots,
	}
}

func buildRollbackConsolePayload(projectID, requestID int) (*rollbackConsolePayload, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	requests, err := GetPRRequests("", "", "", projectID, "", "", "", 0, 0, nil, 250, 0, "updated_at", "desc", false, "", "")
	if err != nil {
		return nil, err
	}
	incidents, _ := listRequestIncidents("")
	incidentCountByRequest := make(map[int]int)
	for _, incident := range incidents {
		incidentCountByRequest[incident.RequestID]++
	}
	runbookCountByProject := make(map[int]int)
	for _, project := range projects {
		runbooks, err := listProjectRunbooks(project.ID)
		if err == nil {
			runbookCountByProject[project.ID] = len(runbooks)
		}
	}
	operations, _ := listRollbackOperationRecords(projectID, 0, 30)
	rollbackCountByRequest := make(map[int]int)
	for _, operation := range operations {
		rollbackCountByRequest[operation.SourceRequestID]++
	}

	payload := &rollbackConsolePayload{
		Projects:         buildProjectSummaries(projects),
		RecentOperations: operations,
		Items:            make([]rollbackCandidate, 0),
	}
	for _, req := range requests {
		if requestID > 0 && req.ID != requestID {
			continue
		}
		candidate := buildRollbackCandidate(req, incidentCountByRequest[req.ID], runbookCountByProject[valueOrZero(req.ProjectID)], rollbackCountByRequest[req.ID])
		if !candidate.Eligible && requestID == 0 {
			continue
		}
		payload.Items = append(payload.Items, candidate)
		payload.Summary.CandidateCount++
		if candidate.Eligible {
			payload.Summary.ReadyCount++
		}
		if strings.EqualFold(candidate.Environment, "prod") {
			payload.Summary.ProductionCandidates++
		}
		if candidate.IncidentCount > 0 {
			payload.Summary.IncidentLinkedCount++
		}
	}
	payload.Summary.OperationCount = len(payload.RecentOperations)
	sort.Slice(payload.Items, func(i, j int) bool {
		if payload.Items[i].UpdatedAt.Equal(payload.Items[j].UpdatedAt) {
			return payload.Items[i].RequestID > payload.Items[j].RequestID
		}
		return payload.Items[i].UpdatedAt.After(payload.Items[j].UpdatedAt)
	})
	if requestID > 0 {
		payload.FocusRequestID = requestID
		for index := range payload.Items {
			if payload.Items[index].RequestID == requestID {
				payload.FocusCandidate = &payload.Items[index]
				break
			}
		}
	} else if len(payload.Items) > 0 {
		payload.FocusRequestID = payload.Items[0].RequestID
		payload.FocusCandidate = &payload.Items[0]
	}
	return payload, nil
}

func createRollbackConsoleRequest(managerID, sourceRequestID, historyID int, reason, notes string) (*rollbackOperationRecord, *PRRequest, error) {
	if managerID <= 0 {
		return nil, nil, fmt.Errorf("approver is required")
	}
	sourceRequest, err := GetPRRequestByID(sourceRequestID)
	if err != nil || sourceRequest == nil {
		return nil, nil, fmt.Errorf("source request not found")
	}
	if !isRollbackEligibleStatus(sourceRequest.Status) {
		return nil, nil, fmt.Errorf("only completed or in-progress requests can be used for rollback")
	}

	configToRestore := sourceRequest.Config
	if historyID > 0 {
		history, err := GetRequestConfigHistory(sourceRequestID, 50)
		if err != nil {
			return nil, nil, err
		}
		found := false
		for _, item := range history {
			if item.ID == historyID {
				configToRestore = item.Config
				found = true
				break
			}
		}
		if !found {
			return nil, nil, fmt.Errorf("snapshot not found")
		}
	}
	if strings.TrimSpace(reason) == "" {
		return nil, nil, fmt.Errorf("rollback reason is required")
	}

	appID, err := GenerateApplicationID()
	if err != nil {
		return nil, nil, err
	}
	filePath, branchName := BuildRequestGitArtifacts(sourceRequest.ProjectID, sourceRequest.Team, sourceRequest.Cloud, sourceRequest.Env, sourceRequest.Service, appID)
	newRequest := &PRRequest{
		ProjectID:     sourceRequest.ProjectID,
		Team:          sourceRequest.Team,
		Env:           sourceRequest.Env,
		Cloud:         sourceRequest.Cloud,
		Service:       sourceRequest.Service,
		ClientName:    strings.TrimSpace(sourceRequest.ClientName + " (rollback of #" + strconv.Itoa(sourceRequestID) + ")"),
		ApplicationID: appID,
		Priority:      sourceRequest.Priority,
		DueDate:       sourceRequest.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(configToRestore, appID),
		CreatedBy:     &managerID,
	}
	if err := SavePRRequest(newRequest); err != nil {
		return nil, nil, err
	}
	_, _ = execContext(`UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2`, sourceRequestID, newRequest.ID)

	var historyIDValue any
	if historyID > 0 {
		historyIDValue = historyID
	}
	var projectIDValue any
	if sourceRequest.ProjectID != nil && *sourceRequest.ProjectID > 0 {
		projectIDValue = *sourceRequest.ProjectID
	}

	var operation rollbackOperationRecord
	var insertedHistoryID sql.NullInt64
	var insertedProjectID sql.NullInt64
	err = queryRowContext(`
		INSERT INTO rollback_operations (
			source_request_id,
			rollback_request_id,
			history_id,
			project_id,
			reason,
			notes,
			approved_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, source_request_id, rollback_request_id, history_id, project_id, reason, notes, approved_by, created_at
	`, sourceRequestID, newRequest.ID, historyIDValue, projectIDValue, strings.TrimSpace(reason), strings.TrimSpace(notes), managerID).Scan(
		&operation.ID,
		&operation.SourceRequestID,
		&operation.RollbackRequestID,
		&insertedHistoryID,
		&insertedProjectID,
		&operation.Reason,
		&operation.Notes,
		&operation.ApprovedBy,
		&operation.CreatedAt,
	)
	if err != nil {
		return nil, nil, err
	}
	if insertedHistoryID.Valid {
		value := int(insertedHistoryID.Int64)
		operation.HistoryID = &value
	}
	if insertedProjectID.Valid {
		value := int(insertedProjectID.Int64)
		operation.ProjectID = &value
	}
	if sourceRequest.ProjectID != nil {
		project, _ := getProjectCatalogByID(*sourceRequest.ProjectID)
		if project != nil {
			operation.ProjectName = project.Name
			operation.ProjectCode = project.Code
		}
	}
	operation.Team = sourceRequest.Team
	operation.Environment = sourceRequest.Env
	operation.Service = sourceRequest.Service
	if manager, err := GetUserByID(managerID); err == nil && manager != nil {
		operation.ApprovedByUsername = manager.Username
	}

	AppendAuditLog(&managerID, "request_rollback_prepare", "pr_request", strconv.Itoa(newRequest.ID), fmt.Sprintf("source=%d reason=%s", sourceRequestID, strings.TrimSpace(reason)))
	AppendUserActivity(&managerID, "request_rollback_prepare", "pr_request", strconv.Itoa(newRequest.ID), "rollback of #"+strconv.Itoa(sourceRequestID))
	return &operation, newRequest, nil
}

func devopsChangeRiskHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodOptions)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	payload, err := buildChangeRiskPayload(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build change risk view", err)
		return
	}
	if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"risk":   sanitizeJSONValue(payload),
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write change risk response", err)
	}
}

func devopsIncidentWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
		incidentID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("incident_id")))
		payload, err := buildIncidentWorkspacePayload(projectID, incidentID, strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to build incident workspace", err)
			return
		}
		if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
			"status":    "ok",
			"workspace": sanitizeJSONValue(payload),
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write incident workspace response", err)
		}
	case http.MethodPost:
		var body struct {
			IncidentID          int    `json:"incident_id"`
			Generate            bool   `json:"generate"`
			Status              string `json:"status"`
			ImpactSummary       string `json:"impact_summary"`
			RootCause           string `json:"root_cause"`
			DetectionSummary    string `json:"detection_summary"`
			MitigationSummary   string `json:"mitigation_summary"`
			CorrectiveActions   string `json:"corrective_actions"`
			FollowUpOwnerUserID *int   `json:"follow_up_owner_user_id"`
			ReviewNotes         string `json:"review_notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		payload, err := buildIncidentWorkspacePayload(0, body.IncidentID, "")
		if err != nil || payload.Detail == nil {
			writeAPIError(w, r, http.StatusNotFound, "incident workspace item not found", err)
			return
		}
		if body.Generate {
			postmortem, review, err := generateIncidentReview(payload.Detail.Incident, managerID)
			if err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
				return
			}
			AppendAuditLog(&managerID, "incident_review_generate", "request_incident", strconv.Itoa(payload.Detail.Incident.ID), payload.Detail.Incident.IncidentNumber)
			if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
				"status":     "ok",
				"generated":  true,
				"review":     sanitizeJSONValue(review),
				"postmortem": sanitizeJSONValue(postmortem),
			}); err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to write generated review", err)
			}
			return
		}
		postmortem, err := upsertIncidentPostmortem(payload.Detail.Incident, body.Status, body.ImpactSummary, body.RootCause, body.DetectionSummary, body.MitigationSummary, body.CorrectiveActions, body.FollowUpOwnerUserID, body.ReviewNotes, managerID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		AppendAuditLog(&managerID, "incident_postmortem_update", "pr_request", strconv.Itoa(payload.Detail.Incident.RequestID), payload.Detail.Incident.Status+":"+postmortem.Status)
		if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
			"status":     "ok",
			"postmortem": sanitizeJSONValue(postmortem),
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write postmortem response", err)
		}
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost, http.MethodOptions)
	}
}

func devopsRollbackConsoleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
		requestID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("request_id")))
		payload, err := buildRollbackConsolePayload(projectID, requestID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to build rollback console", err)
			return
		}
		if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"console": sanitizeJSONValue(payload),
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write rollback console response", err)
		}
	case http.MethodPost:
		var body struct {
			SourceRequestID int    `json:"source_request_id"`
			HistoryID       int    `json:"history_id"`
			Reason          string `json:"reason"`
			Notes           string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
			return
		}
		operation, rollbackRequest, err := createRollbackConsoleRequest(managerID, body.SourceRequestID, body.HistoryID, body.Reason, body.Notes)
		if err != nil {
			if body.SourceRequestID > 0 {
				if req, reqErr := GetPRRequestByID(body.SourceRequestID); reqErr == nil && req != nil {
					RecordOperatorAuditFailure(managerID, "request_rollback_prepare", "pr_request", strconv.Itoa(body.SourceRequestID), "failed", err.Error(), req.ProjectID, req.Env, req.Team)
				}
			}
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		if err := writeJSONResponse(w, http.StatusCreated, map[string]interface{}{
			"status":           "ok",
			"operation":        sanitizeJSONValue(operation),
			"rollback_request": sanitizeJSONValue(rollbackRequest),
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write rollback response", err)
		}
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost, http.MethodOptions)
	}
}
