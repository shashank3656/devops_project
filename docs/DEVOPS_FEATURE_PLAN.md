# DevOps Feature Plan: Two-Part Implementation

This document splits the DevOps workflow feature into **Part 1** (foundation + admin) and **Part 2** (approval chain, assignment, DevOps portal).

---

## Overview of Full Feature

| Area | Requirement |
|------|-------------|
| **User types** | Users created/managed from Admin; two kinds: **Portal user** (normal) and **DevOps user** |
| **DevOps user fields** | Is manager (Y/N), Position, Onboard date |
| **Creation in Admin** | Two buttons: "User portal user creation" and "DevOps user creation" |
| **Approval chain** | Request → User's manager approves → DevOps manager approves → PR created |
| **Assignment** | After PR creation, assign ticket by priority: Critical→L4, High→L3, Medium→L2, Low→L1 |
| **DevOps portal** | New frontend; DevOps manager has separate "what is working" / workload view |

---

## Part 1 – User Types & Admin ✅ Implemented

**Goal:** Admin can create and manage two user types; DevOps users have extra fields.

### 1.1 Database

- **users table**
  - Add `user_type` VARCHAR: `'portal_user'` \| `'devops_user'` (default `'portal_user'` for existing rows).
- **devops_profiles table** (only for users where user_type = devops_user)
  - `user_id` (PK, FK users.id ON DELETE CASCADE)
  - `is_manager` BOOLEAN DEFAULT FALSE
  - `position` VARCHAR(200) – e.g. "DevOps Engineer", "SRE"
  - `onboard_date` DATE
  - `level` VARCHAR(10) – `'L1'` \| `'L2'` \| `'L3'` \| `'L4'` (for assignment in Part 2)

### 1.2 Backend

- Extend **POST /api/admin/users**: accept `user_type`, and when `user_type === 'devops_user'`: `is_manager`, `position`, `onboard_date`, `level`. Create user and insert into `devops_profiles` when devops_user.
- **GET /api/admin/users**: include `user_type`; for devops users include `devops_profile` (is_manager, position, onboard_date, level).
- **PATCH /api/admin/users/:id**: allow updating user_type and devops profile fields (create/update devops_profiles row).
- Helpers: GetDevopsProfile(userID), CreateDevopsProfile, UpdateDevopsProfile.

### 1.3 Admin UI

- **Users list**
  - Two creation CTAs: **"Create portal user"** (→ current create flow) and **"Create DevOps user"** (→ new flow).
- **Create portal user** (existing page `/users/new`)
  - Unchanged: username, email, password, role. Implicitly `user_type = portal_user`.
- **Create DevOps user** (new page `/users/new-devops`)
  - Username, email, password, role (optional for devops).
  - **Is manager** (checkbox).
  - **Position** (text).
  - **Onboard date** (date).
  - **Level** (dropdown L1–L4).
  - On submit: POST with `user_type: 'devops_user'` and devops fields.
- **Users list table**
  - Column "Type": Portal user | DevOps user (and e.g. "Manager" badge for devops managers).
  - Optional: show Position / Level for devops users.
- **User edit** (portal user)
  - No devops fields.
- **User edit** (devops user)
  - Editable: is_manager, position, onboard_date, level (and standard username/email/role).

Part 1 does **not** change approval flow, assignment, or add the DevOps frontend.

---

## Part 2 – Approval Chain, Assignment & DevOps Portal ✅ Implemented

**Goal:** Two-step approval (user manager → DevOps manager), auto-assign by priority, and DevOps frontend with manager workload view.

### 2.1 Manager relationship (portal users)

- Add **manager_id** to `users` (nullable FK to users.id) for portal users: "reports to" manager. Optional: derive from team lead in a team instead; for simplicity Part 2 can use manager_id.

### 2.2 Approval flow

- New statuses (or equivalent): e.g. `pending_user_manager_approval` → `pending_devops_approval` → (on approve) create PR and set `in_progress`.
- When a portal user submits a request:
  - Set status to `pending_user_manager_approval`; notify or list for their manager.
- **User manager approve** (in user portal or admin):
  - Set status to `pending_devops_approval` (or keep `pending_approval` and treat as devops).
- **DevOps manager approve** (in admin or DevOps portal):
  - Create PR (existing GitHub flow); on success set status `in_progress` and **assign ticket** (see below).

### 2.3 Assignment by priority

- **pr_requests**: add `assigned_to` (user_id, nullable, FK users).
- **Assignment rule** (after PR creation):
  - Critical → assign to a DevOps user with level L4 (pick one, e.g. least loaded).
  - High → L3, Medium → L2, Low → L1.
- Backend: function AssignRequestByPriority(requestID) that sets `assigned_to` from devops_profiles by priority/level.

### 2.4 DevOps portal (new frontend)

- New app: **devops-frontend** (e.g. Next.js, port 3002).
- Login: same backend auth (e.g. POST /api/auth/login); only users with `user_type = devops_user` can access (optional: allow admins to impersonate or view).
- **DevOps user (non-manager)**
  - View **my assigned tickets** (pr_requests where assigned_to = me).
- **DevOps manager**
  - **Workload / "What is working" view**: list of requests with assigned_to set, grouped by assignee or by status; only DevOps managers can see this. No access for L1–L4 non-managers.

### 2.5 Summary Part 2 deliverables

- DB: manager_id on users; assigned_to on pr_requests; status flow.
- Backend: approval steps (user manager + devops manager), assignment by priority, APIs for "my tickets" and "workload view" (manager-only).
- DevOps frontend: login, my tickets, manager workload view.

---

## Implementation Order

1. **Part 1** (this PR/set of changes): schema + backend for user_type and devops_profiles; admin two creation flows + list/edit for DevOps users.
2. **Part 2**: manager relation, approval chain, assignment, DevOps frontend and manager-only workload view.

---

## File / Area Summary

| Part | Area | Files / changes |
|------|------|------------------|
| 1 | DB | database.go (users.user_type, createTable devops_profiles); migrate.go (migration for new columns/table) |
| 1 | Backend | database.go (devops profile CRUD); admin_teams.go or admin_users (POST/PATCH/GET users with user_type and devops) |
| 1 | Admin UI | users/index (two buttons); users/new (portal – optional user_type); users/new-devops (new page); users/[id]/edit (show/edit devops fields when user_type=devops_user) |
| 2 | DB | users.manager_id; pr_requests.assigned_to; status values |
| 2 | Backend | Approval handlers; AssignRequestByPriority; APIs for devops portal |
| 2 | New app | devops-frontend (Next.js), login, my tickets, manager workload |
