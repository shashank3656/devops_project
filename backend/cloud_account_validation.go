package main

import (
	"fmt"
	"net/http"
	"strings"
)

func validateCloudAccountCredentials(provider, accountID, authMode, roleARN, externalID, secretRef string) error {
	provider = normalizeCloudProvider(provider)
	authMode = normalizeCloudAccountAuthMode(authMode)
	accountID = strings.TrimSpace(accountID)
	roleARN = strings.TrimSpace(roleARN)
	externalID = strings.TrimSpace(externalID)
	secretRef = strings.TrimSpace(secretRef)

	if accountID == "" {
		return fmt.Errorf("account_id is required")
	}
	if authMode == "assume_role" && roleARN == "" {
		switch provider {
		case "aws":
			return fmt.Errorf("role_arn is required for AWS role assumption")
		case "azure":
			return fmt.Errorf("role_arn is required for Azure federated access")
		case "gcp":
			return fmt.Errorf("role_arn is required for GCP service account impersonation")
		default:
			return fmt.Errorf("role_arn is required")
		}
	}
	if authMode == "assume_role" && provider == "aws" && roleARN != "" {
		if arnAcct := awsAccountIDFromRoleARN(roleARN); arnAcct != "" && arnAcct != accountID {
			return fmt.Errorf("role_arn account must match account_id")
		}
	}
	if authMode == "assume_role" && provider == "azure" && !azureSubscriptionID.MatchString(accountID) {
		return fmt.Errorf("account_id must be a valid Azure subscription GUID")
	}
	if authMode == "assume_role" && provider == "gcp" && !gcpProjectID.MatchString(accountID) {
		return fmt.Errorf("account_id must be a valid GCP project ID")
	}
	if authMode == "static_ref" && secretRef == "" {
		return fmt.Errorf("secret_ref is required for static_ref mode")
	}
	return nil
}

func writeCloudAccountValidationError(w http.ResponseWriter, r *http.Request, err error) {
	if err == nil {
		return
	}
	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(msg, "role_arn"):
		writeAPIError(w, r, http.StatusBadRequest, msg, err)
	case strings.Contains(msg, "account_id"):
		writeAPIError(w, r, http.StatusBadRequest, msg, err)
	case strings.Contains(msg, "secret_ref"):
		writeAPIError(w, r, http.StatusBadRequest, msg, err)
	default:
		writeAPIError(w, r, http.StatusBadRequest, msg, err)
	}
}
