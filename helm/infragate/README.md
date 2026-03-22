# InfraGate Helm Chart

This chart deploys:

- `backend`
- `frontend` (user portal)
- `admin-frontend`
- `devops-frontend`

It creates:

- one backend deployment and service
- three frontend deployments and services
- one shared frontend ingress with host rules for user/admin/devops
- one backend ingress
- ConfigMaps for non-sensitive environment values
- Secrets for sensitive environment values

## Install

```bash
helm upgrade --install infragate ./helm/infragate -n infragate --create-namespace
```

## Render templates

```bash
helm template infragate ./helm/infragate
```

## Override values

Use a custom values file:

```bash
helm upgrade --install infragate ./helm/infragate \
  -n infragate \
  --create-namespace \
  -f my-values.yaml
```

The repo also ships with baseline environment values:

- [`values-dev.yaml`](./values-dev.yaml)
- [`values-uat.yaml`](./values-uat.yaml)
- [`values-prod.yaml`](./values-prod.yaml)

For the GitHub Actions deployment flow and the generated CI override values, see:

- [`docs/CICD.md`](../../docs/CICD.md)

## Ingress design

The chart intentionally creates two ingress resources:

- `frontend` ingress
  - host-based routing for:
    - user portal
    - admin portal
    - DevOps portal
- `backend` ingress
  - dedicated API host

## Notes

- PostgreSQL and Redis are expected to exist already, or be provided externally.
- Backend env values are split between `backend.env` and `backend.secretEnv`.
- Frontend env values are split per portal under `frontends.*.env` and `frontends.*.secretEnv`.
- `NEXT_PUBLIC_API_URL` must point to the backend ingress URL.
- For user/admin frontends, `NEXT_PUBLIC_API_URL` is used in code that is often build-time sensitive, so align your image build value with your deployed runtime value.
