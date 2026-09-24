# SetuOps — All features and how they work

This is the product feature catalog. Every shipped surface is listed here with **what it is**, **who uses it**, **how it works**, and **where it lives**.

The matching HTTP contract is in [API.md](./API.md). Notion narrative lives at:

- Portal hub: https://app.notion.com/p/3e50f430ed10816699fec83b1b270288
- Change / Incident / Health BRD: https://app.notion.com/p/3e50f430ed1081adb731c7f64bdfa1b2

The display name is **SetuOps**. GitHub check IDs still use `infragate/*`.

---

## How to read this

SetuOps is one Go API and three Next.js portals:

| Portal | Folder | Port | Token in the browser | Who |
| --- | --- | --- | --- | --- |
| User | `frontend/` | 3000 | `token` | Developers and team leads |
| Admin | `admin-frontend/` | 3001 | `admin_token` | Platform and IAM admins |
| DevOps | `devops-frontend/` | 3002 | `devops_token` | Platform engineers and SRE |

Landing pages are **catalogs**. Forms open only after Onboard / Create / Edit.

Workspace scope (`project_id`, `environment`) is stored in `localStorage` key `setuops-workspace-scope` and in the URL. The ScopeBar at the top of each portal filters lists to that project and environment.

---

## The two work paths

### Path A — Infrastructure request (ticket)

1. User picks a project, cloud, environment, and a template (or custom JSON).
2. SetuOps stores a request. Approval rules decide if a **team manager** must sign first.
3. If a manager is required, status is `pending_user_manager`. After that sign-off, status becomes `pending_devops_approval`.
4. DevOps reviews the ticket (cost, policy, Terraform plan, PR impact) and approves or rejects.
5. Approve opens a **GitOps PR** with `request.json` in the project's GitOps repo.
6. CI and Deploy intel comment on that PR. After merge, DevOps can **promote** the change `dev → uat → prod`.
7. Kubernetes, Health, and Rollback stay available for day-2 work.

### Path B — Application deploy (Change Request)

1. Application CI merges to `main` and POSTs `/api/webhooks/change`.
2. SetuOps creates or updates a Change Request (`CHG0000123`). Same `repo + sha + environment` is idempotent.
3. Environment is optional on the webhook. If omitted, the **Services** catalog (`service_map`) fills service, project, and environment.
4. DevOps can also create a CHG by hand on `/changes/new`. Users and Admins never create CHGs.
5. A watch window starts. The watcher compares baseline vs latest latency/errors.
6. Grafana or a logger can POST `/api/webhooks/alerts`. Repeat fingerprints update the same Incident (`INC…`).
7. If the watcher sees a spike inside the watch window, it opens a `change_regression` incident and links it to the CHG.

---

## Shared concepts

| Concept | How it works |
| --- | --- |
| Catalog-first | List pages show existing records. Create / Onboard / Edit is a separate route. |
| ScopeBar | Filters catalogs by project and environment across all three portals. |
| Golden path / template | A saved request shape (cloud + service + fields). Users pick one instead of writing Terraform. |
| GitOps project | Mapping from a SetuOps project to a GitHub repo/path where `request.json` is written. |
| Service map | CMDB-lite. A named service belongs to a project and (optionally) a default environment. Feeds the CHG form dropdown and webhook fill-in. |
| Change Request | Record of an application deploy. Numbered `CHG%07d`. Owned by DevOps. Readable in Admin (all) and User (visible projects only). Unmapped CHGs (no `project_id`) are hidden from the user portal. |
| Incident | Page from a person, Grafana, logger, or the watcher. Numbered `INC…`. `request_id` is optional (alert-driven incidents are not ticket-tied). |
| Health | Post-release watch: watch window, baseline vs latest metrics, SLO, rollback hint, DORA from CHGs. |
| Deploy intel | Onboarded GitHub repos get a change brief and `infragate/deploy-intel` check run on PRs. |
| Promotion | Move an approved infra change through environments with gate policies. |
| Freeze | Blocks promotions / high-risk merges during a window. |
| Problem | Recurring-incident record (P4). One problem can cover many incidents. |

---

## User portal

Who: developers and team leads. They ask for infrastructure and watch their own work. They do **not** create Change Requests.

### Sign in and account

| Feature | Page | How it works |
| --- | --- | --- |
| Login | `/login` | `POST /api/auth/login`. Stores `token`. User must be `portal_user` (or a permitted role) to use this portal. |
| Signup | `/signup` | `POST /api/auth/signup`. Creates an unverified viewer. OTP is emailed (or returned in testers' responses). |
| Verify email / OTP | `/verify-email`, `/verify-required` | `GET /api/verify-email`, `POST /api/verify-otp`, `POST /api/resend-verification`. |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Emails a reset link using `FRONTEND_URL`. |
| 2FA | `/profile` | `GET/POST/DELETE /api/me/2fa` then `POST /api/auth/verify-2fa` at login. |
| Profile / password | `/profile` | `GET /api/me`, `POST /api/change-password`. |
| API keys | `/profile` | `GET/POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id`. Session token only; keys are for automation. |
| Notification prefs | `/profile` | `GET/PATCH /api/me/notification-preferences`. |

### Home and search

| Feature | Page | How it works |
| --- | --- | --- |
| Home | `/home` | Cards for new request, my requests, projects, changes, incidents. Uses `/api/stats` and workspace. |
| Notifications | header + `/notifications` | `GET /api/me/notifications` (optional `since=` for badge). `POST` marks read. |
| Command palette / search | header | `GET /api/search?q=` across requests, projects, templates. |
| Copilot | support hub | `POST /api/copilot` for in-app help. |

### Infrastructure requests

| Feature | Page | How it works |
| --- | --- | --- |
| New request catalog | `/create-infrastructure` | Lists golden paths and templates. Does not open a form until the user picks one. |
| New request form | `/create-infrastructure/new`, `/create-infrastructure/iam`, `/select-service`, `/custom-json`, `/aws` | User fills project, env, cloud, service, and template fields. Cost estimate (`POST /api/cost-estimate`) and cost guardrail (`GET /api/cost-guardrail`) run before submit. |
| Submit request | same forms | `POST /api/request`. Status starts as pending manager or pending DevOps depending on team rules. |
| Request success | `/request-success` | Confirmation with request id. |
| My requests | `/history` | `GET /api/history`. Filter by team/status. Badge uses `updated_at` vs last-seen. |
| Request detail | `/history` row → `/api/history/:id` or `/api/request/:id` | Shows status, config (masked secrets), comments, CI plan output. |
| Saved configs | forms | `GET/POST /api/me/saved-configs` so a user can reuse a filled form. |
| Manager inbox | Home badge | `GET /api/me/pending-manager-approval`. Team leads approve their people's requests before DevOps sees them. |
| Templates (read) | `/templates`, `/templates/[id]` | `GET /api/templates`. Users pick; they do not author the catalog. |

### Projects and teams

| Feature | Page | How it works |
| --- | --- | --- |
| My projects | `/my-projects` | `GET /api/me/projects`. Projects the user can see via team membership. |
| Project detail | `/my-projects/[id]` | `GET /api/me/projects/:id`. Requests and recent activity for that project. |
| My teams | `/my-teams` | `GET /api/me/teams`. Empty teams return 403 so the user knows they are not onboarded. |
| Manage team members | `/my-teams` (managers) | `GET /api/me/managed-teams`, `GET/POST /api/me/teams/:id/members`. Portal managers add teammates. They cannot invent admin or DevOps users. |

### Changes and Incidents (read)

| Feature | Page | How it works |
| --- | --- | --- |
| Changes catalog | `/changes` | `GET /api/me/changes`. Only CHGs whose `project_id` is in the user's visible projects. Unmapped CHGs stay hidden. |
| Change detail | `/changes/[id]` | `GET /api/me/changes/:id`. Status, assignee, priority, risk, watch window, linked incidents. Files only if CI sent them. |
| Incidents catalog | `/incidents` | `GET /api/me/incidents`. Incidents assigned to the user **or** on a visible project. |
| Incident detail | `/incidents/[id]` | `GET /api/me/incidents/:id`. Source (`ticket`, `alert`, `manual`, `change_regression`), severity, suspected CHG. |

Users cannot create, close, CAB-approve, or edit Changes or Incidents.

---

## Admin portal

Who: platform / IAM admins (`role=admin`). They own people, access, templates, and integrations. They do **not** own the CHG or INC queue (read catalogs only).

### Directory

| Feature | Page | How it works |
| --- | --- | --- |
| Overview | `/dashboard` | `GET /api/admin/dashboard-stats`, `/api/admin/stats`, `/api/admin/workspace`. Counts of users, pending requests, SLA risk. |
| Users | `/users` | `GET /api/admin/users`. Create portal users or DevOps users (`/users/new`, `/users/new-devops`). Edit `/users/[id]/edit`. |
| Teams | `/teams`, `/teams/new`, `/teams/[id]` | Create teams, set default env/cloud, add/remove members, change member role. |
| Access review | `/access-review` | `GET /api/admin/access-review`. Who has what, stale access. |
| Team ownership | `/team-ownership` | `GET /api/admin/team-ownership`. Which team owns which project. |
| User activity | `/activity` | `GET /api/admin/user-activity` plus `/api/admin/audit-log`. |

### Requests and governance

| Feature | Page | How it works |
| --- | --- | --- |
| Approval center | `/approval-center` | Admin view of pending requests. Can approve / reject / reassign / bulk-status. Approving as admin can create the GitOps PR when that is the configured path. |
| Requests catalog | `/requests` | `GET /api/admin/requests`. Full list, not scoped to one user. |
| SLA | `/sla` | `GET /api/admin/analytics/requests`, `GET /api/admin/sla-breach-check`. Marks at-risk tickets and notifies. |
| Project catalog | `/projects`, `/projects/[id]` | Create/edit projects, attach teams. |
| Project setup | `/project-governance` | Bundle normalization and project defaults. |
| Templates | `/templates`, `/templates/new`, `/templates/[id]/edit` | Admin authors the catalog users pick from. |
| Maintenance | `/maintenance` | Legacy bundle normalization preview/apply (`/api/admin/request-bundle-normalization`). |

### Integrations and read catalogs

| Feature | Page | How it works |
| --- | --- | --- |
| Outbound webhooks | `/webhooks`, `/webhooks/new` | Slack / generic HTTP destinations for request and change events. |
| Inbound sources | `/webhooks/inbound/new` | Extra secrets for change/alert webhooks besides env vars. Stored hashed; used by `inboundWebhookAuthorized`. |
| Changes (read) | `/changes`, `/changes/[id]` | `GET /api/admin/changes`. Full catalog. No create. |
| Incidents (read) | `/incidents`, `/incidents/[id]` | `GET /api/admin/incidents`. Full catalog. No create. |
| Deploy intel feed | `/deploy-intelligence` | `GET /api/admin/deploy-intelligence/feed`. Read-only stream of briefs. |

---

## DevOps portal

Who: `devops_user` (and admins for some template routes). **Managers** (`is_manager`) own the request queue, CHGs, incidents, promotions, and GitOps writes.

### Overview and requests

| Feature | Page | How it works |
| --- | --- | --- |
| Overview | `/dashboard` | `GET /api/devops/dashboard-stats`, `/api/devops/workspace`. Open tickets, pending approvals, watching CHGs, open INCs. |
| My tickets | `/tickets` | `GET /api/devops/tickets` — tickets assigned to the current user. |
| Request list / actions | `/tickets` + inspector | `GET /api/devops/requests` (filters: id, team, cloud, status, requester, at_risk). `POST /api/devops/requests/:id/approve` or `/reject`. Bulk approve/reject. Approve opens the GitOps PR. |
| Workload | `/workload` | `GET /api/devops/workload`. Open / in-progress / completed-this-week by team and person. Manager only. |
| Notifications | header | `GET /api/devops/notifications`. |

### Approvals

| Feature | Page | How it works |
| --- | --- | --- |
| Queue | `/approval-center` | `GET /api/devops/pending-approvals`. Manager signs the ticket. |
| History | `/gate-approvals` | `GET /api/devops/deployment-gate-approvals`. Past gate decisions, including high-risk merge acknowledgements. |
| Rules | `/gate-policies`, `/gate-policies/[id]` | Who must sign for which env / risk. Used by promotions and deploy-intel. |
| Timing | `/approval-sla` | `GET /api/devops/approval-sla`. How long tickets sit in each queue. |

### Changes

| Feature | Page | How it works |
| --- | --- | --- |
| Catalog | `/changes` | `GET /api/devops/changes`. Filters: `project_id`, `environment`, `status`, `q`, `change_type`. Webhook sample is on this page. |
| New change | `/changes/new` | `POST /api/devops/changes`. Title required. Service from Services catalog. Assigned to = all portal users (`GET /api/devops/users?audience=portal`). No environment field (filled from service map or stored as `unspecified`). No files field. Priority, risk, planned window, impact, backout. If repo/sha empty, backend sets `repo=manual` and `sha=manual-{nano}`. |
| Change detail | `/changes/[id]` | `GET /api/devops/changes/:id`. Actions: Resolve, Close, Fail, Cancel, Reopen, CAB approve. Resolve/close blocked while linked incidents are open. A clean watch auto-resolves. |
| Services catalog | `/services` | `GET /api/devops/services`. Feeds the CHG dropdown. |
| Add service | `/services/new` | `POST /api/devops/services`. Name + project (and optional default env). |
| Service detail | `/services/[id]` | `GET /api/devops/services/:id`. |
| Calendar | `/change-calendar` | `GET /api/devops/change-calendar`. Planned windows and CAB slots. |
| Release notes | `/release-notes` | `GET /api/devops/release-notes`. Weekly notes assembled from closed CHGs. |
| Change risk | `/change-risk` | `GET /api/devops/change-risk`. Risk heatmap for upcoming changes. |

### Incidents and problems

| Feature | Page | How it works |
| --- | --- | --- |
| Open incidents | `/incidents` | `GET /api/devops/incidents`. Status filter. Includes teams and assignees for the create form. |
| New incident | `/incidents/new` | `POST /api/devops/incidents`. Manual page. Can link a ticket or a suspected CHG. |
| Edit / assign | `/incidents/[id]/edit` | `PATCH /api/devops/incidents/:id`. Status, owner, severity, notes. |
| Incident workspace | `/incident-workspace` | Shared notes while an INC is major. |
| Problems | `/problems`, `/problems/[id]` | Recurring-issue records. Link many INCs. |

Alert-created incidents skip the form: Grafana POSTs `/api/webhooks/alerts`. Same fingerprint updates the existing INC.

### Health

| Feature | Page | How it works |
| --- | --- | --- |
| Health | `/health` | `GET /api/devops/health?project_id=&environment=`. Watch window, baseline vs latest, SLO burn, rollback hint, DORA. |
| New SLO | `/health/slo/new` | `POST /api/devops/slos`. Latency/error budget for a service. |
| Watcher | background (every ~2 min) | `startChangeWatcherScheduler`. Pulls `/api/webhooks/watch-metrics` samples or stored samples. Spike inside the CHG watch window opens `change_regression`. |

### Promotions, GitOps, Deploy intel

| Feature | Page | How it works |
| --- | --- | --- |
| Promotions | `/promotions` | List pending promotions. Acknowledge high-risk merge (`428` until `high_risk_merge_acknowledged`). Promote env. |
| GitOps control | `/gitops-control`, `/gitops-control/new`, `/gitops-control/[id]/edit` | Which repo/path receives `request.json`. Preview, access list. |
| GitOps projects | `/gitops-projects` | Registry of GitOps mappings. |
| Deploy intel catalog | `/deploy-intelligence` | Onboarded repos and open PRs. |
| Onboard repo | `/deploy-intelligence/onboard` | Registers owner/repo. After onboard, open PRs are fetched from GitHub (repo does not have to be a GitOps project). |
| Repo detail | `/deploy-intelligence/[owner]/[repo]` | Change brief, similar past merges, plan vs apply, watchlist, stack conflicts, protect-branch, suggest-ticket. Posts `infragate/deploy-intel` check. |

### Kubernetes

| Feature | Page | How it works |
| --- | --- | --- |
| Catalog | `/k8s` | Connected clusters overview. |
| Onboard | `/k8s/onboard`, `/k8s/onboard/new` | Store a kube connection (cluster name + credentials reference). |
| Cluster / workloads / pods / logs / services / ingress / secrets / configmaps / storage / events / certificates | `/k8s/...` | Live reads from the cluster via the stored connection. Terminal and log stream are attach endpoints. |
| Workload actions | cluster pages | Restart / scale via `POST /api/devops/k8s-workload-actions`. |

### Projects and day-2 ops

| Feature | Page | How it works |
| --- | --- | --- |
| Projects | `/projects`, `/projects/new`, `/projects/[id]/edit` | Catalog + bulk team access. |
| Teams | `/team` | DevOps team membership (`/api/devops/my-teams`, add members). |
| Operations | `/ops-command-center` | Combined view: freezes, drift, cost digest, on-call. |
| Environment drift | `/environment-drift` | Detect and `POST /api/devops/environment-drift/fix`. |
| Project dependencies | `/project-dependencies` | Service-to-service edges. |
| Project operations | `/project-operations` | Per-project ops shortcuts. |
| Rollback | `/rollback-console` | Suggest / execute rollback for a failed CHG or K8s rollout. |
| Runbooks | `/runbooks`, `/runbooks/new`, `/runbooks/[id]/edit` | Written procedures linked from incidents. |
| Access exceptions | `/access-overrides`, `/access-overrides/new` | Time-boxed extra access. |
| Secrets / expiry | `/credential-audit` | Audit of cloud keys + expiry actions. |
| Request templates | `/templates`… | Same catalog as Admin; DevOps can author too. |
| Alerts settings | `/notification-settings` | Slack/email routing. |
| Retries | `/retry-center` | Failed outbound webhook / notify retries. |
| Approval notify analytics | `/approval-notification-analytics` | Who was paged, who responded. |
| Freezes / on-call | Operations | `GET/POST /api/devops/freezes`, `/api/devops/oncall`. |
| Saved views | lists | `GET/POST /api/devops/saved-views`. Persist filters. |

---

## Inbound integrations (no portal form)

| Integration | Endpoint | How it works |
| --- | --- | --- |
| Change webhook | `POST /api/webhooks/change` | CI after merge to `main`. Auth: `X-CI-Secret` or `X-Hub-Signature-256`. Idempotent on `repo+sha+environment`. Omit `environment` to let service_map fill it. |
| Alert webhook | `POST /api/webhooks/alerts` | Grafana, Alertmanager, or generic logger. Same fingerprint updates one INC. |
| Watch metrics | `POST /api/webhooks/watch-metrics` | Push latency/error samples into the watcher. |
| Infra CI | `POST /api/webhooks/ci` | Terraform plan, Infracost, apply success/fail on a ticket. |
| GitHub | `POST /api/webhooks/github` | PR events for Deploy intel briefs and check runs. |
| Slack / Teams commands | `POST /api/webhooks/slack`, `/api/webhooks/teams` | ChatOps: on-call, status. |
| Outbound events | Admin webhooks | SetuOps POSTs request/change/incident events to Slack or HTTP. |

---

## Feature → portal visibility

| Feature | User | Admin | DevOps |
| --- | --- | --- | --- |
| New infra request | Create | Read / override | Review / approve |
| Manager approval | Team leads | Yes | — |
| GitOps PR | See link | See link | Create |
| Promote env | — | — | Yes |
| Change Request | Read (own projects) | Read all | Create + own |
| Manual CHG form | — | — | Yes |
| Services catalog | — | — | Yes |
| Incident | Read (assigned or project) | Read all | Create + own |
| Health / SLO / watcher | — | — | Yes |
| Deploy intel | — | Feed only | Onboard + brief |
| Kubernetes | — | — | Yes |
| People / teams | Own teams | Full | DevOps teams |
| Webhook secrets | — | Configure | Use sample on Changes |

---

## Status words you will see

**Infra request:** `pending_user_manager` → `pending_devops_approval` → `in_progress` → `completed` / `rejected`.

**Change Request:** `new` → `implementing` → `implemented` → `monitoring` → `resolved` → `closed`. Also `failed`, `cancelled`. A clean watch window **resolves** the CHG; an operator then **closes** it. Resolve/close is blocked while linked incidents are still open. Reopen brings a finished CHG back to `implementing`.

**Incident:** `draft` → `open` → `acknowledged` → `investigating` → `mitigating` → `resolved` → `closed`. Also `cancelled` (false alarm). Sources: `ticket`, `alert`, `manual`, `change_regression`. Acknowledged still counts as active.

**Priority / risk on CHG:** `low` / `medium` / `high` / `critical` (normalized from several aliases).

**Change type:** `standard` / `normal` / `emergency`.
