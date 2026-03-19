# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go.mod and source files together
COPY go.mod ./
COPY *.go ./

# Download and verify dependencies
RUN go mod download && \
    go mod verify && \
    go mod tidy

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o backend .

# Runtime stage
FROM alpine:3.20

# hadolint ignore=DL3018
RUN apk --no-cache add ca-certificates wget postgresql-client
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

# Copy the binary from builder
COPY --from=builder --chown=app:app /app/backend .

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["./backend"]
