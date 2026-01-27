# Docker Networking Explanation

## The Problem

When frontend runs in Docker and makes API calls from the **browser**, it cannot use Docker service names like `http://backend:8080` because:

1. **Browser runs on your host machine**, not inside Docker
2. **Docker service names only work inside Docker network** (server-to-server)
3. **Browser needs `localhost:8080`** to access the exposed port

## How It Works

```
┌─────────────────────────────────────────┐
│  Your Browser (Host Machine)            │
│  ┌───────────────────────────────────┐  │
│  │ Frontend App (localhost:3000)     │  │
│  │ Makes fetch() to:                 │  │
│  │ http://localhost:8080            │  │ ← Browser uses localhost
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
           │
           │ Port 8080 (exposed)
           ▼
┌─────────────────────────────────────────┐
│  Docker Network                         │
│  ┌───────────────────────────────────┐  │
│  │ Backend Container                 │  │
│  │ Listens on: 0.0.0.0:8080          │  │
│  │ Exposed as: localhost:8080        │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Configuration

### For Browser Access (Client-Side)
```yaml
# docker-compose.yml
environment:
  - NEXT_PUBLIC_API_URL=http://localhost:8080  # ✅ Browser can access
```

### Why NOT `http://backend:8080`?
- ❌ Browser doesn't know what "backend" means
- ❌ Browser is outside Docker network
- ❌ Service names only work for server-to-server

### When to Use `http://backend:8080`?
Only for **server-side** requests (Next.js API routes, SSR):
```javascript
// This would work in Next.js API route (server-side)
const response = await fetch('http://backend:8080/create-pr');
```

## Solution

Always use `localhost:8080` for client-side browser requests:

```yaml
# docker-compose.yml
services:
  frontend:
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8080  # ✅ Correct
```

## Testing

1. **Check backend is accessible:**
   ```bash
   curl http://localhost:8080/health
   ```

2. **Check from browser:**
   - Open: `http://localhost:3000`
   - Open DevTools → Network tab
   - Should see requests to `http://localhost:8080`

3. **Check Docker port mapping:**
   ```bash
   docker-compose ps
   # Should show: 0.0.0.0:8080->8080/tcp
   ```

## Alternative: Next.js API Proxy

If you want to use Docker service names, create a Next.js API route:

```typescript
// pages/api/create-pr.ts
export default async function handler(req, res) {
  const response = await fetch('http://backend:8080/create-pr', {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body)
  });
  const data = await response.json();
  res.json(data);
}
```

Then frontend calls: `/api/create-pr` instead of `http://localhost:8080/create-pr`

But for simplicity, using `localhost:8080` is the easiest solution!
