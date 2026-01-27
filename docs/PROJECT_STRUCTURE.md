# Project Structure

```
devops_project/
├── config/                    # Environment configuration files
│   ├── .env                   # Your environment variables (not in git)
│   ├── .env.example           # Example environment variables template
│   └── README.md              # Configuration guide
│
├── docs/                      # All documentation
│   ├── README.md              # Documentation index
│   ├── DOCKER_COMPOSE.md      # Docker Compose guide
│   ├── DOCKER_NETWORKING.md   # Docker networking explanation
│   ├── backend-README.md      # Backend API documentation
│   ├── frontend-README.md     # Frontend documentation
│   ├── QUICK_START.md         # Frontend quick start
│   └── TECH_STACK.md          # Frontend tech stack details
│
├── backend/                   # Go backend service
│   ├── main.go               # HTTP server and handlers
│   ├── github.go             # GitHub API operations
│   ├── config.go             # Configuration constants
│   ├── go.mod                # Go dependencies
│   ├── Dockerfile            # Backend Docker image
│   └── Makefile             # Build commands
│
├── frontend/                  # Next.js frontend
│   ├── pages/                # Next.js pages
│   ├── config/               # Service configurations
│   ├── styles/               # Global styles
│   ├── lib/                  # Utility functions
│   ├── package.json          # Node dependencies
│   ├── Dockerfile            # Frontend Docker image
│   └── tsconfig.json         # TypeScript config
│
├── docker-compose.yml        # Production Docker Compose
├── docker-compose.dev.yml    # Development Docker Compose
├── .gitignore                # Git ignore rules
├── .dockerignore            # Docker ignore rules
└── README.md                 # Project overview
```

## Directory Purposes

### `config/`
Contains all environment configuration files:
- `.env` - Your actual environment variables (gitignored)
- `.env.example` - Template for environment variables

### `docs/`
Contains all project documentation:
- Main documentation files
- Frontend documentation
- Backend documentation
- Setup guides
- Technical documentation

### `backend/`
Go backend service that:
- Receives infrastructure requests
- Creates GitHub branches
- Generates PRs with infrastructure configs

### `frontend/`
Next.js frontend application that:
- Provides UI for infrastructure creation
- Handles user input and validation
- Communicates with backend API

## Environment Setup

1. Copy example environment file:
   ```bash
   cp config/.env.example config/.env
   ```

2. Edit `config/.env` with your values:
   ```env
   GITHUB_OWNER=your-username
   GITHUB_REPO=your-repo
   GITHUB_TOKEN=your-token
   BASE_BRANCH=main
   ```

## Documentation

All documentation is in the [`docs/`](./docs/) directory. Start with:
- [Main README](./README.md) - Project overview
- [Documentation Index](./docs/README.md) - All docs listed
- [Docker Compose Guide](./docs/DOCKER_COMPOSE.md) - Setup instructions
