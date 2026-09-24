package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const (
	checkInfragatePlanReview  = "infragate/plan-review"
	checkInfragatePolicy      = "infragate/policy"
	checkInfragateDeployIntel = "infragate/deploy-intel"
)

type deployIntelRequiredCheck struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
	Present  bool   `json:"present"`
	Status   string `json:"status"` // ok, missing, unknown
	Detail   string `json:"detail,omitempty"`
}

type deployIntelBranchProtection struct {
	BaseBranch        string                     `json:"base_branch"`
	Protected         bool                       `json:"protected"`
	Enforcement     string                     `json:"enforcement,omitempty"`
	RequiredChecks    []deployIntelRequiredCheck `json:"required_checks"`
	Recommendations   []string                   `json:"recommendations,omitempty"`
	Summary           string                     `json:"summary"`
	GitHubConfigured  bool                       `json:"github_configured"`
}

type deployFrequencyBucket struct {
	PeriodStart time.Time `json:"period_start"`
	PeriodLabel string    `json:"period_label"`
	MergeCount  int       `json:"merge_count"`
	HighRisk    int       `json:"high_risk_merges"`
}

type deployIntelRepoInsights struct {
	BranchProtection deployIntelBranchProtection `json:"branch_protection"`
	DeployFrequency  []deployFrequencyBucket     `json:"deploy_frequency"`
}

func buildDeployIntelBranchProtection(owner, name, baseBranch string) deployIntelBranchProtection {
	out := deployIntelBranchProtection{
		BaseBranch: baseBranch,
		RequiredChecks: []deployIntelRequiredCheck{
			{Key: "plan_review", Label: checkInfragatePlanReview, Required: true, Present: false, Status: "unknown"},
			{Key: "policy", Label: checkInfragatePolicy, Required: true, Present: false, Status: "unknown"},
		},
		GitHubConfigured: GitHubToken != "",
	}
	if baseBranch == "" {
		baseBranch = "main"
		out.BaseBranch = baseBranch
	}
	if GitHubToken == "" {
		out.Summary = "Set GITHUB_TOKEN to read branch protection from GitHub."
		out.Recommendations = []string{
			fmt.Sprintf("Require status check %q on %s.", checkInfragatePlanReview, baseBranch),
			fmt.Sprintf("Require status check %q on %s.", checkInfragatePolicy, baseBranch),
		}
		return out
	}
	owner, name = normalizeRepoIdentity(owner, name)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		out.Summary = "GitHub client is not available."
		return out
	}
	protection, _, err := client.Repositories.GetBranchProtection(ctx, owner, name, baseBranch)
	if err != nil {
		out.Summary = fmt.Sprintf("Branch %q is not protected yet (or protection could not be read).", baseBranch)
		out.Recommendations = []string{
			"Enable branch protection on the production base branch.",
			fmt.Sprintf("Add required check %q.", checkInfragatePlanReview),
			fmt.Sprintf("Add required check %q.", checkInfragatePolicy),
		}
		for i := range out.RequiredChecks {
			out.RequiredChecks[i].Status = "missing"
		}
		return out
	}
	out.Protected = true
	if protection.EnforceAdmins != nil && protection.EnforceAdmins.Enabled {
		out.Enforcement = "admins included"
	} else {
		out.Enforcement = "standard"
	}
	present := map[string]bool{}
	if protection.RequiredStatusChecks != nil {
		if protection.RequiredStatusChecks.Contexts != nil {
			for _, ctxCheck := range *protection.RequiredStatusChecks.Contexts {
				present[strings.ToLower(strings.TrimSpace(ctxCheck))] = true
			}
		}
		if protection.RequiredStatusChecks.Checks != nil {
			for _, ctxCheck := range *protection.RequiredStatusChecks.Checks {
				if ctxCheck == nil {
					continue
				}
				present[strings.ToLower(strings.TrimSpace(ctxCheck.Context))] = true
			}
		}
	}
	missing := 0
	for i := range out.RequiredChecks {
		labelKey := strings.ToLower(out.RequiredChecks[i].Label)
		if present[labelKey] {
			out.RequiredChecks[i].Present = true
			out.RequiredChecks[i].Status = "ok"
			out.RequiredChecks[i].Detail = "Required on branch protection."
		} else {
			out.RequiredChecks[i].Status = "missing"
			missing++
		}
	}
	if missing == 0 {
		out.Summary = fmt.Sprintf("Branch %q requires both SetuOps CI checks.", baseBranch)
	} else {
		out.Summary = fmt.Sprintf("Branch %q is protected but %d SetuOps check(s) are not required yet.", baseBranch, missing)
		out.Recommendations = []string{}
		for _, check := range out.RequiredChecks {
			if !check.Present {
				out.Recommendations = append(out.Recommendations, fmt.Sprintf("Add required status check %q.", check.Label))
			}
		}
	}
	return out
}

func listDeployFrequencyBuckets(owner, name string, weeks int) ([]deployFrequencyBucket, error) {
	if DB == nil {
		return []deployFrequencyBucket{}, nil
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if weeks <= 0 || weeks > 26 {
		weeks = 12
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -7*weeks)
	rows, err := DB.Query(`
		SELECT date_trunc('week', merged_at AT TIME ZONE 'UTC') AS wk,
		       COUNT(*),
		       COUNT(*) FILTER (WHERE lower(risk_level) = 'high')
		  FROM repo_deploy_events
		 WHERE lower(repo_owner) = lower($1) AND lower(repo_name) = lower($2)
		   AND merged_at >= $3
		 GROUP BY 1
		 ORDER BY 1 ASC
	`, owner, name, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]deployFrequencyBucket, 0)
	for rows.Next() {
		var bucket deployFrequencyBucket
		if err := rows.Scan(&bucket.PeriodStart, &bucket.MergeCount, &bucket.HighRisk); err != nil {
			return nil, err
		}
		year, week := bucket.PeriodStart.ISOWeek()
		bucket.PeriodLabel = fmt.Sprintf("%d-W%02d", year, week)
		out = append(out, bucket)
	}
	return out, nil
}

func buildDeployIntelRepoInsights(owner, name, baseBranch string) (deployIntelRepoInsights, error) {
	freq, err := listDeployFrequencyBuckets(owner, name, 12)
	if err != nil {
		return deployIntelRepoInsights{}, err
	}
	return deployIntelRepoInsights{
		BranchProtection: buildDeployIntelBranchProtection(owner, name, baseBranch),
		DeployFrequency:  freq,
	}, nil
}
