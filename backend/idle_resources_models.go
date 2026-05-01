package main

import (
	"encoding/json"
	"strings"
	"time"
)

// SupportedClouds enumerates the cloud providers the idle-resources feature
// currently understands. Frontend dropdowns mirror this list.
var SupportedClouds = []string{"aws", "azure", "gcp"}

// SupportedAuthMethods maps cloud → list of accepted authentication methods.
// The set of methods is exposed in the onboarding wizard.
var SupportedAuthMethods = map[string][]string{
	"aws": {
		"aws_keys",
		"aws_assume_role",
		"aws_profile",
		"aws_instance_role",
	},
	"azure": {
		"azure_sp_secret",
		"azure_sp_cert",
		"azure_managed_identity",
		"azure_oidc_wif",
	},
	"gcp": {
		"gcp_sa_json",
		"gcp_wif",
		"gcp_metadata",
	},
}

// SupportedAIProviders is the closed set the user can choose from. "none"
// disables AI ranking and falls back to the heuristic ranker.
var SupportedAIProviders = []string{"none", "openai", "anthropic", "google", "bedrock", "ollama"}

// SupportedScanScopes is the master list of services (per cloud) the worker
// knows how to inspect. The UI uses these to render scope checkboxes.
var SupportedScanScopes = map[string][]string{
	"aws":   {"ec2", "ebs", "eip", "alb", "rds", "elasticache", "lambda", "natgw", "s3", "snapshots"},
	"azure": {"vm", "disk", "public_ip", "loadbalancer", "sql", "storage", "appservice"},
	"gcp":   {"compute", "disk", "address", "loadbalancer", "cloudsql", "storage"},
}

// CloudAccount is the public shape returned by the API. Credentials are NEVER
// embedded here; they live in cloud_account_secrets.
type CloudAccount struct {
	ID                int        `json:"id"`
	Name              string     `json:"name"`
	Cloud             string     `json:"cloud"`
	AuthMethod        string     `json:"auth_method"`
	DefaultRegions    []string   `json:"default_regions"`
	DefaultCurrency   string     `json:"default_currency"`
	RetentionDays     *int       `json:"retention_days,omitempty"`
	AIProvider        string     `json:"ai_provider,omitempty"`
	AIModel           string     `json:"ai_model,omitempty"`
	Status            string     `json:"status"`
	LastTestAt        *time.Time `json:"last_test_at,omitempty"`
	LastTestStatus    string     `json:"last_test_status,omitempty"`
	LastTestMessage   string     `json:"last_test_message,omitempty"`
	LastScanID        *int       `json:"last_scan_id,omitempty"`
	LastScanAt        *time.Time `json:"last_scan_at,omitempty"`
	CreatedBy         *int       `json:"created_by,omitempty"`
	CreatedByUsername string     `json:"created_by_username,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// IdleScan is the audit-grade header for a single scan execution. Detailed
// per-resource rows live in IdleResource.
type IdleScan struct {
	ID                int             `json:"id"`
	AccountID         int             `json:"account_id"`
	AccountName       string          `json:"account_name,omitempty"`
	Cloud             string          `json:"cloud"`
	Regions           []string        `json:"regions"`
	Scope             []string        `json:"scope"`
	Thresholds        json.RawMessage `json:"thresholds"`
	AIProvider        string          `json:"ai_provider,omitempty"`
	AIModel           string          `json:"ai_model,omitempty"`
	Status            string          `json:"status"`
	Progress          json.RawMessage `json:"progress"`
	Totals            json.RawMessage `json:"totals"`
	ErrorLog          json.RawMessage `json:"error_log"`
	ErrorMessage      string          `json:"error_message,omitempty"`
	RawArtifactURL    string          `json:"raw_artifact_url,omitempty"`
	TriggeredBy       *int            `json:"triggered_by,omitempty"`
	TriggeredUsername string          `json:"triggered_by_username,omitempty"`
	StartedAt         *time.Time      `json:"started_at,omitempty"`
	FinishedAt        *time.Time      `json:"finished_at,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// IdleResource represents one detected idle/under-utilised cloud resource.
type IdleResource struct {
	ID               int64             `json:"id"`
	ScanID           int               `json:"scan_id"`
	AccountID        int               `json:"account_id"`
	Cloud            string            `json:"cloud"`
	Service          string            `json:"service"`
	Region           string            `json:"region"`
	ResourceID       string            `json:"resource_id"`
	Name             string            `json:"name"`
	Tags             map[string]string `json:"tags"`
	State            string            `json:"state"`
	CreatedAtRemote  *time.Time        `json:"created_at_remote,omitempty"`
	Metrics          map[string]any    `json:"metrics"`
	CostEstimateUSD  float64           `json:"cost_estimate_usd"`
	Reason           string            `json:"reason"`
	Severity         string            `json:"severity"`
	ConsoleURL       string            `json:"console_url,omitempty"`
	AIRank           *int              `json:"ai_rank,omitempty"`
	AIRecommendation string            `json:"ai_recommendation,omitempty"`
	AIConfidence     *float64          `json:"ai_confidence,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
}

// IdleSettings is the singleton row that controls retention and AI defaults.
type IdleSettings struct {
	RetentionDays     int    `json:"retention_days"`
	PurgeRawArtifacts bool   `json:"purge_raw_artifacts"`
	PurgeResources    bool   `json:"purge_resources"`
	DefaultAIProvider string `json:"default_ai_provider"`
	DefaultAIModel    string `json:"default_ai_model"`
}

// CloudCredentials is the wire shape the UI sends when creating/updating an
// account. Only fields relevant to the chosen auth_method need to be set; the
// rest are ignored. The struct is encrypted-at-rest as a JSON blob.
type CloudCredentials struct {
	AuthMethod string `json:"auth_method"`

	// AWS
	AWSAccessKeyID     string `json:"aws_access_key_id,omitempty"`
	AWSSecretAccessKey string `json:"aws_secret_access_key,omitempty"`
	AWSSessionToken    string `json:"aws_session_token,omitempty"`
	AWSRoleARN         string `json:"aws_role_arn,omitempty"`
	AWSExternalID      string `json:"aws_external_id,omitempty"`
	AWSProfile         string `json:"aws_profile,omitempty"`

	// Azure
	AzureTenantID     string `json:"azure_tenant_id,omitempty"`
	AzureClientID     string `json:"azure_client_id,omitempty"`
	AzureClientSecret string `json:"azure_client_secret,omitempty"`
	AzureClientCert   string `json:"azure_client_cert_pem,omitempty"`
	AzureSubscription string `json:"azure_subscription_id,omitempty"`

	// GCP
	GCPServiceAccountJSON string `json:"gcp_service_account_json,omitempty"`
	GCPProjectID          string `json:"gcp_project_id,omitempty"`
	GCPWIFConfig          string `json:"gcp_wif_config_json,omitempty"`
}

// validateForCloud sanity-checks that fields required by the chosen method are
// present. Empty strings are tolerated for instance-role / managed-identity /
// metadata flows.
func (c CloudCredentials) validateForCloud(cloud string) error {
	switch cloud {
	case "aws":
		switch c.AuthMethod {
		case "aws_keys":
			if strings.TrimSpace(c.AWSAccessKeyID) == "" || strings.TrimSpace(c.AWSSecretAccessKey) == "" {
				return errMissingField("aws_access_key_id and aws_secret_access_key are required")
			}
		case "aws_assume_role":
			if strings.TrimSpace(c.AWSRoleARN) == "" {
				return errMissingField("aws_role_arn is required")
			}
		case "aws_profile":
			if strings.TrimSpace(c.AWSProfile) == "" {
				return errMissingField("aws_profile is required")
			}
		case "aws_instance_role":
			// no input needed - uses host-attached identity
		default:
			return errMissingField("auth_method must be one of: " + strings.Join(SupportedAuthMethods["aws"], ", "))
		}
	case "azure":
		if strings.TrimSpace(c.AzureSubscription) == "" {
			return errMissingField("azure_subscription_id is required")
		}
		switch c.AuthMethod {
		case "azure_sp_secret":
			if strings.TrimSpace(c.AzureTenantID) == "" || strings.TrimSpace(c.AzureClientID) == "" || strings.TrimSpace(c.AzureClientSecret) == "" {
				return errMissingField("azure_tenant_id, azure_client_id and azure_client_secret are required")
			}
		case "azure_sp_cert":
			if strings.TrimSpace(c.AzureTenantID) == "" || strings.TrimSpace(c.AzureClientID) == "" || strings.TrimSpace(c.AzureClientCert) == "" {
				return errMissingField("azure_tenant_id, azure_client_id and azure_client_cert_pem are required")
			}
		case "azure_managed_identity", "azure_oidc_wif":
			// host identity provides the rest
		default:
			return errMissingField("auth_method must be one of: " + strings.Join(SupportedAuthMethods["azure"], ", "))
		}
	case "gcp":
		if strings.TrimSpace(c.GCPProjectID) == "" {
			return errMissingField("gcp_project_id is required")
		}
		switch c.AuthMethod {
		case "gcp_sa_json":
			if strings.TrimSpace(c.GCPServiceAccountJSON) == "" {
				return errMissingField("gcp_service_account_json is required")
			}
		case "gcp_wif":
			if strings.TrimSpace(c.GCPWIFConfig) == "" {
				return errMissingField("gcp_wif_config_json is required")
			}
		case "gcp_metadata":
			// host identity
		default:
			return errMissingField("auth_method must be one of: " + strings.Join(SupportedAuthMethods["gcp"], ", "))
		}
	default:
		return errMissingField("cloud must be aws|azure|gcp")
	}
	return nil
}

type validationError struct{ msg string }

func (e validationError) Error() string { return e.msg }
func errMissingField(msg string) error  { return validationError{msg: msg} }

func isValidationError(err error) bool {
	_, ok := err.(validationError)
	return ok
}

// containsString is a tiny helper so we can keep our slices flat instead of
// pulling in slices.Contains for early Go versions.
func containsString(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}
