package main

import "strings"
import "testing"

func TestSupportedTemplateKeepsRegionAndBucket(t *testing.T) {
	payload := InfraRequest{
		"template_key": supportedTemplateKey,
		"cloud":        "gcp",
		"service":      "storage",
		"config": map[string]interface{}{
			"region":        "asia-east2",
			"bucket_name":   "setuops-terraform-dev",
			"storage_class": "STANDARD",
		},
	}
	if err := applyTemplateRender(payload); err != nil {
		t.Fatalf("render: %v", err)
	}
	rendered, _ := payload["rendered_terraform"].(string)
	for _, want := range []string{"asia-east2", "setuops-terraform-dev", "STANDARD"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered terraform missing %q:\n%s", want, rendered)
		}
	}
	if templateContractKey("gcp", "storage") != supportedTemplateKey {
		t.Fatalf("contract key = %s", templateContractKey("gcp", "storage"))
	}
}

func TestUnsupportedTemplateIsNotSubmitted(t *testing.T) {
	payload := InfraRequest{"template_key": "aws/eks", "region": "us-east-1", "bucket_name": "other"}
	saved := false
	err := applyTemplateRender(payload)
	if err == nil {
		saved = true
	}
	if err == nil || !strings.Contains(err.Error(), "unsupported template") {
		t.Fatalf("err = %v", err)
	}
	if saved || payload["rendered_terraform"] != nil {
		t.Fatal("unsupported template must not render or save")
	}
}

func TestSupportedTemplateRequiresRegion(t *testing.T) {
	payload := InfraRequest{
		"template_key": supportedTemplateKey,
		"config":       map[string]interface{}{"bucket_name": "setuops-terraform-dev"},
	}
	if err := applyTemplateRender(payload); err == nil || !strings.Contains(err.Error(), "region") {
		t.Fatalf("err = %v", err)
	}
	if payload["rendered_terraform"] != nil {
		t.Fatal("incomplete template must not render")
	}
}
