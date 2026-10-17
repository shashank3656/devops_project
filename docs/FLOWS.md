# SetuOps — Current flows

This is how the product works today. One Next.js portal (`devops-frontend`) talks to one Go API. There is no separate user portal and no separate admin portal. Sign-up is not a page. People, groups, and sign-in settings live under **Portal Access** in the same shell.

The browser token is `devops_token`. Section grants decide which sidebar groups a person sees: Requests, Daily, Operations, Infrastructure, Security, Records, and Portal Access.

Emails are never listed on these screens. A name is shown. An email address is typed only when an admin adds or edits a person. Messages below are saved in the app. They are also emailed when `SMTP_HOST` is set.

Secrets, passwords, tokens, and webhook secrets are never shown in the UI, in a ticket, or in an email.

---

## Change request

A change request is a planned application change. The number looks like `CHG0000123`.

### How one is opened

1. A person opens **Service desk → Change requests → New change** (`/changes/new`) and files it by hand, or
2. Application CI calls `POST /api/webhooks/change` after a merge. The same `repo + sha + environment` updates the existing change instead of creating a second one. If the webhook omits the environment, the service catalog fills service, project, and environment.

The person list on the form shows usernames. It does not show email addresses.

### What the record looks like

The catalog is `/changes`. Opening one change goes to `/changes/[id]`.

The page is a record, not a stack of empty forms. The header is the change number, the title, and the status. Facts sit in one grid: status, service, environment, delivery, and the fields that have a value. An empty “resource context” card is not shown. Linked incidents, files, and the delivery brief appear only when that content exists.

### How status moves

`new` → approve (CAB when that change requires it) → `scheduled` → start implementation → `implementing` → `implemented` → `monitoring` → `resolved` → `closed`.

`failed` and `cancelled` are also valid. A CI webhook can still move the status on its own.

Approve is allowed for an admin, a DevOps user, a DevOps manager, and a portal team manager. Schedule and implement require a DevOps manager. Resolve and close stay blocked while a linked incident is still open. A clean watch window can auto-resolve the change.

### What it does not do

Filing or closing a change does not grant cloud IAM, open a ServiceNow incident, or merge a GitHub pull request by itself.

---

## Incident

An incident is an unplanned interruption. The number looks like `INC0000123`.

### How one is opened

1. **Service desk → Incidents → New incident** (`/incidents/new`). The caller list shows usernames.
2. Grafana, Alertmanager, or a logger calls `POST /api/webhooks/alerts`. The same fingerprint updates the same incident.
3. The change watcher opens a `change_regression` incident when a spike lands inside that change’s watch window.

`request_id` is optional. An alert incident does not have to be tied to an infrastructure ticket.

### What the record looks like

The catalog is `/incidents`. Opening one incident goes to `/incidents/[id]/edit`.

The header is the incident number and the summary. Facts cover the reference, the linked request, the source, the external IRM id, the suspected change, and the response and resolve SLA clocks. The rest of the page is the editable grid and the notes journal. Notes are posted as a work note or a customer comment.

### States

`draft` → `open` → `acknowledged` → `investigating` → `mitigating` → `resolved` → `closed`. `cancelled` is the false-alarm path. Acknowledged still counts as active.

Sources: `ticket`, `alert`, `manual`, `change_regression`.

### Major incident

Marking an incident major for the first time does three things:

1. Posts to Slack when Slack is configured.
2. Pages the on-call roster for that project’s teams for today (Asia/Kolkata). An approved cover wins over the rotation. If no roster person is found, the active on-call user from the older rotation is used.
3. Assigns the owner and runs the existing executive escalation when the incident has no owner yet.

The conference URL is included when it is saved on the same update that turns major on. Later saves do not page again.

SEV1 and SEV2 still fire `incident.owner_paged` to the service-map team and the assigned owner. That path is separate from the roster email.

### What the page does not claim

Missing telemetry stays **Unknown**. It is never shown as Healthy.

---

## Problem

A problem is the record for a repeating cause. One problem can cover many incidents.

### How one is opened

1. **Service desk → Problems → Create problem** (`/problems/new`), or
2. The same alert fingerprint three times inside 14 days opens a problem on its own.

### Catalog

`/problems` is a list with search and a state filter. The eyebrow says Problems. A row opens `/problems/[id]`. If the filter matches nothing, the page says so. The subtitle is the summary, or the fingerprint when there is no summary.

### Record

The page is facts plus a few controls. State and priority stay as labeled selects. **Known error** is a checkbox. Saving it sends `PATCH` with `{ known_error }`. **Publish knowledge** stays disabled until the problem is a known error or it has a workaround. Publish calls `POST /api/devops/problems/:id/knowledge` and creates a knowledge article. It does not create a second ticket type.

Person pickers on the form show usernames.

---

## On-call

On-call is who answers for a project’s teams on a given day. It lives under **Operations → On-call** (`/on-call`).

### Landing

The header has **Onboard project** and **Projects**. The month control is previous and next arrows around the month name. Days are colored when someone is named: weekend, four rotating tones, today, and the selected day. Clicking a day does not open an editor. It lists, for that date:

| Column | Meaning |
| --- | --- |
| Project | Project on the call |
| Team | Team attached to that project |
| On this day | The person the rotation picked, or “No one is on this rotation” when the roster is empty |
| Users | Names on the team roster, or **Add users** when the roster is empty |
| Ask someone | Start a cover request |

Today’s table still uses the cover row so a pending cover can be approved or declined there.

### Onboard a project

**Onboard project** (`/on-call/onboard`) is a separate form.

1. Choose a project from `GET /api/devops/projects`.
2. Search and tick the teams from the person’s teams and the project options.
3. Save posts one `POST /api/oncall/project-teams` per selected team.

One team opens that team’s people page. Several teams open the project’s on-call page.

### How a day is chosen

Each team has one rotation (`oncall_roster`: team, user, position). The person for a calendar day is picked from that order by the day of the month. Until a project’s teams are saved, the call is the owner team plus project team access. After **teams set**, the call is `project_oncall_teams`.

`GET /api/oncall/team-members?team_id=` returns `user_id` and `name`. It does not return email.

### Who can edit the roster

An admin, a DevOps manager (`devops_profiles.is_manager`), or a person who can manage that DevOps team. Saving people is `POST /api/oncall/roster` with `{ team_id, user_ids }`.

### Cover

Ask someone creates a cover request (`POST /api/oncall/covers`). That person gets an in-app notice and an email: who asked, and which date. They approve or decline with `POST /api/oncall/covers/decision`. The person who asked is told the decision. Messages use usernames.

An approved cover is who is on call for that date, ahead of the rotation.

### Old editor

`/on-call/new` and `/on-call/[id]` redirect back to `/on-call`. The weekday editor is not a page in the nav.

---

## IAM access

IAM access is a cloud access request. It is not an incident. The number looks like `AR-…`. The screens are under **Infrastructure → IAM**.

| Page | What it is |
| --- | --- |
| `/iam` | Overview. Status filter: New, In progress, Provisioning, Provision failed, Active, Rejected, Cancelled |
| `/iam/request` | File a request |
| `/iam/requests` | The requester’s own requests |
| `/iam/approvals` | Queue for a DevOps approver |
| `/iam/permissions` | Grants that have been recorded |
| `/iam/audit` | Timeline |
| `/iam/policy` | Policy check before submit |

### Approval

1. Submit stores the request as `PENDING_DEVOPS_APPROVAL`.
2. A DevOps approver (admin, or `user_type = devops_user`) approves or rejects on `/iam/approvals`. The requester cannot approve their own request. A stale version hash is denied.
3. Reject sets `REJECTED`.
4. Approve sets `PROVISIONING` and dispatches the GitHub workflow `iam-access.yaml` in `shashank3656/project_infra`.
5. The grant is recorded, and the requester is emailed, only after `POST /api/webhooks/iam-access` confirms the access file was applied. Until that callback, the request stays provisioning. `GITHUB_TOKEN` and `IAM_ACCESS_CALLBACK_SECRET` have to be set or the workflow cannot finish.
6. A failed apply is **Provision failed**, not New.

The team manager does not approve IAM. DevOps does.

The grant list is an in-memory portal record (`cloudAccess` in `iam_api.go`). It is cleared when the API process restarts. There is no IAM table. The portal does not perform a real cloud IAM grant itself. It records the grant after the workflow callback.

Overview status labels:

| Stored status | Label |
| --- | --- |
| empty | New |
| contains `PROVISION_FAILED` | Provision failed |
| contains `PROVISION` | Provisioning |
| contains `PENDING` | In progress |
| `ACTIVE` | Active |
| contains `REJECT` | Rejected |
| contains `CANCEL` | Cancelled |

---

## Maintenance

Maintenance is a planned window for one service. It is not the older notice preview, and it is not the admin bundle-normalization tool.

### Landing

**Operations → Maintenance** (`/maintenance`) is a list. **Create** opens `/maintenance/new`. A row opens `/maintenance/[id]`.

The list can be searched by number, project, or service, and filtered by status. A row that is waiting on the signed-in person says **Needs your decision**.

### Create

The form loads catalogs. It does not ask for a timezone.

| Field | Source |
| --- | --- |
| Project | `GET /api/devops/projects` |
| Environment | That project’s environments. Picking a service can set the environment. |
| Service | `GET /api/devops/services`, limited to the project |
| Team | The person’s teams and the project team options |
| Owner | `GET /api/oncall/team-members?team_id=`. Names only. Disabled until a team is chosen. |
| Change request | Change number from `GET /api/devops/changes` |
| Linked incident | Optional, from `GET /api/devops/incidents` |
| Start and end | Local date and time. End must be after start. |
| Impact | Short text |
| Description | Up to 200 characters. The text cannot contain an email address, or the words password, secret, token, recovered, or healthy. |

`POST /api/maintenance/windows` saves it. The number looks like `MNT0000001`.

Create fails with **A manager is not set for this person** when `users.manager_id` is empty or points at the creator. The window is not saved in that case.

### Approval chain

The creator cannot approve or reject their own window. Each step shows **Approve** and **Reject** only to the person who owns that step.

| Step | Status | Who can decide | Who is told when this step starts |
| --- | --- | --- | --- |
| 1 | `pending_manager` | The creator’s manager (`users.manager_id`) | The creator (created) and that manager (please approve) |
| 2 | `pending_devops` | A DevOps manager (`devops_profiles.is_manager`). An admin is not treated as this step. | Every DevOps manager except the creator |
| 3 | `pending_admin` | `users.role = admin` | Every admin except the creator |
| Done | `approved` | Nobody | The creator |
| Stopped | `rejected` | Nobody. Any step can reject. | The creator |

A person who holds two of these roles can take the later step on a later visit. They still cannot approve a step that is not current, and they cannot approve a window they created.

Someone who is only the assigned manager can open Maintenance even when their group does not include the Operations section. The session flag `maintenance_approver` adds the nav item after the window exists.

### Notices that are still in the API

`POST /api/maintenance/notices` is the older preview / approve / publish / cancel contract. The Maintenance screens do not call it. A notice still requires a valid timezone and the same public-text rules. It does not run the three-step chain and it does not email.

---

## Webhooks

**Operations → Webhooks** (`/operations/webhooks`) is the inbound source list.

Filters: search, use (change, alert, grafana, alertmanager, generic log), project (including any project), and status Ready or Off. Clear resets them.

Each row has **Sample**. It opens one example: the URL, copy URL, copy sample, and the JSON body. The change sample and the incident sample are different. The secret is not in the sample and is not on the page. The header name `X-CI-Secret` is shown so the caller knows which header to set.

**New** (`/operations/webhooks/new`) adds a source. The stored value is a hash. The raw secret is not returned later.

Inbound calls that still create records:

| Call | Result |
| --- | --- |
| `POST /api/webhooks/change` | Creates or updates a change |
| `POST /api/webhooks/alerts` | Creates or updates an incident |
| `POST /api/webhooks/iam-access` | Records the IAM grant after the access file is applied |
| `POST /api/webhooks/irm` and `POST /api/webhooks/pagerduty` | Ack or resolve the matching incident |
| `POST /api/webhooks/flags` | Creates a flag change |
| `POST /api/webhooks/watch-metrics` | Feeds the change watcher |
| `POST /api/webhooks/ci` | Terraform plan and apply news on an infrastructure ticket |
| `POST /api/webhooks/github` | Deploy-intel briefs and check runs |
| `POST /api/webhooks/slack` and `POST /api/webhooks/teams` | ChatOps, including on-call status |

Unsigned bodies are rejected.

---

## Who is told

| Event | Who | In the app | Email |
| --- | --- | --- | --- |
| Maintenance created | Creator | Yes | When SMTP is set |
| Maintenance needs manager | Creator’s manager | Yes | When SMTP is set |
| Maintenance needs DevOps | DevOps managers, except the creator | Yes | When SMTP is set |
| Maintenance needs admin | Admins, except the creator | Yes | When SMTP is set |
| Maintenance approved or rejected | Creator | Yes | When SMTP is set |
| On-call cover asked | The person asked | Yes | When SMTP is set |
| On-call cover decided | The person who asked | Yes | When SMTP is set |
| Incident becomes major | Today’s roster for the project’s teams | Yes | When SMTP is set |
| IAM grant recorded | Requester, after the callback | Yes | When SMTP is set |

If mail is not configured, the in-app notice is still written. The screen does not show the address it would have used.
