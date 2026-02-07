# Troubleshooting Guide

## "Failed to fetch" Error

If you're getting a "Failed to fetch" error when creating a PR from the frontend, follow these steps:

### 1. Check if Backend is Running

```bash
# Check if backend container is running
docker-compose ps

# Or check backend logs
docker-compose logs backend

# Or test the health endpoint
curl http://localhost:8080/health
```

Expected response:
```json
{"status":"ok"}
```

### 2. Verify Backend is Listening on Correct Port

```bash
# Check if port 8080 is in use
lsof -i :8080

# Or test with curl
curl -X POST http://localhost:8080/create-pr \
  -H "Content-Type: application/json" \
  -d '{"team":"test","env":"dev","cloud":"gcp","service":"gke","config":{}}'
```

### 3. Check Environment Variables

Make sure your `.env` file has the correct values:

```bash
# Check environment variables
cat .env

# Should contain:
# GITHUB_OWNER=shashank3656
# GITHUB_REPO=Application_Onboarding
# GITHUB_TOKEN=your-token-here
# BASE_BRANCH=main
```

### 4. Check Browser Console

Open browser developer tools (F12) and check:
- **Console tab**: Look for CORS errors or network errors
- **Network tab**: Check the request details and response

### 5. Common Issues

#### Backend Not Running
```bash
# Start backend
docker-compose up -d backend

# Or rebuild and start
docker-compose up -d --build backend
```

#### Port Already in Use
```bash
# Find what's using port 8080
lsof -i :8080

# Kill the process or change port in docker-compose.yml
```

#### CORS Issues
- Backend has CORS enabled by default
- If still having issues, check browser console for CORS errors
- Make sure frontend is accessing backend on same origin or CORS is properly configured

#### GitHub Token Issues
```bash
# Check backend logs for token errors
docker-compose logs backend | grep -i token

# Verify token is set
docker-compose exec backend env | grep GITHUB_TOKEN
```

### 6. Test Backend Directly

Test the backend API directly:

```bash
# Health check
curl http://localhost:8080/health

# Create PR test
curl -X POST http://localhost:8080/create-pr \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "team": "test-team",
    "env": "dev",
    "cloud": "gcp",
    "service": "gke",
    "config": {
      "cluster_name": "test-cluster"
    }
  }'
```

### 7. Check Docker Network

If using Docker Compose, ensure services can communicate:

```bash
# Check network
docker network ls

# Test connectivity from frontend container
docker-compose exec frontend wget -O- http://backend:8080/health
```

### 8. Frontend Configuration

Make sure frontend is using the correct backend URL:

- Development: `http://localhost:8080`
- Docker: `http://backend:8080` (internal Docker network)
- Production: Set via `NEXT_PUBLIC_API_URL` environment variable

### 9. Restart Services

Sometimes a simple restart fixes issues:

```bash
# Restart all services
docker-compose restart

# Or rebuild and restart
docker-compose down
docker-compose up -d --build
```

### 10. Check Logs

```bash
# Backend logs
docker-compose logs -f backend

# Frontend logs
docker-compose logs -f frontend

# All logs
docker-compose logs -f
```

## Group manager approval not used (requests go straight to DevOps)

When a user submits a draft, the request should go to **pending_user_manager_approval** (group manager) first if the creator has a group manager. If it always goes to **pending_devops_approval** instead, check the following.

### 1. Check backend logs on submit

On each submit the backend logs why it chose the status, for example:

- `[submit] request id=... creator=... team="..." -> pending_user_manager_approval (group_manager=...)` — group manager was found; request is pending group manager.
- `[submit] request id=... creator=... team="..." -> pending_devops_approval (no group manager in team and no creator.manager_id; ...)` — no group manager; request goes straight to DevOps.

Search logs for `[submit]` to see the exact reason.

### 2. Ensure the request’s team is a portal team

Group manager is resolved from the **request’s team** (the team name/slug chosen when creating the request). That team must:

- Exist in **Admin → Teams** and have **Group type: Portal** (not DevOps).
- Have the **creator** as a member (they picked this team from “My teams”).
- Have at least one **other** member (not the creator) with role **Manager**.

### 3. Assign a manager to the portal team

In **Admin → Teams → [your portal team] → Members**:

- Set one user’s role to **Manager** (portal roles: Developer, Senior developer, Lead, **Manager**).
- The group manager must be **someone other than the creator** of the request. If the creator is the only manager, the system will not use group manager approval for their own requests.

### 4. Optional: set creator’s manager (users.manager_id)

If you don’t use team-based managers, you can set a **manager** on the user in **Admin → Users → [user]**. If `manager_id` is set, that manager can approve the “group manager” step even when the portal team has no role=manager.

### Summary

| Condition | Result |
|----------|--------|
| Portal team has another member with role **Manager** (and creator is in that team) | → **pending_user_manager_approval** |
| Creator has **manager_id** set and no team manager | → **pending_user_manager_approval** |
| Otherwise | → **pending_devops_approval** |

## Still Having Issues?

1. Check that both frontend and backend are running
2. Verify the backend URL in frontend code matches your setup
3. Check browser console for detailed error messages
4. Verify GitHub token has correct permissions
5. Check backend logs for specific error messages
