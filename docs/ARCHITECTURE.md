# Architecture

InfraGate is built as a shared control plane with three separate web portals backed by one Go API.

## Diagram Index

This document contains four architecture views:

1. `Whole App Flow`: how users, portals, backend, and integrations connect
2. `Workflow Lifecycle`: how requests move into approvals, promotions, incidents, and rollback
3. `Deployment Topology`: how the app is exposed through the two-ingress model
4. `High-Level View`: a compact summary for quick orientation

If you are reading this in GitHub, all diagrams below should render directly. If they do not, check whether Mermaid rendering is disabled in your viewer.

## Whole App Flow

This diagram shows the full product flow from request intake through operations and incident handling.

```mermaid
flowchart LR
    subgraph Actors
        Dev["Developer / Requester"]
        AdminUser["Admin / Governance Owner"]
        SRE["DevOps / SRE"]
    end

    subgraph Portals
        UserPortal["User Portal"]
        AdminPortal["Admin Portal"]
        DevOpsPortal["DevOps Portal"]
    end

    subgraph ControlPlane
        API["Backend API"]
        DB["PostgreSQL"]
        Redis["Redis"]
    end

    subgraph Integrations
        GitHub["GitHub / PR and repo workflow"]
        Notify["Slack / Teams / Email / Webhooks"]
        OTel["OpenTelemetry"]
        K8s["Kubernetes clusters"]
    end

    Dev --> UserPortal
    AdminUser --> AdminPortal
    SRE --> DevOpsPortal

    UserPortal --> API
    AdminPortal --> API
    DevOpsPortal --> API

    API --> DB
    API --> Redis
    API --> GitHub
    API --> Notify
    API --> OTel
    API --> K8s

    UserPortal -. "requests, templates, incidents" .-> API
    AdminPortal -. "approvals, governance, users, teams" .-> API
    DevOpsPortal -. "promotions, gates, health, rollback, ops" .-> API
```

## Workflow Lifecycle

This diagram shows how the major workflow objects move through the system.

```mermaid
flowchart TD
    A["User submits request or uses template"] --> B["Backend stores request and assignment data"]
    B --> C["Admin reviews governance and approvals"]
    C --> D["DevOps evaluates gate policy and release readiness"]
    D --> E["Promotion / release action"]
    E --> F["K8s health, drift, and expiry checks"]
    F --> G{"Issue detected?"}
    G -- "No" --> H["Normal operations and audit trail"]
    G -- "Yes" --> I["Incident created with INC reference"]
    I --> J["Timeline, assignee, postmortem, notifications"]
    J --> K["Rollback or remediation workflow"]
    K --> H
```

## Deployment Topology

This diagram shows the runtime exposure model used by Docker/Helm deployments: one ingress for all frontends and one separate ingress for the backend API.

```mermaid
flowchart LR
    Internet["Users / Browsers"] --> FrontIngress["Frontend Ingress"]
    Internet --> ApiIngress["Backend Ingress"]

    FrontIngress --> UserSvc["frontend service"]
    FrontIngress --> AdminSvc["admin-frontend service"]
    FrontIngress --> DevOpsSvc["devops-frontend service"]

    ApiIngress --> ApiSvc["backend service"]

    UserSvc --> ApiSvc
    AdminSvc --> ApiSvc
    DevOpsSvc --> ApiSvc

    ApiSvc --> DB["PostgreSQL"]
    ApiSvc --> Redis["Redis"]
    ApiSvc --> GitHub["GitHub / GitOps"]
    ApiSvc --> Notify["Slack / Teams / Email / Webhooks"]
    ApiSvc --> OTel["OpenTelemetry"]
```

## High-Level View

```mermaid
flowchart LR
    User["User Portal<br/>frontend/"]
    Admin["Admin Portal<br/>admin-frontend/"]
    DevOps["DevOps Portal<br/>devops-frontend/"]
    API["Backend API<br/>backend/"]
    DB["PostgreSQL"]
    Redis["Redis"]
    GitHub["GitHub / PR workflow"]
    Notify["Slack / Teams / Email / Webhooks"]
    OTel["OpenTelemetry"]

    User --> API
    Admin --> API
    DevOps --> API
    API --> DB
    API --> Redis
    API --> GitHub
    API --> Notify
    API --> OTel
```

## Components

### User Portal

The user portal is the self-service entry point for:

- infrastructure requests
- reusable templates
- request history
- assigned incidents
- notifications

### Admin Portal

The admin portal is used for:

- user and team management
- governance and approval views
- template management
- administrative workflows

### DevOps Portal

The DevOps portal is used for:

- promotions and release workflows
- deployment gates
- Kubernetes health
- drift, expiry, dependency, and risk analysis
- incidents, rollback, and command-center operations

### Backend API

The backend is the shared workflow engine for all three portals. It manages:

- authentication and session handling
- PostgreSQL persistence
- Redis-backed caching and background jobs
- GitHub integration and PR workflows
- incident, approval, and audit workflows
- notifications and observability

## Shared Data and Workflow Objects

Across the app, these objects are the most important:

- requests
- approvals and gate approvals
- incidents and postmortems
- promotions and rollback actions
- teams and assignments
- K8s health findings
- expiry and notification events

That shared object model is the main reason all three portals can work as one system instead of separate apps.

## Ports

| Component | Default Port |
| --- | --- |
| Backend API | `8080` |
| User Portal | `3000` |
| Admin Portal | `3001` |
| DevOps Portal | `3002` |

## Helm Ingress Model

The Helm chart creates two ingress resources:

1. **Frontend ingress**
   - routes `portal`, `admin`, and `devops` hosts to the correct frontend services
2. **Backend ingress**
   - exposes the API on a separate host such as `api.example.com`

This separation keeps the browser-facing portals together while still allowing the API to live on its own hostname.

## Runtime Dependencies

- PostgreSQL for persistent storage
- Redis for cache and lightweight background jobs
- GitHub for PR-based workflows
- Optional SMTP / Slack / Teams / webhook integrations
- Optional OpenTelemetry collector endpoint
