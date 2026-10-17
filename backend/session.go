package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	devSessionSecretFallback = "setuops-dev-session-secret-not-for-production"
	legacySessionTokenSep    = ":"
	sessionHMACAlg           = "HS256"
)

// sessionNow is the clock used for issue and expiry checks. Tests replace it.
var sessionNow = time.Now

type sessionClaims struct {
	UserID int    `json:"uid"`
	Iat    int64  `json:"iat"`
	Exp    int64  `json:"exp"`
	JTI    string `json:"jti,omitempty"`
}

var revokedSessions = struct {
	sync.Mutex
	until map[string]int64
}{until: map[string]int64{}}

func isProductionRuntime() bool {
	env := strings.ToLower(strings.TrimSpace(firstNonEmptyEnv("APP_ENV", "SETUOPS_ENV", "GO_ENV")))
	return env == "production" || env == "prod"
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func sessionTimeoutDuration() time.Duration {
	mins := 24 * 60
	if raw := strings.TrimSpace(os.Getenv("SESSION_TIMEOUT_MINUTES")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			mins = n
		}
	}
	return time.Duration(mins) * time.Minute
}

func sessionSigningKey() ([]byte, error) {
	if secret := strings.TrimSpace(os.Getenv("SESSION_SECRET")); secret != "" {
		return []byte(secret), nil
	}
	if secret := strings.TrimSpace(os.Getenv("JWT_SECRET")); secret != "" {
		return []byte(secret), nil
	}
	if isProductionRuntime() {
		return nil, fmt.Errorf("SESSION_SECRET or JWT_SECRET is required in production")
	}
	return []byte(devSessionSecretFallback), nil
}

func validateRuntimeSecrets() error {
	if !isProductionRuntime() {
		return nil
	}
	if _, err := sessionSigningKey(); err != nil {
		return err
	}
	if strings.TrimSpace(os.Getenv("API_KEY_HASH_SECRET")) == "" && strings.TrimSpace(os.Getenv("API_KEY_PEPPER")) == "" {
		return fmt.Errorf("API_KEY_HASH_SECRET is required in production")
	}
	return nil
}

func allowTestOTP() bool {
	if isProductionRuntime() {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_TEST_OTP")), "true")
}

func maybeAttachTestOTP(payload map[string]interface{}, otp string) {
	if payload == nil || !allowTestOTP() || strings.TrimSpace(otp) == "" {
		return
	}
	payload["otp_for_testing"] = otp
}

func isLegacySessionToken(token string) bool {
	token = strings.TrimSpace(token)
	if token == "" || strings.Contains(token, ".") {
		return false
	}
	parts := strings.Split(token, legacySessionTokenSep)
	if len(parts) != 2 {
		return false
	}
	if _, err := strconv.Atoi(parts[0]); err != nil {
		return false
	}
	if _, err := strconv.ParseInt(parts[1], 10, 64); err != nil {
		return false
	}
	return true
}

func jwtBase64Encode(raw []byte) string {
	return base64.RawURLEncoding.EncodeToString(raw)
}

func jwtBase64Decode(raw string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(raw)
}

func signSessionToken(userID int) (string, error) {
	if userID <= 0 {
		return "", fmt.Errorf("invalid user id")
	}
	now := sessionNow().Unix()
	return signSessionClaims(sessionClaims{
		UserID: userID,
		Iat:    now,
		Exp:    now + int64(sessionTimeoutDuration().Seconds()),
		JTI:    newSessionID(),
	})
}

func newSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("session-%d", sessionNow().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func revokePresentedSession(token string) error {
	claims, err := parseSessionToken(token)
	if err != nil {
		return err
	}
	if strings.TrimSpace(claims.JTI) == "" {
		return fmt.Errorf("session cannot be revoked")
	}
	revokedSessions.Lock()
	revokedSessions.until[claims.JTI] = claims.Exp
	revokedSessions.Unlock()
	if err := persistRevocation(claims.JTI, claims.Exp); err != nil {
		return err
	}
	return nil
}

func persistRevokedSession(jti string, exp int64) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(
		`INSERT INTO revoked_sessions (jti, expires_at) VALUES ($1, $2)
		 ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
		jti, time.Unix(exp, 0).UTC(),
	)
	if err != nil {
		return fmt.Errorf("persist revoked session: %w", err)
	}
	return nil
}

var persistRevocation = persistRevokedSession

func lookupRevokedExpiry(jti string) (int64, bool) {
	if DB == nil {
		return 0, false
	}
	var expires time.Time
	err := DB.QueryRow(`SELECT expires_at FROM revoked_sessions WHERE jti = $1`, jti).Scan(&expires)
	if err != nil {
		if err != sql.ErrNoRows {
			logSessionRevocation(err)
		}
		return 0, false
	}
	return expires.Unix(), true
}

var revocationLookup = lookupRevokedExpiry

func logSessionRevocation(err error) {
	fmt.Printf("revoked session lookup failed: %v\n", err)
}

func migrateRevokedSessionsSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS revoked_sessions (
			jti VARCHAR(64) PRIMARY KEY,
			expires_at TIMESTAMP NOT NULL
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions(expires_at)`)
	_, _ = DB.Exec(`DELETE FROM revoked_sessions WHERE expires_at <= NOW()`)
}

func loadRevokedSessions() {
	if DB == nil {
		return
	}
	rows, err := DB.Query(`SELECT jti, expires_at FROM revoked_sessions WHERE expires_at > NOW()`)
	if err != nil {
		logSessionRevocation(err)
		return
	}
	defer rows.Close()
	revokedSessions.Lock()
	defer revokedSessions.Unlock()
	for rows.Next() {
		var jti string
		var expires time.Time
		if err := rows.Scan(&jti, &expires); err != nil {
			continue
		}
		revokedSessions.until[jti] = expires.Unix()
	}
}

func sessionRevoked(jti string) bool {
	jti = strings.TrimSpace(jti)
	if jti == "" {
		return false
	}
	now := sessionNow().Unix()
	revokedSessions.Lock()
	exp, ok := revokedSessions.until[jti]
	if ok && exp > 0 && now >= exp {
		delete(revokedSessions.until, jti)
		ok = false
	}
	revokedSessions.Unlock()
	if ok {
		return true
	}
	exp, ok = revocationLookup(jti)
	if !ok || exp <= 0 || now >= exp {
		return false
	}
	revokedSessions.Lock()
	revokedSessions.until[jti] = exp
	revokedSessions.Unlock()
	return true
}

func signSessionClaims(claims sessionClaims) (string, error) {
	if claims.UserID <= 0 {
		return "", fmt.Errorf("invalid user id")
	}
	key, err := sessionSigningKey()
	if err != nil {
		return "", err
	}
	header, err := json.Marshal(map[string]string{"alg": sessionHMACAlg, "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signingInput := jwtBase64Encode(header) + "." + jwtBase64Encode(payload)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(signingInput))
	return signingInput + "." + jwtBase64Encode(mac.Sum(nil)), nil
}

func generateToken(userID int) string {
	token, err := signSessionToken(userID)
	if err != nil {
		return ""
	}
	return token
}

func parseSessionToken(token string) (sessionClaims, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	if isLegacySessionToken(token) {
		return sessionClaims{}, fmt.Errorf("session expired, please sign in again")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	key, err := sessionSigningKey()
	if err != nil {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	headerRaw, err := jwtBase64Decode(parts[0])
	if err != nil {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerRaw, &header); err != nil || header.Alg != sessionHMACAlg {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	signingInput := parts[0] + "." + parts[1]
	sig, err := jwtBase64Decode(parts[2])
	if err != nil {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(signingInput))
	if !hmac.Equal(mac.Sum(nil), sig) {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	payloadRaw, err := jwtBase64Decode(parts[1])
	if err != nil {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	var claims sessionClaims
	if err := json.Unmarshal(payloadRaw, &claims); err != nil || claims.UserID <= 0 {
		return sessionClaims{}, fmt.Errorf("invalid or expired token")
	}
	return claims, nil
}

func validateToken(token string) (int, error) {
	claims, err := parseSessionToken(token)
	if err != nil {
		return 0, err
	}
	// exp is required and exclusive: a token is expired at the exp instant.
	if claims.Exp <= 0 || sessionNow().Unix() >= claims.Exp {
		return 0, fmt.Errorf("token expired")
	}
	if sessionRevoked(claims.JTI) {
		return 0, fmt.Errorf("session revoked")
	}
	return claims.UserID, nil
}
