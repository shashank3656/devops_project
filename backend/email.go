package main

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"html/template"
	"log"
	"net/mail"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func sanitizeEmailHeaderValue(value, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	if strings.ContainsAny(trimmed, "\r\n") {
		return "", fmt.Errorf("%s contains invalid characters", field)
	}
	return trimmed, nil
}

func sanitizeEmailAddress(value, field string) (string, error) {
	headerValue, err := sanitizeEmailHeaderValue(value, field)
	if err != nil {
		return "", err
	}
	parsed, err := mail.ParseAddress(headerValue)
	if err != nil {
		return "", fmt.Errorf("invalid %s", field)
	}
	if strings.ContainsAny(parsed.Address, "\r\n") {
		return "", fmt.Errorf("invalid %s", field)
	}
	return parsed.Address, nil
}

func sanitizeEmailBody(value string) string {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return normalized
}

func sanitizeEmailTextContent(value string) string {
	normalized := sanitizeEmailBody(value)
	var b strings.Builder
	b.Grow(len(normalized))
	for _, r := range normalized {
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			continue
		}
		if unicode.IsPrint(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func buildEscapedEmailHTML(subject, escapedBody string) string {
	subjectEscaped := template.HTMLEscapeString(subject)
	bodyWithBreaks := strings.ReplaceAll(escapedBody, "\n", "<br>\n")
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>` + subjectEscaped + `</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#334155;background:#f8fafc;">
  <div style="max-width:600px;margin:24px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
      <h1 style="margin:0;font-size:20px;font-weight:600;color:#0f172a;">InfraGate</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Infrastructure Request Portal</p>
    </div>
    <div style="color:#334155;">
      ` + bodyWithBreaks + `
    </div>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
      This is an automated message from InfraGate. Do not reply to this email.
    </div>
  </div>
</body>
</html>`
}

// SendEmail sends an email via SMTP if configured. No-op if SMTP_HOST is empty.
// Logs each step for debugging.
func SendEmail(to, subject, body string) error {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		log.Printf("[Email] SMTP_HOST not set - skipping send to %s (subject: %s)", to, subject)
		return nil
	}
	portStr := os.Getenv("SMTP_PORT")
	if portStr == "" {
		portStr = "587"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 587
	}
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASSWORD")
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = "noreply@localhost"
	}
	to, err = sanitizeEmailAddress(to, "to")
	if err != nil {
		return err
	}
	from, err = sanitizeEmailAddress(from, "from")
	if err != nil {
		return err
	}
	subject, err = sanitizeEmailHeaderValue(subject, "subject")
	if err != nil {
		return err
	}
	subject = template.HTMLEscapeString(subject)
	body = sanitizeEmailTextContent(body)
	escapedBody := template.HTMLEscapeString(body)

	useTLS := strings.ToLower(os.Getenv("SMTP_USE_TLS")) != "false"

	log.Printf("[Email] Sending to=%s subject=%q host=%s port=%d useTLS=%v", to, subject, host, port, useTLS)

	addr := fmt.Sprintf("%s:%d", host, port)
	boundary := fmt.Sprintf("boundary_%d", time.Now().UnixNano())
	htmlBody := buildEscapedEmailHTML(subject, escapedBody)
	msg := buildMIMEMessage(from, to, subject, escapedBody, htmlBody, boundary)

	var auth smtp.Auth
	if user != "" && pass != "" {
		auth = smtp.PlainAuth("", user, pass, host)
		log.Printf("[Email] Using SMTP auth user=%s", user)
	} else {
		log.Printf("[Email] No SMTP auth (SMTP_USER or SMTP_PASSWORD empty)")
	}

	if useTLS && port == 587 {
		tlsConfig := &tls.Config{ServerName: host, InsecureSkipVerify: false}
		conn, err := tls.Dial("tcp", addr, tlsConfig)
		if err != nil {
			log.Printf("[Email] TLS dial failed to %s: %v", addr, err)
			return fmt.Errorf("TLS dial: %w", err)
		}
		defer conn.Close()
		log.Printf("[Email] TLS connection established")

		client, err := smtp.NewClient(conn, host)
		if err != nil {
			log.Printf("[Email] SMTP NewClient failed: %v", err)
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()

		if auth != nil {
			if err := client.Auth(auth); err != nil {
				log.Printf("[Email] SMTP Auth failed: %v", err)
				return fmt.Errorf("smtp auth: %w", err)
			}
			log.Printf("[Email] SMTP Auth succeeded")
		}
		if err := client.Mail(from); err != nil {
			log.Printf("[Email] SMTP Mail(from) failed: %v", err)
			return fmt.Errorf("smtp mail: %w", err)
		}
		if err := client.Rcpt(to); err != nil {
			log.Printf("[Email] SMTP Rcpt(to=%s) failed: %v", to, err)
			return fmt.Errorf("smtp rcpt: %w", err)
		}
		w, err := client.Data()
		if err != nil {
			log.Printf("[Email] SMTP Data failed: %v", err)
			return fmt.Errorf("smtp data: %w", err)
		}
		_, err = w.Write(msg)
		if err != nil {
			log.Printf("[Email] SMTP Write failed: %v", err)
			return fmt.Errorf("smtp write: %w", err)
		}
		err = w.Close()
		if err != nil {
			log.Printf("[Email] SMTP Data Close failed: %v", err)
			return fmt.Errorf("smtp close: %w", err)
		}
		if err := client.Quit(); err != nil {
			log.Printf("[Email] SMTP Quit warning: %v", err)
		}
		log.Printf("[Email] Sent successfully to %s", to)
		return nil
	}

	err = smtp.SendMail(addr, auth, from, []string{to}, msg)
	if err != nil {
		log.Printf("[Email] SendMail failed: %v", err)
		return err
	}
	log.Printf("[Email] Sent successfully to %s (SendMail)", to)
	return nil
}

func buildMIMEMessage(from, to, subject, textBody, htmlBody, boundary string) []byte {
	var b bytes.Buffer
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=" + boundary + "\r\n\r\n")
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	b.WriteString(textBody)
	b.WriteString("\r\n\r\n--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	b.WriteString(htmlBody)
	b.WriteString("\r\n--" + boundary + "--\r\n")
	return b.Bytes()
}

// WrapEmailHTML wraps plain text in a simple HTML email template
func WrapEmailHTML(subject, body string) string {
	escaped := template.HTMLEscapeString(sanitizeEmailTextContent(body))
	return buildEscapedEmailHTML(subject, escaped)
}

// EmailTemplatePasswordReset returns HTML and plain text for password reset email
func EmailTemplatePasswordReset(resetURL string) (subject, plainText, htmlBody string) {
	subject = "Password reset - InfraGate"
	plainText = "You requested a password reset. Click the link below to set a new password (valid for 1 hour):\n\n" + resetURL + "\n\nIf you did not request this, ignore this email."
	htmlBody = WrapEmailHTML(subject, plainText)
	return subject, plainText, htmlBody
}

// EmailTemplate2FA returns subject and body for 2FA code email
func EmailTemplate2FA(otp string) (subject, body string) {
	subject = "Your verification code - InfraGate"
	body = "Your verification code is: " + otp + "\n\nThis code expires in 10 minutes."
	return subject, body
}
