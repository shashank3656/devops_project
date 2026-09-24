# Build from repository root:
#   docker build -f backend/Dockerfile .
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY backend/go.mod backend/go.sum ./
COPY backend/*.go ./

RUN go mod download && \
    go mod verify && \
    go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o backend .

FROM alpine:3.20

# hadolint ignore=DL3018
RUN apk --no-cache add ca-certificates wget postgresql-client
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

ENV PORT=8080 \
    DB_CONN_MAX_LIFETIME_MINUTES=2 \
    DB_CONN_MAX_IDLE_TIME_MINUTES=1 \
    DB_MAX_OPEN_CONNS=15 \
    DB_MAX_IDLE_CONNS=3 \
    FRONTEND_URL=https://devopsproject-frontend-production.up.railway.app \
    ADMIN_FRONTEND_URL=https://devopsproject-admin-frontend-production.up.railway.app \
    DEVOPS_FRONTEND_URL=https://devopsproject-devops-frontend-production.up.railway.app \
    NEXT_PUBLIC_API_URL=https://backend-api-production-ed.up.railway.app \
    REDIS_ADDR=redis-production-75cbc.up.railway.app:6379 \
    REDIS_URL=redis://redis-production-75cbc.up.railway.app:6379 \
    REDIS_PASSWORD="" \
    REDIS_DB=0 \
    REDIS_CACHE_TTL_SECONDS=90 \
    REDIS_QUEUE_NAME=infra:jobs \
    REDIS_JOB_POLL_TIMEOUT_SECONDS=5 \
    DB_QUERY_TIMEOUT_SECONDS=5 \
    DB_TX_TIMEOUT_SECONDS=30 \
    DB_SLOW_QUERY_MS=750 \
    REQUEST_LOG_SLOW_MS=500 \
    DB_SSLROOTCERT=/app/certs/prod-ca-2021.crt

COPY --from=builder --chown=app:app /app/backend .
COPY --chown=app:app config/ /app/config/
COPY --chown=app:app prod-ca-2021.crt /app/certs/prod-ca-2021.crt

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1
CMD ["./backend"]
