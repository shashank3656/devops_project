# Build from repository root:
#   docker build -f backend/Dockerfile .
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY backend/go.mod backend/go.sum ./
COPY backend/*.go ./

RUN apk --no-cache upgrade && \
    go mod download && \
    go mod verify && \
    go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o backend .

FROM alpine:3.23

# hadolint ignore=DL3018
RUN apk --no-cache upgrade && apk --no-cache add ca-certificates wget postgresql-client
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

ENV PORT=8080 \
    DB_SSLROOTCERT=/app/certs/prod-ca-2021.crt

COPY --from=builder --chown=app:app /app/backend .
COPY --chown=app:app config/ /app/config/
COPY --chown=app:app prod-ca-2021.crt /app/certs/prod-ca-2021.crt

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1
CMD ["./backend"]
