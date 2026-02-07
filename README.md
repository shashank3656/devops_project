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
   - **Admin frontend:** http://localhost:3001 (teams & members, users; admin only)
   - **DevOps frontend:** http://localhost:3002 (my tickets, workload view; DevOps users only)
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
├── devops-frontend/ # Next.js DevOps portal (port 3002)
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

## Troubleshooting: "Failed to fetch" / "Cannot connect to backend" on Login

If you see **"Failed to fetch"**, **"Cannot connect to backend"**, or **"Cannot connect to server"** on the **user frontend**, **admin frontend**, or **DevOps frontend** (e.g. at `http://20.219.96.249:8080`):

1. **Backend must be running**  
   - Start the stack: `docker-compose up -d` (starts backend on port 8080).  
   - Check: open `http://<your-backend-host>:8080/health` in a browser; you should see a JSON response.  
   - If using profiles: `backend-prod` runs with the default profile; `backend` runs with `--profile dev`.

2. **Correct API URL and rebuild**  
   - All frontends use `NEXT_PUBLIC_API_URL` from `config/.env`.  
   - **Local:** use `http://localhost:8080` if the browser and backend are on the same machine.  
   - **Remote (e.g. EC2):** use the URL the **browser** can reach (e.g. `http://20.219.96.249:8080`).  
   - After changing `NEXT_PUBLIC_API_URL`, **rebuild** so the URL is baked in:  
     - User/Admin: `docker-compose build frontend-prod admin-frontend-prod`  
     - **DevOps:** `docker-compose build devops-frontend-prod`  
   - Then restart: `docker-compose up -d`.

3. **Reachability from your browser**  
   - The backend is called **from the user’s browser**, not from the frontend container. So `NEXT_PUBLIC_API_URL` must be a URL that **your browser** can reach.  
   - From the same machine as the server: `http://localhost:8080` or `http://<server-ip>:8080`.  
   - From another machine: use `http://<server-ip>:8080` and ensure port 8080 is open (firewall / security group).

4. **CORS / mixed content**  
   - Backend allows all origins (`Access-Control-Allow-Origin: *`).  
   - If the site is served over **HTTPS**, the API URL must be **HTTPS** as well, or the browser may block the request.

5. **Firewall**  
   - Ensure port **8080** is open on the host running the backend (e.g. EC2 security group, local firewall).

**Why does the connection fail?** One of three things is usually wrong:

| Cause | What’s happening | What to do |
|-------|-------------------|------------|
| **Backend not running** | The backend container isn’t up, so nothing is listening on 8080. | On the server: `docker ps` and look for `infra-backend`. If missing, run `docker-compose up -d` (same directory as `docker-compose.yml`). |
| **Port 8080 not reachable** | Backend is running, but the machine’s firewall or cloud security group blocks inbound 8080. Your browser never reaches the server. | On the server: `curl -s http://localhost:8080/health` should return JSON. If that works but from your laptop/browser `http://20.219.96.249:8080/health` fails, open port **8080** in the server’s firewall / Azure NSG / AWS security group. |
| **Wrong URL** | Backend is on another IP, port, or host. The URL baked into the frontend doesn’t match. | Set `NEXT_PUBLIC_API_URL` in `config/.env` to the URL your **browser** can use (e.g. `http://20.219.96.249:8080`), then rebuild the frontend and restart. |

**Quick checks on the server (where Docker runs):**
```bash
# Is the backend container running?
docker ps --format '{{.Names}} {{.Ports}}' | grep -E 'backend|8080'

# Does the backend respond locally?
curl -s http://localhost:8080/health
```
If the first shows no backend and the second fails, start the stack with `docker-compose up -d`. If the second works but the browser still can’t open `http://20.219.96.249:8080/health`, open port 8080 in the firewall/security group for that machine.

## License

MIT
