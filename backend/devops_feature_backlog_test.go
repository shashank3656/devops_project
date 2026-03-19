package main

import (
	"testing"
	"time"
)

func TestBuildDeploymentGatePolicyEngineSummarizesEnvironmentStatus(t *testing.T) {
	project := ProjectCatalog{
		Environments: []string{"dev", "prod"},
		ApprovalRules: []ProjectApprovalRule{
			{Environment: "dev", RequireManagerApproval: false, RequireDevopsApproval: true},
			{Environment: "prod", RequireManagerApproval: true, RequireDevopsApproval: true},
		},
	}

	engine := buildDeploymentGatePolicyEngine(
		project,
		[]projectReleaseEnvironmentStatus{
			{Environment: "dev", IncidentCount: 0},
			{Environment: "prod", IncidentCount: 1},
		},
		[]promotionCenterItem{
			{RequestID: 101, Environment: "dev", NextEnvironment: "prod"},
		},
		nil,
		[]projectAccessOverride{
			{
				ID:           1,
				ProjectID:    12,
				UserID:       5,
				Username:     "temp-user",
				Environments: []string{"prod"},
				Permission:   "write",
				ExpiresAt:    time.Now().Add(2 * time.Hour),
			},
		},
	)

	if len(engine.Environments) != 2 {
		t.Fatalf("expected 2 environments, got %d", len(engine.Environments))
	}
	if engine.Summary.BlockedEnvironments != 1 {
		t.Fatalf("expected 1 blocked environment, got %d", engine.Summary.BlockedEnvironments)
	}
	if engine.Summary.AttentionEnvironments != 1 {
		t.Fatalf("expected 1 attention environment, got %d", engine.Summary.AttentionEnvironments)
	}

	devGate := engine.Environments[0]
	if devGate.Environment != "dev" {
		t.Fatalf("expected first environment to be dev, got %q", devGate.Environment)
	}
	if devGate.Status != "attention" {
		t.Fatalf("expected dev status to be attention, got %q", devGate.Status)
	}

	prodGate := engine.Environments[1]
	if prodGate.Environment != "prod" {
		t.Fatalf("expected second environment to be prod, got %q", prodGate.Environment)
	}
	if prodGate.Status != "blocked" {
		t.Fatalf("expected prod status to be blocked, got %q", prodGate.Status)
	}
	if prodGate.PromotionCandidateCount != 1 {
		t.Fatalf("expected prod promotion candidate count to be 1, got %d", prodGate.PromotionCandidateCount)
	}
	if prodGate.ActiveOverrideCount != 1 {
		t.Fatalf("expected prod override count to be 1, got %d", prodGate.ActiveOverrideCount)
	}
}

func TestBuildPromotionGateDecisionStatuses(t *testing.T) {
	blocked := buildPromotionGateDecision(
		"prod",
		&deploymentGateEnvironment{
			Environment: "prod",
			Status:      "blocked",
			Summary:     "Blocked by incident guard.",
			Checks: []deploymentGateCheck{
				{Key: "incident_guard", Label: "Incident guard", Status: "blocked", Detail: "1 active incident."},
			},
		},
		nil,
		"",
		false,
	)
	if blocked.CanPromote {
		t.Fatalf("expected blocked gate to prevent promotion")
	}
	if blocked.RequiresAcknowledgement {
		t.Fatalf("expected blocked gate not to require acknowledgement")
	}
	if blocked.BlockingCheckCount != 1 {
		t.Fatalf("expected 1 blocking check, got %d", blocked.BlockingCheckCount)
	}

	attention := buildPromotionGateDecision(
		"uat",
		&deploymentGateEnvironment{
			Environment: "uat",
			Status:      "attention",
			Summary:     "Needs change window review.",
			Checks: []deploymentGateCheck{
				{Key: "change_window", Label: "Change window", Status: "attention", Detail: "Manual confirmation required."},
			},
		},
		nil,
		"",
		false,
	)
	if attention.CanPromote {
		t.Fatalf("expected attention gate to wait for persisted approval")
	}
	if !attention.RequiresAcknowledgement {
		t.Fatalf("expected attention gate to require acknowledgement")
	}
	if attention.AttentionCheckCount != 1 {
		t.Fatalf("expected 1 attention check, got %d", attention.AttentionCheckCount)
	}

	approved := buildPromotionGateDecision(
		"uat",
		&deploymentGateEnvironment{
			Environment: "uat",
			Status:      "attention",
			Summary:     "Needs change window review.",
			Checks: []deploymentGateCheck{
				{Key: "change_window", Label: "Change window", Status: "attention", Detail: "Manual confirmation required."},
			},
		},
		&deploymentGateApprovalRecord{
			ID:                 9,
			RequestID:          55,
			TargetEnvironment:  "uat",
			ApprovedBy:         8,
			ApprovedByUsername: "ops-lead",
			ApprovedAt:         time.Now(),
		},
		"",
		false,
	)
	if !approved.CanPromote {
		t.Fatalf("expected approved attention gate to become promotable")
	}
	if approved.RequiresAcknowledgement {
		t.Fatalf("expected approved attention gate not to require acknowledgement")
	}
	if !approved.Approved {
		t.Fatalf("expected approved decision to be flagged as approved")
	}
	if approved.Status != "ready" {
		t.Fatalf("expected approved attention gate to become ready, got %q", approved.Status)
	}
}
