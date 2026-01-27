# Deployment Guide

This guide covers deploying the Infrastructure Portal on different environments including EC2.

## Deployment Scenarios

### 1. Local Development

**Configuration:**
```env
# config/.env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

**Usage:**
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`
- Both run on your local machine

### 2. EC2 Instance Deployment

When deploying on EC2, you need to configure the frontend to point to the EC2 instance's IP or domain.

#### Option A: Using EC2 Public IP

**Configuration:**
```env
# config/.env
NEXT_PUBLIC_API_URL=http://<EC2_PUBLIC_IP>:8080
# Example:
# NEXT_PUBLIC_API_URL=http://54.123.45.67:8080
```

**Steps:**
1. Get your EC2 public IP or Elastic IP
2. Update `config/.env` with the EC2 IP
3. Ensure EC2 Security Group allows:
   - Port 3000 (frontend)
   - Port 8080 (backend)
4. **IMPORTANT: Rebuild frontend** to include the new API URL (Next.js bakes env vars at build time):
   ```bash
   docker-compose build frontend-prod
   docker-compose up -d
   ```
   
   **Note:** `NEXT_PUBLIC_API_URL` is passed as a build argument and baked into the JavaScript bundle during the build. You MUST rebuild after changing it.

#### Option B: Using Domain Name

**Configuration:**
```env
# config/.env
NEXT_PUBLIC_API_URL=http://api.yourdomain.com:8080
# Or with reverse proxy:
# NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**Steps:**
1. Set up DNS pointing to your EC2 instance
2. Update `config/.env` with the domain
3. Rebuild and restart services

### 3. Docker on EC2

**Full Setup:**

1. **SSH into EC2:**
   ```bash
   ssh -i your-key.pem ec2-user@your-ec2-ip
   ```

2. **Install Docker and Docker Compose:**
   ```bash
   sudo yum update -y
   sudo yum install docker -y
   sudo systemctl start docker
   sudo usermod -aG docker ec2-user
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

3. **Clone your repository:**
   ```bash
   git clone your-repo-url
   cd devops_project
   ```

4. **Configure environment:**
   ```bash
   cp config/.env.example config/.env
   # Edit config/.env with EC2-specific values
   ```

5. **Update API URL for EC2:**
   ```env
   # config/.env
   GITHUB_OWNER=your-username
   GITHUB_REPO=your-repo
   GITHUB_TOKEN=your-token
   BASE_BRANCH=main
   
   # IMPORTANT: Use EC2 public IP or domain
   NEXT_PUBLIC_API_URL=http://<EC2_PUBLIC_IP>:8080
   # Or if using domain:
   # NEXT_PUBLIC_API_URL=http://api.yourdomain.com:8080
   ```

6. **Build and start:**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

7. **Configure Security Group:**
   - Allow inbound traffic on port 3000 (frontend)
   - Allow inbound traffic on port 8080 (backend, if needed externally)

### 4. Using Reverse Proxy (Recommended for Production)

For production, use Nginx or similar as a reverse proxy:

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Frontend Configuration:**
```env
# config/.env
NEXT_PUBLIC_API_URL=http://yourdomain.com/api
# Or if using HTTPS:
# NEXT_PUBLIC_API_URL=https://yourdomain.com/api
```

## Important Notes

### Frontend API URL Behavior

The `NEXT_PUBLIC_API_URL` is **baked into the frontend build** at build time. This means:

1. **You must rebuild the frontend** after changing `NEXT_PUBLIC_API_URL`
2. **The URL is used by the browser** (client-side), so it must be accessible from the user's browser
3. **It cannot be a Docker service name** like `http://backend:8080` because browsers can't resolve Docker service names

### EC2 Deployment Checklist

- [ ] EC2 Security Group allows ports 3000 and 8080
- [ ] `NEXT_PUBLIC_API_URL` in `config/.env` points to EC2 IP/domain
- [ ] Frontend is rebuilt after changing API URL
- [ ] Backend is accessible from the frontend URL
- [ ] GitHub token has correct permissions
- [ ] All environment variables are set in `config/.env`

### Getting EC2 Public IP

```bash
# From EC2 instance
curl http://169.254.169.254/latest/meta-data/public-ipv4

# Or check in AWS Console
# EC2 → Instances → Your Instance → Public IPv4 address
```

### Testing Connection

After deployment, test the backend:
```bash
# From your local machine
curl http://<EC2_IP>:8080/health

# Should return: {"status":"ok"}
```

## Troubleshooting

### Frontend can't connect to backend on EC2

1. **Check Security Group:**
   - Ensure port 8080 is open in EC2 Security Group
   - Check inbound rules allow traffic from your IP or 0.0.0.0/0

2. **Verify API URL:**
   ```bash
   # Check what URL frontend is using
   docker-compose exec frontend-prod env | grep NEXT_PUBLIC_API_URL
   ```

3. **Test backend directly:**
   ```bash
   curl http://<EC2_IP>:8080/health
   ```

4. **Check backend logs:**
   ```bash
   docker-compose logs backend-prod
   ```

5. **Rebuild frontend:**
   ```bash
   # After changing NEXT_PUBLIC_API_URL, rebuild:
   docker-compose build frontend-prod
   docker-compose up -d frontend-prod
   ```

### CORS Issues

If you see CORS errors, ensure the backend CORS configuration allows your frontend domain:

The backend already has CORS enabled with `Access-Control-Allow-Origin: *`, so this should work. If you need to restrict it, update `backend/main.go`.

## Production Recommendations

1. **Use HTTPS:** Set up SSL/TLS certificate (Let's Encrypt)
2. **Use Domain:** Instead of IP, use a domain name
3. **Reverse Proxy:** Use Nginx/Traefik for routing
4. **Environment Variables:** Use AWS Systems Manager Parameter Store or Secrets Manager
5. **Monitoring:** Set up CloudWatch or similar for logs
6. **Auto-scaling:** Configure EC2 Auto Scaling if needed
