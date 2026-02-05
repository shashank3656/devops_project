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

**Development (hot reload)**

To run with dev servers and volume mounts for hot reload:

```bash
docker-compose --profile dev up -d
```

This uses `backend` and `frontend` dev services instead of the production images.
