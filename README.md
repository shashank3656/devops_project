# InfraGate (Infrastructure Portal)

Cloud-agnostic self-service infrastructure platform for managing infrastructure across AWS, GCP, and Azure. The user-facing app is branded **InfraGate**; the admin console is **InfraGate Admin**. You can change the name in `frontend/lib/site.ts` (user) and `admin-frontend/pages/_app.tsx` (admin).

## Quick Start

1. **Setup Environment:**
   ```bash
   cp config/.env.example config/.env
   # Edit config/.env with your GitHub credentials
   
   # Sync env vars for docker-compose (or export them manually)
   ./scripts/sync-env.sh
   ```

2. **Start all containers (single command):**
   ```bash
   docker-compose up -d
   ```
   This starts postgres, backend, user frontend (port 3000), and admin frontend (port 3001). See [Docker Compose commands](docs/DOCKER_COMPOSE_CMDS.md) for more.

3. **Access Application:**
   - **User frontend:** http://localhost:3000 (login, requests, history)
   - **Admin frontend:** http://localhost:3001 (teams & members; admin only)
   - **Backend API:** http://localhost:8080

## Project Structure

```
devops_project/
├── config/          # Environment configuration files
│   ├── .env
│   └── .env.example
├── docs/            # All documentation
├── backend/         # Go backend service
├── frontend/        # Next.js user frontend (port 3000)
├── admin-frontend/  # Next.js admin frontend (port 3001)
└── docker-compose.yml
```

## Documentation

All documentation is available in the [`docs/`](./docs/) directory:

- [Docker Compose Guide](./docs/DOCKER_COMPOSE.md)
- [Docker Compose commands](./docs/DOCKER_COMPOSE_CMDS.md) (single command to start all containers)
- [Docker Networking](./docs/DOCKER_NETWORKING.md)
- [Frontend Documentation](./docs/frontend-README.md)
- [Backend Documentation](./docs/backend-README.md)
- [Admin Frontend](./docs/ADMIN_FRONTEND.md) (teams & members, runs on port 3001)
- [Feature Guide](./docs/FEATURE_GUIDE.md) (admin secret rollout, email enablement, delete teams, and more)

## Features

- ✅ Multi-cloud support (AWS, GCP, Azure)
- ✅ Self-service infrastructure provisioning
- ✅ GitHub PR-based workflow
- ✅ GitOps principles
- ✅ Security scanning integration
- ✅ Cost estimation
- ✅ Admin console: teams & groups management (create, delete, add/remove members)
- ✅ Admin secret for API/script access (`X-Admin-Secret` header)
- ✅ Audit logging for admin actions

See [Feature Guide](./docs/FEATURE_GUIDE.md) for: secure admin secret rollout, email enablement (SMTP), delete teams, and additional feature suggestions.

## Data storage

All data is stored in the **backend** (PostgreSQL): users, teams, team members, PR requests, GitHub logs. The frontends (user and admin) only call the backend API; no app data is stored in the browser except the auth token.

## Configuration

Environment variables are stored in `config/.env`. See `config/.env.example` for required variables (GitHub, database, admin secret). Optional: `SMTP_*` and `EMAIL_ENABLED` for email notifications—see [Feature Guide](./docs/FEATURE_GUIDE.md).

**Important for EC2 Deployment:**
- Update `NEXT_PUBLIC_API_URL` in `config/.env` to your EC2 IP/domain
- Example: `NEXT_PUBLIC_API_URL=http://54.123.45.67:8080`
- After changing, rebuild frontend: `docker-compose build frontend-prod`
- See [Deployment Guide](./docs/DEPLOYMENT.md) for details

## Troubleshooting: "Failed to fetch" on Login / Create account

If you see **"Failed to fetch"** or **"Cannot connect to the server"** when logging in or creating an account:

1. **Backend must be running**  
   - Start the backend: `docker-compose up -d` (or run the Go server on port 8080).  
   - Check: open `http://<your-backend-host>:8080/health` in a browser; you should see a JSON response.

2. **Correct API URL**  
   - The frontend uses `NEXT_PUBLIC_API_URL` (e.g. in `config/.env` or root `.env`).  
   - **Local:** use `http://localhost:8080` if the browser and backend are on the same machine.  
   - **Docker / remote:** use the host IP or domain the browser can reach (e.g. `http://20.219.96.249:8080`).  
   - After changing env, **rebuild** the frontend so the new URL is baked in:  
     `docker-compose build frontend-prod` or restart `npm run dev` with the env set.

3. **CORS / mixed content**  
   - Backend allows all origins (`Access-Control-Allow-Origin: *`).  
   - If the site is served over **HTTPS**, the API URL must be **HTTPS** as well, or the browser may block the request.

4. **Firewall**  
   - Ensure port **8080** is open on the machine running the backend (security group on EC2, local firewall, etc.).

## License

MIT
