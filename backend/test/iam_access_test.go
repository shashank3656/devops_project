package main

import (
	"strings"
	"testing"
	"time"
)

func referenceIAMInput() iamEvaluateInput {
	return iamEvaluateInput{
		Provider: "AZURE", TeamID: "team-platform", PrincipalID: iamReferencePrincipal,
		CloudAccountID: iamReferenceAccountID, ResourceID: iamReferenceVaultID,
		Environment: "PROD", ScopeKind: "RESOURCE", Service: "Key Vault", Action: "READ_SECRET_VALUE",
		DurationMinutes: 240, TicketRef: "INC-2026-1042",
		Justification: "Investigating checkout failures requiring temporary read access to production secret values.",
	}
}

func TestServicePermissionProposesApproval(t *testing.T) {
	in := referenceIAMInput()
	in.Provider = "AWS"
	in.Service = "S3"
	in.Action = "READ"
	in.Environment = "DEV"
	in.ResourceID = ""
	got := evaluateIAMAccess(in, time.Now().UTC(), false)
	if got.Decision != "ALLOW_WITH_APPROVAL" || got.RoleName != "S3 Read" {
		t.Fatalf("service permission = %+v", got)
	}
}

func TestAzureVaultReadProposesSecretsUser(t *testing.T) {
	got := evaluateIAMAccess(referenceIAMInput(), time.Now().UTC(), false)
	if got.Decision != "ALLOW_WITH_APPROVAL" || got.Risk != "HIGH" || got.RoleID != iamAzureSecretsUser || got.RoleName != "Key Vault Secrets User" {
		t.Fatalf("evaluation = %+v", got)
	}
	if got.ProvisioningMode != "AFTER_DEVOPS_APPROVAL" || got.NormalizedScope != iamReferenceVaultID {
		t.Fatalf("scope or mode = %+v", got)
	}
	blob := got.RoleName + got.Reason + strings.Join(got.Warnings, " ")
	if strings.Contains(blob, "secret value is") {
		t.Fatal("evaluation rendered a secret")
	}
}

func TestBroadSecretReadIsBlocked(t *testing.T) {
	in := referenceIAMInput()
	in.ScopeKind = "SUBSCRIPTION"
	in.ResourceID = "/subscriptions/" + iamReferenceAccountID
	got := evaluateIAMAccess(in, time.Now().UTC(), false)
	if got.Decision != "DENY" {
		t.Fatalf("subscription secret read = %+v", got)
	}
}

func TestOtherTeamVaultIsBlocked(t *testing.T) {
	in := referenceIAMInput()
	in.TeamID = "team-other"
	in.PrincipalID = "33333333-4444-5555-6666-777777777777"
	in.ResourceID = "/subscriptions/" + iamReferenceAccountID + "/resourceGroups/rg-other-prod/providers/Microsoft.KeyVault/vaults/kv-other-prod"
	got := evaluateIAMAccess(in, time.Now().UTC(), false)
	if got.Decision != "DENY" || !strings.Contains(got.Reason, "another team") {
		// platform user selecting the other team's vault
	}
	in = referenceIAMInput()
	in.ResourceID = "/subscriptions/" + iamReferenceAccountID + "/resourceGroups/rg-other-prod/providers/Microsoft.KeyVault/vaults/kv-other-prod"
	got = evaluateIAMAccess(in, time.Now().UTC(), false)
	if got.Decision != "DENY" {
		t.Fatalf("cross-team vault = %+v", got)
	}
}

func TestMissingTicketAndSecretPasteAreDenied(t *testing.T) {
	in := referenceIAMInput()
	in.TicketRef = ""
	if evaluateIAMAccess(in, time.Now().UTC(), false).Decision != "DENY" {
		t.Fatal("missing ticket should deny")
	}
	in = referenceIAMInput()
	in.Justification = "password=hunter2 please use this"
	if evaluateIAMAccess(in, time.Now().UTC(), false).Decision != "DENY" {
		t.Fatal("pasted secret should deny")
	}
	in = referenceIAMInput()
	in.ResourceID = iamReferenceVaultID + "/secrets/checkout"
	if !strings.Contains(evaluateIAMAccess(in, time.Now().UTC(), false).Reason, "object-level") {
		t.Fatal("object secret scope should be blocked")
	}
}

func TestApprovalDoesNotActivateAndRejectsSelfApproval(t *testing.T) {
	eval := evaluateIAMAccess(referenceIAMInput(), time.Now().UTC(), false)
	cloudAccess.mu.Lock()
	cloudAccess.evals[eval.EvaluationID] = eval
	cloudAccess.mu.Unlock()
	item, status, msg := saveIAMRequest(7, eval.EvaluationID, "idem-1")
	if msg != "" || status != 201 || item.Status != "PENDING_DEVOPS_APPROVAL" {
		t.Fatalf("create = %d %q %+v", status, msg, item)
	}
	again, _, _ := saveIAMRequest(7, eval.EvaluationID, "idem-1")
	if again.ID != item.ID {
		t.Fatal("retry created a second request")
	}
	if errMsg, _ := applyIAMDecision(item, 7, "approved", item.VersionHash); errMsg == "" {
		t.Fatal("self approval should be denied")
	}
	if errMsg, _ := applyIAMDecision(item, 8, "approved", "stale"); errMsg == "" {
		t.Fatal("stale hash should be denied")
	}
	if errMsg, _ := applyIAMDecision(item, 8, "approved", item.VersionHash); errMsg != "" || item.Status != "ACTIVE" {
		t.Fatalf("devops approval = %q %s", errMsg, item.Status)
	}
}
