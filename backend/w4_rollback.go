package main

import (
	"fmt"
	"strings"
)

type changeRollbackPlan struct {
	IncidentID     int    `json:"incident_id,omitempty"`
	IncidentNumber string `json:"incident_number,omitempty"`
	ChangeID       int    `json:"change_id,omitempty"`
	ChangeNumber   string `json:"change_number,omitempty"`
	Repo           string `json:"repo,omitempty"`
	Environment    string `json:"environment,omitempty"`
	Service        string `json:"service,omitempty"`
	CurrentSHA     string `json:"current_sha,omitempty"`
	PreviousSHA    string `json:"previous_sha,omitempty"`
	Allowed        bool   `json:"allowed"`
	RequiresCAB    bool   `json:"requires_cab"`
	FreezeReason   string `json:"freeze_reason,omitempty"`
	BlockReason    string `json:"block_reason,omitempty"`
	K8sHref        string `json:"k8s_href,omitempty"`
}

func planChangeSHARollback(incidentID, changeID int) (*changeRollbackPlan, error) {
	plan := &changeRollbackPlan{IncidentID: incidentID, ChangeID: changeID}
	var incident *requestIncident
	if incidentID > 0 {
		item, err := getRequestIncidentByID(incidentID)
		if err != nil || item == nil {
			return nil, fmt.Errorf("incident not found")
		}
		incident = item
		plan.IncidentNumber = item.IncidentNumber
		if changeID <= 0 && item.SuspectedChangeID != nil {
			changeID = *item.SuspectedChangeID
		}
	}
	if changeID <= 0 {
		plan.BlockReason = "No linked Change Request to roll back."
		return plan, nil
	}
	change, err := getChangeRequestByID(changeID)
	if err != nil || change == nil {
		return nil, fmt.Errorf("change not found")
	}
	plan.ChangeID = change.ID
	plan.ChangeNumber = change.ChangeNumber
	plan.Repo = change.Repo
	plan.Environment = change.Environment
	plan.Service = change.Service
	plan.CurrentSHA = change.SHA
	plan.PreviousSHA = strings.TrimSpace(change.PreviousSHA)
	if plan.PreviousSHA == "" {
		plan.BlockReason = "This change has no previous_sha to roll back to."
		return plan, nil
	}
	if isHighControlEnvironment(change.Environment) {
		if reason := activeFreezeReason(); reason != "" {
			plan.FreezeReason = reason
			plan.BlockReason = "production freeze is active: " + reason
			return plan, nil
		}
	}
	plan.RequiresCAB = changeRequiresCAB("normal", change.Environment) && (incident == nil || !incidentIsActive(incident.Status))
	if plan.RequiresCAB {
		plan.BlockReason = "High-control rollback needs CAB unless an active regression incident is linked."
		return plan, nil
	}
	plan.Allowed = true
	if clusters, err := listK8sConnections(); err == nil && len(clusters) > 0 {
		name := strings.TrimSpace(clusters[0].ClusterName)
		if name != "" {
			plan.K8sHref = "/k8s/clusters/" + name
		} else {
			plan.K8sHref = "/k8s/onboard"
		}
	}
	return plan, nil
}

func attachChangeRollbackPlan(item *changeRequestRecord) {
	if item == nil {
		return
	}
	plan, err := planChangeSHARollback(0, item.ID)
	if err == nil && plan != nil && strings.TrimSpace(plan.PreviousSHA) != "" {
		item.RollbackPlan = plan
	}
}

func executeChangeSHARollback(userID, incidentID, changeID int) (*changeRequestRecord, *changeRollbackPlan, error) {
	plan, err := planChangeSHARollback(incidentID, changeID)
	if err != nil {
		return nil, plan, err
	}
	if !plan.Allowed {
		return nil, plan, fmt.Errorf("%s", firstNonEmpty(plan.BlockReason, "rollback is not allowed"))
	}
	author := ""
	if user, err := GetUserByID(userID); err == nil && user != nil {
		author = user.Username
	}
	title := fmt.Sprintf("Rollback %s to %s", firstNonEmpty(plan.Service, plan.Repo), plan.PreviousSHA)
	payload := parsedChangeWebhook{
		Repo:                plan.Repo,
		SHA:                 plan.PreviousSHA,
		PreviousSHA:         plan.CurrentSHA,
		Title:               title,
		Author:              author,
		Summary:             "Watcher-driven rollback recorded as an emergency CHG. SetuOps does not apply the revision.",
		Service:             plan.Service,
		Environment:         plan.Environment,
		ChangeType:          "emergency",
		Status:              "implementing",
		Priority:            "high",
		RiskLevel:           "high",
		WatchMinutes:        60,
		LinkedIncidentID:    plan.IncidentID,
		LinkedIncidentNumber: plan.IncidentNumber,
		BackoutPlan:         "Re-ship " + plan.CurrentSHA + " if the rollback does not restore service.",
		Impact:              "Revert " + plan.Service + " in " + plan.Environment + " to " + plan.PreviousSHA,
	}
	item, _, err := upsertChangeRequest(payload)
	if err != nil {
		return nil, plan, err
	}
	if userID > 0 {
		if source, err := getChangeRequestByID(plan.ChangeID); err == nil && source != nil && source.RequestID != nil {
			_, _, _ = createRollbackConsoleRequest(userID, *source.RequestID, 0, title, "Prepared from "+firstNonEmpty(plan.IncidentNumber, plan.ChangeNumber))
		}
	}
	return item, plan, nil
}

func attachRollbackPlan(item *requestIncident) {
	if item == nil {
		return
	}
	changeID := 0
	if item.SuspectedChangeID != nil {
		changeID = *item.SuspectedChangeID
	}
	plan, err := planChangeSHARollback(item.ID, changeID)
	if err == nil && plan != nil && plan.PreviousSHA != "" {
		item.RollbackPlan = plan
	}
}
