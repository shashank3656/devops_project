package main

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"html/template"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	smtpDialTimeout    = 10 * time.Second
	smtpSessionTimeout = 30 * time.Second
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

type emailHTMLPayload struct {
	Subject string
	Body    template.HTML
}

var emailHTMLTemplate = template.Must(template.New("setuops-email").Parse(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{.Subject}}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#334155;background:#f8fafc;">
  <div style="max-width:600px;margin:24px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
      <h1 style="margin:0;font-size:20px;font-weight:600;color:#0f172a;">SetuOps</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Infrastructure Request Portal</p>
    </div>
    <div style="color:#334155;">
      {{.Body}}
    </div>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
      This is an automated message from SetuOps. Do not reply to this email.
    </div>
  </div>
</body>
</html>`))

func htmlBodyFromEscapedPlain(escapedBody string) template.HTML {
	return template.HTML(strings.ReplaceAll(escapedBody, "\n", "<br>\n"))
}

func buildEscapedEmailHTML(subjectPlain, escapedBody string) (string, error) {
	var buf bytes.Buffer
	err := emailHTMLTemplate.Execute(&buf, emailHTMLPayload{
		Subject: subjectPlain,
		Body:    htmlBodyFromEscapedPlain(escapedBody),
	})
	if err != nil {
		return "", err
	}
	return buf.String(), nil
}

func sanitizeEmailURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	if strings.ContainsAny(parsed.String(), "\r\n") {
		return ""
	}
	return sanitizeEmailTextContent(parsed.String())
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
	subjectPlain, err := sanitizeEmailHeaderValue(subject, "subject")
	if err != nil {
		return err
	}
	body = sanitizeEmailTextContent(body)
	escapedBody := template.HTMLEscapeString(body)

	useTLS := strings.ToLower(os.Getenv("SMTP_USE_TLS")) != "false"

	log.Printf("[Email] Sending to=%s subject=%q host=%s port=%d useTLS=%v", to, subjectPlain, host, port, useTLS)

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	htmlBody, err := buildEscapedEmailHTML(subjectPlain, escapedBody)
	if err != nil {
		return fmt.Errorf("email html: %w", err)
	}
	msg, err := buildSanitizedMIMEMessage(from, to, subjectPlain, escapedBody, htmlBody)
	if err != nil {
		return err
	}

	var auth smtp.Auth
	if user != "" && pass != "" {
		auth = smtp.PlainAuth("", user, pass, host)
		log.Printf("[Email] Using SMTP auth user=%s", user)
	} else {
		log.Printf("[Email] No SMTP auth (SMTP_USER or SMTP_PASSWORD empty)")
	}

	if useTLS {
		tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
		dialer := &net.Dialer{Timeout: smtpDialTimeout}

		var conn net.Conn
		// 465 is implicit TLS (SMTPS). Every other port (587, 25, 2525) starts in
		// plaintext and must be upgraded with STARTTLS before AUTH.
		if port == 465 {
			conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
		} else {
			conn, err = dialer.Dial("tcp", addr)
		}
		if err != nil {
			log.Printf("[Email] Dial failed to %s: %v", addr, err)
			return fmt.Errorf("smtp dial: %w", err)
		}
		_ = conn.SetDeadline(time.Now().Add(smtpSessionTimeout))
		defer func() { _ = conn.Close() }()

		client, err := smtp.NewClient(conn, host)
		if err != nil {
			log.Printf("[Email] SMTP NewClient failed: %v", err)
			return fmt.Errorf("smtp client: %w", err)
		}
		defer func() { _ = client.Close() }()

		if port != 465 {
			if ok, _ := client.Extension("STARTTLS"); !ok {
				log.Printf("[Email] %s does not advertise STARTTLS", addr)
				return fmt.Errorf("smtp: server %s does not support STARTTLS", addr)
			}
			if err := client.StartTLS(tlsConfig); err != nil {
				log.Printf("[Email] STARTTLS failed on %s: %v", addr, err)
				return fmt.Errorf("smtp starttls: %w", err)
			}
		}
		log.Printf("[Email] TLS connection established (port %d)", port)

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
		err = writeEmailPayload(w, msg)
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

type sanitizedEmailMIME struct {
	from, to, subject, textBody, htmlBody string
}

func buildSanitizedMIMEMessage(from, to, subjectPlain, textBody, htmlBody string) ([]byte, error) {
	payload := sanitizedEmailMIME{
		from:     from,
		to:       to,
		subject:  subjectPlain,
		textBody: textBody,
		htmlBody: htmlBody,
	}
	return payload.encode()
}

func (m sanitizedEmailMIME) encode() ([]byte, error) {
	var headers bytes.Buffer
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	plainPart, err := writer.CreatePart(map[string][]string{
		"Content-Type": {"text/plain; charset=UTF-8"},
	})
	if err != nil {
		return nil, err
	}
	if _, err := io.WriteString(plainPart, m.textBody); err != nil {
		return nil, err
	}

	htmlPart, err := writer.CreatePart(map[string][]string{
		"Content-Type": {"text/html; charset=UTF-8"},
	})
	if err != nil {
		return nil, err
	}
	if _, err := io.WriteString(htmlPart, m.htmlBody); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	subjectHeader := mime.QEncoding.Encode("utf-8", m.subject)
	fmt.Fprintf(&headers, "From: %s\r\n", m.from)
	fmt.Fprintf(&headers, "To: %s\r\n", m.to)
	fmt.Fprintf(&headers, "Subject: %s\r\n", subjectHeader)
	fmt.Fprintf(&headers, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&headers, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", writer.Boundary())

	var msg bytes.Buffer
	msg.Write(headers.Bytes())
	msg.Write(body.Bytes())
	return msg.Bytes(), nil
}

func writeEmailPayload(w io.Writer, msg []byte) error {
	_, err := w.Write(msg)
	return err
}

// WrapEmailHTML wraps plain text in a simple HTML email template
func WrapEmailHTML(subject, body string) string {
	escaped := template.HTMLEscapeString(sanitizeEmailTextContent(body))
	htmlBody, err := buildEscapedEmailHTML(subject, escaped)
	if err != nil {
		return escaped
	}
	return htmlBody
}

// EmailTemplatePasswordReset returns HTML and plain text for password reset email
func EmailTemplatePasswordReset(resetURL string) (subject, plainText, htmlBody string) {
	subject = "Password reset - SetuOps"
	safeURL := sanitizeEmailURL(resetURL)
	plainText = "You requested a password reset. Click the link below to set a new password (valid for 1 hour):\n\n" + safeURL + "\n\nIf you did not request this, ignore this email."
	htmlBody = WrapEmailHTML(subject, plainText)
	return subject, plainText, htmlBody
}

// EmailTemplateAccountCreated tells a new person their account exists and where to sign in.
// The password is never included.
func EmailTemplateAccountCreated(username, signInURL string) (subject, body string) {
	subject = "Your SetuOps account is ready"
	name := sanitizeEmailTextContent(strings.TrimSpace(username))
	if name == "" {
		name = "there"
	}
	safeURL := sanitizeEmailURL(signInURL)
	body = "An administrator created a SetuOps account for you.\n\nUsername: " + name + "\n\n"
	if safeURL != "" {
		body += "Sign in: " + safeURL + "\n\n"
	}
	body += "Use the password they set for you. This email does not include the password."
	return subject, body
}

func portalSignInURL() string {
	base := strings.TrimRight(strings.TrimSpace(DevOpsFrontendURL), "/")
	if base == "" {
		return ""
	}
	return base + "/login"
}

// sendAccountCreatedEmail returns true only when SMTP accepted the message.
func sendAccountCreatedEmail(to, username string) bool {
	if strings.TrimSpace(os.Getenv("SMTP_HOST")) == "" {
		log.Printf("[Email] SMTP_HOST not set - account created email skipped")
		return false
	}
	subject, body := EmailTemplateAccountCreated(username, portalSignInURL())
	if err := SendEmail(to, subject, body); err != nil {
		log.Printf("[Email] account created email failed: %v", err)
		return false
	}
	return true
}

// EmailTemplate2FA returns subject and body for 2FA code email
func EmailTemplate2FA(otp string) (subject, body string) {
	subject = "Your verification code - SetuOps"
	body = "Your verification code is: " + otp + "\n\nThis code expires in 10 minutes."
	return subject, body
}
