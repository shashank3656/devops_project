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

Additional manager gates exist on K8s mutating routes, deployment gate approvals, project lifecycle writes, and deploy-intelligence branch protection — see `requireDevopsManager` in the backend tree.

## DevOps user (`requireDevopsUser` → 401/403)

Any authenticated DevOps user (or admin acting in DevOps) may call read-heavy DevOps APIs: tickets list, incidents, changes, scorecards, cloud inventory list, health, etc. Mutations that change production state still require manager where noted above.

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
