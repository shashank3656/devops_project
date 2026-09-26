package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

const guardedActionMaxIncidents = 5

type guardedIncidentBrief struct {
	Reference string `json:"reference"`
	Summary   string `json:"summary"`
	Severity  string `json:"severity"`
	Blocks    bool   `json:"blocks_promotion"`
}

type guardedFreezeBrief struct {
	Active bool   `json:"active"`
	Reason string `json:"reason,omitempty"`
	EndsAt string `json:"ends_at,omitempty"`
}

type guardedActionContext struct {
	Action         string                 `json:"action"`
	CanAct         bool                   `json:"can_act"`
	BlockReason    string                 `json:"block_reason,omitempty"`
	ResourceLabel  string                 `json:"resource_label,omitempty"`
	Environment    string                 `json:"environment,omitempty"`
	TargetEnv      string                 `json:"target_environment,omitempty"`
	Image          string                 `json:"image,omitempty"`
	CommitSHA      string                 `json:"commit_sha,omitempty"`
	Freeze         guardedFreezeBrief     `json:"freeze"`
	OpenIncidents  []guardedIncidentBrief `json:"open_incidents"`
	Warnings       []string               `json:"warnings,omitempty"`
}

func devopsUserIsManager(userID int) bool {
	if userID <= 0 {
		return false
	}
	prof, err := GetDevopsProfile(userID)
	return err == nil && prof != nil && prof.IsManager
}

func deploymentFreezeBlocksDay2(projectID int, env string) (bool, string) {
	env = strings.TrimSpace(env)
	if env == "" {
		return false, ""
	}
	var pid *int
	if projectID > 0 {
		pid = &projectID
	}
	if active, reason, _ := activeDeploymentFreeze(pid, env); active {
		return true, reason
	}
	if strings.EqualFold(env, "prod") {
		if reason := activeFreezeReason(); reason != "" {
			return true, reason
		}
	}
	return false, ""
}

func devopsGuardedActionContextHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}

	action := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("action")))
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	requestID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("request_id")))
	cloudAccountID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("cloud_account_id")))
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	workloadName := strings.TrimSpace(r.URL.Query().Get("workload_name"))

	ctx := guardedActionContext{
		Action:        action,
		CanAct:        false,
		OpenIncidents: []guardedIncidentBrief{},
	}

	switch action {
	case "restart", "scale", "resume":
		ctx = buildK8sGuardedContext(userID, action, projectID, environment, workloadName, image)
	case "promote":
		ctx = buildPromoteGuardedContext(userID, requestID)
	case "rollback":
		ctx = buildRollbackGuardedContext(userID, requestID)
	case "disable_cloud_account":
		ctx = buildDisableCloudAccountGuardedContext(userID, cloudAccountID)
	default:
		writeAPIError(w, r, http.StatusBadRequest, "unsupported guarded action", nil)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeDevopsJSON(w, map[string]any{"status": "ok", "context": ctx})
}

func buildK8sGuardedContext(userID int, action string, projectID int, environment, workloadName, image string) guardedActionContext {
	ctx := guardedActionContext{
		Action:        action,
		CanAct:        devopsUserIsManager(userID),
		Environment:   environment,
		Image:         image,
		ResourceLabel: workloadName,
		OpenIncidents: []guardedIncidentBrief{},
	}
	if !ctx.CanAct {
		ctx.BlockReason = "DevOps manager access is required for workload actions."
		return ctx
	}
	if projectID <= 0 || workloadName == "" {
		ctx.CanAct = false
		ctx.BlockReason = "Project and workload are required."
		return ctx
	}
	if project, err := getProjectCatalogByID(projectID); err != nil || project == nil || !devopsUserCanViewProject(userID, *project) {
		ctx.CanAct = false
		ctx.BlockReason = "You do not have access to this project scope."
		return ctx
	}
	envKey := strings.ToLower(strings.TrimSpace(environment))
	if envKey != "" {
		active, reason, ends := activeDeploymentFreeze(&projectID, envKey)
		if !active && strings.EqualFold(envKey, "prod") {
			if globalReason := activeFreezeReason(); globalReason != "" {
				active = true
				reason = globalReason
			}
		}
		ctx.Freeze = guardedFreezeBrief{Active: active, Reason: reason, EndsAt: ends}
		if active {
			ctx.CanAct = false
			ctx.BlockReason = "Deployment freeze is active for " + environment + ": " + reason
		}
		ctx.OpenIncidents = listGuardedOpenIncidents(projectID, envKey, guardedActionMaxIncidents)
	}
	return ctx
}

func buildPromoteGuardedContext(userID, requestID int) guardedActionContext {
	ctx := guardedActionContext{
		Action:        "promote",
		CanAct:        devopsUserIsManager(userID),
		OpenIncidents: []guardedIncidentBrief{},
	}
	if !ctx.CanAct {
		ctx.BlockReason = "DevOps manager access is required to promote requests."
		return ctx
	}
	if requestID <= 0 {
		ctx.CanAct = false
		ctx.BlockReason = "Request id is required."
		return ctx
	}
	req, err := GetPRRequestByID(requestID)
	if err != nil || req == nil {
		ctx.CanAct = false
		ctx.BlockReason = "Request not found."
		return ctx
	}
	if req.ProjectID != nil && *req.ProjectID > 0 {
		if project, err := getProjectCatalogByID(*req.ProjectID); err != nil || project == nil || !devopsUserCanViewProject(userID, *project) {
			ctx.CanAct = false
			ctx.BlockReason = "You do not have access to this request."
			return ctx
		}
	}
	nextEnv := nextEnv(req.Env)
	ctx.Environment = req.Env
	ctx.TargetEnv = nextEnv
	ctx.ResourceLabel = "#" + strconv.Itoa(requestID) + " · " + strings.TrimSpace(req.Service)
	delivery := buildRequestDeliveryVisibility(req)
	ctx.CommitSHA = strings.TrimSpace(delivery.LastSHA)

	if nextEnv == "" {
		ctx.CanAct = false
		ctx.BlockReason = "This request is already at the highest environment."
		return ctx
	}

	var pid *int
	if req.ProjectID != nil && *req.ProjectID > 0 {
		pid = req.ProjectID
	}
	active, reason, ends := activeDeploymentFreeze(pid, nextEnv)
	if !active && strings.EqualFold(nextEnv, "prod") {
		if globalReason := activeFreezeReason(); globalReason != "" && !emergencyBypassesFreeze(req.Service, nextEnv) {
			active = true
			reason = globalReason
		}
	}
	ctx.Freeze = guardedFreezeBrief{Active: active, Reason: reason, EndsAt: ends}
	if active {
		ctx.CanAct = false
		ctx.BlockReason = "Promotion blocked: deployment freeze on " + nextEnv + " — " + reason
	}
	if pid != nil {
		ctx.OpenIncidents = listGuardedOpenIncidents(*pid, nextEnv, guardedActionMaxIncidents)
		for _, inc := range ctx.OpenIncidents {
			if inc.Blocks {
				ctx.Warnings = append(ctx.Warnings, "Open incident "+inc.Reference+" may block promotion.")
			}
		}
	}
	gate, gateErr := evaluatePromotionGateForRequest(req)
	if gateErr == nil && gate != nil {
		if gate.Status == "blocked" {
			ctx.CanAct = false
			ctx.BlockReason = firstNonEmpty(strings.TrimSpace(gate.Summary), "Promotion blocked by deployment gate policy.")
		}
		if gate.RequiresAcknowledgement {
			ctx.CanAct = false
			ctx.BlockReason = firstNonEmpty(strings.TrimSpace(gate.ReviewMessage), "Deployment gate approval is required before promotion.")
		}
	}
	return ctx
}

func buildRollbackGuardedContext(userID, requestID int) guardedActionContext {
	ctx := guardedActionContext{
		Action:        "rollback",
		CanAct:        devopsUserIsManager(userID),
		OpenIncidents: []guardedIncidentBrief{},
	}
	if !ctx.CanAct {
		ctx.BlockReason = "DevOps manager access is required to prepare rollbacks."
		return ctx
	}
	if requestID <= 0 {
		ctx.CanAct = false
		ctx.BlockReason = "Source request id is required."
		return ctx
	}
	req, err := GetPRRequestByID(requestID)
	if err != nil || req == nil {
		ctx.CanAct = false
		ctx.BlockReason = "Source request not found."
		return ctx
	}
	if req.ProjectID != nil && *req.ProjectID > 0 {
		if project, err := getProjectCatalogByID(*req.ProjectID); err != nil || project == nil || !devopsUserCanViewProject(userID, *project) {
			ctx.CanAct = false
			ctx.BlockReason = "You do not have access to this request."
			return ctx
		}
	}
	if !isRollbackEligibleStatus(req.Status) {
		ctx.CanAct = false
		ctx.BlockReason = "Only completed or in-progress requests can be used for rollback."
		return ctx
	}
	ctx.Environment = req.Env
	ctx.ResourceLabel = "#" + strconv.Itoa(requestID) + " · " + strings.TrimSpace(req.Service)
	delivery := buildRequestDeliveryVisibility(req)
	ctx.CommitSHA = strings.TrimSpace(delivery.LastSHA)

	var pid *int
	if req.ProjectID != nil && *req.ProjectID > 0 {
		pid = req.ProjectID
		active, reason, ends := activeDeploymentFreeze(pid, req.Env)
		ctx.Freeze = guardedFreezeBrief{Active: active, Reason: reason, EndsAt: ends}
		if active {
			ctx.Warnings = append(ctx.Warnings, "Deployment freeze is active for "+req.Env+": "+reason)
		}
		ctx.OpenIncidents = listGuardedOpenIncidents(*req.ProjectID, req.Env, guardedActionMaxIncidents)
	}
	return ctx
}

func buildDisableCloudAccountGuardedContext(userID, accountID int) guardedActionContext {
	ctx := guardedActionContext{
		Action:        "disable_cloud_account",
		CanAct:        devopsUserIsManager(userID),
		OpenIncidents: []guardedIncidentBrief{},
	}
	if !ctx.CanAct {
		ctx.BlockReason = "DevOps manager access is required to disable cloud accounts."
		return ctx
	}
	if accountID <= 0 {
		ctx.CanAct = false
		ctx.BlockReason = "Cloud account id is required."
		return ctx
	}
	item, err := getCloudAccountByID(accountID)
	if err != nil || item == nil {
		ctx.CanAct = false
		ctx.BlockReason = "Cloud account not found."
		return ctx
	}
	if !devopsUserCanAccessTeamSlug(userID, item.TeamSlug) {
		ctx.CanAct = false
		ctx.BlockReason = "Cloud account not found."
		return ctx
	}
	if !devopsManagerCanOnboardTeamSlug(userID, item.TeamSlug) {
		ctx.CanAct = false
		ctx.BlockReason = "You cannot modify this account."
		return ctx
	}
	ctx.ResourceLabel = firstNonEmpty(strings.TrimSpace(item.DisplayName), item.AccountID) + " (" + strings.ToUpper(item.Provider) + ")"
	if len(item.Environments) > 0 {
		ctx.Environment = strings.Join(item.Environments, ", ")
	}
	return ctx
}

func listGuardedOpenIncidents(projectID int, env string, limit int) []guardedIncidentBrief {
	out := []guardedIncidentBrief{}
	if DB == nil || projectID <= 0 || limit <= 0 {
		return out
	}
	if limit > guardedActionMaxIncidents {
		limit = guardedActionMaxIncidents
	}
	env = strings.ToLower(strings.TrimSpace(env))
	rows, err := DB.Query(`
		SELECT COALESCE(incident_number, ''), COALESCE(summary, ''), COALESCE(severity, ''), COALESCE(status, 'open'),
		       COALESCE(source, 'ticket'), COALESCE(environment, ''), COALESCE(service, '')
		FROM request_incidents
		WHERE project_id = $1
		ORDER BY updated_at DESC
		LIMIT $2
	`, projectID, limit*3)
	if err != nil {
		return out
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var number, summary, severity, status, source, incidentEnv, service string
		if err := rows.Scan(&number, &summary, &severity, &status, &source, &incidentEnv, &service); err != nil {
			continue
		}
		item := requestIncident{
			Status:      status,
			Source:      source,
			Severity:    severity,
			Environment: incidentEnv,
		}
		if !incidentIsActive(item.Status) {
			continue
		}
		if env != "" {
			key := strings.ToLower(strings.TrimSpace(incidentEnv))
			if key != "" && key != env {
				continue
			}
		}
		ref := strings.TrimSpace(number)
		if ref == "" {
			ref = strings.TrimSpace(summary)
		}
		if ref == "" {
			ref = "Incident"
		}
		out = append(out, guardedIncidentBrief{
			Reference: ref,
			Summary:   firstNonEmpty(strings.TrimSpace(summary), service),
			Severity:  severity,
			Blocks:    incidentBlocksPromotion(item),
		})
		if len(out) >= limit {
			break
		}
	}
	return out
}

func recordK8sWorkloadActionFailure(managerID int, input k8sWorkloadActionInput, result, summary string) {
	if managerID <= 0 {
		return
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	if action == "" {
		action = "unknown"
	}
	resourceID := fmt.Sprintf("%s:%s:%s", input.ClusterName, input.Namespace, input.WorkloadName)
	pid := input.ProjectID
	env := input.Environment
	RecordOperatorAuditFailure(managerID, "k8s_workload_"+action, "k8s_workload", resourceID, result, summary, &pid, env, "")
}
