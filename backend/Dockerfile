# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum first for better layer caching
COPY go.mod go.sum ./

# Download dependencies (no tidy to avoid modifying files)
RUN go mod download && go mod verify

# Copy all source files
COPY *.go ./

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o backend .

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates wget postgresql-client

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/backend .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["./backend"]
