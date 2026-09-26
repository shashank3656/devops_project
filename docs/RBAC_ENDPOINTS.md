# RBAC endpoint inventory (BRD-06)

Companion to [RBAC_MATRIX.md](./RBAC_MATRIX.md). Lists high-risk routes and the guard applied. UI nav hiding is **not** authorization; these checks are authoritative.

## DevOps manager-only (`requireDevopsManager` → 403)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/devops/users` | DevOps user directory |
| GET | `/api/devops/workload` | Workload summaries |
| POST | `/api/devops/requests/:id/approve` | PR approve (also gated by runbook / high-risk ack) |
| POST | `/api/devops/requests/:id/reject` | PR reject |
| POST | `/api/devops/requests/:id/promote` | Environment promote |
| GET/POST | `/api/devops/access-overrides` | Time-boxed access |
| DELETE | `/api/devops/access-overrides/:id` | Revoke override |
| POST | `/api/devops/environment-drift/fix` | Apply drift fix |
| POST | `/api/devops/changes/:id/rollout` | Progressive rollout stages |
| POST | `/api/devops/policies` | Rego policy writes |
| GET/PATCH | `/api/devops/notification-settings` | Ops notification routing |
| POST | `/api/devops/retry-center/:id` | Retry failed delivery |
| POST | `/api/devops/expiry-tracker/actions` | Credential expiry actions |
| POST | `/api/devops/cloud/accounts` | Cloud account onboard (manager **and** member of target devops team) |
| PATCH | `/api/devops/cloud/accounts/:id` | Disable, metadata, or trust rotation (same team manager) |
| POST | `/api/devops/cloud/accounts/:id/test` | Connection test (same team manager) |
| POST | `/api/devops/k8s-connections` | Register or update cluster connection (encrypted credentials / secret refs) |
| POST | `/api/devops/k8s-connections/test` | Validate K8s trust config and endpoint before save |
| POST | `/api/devops/k8s-workload-actions` | K8s restart / scale / resume (manager; project access; env freeze → **409** + operator audit) |
| POST | `/api/devops/promotions/:id/promote` | Environment promote (manager; freeze + gates enforced server-side) |
| POST | `/api/devops/rollback-console` | Prepare rollback draft (manager) |

Additional manager gates exist on K8s mutating routes, deployment gate approvals, project lifecycle writes, and deploy-intelligence branch protection — see `requireDevopsManager` in the backend tree.

## DevOps user (`requireDevopsUser` → 401/403)

Any authenticated DevOps user (or admin acting in DevOps) may call read-heavy DevOps APIs: tickets list, incidents, changes, scorecards, **cloud inventory** list/detail (scoped to **member devops teams**; **read-only**, no cloud mutate routes), **cloud account** catalog/detail (scoped to **member devops teams**; no secrets in JSON), health, etc. Mutations that change production state still require manager where noted above.

| GET | `/api/devops/cloud/resources` | devops member teams | Read-only inventory |
| GET | `/api/devops/cloud/resources/:id` | devops member teams | Read-only row |
| GET | `/api/devops/cloud/accounts` | devops member teams | Catalog (no credentials) |
| GET | `/api/devops/cloud/accounts/:id` | devops member teams | Detail (no credentials) |
| GET | `/api/devops/k8s-connections` | devops user | Projects, connections, auth modes (`has_auth_credential` only) |
| GET | `/api/devops/operator-activity` | devops user | Operator audit trail; filtered to visible projects (optional `project_id`, `environment`, `resource_type` + `resource_id`) |
| GET | `/api/devops/guarded-action-context` | devops user | NF-05 pre-flight (permissions, freeze, incidents, SHA); does not mutate |
| GET | `/api/devops/resource-context` | devops user / manager | NF-07 read-only context panel (`kind` + `id`); ticket/change require manager; no mutate |
| GET | `/api/devops/environment-catalog` | devops user | NF-03 environment catalog for visible projects |
| PATCH | `/api/devops/environment-catalog` | manager | NF-03 catalog metadata (type, region, cluster override, owners, cloud account link) |
| GET | `/api/admin/cloud/accounts` | admin | All onboarded accounts (read-only) |

**User portal** has no cloud account or inventory routes. **Admin** does not onboard accounts in the UI (DevOps managers only).

## User portal

| Method | Path | Guard |
| --- | --- | --- |
| GET | `/api/me/changes` | Visible projects only; **POST denied** |
| GET | `/api/me/incidents` | Team + project visibility |
| GET | `/api/me/scorecards` | Visible services |

## Admin

| Method | Path | Guard |
| --- | --- | --- |
| `/api/admin/*` | Bearer admin JWT via `requireAdmin` |
| Break-glass | `X-Admin-Secret` | Rejected when `Origin` header present (browser) |

## URL bypass audit (sample)

| Hidden in UI | API still protected? |
| --- | --- |
| DevOps contributor opens `/approval-center` | Approve POST returns **403** without `is_manager` |
| User opens DevOps URL | **403** without `devops_user` |
| User POST create CHG | **405/403** — catalog is GET-only |
| Admin break-glass from browser | **Rejected** — no Origin allowed |

## Automated tests

- `TestAdminBreakGlassRejectsBrowserOrigin` — break-glass cannot be used from a browser Origin.
- `TestDevopsUsersHandlerRequiresAuth` — manager route rejects missing Bearer token.
- `TestDevopsGuardedActionContextRequiresAuth` — guarded pre-flight rejects missing Bearer token.
- `TestDevopsEnvironmentCatalogRequiresAuth` — environment catalog rejects missing Bearer token.
- `TestDevopsK8sWorkloadActionsRequiresAuth` — K8s day-2 actions reject missing Bearer token.
