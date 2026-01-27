# Quick Start Guide

## Installation

```bash
cd frontend
npm install
```

## Development

```bash
npm run dev
```

Visit `http://localhost:3000`

## Features Implemented

### ✅ Login Page (`/`)
- Modern UI with gradient background
- Email/password authentication (demo mode)
- Redirects to home after login

### ✅ Home Page (`/home`)
- Two main options:
  1. **Select Cloud & Service** - Guided form
  2. **Custom JSON** - Advanced JSON input
- Logout functionality
- Beautiful card-based UI with hover effects

### ✅ Select Service Page (`/select-service`)
- Team name and environment selection
- Cloud provider selection (AWS, GCP, Azure)
- Service selection based on cloud:
  - **AWS**: EC2, VPC, EKS, RDS
  - **GCP**: GKE, Compute Engine, Cloud SQL, VPC, Cloud Storage
- Dynamic form generation based on selected service
- Form validation
- Creates PR via backend API
- Displays PR URL after creation

### ✅ Custom JSON Page (`/custom-json`)
- Team name and environment selection
- JSON textarea with syntax validation
- Format JSON button
- Load example JSON button
- Real-time validation feedback
- Creates PR via backend API
- Displays PR URL after creation

## Backend API Expected

The frontend expects a backend running at `http://localhost:8080` with:

**POST /create-pr**

Request:
```json
{
  "team": "team-name",
  "env": "dev",
  "cloud": "gcp",
  "service": "gke",
  "config": {
    "cluster_name": "my-cluster",
    "region": "us-central1",
    "node_count": 3
  }
}
```

Response:
```json
{
  "pr_url": "https://github.com/org/repo/pull/123",
  "branch": "feature/team-name-env-service",
  "status": "created"
}
```

## Project Structure

```
frontend/
├── config/
│   ├── awsServices.ts    # AWS service configs with form fields
│   ├── gcpServices.ts    # GCP service configs with form fields
│   └── clouds.ts         # Cloud provider definitions
├── pages/
│   ├── _app.tsx          # App wrapper with global styles
│   ├── index.tsx         # Login page
│   ├── home.tsx          # Home page with navigation
│   ├── select-service.tsx # Cloud/service selection
│   └── custom-json.tsx   # Custom JSON input
├── styles/
│   └── globals.css       # Global styles and utilities
└── package.json
```

## Next Steps

1. **Start Backend**: Ensure backend is running on port 8080
2. **Test Flow**: 
   - Login → Home → Select Service → Fill form → Create PR
   - Login → Home → Custom JSON → Enter JSON → Create PR
3. **Customize**: 
   - Add more services in `config/awsServices.ts` or `config/gcpServices.ts`
   - Modify styles in `styles/globals.css`
   - Update API endpoint in pages if needed

## Troubleshooting

### Port 3000 already in use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
# Or use different port
PORT=3001 npm run dev
```

### Module not found errors
```bash
# Clear cache and reinstall
rm -rf node_modules .next
npm install
```

### TypeScript errors
```bash
# Check TypeScript config
npx tsc --noEmit
```
