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
