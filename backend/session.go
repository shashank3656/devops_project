package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	devSessionSecretFallback = "setuops-dev-session-secret-not-for-production"
	legacySessionTokenSep    = ":"
)

type sessionClaims struct {
	UserID int   `json:"uid"`
	Iat    int64 `json:"iat"`
	Exp    int64 `json:"exp"`
}

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
	key, err := sessionSigningKey()
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(sessionClaims{
		UserID: userID,
		Iat:    now,
		Exp:    now + int64(sessionTimeoutDuration().Seconds()),
	})
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

func validateToken(token string) (int, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, fmt.Errorf("invalid or expired token")
	}
	if isLegacySessionToken(token) {
		return 0, fmt.Errorf("legacy token rejected")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid or expired token")
	}
	key, err := sessionSigningKey()
	if err != nil {
		return 0, fmt.Errorf("invalid or expired token")
	}
	signingInput := parts[0] + "." + parts[1]
	sig, err := jwtBase64Decode(parts[2])
	if err != nil {
		return 0, fmt.Errorf("invalid or expired token")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(signingInput))
	if !hmac.Equal(mac.Sum(nil), sig) {
		return 0, fmt.Errorf("invalid or expired token")
	}
	payloadRaw, err := jwtBase64Decode(parts[1])
	if err != nil {
		return 0, fmt.Errorf("invalid or expired token")
	}
	var claims sessionClaims
	if err := json.Unmarshal(payloadRaw, &claims); err != nil || claims.UserID <= 0 {
		return 0, fmt.Errorf("invalid or expired token")
	}
	if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
		return 0, fmt.Errorf("token expired")
	}
	return claims.UserID, nil
}
