package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

var awsAccountIDInRoleARN = regexp.MustCompile(`^arn:aws:iam::(\d{12}):role/`)

// awsAssumeRoleLive is overridden in tests to avoid real AWS calls.
var awsAssumeRoleLive = liveAWSAssumeRoleTest

func testCloudAccountConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	if item == nil || creds == nil {
		return fmt.Errorf("account not found")
	}
	return cloudConnectorForProvider(item.Provider).TestConnection(item, creds)
}

func testAWSCloudAccount(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	expectedAccount := ""
	if item != nil {
		expectedAccount = strings.TrimSpace(item.AccountID)
	}
	switch normalizeCloudAccountAuthMode(creds.AuthMode) {
	case "assume_role":
		return awsAssumeRoleConnectivityTest(expectedAccount, creds.RoleARN, creds.ExternalID)
	case "static_ref":
		return awsStaticRefConnectivityTest(expectedAccount, creds.SecretRef)
	default:
		return fmt.Errorf("unsupported auth mode")
	}
}

func awsAssumeRoleConnectivityTest(expectedAccountID, roleARN, externalID string) error {
	roleARN = strings.TrimSpace(roleARN)
	if roleARN == "" {
		return fmt.Errorf("role ARN is not configured")
	}
	if !strings.HasPrefix(roleARN, "arn:aws:iam::") || !strings.Contains(roleARN, ":role/") {
		return fmt.Errorf("role ARN format looks invalid")
	}
	if expectedAccountID != "" {
		if arnAccount := awsAccountIDFromRoleARN(roleARN); arnAccount != "" && arnAccount != expectedAccountID {
			return fmt.Errorf("role ARN account does not match onboarded account ID")
		}
	}
	if awsValidateOnlyMode() {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cfg, ok := awsBaseConfig(ctx)
	if !ok {
		// No host credentials: strict input validation still counts as a successful configuration check.
		return nil
	}
	if err := awsAssumeRoleLive(ctx, cfg, roleARN, externalID); err != nil {
		return sanitizeAWSTestError(err)
	}
	return nil
}

func awsStaticRefConnectivityTest(expectedAccountID, secretRef string) error {
	secretRef = strings.TrimSpace(secretRef)
	if secretRef == "" {
		return fmt.Errorf("secret reference is not configured")
	}
	raw := strings.TrimSpace(os.Getenv(secretRef))
	if raw == "" {
		return fmt.Errorf("referenced server secret is not set on the API host")
	}
	if awsValidateOnlyMode() {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cfg, err := awsConfigFromSecretRef(ctx, raw)
	if err != nil {
		return err
	}
	if err := awsGetCallerIdentity(ctx, cfg); err != nil {
		return sanitizeAWSTestError(err)
	}
	if expectedAccountID != "" {
		identity, err := awsCallerAccountID(ctx, cfg)
		if err != nil {
			return sanitizeAWSTestError(err)
		}
		if identity != "" && identity != expectedAccountID {
			return fmt.Errorf("static credentials account does not match onboarded account ID")
		}
	}
	return nil
}

func awsAccountIDFromRoleARN(roleARN string) string {
	m := awsAccountIDInRoleARN.FindStringSubmatch(strings.TrimSpace(roleARN))
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

func awsValidateOnlyMode() bool {
	return strings.EqualFold(strings.TrimSpace(firstNonEmptyEnv("OPSTRELLIS_AWS_VALIDATE_ONLY", "SETUOPS_AWS_VALIDATE_ONLY")), "true")
}

func awsBaseConfig(ctx context.Context) (aws.Config, bool) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return aws.Config{}, false
	}
	creds, err := cfg.Credentials.Retrieve(ctx)
	if err != nil || strings.TrimSpace(creds.AccessKeyID) == "" {
		if awsWorkloadRoleARN() == "" {
			return aws.Config{}, false
		}
	}
	return cfg, true
}

func awsConfigFromSecretRef(ctx context.Context, raw string) (aws.Config, error) {
	var payload struct {
		AccessKeyID     string `json:"access_key_id"`
		SecretAccessKey string `json:"secret_access_key"`
		SessionToken    string `json:"session_token"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err == nil && payload.AccessKeyID != "" && payload.SecretAccessKey != "" {
		return config.LoadDefaultConfig(ctx,
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				payload.AccessKeyID, payload.SecretAccessKey, payload.SessionToken,
			)),
		)
	}
	return aws.Config{}, fmt.Errorf("secret reference must point to JSON with access_key_id and secret_access_key")
}

func liveAWSAssumeRoleTest(ctx context.Context, baseCfg aws.Config, roleARN, externalID string) error {
	client := sts.NewFromConfig(baseCfg)
	input := &sts.AssumeRoleInput{
		RoleArn:         aws.String(roleARN),
		RoleSessionName: aws.String("opstrellis-cloud-account-test"),
		DurationSeconds: aws.Int32(900),
	}
	if strings.TrimSpace(externalID) != "" {
		input.ExternalId = aws.String(strings.TrimSpace(externalID))
	}
	out, err := client.AssumeRole(ctx, input)
	if err != nil {
		return err
	}
	if out == nil || out.Credentials == nil {
		return fmt.Errorf("assume role returned no credentials")
	}
	c := out.Credentials
	assumedCfg := baseCfg.Copy()
	assumedCfg.Credentials = credentials.NewStaticCredentialsProvider(
		aws.ToString(c.AccessKeyId),
		aws.ToString(c.SecretAccessKey),
		aws.ToString(c.SessionToken),
	)
	return awsGetCallerIdentity(ctx, assumedCfg)
}

func awsGetCallerIdentity(ctx context.Context, cfg aws.Config) error {
	_, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	return err
}

func awsCallerAccountID(ctx context.Context, cfg aws.Config) (string, error) {
	out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(aws.ToString(out.Account)), nil
}

func sanitizeAWSTestError(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "accessdenied"), strings.Contains(msg, "is not authorized"), strings.Contains(msg, "cannot assume"):
		return fmt.Errorf("Could not assume the configured role. Verify trust policy, external ID, and role ARN.")
	case strings.Contains(msg, "invalidclienttokenid"), strings.Contains(msg, "unrecognizedclientexception"), strings.Contains(msg, "security token included in the request is invalid"):
		return fmt.Errorf("Server AWS credentials are invalid or missing.")
	case strings.Contains(msg, "expiredtoken"):
		return fmt.Errorf("Server AWS credentials have expired.")
	default:
		return fmt.Errorf("AWS connection test failed. Check role trust and server credentials.")
	}
}
