# Configuration Files

This directory contains environment configuration files.

## Files

- **`.env.example`** - Example environment variables template
- **`.env`** - Your actual environment variables (not committed to git)

## Setup

1. Copy the example file:
   ```bash
   cp config/.env.example config/.env
   ```

2. Edit `config/.env` with your actual values (ALL ARE REQUIRED):
   ```env
   GITHUB_OWNER=your-github-username        # REQUIRED: Your GitHub username or org
   GITHUB_REPO=your-repo-name             # REQUIRED: Your GitHub repository name
   GITHUB_TOKEN=your-github-token         # REQUIRED: Your GitHub Personal Access Token
   BASE_BRANCH=main                       # Optional: Base branch (default: main)
   NEXT_PUBLIC_API_URL=http://localhost:8080  # REQUIRED: Backend API URL
   ```

**Important:** 
- All GitHub configuration values must be set in `config/.env`
- The docker-compose file does not have default values - they must come from your .env file
- **For EC2 deployment:** Change `NEXT_PUBLIC_API_URL` to your EC2 IP/domain (e.g., `http://54.123.45.67:8080`)
- **After changing `NEXT_PUBLIC_API_URL`:** You must rebuild the frontend: `docker-compose build frontend-prod`

## Security

⚠️ **Never commit `.env` file to version control!**

The `.env` file is already in `.gitignore` to prevent accidental commits.
