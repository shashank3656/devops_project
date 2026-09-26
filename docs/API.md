# SetuOps — API reference

Every HTTP route registered by the Go backend (`backend/main.go`) is listed here. Feature behaviour is in [FEATURES.md](./FEATURES.md).

Base URL: `NEXT_PUBLIC_API_URL` (local default `http://localhost:8080`).

Live stubs: `GET /swagger.json`, `GET /api-docs` (the in-process spec is incomplete; this file is the source of truth).

---

## Conventions

### Auth

| Audience | How |
| --- | --- |
| User portal | `Authorization: Bearer <token>` from `POST /api/auth/login`. Browser key: `token`. Tokens are HMAC-signed HS256 JWTs. Legacy `userID:unix` values return 401. |
| Admin portal | Bearer token with `role=admin`, **or** `X-Admin-Secret: $ADMIN_SECRET` plus `ADMIN_BREAKGLASS_USER_ID`. Browser key: `admin_token`. |
| DevOps portal | Bearer token. User must be `user_type=devops_user` **or** `role=admin`. Browser key: `devops_token`. |
| DevOps manager | Same as DevOps, plus `devops_profiles.is_manager = true`. Many write routes require this. |
| Inbound webhooks | `X-CI-Secret` / `X-SetuOps-Secret` / `X-Webhook-Secret` matching `CHANGE_WEBHOOK_SECRET`, `ALERT_WEBHOOK_SECRET`, `CI_WEBHOOK_SECRET`, or an Admin inbound source. **Or** `X-Hub-Signature-256: sha256=<hex>` HMAC of the raw body. Unsigned posts return **401**. |

Do not mix portal tokens. A user token on a DevOps route returns 403.

### Errors

JSON: `{ "error": "<message>", "status": "error" }`. Common codes: `400` bad input, `401` missing/invalid token, `403` wrong role, `404` not found, `409` conflict, `428` promotion/intel gate needs acknowledgement, `503` database down.

`OPTIONS` is allowed on all routes (CORS).

### Query filters used in many list routes

`project_id`, `environment`, `status`, `q` (search), `change_type`, `team`, `cloud`.

---

## Public / probes

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness. `{ status, time, database, cache, github, pending_approval_count, dependencies }`. |
| GET | `/ready` | none | Readiness. **503** if Postgres (or enabled Redis) is down. |
| GET | `/swagger.json` | none | Partial OpenAPI 3 stub. |
| GET | `/api-docs` | none | Swagger UI wrapper. |

---

## Auth and account

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/signup` | none | `{ username, email, password }` | Creates unverified viewer. Password min 6. Conflict if username/email taken. `otp_for_testing` is returned only when `ALLOW_TEST_OTP=true` and `APP_ENV` is not production. |
| POST | `/api/auth/login` | none | `{ username_or_email, password }` or `{ email, password }` | Returns `{ token, user }`. If 2FA is on, returns a challenge then call verify-2fa. Blocked when portal SSO is required (except admin). |
| GET | `/api/public/sso/options` | none | `?portal=user\|devops` | `{ enabled, mode, provider, login_url }`. OIDC login_url defaults to `/api/auth/oidc/start`. |
| GET | `/api/auth/oidc/start` | none | `?portal=` | Redirects to the IdP. |
| GET | `/api/auth/oidc/callback` | none | `code`, `state` | Exchanges the code and redirects to the portal `/login?sso_token=`. |
| POST | `/api/auth/sso/login` | `X-SSO-Auth-Secret` if set | directory user JSON | Existing JIT/SSO session mint (IdP adapters). |
| POST | `/api/auth/workload/github` | GitHub OIDC JWT | Bearer token or `{ token }` | Verifies Actions OIDC (`aud` default `setuops`). Then assumes `AWS_WORKLOAD_ROLE_ARN` with `repo:` subject. Response `exchange` may include short-lived creds; they are not persisted. |
| POST | `/api/auth/workload/gitlab` | GitLab OIDC JWT | Bearer token or `{ token }` | Verifies GitLab CI OIDC (`aud` default `setuops`). Same cloud-role exchange using `project:` subject. |
| POST | `/api/auth/forgot-password` | none | `{ email }` | Sends reset email using `FRONTEND_URL`. |
| POST | `/api/auth/reset-password` | none | `{ token, password }` | Sets a new password. |
| POST | `/api/auth/verify-2fa` | pending | `{ code }` or `{ token, code }` | Completes 2FA login. |
| GET | `/api/verify-email` | none | `?token=` | Marks email verified. |
| POST | `/api/verify-otp` | none | `{ email, otp }` | Verifies signup OTP. |
| POST | `/api/resend-verification` | user | — | Resends OTP / link. |
| GET | `/api/me` | user | — | Current user + role + user_type. |
| GET | `/api/me/workspace` | user | — | Attention Home: `needs_you`, `failed`, `pipeline`, `activity`. |
| POST | `/api/change-password` | user | `{ current_password, new_password }` | Change password. |
| GET | `/api/me/2fa` | user | — | 2FA status. |
| POST | `/api/me/2fa` | user | enable payload | Enable 2FA. |
| DELETE | `/api/me/2fa` | user | — | Disable 2FA. |
| GET | `/api/me/api-keys` | session only | — | List automation keys. |
| POST | `/api/me/api-keys` | session only | `{ name, scopes }` | Create a key (secret shown once). |
| DELETE | `/api/me/api-keys/:id` | session only | — | Revoke a key. |
| GET | `/api/me/notification-preferences` | user | — | Email/Slack prefs. |
| PATCH | `/api/me/notification-preferences` | user | prefs object | Update prefs. |
| GET | `/api/me/notifications` | user | `?since=` | Inbox. `since` returns `updated_count` for the badge. |
| POST | `/api/me/notifications` | user | `{ ids }` or mark-all | Mark read. |

`PATCH /api/users/:id/role` and `PATCH /api/users/:id/verify` accept `X-Admin-Secret` (bootstrap). Prefer `/api/admin/users/:id`.

---

## User — requests, history, helpers

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| POST | `/api/request` | user | `{ team, env, cloud, service, project_id, config, template_id, … }` | Create an infra request. Status is pending manager or pending DevOps. |
| GET | `/api/request/:id` | user | — | Request detail (must be visible to the user). |
| POST | `/create-pr` | verified contributor / admin | same shape as request | Skip the queue and open a GitOps PR immediately. Rare; most users use `/api/request`. |
| GET | `/api/history` | user | `?project_id=&environment=`/`env=` `&team=&status=` | The user's requests. ScopeBar sends project and environment. |
| GET | `/api/history/:id` | user | — | Single history row + `delivery` (pipeline/SHA/promote snapshot, BRD-08). |
| GET | `/api/stats` | user | — | Home counters. |
| GET | `/api/search` | user | `?q=` | Search requests / projects / templates. |
| GET | `/api/golden-paths` | user | — | Suggested request paths. |
| GET | `/api/cost-guardrail` | user | query | Whether the filled form exceeds policy. |
| POST | `/api/cost-estimate` | user | request-shaped body | Estimated monthly cost. |
| POST | `/api/copilot` | signed-in | `{ query, path, title, portal, context }` | Grounded reply with `citations[]` and optional `rollback`. Refuses apply. |
| GET | `/api/templates` | user | — | Published templates. |
| GET | `/api/templates/:id` | user | — | Template detail / schema. |
| GET | `/api/logs/cloud` | user | `?cloud=` | Cloud activity for the user's work. |
| GET | `/api/logs/github` | user | — | GitHub activity for the user's PRs. |
| GET | `/api/me/saved-configs` | user | — | Saved form drafts. |
| POST | `/api/me/saved-configs` | user | config object | Save a draft. |
| GET/PATCH/DELETE | `/api/me/saved-configs/:id` | user | — | One draft. |
| GET | `/api/me/pending-manager-approval` | user | — | Count of requests waiting on this user as team lead. |

---

## User — projects, teams, changes, incidents

| Method | Path | Auth | Query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/me/projects` | user | — | Visible projects. |
| GET | `/api/me/projects/:id` | user | — | One project. |
| GET | `/api/me/teams` | user | — | Teams. **403** if the user is in none (onboarding signal). |
| GET | `/api/me/managed-teams` | user | — | Teams this user can manage. |
| GET | `/api/me/teams/:id/members` | manager | — | Members. |
| POST | `/api/me/teams/:id/members` | manager | `{ user_id }` | Add member. |
| GET | `/api/me/changes` | user | `project_id`, `environment`, `status`, `q`, `change_type` | CHGs on visible projects only. Unmapped CHGs omitted. |
| GET | `/api/me/changes/:id` | user | — | One CHG if visible. Includes `delivery`, cost delta, policy status, `blast_radius`, and live-vs-CHG `drift`. |
| GET | `/api/me/scorecards` | user | `environment` | Scorecards for services on visible projects, including live-vs-CHG drift. |
| GET | `/api/me/incidents` | user | `project_id`, `environment`, `status` | Assigned to the user **or** on a visible project. |
| GET | `/api/me/incidents/:id` | user | — | One INC if visible. Includes generated `review` and saved `postmortem` (read). |

---

## Admin — people and teams

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/workspace` | admin | — | Attention Home: `needs_you`, `failed`, `pipeline`, `activity`. |
| GET | `/api/admin/users` | admin | — | Directory (portal + devops metadata). |
| POST | `/api/admin/users` | admin | `{ username, email, password, user_type, … }` | Create a portal or DevOps user. |
| GET | `/api/admin/users/:id` | admin | — | Profile. |
| PATCH | `/api/admin/users/:id` | admin | profile fields | Update. |
| DELETE | `/api/admin/users/:id` | admin | — | Delete. |
| GET | `/api/admin/devops-users` | admin | — | Dropdown for ticket reassignment. |
| GET | `/api/admin/teams` | admin | — | All teams. |
| POST | `/api/admin/teams` | admin | `{ name, default_env, default_cloud }` | Create team. |
| GET | `/api/admin/teams/:id` | admin | — | Team + members. |
| PATCH | `/api/admin/teams/:id` | admin | `{ default_env, default_cloud }` | Update defaults. |
| DELETE | `/api/admin/teams/:id` | admin | — | Delete team. |
| POST | `/api/admin/teams/:id/members` | admin | `{ user_id, role }` | Add member. |
| PATCH | `/api/admin/teams/:id/members/:user_id` | admin | `{ role }` | Change member role. |
| DELETE | `/api/admin/teams/:id/members/:user_id` | admin | — | Remove member. |
| GET | `/api/admin/access-review` | admin | — | Access review directory. |
| GET | `/api/admin/team-ownership` | admin | — | Team ↔ project map. |
| GET | `/api/admin/user-activity` | admin | — | Login / action trail. |
| GET | `/api/admin/audit-log` | admin | — | Admin audit entries. |

---

## Admin — requests, analytics, projects, templates

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/requests` | admin | filters | All infra requests. |
| GET | `/api/admin/requests/:id` | admin | — | Detail (secrets masked). |
| POST | `/api/admin/requests/:id/approve` | admin | optional note | Approve; may open GitOps PR. |
| POST | `/api/admin/requests/:id/reject` | admin | `{ reason }` | Reject. |
| PATCH | `/api/admin/requests/:id/status` | admin | `{ status }` | `in_progress` / `completed` / `rejected`. |
| POST | `/api/admin/requests/:id/reassign` | admin | `{ devops_user_id }` | Reassign. |
| POST | `/api/admin/requests/bulk-approve` | admin | `{ ids: number[] }` | Bulk approve. |
| POST | `/api/admin/requests/bulk-reject` | admin | `{ ids, reason }` | Bulk reject. |
| POST | `/api/admin/requests/bulk-status` | admin | `{ ids, status }` | Bulk status. |
| GET | `/api/admin/stats` | admin | — | Global request stats. |
| GET | `/api/admin/dashboard-stats` | admin | — | Dashboard tiles. |
| GET | `/api/admin/analytics/requests` | admin | — | Trend, by team/env/cloud, SLA. |
| GET | `/api/admin/sla-breach-check` | admin | — | Find at-risk tickets, notify, mark notified. |
| GET | `/api/admin/notifications` | admin | — | Admin inbox. |
| GET | `/api/admin/projects` | admin | — | Project catalog. |
| POST | `/api/admin/projects` | admin | project fields | Create. |
| GET | `/api/admin/projects/:id` | admin | — | Detail. |
| PATCH | `/api/admin/projects/:id` | admin | fields | Update. |
| GET | `/api/admin/project-analytics` | admin | — | Per-project volume. |
| GET | `/api/admin/templates` | admin | — | List. |
| POST | `/api/admin/templates` | admin | template | Create. |
| GET | `/api/admin/templates/:id` | admin | — | Detail. |
| PUT | `/api/admin/templates/:id` | admin | template | Replace. |
| DELETE | `/api/admin/templates/:id` | admin | — | Delete. |
| GET | `/api/admin/request-bundle-normalization` | admin | — | Preview legacy bundle rewrite. |
| POST | `/api/admin/request-bundle-normalization` | admin | — | Apply rewrite. |
| GET/POST | `/api/admin/saved-views` | admin | view object | Persist list filters. |
| GET/PATCH/DELETE | `/api/admin/saved-views/:id` | admin | — | One saved view. |

---

## Admin — integrations and read catalogs

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/webhooks` | admin | — | Outbound destinations. |
| POST | `/api/admin/webhooks` | admin | `{ url, events, secret }` | Create outbound webhook. Events include `incident.opened`, `incident.owner_paged`, `watch.failed`, `watch.ended`, `change.updated`. |
| PATCH | `/api/admin/webhooks/:id` | admin | fields | Update. |
| DELETE | `/api/admin/webhooks/:id` | admin | — | Delete. |
| GET/PUT | `/api/admin/sso/settings` | admin | provider, portal modes, JIT, claim flags | Enable OIDC / directory SSO. |
| POST | `/api/admin/sso/sync` | admin | — | Run directory sync now. |
| GET | `/api/admin/sso/audit` | admin | — | SSO audit entries. |
| GET | `/api/admin/inbound-sources` | admin | — | Extra inbound secrets (kinds: `change`, `alert`, `grafana`, …). |
| POST | `/api/admin/inbound-sources` | admin | `{ kind, name, secret }` | Add a source. Secret is stored hashed. |
| PATCH/DELETE | `/api/admin/inbound-sources/:id` | admin | — | Disable or remove. |
| GET | `/api/admin/changes` | admin | same filters as DevOps list | Full CHG catalog (read). |
| GET | `/api/admin/changes/:id` | admin | — | One CHG (read). Includes cost delta, policy status, `blast_radius`, and live-vs-CHG `drift`. |
| GET | `/api/admin/scorecards` | admin | `project_id`, `environment` | Read-only service scorecards, including live-vs-CHG drift. |
| GET | `/api/admin/evidence` | admin | `project_id`, `from`, `to`, `format=md` | 30-day evidence pack (JSON or Markdown). |
| GET | `/api/admin/incidents` | admin | `status` | Full INC catalog (read). |
| GET | `/api/admin/incidents/:id` | admin | — | One INC (read). Includes generated `review` and saved `postmortem`. |
| GET | `/api/admin/deploy-intelligence/feed` | admin | — | Read-only intel stream. |

---

## DevOps — session, workspace, people

| Method | Path | Auth | Query / body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/me` | devops | — | User + devops profile (`is_manager`). |
| GET | `/api/devops/workspace` | devops | — | Attention Home: `needs_you`, `failed`, `pipeline`, `activity`. |
| GET | `/api/devops/my-teams` | devops | — | Teams this DevOps user belongs to. |
| POST | `/api/devops/teams/:id/members` | manager | `{ user_id }` | Add a DevOps teammate. |
| GET | `/api/devops/users` | manager | — | DevOps users (workload filter). |
| GET | `/api/devops/users?audience=portal` | manager | — | **All portal users** for CHG Assigned-to. |
| GET | `/api/devops/dashboard-stats` | manager | — | Overview tiles. |
| GET | `/api/devops/notifications` | manager | — | Inbox. |
| GET | `/api/devops/workload` | manager | — | Open / in-progress / completed-this-week by team and person. |
| GET/POST | `/api/devops/saved-views` | devops | view | Persist filters. |
| GET/PATCH/DELETE | `/api/devops/saved-views/:id` | devops | — | One view. |

---

## DevOps — infra requests and approvals

| Method | Path | Auth | Query / body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/tickets` | devops | — | Tickets assigned to **me**. |
| GET | `/api/devops/requests` | manager | `id`, `team`, `project_id`, `env`/`environment`, `cloud`, `status`, `requester`, `sort`, `at_risk` | Full queue. ScopeBar sends project and environment. |
| GET | `/api/devops/requests/:id` | manager | — | Inspector payload includes `delivery` (CI/plan/promote snapshot). |
| POST | `/api/devops/requests/:id/approve` | manager | optional note | Approve and open GitOps PR. |
| POST | `/api/devops/requests/:id/reject` | manager | `{ reason }` | Reject. |
| POST | `/api/devops/requests/bulk-approve` | manager | `{ ids }` | Bulk approve. |
| POST | `/api/devops/requests/bulk-reject` | manager | `{ ids, reason }` | Bulk reject. |
| GET | `/api/devops/pending-approvals` | manager | — | `pending_devops_approval` only. |
| GET | `/api/devops/deployment-gate-approvals` | devops | — | Gate history, including high-risk merge acks. |
| GET | `/api/devops/approval-sla` | devops | — | Time-in-queue. |
| GET | `/api/devops/approval-notification-analytics` | devops | — | Who was notified, who responded. |
| GET | `/api/devops/pr-impact` | devops | repo/PR query | Diff / blast radius for a GitOps PR. |
| GET | `/api/devops/prs/:number/...` | devops | — | Impact for a numbered PR. |
| GET | `/api/devops/project-options` | devops | — | Project picker. |
| GET | `/api/devops/project-analytics` | devops | — | Volume by project. |

---

## DevOps — Change Requests

`change_requests` is unique on `(repo, sha, environment)`. Empty environment is stored as `unspecified`.

**Record shape (response `change`):** `id`, `change_number` (`CHG0000123`), `project_id`, `project_name`, `project_code`, `service`, `environment`, `repo`, `pr_number`, `pr_url`, `sha`, `previous_sha`, `title`, `author`, `summary`, `files[]`, `pipeline_url`, `change_type`, `status`, `watch_minutes`, `watch_started_at`, `watch_until`, `request_id`, `linked_incidents`, `baseline`, `latest_metrics`, `watch_remaining_minutes`, `rollback_hint`, `cab_status`, `cab_window_start`, `cab_window_end`, `linked_incident_id`, `assignee_user_id`, `assignee_username`, `priority`, `risk_level`, `impact`, `backout_plan`, `created_at`, `updated_at`.

| Method | Path | Auth | Query / body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/changes` | manager | `project_id`, `environment`, `status`, `q`, `change_type` | Catalog. |
| GET | `/api/devops/changes?mode=preview` | manager | — | Next `change_number` for the form. |
| POST | `/api/devops/changes` | manager | see body below | Manual create. Title required. Environment not required. |
| GET | `/api/devops/changes/:id` | manager | — | `{ change, change_brief, linked_incidents, blast_radius, drift, delivery }`. |
| PATCH | `/api/devops/changes/:id` | manager | `{ status }` | Move status (`resolved`, `closed`, `failed`, `cancelled`, `implementing` / `reopen`). Blocked if linked incidents are still open. |
| POST | `/api/devops/changes/:id/resolve` | manager | — | Watch/deploy succeeded. |
| POST | `/api/devops/changes/:id/close` | manager | — | Formal close. Prefer after resolved. |
| POST | `/api/devops/changes/:id/fail` | manager | — | Deploy failed. |
| POST | `/api/devops/changes/:id/cancel` | manager | — | Never shipped. |
| POST | `/api/devops/changes/:id/reopen` | manager | — | Back to `implementing`. |
| POST | `/api/devops/changes/:id/cab-approve` | manager | — | CAB approve. |
| POST | `/api/devops/changes/:id/rollback` | manager | — | Record emergency CHG to `previous_sha`. Does not apply. Freeze/CAB still apply. |
| GET | `/api/devops/change-calendar` | devops | — | Planned windows. |
| GET | `/api/devops/change-risk` | devops | — | Risk view. |
| GET | `/api/devops/release-notes` | devops | — | Weekly notes from closed CHGs. |

**Manual / webhook body** (`parsedChangeWebhook`):

```json
{
  "title": "required",
  "service": "payments-api",
  "repo": "acme/payments",
  "sha": "abc123",
  "project_id": 0,
  "project_code": "",
  "pr_number": 42,
  "pr_url": "https://github.com/acme/payments/pull/42",
  "previous_sha": "",
  "author": "ada",
  "summary": "",
  "pipeline_url": "",
  "change_type": "standard",
  "status": "implementing",
  "watch_minutes": 30,
  "assignee_user_id": 12,
  "priority": "medium",
  "risk_level": "low",
  "impact": "",
  "backout_plan": "",
  "planned_start": "2026-09-25T10:00",
  "planned_end": "2026-09-25T11:00",
  "cab_window_start": "",
  "cab_window_end": ""
}
```

Omit `environment` so `service_map` can fill service / project / env. If `repo` or `sha` is empty on a **manual** POST, the API sets `repo=manual` and `sha=manual-{nano}`. Assignee must be a portal user.

---

## DevOps — Services (CMDB-lite)

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/services` | devops | `project_id`, `environment`, `q` | Catalog used by the CHG dropdown. |
| POST | `/api/devops/services` | manager | `{ name, project_id, environment, repo, … }` | Create / upsert. |
| GET | `/api/devops/services/:id` | devops | — | One service. |

---

## DevOps — Incidents, problems, runbooks

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/incidents` | manager | `project_id`, `environment`, `status`, `source`, `q` | List + `teams` + `team_members_by_team` + `callers` + `categories` + SLA. |
| GET | `/api/devops/incidents?mode=preview` | manager | — | Next `incident_number`. |
| POST | `/api/devops/incidents` | manager | `{ title, severity, source, request_id, caller_user_id, category, subcategory, parent_incident_id, … }` | Manual INC. `request_id` optional. Sets P1–P4 SLA clocks. |
| GET | `/api/devops/incidents/:id` | manager | — | Incident plus `rollback`, `review`, `postmortem`, `journal`, children, and SLA. |
| PATCH | `/api/devops/incidents/:id` | manager | status / owner / catalogs / conference | Update. In Progress meets response SLA; Resolved meets resolve SLA. |
| GET/POST | `/api/devops/incidents/:id/journal` | manager | `{ kind, body }` | Work note (`work_note`) or customer comment (`comment`). |
| GET/POST | `/api/devops/incidents/:id/review` | manager | — | Read or generate a PIR draft from the INC timeline. Does not create a new ticket. Completed reviews are left alone. |
| POST | `/api/devops/incidents/:id/rollback` | manager | — | Record emergency CHG to the linked change `previous_sha`. Does not apply. |
| GET | `/api/devops/incident-workspace` | devops | — | Shared major-incident notes plus generated `review`. |
| POST | `/api/devops/incident-workspace` | manager | `{ incident_id, generate: true }` or postmortem fields | Generate a draft or save notes on the same INC. |
| GET | `/api/devops/itsm-catalog` | devops | — | Caller categories and default SLA policy (P1 15m/4h … P4 8h/120h). |
| GET | `/api/devops/problems` | devops | — | Problem records. |
| POST | `/api/devops/problems` | manager | problem fields | Create. |
| GET | `/api/devops/problems/:id` | manager | — | Detail + journal + linked KB. |
| POST | `/api/devops/problems/:id/journal` | manager | `{ kind, body }` | Work note or customer comment. |
| POST | `/api/devops/problems/:id/knowledge` | manager | — | Publish a KB article from a known error. |
| GET | `/api/devops/knowledge` | devops | — | Knowledge articles. |
| GET | `/api/devops/knowledge/:id` | devops | — | One article. |
| GET | `/api/devops/runbooks` | devops | — | List. |
| POST | `/api/devops/runbooks` | manager | `{ title, body, service }` | Create. |
| GET/PATCH/DELETE | `/api/devops/runbooks/:id` | devops / manager | — | One runbook. |

---

## DevOps — Health, SLO, watcher input

| Method | Path | Auth | Query / body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/health` | devops | `project_id`, `environment` | Watch window, baseline vs latest, SLO, live-vs-CHG drift, rollback hint, DORA. |
| GET/POST | `/api/devops/slos` | devops / manager | SLO object | List or create an SLO. |

Watcher samples also arrive on `POST /api/webhooks/watch-metrics` (below). The scheduler runs about every two minutes.

---

## DevOps — Promotions, rollback, freezes, on-call

| Method | Path | Auth | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/promotions` | devops | — | Pending promotions. |
| POST | `/api/devops/promotions` | manager | `{ request_id, to_env, acknowledge? }` | Promote. Success includes the hop `change`. May return **428** until `high_risk_merge_acknowledged`. |
| POST | `/api/devops/promotions/:id/...` | manager | — | Per-promotion actions (ack / apply). |
| GET | `/api/devops/rollback-console` | devops | — | Rollback candidates. |
| POST | `/api/devops/rollback-console` | manager | target | Execute rollback. |
| GET/POST | `/api/devops/freezes` | manager | `{ starts_at, ends_at, reason }` | Change freeze window. |
| GET/POST | `/api/devops/oncall` | devops | rotation | Who is on call. |

---

## DevOps — Deploy intelligence

| Method | Path | Auth | Body / query | What it does |
| --- | --- | --- | --- | --- |
| GET | `/api/devops/deploy-intelligence` | devops | — | Catalog of onboarded repos + open PRs + briefs. |
| GET/POST | `/api/devops/deploy-intelligence/repos` | devops / manager | `{ owner, repo, … }` | List or onboard a GitHub repo. Open PRs are fetched even if the repo is not a GitOps project. |
| POST | `/api/devops/deploy-intelligence/suggest-ticket` | manager | PR identity | Suggest an infra ticket from a PR. |
| POST | `/api/devops/deploy-intelligence/protect-branch` | manager | `{ owner, repo, branch }` | Apply branch protection so the `infragate/deploy-intel` check is required. |

Check run name stays `infragate/deploy-intel`.

---

## DevOps — GitOps and projects

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/api/devops/gitops/projects` | devops | Mapped GitOps projects. |
| GET | `/api/devops/gitops/preview` | devops | Preview `request.json` for a ticket. |
| GET | `/api/devops/gitops/manage` | devops | Management payload. |
| POST | `/api/devops/gitops/manage/projects` | manager | Create mapping. |
| PATCH | `/api/devops/gitops/manage/projects/:id` | manager | Update mapping. |
| POST | `/api/devops/gitops/manage/project-files` | manager | Add a tracked file. |
| POST | `/api/devops/gitops/manage/access` | manager | Grant GitOps access. |
| DELETE | `/api/devops/gitops/manage/access/:id` | manager | Revoke access. |
| GET | `/api/devops/projects` | devops | Project catalog. |
| POST | `/api/devops/projects` | manager | Create. |
| GET/PATCH | `/api/devops/projects/:id` | devops / manager | Detail / update. |
| POST | `/api/devops/projects/bulk` | manager | Bulk create/update. |
| POST | `/api/devops/projects/team-access/bulk` | manager | Bulk team grants. |
| GET | `/api/devops/project-dependencies` | devops | Edges between projects/services. |
| GET/POST | `/api/devops/templates` | devops | Same template catalog as Admin. |
| GET/PUT/DELETE | `/api/devops/templates/:id` | devops | One template. |

---

## DevOps — Kubernetes

All require a DevOps user. Writes (onboard, actions, terminal) typically require a manager.

| Method | Path | What it does |
| --- | --- | --- |
| GET/POST | `/api/devops/k8s-connections` | List or onboard a cluster connection. GET returns `auth_modes_by_cloud` (AWS EKS IAM, Azure AKS workload identity, GCP GKE workload identity, `secret_ref`, kubeconfig/token, in-cluster). POST encrypts pasted secrets at rest; `secret_ref` resolves on the server only. |
| POST | `/api/devops/k8s-connections/test` | DevOps manager — validate HTTPS endpoint, trust JSON, and secret ref before save. |
| GET | `/api/devops/k8s-overview` | Cross-cluster summary. |
| GET | `/api/devops/k8s-clusters` | Cluster list. |
| GET | `/api/devops/k8s-cluster-detail` | One cluster. |
| GET | `/api/devops/k8s-workloads` | Deployments / statefulsets / jobs. |
| GET | `/api/devops/k8s-rollout-detail` | One rollout. |
| GET | `/api/devops/k8s-pods` | Pods. |
| GET | `/api/devops/k8s-pod-detail` | One pod. |
| GET | `/api/devops/k8s-activity` | Recent cluster activity. |
| GET | `/api/devops/k8s-pod-exec-profile` | Exec policy for terminal. |
| GET | `/api/devops/k8s-logs` | Log query. |
| GET | `/api/devops/k8s-log-stream` | Stream. |
| GET | `/api/devops/k8s-log-attach` | Attach to a stream. |
| GET | `/api/devops/k8s-services` | Services. |
| GET | `/api/devops/k8s-ingresses` | Ingresses. |
| GET | `/api/devops/k8s-ingress-detail` | One ingress. |
| GET | `/api/devops/k8s-secrets` | Secret names (not values). |
| GET | `/api/devops/k8s-configmaps` | ConfigMaps. |
| GET | `/api/devops/k8s-storage` | PVCs / storage classes. |
| GET | `/api/devops/k8s-events` | Events. |
| GET | `/api/devops/k8s-certificates` | Certs. |
| POST | `/api/devops/k8s-workload-actions` | Restart / scale. |
| POST | `/api/devops/k8s-terminal-launch` | Start an exec session. |
| GET | `/api/devops/k8s-terminal-session` | Session status. |
| GET | `/api/devops/k8s-terminal-attach` | Attach. |
| POST | `/api/devops/k8s-terminal-command` | Send a command. |

---

## DevOps — operations extras

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/api/devops/ops-command-center` | devops | Combined ops snapshot. |
| GET | `/api/devops/environment-drift` | devops | Drift vs desired. |
| POST | `/api/devops/environment-drift/fix` | manager | Apply a drift fix. |
| GET | `/api/devops/cost-digest` | devops | Cost rollup. |
| GET | `/api/devops/service-heatmap` | devops | Hot services. |
| GET | `/api/devops/identity` | devops | Static-key flags, configured `workload_role` / `gcp_service_account`, `last_exchange` (no secrets), and recent OIDC findings. |
| GET | `/api/devops/previews` | devops | Ephemeral preview environments and estimated cost. Merge graduates a standard CHG; close without merge cancels. |
| POST | `/api/devops/changes/:id/rollout` | manager | `{ stage: canary|10|50|100 }` progressive delivery. |
| GET | `/api/devops/scorecards` | devops | Service scorecards from the catalog + CHG/INC/SLO + live-vs-CHG drift. |
| GET | `/api/devops/environment-catalog` | devops | Environment catalog for accessible projects. Query `project_id` optional. Rows include type, linked cloud account, default cluster/region, owners, and active freeze from `deployment_freezes`. |
| GET | `/api/devops/operator-activity` | devops | Append-only DevOps operator audit (`devops_operator_audit_log`). Query: `project_id`, `environment`, `resource_type` + `resource_id`, `limit`, `offset`. No secrets in payloads. Scoped to visible projects. |
| GET | `/api/devops/cloud/accounts` | devops | Cloud accounts for teams the user belongs to. No secrets in response. |
| POST | `/api/devops/cloud/accounts` | manager (member of target devops team) | Onboard **AWS, Azure, or GCP** with provider-specific trust fields (`role_arn`, optional `external_id`, or `static_ref` env name). Runs server connection test on create. Credentials stay on server. |
| GET | `/api/devops/cloud/accounts/:id` | devops | Account detail if user's DevOps team matches `team_slug`. |
| PATCH | `/api/devops/cloud/accounts/:id` | manager (same team) | Update `display_name`, `environments`, `status` (`disabled` / re-enable), or rotate trust (`auth_mode`, `role_arn`, `external_id`, `secret_ref`, optional `retest`, default true). Trust updates audit as `cloud_account_trust_update`. |
| POST | `/api/devops/cloud/accounts/:id/test` | manager (same team) | Server-side connection test (AWS STS when host creds exist; Azure/GCP/AWS validate trust inputs). Sets `connected` or `error` with generic client message. |
| GET | `/api/admin/cloud/accounts` | admin | Read-only catalog of all onboarded accounts. |
| GET | `/api/devops/cloud/resources` | devops | Paginated read-only inventory for **`cloud`** (`aws` / `azure` / `gcp`). Rows limited to **DevOps teams the user belongs to**. When accounts exist for that cloud, only **connected** account IDs for those teams appear. Query: `team`, `account_id`, `environment`, `region`, `q`, `project_id`, `page`, `limit`. |
| GET | `/api/devops/cloud/resources/:id` | devops | Single inventory row if `team_slug` is visible to the user. |

**DevOps UI (no extra API):** Account-scoped inventory landing is `/cloud-resources/account?cloud=&account_id=` — it calls the same list endpoint with `account_id` set. See [FEATURES.md](./FEATURES.md) § Cloud workspace.
| GET | `/api/devops/evidence` | devops | Evidence pack. `?format=md` downloads Markdown. |
| GET | `/api/devops/policies` | devops | Stored Rego deny rules. |
| POST | `/api/devops/policies` | manager | `{ name, target, rego }` target `change` or `request`. |
| GET | `/api/devops/credential-audit` | devops | Cloud key audit. |
| POST | `/api/devops/expiry-tracker/actions` | manager | Act on expiring credentials. |
| GET/POST | `/api/devops/access-overrides` | manager | Time-boxed extra access. |
| DELETE | `/api/devops/access-overrides/:id` | manager | End an override. |
| GET | `/api/devops/retry-center` | devops | Failed notify / webhook retries. |
| POST | `/api/devops/retry-center/:id` | manager | Retry one. |
| GET/PATCH | `/api/devops/notification-settings` | manager | Slack/email routing. |

---

## Inbound webhooks

All of these reject unsigned bodies with **401**. Prefer `X-CI-Secret` for CI and `X-Hub-Signature-256` for GitHub-style HMAC.

### `POST /api/webhooks/change`

Secret: `CHANGE_WEBHOOK_SECRET` (also accepts `CI_WEBHOOK_SECRET` and inbound sources of kind `change`).

Creates or updates a Change Request. Idempotent on `repo + sha + environment`.

Call this from application CI after merge to `main`. Omit `environment` so the service catalog can fill it. Same SHA + repo + resolved env updates the existing CHG.

See the **Manual / webhook body** above. Extra fields CI usually sends: `files[]` (optional; not on the DevOps form), `sbom_url`, `attestation_url`, `image_digest`, `signed`, `provenance`, `cost_delta_usd`, `cost_monthly_after`, `infracost_report`.

### `POST /api/webhooks/alerts`

Secret: `ALERT_WEBHOOK_SECRET` (plus `CI_WEBHOOK_SECRET` and inbound sources of kind `alert` / `grafana` / `alertmanager` / `generic_log`).

Accepts Grafana, Alertmanager, or a generic `{ fingerprint, severity, title, message, service, environment, status, labels }` body. Firing with the same fingerprint updates the same INC. Resolving marks it resolved. If a CHG for that service is still in its watch window, `suspected_change_id` is set. Labels `pagerduty_incident` / `grafana_alert_uid` / `opsgenie_alert` attach the IRM id.

### `POST /api/webhooks/irm` and `/api/webhooks/irm/:provider`

Same alert secrets. PagerDuty, Grafana IRM, or Opsgenie payloads ack/resolve the matching INC (or open one). SetuOps also writes back on DevOps incident PATCH when `PAGERDUTY_API_KEY` / `GRAFANA_IRM_URL` / `OPSGENIE_API_KEY` are set.

### `POST /mcp` and `GET /mcp`

JSON-RPC MCP. Auth: Bearer session token or API key. Read tools: `list_changes`, `get_change`, `list_incidents`, `get_incident`, `ask_catalog`, `health_for_service`, `list_identity_findings`, `list_tickets`, `get_ticket`, `list_scorecards`. `get_change` returns `{ change, blast_radius, drift, rollback }`. `ask_catalog` cites catalog IDs and never applies. `get_incident` includes rollback and the generated review. Write tools (`GET /mcp` `write_tools`): `comment_incident`, `request_rollback`. Same freeze/CAB as the portal; terraform/kubectl apply is refused. `GET /mcp` is the discovery document.

### `POST /api/webhooks/flags`

Same change secrets. LaunchDarkly / Unleash / Flagsmith style JSON. Creates a `flag` CHG.

### `POST /api/otlp/v1/metrics` and `POST /v1/metrics`

Change or alert secrets. OTLP JSON `resourceMetrics` or `{ service, p95_ms, error_ratio }`. Updates watching CHGs and `service_metric_latest`.

### `POST /api/webhooks/watch-metrics`

Secret: same family as alerts / CI.

Pushes `{ service, environment, latency_ms, error_rate, … }` samples into `change_watch_samples` for the Health watcher.

### `POST /api/webhooks/ci`

Secret: `CI_WEBHOOK_SECRET`.

Infra pipeline events: Terraform plan, Infracost, apply success/fail. Attached to an infra **request**, not a CHG.

### `POST /api/webhooks/github`

GitHub webhook secret. PR opened/synced/closed → Deploy intel change brief + `infragate/deploy-intel` check run.

### `POST /api/webhooks/slack` / `POST /api/webhooks/teams`

ChatOps slash commands (on-call, status). Signed with the Slack/Teams app secret.

---

## Example: record a Change Request from GitHub Actions

```yaml
- name: Record SetuOps change
  env:
    SETUOPS_URL: ${{ secrets.SETUOPS_API_URL }}
    SETUOPS_SECRET: ${{ secrets.CHANGE_WEBHOOK_SECRET }}
  run: |
    jq -n \
      --arg repo "$GITHUB_REPOSITORY" \
      --arg sha "$GITHUB_SHA" \
      --arg title "${{ github.event.head_commit.message }}" \
      --arg author "${{ github.actor }}" \
      --arg service "${GITHUB_REPOSITORY#*/}" \
      --arg pr_url "${{ github.event.pull_request.html_url }}" \
      --arg pipeline_url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
      '{
        repo: $repo,
        sha: $sha,
        title: $title,
        author: $author,
        service: $service,
        pr_url: $pr_url,
        pipeline_url: $pipeline_url,
        change_type: "standard",
        priority: "medium",
        risk_level: "low",
        watch_minutes: 30
      }' | curl -sS -X POST "$SETUOPS_URL/api/webhooks/change" \
        -H "Content-Type: application/json" \
        -H "X-CI-Secret: $SETUOPS_SECRET" \
        --data-binary @-
```

Do **not** send a hardcoded `environment: dev` or `pr_number: 0`. The full sample is also on DevOps **Changes** and in [CICD.md](./CICD.md).

---

## Route count (registered in `main.go`)

About **196** `http.HandleFunc` paths. Sub-routes (`/approve`, `/close`, `/cab-approve`, `/members`, …) are extra methods on those prefixes and are listed in the tables above.
