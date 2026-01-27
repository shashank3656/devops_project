# Docker Compose Guide

This project includes Docker Compose configurations for easy deployment and development.

## Files

- `docker-compose.yml` - Production configuration
- `docker-compose.dev.yml` - Development configuration with hot reload
- `.env.example` - Example environment variables

## Quick Start

### Production

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file with your configuration:**
   ```env
   # GITHUB_OWNER can be your GitHub username (personal account) or organization name
   GITHUB_OWNER=your-github-username
   GITHUB_REPO=infra-live
   GITHUB_APP_ID=123456
   GITHUB_INSTALL_ID=123456
   ```

3. **Create GitHub Personal Access Token:**
   - Go to https://github.com/settings/tokens
   - Generate a new token (classic) with `repo` scope
   - Add it to your `.env` file as `GITHUB_TOKEN`

4. **Build and start services:**
   ```bash
   docker-compose up -d
   ```

5. **View logs:**
   ```bash
   docker-compose logs -f
   ```

6. **Stop services:**
   ```bash
   docker-compose down
   ```

### Development

For development with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

This will:
- Mount source code as volumes
- Enable hot reload for both frontend and backend
- Use development mode

## Services

### Backend
- **Port:** 8080
- **Health Check:** `http://localhost:8080/health`
- **Endpoints:**
  - `POST /create-pr` - Create infrastructure PR
  - `GET /health` - Health check

### Frontend
- **Port:** 3000
- **URL:** `http://localhost:3000`
- **API URL:** Configured via `NEXT_PUBLIC_API_URL`

## Environment Variables

### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_OWNER` | GitHub username (personal) or organization name | `your-github-username` |
| `GITHUB_REPO` | Repository name | `infra-live` |
| `GITHUB_TOKEN` | GitHub Personal Access Token | (required) |
| `BASE_BRANCH` | Base branch for PRs | `main` |

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:8080` |
| `NODE_ENV` | Node environment | `production` |

## Volumes

### Production
- No volumes needed (token is passed via environment variable)

### Development
- `./backend:/app` - Backend source code (for hot reload)
- `./frontend:/app` - Frontend source code (for hot reload)
- `/app/node_modules` - Anonymous volume for node_modules
- `/app/.next` - Anonymous volume for Next.js build cache

**Note:** Token is passed via environment variable, no volume mount needed.

## Health Checks

Both services include health checks:
- **Backend:** Checks `/health` endpoint
- **Frontend:** Checks if server responds on port 3000

## Networking

All services are connected via a bridge network (`infra-network`), allowing them to communicate using service names.

## Troubleshooting

### Backend won't start

1. **Check GitHub token is set:**
   ```bash
   echo $GITHUB_TOKEN
   # Or check in .env file
   ```

2. **Check environment variables:**
   ```bash
   docker-compose config
   ```

3. **View backend logs:**
   ```bash
   docker-compose logs backend
   ```

### Frontend can't connect to backend

1. **Check backend is running:**
   ```bash
   docker-compose ps
   ```

2. **Check network connectivity:**
   ```bash
   docker-compose exec frontend wget -O- http://backend:8080/health
   ```

3. **Update `NEXT_PUBLIC_API_URL`** in `.env` if needed

### Port already in use

If ports 3000 or 8080 are already in use, modify the port mappings in `docker-compose.yml`:

```yaml
ports:
  - "3001:3000"  # Use port 3001 instead of 3000
```

### Rebuild after code changes

```bash
# Rebuild specific service
docker-compose build backend
docker-compose up -d backend

# Rebuild all services
docker-compose build
docker-compose up -d
```

## Production Deployment

For production deployment:

1. **Use production compose file:**
   ```bash
   docker-compose -f docker-compose.yml up -d
   ```

2. **Set proper environment variables** in `.env`

3. **Use secrets management** for private keys (don't commit them!)

4. **Enable HTTPS** using a reverse proxy (nginx, traefik, etc.)

5. **Set up monitoring** and logging

## Example with Reverse Proxy

You can add an nginx service to the compose file:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - backend
    networks:
      - infra-network
```

## Clean Up

Remove all containers, networks, and volumes:

```bash
docker-compose down -v
```

Remove images:

```bash
docker-compose down --rmi all
```
