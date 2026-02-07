# Feature Guide: Admin Secret, Email, Delete Teams & More

## 1. Secure Admin Secret Rollout

### Current State
- `ADMIN_SECRET` enables `X-Admin-Secret` header for:
  - `PATCH /api/users/:id/role`
  - `PATCH /api/users/:id/verify`
- Admin frontend uses **Bearer token** (JWT) from `/api/auth/login`, not `X-Admin-Secret`
- `X-Admin-Secret` is for API/script access (e.g. CI/CD, automation)

### Secure Rollout Process

**Step 1: Generate a Strong Secret**
```bash
# Generate 32-byte hex secret
openssl rand -hex 32
```

**Step 2: Store in a Secret Manager (Recommended)**
- **AWS**: AWS Secrets Manager or SSM Parameter Store
- **GCP**: Secret Manager
- **Kubernetes**: Secret resource, never in ConfigMap
- **Docker**: Use secrets, not env files in version control

**Step 3: Inject at Runtime**
```bash
# Example: load from file (file not in git)
export ADMIN_SECRET=$(cat /run/secrets/admin_secret)

# Or from AWS SSM
export ADMIN_SECRET=$(aws ssm get-parameter --name /infra-portal/admin-secret --with-decryption --query Parameter.Value --output text)
```

**Step 4: Never Commit Secrets**
- Add `.env` to `.gitignore`
- Use `.env.example` with placeholders only
- Rotate secrets periodically (e.g. quarterly)

**Step 5: Optional - Hash-Compare Instead of Plaintext**
- Store `bcrypt` hash of secret in DB
- Compare incoming header with hash (slower but more secure if DB leaks)

### Recommended `.env.example` Addition
```
# ADMIN_SECRET: Use for API/script access to user management.
# Generate with: openssl rand -hex 32
# Store in secret manager, inject at runtime. Never commit.
# ADMIN_SECRET=<from-secret-manager>
```

---

## 2. Email Enablement Process

### Current State
- Email verification: OTP stored in DB, token-based verification exists
- No SMTP sending yet (stub)

### Implementation Steps

**Step 1: Choose Email Provider**
- **SendGrid** (free tier)
- **AWS SES**
- **SMTP** (self-hosted or Mailgun, Postmark)

**Step 2: Add Config to `.env`**
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<sendgrid-api-key>
SMTP_FROM=noreply@yourdomain.com
EMAIL_ENABLED=true
```

**Step 3: Create `backend/email.go`**
```go
// SendEmail sends via SMTP (or provider SDK)
func SendEmail(to, subject, body string) error {
    if os.Getenv("EMAIL_ENABLED") != "true" { return nil }
    // Use net/smtp or a library like go-mail
}
```

**Step 4: Integrate at Key Points**
- **Signup**: Send verification link/OTP email
- **Password reset**: Send reset link
- **Request approved/rejected**: Notify user
- **New request pending**: Notify admins (optional)

**Step 5: Templates**
- Use HTML templates for professional emails
- Support plain-text fallback

---

## 3. Delete Teams ✓ Implemented

- **API**: `DELETE /api/admin/teams/:id` (admin auth required)
- **Backend**: `DeleteTeam()` in `database.go`; `adminTeamDeleteHandler` in `admin_teams.go`; audit log entry on delete
- **Frontend**: Delete button on Teams list (`/teams`) and Team detail (`/teams/[id]`) with confirmation
- **DB**: `teams` has `ON DELETE CASCADE` on `team_members`; `pr_requests` stores team name as string (no FK), so they are preserved

---

## 4. More Feature Suggestions

| Feature | Description | Effort |
|---------|-------------|--------|
| **Password reset** | Forgot password flow with email link | Medium |
| **2FA / MFA** | TOTP for admin and high-privilege users | High |
| **RBAC for teams** | Team leads can manage members | Medium |
| **Request templates** | Save config as named template, quick-create | Low |
| **Webhook on approve** | POST to URL when request approved | Low |
| **Audit log export** | CSV/JSON export of admin actions | Low |
| **Rate limiting** | Per-IP or per-user request limits | Medium |
| **Health check depth** | DB + GitHub connectivity in /health | Low |
| **Request duplication** | Clone any request as new draft | Low |
| **Bulk status update** | Change status of multiple requests | Low |
| **Slack/Teams integration** | Notify on new request / approval | Medium |
| **SLA breach alerts** | Alert when request exceeds SLA | Medium |
| **Dashboard widgets** | Customizable dashboard layout | High |
| **API versioning** | `/api/v1/` prefix for future changes | Low |

---

## 5. Quick Reference

### Admin Secret
```bash
# Set (never in production .env committed to git)
export ADMIN_SECRET=your-generated-secret

# Use
curl -X PATCH http://localhost:8080/api/users/1/role \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: your-generated-secret" \
  -d '{"role":"contributor"}'
```

### Email (Stub)
```bash
# Enable when ready
export EMAIL_ENABLED=true
export SMTP_HOST=...
export SMTP_PORT=587
export SMTP_USER=...
export SMTP_PASSWORD=...
export SMTP_FROM=noreply@example.com
```
