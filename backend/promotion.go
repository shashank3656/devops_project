package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

var envPromotionOrder = []string{"dev", "stage", "staging", "prod", "production"}

func nextEnv(current string) string {
	curr := strings.ToLower(strings.TrimSpace(current))
	for i, e := range envPromotionOrder {
		if e == curr && i+1 < len(envPromotionOrder) {
			return envPromotionOrder[i+1]
		}
	}
	// Default: dev -> stage -> prod
	switch curr {
	case "dev":
		return "stage"
	case "stage", "staging":
		return "prod"
	case "prod", "production":
		return ""
	default:
		return "stage"
	}
}

// handleRequestPromote POST /api/request/:id/promote - create new request for next environment (dev→staging→prod)
func handleRequestPromote(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	canPromote := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canPromote {
		_, isAdmin := requireAdmin(w, r)
		canPromote = isAdmin
	}
	if !canPromote {
		writeAPIError(w, r, http.StatusForbidden, "only creator or admin can promote", nil)
		return
	}
	if req.Status != "completed" && req.Status != "in_progress" {
		writeAPIError(w, r, http.StatusBadRequest, "only completed or in_progress requests can be promoted", nil)
		return
	}
	nextEnvironment := nextEnv(req.Env)
	if nextEnvironment == "" {
		writeAPIError(w, r, http.StatusBadRequest, "already at production; no next environment", nil)
		return
	}
	var promoteBody struct {
		HighRiskMergeAcknowledged bool     `json:"high_risk_merge_acknowledged"`
		AckReasons                []string `json:"ack_reasons"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&promoteBody)
	}
	if isHighControlEnvironment(nextEnvironment) {
		highRiskGate := evaluateHighRiskMergeAck(req)
		if highRiskGate.Required && !promoteBody.HighRiskMergeAcknowledged {
			writeHighRiskMergeAckRequired(w, highRiskGate)
			return
		}
		if highRiskGate.Event != nil && (promoteBody.HighRiskMergeAcknowledged || highRiskGate.Required) {
			persistAckForGate(req, highRiskGate, userID, promoteBody.AckReasons)
		}
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		log.Printf("Promote GenerateApplicationID: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(req.ProjectID, req.Team, req.Cloud, nextEnvironment, req.Service, appID)
	createdBy := req.CreatedBy
	if createdBy == nil && userID > 0 {
		createdBy = &userID
	}
	newReq := &PRRequest{
		ProjectID:     req.ProjectID,
		Team:          req.Team,
		Env:           nextEnvironment,
		Cloud:         req.Cloud,
		Service:       req.Service,
		ClientName:    req.ClientName + " (promoted from " + req.Env + ")",
		ApplicationID: appID,
		Priority:      req.Priority,
		DueDate:       req.DueDate,
		PRURL:         "",
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(req.Config, appID),
		CreatedBy:     createdBy,
	}
	if err := SavePRRequest(newReq); err != nil {
		log.Printf("Promote SavePRRequest: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	applyProjectDefaultLifetimeIfEligible(newReq.ID, newReq.ProjectID, newReq.Env)
	// Link: new request points to source
	_, _ = DB.Exec("UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2", id, newReq.ID)
	AppendUserActivity(createdBy, "request_promote", "pr_request", strconv.Itoa(newReq.ID), "promoted from #"+strconv.Itoa(id)+" ("+req.Env+"→"+nextEnvironment+")")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	encodeJSON(w, map[string]interface{}{
		"status":  "ok",
		"id":      newReq.ID,
		"env":     nextEnvironment,
		"message": "Request created for " + nextEnvironment + ". Edit and submit from History.",
	})
}
