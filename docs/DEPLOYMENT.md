# Deployment

This repo supports two deployment styles:

- Docker Compose
- Helm on Kubernetes

For GitHub Actions deployment pipelines, environment approvals, and GHCR publishing, see [CI/CD](./CICD.md).

The root README links here intentionally so deployment steps stay in one place.

## Deployment Decision Guide

Use this simple rule:

- use **Docker Compose** for local development, quick validation, or single-host setups
- use **Helm** for Kubernetes environments, multi-service rollout, ingress management, and CI/CD-driven deployment

If you are evaluating InfraGate for open-source adoption, start with Docker Compose first and move to Helm after you understand the required runtime values and traffic model.

## Pre-Deployment Checklist

Before any deployment:

1. Confirm PostgreSQL is reachable.
2. Confirm Redis is reachable.
3. Set all required secrets outside git.
4. Set browser-visible API URLs correctly.
5. Decide whether you are using Compose or Helm.
6. For Kubernetes, confirm ingress hosts and TLS strategy.

## Option 1: Docker Compose

### Prerequisites

- Docker
- Docker Compose
- `config/.env` populated

### Steps

1. Create your runtime config:

   ```bash
   cp config/.env.example config/.env
   make env-sync
   ```

2. Start the stack:

   Development:

   ```bash
   make compose-dev
   ```

   Production-like:

   ```bash
   make compose-prod
   ```

3. Verify:

   ```bash
   docker-compose ps
   curl -s http://localhost:8080/health
   ```

4. Validate the portals:

   - User Portal on `:3000`
   - Admin Portal on `:3001`
   - DevOps Portal on `:3002`
   - Backend health on `:8080/health`

### Docker Compose URLs

- User Portal: `http://localhost:3000`
- Admin Portal: `http://localhost:3001`
- DevOps Portal: `http://localhost:3002`
- Backend API: `http://localhost:8080`

## Option 2: Helm on Kubernetes

The chart lives at:

- [`helm/infragate`](../helm/infragate)

### What the chart deploys

- backend deployment and service
- user/admin/devops frontend deployments and services
- one frontend ingress for all portal hosts
- one backend ingress for the API
- ConfigMaps and Secrets for env injection

### Recommended deployment shape

InfraGate is designed to be deployed with:

- one backend release
- three separate frontend deployments
- one shared frontend ingress
- one backend ingress
- external or separately managed PostgreSQL
- external or separately managed Redis

### Prerequisites

- Kubernetes cluster
- Helm
- container images pushed to a registry
- PostgreSQL and Redis available, either in-cluster or external

### Suggested files

Keep a separate override file for deployment values. You can start from:

- [`helm/infragate/values.yaml`](../helm/infragate/values.yaml)

Recommended production overrides:

- image repositories and tags
- ingress hosts and TLS
- backend database/redis endpoints
- all `secretEnv` values

### Commands

Render locally:

```bash
make helm-template
```

Install:

```bash
make helm-install
```

Upgrade:

```bash
make helm-upgrade
```

If you want to pass an override file:

```bash
make helm-upgrade HELM_ARGS="-f my-values.yaml"
```

### Ingress layout

Frontend ingress:

- `portal.example.com` -> user portal
- `admin.example.com` -> admin portal
- `devops.example.com` -> DevOps portal

Backend ingress:

- `api.example.com` -> backend API

### Helm rollout checklist

After install or upgrade:

1. check deployments and services
2. check ingress objects
3. check backend `/health`
4. open each portal in a browser
5. verify login and one key workflow

Example:

```bash
kubectl get deploy,svc,ing -n infragate
kubectl get pods -n infragate
kubectl logs deploy/<release>-infragate-backend -n infragate --tail=100
```

### Verification

```bash
kubectl get deploy,svc,ing -n infragate
kubectl rollout status deploy/<release>-infragate-backend -n infragate
```

Check the backend health endpoint through the backend ingress:

```bash
curl -s https://api.example.com/health
```

## Post-Deployment Validation

A healthy deployment should let you verify all of these:

- backend health endpoint returns success
- user portal loads
- admin portal loads
- DevOps portal loads
- one authenticated workflow works end to end

Good smoke checks:

- create a test request
- open an approval view
- open a DevOps dashboard page
- verify notifications or health pages render

## Rollback Notes

### Docker Compose rollback

- deploy the previous image tags or previous compose definition
- restart the affected services

### Helm rollback

Use Helm history to identify the previous good revision:

```bash
helm history <release> -n <namespace>
helm rollback <release> <revision> -n <namespace>
```

## Deployment Cautions

- `NEXT_PUBLIC_API_URL` must match the backend ingress URL that browsers can reach
- for frontend images, keep the build-time and runtime API URL aligned
- keep real secrets out of git and pass them through secure Helm values or secret management
- do not rely on placeholder values from committed defaults in any shared or production environment
