package main

import (
	"fmt"
	"strings"
)

type RequestApprovalContext struct {
	RuleSource              string `json:"rule_source"`
	RuleEnvironment         string `json:"rule_environment"`
	RequiresManagerApproval bool   `json:"requires_manager_approval"`
	RequiresDevopsApproval  bool   `json:"requires_devops_approval"`
	ManagerPathAvailable    bool   `json:"manager_path_available"`
	CurrentStage            string `json:"current_stage"`
	NextStage               string `json:"next_stage,omitempty"`
	Summary                 string `json:"summary"`
}

func approvalStageLabel(status string) string {
	switch status {
	case "draft":
		return "Draft"
	case "pending_user_manager_approval":
		return "Manager review"
	case "pending_devops_approval":
		return "DevOps review"
	case "pending_approval":
		return "Final approval"
	case "in_progress":
		return "Provisioning"
	case "completed":
		return "Completed"
	case "rejected":
		return "Rejected"
	default:
		parts := strings.Fields(strings.ReplaceAll(status, "_", " "))
		for index, part := range parts {
			if strings.EqualFold(part, "pr") {
				parts[index] = "PR"
				continue
			}
			if part == "" {
				continue
			}
			parts[index] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
		return strings.Join(parts, " ")
	}
}

func nextApprovalStage(requiresManagerApproval, requiresDevopsApproval bool) string {
	switch {
	case requiresManagerApproval:
		return "Manager review"
	case requiresDevopsApproval:
		return "DevOps review"
	default:
		return "Final approval"
	}
}

func BuildRequestApprovalContext(req *PRRequest) *RequestApprovalContext {
	if req == nil {
		return nil
	}

	managerPathAvailable := false
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		managerPathAvailable = creatorHasManagerApprovalPath(*req.CreatedBy, req.Team)
	}

	requiresManagerApproval := managerPathAvailable
	requiresDevopsApproval := true
	ruleSource := "default_flow"
	ruleEnvironment := strings.TrimSpace(strings.ToLower(req.Env))
	managerRequirementConfigured := false

	if req.ProjectID != nil && *req.ProjectID > 0 {
		if project, err := getProjectCatalogByID(*req.ProjectID); err == nil && project != nil {
			if rule := findProjectApprovalRule(project, req.Env); rule != nil {
				ruleSource = "project_rule"
				managerRequirementConfigured = rule.RequireManagerApproval
				requiresManagerApproval = rule.RequireManagerApproval && managerPathAvailable
				requiresDevopsApproval = rule.RequireDevopsApproval
				ruleEnvironment = rule.Environment
			}
		}
	}

	currentStage := approvalStageLabel(req.Status)
	nextStage := ""
	switch req.Status {
	case "draft":
		nextStage = nextApprovalStage(requiresManagerApproval, requiresDevopsApproval)
	case "pending_user_manager_approval":
		if requiresDevopsApproval {
			nextStage = "DevOps review"
		} else {
			nextStage = "Final approval"
		}
	case "pending_devops_approval":
		nextStage = "Final approval"
	case "pending_approval":
		nextStage = "Provisioning"
	case "in_progress":
		nextStage = "Completed"
	}

	var summaryParts []string
	if ruleSource == "project_rule" {
		switch {
		case managerRequirementConfigured && !managerPathAvailable:
			summaryParts = append(summaryParts, fmt.Sprintf("Project rule for %s requests manager approval, but no manager path is configured, so the request routes to the next available approval gate.", ruleEnvironment))
		case requiresManagerApproval && requiresDevopsApproval:
			summaryParts = append(summaryParts, fmt.Sprintf("Project rule for %s requires both manager and DevOps approval.", ruleEnvironment))
		case requiresManagerApproval:
			summaryParts = append(summaryParts, fmt.Sprintf("Project rule for %s requires manager approval before the request can continue.", ruleEnvironment))
		case requiresDevopsApproval:
			summaryParts = append(summaryParts, fmt.Sprintf("Project rule for %s routes this request directly to DevOps approval.", ruleEnvironment))
		default:
			summaryParts = append(summaryParts, fmt.Sprintf("Project rule for %s does not require manager or DevOps approval after submission.", ruleEnvironment))
		}
	} else if requiresManagerApproval {
		summaryParts = append(summaryParts, "Default routing requires manager approval before DevOps review.")
	} else {
		summaryParts = append(summaryParts, "Default routing sends this request directly to DevOps approval.")
	}

	switch req.Status {
	case "draft":
		summaryParts = append(summaryParts, "Submit the request to start the approval flow.")
	case "pending_user_manager_approval":
		summaryParts = append(summaryParts, "It is currently waiting for manager review.")
	case "pending_devops_approval":
		summaryParts = append(summaryParts, "It is currently waiting for DevOps review.")
	case "pending_approval":
		summaryParts = append(summaryParts, "It is currently at the final approval gate before provisioning.")
	case "in_progress":
		summaryParts = append(summaryParts, "The required approvals are complete and provisioning is in progress.")
	case "completed":
		summaryParts = append(summaryParts, "The required approvals were satisfied and the request is completed.")
	case "rejected":
		summaryParts = append(summaryParts, "The request was rejected and is no longer moving through the approval flow.")
	}

	return &RequestApprovalContext{
		RuleSource:              ruleSource,
		RuleEnvironment:         ruleEnvironment,
		RequiresManagerApproval: requiresManagerApproval,
		RequiresDevopsApproval:  requiresDevopsApproval,
		ManagerPathAvailable:    managerPathAvailable,
		CurrentStage:            currentStage,
		NextStage:               nextStage,
		Summary:                 strings.Join(summaryParts, " "),
	}
}
