# Configuration

InfraGate uses two main configuration styles:

- `config/.env` for Docker Compose and local/runtime deployment
- Helm `values.yaml` and override files for Kubernetes deployment

Preferred database configuration:

- `DATABASE_URL` for Supabase or any managed PostgreSQL instance
- `DB_*` only when you want split host/user/password values
- `POSTGRES_*` should be treated as legacy compatibility variables, not the primary path

## Local Configuration

`config/.env` is the only local/runtime source. Backend, Next.js, and Docker Compose all read it. Compose only overrides Redis (`redis:6379`) and the in-container CA path.

Start with:

```bash
cp config/.env.example config/.env
make env-sync
make compose-dev
```

Or:

```bash
docker compose --env-file config/.env --profile dev up -d --build
```

`make frontend-dev`, `make admin-dev`, `make devops-dev`, and `make backend-run` also load `config/.env`. Do not set portal URLs or `NEXT_PUBLIC_API_URL` in docker-compose.

## Key Runtime Settings

### Backend core settings

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Preferred full database DSN override for Supabase or managed Postgres |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Optional split PostgreSQL connection settings |
| `DB_SSLROOTCERT` | Optional CA certificate path for managed Postgres TLS verification |
| `REDIS_ADDR`, `REDIS_PASSWORD`, `REDIS_DB` | Redis cache and queue connection |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN` | GitHub integration for PR workflows |
| `ADMIN_SECRET` | Admin API secret. Break-glass only when `ADMIN_BREAKGLASS_USER_ID` is also set |
| `ADMIN_BREAKGLASS_USER_ID` | User id recorded for `X-Admin-Secret` break-glass calls. Required; secret-only calls as user 0 are rejected |
| `SESSION_SECRET` or `JWT_SECRET` | HMAC key for signed session tokens. Required when `APP_ENV=production` |
| `API_KEY_HASH_SECRET` | API key hash pepper. Required when `APP_ENV=production` |
| `ALLOW_TEST_OTP` | If `true` outside production, signup/2FA JSON may include `otp_for_testing` |
| `CORS_ALLOWED_ORIGINS` | Extra comma-separated browser origins. Portal URLs are already allowed. `*` is ignored |
| `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `DEVOPS_FRONTEND_URL` | Portal URLs used for CORS, links, and emails |
| `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_EMAIL` | Initial admin bootstrap |
| `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `OPS_NOTIFICATION_WEBHOOK_URL` | Optional notification targets |
| `SMTP_*` | Email delivery settings |
| `OTEL_*` | OpenTelemetry tracing and metrics |
| `AWS_WORKLOAD_ROLE_ARN` | Optional IAM role assumed after GitHub/GitLab OIDC verify (repo as subject) |
| `GCP_WORKLOAD_SERVICE_ACCOUNT` | Optional GCP SA recorded after OIDC verify; no GCP key is minted |

### Kubernetes cluster connections (DevOps)

| Variable | Purpose |
| --- | --- |
| `K8S_SECRET_REF_<REF>` | Server-side secret for onboarding `secret_ref` mode. `<REF>` is the uppercase ref with `-` and `.` → `_` (e.g. ref `prod-eks` → `K8S_SECRET_REF_PROD_EKS`). |
| `K8S_SECRET_REFS` | Optional JSON map `{"ref-name":"credential material"}` when you prefer one env var for many refs. |
| `K8S_SKIP_ENDPOINT_PROBE` | If `true` / `1`, **Test connection** skips live HTTPS probe to the cluster `/version` (local dev only; keep false in production). |

Pasted kubeconfigs and tokens are encrypted at rest (`enc:v1:`) using the same key material as `SESSION_SECRET` / `JWT_SECRET`. List APIs never return credential bodies.

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
- `K8S_SECRET_REF_*` values and entries in `K8S_SECRET_REFS`

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
