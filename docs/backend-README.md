# Infrastructure Portal - Backend

Go backend service for creating GitHub Pull Requests with infrastructure configurations.

## Overview

The backend is a stateless, cloud-agnostic service that:
1. Receives JSON payloads from the frontend
2. Creates a new branch in the GitHub repository
3. Saves the configuration as JSON in the repository structure: `configs/<team>/<env>/<cloud>-<service>.json`
4. Creates a GitHub Pull Request
5. Returns the PR URL to the frontend

## Tech Stack

- **Go 1.25+** - Programming language
- **github.com/google/go-github/v61** - GitHub API client
- **github.com/bradleyfalzon/ghinstallation/v2** - GitHub App authentication

## Configuration

The backend uses environment variables for configuration. Set these in your `config/.env` file or docker-compose:

```bash
GITHUB_OWNER=your-username        # Your GitHub username (personal) or organization name
GITHUB_REPO=infra-live           # Repository name
GITHUB_TOKEN=your-token          # GitHub Personal Access Token
BASE_BRANCH=main                  # Base branch for PRs
```

**Note:** `GITHUB_OWNER` can be either:
- Your personal GitHub username (e.g., `"john-doe"`)
- An organization name (e.g., `"my-company"`)

### Setting up GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Infra Portal Backend")
4. Select the following scopes:
   - `repo` (Full control of private repositories)
     - This includes: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`, `security_events`
5. Click "Generate token"
6. **Copy the token immediately** (you won't be able to see it again)
7. Add it to your `config/.env` file as `GITHUB_TOKEN`

**Security Note:** Never commit your token to version control. Always use environment variables or secrets management.

## API Endpoints

### POST `/create-pr`

Creates a GitHub PR with infrastructure configuration.

**Request Body:**
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

**Response:**
```json
{
  "pr_url": "https://github.com/org/repo/pull/123",
  "status": "created",
  "branch": "infra-team-name-dev-gcp-gke"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid JSON or missing required fields
- `500 Internal Server Error` - Failed to create PR

### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Running the Backend

### Local Development

```bash
cd backend
go mod download
go run .
```

### With Docker

```bash
docker build -t infra-backend .
docker run -p 8080:8080 \
  -v /path/to/private-key.pem:/app/private-key.pem \
  infra-backend
```

### Environment Variables (Optional)

You can also use environment variables for configuration by modifying `config.go`:

```go
GitHubOwner = os.Getenv("GITHUB_OWNER")
GitHubRepo = os.Getenv("GITHUB_REPO")
// ... etc
```

## File Structure

The backend saves configurations in the following structure:

```
configs/
├── <team>/
│   ├── <env>/
│   │   ├── <cloud>-<service>.json
│   │   └── ...
│   └── ...
└── ...
```

Example:
```
configs/
└── platform-team/
    ├── dev/
    │   ├── gcp-gke.json
    │   └── aws-ec2.json
    └── prod/
        └── gcp-gke.json
```

## Error Handling

The backend includes:
- Input validation for required fields
- Type checking for all fields
- Proper error messages
- CORS support for frontend
- Logging for debugging

## Security Considerations

1. **GitHub App Authentication**: Uses GitHub App instead of PATs for better security
2. **No Credential Storage**: Backend doesn't store cloud credentials
3. **Input Validation**: Validates all inputs before processing
4. **Error Messages**: Doesn't expose sensitive information in errors

## CI/CD Integration

After a PR is created, GitHub Actions should:
1. Clone the repository
2. Run Checkov (security scanning)
3. Run Terrascan (security scanning)
4. Run cost estimation
5. Run `terraform plan`
6. Attach results as PR comments

On PR merge:
1. Run `terraform apply`
2. Send email/Slack notifications

## Troubleshooting

### "Failed to create PR"

- Check GitHub App credentials in `config.go`
- Verify private key file exists and is readable
- Ensure GitHub App has correct permissions
- Check repository name and owner are correct

### "Invalid JSON"

- Verify request body is valid JSON
- Check Content-Type header is `application/json`

### CORS Errors

- Backend includes CORS headers by default
- For production, restrict `Access-Control-Allow-Origin` to your frontend domain

## Development

### Adding New Features

1. Add new handlers in `main.go`
2. Add GitHub operations in `github.go`
3. Update configuration in `config.go` if needed

### Testing

```bash
# Test health endpoint
curl http://localhost:8080/health

# Test create PR endpoint
curl -X POST http://localhost:8080/create-pr \
  -H "Content-Type: application/json" \
  -d '{
    "team": "test-team",
    "env": "dev",
    "cloud": "gcp",
    "service": "gke",
    "config": {"cluster_name": "test"}
  }'
```

## License

MIT
