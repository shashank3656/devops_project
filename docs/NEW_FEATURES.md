# New Features: DB Query & K8s Browser

## Database Query UI ✅ Implemented

Run read-only SQL queries against configured databases from the Admin portal.

### Access
- **Admin portal** → **DB Query** (nav item)
- Requires admin login

### Features
- Execute SELECT queries only (no INSERT/UPDATE/DELETE/DROP)
- Max 1000 rows, 30s timeout
- Export results to CSV
- Multiple connections supported via env vars

### Configuration

**Default:** The main InfraGate database is always available as "InfraGate (main)".

**Additional connections:** Add to `config/.env`:
```bash
# Example: Analytics DB
DB_QUERY_1_NAME=Analytics DB
DB_QUERY_1_DSN=host=analytics-db.example.com port=5432 user=readonly password=xxx dbname=analytics sslmode=require

# Up to 5 extra connections (DB_QUERY_2_*, DB_QUERY_3_*, etc.)
```

DSN format: PostgreSQL connection string. Examples:
- `host=HOST port=5432 user=USER password=PASS dbname=DB sslmode=disable`
- `postgres://user:pass@host:5432/dbname?sslmode=require`

### Security
- Only admin users can access
- Queries are validated (SELECT/WITH only)
- Audit log records each query execution
- Use read-only DB users for extra connections

### API Endpoints
- `GET /api/admin/db-connections` – list available connections
- `POST /api/admin/db-query` – execute query (body: `{ "connection_id": "main", "query": "SELECT ..." }`)

---

## Kubernetes Resource Browser 🔜 Planned

A read-only K8s browser (namespaces, pods, deployments, logs) for the DevOps portal.

### Planned Implementation
1. Add `k8s.io/client-go` and `k8s.io/api` to backend
2. Config: `KUBECONFIG` env or in-cluster (when running inside K8s)
3. Endpoints under `/api/devops/k8s/`:
   - `GET /namespaces` – list namespaces
   - `GET /namespaces/:ns/pods` – list pods
   - `GET /namespaces/:ns/deployments` – list deployments
   - `GET /namespaces/:ns/pods/:name/logs` – pod logs
4. DevOps portal: new "K8s" page with namespace selector and resource tables

### Dependencies
```bash
cd backend
go get k8s.io/client-go@v0.29.0 k8s.io/api@v0.29.0
```

### Deployment Notes
- **Out-of-cluster:** Set `KUBECONFIG` to point to kubeconfig file
- **In-cluster:** Deploy backend as a K8s Deployment; it will use the service account automatically
- Ensure RBAC allows the service account to list pods, deployments, and get logs
