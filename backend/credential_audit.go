package main

import (
	"strings"
)

// credentialTypes we detect in request config
var credentialPatterns = []struct {
	pattern string
	cloud   string
	label   string
}{
	{"aws_iam_access_key", "AWS", "IAM Access Key"},
	{"aws_iam_user", "AWS", "IAM User"},
	{"aws_iam_user_login_profile", "AWS", "IAM User Login"},
	{"google_service_account_key", "GCP", "Service Account Key"},
	{"google_service_account", "GCP", "Service Account"},
	{"azurerm_user_assigned_identity", "Azure", "User Assigned Identity"},
}

// LogCredentialAuditFromConfig parses request config and logs credential creation events.
// Called when a request is approved and PR is created (admin or devops).
func LogCredentialAuditFromConfig(requestID int, team, env, cloud, config string, createdByUserID *int, approvedByUserID *int) {
	if DB == nil || config == "" {
		return
	}
	configLower := strings.ToLower(config)
	for _, p := range credentialPatterns {
		if strings.Contains(configLower, strings.ToLower(p.pattern)) {
			// Use request's cloud if set, else inferred from credential type
			c := cloud
			if c == "" {
				c = p.cloud
			}
			_ = InsertCredentialAuditLog(requestID, c, p.label, team, env, createdByUserID, approvedByUserID)
		}
	}
}
