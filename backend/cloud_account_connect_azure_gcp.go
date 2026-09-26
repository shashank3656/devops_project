package main

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	azureSubscriptionID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	azureTenantID       = azureSubscriptionID
	gcpProjectID        = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	gcpServiceAccount   = regexp.MustCompile(`^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$`)
)

func testAzureCloudAccount(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	subscription := ""
	if item != nil {
		subscription = strings.TrimSpace(item.AccountID)
	}
	if subscription == "" {
		return fmt.Errorf("subscription ID is not configured")
	}
	if !azureSubscriptionID.MatchString(subscription) {
		return fmt.Errorf("subscription ID format looks invalid")
	}
	switch normalizeCloudAccountAuthMode(creds.AuthMode) {
	case "assume_role":
		if strings.TrimSpace(creds.RoleARN) == "" {
			return fmt.Errorf("role or scope ID is not configured")
		}
		if ext := strings.TrimSpace(creds.ExternalID); ext != "" && !azureTenantID.MatchString(ext) {
			return fmt.Errorf("directory tenant ID format looks invalid")
		}
		return nil
	case "static_ref":
		return awsStaticRefConnectivityTest(subscription, creds.SecretRef)
	default:
		return fmt.Errorf("unsupported auth mode")
	}
}

func testGCPCloudAccount(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	projectID := ""
	if item != nil {
		projectID = strings.TrimSpace(item.AccountID)
	}
	if projectID == "" {
		return fmt.Errorf("project ID is not configured")
	}
	if !gcpProjectID.MatchString(projectID) {
		return fmt.Errorf("project ID format looks invalid")
	}
	switch normalizeCloudAccountAuthMode(creds.AuthMode) {
	case "assume_role":
		sa := strings.TrimSpace(creds.RoleARN)
		if sa == "" {
			return fmt.Errorf("service account email is not configured")
		}
		if !gcpServiceAccount.MatchString(sa) {
			return fmt.Errorf("service account email format looks invalid")
		}
		return nil
	case "static_ref":
		return awsStaticRefConnectivityTest(projectID, creds.SecretRef)
	default:
		return fmt.Errorf("unsupported auth mode")
	}
}
