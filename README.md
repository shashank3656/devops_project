# Infrastructure Portal

Cloud-agnostic self-service infrastructure platform for managing infrastructure across AWS, GCP, and Azure.

## Quick Start

1. **Setup Environment:**
   ```bash
   cp config/.env.example config/.env
   # Edit config/.env with your GitHub credentials
   ```

2. **Start Services:**
   ```bash
   # Production (default)
   docker-compose up -d
   
   # Development (with hot reload)
   docker-compose --profile dev up
   ```

3. **Access Application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8080

## Project Structure

```
devops_project/
├── config/          # Environment configuration files
│   ├── .env
│   └── .env.example
├── docs/            # All documentation
├── backend/         # Go backend service
├── frontend/        # Next.js frontend
└── docker-compose.yml
```

## Documentation

All documentation is available in the [`docs/`](./docs/) directory:

- [Docker Compose Guide](./docs/DOCKER_COMPOSE.md)
- [Docker Networking](./docs/DOCKER_NETWORKING.md)
- [Frontend Documentation](./docs/frontend-README.md)
- [Backend Documentation](./docs/backend-README.md)

## Features

- ✅ Multi-cloud support (AWS, GCP, Azure)
- ✅ Self-service infrastructure provisioning
- ✅ GitHub PR-based workflow
- ✅ GitOps principles
- ✅ Security scanning integration
- ✅ Cost estimation

## Configuration

Environment variables are stored in `config/.env`. See `config/.env.example` for required variables.

**Important for EC2 Deployment:**
- Update `NEXT_PUBLIC_API_URL` in `config/.env` to your EC2 IP/domain
- Example: `NEXT_PUBLIC_API_URL=http://54.123.45.67:8080`
- After changing, rebuild frontend: `docker-compose build frontend-prod`
- See [Deployment Guide](./docs/DEPLOYMENT.md) for details

## License

MIT
