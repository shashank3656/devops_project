# Infrastructure Portal - Frontend

A modern, cloud-agnostic self-service infrastructure platform frontend built with Next.js and TypeScript.

## Tech Stack

### Core Technologies
- **Next.js 14** - React framework with server-side rendering and routing
- **TypeScript** - Type-safe JavaScript for better developer experience
- **React 18** - Modern UI library

### Why This Stack?

1. **Next.js**:
   - Excellent developer experience with hot reloading
   - Built-in routing and API routes
   - Optimized performance with automatic code splitting
   - Easy deployment to Vercel, Docker, or any Node.js hosting
   - SEO-friendly with server-side rendering capabilities

2. **TypeScript**:
   - Type safety reduces bugs
   - Better IDE autocomplete and IntelliSense
   - Easier refactoring and maintenance
   - Self-documenting code

3. **React 18**:
   - Component-based architecture
   - Large ecosystem and community
   - Easy to extend with additional UI libraries if needed

## Features

- ✅ Modern, responsive UI with gradient design
- ✅ Login page with authentication flow
- ✅ Cloud selection (AWS, GCP, Azure)
- ✅ Service selection with dynamic form generation
- ✅ Custom JSON input with validation
- ✅ Real-time JSON formatting and validation
- ✅ PR creation with backend API integration
- ✅ Error handling and loading states

## Project Structure

```
frontend/
├── config/
│   ├── awsServices.ts      # AWS service configurations
│   ├── gcpServices.ts      # GCP service configurations
│   └── clouds.ts           # Cloud provider definitions
├── pages/
│   ├── _app.tsx            # Next.js app wrapper
│   ├── index.tsx           # Login page
│   ├── home.tsx            # Home page with navigation
│   ├── select-service.tsx  # Cloud/Service selection page
│   └── custom-json.tsx     # Custom JSON input page
├── styles/
│   └── globals.css         # Global styles
├── package.json
├── tsconfig.json
└── next.config.js
```

## Getting Started

### Prerequisites
- Node.js 18+ and npm/yarn

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Build for Production

```bash
npm run build
npm start
```

### Docker Build

```bash
docker build -t infra-portal-frontend .
docker run -p 3000:3000 infra-portal-frontend
```

## Pages

### 1. Login (`/`)
- Simple email/password login
- Stores authentication in localStorage (for demo)
- Redirects to home page after login

### 2. Home (`/home`)
- Two main options:
  - **Select Cloud & Service**: Guided form-based configuration
  - **Custom JSON**: Advanced JSON input

### 3. Select Service (`/select-service`)
- Team name and environment selection
- Cloud provider selection (AWS, GCP, Azure)
- Service selection based on cloud
- Dynamic form generation based on service
- Creates PR via backend API

### 4. Custom JSON (`/custom-json`)
- Team name and environment selection
- JSON textarea with validation
- Format JSON button
- Example JSON loader
- Creates PR via backend API

## Backend Integration

The frontend expects a backend API running at `http://localhost:8080` with the following endpoint:

### POST `/create-pr`

**Request Body:**
```json
{
  "team": "team-name",
  "env": "dev|stage|prod",
  "cloud": "aws|gcp|azure",
  "service": "service-name",
  "config": {
    "field1": "value1",
    "field2": "value2"
  }
}
```

**Response:**
```json
{
  "pr_url": "https://github.com/org/repo/pull/123",
  "branch": "feature/team-name-env-service",
  "status": "created"
}
```

## Environment Variables

Create a `.env.local` file for environment-specific configuration:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Future Enhancements

- [ ] Add Azure service configurations
- [ ] Implement proper authentication (OAuth, JWT)
- [ ] Add PR status polling
- [ ] Display validation results from CI/CD
- [ ] Add cost estimation preview
- [ ] Implement dark mode
- [ ] Add unit and integration tests
- [ ] Add E2E tests with Playwright/Cypress

## License

MIT
