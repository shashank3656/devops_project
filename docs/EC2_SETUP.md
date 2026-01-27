# EC2 Setup Instructions

## Quick Setup Steps

### 1. Create the `.env` file on EC2

SSH into your EC2 instance and run:

```bash
cd ~/devops_project
cp config/.env.example config/.env
```

### 2. Edit the `.env` file

```bash
nano config/.env
# or
vi config/.env
```

Fill in your values (all are REQUIRED):

```env
# GitHub Configuration
GITHUB_OWNER=shashank3656
GITHUB_REPO=Application_Onboarding
GITHUB_TOKEN=your-github-token-here
BASE_BRANCH=main

# Frontend Configuration
# Use your EC2 public IP (get it with: curl http://169.254.169.254/latest/meta-data/public-ipv4)
NEXT_PUBLIC_API_URL=http://34.30.10.133:8080
```

**Important:** Replace `your-github-token-here` with your actual GitHub Personal Access Token.

### 3. Verify the file exists

```bash
ls -la config/.env
# Should show the file exists
```

### 4. Start the services

```bash
# Development mode (with hot reload)
# Note: First time will build images, may take a few minutes
sudo docker-compose --profile dev up -d --build

# Or production mode
sudo docker-compose up -d --build
```

**IMPORTANT:** 
- Use `--build` flag the first time or when Dockerfiles change
- **After changing `NEXT_PUBLIC_API_URL` in `.env`, you MUST rebuild the frontend:**
  ```bash
  sudo docker-compose build frontend-prod
  sudo docker-compose up -d frontend-prod
  ```
- Next.js bakes `NEXT_PUBLIC_*` variables into the build at build time, not runtime!

### 5. Check logs if there are issues

```bash
# Check backend logs
sudo docker-compose logs backend

# Check frontend logs
sudo docker-compose logs frontend

# Check all logs
sudo docker-compose logs
```

## Getting Your EC2 Public IP

If you need to find your EC2 public IP:

```bash
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

Then update `NEXT_PUBLIC_API_URL` in `config/.env` and rebuild the frontend:

```bash
sudo docker-compose build frontend-prod
sudo docker-compose up -d
```

## Troubleshooting

### Error: "Couldn't find env file: config/.env"

**Solution:** Create the file:
```bash
cd ~/devops_project
cp config/.env.example config/.env
nano config/.env  # Edit with your values
```

### Warning: "The GITHUB_OWNER variable is not set"

**Solution:** Make sure all required variables are set in `config/.env`:
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_TOKEN`
- `BASE_BRANCH`
- `NEXT_PUBLIC_API_URL`

### Permission Denied

If you get permission errors, you might need to use `sudo`:
```bash
sudo docker-compose up -d
```

Or add your user to the docker group:
```bash
sudo usermod -aG docker $USER
# Then logout and login again
```

### Go Vendoring Error

If you see errors like:
```
go: inconsistent vendoring in /app:
github.com/google/go-github/v61@v61.0.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
```

**Solution:** The configuration now uses `-mod=mod` to ignore vendor directories. If the error persists:

1. **Remove vendor directory (if it exists):**
   ```bash
   cd ~/devops_project/backend
   rm -rf vendor/
   ```

2. **Restart the service:**
   ```bash
   cd ~/devops_project
   sudo docker-compose restart backend
   ```

The `-mod=mod` flag tells Go to use modules directly instead of vendoring.

## Security Notes

⚠️ **Never commit `.env` file to git!**

The `.env` file contains sensitive information (GitHub tokens). Make sure it's in `.gitignore`:

```bash
# Verify .env is ignored
cat .gitignore | grep .env
```
