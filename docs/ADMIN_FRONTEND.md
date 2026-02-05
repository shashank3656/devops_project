# Admin Frontend

The **admin frontend** is a separate Next.js app for administrators to create **teams** (groups) and **members**. It uses the same backend and database as the user frontend but runs on a **different port (3001)**.

## Running separately

- **User frontend**: http://localhost:3000 (login, create requests, history, profile)
- **Admin frontend**: http://localhost:3001 (admin login, teams, members)
- **Backend**: http://localhost:8080 (shared)
- **Database**: PostgreSQL (shared; includes tables for users, pr_requests, teams, team_members)

## Database tables for admin

The backend creates these tables (same DB as user app):

| Table         | Description |
|---------------|-------------|
| `teams`       | Team id, name, slug, created_at, created_by (admin user id) |
| `team_members`| team_id, user_id, role (member/lead), created_at. Unique(team_id, user_id) |

## Default admin credentials

On first backend start, if no user has **role=admin**, a default admin is created and stored in the backend database:

- **Username:** `DEFAULT_ADMIN_USERNAME` env or `admin`
- **Password:** `DEFAULT_ADMIN_PASSWORD` env or `admin123`
- **Email:** `DEFAULT_ADMIN_EMAIL` env or `admin@localhost`

Change the password after first login. All credentials are stored in the backend (PostgreSQL).

## User credentials only in admin console

The admin console shows only **user** accounts (non-admin) when adding members to teams. Admin accounts are not listed in the "Add user" dropdown. All user and team data is stored in the backend database.

## Admin API (Bearer token with role=admin or X-Admin-Secret)

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/admin/users | List users only (id, username, email; excludes admins) for adding to teams |
| GET    | /api/admin/teams | List all teams |
| POST   | /api/admin/teams | Create team (body: name, slug?) |
| GET    | /api/admin/teams/:id | Team detail + members |
| POST   | /api/admin/teams/:id/members | Add member (body: user_id, role?) |
| DELETE | /api/admin/teams/:id/members/:user_id | Remove member |

## Run admin frontend

### Local (dev)

```bash
cd admin-frontend
cp ../config/.env.example .env.local   # or set NEXT_PUBLIC_API_URL
npm install
npm run dev
```

Open http://localhost:3001. Log in with the **default admin** (username `admin`, password `admin123` unless you set `DEFAULT_ADMIN_*` in env) or any user with **role=admin**.

### Docker

Admin frontend is included in the default/compose profile:

```bash
docker-compose up -d
```

- User app: http://localhost:3000  
- Admin app: http://localhost:3001  
- Backend: http://localhost:8080  

Set `NEXT_PUBLIC_API_URL` in config/.env to the backend URL (e.g. http://localhost:8080 or your server IP:8080) and rebuild if needed:

```bash
docker-compose build admin-frontend
docker-compose up -d admin-frontend
```

## Creating an admin user

1. Sign up or have a user in the **user frontend** (or insert in DB).
2. Set role to admin via API:
   ```bash
   curl -X PATCH "http://localhost:8080/api/users/USER_ID/role" \
     -H "Content-Type: application/json" \
     -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
     -d '{"role": "admin"}'
   ```
3. Log in at http://localhost:3001 with that user's username and password.

## Flow

1. Admin logs in at admin frontend (port 3001).
2. Admin creates **teams** (e.g. "Platform Team", slug `platform-team`).
3. Admin opens a team and **adds members** (selects existing users by username/email).
4. Users (in the user frontend) can create requests; you can later restrict "team" in create-PR to teams the user belongs to by using the `teams` and `team_members` tables.
