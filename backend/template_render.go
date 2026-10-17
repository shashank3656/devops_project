package main

import (
	"fmt"
	"strings"
)

const supportedTemplateKey = "gcp/cloud-storage"

func templateContractKey(cloud, service string) string {
	service = normalizeRequestServiceKey(cloud, service)
	if service == "" {
		service = strings.TrimSpace(service)
	}
	return strings.ToLower(strings.TrimSpace(cloud)) + "/" + service
}

func applyTemplateRender(payload InfraRequest) error {
	if payload == nil {
		return nil
	}
	key := strings.TrimSpace(stringValue(payload["template_key"]))
	if key == "" {
		return nil
	}
	if key != supportedTemplateKey {
		return fmt.Errorf("unsupported template %s", key)
	}
	config := map[string]interface{}{}
	if raw, ok := payload["config"].(map[string]interface{}); ok && raw != nil {
		config = raw
	}
	rendered, err := renderCloudStorageTemplate(
		firstNonEmpty(stringValue(config["region"]), stringValue(payload["region"])),
		firstNonEmpty(stringValue(config["bucket_name"]), stringValue(payload["bucket_name"])),
		stringValue(config["storage_class"]),
	)
	if err != nil {
		return err
	}
	payload["rendered_terraform"] = rendered
	return nil
}

func renderCloudStorageTemplate(region, bucketName, storageClass string) (string, error) {
	region = strings.TrimSpace(region)
	bucketName = strings.TrimSpace(bucketName)
	storageClass = strings.TrimSpace(storageClass)
	if region == "" {
		return "", fmt.Errorf("region is required")
	}
	if bucketName == "" {
		return "", fmt.Errorf("bucket_name is required")
	}
	lines := []string{
		`resource "google_storage_bucket" "request" {`,
		"  name     = " + hclString(bucketName),
		"  location = " + hclString(region),
	}
	if storageClass != "" {
		lines = append(lines, "  storage_class = "+hclString(storageClass))
	}
	lines = append(lines, "}")
	return strings.Join(lines, "\n") + "\n", nil
}

func hclString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", "")
	return `"` + value + `"`
}
