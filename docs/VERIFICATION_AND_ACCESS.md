# Verification and User-Based Access

## Overview

- **Email verification**: New users start with `verified=false`. They can view history and stats but cannot create PRs until verified.
- **Roles**: `viewer` (default), `contributor`, `admin`. Only **contributor** and **admin** can create PRs (and must be verified).

## Verification

1. **Signup**: User is created with `verified=false`, `role=viewer`, and a verification token (24h expiry).
2. **Verify via link**: Send users to `/verify-email?token=<token>`. The backend does not send email by default; you can integrate an email provider or use the admin API to set users as verified.
3. **Resend verification**: From Profile, users can click "Resend verification email". The backend generates a new token; you can plug in email sending to send the link (e.g. `https://your-app/verify-email?token=<token>`).

## User-Based Access for Creating PRs

- **Create PR** (`POST /create-pr`) requires:
  - `Authorization: Bearer <token>` (valid login token).
  - User must be **verified**.
  - User **role** must be `contributor` or `admin`.

- **Viewers** can use the app (home, history, stats, profile) but cannot create PRs. The create PR form shows a permission message and the submit button is disabled.

## Admin API (optional)

Set `ADMIN_SECRET` in your environment. Then you can:

### Set user role

```bash
curl -X PATCH "http://localhost:8080/api/users/USER_ID/role" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{"role": "contributor"}'
```

Roles: `viewer`, `contributor`, `admin`.

### Set user as verified (no email needed)

```bash
curl -X PATCH "http://localhost:8080/api/users/USER_ID/verify" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

Use this to verify users manually or in environments where email is not configured.

## Quick test without email

1. Sign up a user.
2. Get the user ID from the database or from `/api/me` after login (response includes `user.id`).
3. Set `ADMIN_SECRET` in config.
4. Call `PATCH /api/users/USER_ID/verify` and `PATCH /api/users/USER_ID/role` with body `{"role": "contributor"}`.
5. User can now create PRs.
