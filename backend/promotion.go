package main

import (
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	canPromote := req.CreatedBy != nil && *req.CreatedBy == userID
	if !canPromote {
		_, isAdmin := requireAdmin(w, r)
		canPromote = isAdmin
	}
	if !canPromote {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeJSON(w, map[string]interface{}{"error": "only creator or admin can promote", "status": "error"})
		return
	}
	if req.Status != "completed" && req.Status != "in_progress" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeJSON(w, map[string]interface{}{"error": "only completed or in_progress requests can be promoted", "status": "error"})
		return
	}
	nextEnvironment := nextEnv(req.Env)
	if nextEnvironment == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeJSON(w, map[string]interface{}{"error": "already at production; no next environment", "status": "error"})
		return
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		log.Printf("Promote GenerateApplicationID: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	filePath, branchName := BuildRequestGitArtifacts(req.Team, nextEnvironment, appID)
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
		Config:        req.Config,
		CreatedBy:     createdBy,
	}
	if err := SavePRRequest(newReq); err != nil {
		log.Printf("Promote SavePRRequest: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
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
