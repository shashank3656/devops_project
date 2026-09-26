package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func TestCloudAccountJSONOmitsSecrets(t *testing.T) {
	item := cloudAccountRecord{
		ID:            1,
		Provider:      "aws",
		AccountID:     "111122223333",
		DisplayName:   "Prod",
		TeamSlug:      "platform-team",
		AuthMode:      "assume_role",
		RoleARN:       "arn:aws:iam::111122223333:role/ReadOnly",
		ExternalIDSet: true,
		Status:        "connected",
	}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if strings.Contains(body, "secret_access") || strings.Contains(body, `"external_id"`) {
		t.Fatalf("response must not expose raw external_id field: %s", body)
	}
}

func TestPublicCloudTestErrorTruncates(t *testing.T) {
	long := strings.Repeat("x", 200)
	msg := publicCloudTestError(&testError{long})
	if len(msg) > 180 {
		t.Fatalf("expected truncated message, got len %d", len(msg))
	}
}

func TestAWSAccountIDFromRoleARN(t *testing.T) {
	got := awsAccountIDFromRoleARN("arn:aws:iam::123456789012:role/SetuOpsRead")
	if got != "123456789012" {
		t.Fatalf("unexpected account id %q", got)
	}
	if awsAccountIDFromRoleARN("bad-arn") != "" {
		t.Fatal("expected empty for invalid arn")
	}
}

func TestAWSAssumeRoleAccountMismatch(t *testing.T) {
	err := awsAssumeRoleConnectivityTest("111122223333", "arn:aws:iam::999988887777:role/X", "ext")
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected account mismatch error, got %v", err)
	}
}

func TestSanitizeAWSTestErrorGeneric(t *testing.T) {
	msg := sanitizeAWSTestError(errors.New("AccessDenied: not authorized to perform sts:AssumeRole")).Error()
	if strings.Contains(strings.ToLower(msg), "accessdenied") {
		t.Fatalf("expected generic message, got %q", msg)
	}
	if !strings.Contains(msg, "trust policy") {
		t.Fatalf("expected trust policy hint, got %q", msg)
	}
}

func TestAWSAssumeRoleUsesInjectedLiveFn(t *testing.T) {
	prev := awsAssumeRoleLive
	t.Cleanup(func() { awsAssumeRoleLive = prev })
	awsAssumeRoleLive = func(ctx context.Context, cfg aws.Config, roleARN, externalID string) error {
		if roleARN == "" {
			t.Fatal("expected role arn")
		}
		return nil
	}
	t.Setenv("SETUOPS_AWS_VALIDATE_ONLY", "false")
	t.Setenv("AWS_ACCESS_KEY_ID", "test-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")

	err := awsAssumeRoleConnectivityTest("123456789012", "arn:aws:iam::123456789012:role/ReadOnly", "ext-id")
	if err != nil {
		t.Fatalf("expected success with mocked assume role, got %v", err)
	}
}

func TestAzureCloudAccountValidation(t *testing.T) {
	sub := "12345678-1234-1234-1234-123456789012"
	item := &cloudAccountRecord{Provider: "azure", AccountID: sub}
	creds := &cloudAccountCredentials{
		AuthMode:   "assume_role",
		RoleARN:    "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Authorization/roleDefinitions/reader",
		ExternalID: "87654321-4321-4321-4321-210987654321",
	}
	if err := testAzureCloudAccount(item, creds); err != nil {
		t.Fatalf("expected valid azure config, got %v", err)
	}
}

func TestDevopsUserCanViewInventoryTeam(t *testing.T) {
	visible := []string{"platform-team", "devopsteam"}
	if !devopsUserCanViewInventoryTeam(visible, "platform-team") {
		t.Fatal("expected platform-team visible")
	}
	if devopsUserCanViewInventoryTeam(visible, "other-team") {
		t.Fatal("expected other-team hidden")
	}
}

func TestResolveInventoryTeamFilter(t *testing.T) {
	visible := []string{"platform-team", "devopsteam"}
	team, ok := resolveInventoryTeamFilter("", visible)
	if !ok || team != "" {
		t.Fatalf("expected all visible teams, got team=%q ok=%v", team, ok)
	}
	team, ok = resolveInventoryTeamFilter("platform-team", visible)
	if !ok || team != "platform-team" {
		t.Fatalf("expected platform-team filter, got %q ok=%v", team, ok)
	}
	_, ok = resolveInventoryTeamFilter("finance-team", visible)
	if ok {
		t.Fatal("expected forbidden team filter")
	}
}

func TestValidateCloudAccountCredentialsAWS(t *testing.T) {
	err := validateCloudAccountCredentials("aws", "111122223333", "assume_role", "arn:aws:iam::999988887777:role/X", "", "")
	if err == nil {
		t.Fatal("expected account mismatch error")
	}
}

func TestGCPCloudAccountValidation(t *testing.T) {
	item := &cloudAccountRecord{Provider: "gcp", AccountID: "my-platform-prod"}
	creds := &cloudAccountCredentials{
		AuthMode: "assume_role",
		RoleARN:  "inventory@my-platform-prod.iam.gserviceaccount.com",
	}
	if err := testGCPCloudAccount(item, creds); err != nil {
		t.Fatalf("expected valid gcp config, got %v", err)
	}
}

type testError struct{ s string }

func (e *testError) Error() string { return e.s }
