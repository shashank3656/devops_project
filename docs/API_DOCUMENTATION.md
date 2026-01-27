# API Documentation

## Overview

The Infrastructure Portal API provides endpoints for creating infrastructure requests and viewing request history. The API follows RESTful principles and returns JSON responses.

## Base URL

- **Local Development:** `http://localhost:8080`
- **EC2 Production:** `http://34.30.10.133:8080` (or your EC2 IP)

## OpenAPI Specification

A complete OpenAPI 3.0 specification is available at:
- **File:** `backend/openapi.yaml`
- **View Online:** Use tools like [Swagger Editor](https://editor.swagger.io/) or [Swagger UI](https://swagger.io/tools/swagger-ui/)

## Endpoints

### 1. Create Infrastructure Request PR

**Endpoint:** `POST /create-pr`

**Description:** Creates a new infrastructure request, saves it to GitHub as a PR, and stores it in the database.

**Request Body:**
```json
{
  "team": "3656",
  "env": "dev",
  "cloud": "gcp",
  "service": "compute-engine",
  "config": {
    "instance_type": "n1-standard-1",
    "region": "us-central1",
    "disk_size": "20GB"
  }
}
```

**Response (Success - 200):**
```json
{
  "pr_url": "https://github.com/owner/repo/pull/123",
  "status": "created",
  "branch": "3656/dev",
  "file_path": "3656/envs/dev/request.json"
}
```

**Response (Error - 400):**
```json
{
  "error": "missing required field: team",
  "status": "error"
}
```

**File Structure:**
- Files are created at: `{team}/envs/{env}/request.json`
- Example: `3656/envs/dev/request.json`

### 2. Get Request History

**Endpoint:** `GET /history`

**Description:** Retrieves the history of infrastructure requests with optional filtering.

**Query Parameters:**
- `team` (optional): Filter by team identifier
- `env` (optional): Filter by environment
- `limit` (optional): Maximum number of results (default: 100, max: 1000)

**Example Requests:**
```
GET /history
GET /history?team=3656
GET /history?team=3656&env=dev
GET /history?team=3656&env=dev&limit=50
```

**Response (Success - 200):**
```json
{
  "status": "success",
  "count": 10,
  "data": [
    {
      "id": 1,
      "team": "3656",
      "env": "dev",
      "cloud": "gcp",
      "service": "compute-engine",
      "payload": "{\"team\":\"3656\",\"env\":\"dev\",...}",
      "pr_url": "https://github.com/owner/repo/pull/123",
      "branch": "3656/dev",
      "file_path": "3656/envs/dev/request.json",
      "status": "pr_created",
      "created_at": "2026-01-27T10:00:00Z",
      "updated_at": "2026-01-27T10:00:00Z"
    }
  ]
}
```

### 3. Health Check

**Endpoint:** `GET /health`

**Description:** Returns the health status of the API.

**Response (200):**
```json
{
  "status": "ok"
}
```

## Database

The API uses SQLite to store request history. The database file (`requests.db`) is created automatically on first run.

**Schema:**
- Table: `request_history`
- Fields: `id`, `team`, `env`, `cloud`, `service`, `payload`, `pr_url`, `branch`, `file_path`, `status`, `created_at`, `updated_at`

## CORS

The API includes CORS headers to allow requests from the frontend:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, GET, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

## Error Handling

All errors return JSON responses with:
- `error`: Error message
- `status`: "error"

Common HTTP status codes:
- `200`: Success
- `400`: Bad Request (validation errors)
- `500`: Internal Server Error

## Examples

### cURL Examples

**Create PR:**
```bash
curl -X POST http://localhost:8080/create-pr \
  -H "Content-Type: application/json" \
  -d '{
    "team": "3656",
    "env": "dev",
    "cloud": "gcp",
    "service": "compute-engine",
    "config": {
      "instance_type": "n1-standard-1"
    }
  }'
```

**Get History:**
```bash
curl http://localhost:8080/history?team=3656&env=dev
```

**Health Check:**
```bash
curl http://localhost:8080/health
```

## Testing

You can test the API using:
- cURL (command line)
- Postman
- Swagger UI (import `backend/openapi.yaml`)
- Frontend application

## Version

Current API version: **1.0.0**
