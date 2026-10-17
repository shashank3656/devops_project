package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestForgedAndExpiredSessionsAreDenied(t *testing.T) {
	t.Setenv("SESSION_SECRET", "brd01-test-secret")
	t.Setenv("APP_ENV", "local")

	originalNow := sessionNow
	t.Cleanup(func() { sessionNow = originalNow })
	issuedAt := time.Unix(1_700_000_000, 0)
	sessionNow = func() time.Time { return issuedAt }

	token := generateToken(7)
	if token == "" {
		t.Fatal("expected signed session token")
	}

	sessionNow = func() time.Time { return issuedAt.Add(time.Second) }
	if userID, err := validateToken(token); err != nil || userID != 7 {
		t.Fatalf("fresh token userID=%d err=%v", userID, err)
	}

	sessionNow = func() time.Time { return issuedAt.Add(sessionTimeoutDuration()) }
	if _, err := validateToken(token); err == nil {
		t.Fatal("token at exact expiry must be denied")
	}

	sessionNow = func() time.Time { return issuedAt }
	open, err := signSessionClaims(sessionClaims{UserID: 7, Iat: issuedAt.Unix(), Exp: 0})
	if err != nil {
		t.Fatalf("signSessionClaims: %v", err)
	}
	if _, err := validateToken(open); err == nil {
		t.Fatal("token with no expiry must be denied")
	}

	parts := strings.Split(token, ".")
	forgedSig := []byte(parts[2])
	if forgedSig[0] == 'A' {
		forgedSig[0] = 'B'
	} else {
		forgedSig[0] = 'A'
	}
	if _, err := validateToken(parts[0] + "." + parts[1] + "." + string(forgedSig)); err == nil {
		t.Fatal("tampered signature must be denied")
	}

	none := jwtBase64Encode([]byte(`{"alg":"none","typ":"JWT"}`)) + "." +
		jwtBase64Encode([]byte(`{"uid":7,"iat":1700000000,"exp":1800000000}`)) + "."
	if _, err := validateToken(none); err == nil {
		t.Fatal("alg none must be denied")
	}

	t.Setenv("SESSION_SECRET", "different-secret")
	sessionNow = func() time.Time { return issuedAt.Add(time.Second) }
	if _, err := validateToken(token); err == nil {
		t.Fatal("token signed with another secret must be denied")
	}
}

func TestSessionDenialReturnsUnauthorized(t *testing.T) {
	t.Setenv("SESSION_SECRET", "brd01-test-secret")
	t.Setenv("APP_ENV", "local")

	originalNow := sessionNow
	t.Cleanup(func() { sessionNow = originalNow })
	issuedAt := time.Unix(1_700_000_000, 0)
	sessionNow = func() time.Time { return issuedAt }

	token := generateToken(9)
	if token == "" {
		t.Fatal("expected signed session token")
	}

	assertDenied := func(name, bearer string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rec := httptest.NewRecorder()
		meHandler(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s status = %d, want 401 body=%s", name, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), `"user"`) {
			t.Fatalf("%s response included a user payload: %s", name, rec.Body.String())
		}
	}

	assertDenied("missing", "")
	assertDenied("legacy", "1:1710000000")

	sessionNow = func() time.Time { return issuedAt.Add(sessionTimeoutDuration()) }
	assertDenied("expired", token)

	sessionNow = func() time.Time { return issuedAt.Add(time.Second) }
	parts := strings.Split(token, ".")
	forgedSig := []byte(parts[2])
	if forgedSig[0] == 'A' {
		forgedSig[0] = 'B'
	} else {
		forgedSig[0] = 'A'
	}
	assertDenied("forged", parts[0]+"."+parts[1]+"."+string(forgedSig))
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

func TestRevokedSessionIsDenied(t *testing.T) {
	t.Setenv("SESSION_SECRET", "brd01-test-secret")
	t.Setenv("APP_ENV", "local")
	token := generateToken(7)
	if token == "" {
		t.Fatal("expected signed session token")
	}
	if userID, err := validateToken(token); err != nil || userID != 7 {
		t.Fatalf("fresh token userID=%d err=%v", userID, err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	logoutHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout status = %d body=%s", rec.Code, rec.Body.String())
	}
	if _, err := validateToken(token); err == nil {
		t.Fatal("revoked session must be denied")
	}
	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+token)
	meRec := httptest.NewRecorder()
	meHandler(meRec, meReq)
	if meRec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked /api/me status = %d body=%s", meRec.Code, meRec.Body.String())
	}
}

func TestRevocationSurvivesProcessRestart(t *testing.T) {
	t.Setenv("SESSION_SECRET", "brd01-test-secret")
	t.Setenv("APP_ENV", "local")

	durable := map[string]int64{}
	originalPersist := persistRevocation
	originalLookup := revocationLookup
	persistRevocation = func(jti string, exp int64) error {
		durable[jti] = exp
		return nil
	}
	revocationLookup = func(jti string) (int64, bool) {
		exp, ok := durable[jti]
		return exp, ok
	}
	t.Cleanup(func() {
		persistRevocation = originalPersist
		revocationLookup = originalLookup
	})

	token := generateToken(11)
	if err := revokePresentedSession(token); err != nil {
		t.Fatalf("revokePresentedSession: %v", err)
	}
	revokedSessions.Lock()
	revokedSessions.until = map[string]int64{}
	revokedSessions.Unlock()

	if _, err := validateToken(token); err == nil {
		t.Fatal("revoked session must stay denied after the in-memory list is cleared")
	}
}

func TestBrowserMutationRejectsForeignOrigin(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")
	t.Setenv("ADMIN_FRONTEND_URL", "http://localhost:3001")
	t.Setenv("DEVOPS_FRONTEND_URL", "http://localhost:3002")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	reloadConfigFromEnv()

	var called bool
	handler := withBrowserCSRF(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	evil := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	evil.Header.Set("Origin", "https://evil.example")
	evilRec := httptest.NewRecorder()
	handler.ServeHTTP(evilRec, evil)
	if evilRec.Code != http.StatusForbidden || called {
		t.Fatalf("foreign origin status=%d called=%v", evilRec.Code, called)
	}

	crossSite := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	crossSite.Header.Set("Sec-Fetch-Site", "cross-site")
	crossRec := httptest.NewRecorder()
	handler.ServeHTTP(crossRec, crossSite)
	if crossRec.Code != http.StatusForbidden {
		t.Fatalf("cross-site status = %d, want 403", crossRec.Code)
	}

	allowed := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	allowed.Header.Set("Origin", "http://localhost:3000")
	allowedRec := httptest.NewRecorder()
	handler.ServeHTTP(allowedRec, allowed)
	if allowedRec.Code != http.StatusNoContent {
		t.Fatalf("allowed origin status = %d, want 204", allowedRec.Code)
	}
}

func TestDefaultAdminPasswordIsNotWellKnown(t *testing.T) {
	t.Setenv("DEFAULT_ADMIN_PASSWORD", "")
	if _, err := configuredDefaultAdminPassword(); err == nil {
		t.Fatal("unset DEFAULT_ADMIN_PASSWORD must not fall back to a known password")
	}
	t.Setenv("DEFAULT_ADMIN_PASSWORD", "admin123")
	if _, err := configuredDefaultAdminPassword(); err == nil {
		t.Fatal("admin123 must be rejected")
	}
	t.Setenv("DEFAULT_ADMIN_PASSWORD", "a-unique-bootstrap-secret")
	got, err := configuredDefaultAdminPassword()
	if err != nil || got != "a-unique-bootstrap-secret" {
		t.Fatalf("configured password = %q err=%v", got, err)
	}
}

func TestAuthAttemptsAreRateLimited(t *testing.T) {
	resetAuthAttempts()
	t.Cleanup(resetAuthAttempts)
	for i := 0; i < authAttemptLimit; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.10:1234"
		rec := httptest.NewRecorder()
		loginHandler(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("attempt %d was limited early", i+1)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	rec := httptest.NewRecorder()
	loginHandler(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt after limit = %d, want 429", rec.Code)
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

	t.Setenv("APP_ENV", "production")
	if _, ok := adminBreakGlassUserID(req); ok {
		t.Fatal("break-glass must be disabled in production")
	}
}
