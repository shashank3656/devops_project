package main

import (
	"fmt"
	"strings"
)

var demoCloudResourceIDs = map[string]bool{
	"i-0a1b2c3d4e5f67890":                                          true,
	"db-platform-prod":                                             true,
	"setuops-artifacts-uat":                                        true,
	"arn:aws:eks:us-west-2:444455556666:cluster/dev":               true,
	"arn:aws:lambda:us-west-2:444455556666:function:webhook-relay": true,
}

type sandboxResource struct {
	ResourceID  string
	Region      string
	DisplayName string
}

type sandboxVerification struct {
	Status   string
	Reason   string
	Region   string
	Bucket   string
	Revision string
}

func verifySandboxProvision(environment, rendered, region, bucket, revision string, observed []sandboxResource) (sandboxVerification, error) {
	if !strings.EqualFold(strings.TrimSpace(environment), "sandbox") {
		return sandboxVerification{}, fmt.Errorf("sandbox environment is required")
	}
	region = strings.TrimSpace(region)
	bucket = strings.TrimSpace(bucket)
	if region == "" || bucket == "" {
		return sandboxVerification{}, fmt.Errorf("region and bucket_name are required")
	}
	if !strings.Contains(rendered, region) || !strings.Contains(rendered, bucket) {
		return sandboxVerification{}, fmt.Errorf("rendered terraform does not keep the approved inputs")
	}
	result := sandboxVerification{
		Status:   "unavailable",
		Reason:   "no sandbox resource observed",
		Region:   region,
		Bucket:   bucket,
		Revision: revision,
	}
	for _, item := range observed {
		if demoCloudResourceIDs[strings.TrimSpace(item.ResourceID)] {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(item.DisplayName), bucket) && strings.EqualFold(strings.TrimSpace(item.Region), region) {
			result.Status = "provisioned"
			result.Reason = "matching resource " + strings.TrimSpace(item.ResourceID)
			return result, nil
		}
	}
	return result, nil
}

func recordSandboxVerification(payload InfraRequest, revision string, observed []sandboxResource) error {
	if payload == nil || !strings.EqualFold(strings.TrimSpace(stringValue(payload["env"])), "sandbox") {
		return nil
	}
	if strings.TrimSpace(stringValue(payload["template_key"])) == "" {
		return nil
	}
	config := map[string]interface{}{}
	if raw, ok := payload["config"].(map[string]interface{}); ok && raw != nil {
		config = raw
	}
	rendered, _ := payload["rendered_terraform"].(string)
	result, err := verifySandboxProvision(
		"sandbox",
		rendered,
		firstNonEmpty(stringValue(config["region"]), stringValue(payload["region"])),
		firstNonEmpty(stringValue(config["bucket_name"]), stringValue(payload["bucket_name"])),
		revision,
		observed,
	)
	if err != nil {
		return err
	}
	payload["sandbox_verification"] = result
	return nil
}

func listSandboxObservations() []sandboxResource {
	if DB == nil {
		return nil
	}
	rows, err := DB.Query(`SELECT COALESCE(resource_id,''), COALESCE(region,''), COALESCE(display_name,'') FROM cloud_resources`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []sandboxResource{}
	for rows.Next() {
		var item sandboxResource
		if err := rows.Scan(&item.ResourceID, &item.Region, &item.DisplayName); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}
