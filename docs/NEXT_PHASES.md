# Next Phases – Feature Roadmap

This document outlines the next phases of development for the InfraGate platform, building on the foundation already implemented.

---

## Implemented (Phases 1–4)

| Phase | Features | Status |
|-------|----------|--------|
| **1** | Cost preview before approval, Request cloning, Export to CSV, Bulk add members, Terraform plan/output in UI, SLA tracking, Audit log viewer | ✅ |
| **2** | User types (portal/devops), Approval chain (manager → DevOps), Assignment by priority, DevOps portal (my tickets, workload view) | ✅ |
| **3** | CI/CD webhook integration, 2FA (email OTP) for login | ✅ |
| **4** | Slack notifications, Environment promotion (dev→stage→prod), Rollback to previous config, Config history UI | ✅ |

---

## Phase 5 – Security & Email (Medium Effort)

| Feature | Description | Backend | Frontend |
|---------|-------------|---------|----------|
| **Password reset** | Forgot-password flow: user requests reset → email link → set new password | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password?token=...` | Forgot password link on login; reset form |
| **Email enablement** | Real SMTP sending (currently stub); integrate at signup, approve/reject, password reset | `backend/email.go` – SendEmail via SMTP | — |
| **Slack interactive approve/reject** | Slack app with buttons to approve/reject requests from Slack (beyond webhook notifications) | Slack app + slash commands or interactive blocks | — |

**Implementation order:** Email enablement → Password reset → Slack interactive (optional).

---

## Phase 6 – Operations & Governance (Medium Effort)

| Feature | Description | Backend | Frontend |
|---------|-------------|---------|----------|
| **Rate limiting** | Per-IP or per-user request limits to prevent abuse | Middleware; Redis or in-memory store | — |
| **RBAC for teams** | Team leads can manage members (add/remove) without admin | `PATCH /api/teams/:id/members` with role check | Team detail: "Manage members" for leads |
| **API versioning** | `/api/v1/` prefix for future backward compatibility | Route prefix; deprecation headers | Update frontend base URL |
| **Health check depth** | `/health` returns DB + GitHub connectivity status | Extend health handler | — |
| **Webhook on approve** | POST to configurable URL when request approved | Config: `WEBHOOK_APPROVE_URL`; call on approve | Admin: webhook URL config |

---

## Phase 7 – Analytics & UX (Higher Effort)

| Feature | Description | Backend | Frontend |
|---------|-------------|---------|----------|
| **Dashboard widgets** | Customizable dashboard layout (drag-and-drop cards) | Store layout in DB or localStorage | Admin + User dashboards |
| **Request analytics** | Charts: requests by team/env/cloud over time; avg time to approval | `GET /api/admin/analytics/requests` | Admin dashboard charts |
| **SLA breach alerts** | Proactive alerts when request exceeds SLA (email/Slack) | Cron or event-driven; notify assignee | — |
| **Dark mode (admin)** | Toggle for admin UI dark mode | — | Admin layout theme toggle |

---

## Phase 8 – Advanced Integrations (Optional)

| Feature | Description | Effort |
|---------|-------------|--------|
| **Microsoft Teams** | Notify on new request / approval (like Slack) | Low |
| **PagerDuty / Opsgenie** | Create incident when critical request fails | Medium |
| **Terraform Cloud** | Trigger runs from approved requests | High |
| **Cost dashboard** | Infracost integration; show cost trends per team/env | Medium |

---

## Implementation Checklist (Phase 5)

- [ ] Add `backend/email.go` with SMTP SendEmail
- [ ] Add `SMTP_*` to `.env.example` (already present)
- [ ] `POST /api/auth/forgot-password` – create reset token, send email
- [ ] `POST /api/auth/reset-password` – validate token, set new password
- [ ] Forgot password link on user + admin login pages
- [ ] Reset password page (public, token in URL)

---

## Implementation Checklist (Phase 6)

- [ ] Rate limiting middleware (e.g. `golang.org/x/time/rate`)
- [ ] `GET /api/teams/:id` – include `can_manage` for current user
- [ ] `PATCH /api/teams/:id/members` – allow team lead (role=manager) to add/remove
- [ ] `/api/v1/` route prefix (optional, can defer)
- [ ] Extend `GET /health` with DB ping, optional GitHub check
- [ ] `WEBHOOK_APPROVE_URL` – call on approve in `notifications.go`

---

## Quick Reference: Config Additions

```bash
# Phase 5 – Email (see .env.example)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@example.com

# Phase 6 – Webhook
WEBHOOK_APPROVE_URL=https://your-webhook.example.com/approved

# Phase 6 – Rate limit (optional)
RATE_LIMIT_RPM=60
```

---

## Related Docs

- [DEVOPS_FEATURE_PLAN.md](./DEVOPS_FEATURE_PLAN.md) – Part 1 & 2 (user types, approval chain)
- [FEATURE_GUIDE.md](./FEATURE_GUIDE.md) – Admin secret, email, delete teams, suggestions
- [ADMIN_FEATURES_SUGGESTIONS.md](./ADMIN_FEATURES_SUGGESTIONS.md) – Admin UI ideas
