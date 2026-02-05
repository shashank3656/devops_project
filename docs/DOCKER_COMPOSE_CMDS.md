# Docker Compose Commands

## Single command – spin up all containers

To start **all** services (database, backend, user frontend, admin frontend) in one go:

```bash
docker-compose up -d
```

This starts:

| Container            | Port | Description                |
|----------------------|------|----------------------------|
| infra-postgres       | 5432 | PostgreSQL database        |
| infra-backend        | 8080 | Go API (production)        |
| infra-frontend       | 3000 | User frontend (Next.js)    |
| infra-admin-frontend | 3001 | Admin frontend (Next.js)   |

**Prerequisites**

- `config/.env` exists (copy from `config/.env.example` and set values).
- Docker and Docker Compose installed.

**First run or after code/env changes**

Rebuild and start:

```bash
docker-compose up -d --build
```

**Stop all**

```bash
docker-compose down
```

**View logs**

```bash
docker-compose logs -f
```

**Development (hot reload, all containers including admin-frontend)**

To run with dev servers and volume mounts for hot reload, and still start admin-frontend (port 3001), use the dev override so admin-frontend depends on the dev backend:

```bash
docker-compose --profile dev -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

This starts: postgres, backend (dev), frontend (dev), and admin-frontend. The override file `docker-compose.dev.yml` makes admin-frontend depend on the dev `backend` instead of `backend-prod`.
