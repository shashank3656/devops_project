# Tech Stack

This document explains the technology choices behind InfraGate, what each layer is responsible for, and what teams can expect when developing, deploying, and operating the platform.

## Stack at a Glance

| Layer | Technology | Purpose |
| --- | --- | --- |
| User Portal | Next.js | Self-service requests, templates, history, assigned incidents |
| Admin Portal | Next.js | Governance, approvals, users, teams, administration |
| DevOps Portal | Next.js | Promotions, gates, K8s health, incidents, rollback, operations |
| Backend API | Go | Shared workflow engine, auth, persistence, notifications, integrations |
| Database | PostgreSQL | Primary system of record |
| Cache / Queue | Redis | Caching and lightweight background-job behavior |
| Packaging | Docker | Containerized local and deployment builds |
| Kubernetes Packaging | Helm | Structured cluster deployment with env/secret injection |
| CI/CD | GitHub Actions | Quality gates, image publish, Helm rollout, rollback |
| Registry | GHCR | Docker image storage |
| Security Scanning | SonarQube, Trivy, optional Snyk | Code quality, container scanning, optional dependency scanning |
| Observability | OpenTelemetry | Traces, metrics, logs |

## Frontend Stack

All three portals use the same frontend foundation so teams can reuse patterns and keep the overall platform consistent.

### Core

- `Next.js 16`
- `React`
- `TypeScript`
- custom CSS with shared design language per portal

### Why this stack

- Next.js gives a structured app layout and production build pipeline
- TypeScript helps keep API-heavy pages safer as the product grows
- separate portals allow clearer role-based UX without turning one app into an overloaded super-admin interface

### Portal responsibilities

#### User Portal

Located in:

- [frontend](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/frontend)

Key responsibilities:

- infrastructure request creation
- request templates
- request history
- assigned incidents and read-only reviews
- scorecards and live-vs-CHG drift
- notification drawer UX

#### Admin Portal

Located in:

- [admin-frontend](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/admin-frontend)

Key responsibilities:

- user management
- team management
- governance and approval views
- templates and platform controls
- outbound webhook event catalog
- read catalogs for changes, incidents, scorecards, and reviews

#### DevOps Portal

Located in:

- [devops-frontend](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/devops-frontend)

Key responsibilities:

- release dashboards
- promotion gates
- environment drift
- K8s workload health
- expiry tracker
- incidents, generated reviews, and rollback CHGs
- Health, SLO freeze, scorecards, and Identity
- ops command center
- MCP comment / request-rollback (no apply)

## Backend Stack

Located in:

- [backend](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/backend)

### Core

- `Go 1.25`
- standard library HTTP stack
- PostgreSQL access through SQL-based persistence
- Redis for cache/queue-style support

### Why Go

The backend acts as the shared workflow engine for three separate portals. Go is a good fit here because it keeps the runtime small, fast, and operationally straightforward for:

- API handling
- workflow orchestration
- GitHub integration
- deployment and operational control flows
- logging and telemetry

### What the backend handles

- authentication and sessions
- request lifecycle
- approvals and deployment gates
- incidents and postmortems
- rollback operations
- notification workflows
- GitHub and PR-driven automation
- operational summaries such as live-vs-CHG drift, health, SLO freeze, risk, and dependencies
- GitHub/GitLab OIDC verify and optional AWS role exchange
- MCP catalog reads and two write tools that reuse portal freeze/CAB

## Data Layer

### PostgreSQL

Used as the primary source of truth for:

- users
- teams
- requests
- approvals
- incidents
- rollback records
- analytics and audit-oriented workflow objects

### Redis

Used for:

- caching
- notification and workflow coordination
- lightweight queue-style runtime support

This keeps the backend responsive without turning the architecture into a large event-platform dependency too early.

## Deployment Stack

### Docker Compose

Used for:

- local development
- single-host validation
- simpler bring-up for new evaluators

Primary file:

- [docker-compose.yml](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/docker-compose.yml)

### Helm

Used for:

- Kubernetes deployment
- structured env and secret injection
- environment-specific values
- reusable ingress and service topology

Chart location:

- [helm/infragate](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/helm/infragate)

The Helm setup uses:

- one shared frontend ingress
- one backend ingress
- separate deployments for backend and each portal

## CI/CD Stack

### GitHub Actions

Used for:

- reusable quality gates
- reusable deployment flow
- environment-specific wrappers for `dev`, `uat`, and `prod`

Main docs:

- [docs/CICD.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/docs/CICD.md)

### GHCR

Used for:

- backend image storage
- frontend image storage
- environment-tagged image promotion

### Quality and Security Gates

- `SonarQube` for code quality and SAST-style analysis
- `Trivy` for image vulnerability scanning
- optional `Snyk` for dependency/package risk visibility

## Observability Stack

InfraGate includes OpenTelemetry support from the backend.

Used for:

- request tracing
- metrics
- log correlation with `trace_id` and `span_id`

This is important because the platform spans:

- end-user request flows
- admin approvals
- DevOps promotion and incident workflows

Observability is what makes those cross-portal workflows debuggable.

## Notification Stack

InfraGate supports operational notifications through:

- Slack
- Microsoft Teams
- email
- generic webhook callbacks

Notifications are used for:

- blocked promotions
- approval lifecycle changes
- expiry events
- incident-linked operational actions

## Why the Stack Works Well for This App

This product is not just a CRUD dashboard. It combines:

- self-service intake
- approval and policy workflows
- release gating
- infrastructure operations
- incident response
- rollback and auditability

The chosen stack works well because:

- Next.js portals keep role-based UX separate and focused
- Go keeps the shared workflow engine fast and operationally simple
- PostgreSQL gives a strong transactional base for audit-heavy workflows
- Redis adds lightweight runtime support without overcomplicating the system
- Helm and GitHub Actions make the deployment model understandable for platform teams

## Developer Workflow

Typical local workflow:

1. Start with [README.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/README.md)
2. Configure env values through [docs/CONFIGURATION.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/docs/CONFIGURATION.md)
3. Run Docker Compose or build components individually
4. Validate backend tests
5. Validate frontend builds
6. Deploy through Helm or GitHub Actions when needed

Useful commands:

```bash
make help
make backend-test
make frontend-build
make admin-build
make devops-build
make compose-dev
make helm-template
```

## Related Docs

- [README.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/README.md)
- [docs/ARCHITECTURE.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/docs/ARCHITECTURE.md)
- [docs/DEPLOYMENT.md](/Users/gowthamshank/New_Ideas/Devops_Tool/devops_project/docs/DEPLOYMENT.md)
- [docs/CONFIGURATION.md](/Users/gowthamshank/New_Ideas/Devops_Tool/devops_project/docs/CONFIGURATION.md)
- [docs/CICD.md](/Users/gowthamshashank/New_Ideas/Devops_Tool/devops_project/docs/CICD.md)
