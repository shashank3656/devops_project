package main

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func statsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	userIDInt := 0
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		token := authHeader[7:]
		if id, err := validateToken(token); err == nil {
			userIDInt = id
		}
	}

	stats, err := GetStats(userIDInt)
	if err != nil {
		log.Printf("Error fetching stats: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch stats", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status": "success",
		"stats":  stats,
	})
}

func historyDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}

	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}

	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	// Extract ID from path: /api/history/123
	path := strings.TrimPrefix(r.URL.Path, "/api/history/")
	idStr := strings.Split(path, "/")[0]
	if idStr == "" {
		writeAPIError(w, r, http.StatusBadRequest, "missing request ID", nil)
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid request ID", err)
		return
	}

	req, err := GetPRRequestByID(id)
	if err != nil {
		log.Printf("Error fetching PR request: %v", err)
		writeAPIError(w, r, http.StatusInternalServerError, "failed to fetch request", err)
		return
	}

	if req == nil {
		writeAPIError(w, r, http.StatusNotFound, "request not found", nil)
		return
	}

	userID := 0
	if authHeader := r.Header.Get("Authorization"); authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		if id, err := validateToken(strings.TrimSpace(authHeader[7:])); err == nil {
			userID = id
		}
	}
	canApproveByManager := CanApproveByManager(req, userID)
	dependsOn, _ := GetRequestDependencies(id)
	blockedBy, _ := GetRequestsThatDependOn(id)
	var preview *CostRiskPreview
	if CanUserSeePortalCostRiskPreview(userID) {
		preview = BuildCostRiskPreview(req)
	}

	requestPayload := struct {
		*PRRequest
		CostRiskPreview *CostRiskPreview        `json:"cost_risk_preview,omitempty"`
		ApprovalContext *RequestApprovalContext `json:"approval_context,omitempty"`
	}{
		PRRequest:       req,
		CostRiskPreview: preview,
		ApprovalContext: BuildRequestApprovalContext(req),
	}

	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{
		"status":                 "success",
		"request":                requestPayload,
		"can_approve_by_manager": canApproveByManager,
		"depends_on":             dependsOn,
		"blocked_by":             blockedBy,
		"lifetime":               buildRequestLifetime(req, time.Now()),
		"plan_review":            buildPlanReview(req),
		"policy_checks":          buildPolicyCheckSummary(req.ID),
		"cost_check":             buildRequestCostCheck(req),
		"delivery":               buildRequestDeliveryVisibility(req),
	})
}
