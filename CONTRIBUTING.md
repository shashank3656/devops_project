# Contributing to InfraGate

Thanks for taking the time to contribute.

This repository combines three frontend applications, one Go backend, Helm deployment assets, and GitHub Actions workflows. The easiest way to make good changes here is to keep them small, tested, and clearly documented.

## Before You Start

Please read these first:

- [README.md](./README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)

## Local Development

Common commands:

```bash
make help
make env-sync
make backend-test
make frontend-build
make admin-build
make devops-build
make compose-dev
```

If you are working on Kubernetes deployment assets:

```bash
make helm-template
make helm-lint
```

## Contribution Guidelines

### Keep changes scoped

Prefer focused pull requests:

- one bug fix
- one feature slice
- one documentation improvement
- one deployment or CI/CD improvement

### Update docs with behavior changes

If your change affects:

- architecture
- deployment
- configuration
- CI/CD
- user-facing workflows

then update the matching document in `docs/` as part of the same change.

### Protect secrets and environments

- never commit real credentials
- never hardcode production hosts or passwords
- prefer environment variables, Helm values, or CI/CD secrets

### Favor compatibility

This repo includes:

- `frontend/`
- `admin-frontend/`
- `devops-frontend/`
- `backend/`

If you touch shared workflows or API behavior, think through the impact across all portals.

## Pull Request Expectations

A good pull request should include:

- a clear title
- a short summary of what changed
- validation steps
- screenshots for meaningful UI changes
- notes about migrations, Helm values, or secrets when relevant

The repository now includes:

- GitHub issue templates under `.github/ISSUE_TEMPLATE/`
- a pull request template at `.github/pull_request_template.md`

Using those templates will make review and triage much faster.

## Testing Checklist

Use the parts that match your change:

```bash
make backend-test
make frontend-lint
make admin-lint
make devops-lint
make helm-template
```

If you change CI/CD:

- review [docs/CICD.md](./docs/CICD.md)
- check the workflow inputs, secrets, and environment rules

## Documentation Standards

When adding docs:

- keep them short and task-focused
- prefer real commands over vague instructions
- link related docs instead of duplicating content
- use diagrams only when they add clarity

## Need Help

If you are unsure where a change belongs, start with:

- [docs/README.md](./docs/README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

That will usually tell you which part of the system you are touching.
