package main

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	iamPolicyVersion      = "prod-access-2026.10.1"
	iamAzureSecretsUser   = "4633458b-17de-408a-b874-0445c86b69e6"
	iamAzureSecretsReader = "21090545-7ca7-4776-b22c-e363652d74d2"
	iamAzureMonitorReader = "43d0d8ad-25c7-4714-9337-8ba259a9fe05"
	iamReferenceVaultID   = "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-platform-prod/providers/Microsoft.KeyVault/vaults/kv-platform-prod"
	iamReferenceAccountID = "11111111-2222-3333-4444-555555555555"
	iamReferencePrincipal = "00000000-1111-2222-3333-444444444444"
	iamEvalTTL            = 10 * time.Minute
)

var iamSecretPaste = regexp.MustCompile(`(?i)(password|secret|accountkey)\s*[:=]\s*\S+`)

type iamTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type iamPrincipal struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	TeamID   string `json:"teamId"`
	Kind     string `json:"kind"`
	Verified bool   `json:"verified"`
}

type iamAccount struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Name     string `json:"name"`
	TeamID   string `json:"teamId"`
}

type iamResource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Provider    string `json:"provider"`
	TeamID      string `json:"teamId"`
	AccountID   string `json:"cloudAccountId"`
	Environment string `json:"environment"`
	Type        string `json:"type"`
	Owner       string `json:"owner"`
	AuthMode    string `json:"authorizationModel"`
	PIMEligible bool   `json:"pimEligible"`
}

type iamEvaluateInput struct {
	Provider        string   `json:"provider"`
	TeamID          string   `json:"teamId"`
	PrincipalID     string   `json:"principalId"`
	CloudAccountID  string   `json:"cloudAccountId"`
	ResourceID      string   `json:"resourceId"`
	Environment     string   `json:"environment"`
	ScopeKind       string   `json:"scopeKind"`
	Service         string   `json:"service"`
	Services        []string `json:"services"`
	ProjectID       string   `json:"projectId"`
	Action          string   `json:"action"`
	Permissions     []string `json:"permissions"`
	StartsAt        string   `json:"startsAt"`
	EndsAt          string   `json:"endsAt"`
	DurationMinutes int      `json:"durationMinutes"`
	TicketRef       string   `json:"ticketRef"`
	Justification   string   `json:"justification"`
	CloudMember     string   `json:"cloudMember,omitempty"`
}

type iamEvaluation struct {
	EvaluationID            string           `json:"evaluationId"`
	ExpiresAt               time.Time        `json:"expiresAt"`
	PolicyVersion           string           `json:"policyVersion"`
	Decision                string           `json:"decision"`
	Risk                    string           `json:"risk"`
	RoleID                  string           `json:"roleId,omitempty"`
	RoleName                string           `json:"roleName,omitempty"`
	NormalizedScope         string           `json:"normalizedScope,omitempty"`
	ApprovalStages          []string         `json:"approvalStages"`
	ProvisioningMode        string           `json:"provisioningMode"`
	EffectiveExistingAccess bool             `json:"effectiveExistingAccess"`
	Warnings                []string         `json:"warnings"`
	Reason                  string           `json:"reason,omitempty"`
	Input                   iamEvaluateInput `json:"request"`
}

func iamCatalogTeams() []iamTeam {
	return []iamTeam{{ID: "team-platform", Name: "Platform"}, {ID: "team-other", Name: "Other"}}
}

func iamCatalogPrincipals() []iamPrincipal {
	return []iamPrincipal{
		{ID: iamReferencePrincipal, Name: "Platform operator", TeamID: "team-platform", Kind: "user", Verified: true},
		{ID: "22222222-3333-4444-5555-666666666666", Name: "Unverified operator", TeamID: "team-platform", Kind: "user", Verified: false},
		{ID: "33333333-4444-5555-6666-777777777777", Name: "Other team operator", TeamID: "team-other", Kind: "user", Verified: true},
	}
}

func iamCatalogAccounts() []iamAccount {
	return []iamAccount{{
		ID: iamReferenceAccountID, Provider: "AZURE", Name: "Platform production", TeamID: "team-platform",
	}}
}

func iamCatalogResources() []iamResource {
	return []iamResource{
		{
			ID: iamReferenceVaultID, Name: "kv-platform-prod", Provider: "AZURE", TeamID: "team-platform",
			AccountID: iamReferenceAccountID, Environment: "PROD", Type: "key_vault", Owner: "team-platform",
			AuthMode: "rbac", PIMEligible: true,
		},
		{
			ID: "/subscriptions/" + iamReferenceAccountID, Name: "Platform subscription", Provider: "AZURE",
			TeamID: "team-platform", AccountID: iamReferenceAccountID, Environment: "PROD", Type: "subscription",
			Owner: "team-platform", AuthMode: "rbac", PIMEligible: false,
		},
		{
			ID:   "/subscriptions/" + iamReferenceAccountID + "/resourceGroups/rg-platform-prod",
			Name: "rg-platform-prod", Provider: "AZURE", TeamID: "team-platform", AccountID: iamReferenceAccountID,
			Environment: "PROD", Type: "resource_group", Owner: "team-platform", AuthMode: "rbac", PIMEligible: false,
		},
		{
			ID:   "/subscriptions/" + iamReferenceAccountID + "/resourceGroups/rg-other-prod/providers/Microsoft.KeyVault/vaults/kv-other-prod",
			Name: "kv-other-prod", Provider: "AZURE", TeamID: "team-other", AccountID: iamReferenceAccountID,
			Environment: "PROD", Type: "key_vault", Owner: "team-other", AuthMode: "rbac", PIMEligible: true,
		},
	}
}

func iamFindPrincipal(id string) (iamPrincipal, bool) {
	for _, item := range iamCatalogPrincipals() {
		if item.ID == id {
			return item, true
		}
	}
	return iamPrincipal{}, false
}

func iamFindResource(id string) (iamResource, bool) {
	for _, item := range iamCatalogResources() {
		if item.ID == id {
			return item, true
		}
	}
	return iamResource{}, false
}

func iamPermissionRisk(role, environment string) string {
	value := strings.ToLower(strings.TrimSpace(role))
	broad := strings.Contains(value, "owner") ||
		strings.Contains(value, "contributor") ||
		strings.Contains(value, "administrator") ||
		strings.Contains(value, "fullaccess") ||
		strings.Contains(value, ".admin") ||
		strings.Contains(value, "clusteradmin") ||
		strings.HasSuffix(value, " admin") ||
		value == "roles/editor" ||
		value == "poweruseraccess"
	if broad {
		return "HIGH"
	}
	read := strings.Contains(value, "viewer") ||
		strings.Contains(value, "reader") ||
		strings.Contains(value, "readonly") ||
		strings.Contains(value, "securityaudit") ||
		strings.Contains(value, "securityreviewer")
	if read {
		if environment == "PROD" || environment == "PRODUCTION" {
			return "MEDIUM"
		}
		return "LOW"
	}
	return "MEDIUM"
}

func iamWindowMinutes(start, end string) (int, string) {
	parse := func(value string) (time.Time, bool) {
		value = strings.TrimSpace(value)
		if value == "" {
			return time.Time{}, false
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02T15:04:05"} {
			if parsed, err := time.Parse(layout, value); err == nil {
				return parsed, true
			}
		}
		return time.Time{}, false
	}
	starts, okStart := parse(start)
	ends, okEnd := parse(end)
	if !okStart || !okEnd {
		return 0, "start time and end time are required"
	}
	if !ends.After(starts) {
		return 0, "end time must be after the start time"
	}
	minutes := int(ends.Sub(starts).Minutes())
	if minutes > 90*24*60 {
		return 0, "access cannot be longer than 90 days"
	}
	return minutes, ""
}

func iamDurationCap(risk string) int {
	switch risk {
	case "LOW":
		return 24 * 60
	case "MEDIUM":
		return 8 * 60
	case "HIGH":
		return 4 * 60
	default:
		return 0
	}
}

func iamContainsSecretPaste(text string) bool {
	return iamSecretPaste.MatchString(text)
}

func iamVersionHash(principal, scope, role string, minutes int, justification string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		iamPolicyVersion, principal, scope, role, strconv.Itoa(minutes), justification,
	}, "|")))
	return hex.EncodeToString(sum[:])
}

func evaluateIAMAccess(in iamEvaluateInput, now time.Time, alreadyActive bool) iamEvaluation {
	in.Provider = strings.ToUpper(strings.TrimSpace(in.Provider))
	in.Environment = strings.ToUpper(strings.TrimSpace(in.Environment))
	in.ScopeKind = strings.ToUpper(strings.TrimSpace(in.ScopeKind))
	if len(in.Services) > 0 {
		in.Service = strings.Join(in.Services, ", ")
	}
	if len(in.Permissions) > 0 {
		in.Action = strings.Join(in.Permissions, ", ")
	}
	rawAction := strings.TrimSpace(in.Action)
	actionKey := strings.ToUpper(rawAction)
	in.Action = rawAction
	in.Service = strings.TrimSpace(in.Service)
	in.TeamID = strings.TrimSpace(in.TeamID)
	in.PrincipalID = strings.TrimSpace(in.PrincipalID)
	in.ResourceID = strings.TrimSpace(in.ResourceID)
	in.TicketRef = strings.TrimSpace(in.TicketRef)
	in.Justification = strings.TrimSpace(in.Justification)

	out := iamEvaluation{
		EvaluationID:     newIAMID(),
		ExpiresAt:        now.Add(iamEvalTTL),
		PolicyVersion:    iamPolicyVersion,
		Decision:         "DENY",
		ProvisioningMode: "NONE",
		ApprovalStages:   []string{},
		Warnings:         []string{},
		Input:            in,
	}
	deny := func(reason string) iamEvaluation {
		out.Decision = "DENY"
		out.Reason = reason
		out.Risk = "CRITICAL"
		return out
	}
	if iamContainsSecretPaste(in.Justification) || iamContainsSecretPaste(in.TicketRef) {
		return deny("justification must not include a secret value")
	}
	if strings.Contains(strings.ToLower(in.ResourceID), "/secrets/") {
		return deny("object-level secret scope is not a supported just-in-time path")
	}
	if in.Provider != "AZURE" && in.Provider != "AWS" && in.Provider != "GCP" {
		return deny("provider is not supported")
	}
	if in.Service == "" {
		return deny("service is required")
	}
	principal, ok := iamFindPrincipal(in.PrincipalID)
	if !ok || !principal.Verified {
		return deny("principal is missing or not verified")
	}
	if principal.TeamID != in.TeamID {
		return deny("principal is outside the selected team")
	}
	if actionKey == "READ" || actionKey == "DEVELOPER" || actionKey == "ADMIN" || (rawAction != "" && actionKey != "READ_SECRET_VALUE" && actionKey != "READ_SECRET_METADATA" && actionKey != "VIEW_MONITORING") {
		if in.Environment == "" {
			return deny("environment is required")
		}
		if in.StartsAt != "" || in.EndsAt != "" || len(in.Permissions) > 0 {
			minutes, msg := iamWindowMinutes(in.StartsAt, in.EndsAt)
			if msg != "" {
				return deny(msg)
			}
			in.DurationMinutes = minutes
		}
		label, risk := "Read", "LOW"
		if in.Environment == "PROD" || in.Environment == "PRODUCTION" {
			risk = "MEDIUM"
		}
		roleName := in.Service + " " + label
		cap := iamDurationCap(risk)
		switch actionKey {
		case "DEVELOPER":
			label, risk = "Developer", "MEDIUM"
			roleName = in.Service + " " + label
			cap = iamDurationCap(risk)
		case "ADMIN":
			label, risk = "Admin", "HIGH"
			roleName = in.Service + " " + label
			cap = iamDurationCap(risk)
		case "READ":
		default:
			roleName = rawAction
			if len(in.Permissions) > 0 {
				risk = "LOW"
				for _, permission := range in.Permissions {
					next := iamPermissionRisk(permission, in.Environment)
					if next == "HIGH" || (next == "MEDIUM" && risk == "LOW") {
						risk = next
					}
				}
			} else {
				risk = iamPermissionRisk(rawAction, in.Environment)
			}
			cap = 90 * 24 * 60
		}
		if in.DurationMinutes <= 0 || in.DurationMinutes > cap {
			if cap == 90*24*60 {
				return deny("access cannot be longer than 90 days")
			}
			return deny("duration exceeds the policy cap for this risk")
		}
		if risk == "HIGH" && (in.TicketRef == "" || len(in.Justification) < 12) {
			return deny("high-risk access needs a ticket reference and a business justification")
		}
		out.Risk = risk
		out.RoleName = roleName
		out.NormalizedScope = strings.ToLower(in.Provider) + ":" + in.Service
		out.Decision = "ALLOW_WITH_APPROVAL"
		out.ProvisioningMode = "AFTER_DEVOPS_APPROVAL"
		out.ApprovalStages = []string{"DEVOPS"}
		out.Warnings = append(out.Warnings, "Submitting opens an access request. After the DevOps team approves, the backend records the grant.")
		return out
	}
	in.Action = actionKey
	resource, ok := iamFindResource(in.ResourceID)
	if !ok {
		return deny("resource is not in the authorized inventory")
	}
	if resource.Owner == "" {
		return deny("production target has no accountable owner")
	}
	if resource.TeamID != in.TeamID || resource.Owner != in.TeamID {
		return deny("resource belongs to another team")
	}
	if resource.Provider != in.Provider || resource.AccountID != strings.TrimSpace(in.CloudAccountID) {
		return deny("cloud account does not match the resource")
	}
	if resource.Environment != in.Environment {
		return deny("environment does not match inventory metadata")
	}
	if in.Action == "READ_SECRET_VALUE" && (in.ScopeKind == "SUBSCRIPTION" || in.ScopeKind == "RESOURCE_GROUP" || resource.Type == "subscription" || resource.Type == "resource_group") {
		return deny("self-service cannot grant secret read on a subscription or resource group")
	}
	if resource.Type == "key_vault" && resource.AuthMode != "rbac" {
		return deny("key vault is not using Azure RBAC; access-policy mode is a separate migration")
	}

	roleID, roleName, risk := "", "", "MEDIUM"
	switch in.Action {
	case "READ_SECRET_VALUE":
		if resource.Type != "key_vault" {
			return deny("secret read is only available on a named vault")
		}
		roleID, roleName, risk = iamAzureSecretsUser, "Key Vault Secrets User", "HIGH"
	case "READ_SECRET_METADATA":
		if resource.Type != "key_vault" {
			return deny("secret metadata read is only available on a named vault")
		}
		roleID, roleName, risk = iamAzureSecretsReader, "Key Vault Reader", "MEDIUM"
	case "VIEW_MONITORING":
		roleID, roleName = iamAzureMonitorReader, "Monitoring Reader"
		if in.Environment == "PROD" {
			risk = "MEDIUM"
		} else {
			risk = "LOW"
		}
	default:
		return deny("action is not in the role catalog")
	}
	if strings.EqualFold(roleName, "Owner") || strings.EqualFold(roleName, "Contributor") {
		return deny("owner and contributor are outside self-service")
	}
	cap := iamDurationCap(risk)
	if in.DurationMinutes <= 0 || in.DurationMinutes > cap {
		return deny("duration exceeds the policy cap for this risk")
	}
	if risk == "HIGH" && (in.TicketRef == "" || len(in.Justification) < 12) {
		return deny("high-risk access needs a ticket reference and a business justification")
	}
	out.Risk = risk
	out.RoleID = roleID
	out.RoleName = roleName
	out.NormalizedScope = resource.ID
	out.EffectiveExistingAccess = alreadyActive
	if alreadyActive {
		out.Decision = "ALREADY_HAS_ACCESS"
		out.Reason = "an existing provider-verified grant already covers this access"
		out.ProvisioningMode = "NONE"
		return out
	}
	if !resource.PIMEligible {
		out.Decision = "REQUIRE_ELIGIBILITY"
		out.ProvisioningMode = "AFTER_DEVOPS_APPROVAL"
		out.ApprovalStages = []string{"DEVOPS"}
		out.Warnings = append(out.Warnings, "The DevOps team approves this. The backend records the grant. Secret values are not read.")
		return out
	}
	out.Decision = "ALLOW_WITH_APPROVAL"
	out.ProvisioningMode = "AFTER_DEVOPS_APPROVAL"
	out.ApprovalStages = []string{"DEVOPS"}
	if risk == "HIGH" {
		out.Warnings = append(out.Warnings, "Production secrets are sensitive. This portal does not read secret values.")
	}
	out.Warnings = append(out.Warnings, "Submitting opens an access request. After the DevOps team approves, the backend records the grant.")
	return out
}
