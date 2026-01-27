# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies for SQLite (CGO)
RUN apk add --no-cache gcc musl-dev sqlite-dev

# Copy go.mod and source files together
COPY go.mod ./
COPY *.go ./

# Download and verify dependencies
RUN go mod download && \
    go mod verify && \
    go mod tidy

# Build the application (CGO enabled for SQLite)
RUN CGO_ENABLED=1 GOOS=linux go build -a -tags sqlite_omit_load_extension -o backend .

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates wget sqlite

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/backend .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["./backend"]
