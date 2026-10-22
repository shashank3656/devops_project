# RBAC foundation matrix (BRD-06)

Authorization path: **User → Team → Environment → Resource → Action**.  
Phase 1 uses existing roles only (no new role product).

## Role mapping

| Product label | Stored role / flag | Where they work |
| --- | --- | --- |
| Viewer | `users.role = viewer` | Same portal, read-heavy grants |
| Developer / Contributor | `users.role = contributor`, portal team membership | Requests section |
| Operator | `users.user_type = devops_user`, team `member` | Daily, operations, infrastructure |
| DevOps lead / manager | `devops_profile.is_manager = true` | Manager-only writes. This is the maintenance DevOps step. It is not the admin step. |
| Admin | `users.role = admin` | Portal Access, and the last maintenance step |
| Person’s manager | `users.manager_id` | First maintenance approval. Not the IAM approver. |

## Write actions

| Resource | Action | Required check | Enforced in |
| --- | --- | --- | --- |
| PR request | Approve / reject (DevOps) | `requireDevopsManager` | `devops_api.go` |
| PR request | Approve (User manager) | Portal manager / team lead rules | `history.go`, team flows |
| Change (CHG) | Create via User API | **Denied** (GET-only catalog) | `portal_ops.go` `meChangesHandler` |
| Change (CHG) | List / detail (User) | Visible projects only | `filterChangesForUser` |
| Incident (INC) | List / detail (User) | Team + project visibility | `portal_ops.go` |
| Promotion / gate | Approve / revoke | DevOps manager + audit | `devops_control_center.go` |
| K8s cluster | List, workloads, pods, logs | Read on that project: minimum of the group Kubernetes level and the project link, then the maximum across the person’s groups. Admin sees all. | `k8s_access.go` |
| K8s / day-2 | Restart, scale, resume, terminal, onboard | Write on that project at both the group and the project link. A DevOps manager flag does not grant this. Freeze still returns 409. | `k8s_access.go`, `devops_k8s_dashboard.go` |
| Template write | Admin / DevOps catalog | Admin or DevOps role checks | Admin/DevOps template routes |
| Admin API | Any | Bearer admin JWT **or** break-glass (no browser Origin) | `requireAdmin` |
| Team membership | Add / remove | Admin | `admin_teams.go` |
| SSO settings | Update | Admin | `sso_management.go` |
| Cloud account | Onboard / test / trust / disable | DevOps **manager** on account `team_slug` | `cloud_accounts.go` |
| Cloud account | List / detail | DevOps user on **member** devops teams | `cloud_accounts.go` |
| Cloud inventory | List / detail | DevOps user on **member** devops teams; **read-only** | `cloud_inventory.go` |
| Cloud account (all teams) | List | Admin JWT | `cloud_accounts.go` admin handler |
| Maintenance window | Create | Signed-in user with a `manager_id` | `maintenance_window.go` |
| Maintenance window | Approve / reject step 1 | `users.manager_id` of the creator, and not the creator | `maintenance_window.go` |
| Maintenance window | Approve / reject step 2 | `devops_profiles.is_manager`, and not the creator. Admin does not skip this step. | `maintenance_window.go` |
| Maintenance window | Approve / reject step 3 | `users.role = admin`, and not the creator | `maintenance_window.go` |
| IAM access | Approve / reject | DevOps approver (admin or `devops_user`), not the requester | `iam_api.go` |
| On-call roster | Save | Admin, DevOps manager, or a person who can manage that team | `oncall_duty.go` |

## Audit (sample actions logged)

- `request_approve`, `request_reject`, `request_promote`
- `deployment_gate_approve`, `deployment_gate_revoke`
- `sso_settings_update`, `admin_break_glass`
- Role / team changes via admin user and team handlers

## Break-glass (`X-Admin-Secret`)

- Server-side only: requests with an `Origin` header are **rejected** (browser portals cannot use break-glass).
- Each successful use is logged to audit and application logs.
- Requires `ADMIN_SECRET` and `ADMIN_BREAKGLASS_USER_ID`.

See also [RBAC_ENDPOINTS.md](./RBAC_ENDPOINTS.md) for a route-level inventory and URL bypass notes.

Automated checks (no DB): `backend/test/rbac_foundation_test.go` covers unauthenticated DevOps approve, cloud inventory, and user-portal CHG writes (`POST /api/me/changes` → 401). DevOps ticket approve/reject routes require `requireDevopsManager` (contributors and non-managers receive 403 once authenticated).

## Out of scope (BRD-06)

- Per-resource IAM graph
- Cloud-account scoped grants (BRD-07 inventory is read-only)
- New policy language replacing team membership
