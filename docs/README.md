# Documentation

## Product (read these first)

| Document | What it is |
| --- | --- |
| [All features and how they work](./FEATURES.md) | Every shipped feature, who uses it, and the flow |
| [Full API reference](./API.md) | Every HTTP route: method, auth, body, what it does |
| [README](../README.md) | Product picture plus the same two lists |

- [RBAC matrix (BRD-06)](./RBAC_MATRIX.md)
- [RBAC endpoint inventory (BRD-06)](./RBAC_ENDPOINTS.md)

Notion (narrative / BRDs):

| Document | Link |
| --- | --- |
| SetuOps — Portal Features and Flows (parent hub) | https://app.notion.com/p/3e50f430ed10816699fec83b1b270288 |
| Change Request, Alert Incidents, and Health Plan (child BRD) | https://app.notion.com/p/3e50f430ed1081adb731c7f64bdfa1b2 |
| W5–W7 Shipped Features (child) | https://app.notion.com/p/3e60f430ed1081599374cdb7a48c56be |

## Operators

- [Architecture](./ARCHITECTURE.md) - whole-app flow, workflow lifecycle, deployment topology, and system view
- [Tech Stack](./TECH_STACK.md) - frontend, backend, data, deployment, CI/CD, and observability choices
- [Deployment](./DEPLOYMENT.md)
- [Configuration](./CONFIGURATION.md)
- [CI/CD](./CICD.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Read by Role

### If you want to understand the app

- [FEATURES.md](./FEATURES.md)
- [API.md](./API.md)
- [README.md](../README.md)
- [Architecture](./ARCHITECTURE.md)
- [Tech Stack](./TECH_STACK.md)

### If you want to deploy it

- [Deployment](./DEPLOYMENT.md)
- [Configuration](./CONFIGURATION.md)
- [CI/CD](./CICD.md)

### If you want to contribute

- [Contributing](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Support](../SUPPORT.md)
- [Security policy](../SECURITY.md)
- [Architecture](./ARCHITECTURE.md)

## Recommended Reading Order

1. `README.md` in the repo root for the product picture, feature list, and API index
2. [FEATURES.md](./FEATURES.md) for how every feature works
3. [API.md](./API.md) for every HTTP route
4. [Architecture](./ARCHITECTURE.md) for the system layout and whole-app flow
5. [Tech Stack](./TECH_STACK.md) for the implementation and tooling choices
6. [Configuration](./CONFIGURATION.md) for runtime values and secrets
7. [Deployment](./DEPLOYMENT.md) for Docker Compose or Helm rollout
8. [CI/CD](./CICD.md) for GitHub Actions deployment pipelines
9. [Troubleshooting](./TROUBLESHOOTING.md) when validating or debugging
