package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLegacySessionTokenIsRejected(t *testing.T) {
	t.Setenv("SESSION_SECRET", "brd01-test-secret")
	t.Setenv("APP_ENV", "local")

	if _, err := validateToken("1:1710000000"); err == nil {
		t.Fatal("expected forgeable userID:unix token to be rejected")
	}

	token := generateToken(7)
	if token == "" {
		t.Fatal("expected signed session token")
	}
	if isLegacySessionToken(token) {
		t.Fatalf("signed token looked legacy: %s", token)
	}
	userID, err := validateToken(token)
	if err != nil {
		t.Fatalf("validateToken(signed) = %v", err)
	}
	if userID != 7 {
		t.Fatalf("validateToken(signed) userID = %d, want 7", userID)
	}
}

func TestTestOTPIsGated(t *testing.T) {
	t.Setenv("APP_ENV", "local")
	t.Setenv("ALLOW_TEST_OTP", "true")
	allowed := map[string]interface{}{}
	maybeAttachTestOTP(allowed, "123456")
	if allowed["otp_for_testing"] != "123456" {
		t.Fatal("expected otp_for_testing when ALLOW_TEST_OTP=true outside production")
	}

	t.Setenv("APP_ENV", "production")
	blocked := map[string]interface{}{}
	maybeAttachTestOTP(blocked, "123456")
	if _, ok := blocked["otp_for_testing"]; ok {
		t.Fatal("production responses must never include otp_for_testing")
	}

	t.Setenv("APP_ENV", "local")
	t.Setenv("ALLOW_TEST_OTP", "false")
	hidden := map[string]interface{}{}
	maybeAttachTestOTP(hidden, "123456")
	if _, ok := hidden["otp_for_testing"]; ok {
		t.Fatal("otp_for_testing must stay off unless ALLOW_TEST_OTP=true")
	}
}

func TestCORSAllowListRejectsUnknownOrigin(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")
	t.Setenv("ADMIN_FRONTEND_URL", "http://localhost:3001")
	t.Setenv("DEVOPS_FRONTEND_URL", "http://localhost:3002")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	reloadConfigFromEnv()

	unknown := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	unknown.Header.Set("Origin", "https://evil.example")
	unknownRec := httptest.NewRecorder()
	handleOptions(unknownRec, unknown)
	if unknownRec.Code != http.StatusForbidden {
		t.Fatalf("unknown origin OPTIONS = %d, want 403", unknownRec.Code)
	}
	if got := unknownRec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unknown origin should not receive ACAO, got %q", got)
	}

	allowed := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	allowed.Header.Set("Origin", "http://localhost:3000")
	allowedRec := httptest.NewRecorder()
	handleOptions(allowedRec, allowed)
	if allowedRec.Code != http.StatusOK {
		t.Fatalf("allowed origin OPTIONS = %d, want 200", allowedRec.Code)
	}
	if got := allowedRec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("ACAO = %q, want http://localhost:3000", got)
	}
}

func TestProductionSecretsAreRequired(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("API_KEY_HASH_SECRET", "")
	t.Setenv("API_KEY_PEPPER", "")
	if err := validateRuntimeSecrets(); err == nil {
		t.Fatal("expected production boot to fail without SESSION_SECRET")
	}

	t.Setenv("SESSION_SECRET", "prod-session-secret")
	if err := validateRuntimeSecrets(); err == nil {
		t.Fatal("expected production boot to fail without API_KEY_HASH_SECRET")
	}

	t.Setenv("API_KEY_HASH_SECRET", "prod-api-key-hash")
	if err := validateRuntimeSecrets(); err != nil {
		t.Fatalf("validateRuntimeSecrets() = %v, want nil", err)
	}
}

func TestAdminBreakGlassRequiresConfiguredUser(t *testing.T) {
	t.Setenv("ADMIN_SECRET", "break-glass")
	t.Setenv("ADMIN_BREAKGLASS_USER_ID", "")
	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	req.Header.Set("X-Admin-Secret", "break-glass")
	if _, ok := adminBreakGlassUserID(req); ok {
		t.Fatal("break-glass must not succeed as userID 0")
	}

	t.Setenv("ADMIN_BREAKGLASS_USER_ID", "42")
	id, ok := adminBreakGlassUserID(req)
	if !ok || id != 42 {
		t.Fatalf("break-glass userID = %d ok=%v, want 42 true", id, ok)
	}
}
