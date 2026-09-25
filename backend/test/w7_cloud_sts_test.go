package main

import (
	"os"
	"strings"
	"testing"
)

func TestWorkloadSubjectFromClaims(t *testing.T) {
	if got := workloadSubjectFromClaims("github", map[string]any{"repository": "acme/api", "sub": "repo:acme/api:ref:refs/heads/main"}); got != "repo:acme/api" {
		t.Fatalf("github subject %s", got)
	}
	if got := workloadSubjectFromClaims("gitlab", map[string]any{"project_path": "acme/api", "sub": "project_path:acme/api:ref_type:branch:ref:main"}); got != "project:acme/api" {
		t.Fatalf("gitlab subject %s", got)
	}
	if got := workloadSubjectFromClaims("github", map[string]any{"sub": "repo:only/sub"}); got != "repo:only/sub" {
		t.Fatalf("fallback subject %s", got)
	}
}

func TestWorkloadSessionName(t *testing.T) {
	name := workloadSessionName("repo:acme/api")
	if !strings.HasPrefix(name, "setuops-") || strings.Contains(name, "/") {
		t.Fatalf("session %s", name)
	}
}

func TestWorkloadRoleExchangeSkipsWhenUnconfigured(t *testing.T) {
	t.Setenv("AWS_WORKLOAD_ROLE_ARN", "")
	t.Setenv("GCP_WORKLOAD_SERVICE_ACCOUNT", "")
	got := exchangeWorkloadCloudRole("github", "token", map[string]any{"repository": "acme/api"})
	if got.Exchanged {
		t.Fatal("must not exchange without a role")
	}
	if got.Subject != "repo:acme/api" || got.Cloud != "none" {
		t.Fatalf("%+v", got)
	}
	if !strings.Contains(got.Reason, "AWS_WORKLOAD_ROLE_ARN") {
		t.Fatalf("reason %s", got.Reason)
	}
}

func TestWorkloadRoleExchangeRecordsGCPWithoutSecret(t *testing.T) {
	t.Setenv("AWS_WORKLOAD_ROLE_ARN", "")
	t.Setenv("GCP_WORKLOAD_SERVICE_ACCOUNT", "ci@acme.iam.gserviceaccount.com")
	got := exchangeWorkloadCloudRole("github", "token", map[string]any{"repository": "acme/api"})
	if got.Exchanged || got.SecretAccessKey != "" || got.SessionToken != "" {
		t.Fatalf("GCP must not mint a stored key: %+v", got)
	}
	if got.Role != "ci@acme.iam.gserviceaccount.com" || got.Cloud != "gcp" {
		t.Fatalf("%+v", got)
	}
	details := got.persistedDetails()
	if _, ok := details["secret_access_key"]; ok {
		t.Fatal("persisted details must not include a secret")
	}
	if details["role"] != got.Role || details["exchanged"] != false {
		t.Fatalf("%v", details)
	}
}

func TestParseSTSAssumeRoleCredentials(t *testing.T) {
	body := []byte(`<AssumeRoleWithWebIdentityResponse>
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <AccessKeyId>ASIAEXAMPLE</AccessKeyId>
      <SecretAccessKey>not-a-real-secret</SecretAccessKey>
      <SessionToken>session-token</SessionToken>
      <Expiration>2026-09-25T12:00:00Z</Expiration>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`)
	access, secret, session, exp, err := parseSTSAssumeRoleCredentials(body, 200)
	if err != nil {
		t.Fatal(err)
	}
	if access != "ASIAEXAMPLE" || secret != "not-a-real-secret" || session != "session-token" || exp != "2026-09-25T12:00:00Z" {
		t.Fatalf("%s %s %s %s", access, secret, session, exp)
	}
}

func TestParseSTSAssumeRoleError(t *testing.T) {
	body := []byte(`<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to perform sts:AssumeRoleWithWebIdentity</Message></Error></ErrorResponse>`)
	if _, _, _, _, err := parseSTSAssumeRoleCredentials(body, 403); err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("expected AccessDenied, got %v", err)
	}
}

func TestPersistedExchangeOmitsSecrets(t *testing.T) {
	details := workloadRoleExchange{
		Cloud:           "aws",
		Role:            "arn:aws:iam::1:role/ci",
		Subject:         "repo:acme/api",
		Exchanged:       true,
		AccessKeyID:     "ASIAEXAMPLE",
		SecretAccessKey: "must-not-persist",
		SessionToken:    "must-not-persist-either",
		ExpiresAt:       "2026-09-25T12:00:00Z",
	}.persistedDetails()
	raw := fmtAny(details)
	if strings.Contains(raw, "must-not-persist") || strings.Contains(raw, "ASIAEXAMPLE") {
		t.Fatalf("secret leaked into persisted details: %s", raw)
	}
	if os.Getenv("AWS_WORKLOAD_ROLE_ARN") != "" {
		t.Fatal("test must not depend on a live role")
	}
}

func fmtAny(value map[string]any) string {
	parts := make([]string, 0, len(value))
	for key, item := range value {
		parts = append(parts, key+"="+strings.TrimSpace(stringFromAny(item)))
	}
	return strings.Join(parts, " ")
}
