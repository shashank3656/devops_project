# Quick Fix: Frontend Not Connecting to Backend

## Problem
Frontend cannot connect to backend when running in Docker.

## Solution

### Option 1: Use Docker Compose (Recommended)

1. **Make sure both services are running:**
   ```bash
   docker-compose ps
   ```

2. **If not running, start them:**
   ```bash
   docker-compose up -d
   ```

3. **Check backend is accessible:**
   ```bash
   curl http://localhost:8080/health
   ```

4. **Access frontend:**
   - Open browser: `http://localhost:3000`
   - Frontend will connect to `http://localhost:8080` (exposed via Docker port mapping)

### Option 2: Run Services Separately

**Terminal 1 - Backend:**
```bash
cd devops_project/backend
go run .
```

**Terminal 2 - Frontend:**
```bash
cd devops_project/frontend
npm run dev
```

Then access: `http://localhost:3000`

### Option 3: Check Docker Network

If using Docker, verify services are on same network:

```bash
# Check network
docker network inspect devops_project_infra-network

# Test connectivity
docker-compose exec frontend wget -O- http://backend:8080/health
```

### Common Issues

1. **Backend not running:**
   ```bash
   docker-compose logs backend
   docker-compose up -d backend
   ```

2. **Port conflict:**
   ```bash
   # Check if port 8080 is in use
   lsof -i :8080
   ```

3. **Environment variables not set:**
   ```bash
   # Check .env file exists
   cat .env
   
   # Should have GITHUB_TOKEN set
   ```

4. **CORS issues:**
   - Backend has CORS enabled
   - Check browser console for CORS errors

### Verify Connection

Test backend directly:
```bash
curl -X POST http://localhost:8080/create-pr \
  -H "Content-Type: application/json" \
  -d '{"team":"test","env":"dev","cloud":"gcp","service":"gke","config":{}}'
```

### Debug Steps

1. **Check backend logs:**
   ```bash
   docker-compose logs -f backend
   ```

2. **Check frontend logs:**
   ```bash
   docker-compose logs -f frontend
   ```

3. **Check browser console:**
   - Open DevTools (F12)
   - Check Console and Network tabs
   - Look for error messages

4. **Test backend health:**
   ```bash
   curl http://localhost:8080/health
   ```

### Expected Behavior

- Backend should respond to: `http://localhost:8080/health`
- Frontend should be accessible at: `http://localhost:3000`
- Frontend should connect to backend at: `http://localhost:8080`

If all three work, the connection should be successful!
