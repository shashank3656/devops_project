# Security Policy

Thank you for helping keep InfraGate safe.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security-sensitive problems.

Instead:

1. Share the issue privately with the maintainers.
2. Include the affected area, impact, reproduction steps, and any suggested mitigation.
3. If the issue involves credentials, tokens, or production endpoints, rotate or revoke them immediately where possible.

## What to Include in a Report

Please provide:

- affected component or file path
- vulnerability type
- impact and possible blast radius
- steps to reproduce
- proof of concept if safe to share
- suggested remediation if you have one

## Security Expectations for Contributors

- never commit live secrets, tokens, or passwords
- avoid hardcoded hosts and sensitive defaults
- prefer secrets injection through environment variables, Helm values, or CI/CD secrets
- preserve auditability when changing approvals, incidents, rollback, or deployment workflows
- update docs when security-related configuration changes

## Security Areas in This Repo

Important areas to review carefully:

- `backend/` for auth, request handling, secrets, logging, and workflow behavior
- `.github/workflows/` for CI/CD credentials and deployment flow
- `helm/infragate/` for secret injection and ingress exposure
- frontend portals for unsafe rendering, auth/session handling, and API surface assumptions

## Supported Security Tooling

The repository currently includes pipeline support for:

- SonarQube
- Trivy
- optional Snyk

See [docs/CICD.md](./docs/CICD.md) for the current CI/CD security gates.
