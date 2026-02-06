# Admin Frontend – Feature Suggestions

Ideas to extend the admin portal for raising PRs and managing the infrastructure portal.

---

## Already Implemented

- **Dashboard** – Stats (total PRs, by cloud, by status) and recent requests
- **PR Requests** – List all requests with filters (team, env, cloud) and pagination
- **Teams** – Create teams, manage members
- **Users** – Create users, list with role/verified; add members to teams
- **Sidebar** – Dark slate sidebar with indigo accent and clear navigation

---

## Suggested Features (High Value)

### 1. **Request detail view (admin)**
- Click a PR request row to see full details: config (masked if needed), branch, file path, created-by user, timestamps.
- Helps admins debug failed PRs or answer “who requested what.”

### 2. **Audit / activity log**
- Log admin actions: “User X created team Y”, “User X added member Z to team W”, “User X created user U”.
- Store in DB (e.g. `admin_audit_log` table) and show in Admin under “Activity” or “Audit log” with filters and date range.

### 3. **Bulk add users to a team**
- On team detail, “Add multiple members” with checkboxes or multi-select instead of one-by-one.
- Speeds up onboarding a team.

### 4. **User detail (admin)**
- From Users list, click a user to see: teams they belong to, role, verified status, last login (if you track it), and optionally “Edit” (role, verified) or “Reset password” (send link or set temp password).

### 5. **Export**
- Export PR requests (or filtered list) as CSV/JSON for reporting.
- Optional: export users list or team membership as CSV.

### 6. **Dashboard quick stats**
- Counts for: total users, total teams, unverified users, requests this week.
- Small cards or a second row on the dashboard.

### 7. **Notifications / alerts**
- Optional: show a banner when there are many failed PRs or when a user is not in any team (e.g. after creation).
- Could be driven by backend flags or a simple “alerts” API.

---

## Suggested Features (Medium / Later)

### 8. **Team slug as env default**
- When raising a PR from the portal, prefill or suggest “team” from the user’s teams (already partially there). Admin could set a “default env” per team.

### 9. **Approval workflow (optional)**
- For some teams/envs, PR requests stay “pending approval” until an admin or team lead approves, then the PR is created.
- Would need `request_status` and an “Approve” action in admin.

### 10. **Templates / presets**
- Admin-defined “request templates” (e.g. “AWS – prod – EKS”) that users can pick when raising a PR to reduce errors and speed up requests.

### 11. **GitHub / repo settings**
- Admin UI to configure which repo/branch the PRs go to (if not only in env). Could be per team or global.

### 12. **Dark mode for admin**
- Toggle for admin UI (sidebar is already dark; add dark main area and cards) for consistency and preference.

---

## Implementation order (suggested)

1. **Request detail view** – Reuse existing backend history detail; add admin page or modal.
2. **Dashboard quick stats** – New backend endpoint (e.g. `/api/admin/dashboard-stats`) returning user count, team count, optional “unverified count”; wire dashboard.
3. **User detail + edit** – User detail page; PATCH role/verified (backend may already have PATCH user); optional reset password.
4. **Bulk add members** – Frontend-only change on team detail (multi-select + one API call or loop).
5. **Audit log** – Backend table + write on admin actions; Admin “Activity” page with filters.

If you tell me which of these you want first, I can outline exact API changes and UI steps next.
