package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

const resourceContextAuditLimit = 5

type resourceContextGuardedHints struct {
	BlockSummary string   `json:"block_summary,omitempty"`
	Warnings     []string `json:"warnings,omitempty"`
}

type devopsResourceContext struct {
	Kind              string                       `json:"kind"`
	ProjectID         int                          `json:"project_id,omitempty"`
	ProjectName       string                       `json:"project_name,omitempty"`
	Environment       string                       `json:"environment,omitempty"`
	TargetEnvironment string                       `json:"target_environment,omitempty"`
	Delivery          *DeliveryVisibility          `json:"delivery,omitempty"`
	EnvironmentCatalog *environmentCatalogRow      `json:"environment_catalog,omitempty"`
	AccountContext    *cloudInventoryAccountContext `json:"account_context,omitempty"`
	Freeze            guardedFreezeBrief           `json:"freeze"`
	OpenIncidents     []guardedIncidentBrief       `json:"open_incidents"`
	GuardedHints      *resourceContextGuardedHints `json:"guarded_hints,omitempty"`
	OperatorActivity  []operatorAuditRow           `json:"operator_activity"`
	PartialErrors     map[string]string            `json:"partial_errors,omitempty"`
}

func devopsResourceContextHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
	id, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("id")))
	if id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "id is required", nil)
		return
	}

	var (
		ctx *devopsResourceContext
		err error
	)
	switch kind {
	case "ticket":
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		ctx, err = buildTicketResourceContext(userID, id)
	case "change":
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		ctx, err = buildChangeResourceContext(userID, id)
	case "cloud_resource":
		userID, ok := requireDevopsUser(w, r)
		if !ok {
			return
		}
		ctx, err = buildCloudResourceContext(r.Context(), userID, id)
	default:
		writeAPIError(w, r, http.StatusBadRequest, "kind must be ticket, change, or cloud_resource", nil)
		return
	}
	if err != nil {
		var rcErr *resourceContextError
		if errors.As(err, &rcErr) {
			writeAPIError(w, r, rcErr.status, rcErr.message, err)
			return
		}
		writeAPIError(w, r, http.StatusInternalServerError, "failed to load resource context", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeDevopsJSON(w, map[string]any{"status": "ok", "context": ctx})
}

func buildTicketResourceContext(userID, requestID int) (*devopsResourceContext, error) {
	req, err := GetPRRequestByID(requestID)
	if err != nil || req == nil {
		return nil, errNotFound("request not found")
	}
	if !devopsUserCanViewPRRequest(userID, req) {
		return nil, errForbidden("request not found")
	}
	out := &devopsResourceContext{
		Kind:          "ticket",
		Environment:   strings.TrimSpace(req.Env),
		OpenIncidents: []guardedIncidentBrief{},
		OperatorActivity: []operatorAuditRow{},
	}
	if req.ProjectID != nil && *req.ProjectID > 0 {
		out.ProjectID = *req.ProjectID
		if project, err := getProjectCatalogByID(*req.ProjectID); err == nil && project != nil {
			out.ProjectName = strings.TrimSpace(project.Name)
		}
	}
	delivery := buildRequestDeliveryVisibility(req)
	out.Delivery = &delivery

	targetEnv := nextEnv(req.Env)
	out.TargetEnvironment = targetEnv
	freeze, incidents, hints := readOnlyPromoteSignals(req)
	out.Freeze = freeze
	out.OpenIncidents = incidents
	if hints != nil {
		out.GuardedHints = hints
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	wg.Add(2)
	go func() {
		defer wg.Done()
		row, err := environmentCatalogRowForDevops(userID, out.ProjectID, req.Env)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "environment_catalog", "Environment catalog unavailable")
			return
		}
		if row != nil {
			out.EnvironmentCatalog = row
		}
	}()
	go func() {
		defer wg.Done()
		events, err := operatorAuditEventsForResource(userID, "pr_request", strconv.Itoa(requestID), resourceContextAuditLimit)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "operator_activity", "Operator activity unavailable")
			return
		}
		if len(events) > 0 {
			out.OperatorActivity = events
		}
	}()
	wg.Wait()
	return out, nil
}

func buildChangeResourceContext(userID, changeID int) (*devopsResourceContext, error) {
	item, err := getChangeRequestByID(changeID)
	if err != nil || item == nil {
		return nil, errNotFound("change not found")
	}
	out := &devopsResourceContext{
		Kind:          "change",
		Environment:   strings.TrimSpace(item.Environment),
		OpenIncidents: []guardedIncidentBrief{},
		OperatorActivity: []operatorAuditRow{},
	}
	if item.ProjectID != nil && *item.ProjectID > 0 {
		project, err := getProjectCatalogByID(*item.ProjectID)
		if err != nil || project == nil || !devopsUserCanViewProject(userID, *project) {
			return nil, errForbidden("change not found")
		}
		out.ProjectID = *item.ProjectID
		out.ProjectName = strings.TrimSpace(project.Name)
	}
	delivery := buildChangeDeliveryVisibility(item)
	out.Delivery = &delivery

	targetEnv := nextEnv(item.Environment)
	out.TargetEnvironment = targetEnv
	signalsApplied := false
	if item.RequestID != nil && *item.RequestID > 0 {
		if req, err := GetPRRequestByID(*item.RequestID); err == nil && req != nil {
			freeze, incidents, hints := readOnlyPromoteSignals(req)
			out.Freeze = freeze
			out.OpenIncidents = incidents
			if hints != nil {
				out.GuardedHints = hints
			}
			signalsApplied = true
		}
	}
	if !signalsApplied && out.ProjectID > 0 && targetEnv != "" {
		out.Freeze, out.OpenIncidents = targetEnvironmentSignals(out.ProjectID, targetEnv, item.Service)
	}

	if row, err := environmentCatalogRowForDevops(userID, out.ProjectID, item.Environment); err != nil {
		out.PartialErrors = mergePartialError(out.PartialErrors, "environment_catalog", "Environment catalog unavailable")
	} else if row != nil {
		out.EnvironmentCatalog = row
	}

	if item.RequestID != nil && *item.RequestID > 0 {
		if events, err := operatorAuditEventsForResource(userID, "pr_request", strconv.Itoa(*item.RequestID), resourceContextAuditLimit); err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "operator_activity", "Operator activity unavailable")
		} else if len(events) > 0 {
			out.OperatorActivity = events
		}
	} else if out.ProjectID > 0 {
		if events, err := listOperatorAuditForDevops(userID, resourceContextAuditLimit, 0, out.ProjectID, item.Environment, "", ""); err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "operator_activity", "Operator activity unavailable")
		} else if len(events) > 0 {
			out.OperatorActivity = events
		}
	}
	return out, nil
}

func buildCloudResourceContext(ctx context.Context, userID, resourceID int) (*devopsResourceContext, error) {
	if DB == nil {
		return nil, errNotFound("resource not found")
	}
	visibleTeams, err := devopsVisibleTeamSlugs(userID)
	if err != nil {
		return nil, err
	}
	item, err := cloudInventoryProvider.GetByID(ctx, resourceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errNotFound("resource not found")
		}
		return nil, err
	}
	if !devopsUserCanViewInventoryTeam(visibleTeams, item.TeamSlug) {
		return nil, errNotFound("resource not found")
	}
	out := &devopsResourceContext{
		Kind:             "cloud_resource",
		Environment:      strings.TrimSpace(item.Environment),
		OpenIncidents:    []guardedIncidentBrief{},
		OperatorActivity: []operatorAuditRow{},
	}
	if ctx := resolveInventoryAccountContext(item.Cloud, item.AccountID, visibleTeams); ctx != nil {
		out.AccountContext = ctx
	}
	onboardedID := lookupCloudAccountDBID(item.TeamSlug, item.Cloud, item.AccountID)
	if onboardedID <= 0 && out.AccountContext != nil && out.AccountContext.OnboardedAccountID != nil {
		onboardedID = *out.AccountContext.OnboardedAccountID
	}
	var catalogProjectID int
	if onboardedID > 0 {
		if links, err := catalogLinksForOnboardedAccount(onboardedID, item.Environment); err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "environment_catalog", "Environment catalog unavailable")
		} else if len(links) > 0 {
			catalogProjectID = links[0].ProjectID
			out.ProjectID = links[0].ProjectID
			out.ProjectName = links[0].ProjectName
			if row, err := environmentCatalogRowForDevops(userID, links[0].ProjectID, links[0].Environment); err != nil {
				out.PartialErrors = mergePartialError(out.PartialErrors, "environment_catalog", "Environment catalog unavailable")
			} else if row != nil {
				out.EnvironmentCatalog = row
				out.Freeze = guardedFreezeBrief{
					Active: row.Frozen,
					Reason: row.FreezeReason,
					EndsAt: row.FreezeEndsAt,
				}
			}
		}
		if events, err := operatorAuditEventsForResource(userID, "cloud_account", strconv.Itoa(onboardedID), resourceContextAuditLimit); err != nil {
			out.PartialErrors = mergePartialError(out.PartialErrors, "operator_activity", "Operator activity unavailable")
		} else if len(events) > 0 {
			out.OperatorActivity = events
		}
	}
	if catalogProjectID > 0 && item.Environment != "" {
		if len(out.OpenIncidents) == 0 {
			out.OpenIncidents = listGuardedOpenIncidents(catalogProjectID, item.Environment, guardedActionMaxIncidents)
		}
	}
	return out, nil
}

func targetEnvironmentSignals(projectID int, targetEnv, service string) (guardedFreezeBrief, []guardedIncidentBrief) {
	freeze := guardedFreezeBrief{}
	incidents := []guardedIncidentBrief{}
	if projectID <= 0 || strings.TrimSpace(targetEnv) == "" {
		return freeze, incidents
	}
	pid := projectID
	active, reason, ends := activeDeploymentFreeze(&pid, targetEnv)
	if !active && strings.EqualFold(targetEnv, "prod") {
		if globalReason := activeFreezeReason(); globalReason != "" && !emergencyBypassesFreeze(service, targetEnv) {
			active = true
			reason = globalReason
		}
	}
	freeze = guardedFreezeBrief{Active: active, Reason: reason, EndsAt: ends}
	incidents = listGuardedOpenIncidents(projectID, targetEnv, guardedActionMaxIncidents)
	return freeze, incidents
}

func readOnlyPromoteSignals(req *PRRequest) (guardedFreezeBrief, []guardedIncidentBrief, *resourceContextGuardedHints) {
	freeze := guardedFreezeBrief{}
	incidents := []guardedIncidentBrief{}
	hints := &resourceContextGuardedHints{}
	if req == nil {
		return freeze, incidents, nil
	}
	next := nextEnv(req.Env)
	if next == "" {
		hints.Warnings = append(hints.Warnings, "This request is already at the highest environment.")
		return freeze, incidents, hints
	}
	if req.ProjectID != nil && *req.ProjectID > 0 {
		freeze, incidents = targetEnvironmentSignals(*req.ProjectID, next, req.Service)
		if freeze.Active {
			hints.BlockSummary = "Promotion would be blocked: deployment freeze on " + next + " — " + freeze.Reason
		}
		for _, inc := range incidents {
			if inc.Blocks {
				hints.Warnings = append(hints.Warnings, "Open incident "+inc.Reference+" may block promotion.")
			}
		}
	}
	gate, gateErr := evaluatePromotionGateForRequest(req)
	if gateErr == nil && gate != nil {
		if gate.Status == "blocked" {
			hints.BlockSummary = firstNonEmpty(strings.TrimSpace(gate.Summary), "Promotion blocked by deployment gate policy.")
		}
		if gate.RequiresAcknowledgement {
			hints.BlockSummary = firstNonEmpty(strings.TrimSpace(gate.ReviewMessage), "Deployment gate approval is required before promotion.")
		}
	}
	if hints.BlockSummary == "" && len(hints.Warnings) == 0 {
		return freeze, incidents, nil
	}
	return freeze, incidents, hints
}

func devopsUserCanViewPRRequest(userID int, req *PRRequest) bool {
	if req == nil {
		return false
	}
	if req.ProjectID != nil && *req.ProjectID > 0 {
		project, err := getProjectCatalogByID(*req.ProjectID)
		if err != nil || project == nil {
			return false
		}
		return devopsUserCanViewProject(userID, *project)
	}
	profile, _ := GetDevopsProfile(userID)
	return profile != nil && profile.IsManager
}

func mergePartialError(existing map[string]string, key, msg string) map[string]string {
	if existing == nil {
		existing = map[string]string{}
	}
	existing[key] = msg
	return existing
}

type resourceContextError struct {
	status  int
	message string
}

func (e *resourceContextError) Error() string { return e.message }

func errNotFound(msg string) error  { return &resourceContextError{status: http.StatusNotFound, message: msg} }
func errForbidden(msg string) error { return &resourceContextError{status: http.StatusForbidden, message: msg} }
