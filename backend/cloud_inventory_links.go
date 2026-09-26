package main

import (
	"strings"
)

type cloudInventoryAccountContext struct {
	OnboardedAccountID *int   `json:"onboarded_account_id,omitempty"`
	AccountStatus      string `json:"account_status,omitempty"`
	Message            string `json:"message,omitempty"`
}

type cloudInventoryCatalogLink struct {
	ProjectID   int    `json:"project_id"`
	ProjectName string `json:"project_name"`
	Environment string `json:"environment"`
}

func resolveInventoryAccountContext(cloud, accountID string, visibleTeams []string) *cloudInventoryAccountContext {
	cloud = strings.ToLower(strings.TrimSpace(cloud))
	accountID = strings.TrimSpace(accountID)
	if accountID == "" || DB == nil {
		return nil
	}
	teamSet := map[string]struct{}{}
	for _, slug := range visibleTeams {
		slug = strings.TrimSpace(slug)
		if slug != "" {
			teamSet[slug] = struct{}{}
		}
	}
	var bestID int
	var bestStatus string
	var bestTeam string
	rows, err := DB.Query(`
		SELECT id, team_slug, status
		FROM cloud_accounts
		WHERE LOWER(provider) = $1 AND account_id = $2
		ORDER BY CASE WHEN status = 'connected' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END, id DESC
	`, cloud, accountID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var teamSlug, status string
		if err := rows.Scan(&id, &teamSlug, &status); err != nil {
			continue
		}
		if len(teamSet) > 0 {
			if _, ok := teamSet[strings.TrimSpace(teamSlug)]; !ok {
				continue
			}
		}
		bestID = id
		bestStatus = strings.TrimSpace(status)
		bestTeam = teamSlug
		break
	}
	if bestID <= 0 {
		return &cloudInventoryAccountContext{
			AccountStatus: "not_onboarded",
			Message:       "This provider account is not onboarded in SetuOps for your teams. Onboard it under Cloud accounts to tie inventory to trust and the environment catalog.",
		}
	}
	ctx := &cloudInventoryAccountContext{
		OnboardedAccountID: &bestID,
		AccountStatus:      bestStatus,
	}
	switch bestStatus {
	case "disabled":
		ctx.Message = "This cloud account is disabled. Inventory is hidden for disabled accounts until a manager re-enables connection & trust."
	case "connected", "pending":
		if bestTeam != "" {
			ctx.Message = ""
		}
	default:
		ctx.Message = "Account status: " + bestStatus
	}
	return ctx
}

func catalogLinksForOnboardedAccount(onboardedAccountID int, environment string) ([]cloudInventoryCatalogLink, error) {
	out := []cloudInventoryCatalogLink{}
	if DB == nil || onboardedAccountID <= 0 {
		return out, nil
	}
	environment = strings.TrimSpace(environment)
	query := `
		SELECT p.id, p.name, pe.environment
		FROM project_environments pe
		JOIN projects p ON p.id = pe.project_id
		WHERE pe.cloud_account_id = $1
	`
	args := []interface{}{onboardedAccountID}
	if environment != "" {
		query += ` AND LOWER(pe.environment) = LOWER($2)`
		args = append(args, environment)
	}
	query += ` ORDER BY p.name, pe.environment`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var link cloudInventoryCatalogLink
		if err := rows.Scan(&link.ProjectID, &link.ProjectName, &link.Environment); err != nil {
			continue
		}
		out = append(out, link)
	}
	return out, nil
}
