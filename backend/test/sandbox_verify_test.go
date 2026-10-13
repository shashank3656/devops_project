package main

import "testing"

func TestSandboxDemoRowsAreNotProvisioned(t *testing.T) {
	rendered, err := renderCloudStorageTemplate("asia-east2", "setuops-terraform-dev", "STANDARD")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	observed := []sandboxResource{
		{ResourceID: "i-0a1b2c3d4e5f67890", Region: "us-east-1", DisplayName: "api-gateway-1"},
		{ResourceID: "db-platform-prod", Region: "us-east-1", DisplayName: "platform-db"},
		{ResourceID: "setuops-artifacts-uat", Region: "us-east-1", DisplayName: "artifacts-uat"},
		{ResourceID: "arn:aws:eks:us-west-2:444455556666:cluster/dev", Region: "us-west-2", DisplayName: "dev-cluster"},
		{ResourceID: "arn:aws:lambda:us-west-2:444455556666:function:webhook-relay", Region: "us-west-2", DisplayName: "webhook-relay"},
	}
	provisioned := false
	result, err := verifySandboxProvision("sandbox", rendered, "asia-east2", "setuops-terraform-dev", "9c7c3a7a", observed)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result.Status == "provisioned" {
		provisioned = true
	}
	if provisioned || result.Status != "unavailable" || result.Reason != "no sandbox resource observed" {
		t.Fatalf("demo inventory must not count as a sandbox resource: %+v", result)
	}
	if result.Region != "asia-east2" || result.Bucket != "setuops-terraform-dev" || result.Revision != "9c7c3a7a" {
		t.Fatalf("verification dropped the request: %+v", result)
	}
}

func TestSandboxMatchingResourceIsProvisioned(t *testing.T) {
	rendered, err := renderCloudStorageTemplate("asia-east2", "setuops-terraform-dev", "STANDARD")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	result, err := verifySandboxProvision("sandbox", rendered, "asia-east2", "setuops-terraform-dev", "9c7c3a7a", []sandboxResource{
		{ResourceID: "b/setuops-terraform-dev", Region: "asia-east2", DisplayName: "setuops-terraform-dev"},
	})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result.Status != "provisioned" {
		t.Fatalf("status = %s", result.Status)
	}
}

func TestSandboxRequestRecordsUnavailable(t *testing.T) {
	payload := InfraRequest{
		"env":          "sandbox",
		"template_key": supportedTemplateKey,
		"config": map[string]interface{}{
			"region":        "asia-east2",
			"bucket_name":   "setuops-terraform-dev",
			"storage_class": "STANDARD",
		},
	}
	if err := applyTemplateRender(payload); err != nil {
		t.Fatalf("render: %v", err)
	}
	observed := []sandboxResource{
		{ResourceID: "i-0a1b2c3d4e5f67890", Region: "us-east-1", DisplayName: "api-gateway-1"},
		{ResourceID: "setuops-artifacts-uat", Region: "us-east-1", DisplayName: "artifacts-uat"},
	}
	if err := recordSandboxVerification(payload, "9c7c3a7a", observed); err != nil {
		t.Fatalf("record: %v", err)
	}
	result, ok := payload["sandbox_verification"].(sandboxVerification)
	if !ok || result.Status != "unavailable" {
		t.Fatalf("verification = %#v", payload["sandbox_verification"])
	}
}

func TestSandboxRejectsOtherEnvironments(t *testing.T) {
	rendered, err := renderCloudStorageTemplate("asia-east2", "setuops-terraform-dev", "STANDARD")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if _, err := verifySandboxProvision("prod", rendered, "asia-east2", "setuops-terraform-dev", "9c7c3a7a", nil); err == nil {
		t.Fatal("prod must not be recorded as a sandbox provision")
	}
}
