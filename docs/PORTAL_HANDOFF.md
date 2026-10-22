# OpsTrellis portal handoff

This note is for the next person changing the signed-in portal (`devops-frontend`) and the shared UI it imports.

## Reusable pieces

| Piece | Where | Use it for |
|---|---|---|
| Brand tokens | `shared-ui/tokens.css` (`--ot-*`, `--ig-*`) | Colour, type, focus ring. Do not add one-off hex values in a page. |
| Theme overrides | `shared-ui/theme.css` | Layout, tables, forms, login, and the `onboard-*` / `form-section` styles. Edit `devops_project/shared-ui`, not the frontend symlink. |
| Confirm dialog | `shared-ui/ConfirmDialog.tsx` via `useConfirm()` | Any destructive or hard-to-undo action. |
| Production details | `devops-frontend/lib/productionConfirm.ts` | Pass project, environment, resource, and consequence into `detailLines`. Empty values render as Unknown. |
| Session expiry | `devops-frontend/lib/sessionExpiry.ts` | `expireSession()` on 401. It remembers the page and tells login the session expired. |
| Return path | `devops-frontend/lib/returnPath.ts` | Login, SSO callback, and two-factor verification send the user back when the path is allowed for their role. |
| Unsaved changes | `devops-frontend/lib/useUnsavedChanges.ts` | Call `allowLeave()` only after a successful save, immediately before navigation. |
| Submission result | `devops-frontend/lib/submissionResult.ts` | Save the created id, status, and next step before redirect. The layout shows it once. |
| Breadcrumbs | `devops-frontend/lib/breadcrumbs.ts` | Add a new page path to `KNOWN_PAGES` or the crumb will not be a link. |
| Portal grants | `devops-frontend/lib/portalAccess.ts` | Navigation and route guards. A denied page returns the user home and explains why. |

## Interaction states

- **Login:** idle, submitting, invalid credentials (password cleared, username kept), rate limited, server or network error with retry, session expired, optional SSO, required SSO, and a six-digit two-factor step.
- **Forms:** required asterisk, optional sections, inline errors, unsaved-change prompt, and field values kept when the save fails.
- **Search:** loading, need two characters, no matches, record search unavailable, and focus returns to the opener.
- **Notifications:** unread dot until the panel is opened, each item links to its ticket, and managers can open Notification settings.
- **Destructive confirm:** names the environment, the resource, and the consequence before the action runs.
- **Empty and unknown:** missing telemetry and missing owners stay Unknown or Unassigned. They are not shown as healthy.

## Acceptance criteria

1. An expired session returns the user to the page they were on after they sign in, including after SSO or a two-factor code, when that page is allowed for their role.
2. A role that cannot open a page is sent to an allowed home page and told which page was refused.
3. Closing incidents asks for confirmation and names the environment, the ticket, and the consequence.
4. Creating a problem, request, change, service, or project shows the new id, the status, and the next step. A failed submit leaves the typed values in place.
5. Project release activity names who requested the item, or Unknown, plus the request and update times.
6. The notification bell shows an unread mark until opened, and each approval links to the ticket.
7. Long titles, scope names, and error text wrap or scroll inside the page instead of widening it.
8. Service Status styling is unchanged.
9. A score is the share of known checks only. Missing SLO, DORA, drift, or credential telemetry shows Unknown and is left out of the percentage.
10. Changing the project or environment asks before discarding unsaved work, then refreshes cloud, service, and environment fields.
11. A request or change shows Approved, Queued, Running, then Succeeded or Failed. Approval copy says the work has not started.
12. Incident and request drafts stay in this browser, a second click does not send the form twice, and a failed save keeps the typed values.
13. Service lists and scorecard tables page at 50 rows. Home offers Find a service, Raise an incident, and Review a change.
14. Incidents, changes, and requests can save a filter view. Built-in views include My production incidents, Changes awaiting my approval, and Requests awaiting my approval. The same filters stay in the page URL.
15. A row opens a preview drawer. The list stays in place, and Open goes to the full record.
16. A disabled action shows the reason beside it, including Connect a cloud account to continue when no connection exists.
17. A devops user sees only projects granted through their portal team or an access override. Another team's project, service, change, incident, scorecard, and request answers not found. An admin still sees the full catalog.

A desktop and mobile pass of the signed-in portal is still required before this list is treated as verified on the live app.
