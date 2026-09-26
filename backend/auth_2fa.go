package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func maskEmailForDisplay(email string) string {
	email = strings.TrimSpace(email)
	at := strings.LastIndex(email, "@")
	if at <= 0 || at >= len(email)-1 {
		return "your email"
	}
	local := email[:at]
	domain := email[at+1:]
	if len(local) <= 1 {
		return "*" + "@" + domain
	}
	if len(local) == 2 {
		return local[:1] + "*" + "@" + domain
	}
	return local[:1] + strings.Repeat("*", len(local)-2) + local[len(local)-1:] + "@" + domain
}

// sendLoginOTPEmail delivers a login OTP synchronously (not subject to notification prefs).
func sendLoginOTPEmail(userID int, otp string) error {
	if strings.TrimSpace(os.Getenv("SMTP_HOST")) == "" {
		return fmt.Errorf("SMTP is not configured on the server")
	}
	user, err := GetUserByID(userID)
	if err != nil {
		return err
	}
	if user == nil {
		return fmt.Errorf("user not found")
	}
	to := strings.TrimSpace(user.Email)
	if to == "" {
		return fmt.Errorf("user has no email address on file")
	}
	subject, body := EmailTemplate2FA(otp)
	return SendEmail(to, subject, body)
}

func generateNumericOTP(digits int) (string, error) {
	if digits <= 0 {
		digits = 6
	}
	buf := make([]byte, digits)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, digits)
	for i, b := range buf {
		out[i] = '0' + (b % 10)
	}
	return string(out), nil
}

type login2FAResponse struct {
	PendingToken string
	EmailHint    string
	otpPlain     string
}

func beginLoginEmail2FA(userID int) (*login2FAResponse, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return nil, fmt.Errorf("user not found")
	}
	otp, err := generateNumericOTP(6)
	if err != nil {
		return nil, fmt.Errorf("failed to generate OTP")
	}
	otpExpires := time.Now().Add(10 * time.Minute)
	if err := SetUserVerificationToken(userID, otp, otpExpires); err != nil {
		return nil, fmt.Errorf("failed to persist OTP")
	}
	pendingBytes := make([]byte, 32)
	if _, err := rand.Read(pendingBytes); err != nil {
		return nil, fmt.Errorf("failed to generate pending 2FA token")
	}
	pendingToken := hex.EncodeToString(pendingBytes)
	_, err = DB.Exec("INSERT INTO pending_2fa (token, user_id, expires_at) VALUES ($1, $2, $3)",
		pendingToken, userID, otpExpires)
	if err != nil {
		return nil, fmt.Errorf("failed to store pending 2FA session")
	}
	if err := sendLoginOTPEmail(userID, otp); err != nil {
		if allowTestOTP() {
			log.Printf("[Auth] 2FA email not sent (ALLOW_TEST_OTP): %v", err)
		} else {
			_, _ = DB.Exec("DELETE FROM pending_2fa WHERE token = $1", pendingToken)
			return nil, err
		}
	}
	return &login2FAResponse{
		PendingToken: pendingToken,
		EmailHint:    maskEmailForDisplay(user.Email),
		otpPlain:     otp,
	}, nil
}

func writeLogin2FARequired(w http.ResponseWriter, resp *login2FAResponse) {
	payload := map[string]interface{}{
		"requires_otp":      true,
		"pending_2fa_token": resp.PendingToken,
		"email_hint":        resp.EmailHint,
		"message":           fmt.Sprintf("Enter the 6-digit code sent to %s", resp.EmailHint),
	}
	maybeAttachTestOTP(payload, resp.otpPlain)
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, payload)
}

func resend2faHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	var req struct {
		PendingToken string `json:"pending_2fa_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
		return
	}
	token := strings.TrimSpace(req.PendingToken)
	if token == "" {
		writeAPIError(w, r, http.StatusBadRequest, "pending_2fa_token required", nil)
		return
	}
	var userID int
	err := DB.QueryRow(
		"SELECT user_id FROM pending_2fa WHERE token = $1 AND expires_at > NOW()",
		token,
	).Scan(&userID)
	if err != nil || userID <= 0 {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid or expired 2FA session — sign in again", nil)
		return
	}
	_, _ = DB.Exec("DELETE FROM pending_2fa WHERE token = $1", token)
	resp, err := beginLoginEmail2FA(userID)
	if err != nil {
		msg := "Could not send verification email. Check SMTP settings or contact your administrator."
		if strings.Contains(err.Error(), "no email") {
			msg = "Your account has no email address. Ask an administrator to add one."
		}
		writeAPIError(w, r, http.StatusServiceUnavailable, msg, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeAuthJSON(w, map[string]interface{}{
		"status":            "ok",
		"pending_2fa_token": resp.PendingToken,
		"email_hint":        resp.EmailHint,
		"message":           fmt.Sprintf("A new code was sent to %s", resp.EmailHint),
	})
}
