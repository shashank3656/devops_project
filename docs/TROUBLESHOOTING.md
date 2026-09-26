# Troubleshooting

## Frontend cannot connect to backend

Check:

- backend is running
- `NEXT_PUBLIC_API_URL` points to a browser-reachable URL
- ingress or port exposure is correct

Useful checks:

```bash
curl -s http://localhost:8080/health
kubectl get ing -n infragate
```

## Helm renders but app does not work

Common causes:

- wrong ingress hostnames
- missing backend secrets
- wrong database or Redis endpoints
- frontend API URL does not match backend ingress host

Use:

```bash
helm template infragate ./helm/infragate
kubectl describe deploy -n infragate
kubectl logs deploy/<name> -n infragate
```

## Frontend build issues

Run the failing portal directly:

```bash
make frontend-build
make admin-build
make devops-build
```

With strict Next.js builds, fix the first reported TypeScript or JSX error, then rerun.

## Invalid token / 401 issues

Check:

- backend and frontend are pointing to the same API environment
- session and auth secrets are stable
- the browser is not using an old token from another deployment

## Notifications are not being delivered

Check:

- SMTP settings
- Slack / Teams / webhook URLs
- Redis availability if background jobs are enabled
- backend logs for delivery errors

## Database or Redis startup failures

Check:

- `DATABASE_URL` or `DB_*` settings
- `REDIS_ADDR` and `REDIS_PASSWORD`
- network reachability from the backend pod/container

## Kubernetes connection test fails (DevOps)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `cluster endpoint must use https` | HTTP or invalid URL | Use the cloud control plane HTTPS URL from EKS/AKS/GKE. |
| `cannot target private or loopback` | Minikube / kind URL | Use a reachable endpoint, `in_cluster` mode, or set `K8S_SKIP_ENDPOINT_PROBE=true` locally only. |
| `secret_ref … is not configured` | Missing server env | Set `K8S_SECRET_REF_<REF>` or `K8S_SECRET_REFS` on the API host ([CONFIGURATION.md](./CONFIGURATION.md)). |
| `could not reach cluster endpoint` | Network / firewall | Ensure the API host can reach the cluster API (443). For dev without reachability, use `K8S_SKIP_ENDPOINT_PROBE=true`. |
| Test passes but workspace empty | Synthetic vs live data | Dashboard data may be seeded/demo until live K8s API integration is enabled for that environment. |
