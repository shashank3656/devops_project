package main

import (
	"strings"
	"time"
)

const sloFreezeReasonPrefix = "slo:"

func sloFreezeIdentity(service, environment string) string {
	return sloFreezeReasonPrefix + strings.ToLower(strings.TrimSpace(service)) + "/" + strings.ToLower(strings.TrimSpace(environment))
}

func formatSLOFreezeReason(budget serviceSLOBudget) string {
	return sloFreezeIdentity(budget.Service, budget.Environment) + ": " + firstNonEmpty(budget.FreezeReason, "error budget burned")
}

func isSLOFreezeReason(reason string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(reason)), sloFreezeReasonPrefix)
}

func sloFreezeIdentityFromReason(reason string) string {
	trimmed := strings.ToLower(strings.TrimSpace(reason))
	if !strings.HasPrefix(trimmed, sloFreezeReasonPrefix) {
		return ""
	}
	rest := strings.TrimSpace(strings.TrimPrefix(trimmed, sloFreezeReasonPrefix))
	if i := strings.Index(rest, ":"); i > 0 {
		return sloFreezeReasonPrefix + strings.TrimSpace(rest[:i])
	}
	return sloFreezeReasonPrefix + rest
}

func storedActiveFreezeReason() string {
	if DB == nil {
		return ""
	}
	var reason string
	err := DB.QueryRow(`
		SELECT reason FROM deployment_freezes
		WHERE starts_at <= NOW() AND ends_at >= NOW()
		ORDER BY starts_at DESC
		LIMIT 1
	`).Scan(&reason)
	if err != nil {
		return ""
	}
	return reason
}

func endDeploymentFreeze(id int) {
	if id <= 0 || DB == nil {
		return
	}
	_, _ = execContext(`UPDATE deployment_freezes SET ends_at = NOW() WHERE id = $1 AND ends_at > NOW()`, id)
}

func listActiveSLOFreezes() []deploymentFreeze {
	out := []deploymentFreeze{}
	if DB == nil {
		return out
	}
	rows, err := DB.Query(`
		SELECT f.id, f.project_id, COALESCE(p.name, ''), f.environment, f.reason, f.starts_at, f.ends_at
		FROM deployment_freezes f
		LEFT JOIN projects p ON p.id = f.project_id
		WHERE f.starts_at <= NOW() AND f.ends_at >= NOW()
		  AND LOWER(f.reason) LIKE 'slo:%'
		ORDER BY f.id
	`)
	if err != nil {
		return out
	}
	defer func() { _ = rows.Close() }()
	now := time.Now()
	for rows.Next() {
		var item deploymentFreeze
		var projectID *int
		if err := rows.Scan(&item.ID, &projectID, &item.ProjectName, &item.Environment, &item.Reason, &item.StartsAt, &item.EndsAt); err != nil {
			continue
		}
		item.ProjectID = projectID
		item.Active = !now.Before(item.StartsAt) && !now.After(item.EndsAt)
		out = append(out, item)
	}
	return out
}

func syncSLOBudgetFreezesFrom(budgets []serviceSLOBudget) {
	if DB == nil {
		return
	}
	wanted := map[string]serviceSLOBudget{}
	for _, budget := range budgets {
		if !budget.Burned {
			continue
		}
		wanted[sloFreezeIdentity(budget.Service, budget.Environment)] = budget
	}
	existing := map[string]deploymentFreeze{}
	for _, freeze := range listActiveSLOFreezes() {
		key := sloFreezeIdentityFromReason(freeze.Reason)
		if key == "" {
			continue
		}
		existing[key] = freeze
	}
	now := time.Now()
	for key, budget := range wanted {
		if _, ok := existing[key]; ok {
			continue
		}
		_ = insertDeploymentFreeze(budget.ProjectID, budget.Environment, formatSLOFreezeReason(budget), now, now.Add(30*24*time.Hour), 0)
	}
	for key, freeze := range existing {
		if _, ok := wanted[key]; ok {
			continue
		}
		endDeploymentFreeze(freeze.ID)
	}
}

func syncSLOBudgetFreezes() {
	budgets, err := listServiceSLOBudgets(0, "")
	if err != nil {
		return
	}
	syncSLOBudgetFreezesFrom(budgets)
}

func emergencyIncidentBypassesFreeze(service, environment string) bool {
	items, err := listRequestIncidents("")
	if err != nil {
		return false
	}
	service = strings.ToLower(strings.TrimSpace(service))
	environment = strings.ToLower(strings.TrimSpace(environment))
	for _, item := range items {
		if !incidentIsActive(item.Status) || !isSEV12(item.Severity) {
			continue
		}
		itemService := strings.ToLower(strings.TrimSpace(firstNonEmpty(item.Service, item.RequestService)))
		itemEnv := strings.ToLower(strings.TrimSpace(firstNonEmpty(item.Environment, item.RequestEnv)))
		if service != "" && itemService != "" && itemService != service {
			continue
		}
		if environment != "" && itemEnv != "" && itemEnv != environment {
			continue
		}
		return true
	}
	return false
}
