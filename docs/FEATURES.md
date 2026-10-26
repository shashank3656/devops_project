# OpsTrellis — All features and how they work

This is the product feature catalog. Every shipped surface is listed here with **what it is**, **who uses it**, **how it works**, and **where it lives**.

How the live screens behave is in [FLOWS.md](./FLOWS.md). The matching HTTP contract is in [API.md](./API.md). Notion narrative lives at:

- Portal hub: https://app.notion.com/p/3e50f430ed10816699fec83b1b270288
- Change / Incident / Health BRD: https://app.notion.com/p/3e50f430ed1081adb731c7f64bdfa1b2

The display name is **OpsTrellis**. GitHub check IDs still use `infragate/*`.

---

## How to read this

OpsTrellis is one Go API and one Next.js portal, `devops-frontend` (port 3002, browser token `devops_token`). The separate `frontend/` and `admin-frontend/` apps are not in this tree. Requesters, operators, managers, and admins use the same shell. Section grants decide which sidebar groups they see. There is no Sign up page. People, groups, and sign-in settings are **Portal Access**.

The tables later in this file that name a User portal or an Admin portal describe the earlier split. For on-call, IAM, change requests, incidents, problems, maintenance, and webhooks, follow [FLOWS.md](./FLOWS.md).

Landing pages are **catalogs**. Forms open only after Onboard / Create / Edit.

Workspace scope (`project_id`, `environment`) is stored in `localStorage` key `opstrellis-workspace-scope` and in the URL. The ScopeBar at the top of each portal stays visible on tablet and mobile. Changing project or environment updates tickets, changes, incidents, and Kubernetes lists. Clear empties both the URL and the local workspace key. List pages show active filter chips above the table.

---

## The two work paths

### Path A — Infrastructure request (ticket)

1. User picks a project, cloud, environment, and a template (or custom JSON).
2. OpsTrellis stores a request. Approval rules decide if a **team manager** must sign first.
3. If a manager is required, status is `pending_user_manager`. After that sign-off, status becomes `pending_devops_approval`.
4. DevOps reviews the ticket (cost, policy, Terraform plan, PR impact) and approves or rejects.
5. Approve opens a **GitOps PR** with `request.json` in the project's GitOps repo.
6. CI and Deploy intel comment on that PR. After merge, DevOps can **promote** the change `dev → uat → prod`.
7. Kubernetes, Health, and Rollback stay available for day-2 work.

### Path B — Application deploy (Change Request)

1. Application CI merges to `main` and POSTs `/api/webhooks/change`.
2. OpsTrellis creates or updates a Change Request (`CHG0000123`). Same `repo + sha + environment` is idempotent.
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
| GitOps project | Mapping from a OpsTrellis project to a GitHub repo/path where `request.json` is written. |
| Service map | CMDB-lite. A named service belongs to a project and (optionally) a default environment. Feeds the CHG form dropdown and webhook fill-in. |
| Change Request | Record of an application deploy. Numbered `CHG%07d`. Owned by DevOps. Readable in Admin (all) and User (visible projects only). Unmapped CHGs (no `project_id`) are hidden from the user portal. |
| Incident | Page from a person, Grafana, logger, or the watcher. Numbered `INC…`. `request_id` is optional (alert-driven incidents are not ticket-tied). |
| Health | Post-release watch: watch window, baseline vs latest metrics, SLO, rollback hint, DORA from CHGs. |
| Deploy intel | Onboarded GitHub repos get a change brief and `infragate/deploy-intel` check run on PRs. |
| Promotion | Move an approved infra change through environments with gate policies. |
| Freeze | Blocks promotions / high-risk merges during a window. A burned SLO writes the same row. |
| Problem | Recurring-incident record (P4). One problem can cover many incidents. |

---

## User portal

Who: developers and team leads. They ask for infrastructure and watch their own work. They do **not** create Change Requests.

Primary nav: Home, Requests, Projects, Changes, Incidents. Mobile tabs: Home, Requests, Changes, Incidents. Scorecards stays at `/scorecards` but is not a top-level item.

### Sign in and account

| Feature | Page | How it works |
| --- | --- | --- |
| Login | `/login` | `POST /api/auth/login`. Stores a signed JWT in `token`. Legacy `userID:unix` values are rejected. User must be `portal_user` (or a permitted role) to use this portal. |
| Signup | `/signup` | `POST /api/auth/signup`. Creates an unverified viewer. OTP is emailed. `otp_for_testing` is only returned when `ALLOW_TEST_OTP=true` outside production. |
| Verify email / OTP | `/verify-email`, `/verify-required` | `GET /api/verify-email`, `POST /api/verify-otp`, `POST /api/resend-verification`. |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Emails a reset link using `FRONTEND_URL`. |
| 2FA | `/profile` | `GET/POST/DELETE /api/me/2fa` then `POST /api/auth/verify-2fa` at login. |
| Profile / password | `/profile` | `GET /api/me`, `POST /api/change-password`. |
| API keys | `/profile` | `GET/POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id`. Session token only; keys are for automation. |
| Notification prefs | `/profile` | `GET/PATCH /api/me/notification-preferences`. |

User, DevOps, and Admin portals share the same profile edit blocks (password, notification prefs, 2FA, API keys, resend verification) via shared `PortalProfileSettings`. DevOps and Admin call the same `/api/me/*` routes with their session token; DevOps `GET /api/me` also returns `devops_profile` and DevOps teams.

### Home and search

| Feature | Page | How it works |
| --- | --- | --- |
| Home | `/home` | Attention dashboard from `GET /api/me/workspace`: needs my action (manager approvals, assigned tickets/incidents), failed or blocked deliveries, recent operations, and environments I own. Row click opens the existing detail. Loading, empty, and error + retry are all shown. |
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
| Request detail | `/history` row → `/api/history/:id` or `/api/request/:id` | Shows **delivery** snapshot, status, config (masked secrets), comments, CI plan output. |
| Saved configs | forms | `GET/POST /api/me/saved-configs` so a user can reuse a filled form. |
| Manager inbox | Home badge | `GET /api/me/pending-manager-approval`. Team leads approve their people's requests before DevOps sees them. |
| Templates (read) | `/templates`, `/templates/[id]` | `GET /api/templates`. Users pick; they do not author the catalog. |

### Projects and teams

| Feature | Page | How it works |
| --- | --- | --- |
| My projects | `/my-projects` | `GET /api/me/projects`. Projects the user can see via team membership. |
| Project detail | `/my-projects/[id]` | `GET /api/me/projects/:id`. Requests and recent activity for that project. |
| My teams | `/my-teams` | `GET /api/me/teams`. Empty teams return 200 with `teams: []`. The portal shows a join-a-team empty state. Expired sessions go to login. |
| Manage team members | `/my-teams` (managers) | `GET /api/me/managed-teams`, `GET/POST /api/me/teams/:id/members`. Portal managers add teammates. They cannot invent admin or DevOps users. |

### Changes and Incidents (read)

| Feature | Page | How it works |
| --- | --- | --- |
| Changes catalog | `/changes` | `GET /api/me/changes`. Only CHGs whose `project_id` is in the user's visible projects. Unmapped CHGs stay hidden. |
| Change detail | `/changes/[id]` | `GET /api/me/changes/:id`. **Delivery** card (pipeline/SHA/links), status, assignee, priority, risk, watch window, linked incidents. Files only if CI sent them. |
| Incidents catalog | `/incidents` | `GET /api/me/incidents`. Incidents assigned to the user **or** on a visible project. |
| Incident detail | `/incidents/[id]` | `GET /api/me/incidents/:id`. Source (`ticket`, `alert`, `manual`, `change_regression`), severity, suspected CHG. |

Users cannot create, close, CAB-approve, or edit Changes or Incidents.

---

## Admin portal

Who: platform / IAM admins (`role=admin`). They own people, access, templates, and integrations. They do **not** own the CHG or INC queue (read catalogs only).

Primary nav: Home, Approvals, Requests, People, Projects, Catalog, More. Mobile tabs: Home, Approvals, Requests, Projects. Changes and Incidents live under More. `/catalog` redirects to `/templates`.

### Directory

| Feature | Page | How it works |
| --- | --- | --- |
| Home | `/dashboard` | Attention dashboard from `GET /api/admin/workspace`: needs my action, failed or blocked deliveries, recent operations, and environments I own. Loading, empty, and error + retry are shown. |
| Users | `/users` | `GET /api/admin/users`. Create portal users or DevOps users (`/users/new`, `/users/new-devops`). Edit `/users/[id]/edit`. |
| Teams | `/teams`, `/teams/new`, `/teams/[id]` | Create teams, set default env/cloud, add/remove members, change member role. |
| Access review | `/access-review` | `GET /api/admin/access-review`. Who has what, stale access. |
| Team ownership | `/team-ownership` | `GET /api/admin/team-ownership`. Which team owns which project. |
| User activity | `/activity` | `GET /api/admin/user-activity` plus `/api/admin/audit-log`. |
| Profile settings | `/profile` | Same account controls as the user portal (password, 2FA, API keys, notification prefs, resend verification) via `GET /api/me` with `admin_token`. |

### Requests and governance

| Feature | Page | How it works |
| --- | --- | --- |
| Approval center | `/approval-center` | Admin view of pending requests. Can approve / reject / reassign / bulk-status. Approving as admin can create the GitOps PR when that is the configured path. |
| Requests catalog | `/requests` | `GET /api/admin/requests`. Full list, not scoped to one user. |
| SLA | `/sla` | `GET /api/admin/analytics/requests`, `GET /api/admin/sla-breach-check`. Marks at-risk tickets and notifies. |
| Project catalog | `/projects`, `/projects/[id]` | Create/edit projects, attach teams. |
| Project setup | `/project-governance` | Bundle normalization and project defaults. |
| Templates | `/templates`, `/templates/new`, `/templates/[id]/edit` | Admin authors the catalog users pick from. |
| Maintenance | `/maintenance` in the one portal | Planned window with a three-step approval. See [FLOWS.md](./FLOWS.md#maintenance). This is not bundle normalization. |

### Integrations and read catalogs

| Feature | Page | How it works |
| --- | --- | --- |
| Outbound webhooks | `/webhooks`, `/webhooks/new` | Slack / generic HTTP destinations for request and change events. |
| Inbound sources | `/webhooks/inbound/new` | Extra secrets for change/alert webhooks besides env vars. Stored hashed; used by `inboundWebhookAuthorized`. |
| Changes (read) | `/changes`, `/changes/[id]` | `GET /api/admin/changes`. Full catalog. No create. |
| Incidents (read) | `/incidents`, `/incidents/[id]` | `GET /api/admin/incidents`. Full catalog. No create. |
| Deploy intel feed | `/deploy-intelligence` | `GET /api/admin/deploy-intelligence/feed`. Read-only stream of briefs. |
| Cloud accounts (read) | `/cloud-accounts` | `GET /api/admin/cloud/accounts` — which DevOps team owns which onboarded AWS/Azure/GCP account. **No onboarding in Admin** (DevOps managers onboard). No credentials in responses. Admin does **not** get cloud **inventory** (DevOps-only). |

---

## DevOps portal

Who: `devops_user` (and admins for some template routes). **Managers** (`is_manager`) own the request queue, CHGs, incidents, promotions, and GitOps writes.

Primary nav: Home, Requests, **ITSM**, then (managers only) Deployments, Kubernetes, GitOps, Projects. **ITSM** is one expandable tree for all DevOps users — Change, Incident, and Problem records plus Knowledge: changes catalog, change calendar, services, release notes, incidents, incident notes, problems, knowledge. Parent link lands on `/changes`. Write actions on those pages still follow manager RBAC on the API. Health, policy as code, evidence, and credential audit stay under **More tools** (managers). `/gitops` redirects to `/gitops-projects`; `/deployments` redirects to `/promotions`. Mobile tabs: Home, Requests, ITSM, Kubernetes.

### Home and requests

| Feature | Page | How it works |
| --- | --- | --- |
| Home | `/dashboard` | Attention dashboard from `GET /api/devops/workspace`: needs my action, failed or blocked deliveries (including failed CHGs), recent operations, and environments I own. Freeze and on-call stay in the aside. Loading, empty, and error + retry are shown. |
| My tickets | `/tickets` | `GET /api/devops/tickets` — tickets assigned to the current user. |
| Request list / actions | `/tickets` + inspector | `GET /api/devops/requests` (filters: id, team, cloud, status, requester, at_risk). Inspector shows **delivery** (pipeline/SHA/promote) plus plan/policy/cost checks. `POST /api/devops/requests/:id/approve` or `/reject`. Bulk approve/reject. Approve opens the GitOps PR. |
| Workload | `/workload` | `GET /api/devops/workload`. Open / in-progress / completed-this-week by team and person. Manager only. |
| Notifications | header | `GET /api/devops/notifications`. |
| Profile settings | `/profile` | Same account controls as the user portal (password, 2FA, API keys, notification prefs) plus read-only DevOps role/teams from `GET /api/me`. |

### Approvals

| Feature | Page | How it works |
| --- | --- | --- |
| Approval queue | `/approval-center` | `GET /api/devops/pending-approvals`. Manager signs the ticket. |
| Promotion history | `/gate-approvals` | `GET /api/devops/deployment-gate-approvals`. Past gate decisions, including high-risk merge acknowledgements. |
| Promotion rules | `/gate-policies`, `/gate-policies/[id]` | Who must sign for which env / risk. Used by promotions and deploy-intel. |
| Approval timing | `/approval-sla` | `GET /api/devops/approval-sla`. How long tickets sit in each queue. |
| Policy as code | `/policies` | Rego deny rules. Not a primary nav item; lives under More tools. |

### Changes

| Feature | Page | How it works |
| --- | --- | --- |
| Catalog | `/changes` | `GET /api/devops/changes`. Filters: `project_id`, `environment`, `status`, `q`, `change_type`. Webhook sample is on this page. |
| New change | `/changes/new` | `POST /api/devops/changes`. Title required. Service from Services catalog. Assigned to = all portal users (`GET /api/devops/users?audience=portal`). No environment field (filled from service map or stored as `unspecified`). No files field. Priority, risk, planned window, impact, backout. If repo/sha empty, backend sets `repo=manual` and `sha=manual-{nano}`. |
| Change detail | `/changes/[id]` | `GET /api/devops/changes/:id` includes **delivery** (repo, SHA, pipeline links, rollout/promote state). Actions: Resolve, Close, Fail, Cancel, Reopen, CAB approve. Resolve/close blocked while linked incidents are open. A clean watch auto-resolves. |
| Services catalog | `/services` | `GET /api/devops/services`. Feeds the CHG dropdown. |
| Add service | `/services/new` | `POST /api/devops/services`. Name + project (and optional default env). |
| Service detail | `/services/[id]` | `GET /api/devops/services/:id`. |
| Calendar | `/change-calendar` | `GET /api/devops/change-calendar`. Planned windows and CAB slots. |
| Release notes | `/release-notes` | `GET /api/devops/release-notes`. Weekly notes assembled from closed CHGs. |
| Change risk | `/change-risk` | `GET /api/devops/change-risk`. Risk heatmap for upcoming changes. |

### Cloud workspace (NF-01 + BRD-07)

OpsTrellis **Cloud workspace** is two linked catalogs in the DevOps portal: **Accounts** (trust + onboarding) and **Inventory** (read-only resource catalog). Credentials and connection tests stay on the **API host**; portals never receive keys, external IDs, or secret refs in API responses.

#### End goal

Give platform engineers a **team-scoped, multi-cloud view** of what already exists in AWS, Azure, and GCP **before** day-2 actions, incidents, or changes — without opening three vendor consoles. Inventory rows are meant to come from **connected onboarded accounts** (NF-01). The UI is **read-only** today; guarded day-2 actions (NF-05) use onboarded account scope for disable/trust flows and complement inventory identity (team, account, environment, region, resource id).

**Today:** resources are stored in `cloud_resources` (demo seed + DB provider). **Next:** live sync from cloud APIs using onboarded trust (`CloudInventoryProvider` abstraction).

#### Who uses what

| Persona | Portal | Cloud accounts (NF-01) | Cloud inventory (BRD-07) |
| --- | --- | --- | --- |
| **DevOps operator** (team member, not manager) | DevOps | List and open accounts for **DevOps teams they belong to**. Test/trust/onboard **not** allowed. | List, filter, open resources and **account landing** for those teams. **Read-only.** |
| **DevOps manager** (`devops_profile.is_manager`) | DevOps | **Onboard** AWS/Azure/GCP, **test connection**, disable/re-enable, **rotate trust** for teams they manage. | Same read-only inventory as operators; no mutate-from-inventory. |
| **Admin** | Admin | **Read-only catalog** of all onboarded accounts (`GET /api/admin/cloud/accounts`) — which team owns which account. No onboarding in Admin UI. | No Admin inventory UI (DevOps-only surface). |
| **User** (developer / portal) | User | **No access.** Users request infra via templates/tickets; they do not onboard cloud accounts or browse inventory. | **No access.** |

RBAC: inventory and account **reads** require DevOps auth and **team membership**; writes (onboard, PATCH trust, test) require **manager on the account’s DevOps team**. See [RBAC_ENDPOINTS.md](./RBAC_ENDPOINTS.md) and [RBAC_MATRIX.md](./RBAC_MATRIX.md) (inventory is explicitly read-only; no per-resource IAM grants).

#### Hub navigation

DevOps **Cloud workspace** uses shared hub nav: **Accounts** ↔ **Inventory**, plus provider pills (**AWS / Azure / GCP**). ScopeBar **project** and **environment** apply to inventory lists where configured.

### Cloud accounts (NF-01)

| Feature | Page | How it works |
| --- | --- | --- |
| Account catalog | `/cloud-accounts` | `GET /api/devops/cloud/accounts` — accounts for teams you belong to. Filter by provider/status/search. Empty, error, and retry states. No credentials in responses. |
| Onboard | `/cloud-accounts/new` | `POST /api/devops/cloud/accounts` — **AWS, Azure, or GCP** with provider-specific trust fields (IAM role, Azure scope/tenant, GCP service account). DevOps **manager on that team** only. Server runs an immediate connection test; secrets never returned to the client. In-app **trust setup guide** per provider. |
| Account detail | `/cloud-accounts/[id]` | Provider setup guide, test connection, disable/re-enable. Managers can **rotate trust** (role / external ID / secret ref) with automatic re-test. Link **View inventory** opens **account landing** for that provider + account id. |
| Admin view | Admin `/cloud-accounts` | `GET /api/admin/cloud/accounts` — which team owns which account (read-only). |

### Cloud inventory (BRD-07)

| Feature | Page | How it works |
| --- | --- | --- |
| Resource list | `/cloud-resources` | `GET /api/devops/cloud/resources` — read-only inventory with **AWS / Azure / GCP** selector (`?cloud=`). Limited to **your DevOps teams** and **connected** onboarded account IDs for that cloud. Server pagination; ScopeBar `project_id` / `environment`; team, account, region, and search filters. URL `?account_id=` pre-fills account filter. |
| Account landing | `/cloud-resources/account?cloud=&account_id=` | Same list API scoped to one account: summary strip (resource count, envs/regions on page), resource table, links to **Connection & trust** (onboarded record) and **All inventory**. Click **Account** column from the main list to open this page. |
| Resource detail | `/cloud-resources/[id]` | `GET /api/devops/cloud/resources/:id`. Aligned label/value detail (team, region, account link, resource id). **Account overview** button → account landing. No credentials in API responses. |

Notion: [NF-01 Cloud Account Onboarding](https://app.notion.com/p/3e60f430ed10810793f7c3c1ae2d9a82) · [BRD-07 Cloud Resource Inventory](https://app.notion.com/p/3e60f430ed10810a8e2accfa0ca11116)

### Environment catalog (NF-03)

**Who:** DevOps users on projects their team owns or is granted; managers see all projects.

| Feature | Page | How it works |
| --- | --- | --- |
| Catalog | `/environments` | `GET /api/devops/environment-catalog` — per-project environments with type, linked **cloud account** (NF-01), **default cluster** (NF-02 onboard), region/owners metadata, and **freeze** from `deployment_freezes`. Managers can **Edit metadata** (`PATCH` same route). Project detail links **View catalog**. |
| ScopeBar | Header (all DevOps pages) | When a project is selected, environment dropdown loads catalog names for that project instead of hardcoded `dev/uat/prod`. |
| Home pipeline | `/dashboard` | Pipeline stages mark env-specific freezes; queue surfaces active env freezes with link to catalog. Respects ScopeBar `project_id` on workspace load. |

Notion: [NF-03 Environment Catalog](https://app.notion.com/p/3e60f430ed1081408816e01b8a36daf9)

### Operator audit trail (NF-04)

| Feature | Page | How it works |
| --- | --- | --- |
| Activity catalog | `/activity` (ITSM tree) | `GET /api/devops/operator-activity` — append-only log mirrored from DevOps writes (approve/reject/promote/rollback, K8s day-2, cloud account, templates). Filter by ScopeBar `project_id` / `environment`; reloads when scope changes. |
| Ticket detail | `/tickets` inspector | `GET /api/devops/requests/:id` includes `operator_activity` (last 10) merged into Request Activity timeline. Successful promote also writes an event on the **source** request id. |
| Cloud account detail | `/cloud-accounts/[id]` | Same API returns `operator_activity` (last 10) for the account. |
| Home recent ops | `/dashboard` | `GET /api/devops/workspace` activity feed merges operator audit rows (visible projects) with request/incident updates. |
| K8s resource activity | K8s drill-down APIs | K8s operator feed reads `devops_operator_audit_log` (falls back to legacy admin audit if table missing). |
| Failed promote / gate | API | Blocked/failed promote or **blocked gate approve** writes `result=blocked` or `failed` with a safe summary (no secrets). |

Notion: [NF-04 Operator Audit Trail](https://app.notion.com/p/3e60f430ed10810298b4d9a214383335)

### Guarded day-2 actions (NF-05)

| Feature | Page | How it works |
| --- | --- | --- |
| Pre-flight context | Shared confirm | `GET /api/devops/guarded-action-context` loads freeze, open incidents, delivery SHA, and permission outcome before destructive confirms. |
| K8s restart / scale / resume | `/k8s/workloads` | Managers only (actions column hidden for contributors); **ConfirmProvider** shows freeze/incidents/image/SHA; server enforces manager RBAC, project access, and **blocks** mutating actions during an env freeze (**409** + audit). |
| Promote | `/promotions` | Confirm shows target env, freeze, and incidents; frozen prod promote blocked server-side with reason in audit. |
| Rollback prepare | `/rollback-console` | Confirm before draft rollback request; failed prepare writes operator audit. |
| Disable cloud account | `/cloud-accounts/[id]` | Managers on the account team only (test/disable hidden for others); destructive confirm before `status=disabled`; re-enable stays a one-click action. |
| Activity refresh | Home / `/activity` | Successful day-2 actions dispatch scope refresh so operator activity reloads without a full page refresh. |

Notion: [NF-05 Guarded Day-2 Actions](https://app.notion.com/p/3e60f430ed1081e3b453fc319f80b588)

### Resource context panel (NF-07)

Read-only **Resource context** on DevOps surfaces where operators decide — without new mutate actions from the panel.

| Surface | Route | How it works |
| --- | --- | --- |
| Ticket inspector | `/tickets` drawer | `GET /api/devops/resource-context?kind=ticket&id=` — target-env freeze, open incidents, catalog row, promote gate hints (NF-05 parity), last 5 operator events on the request. Loads in parallel; inspector works if the panel API fails. |
| Change detail | `/changes/[id]` | Same API with `kind=change` — delivery scope, catalog, freeze/incidents for the promote hop, operator activity from linked request or project/env. |
| Cloud resource | `/cloud-resources/[id]` | `kind=cloud_resource` — disabled account messaging, catalog env row, incidents when linked to a project, account-level operator audit. |

Shared UI: `ResourceContextPanel` in `@infragate/ui`.

Notion: [NF-07 Resource Context Panel](https://app.notion.com/p/3e70f430ed1081e3a844f62961c2cc28)

### Inventory ↔ catalog links (NF-06)

Cross-links between cloud inventory, onboarded accounts, and the environment catalog (ScopeBar-friendly query params).

| Surface | Links |
| --- | --- |
| `/cloud-resources` | Account column → account landing; env column → catalog search |
| `/cloud-resources/[id]` | Connection & trust (onboarded account), filtered inventory, environment catalog |
| `/environments` | Cloud account → `/cloud-accounts/[id]`; **View inventory** per row |
| `/cloud-accounts/[id]` | Linked catalog rows + inventory deep links |

List/detail inventory APIs may include **`account_context`** (disabled / not onboarded messaging) and resource detail includes **`catalog_links`** when a catalog row shares the onboarded account + environment.

Login **email OTP (2FA)**: codes are sent with `SendEmail` (SMTP required). UIs never show `otp_for_testing`; use **Resend code** on the login step. DevOps login supports the same 2FA flow as User and Admin.

### Kubernetes workspace (NF-02)

**Who:** DevOps operators and managers (`devops_token`). User and Admin portals have no K8s workspace.

**End goal:** One **cluster-scoped workspace** instead of ~15 sibling top-level routes — pick **cluster → namespace → resource type**, then drill into pod logs, terminal, or rollout detail without losing context.

| Feature | Page | How it works |
| --- | --- | --- |
| Cluster catalog | `/k8s` | Onboarded cluster list (unchanged landing). ScopeBar `project_id` / `environment`. Row opens **workspace**. |
| Cluster workspace | `/k8s/workspace?cluster_name=&…` | Overview + resource-type tabs (workloads, pods, networking, config, events, logs). Query preserves `project_id`, `cluster_name`, `namespace`, `environment`. |
| Resource lists | `/k8s/workloads`, `/k8s/pods`, … | Same APIs as before; **K8sWorkspaceShell** keeps scoped tabs when `cluster_name` is set. |
| Drill-down | `/k8s/pods/[pod]`, terminal, rollout, etc. | Unchanged detail flows. |
| Connections | `/k8s/onboard`, `/k8s/onboard/new` | Secure cluster onboarding (separate from workspace rail). **AWS / Azure / GCP** connection types: cloud-native IAM or workload identity (recommended), server **secret_ref**, or encrypted kubeconfig/token. **Test connection** before save; list APIs never return credentials. |
| Legacy redirect | `/k8s/clusters/[cluster]` | Redirects to `/k8s/workspace` with the same query params. |
| Unscoped list URLs | `/k8s/pods`, `/k8s/logs`, … (no `cluster_name`) | Redirect to `/k8s` catalog so operators pick a cluster first. |
| Namespace filter | Workspace rail | Dropdown loads namespaces for the scoped cluster; updates query on all resource tabs. |

**Sidebar:** Single **Kubernetes** item → `/k8s` (not separate Pods/Logs commands).

Notion: [NF-02 Kubernetes Workspace](https://app.notion.com/p/3e60f430ed1081d2a06ef9c037bbcde3)

### Incidents and problems

Service desk links incidents, changes, and problems. The record pages are facts plus the fields that can still be edited. Person menus show usernames. Detail is in [FLOWS.md](./FLOWS.md).

| Feature | Page | How it works |
| --- | --- | --- |
| Open incidents | `/incidents` | `GET /api/devops/incidents`. Priority P1–P4, ServiceNow states, assignment group vs assignee, and response/resolve SLA clocks. |
| New incident | `/incidents/new` | `POST /api/devops/incidents`. Caller, category/subcategory, optional parent INC, impact × urgency, work note vs customer comment. |
| Edit / assign | `/incidents/[id]/edit` | `PATCH /api/devops/incidents/:id`. SLA clocks, journal, child incidents, major-incident conference. The first time it becomes major, Slack is posted and today’s on-call roster is paged. |
| Incident workspace | `/incident-workspace` | Shared notes while an INC is major. |
| Problems | `/problems`, `/problems/new`, `/problems/[id]` | Search and state filter on the list. Known error is a checkbox on the record. Recurring alerts still open a problem after three hits. |
| Knowledge | `/knowledge`, `/knowledge/[id]` | Publish a KB article once the problem is a known error or has a workaround (`POST /api/devops/problems/:id/knowledge`). |

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

### Kubernetes (day-2 detail)

See **Kubernetes workspace (NF-02)** above for navigation and secure onboarding. This table is the API-oriented index.

| Feature | Page | How it works |
| --- | --- | --- |
| Catalog | `/k8s` | Connected clusters overview. |
| Onboard | `/k8s/onboard`, `/k8s/onboard/new` | Per-cloud secure connect (EKS IAM, AKS/GKE workload identity, secret ref, encrypted secrets). HTTPS endpoints only. `POST /api/devops/k8s-connections/test` before save. |
| Cluster / workloads / pods / logs / services / ingress / secrets / configmaps / storage / events / certificates | `/k8s/...` | Live reads from the cluster via the stored connection. Terminal and log stream are attach endpoints. |
| Workload actions | cluster pages | Restart / scale via `POST /api/devops/k8s-workload-actions`. |

**Server config:** [CONFIGURATION.md](./CONFIGURATION.md#kubernetes-cluster-connections-devops) · **Failures:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#kubernetes-connection-test-fails-devops)

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
| Freezes | Operations | `GET/POST /api/devops/freezes`. |
| On-call | `/on-call`, `/on-call/onboard`, `/on-call/projects` | Calendar, onboard a project’s teams, day click shows that day’s team and users, cover requests email both people. See [FLOWS.md](./FLOWS.md#on-call). |
| IAM access | `/iam`, `/iam/request`, `/iam/approvals` | Access request `AR-…`. DevOps approves. The grant is recorded only after `POST /api/webhooks/iam-access`. See [FLOWS.md](./FLOWS.md#iam-access). |
| Maintenance windows | `/maintenance`, `/maintenance/new`, `/maintenance/[id]` | Manager, then DevOps manager, then admin. Approve and Reject on the current step only. See [FLOWS.md](./FLOWS.md#maintenance). |
| Inbound webhook sources | `/operations/webhooks` | Filter the list. Sample shows one example and never the secret. |
| Saved views | lists | `GET/POST /api/devops/saved-views`. Persist filters. |

---

## Inbound integrations (no portal form)

| Integration | Endpoint | How it works |
| --- | --- | --- |
| Change webhook | `POST /api/webhooks/change` | CI after merge to `main`. Auth: `X-CI-Secret` or `X-Hub-Signature-256`. Idempotent on `repo+sha+environment`. Omit `environment` to let service_map fill it. Optional SBOM + `infracost_report`. |
| Alert webhook | `POST /api/webhooks/alerts` | Grafana, Alertmanager, or generic logger. Same fingerprint updates one INC. |
| Watch metrics | `POST /api/webhooks/watch-metrics` | Push latency/error samples into the watcher. |
| Infra CI | `POST /api/webhooks/ci` | Terraform plan, Infracost, apply success/fail on a ticket. |
| GitHub | `POST /api/webhooks/github` | PR events for Deploy intel briefs and check runs. |
| Slack / Teams commands | `POST /api/webhooks/slack`, `/api/webhooks/teams` | ChatOps: on-call, status. |
| Outbound events | Admin webhooks | OpsTrellis POSTs request/change/incident events to Slack or HTTP. |
| IRM sync | `POST /api/webhooks/irm` | PagerDuty / Grafana IRM / Opsgenie / Zenduty create or ack-resolve the same INC fingerprint. |

---

## W1 — Platform integrations

### OIDC login
Admin **People → SSO** turns on OIDC for User and DevOps. The login pages already call `GET /api/public/sso/options`. Continue with OIDC starts `GET /api/auth/oidc/start` and returns through `/api/auth/oidc/callback` with `?sso_token=`. Admin stays on local break-glass password. Env: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`.

### Workload identity
CI posts a GitHub Actions OIDC token to `POST /api/auth/workload/github` or a GitLab CI OIDC token to `POST /api/auth/workload/gitlab` (audience default `opstrellis`; `setuops` is still accepted). Self-hosted GitLab can set `GITLAB_OIDC_ISSUER` / `GITLAB_OIDC_JWKS_URL`. After verify, OpsTrellis can assume `AWS_WORKLOAD_ROLE_ARN` with the repo as subject (see W7). DevOps **Health → Identity** lists static keys, the last cloud-role exchange (no secrets), and recent verified tokens.

### Bidirectional incidents
Alert labels `pagerduty_incident` / `grafana_alert_uid` / `zenduty_incident` attach an external id. Ack or resolve in OpsTrellis pushes to PagerDuty / Grafana IRM / Opsgenie / Zenduty when that API key is set. Those tools POST the same status to `/api/webhooks/irm`, `/api/webhooks/pagerduty`, or `/api/webhooks/zenduty`. A new Zenduty incident opens a portal INC; later ack/resolve events update that same INC.

### SBOM / provenance on each CHG
`POST /api/webhooks/change` accepts `sbom_url`, `attestation_url`, `image_digest`, optional `signed` / `provenance`. Detail pages and the Deploy intel repo last-change card show Signed or Unsigned. The Changes catalog webhook sample includes `summary`, `status`, and SBOM fields; see [CICD.md](./CICD.md) for single- and two-phase GitHub Actions jobs.

### MCP
`POST /mcp` is JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`) authenticated with a session token or API key from `POST /api/me/api-keys`. Read tools: `list_changes`, `get_change`, `list_incidents`, `get_incident`, `ask_catalog`, `health_for_service`, `list_identity_findings`, `list_tickets`, `get_ticket`, `list_scorecards`. `get_change` includes blast radius, live-vs-CHG drift, and a rollback plan when `previous_sha` exists. `get_incident` includes rollback plus the generated review. Write tools (`GET /mcp` `write_tools`): `comment_incident` and `request_rollback`. Same freeze/CAB as the portal. Terraform/kubectl apply is refused. Static keys also appear on the DevOps expiry tracker.

---

## W2 — Modern delivery

### Preview environments
A GitHub PR opened on an onboarded repo creates a `preview` CHG and a live preview row. Cost is estimated from `PREVIEW_HOURLY_USD` (default $0.25/h) and shown on Deploy intel PR meta and **Changes → Previews**. Close without merge tears it down and cancels the preview CHG. Merge graduates the git SHA into a standard CHG in the service default env. URL template: `PREVIEW_URL_TEMPLATE` with `{pr}`, `{repo}`, `{branch}`.

### Progressive delivery
A CHG tracks canary / 10 / 50 / 100. CI can send `rollout_stage` or `rollout_percent` on the change webhook. DevOps advances stages on the detail page (`POST /api/devops/changes/:id/rollout`). If Health sees a breach before 100%, rollout is halted and a regression INC opens.

### Feature-flag changes
`POST /api/webhooks/flags` from LaunchDarkly / Unleash / Flagsmith creates a `flag` CHG with the same resolve/close and watch window.

### OTLP as Health source
`POST /api/otlp/v1/metrics` or `POST /v1/metrics` accepts OTLP JSON or `{ service, p95_ms, error_ratio }`. Latest samples feed the watcher when `service_map.metrics_url` is empty.

---

## W3 — Governance

### Service scorecards
Each catalog service gets a 0–100 score from owner, SLO, open incidents, runbook freshness, last CHG, and DORA change-failure rate. DevOps and Admin keep Scorecards under More. User `/scorecards` stays reachable but is not a top-level nav item. MCP `list_scorecards` is the same read.

### Cost delta on a Change
`POST /api/webhooks/change` accepts `cost_delta_usd` / `cost_monthly_after` or an `infracost_report`. If the CHG is linked to an infra ticket, the watcher copies Infracost onto the CHG when the watch window ends. Detail pages, Health, and the evidence pack show the monthly delta.

### Compliance evidence pack
DevOps **Evidence** exports the last 30 days: who approved, SHA shipped, watch result, policy, cost, incidents, approvals, previews, and required `infragate/*` branch checks. JSON or Markdown (`?format=md`). Admin has the same pack read-only.

### OPA / Rego on request.json and CHG
DevOps **Policies** stores lightweight Rego `deny` rules (`target=change` or `request`). Built-in rules reuse existing gates: active deployment freeze on high-control envs, no standard prod change on Friday/Saturday without CAB, no public exposure on high-control request environments. CAB approve re-evaluates the CHG. Failures write `policy_status` / `policy_reasons` and post `infragate/policy`. Manual / preview / flag SHAs skip the GitHub status.

---

## W4 — Act, with citations

### Grounded assistant
`POST /api/copilot` retrieves CHGs, INCs, and runbooks first. The reply names those IDs. If a linked change has `previous_sha`, it suggests that recovery. It will not apply Terraform, Helm, or cluster changes. The Support hub shows citation links. User answers stay scoped to visible projects.

### Watcher rollback to an emergency CHG
A regression INC on Health, a watching CHG with `previous_sha`, Deploy intel last-change, or the incident editor can record an emergency CHG that targets `previous_sha`. An active emergency CHG or open SEV1/SEV2 INC can bypass a freeze. High-control rollback without an active INC still needs CAB. If a cluster connection exists, the plan includes `k8s_href`. OpsTrellis records the CHG (and a rollback-console draft when the source ticket exists). It does not apply the revision.

---

## W5 — Close the loop

### Burned SLO writes a deploy freeze
Health already computes error-budget burn (`freeze_on_budget`, 3+ samples, remaining ≤ 0) and the promotion gate already read that reason. `w5_slo_freeze.go` writes the same `deployment_freezes` row used on Friday/CAB, keyed `slo:service/env`. Health, SLO save, and watch samples sync the row. Promotions and high-control CHG policy then halt via `activeFreezeReason`. When the budget recovers, that SLO freeze ends. An active emergency CHG or open SEV1/SEV2 INC for the service/env can bypass.

### Post-incident review from the INC
The incident workspace form is no longer a blank second ITSM. `w5_incident_review.go` powers DevOps **Generate from timeline** (incident editor, workspace, or `POST /api/devops/incidents/:id/review`). It drafts impact, cause, detection, mitigation, and follow-up from the INC timeline, linked CHG, `previous_sha`, watch samples, and who is assigned. Completed reviews are not overwritten. Admin, User, and MCP `get_incident` show the same draft read-only. No new ticket type.

### Page the scorecard owner
`w5_owner_page.go` pages on first open SEV1/SEV2 (alert, watcher, IRM create, manual create, or draft→open). It fires `incident.owner_paged` to the service-map team and its members, plus the assigned owner. ChatOps ack/resolve stay. This is not a new roster product.

### Watch-ended digest
`w5_watch_digest.go` POSTs `watch.ended` when a CHG resolves: CHG id, SHA, `previous_sha`, `cost_delta_usd`, `watch_result`. `watch.failed` still fires on regression.

---

## W6 — Delivery hops you can watch

### Preview graduates on merge
`w6_preview_graduate.go`. Close without merge still tears down the preview and cancels the `preview` CHG. Merge keeps that teardown, then upserts a **standard** CHG with the merge/git SHA, `previous_sha` from the last watchable CHG in the target env, and starts a watch. UNIQUE(repo, sha, environment) stays.

### Each promote hop is a CHG
`w6_promote_chg.go`. DevOps or portal promote writes a CHG for the next environment with the same SHA that last shipped in the source env. The target env's last SHA becomes `previous_sha`. High-control hops use `normal` so CAB still applies. Freeze still blocks the promote itself.

### Live vs last CHG drift
`w6_drift.go`. Scorecards, Health watch rows, CHG detail, and Deploy intel last-change compare the connected cluster image tag/digest to the last CHG SHA or `image_digest`. Drift fails the scorecard check. OpsTrellis does not apply a sync.

### Blast radius from the service map
`w6_blast_radius.go`. CHG detail, MCP `get_change`, and the PR impact brief add 1-hop dependents: other catalog services on the same repo or the same team/env. No new CMDB. Promote responses include the hop CHG. User and Admin scorecards show the same drift line as DevOps.

---

## W7 — Workload cloud roles and MCP writes

### OIDC → cloud role
`w7_cloud_sts.go`. After GitHub or GitLab OIDC verify, OpsTrellis assumes `AWS_WORKLOAD_ROLE_ARN` with the repo (or GitLab project) as the subject. Short-lived AWS credentials return to the CI caller only. Identity findings store role, subject, exchanged, reason, and expiry — never `SecretAccessKey` or `SessionToken`. `GCP_WORKLOAD_SERVICE_ACCOUNT` is recorded as the intended identity; OpsTrellis does not mint a GCP key. If neither is set, the exchange is skipped and still shown on Identity.

### MCP write tools
`w7_mcp_write.go`. `comment_incident` appends a timestamped operator note. `request_rollback` records an emergency CHG to `previous_sha` through `executeChangeSHARollback` (same freeze/CAB as the portal). Both refuse terraform/kubectl/helm apply. `GET /mcp` lists them under `write_tools`.

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
| SSO / OIDC | Login button | Configure | Login button + Identity |
| MCP | — | — | Via API key |
| Previews | — | — | Catalog + PR brief cost |
| Progressive rollout | — | Read | Advance / halt |
| Flag CHGs | Read | Read | Webhook + catalog |
| OTLP Health | — | — | Ingest + watcher |
| Scorecards | Own projects | Read | Catalog |
| Evidence pack | — | Read | Export JSON / Markdown |
| Policies / Rego | — | — | Catalog + configure |
| Grounded assistant | Own CHG/INC | All read | Cite + suggest SHA |
| Watcher rollback | — | — | Record emergency CHG |
| SLO deploy freeze | — | See freeze | Write/clear on burn |
| Incident review | Read | Read | Generate + edit draft |
| Owner page (SEV1/SEV2) | — | Subscribe `incident.owner_paged` | Outbound + ChatOps |
| Watch-ended digest | — | Subscribe `watch.ended` | Outbound on resolve |
| Preview graduate | — | — | Merge → standard CHG |
| Promote hop CHG | — | — | Written on promote |
| Live vs last CHG drift | Own projects | Read | Scorecard + intel |
| Blast radius | Read | Read | CHG + PR brief |
| Workload cloud role | — | — | Identity last exchange |
| MCP write tools | — | — | comment + rollback CHG |

---

## Status words you will see

**Infra request:** `pending_user_manager` → `pending_devops_approval` → `in_progress` → `completed` / `rejected`.

**Change Request:** `new` → **Approve** (CAB when required) → `scheduled` → **Start implementation** → `implementing` → `implemented` → `monitoring` → `resolved` → `closed`. Also `failed`, `cancelled`. CI webhooks can still advance status directly. Approve is allowed for **admin**, **DevOps users**, **DevOps managers**, and **portal team managers**. Schedule/implement actions require a DevOps manager. Resolve/close is blocked while linked incidents are still open.

**Incident:** `draft` → `open` → `acknowledged` → `investigating` → `mitigating` → `resolved` → `closed`. Also `cancelled` (false alarm). Sources: `ticket`, `alert`, `manual`, `change_regression`. Acknowledged still counts as active. The first transition to major pages today’s on-call roster.

**Problem:** states from the problem catalog. Known error is a flag on the existing record. Publish knowledge waits for that flag or a workaround.

**IAM access:** `PENDING_DEVOPS_APPROVAL` → `PROVISIONING` → grant on the access-file callback (`ACTIVE`), or `REJECTED` / provision failed. The requester cannot approve it. A team manager is not the IAM approver.

**Maintenance window:** `pending_manager` → `pending_devops` → `pending_admin` → `approved`, or `rejected` from any step. The creator cannot decide. Number `MNT0000001`.

**On-call cover:** `pending` → `approved` or `declined`. An approved cover is who is on that day.

**Priority / risk on CHG:** `low` / `medium` / `high` / `critical` (normalized from several aliases).

**Change type:** `standard` / `normal` / `emergency` / `preview` / `flag`.
