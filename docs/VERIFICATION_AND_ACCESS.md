# Verification and User-Based Access

## Overview

- **Email verification**: New users start with `verified=false`. They can view history and stats but cannot create PRs until verified.
- **Roles**: `viewer` (default), `contributor`, `admin`. Only **contributor** and **admin** can create PRs (and must be verified).

## Verification

1. **Signup**: User is created in the database with `verified=false`, `role=viewer`, and a 6-digit **OTP** stored in `verification_token` (10-minute expiry). Signup does **not** return a login token; the user must verify with OTP first.
2. **OTP verification**: After signup, the frontend shows an OTP input. User submits the OTP via `POST /api/verify-otp` with `{"email": "...", "otp": "123456"}`. On success, the user is marked `verified=true` in the database. For local testing, the signup response includes `otp_for_testing` so you can verify without email.
3. **Verify via link** (optional): `GET /api/verify-email?token=<token>` still works for link-based verification if you send emails with a token link.
4. **Resend verification**: From Profile, unverified users can click "Resend verification email". The backend generates a new token; you can plug in email sending to send the link or OTP.

## Database storage

All auth and PR data is stored in **PostgreSQL**:

- **users**: `id`, `username`, `email`, `password` (bcrypt), `verified`, `role`, `verification_token`, `verification_token_expires_at`, `created_at`.
- **pr_requests**: PR history with `created_by` (user ID), team, env, cloud, service, status, etc.

Login uses the stored password hash; wrong password returns `401` with `"invalid username or password"`. On success, the backend returns a token; the frontend stores it and sends `Authorization: Bearer <token>` for `/api/me`, `/api/change-password`, and create-PR. If the token is missing or invalid, `/api/me` returns `401`.

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
