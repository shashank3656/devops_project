# Configuration

InfraGate uses two main configuration styles:

- `config/.env` for Docker Compose and local/runtime deployment
- Helm `values.yaml` and override files for Kubernetes deployment

Preferred database configuration:

- `DATABASE_URL` for Supabase or any managed PostgreSQL instance
- `DB_*` only when you want split host/user/password values
- `POSTGRES_*` should be treated as legacy compatibility variables, not the primary path

## Local Configuration

Start with:

```bash
cp config/.env.example config/.env
./scripts/sync-env.sh
```

## Key Runtime Settings

### Backend core settings

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Preferred full database DSN override for Supabase or managed Postgres |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Optional split PostgreSQL connection settings |
| `DB_SSLROOTCERT` | Optional CA certificate path for managed Postgres TLS verification |
| `REDIS_ADDR`, `REDIS_PASSWORD`, `REDIS_DB` | Redis cache and queue connection |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN` | GitHub integration for PR workflows |
| `ADMIN_SECRET` | Admin API secret |
| `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_EMAIL` | Initial admin bootstrap |
| `FRONTEND_URL`, `DEVOPS_FRONTEND_URL` | Portal URLs used for links and emails |
| `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `OPS_NOTIFICATION_WEBHOOK_URL` | Optional notification targets |
| `SMTP_*` | Email delivery settings |
| `OTEL_*` | OpenTelemetry tracing and metrics |

### Frontend core settings

All frontends rely on:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Browser-visible backend API URL |

Important: `NEXT_PUBLIC_API_URL` is frequently build-time sensitive for the frontends. Keep the built image value and runtime value aligned.

## Secrets vs Non-Secrets

Use this split consistently:

### Non-secrets

- hostnames
- ports
- feature toggles
- timeouts
- public base URLs

### Secrets

- database passwords
- GitHub tokens
- webhook secrets
- admin secret
- SMTP passwords
- JWT / API key hashing secrets
- SSO shared secrets

## Helm Values

The Helm chart keeps configuration in:

- `backend.env`
- `backend.secretEnv`
- `frontends.user.env`
- `frontends.admin.env`
- `frontends.devops.env`
- matching `secretEnv` blocks when needed

For managed Postgres CA certificates in Helm:

- pass `DATABASE_URL` in `backend.secretEnv` when possible
- set `backend.env.DB_SSLROOTCERT` to the in-container cert path
- mount the certificate with `backend.extraVolumes` and `backend.extraVolumeMounts`

Recommended pattern:

1. keep shared defaults in `helm/infragate/values.yaml`
2. create an environment-specific override file
3. inject real secrets from CI/CD or secret management, not by editing the chart defaults directly

## Recommended Production Practice

- prefer `DATABASE_URL` when using Supabase
- point `DB_SSLROOTCERT` to your CA file when your provider requires certificate validation
- do not run a separate local Postgres service unless you explicitly want one
- never rely on the fallback values inside `docker-compose.yml`
- never commit real secrets to git
- keep API URLs browser-reachable
- store Helm override files outside the repo or in a separate secret-managed location if they contain real values
