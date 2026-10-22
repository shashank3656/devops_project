package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"
)

const (
	awsSTSEndpoint        = "https://sts.amazonaws.com/"
	identityExchangeKind  = "oidc_exchange"
	workloadSessionPrefix = "opstrellis-"
)

type workloadRoleExchange struct {
	Provider        string `json:"provider"`
	Cloud           string `json:"cloud,omitempty"`
	Subject         string `json:"subject"`
	Role            string `json:"role,omitempty"`
	Exchanged       bool   `json:"exchanged"`
	Reason          string `json:"reason,omitempty"`
	ExpiresAt       string `json:"expires_at,omitempty"`
	AccessKeyID     string `json:"access_key_id,omitempty"`
	SecretAccessKey string `json:"secret_access_key,omitempty"`
	SessionToken    string `json:"session_token,omitempty"`
}

var assumeWorkloadRoleFn = assumeAWSRoleWithWebIdentity

func awsWorkloadRoleARN() string {
	return strings.TrimSpace(os.Getenv("AWS_WORKLOAD_ROLE_ARN"))
}

func gcpWorkloadServiceAccount() string {
	return strings.TrimSpace(os.Getenv("GCP_WORKLOAD_SERVICE_ACCOUNT"))
}

func workloadSubjectFromClaims(provider string, claims map[string]any) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "github", "github_actions":
		if repo := strings.TrimSpace(stringFromAny(claims["repository"])); repo != "" {
			return "repo:" + repo
		}
	case "gitlab", "gitlab_ci":
		if path := strings.TrimSpace(stringFromAny(claims["project_path"])); path != "" {
			return "project:" + path
		}
	}
	return firstNonEmpty(stringFromAny(claims["sub"]), "unknown")
}

func workloadSessionName(subject string) string {
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '=' || r == ',' || r == '.' || r == '@' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, strings.TrimSpace(subject))
	cleaned = strings.Trim(cleaned, "-")
	if cleaned == "" {
		cleaned = "ci"
	}
	if len(cleaned) > 48 {
		cleaned = cleaned[:48]
	}
	return workloadSessionPrefix + cleaned
}

func (e workloadRoleExchange) persistedDetails() map[string]any {
	return map[string]any{
		"cloud":      e.Cloud,
		"role":       e.Role,
		"subject":    e.Subject,
		"exchanged":  e.Exchanged,
		"reason":     e.Reason,
		"expires_at": e.ExpiresAt,
	}
}

func persistWorkloadRoleExchange(exchange workloadRoleExchange) {
	name := firstNonEmpty(exchange.Subject, exchange.Role, "workload")
	recordIdentityFinding(identityExchangeKind, name, exchange.Provider, exchange.persistedDetails())
}

func lastWorkloadRoleExchange() map[string]any {
	for _, item := range listIdentityFindings(100) {
		if strings.EqualFold(stringFromAny(item["kind"]), identityExchangeKind) {
			return item
		}
	}
	return nil
}

func identityCatalogPayload() map[string]any {
	return map[string]any{
		"static_keys":         listStaticKeyFindings(),
		"findings":            listIdentityFindings(100),
		"last_exchange":       lastWorkloadRoleExchange(),
		"workload_role":       awsWorkloadRoleARN(),
		"gcp_service_account": gcpWorkloadServiceAccount(),
	}
}

func exchangeWorkloadCloudRole(provider, token string, claims map[string]any) workloadRoleExchange {
	out := workloadRoleExchange{
		Provider: provider,
		Subject:  workloadSubjectFromClaims(provider, claims),
	}
	awsRole := awsWorkloadRoleARN()
	gcpSA := gcpWorkloadServiceAccount()
	switch {
	case awsRole != "":
		out.Cloud = "aws"
		out.Role = awsRole
		if strings.TrimSpace(token) == "" {
			out.Reason = "OIDC token missing after verify; cloud credentials were not issued."
			persistWorkloadRoleExchange(out)
			return out
		}
		accessKey, secret, session, expires, err := assumeWorkloadRoleFn(awsRole, workloadSessionName(out.Subject), token)
		if err != nil {
			out.Reason = err.Error()
			persistWorkloadRoleExchange(out)
			return out
		}
		out.Exchanged = true
		out.AccessKeyID = accessKey
		out.SecretAccessKey = secret
		out.SessionToken = session
		out.ExpiresAt = expires
		out.Reason = "Short-lived AWS credentials returned to the CI caller only."
		persistWorkloadRoleExchange(out)
		return out
	case gcpSA != "":
		out.Cloud = "gcp"
		out.Role = gcpSA
		out.Reason = "GCP Workload Identity is recorded. OpsTrellis does not mint or store a GCP key; configure the cloud trust to this repo subject."
		persistWorkloadRoleExchange(out)
		return out
	default:
		out.Cloud = "none"
		out.Reason = "No AWS_WORKLOAD_ROLE_ARN or GCP_WORKLOAD_SERVICE_ACCOUNT configured."
		persistWorkloadRoleExchange(out)
		return out
	}
}

func assumeAWSRoleWithWebIdentity(roleARN, sessionName, webIdentityToken string) (accessKey, secret, session, expiration string, err error) {
	form := url.Values{}
	form.Set("Action", "AssumeRoleWithWebIdentity")
	form.Set("Version", "2011-06-15")
	form.Set("RoleArn", roleARN)
	form.Set("RoleSessionName", sessionName)
	form.Set("WebIdentityToken", webIdentityToken)
	form.Set("DurationSeconds", "3600")
	req, err := http.NewRequest(http.MethodPost, awsSTSEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", "", "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", "", fmt.Errorf("AWS STS request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return parseSTSAssumeRoleCredentials(body, resp.StatusCode)
}

func parseSTSAssumeRoleCredentials(body []byte, statusCode int) (accessKey, secret, session, expiration string, err error) {
	raw := string(body)
	if msg := xmlInner(raw, "Message"); msg != "" && (statusCode >= 400 || xmlInner(raw, "AccessKeyId") == "") {
		code := xmlInner(raw, "Code")
		if code != "" {
			return "", "", "", "", fmt.Errorf("AWS STS %s: %s", code, msg)
		}
		return "", "", "", "", fmt.Errorf("AWS STS: %s", msg)
	}
	accessKey = xmlInner(raw, "AccessKeyId")
	secret = xmlInner(raw, "SecretAccessKey")
	session = xmlInner(raw, "SessionToken")
	expiration = xmlInner(raw, "Expiration")
	if accessKey == "" || session == "" {
		return "", "", "", "", fmt.Errorf("AWS STS response did not include short-lived credentials")
	}
	return accessKey, secret, session, expiration, nil
}

func xmlInner(body, tag string) string {
	for _, name := range []string{tag, "aws:" + tag} {
		open := "<" + name + ">"
		close := "</" + name + ">"
		start := strings.Index(body, open)
		end := strings.Index(body, close)
		if start >= 0 && end > start {
			return strings.TrimSpace(body[start+len(open) : end])
		}
	}
	return ""
}
