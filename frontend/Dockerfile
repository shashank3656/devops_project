# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Accept build argument for API URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Copy dependency files
COPY package.json ./

# Install all dependencies (including dev dependencies for build)
# npm ci requires package-lock.json, so we use npm install which works with or without it
RUN npm install

# Copy source files needed for build
COPY next.config.js ./
COPY tsconfig.json ./
COPY pages ./pages
COPY config ./config
COPY styles ./styles

# Build Next.js application (NEXT_PUBLIC_API_URL is baked into the bundle here)
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Install wget for health checks
RUN apk --no-cache add wget

# Copy package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.js ./

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/.next ./.next

# Create public directory if it doesn't exist (Next.js requires it)
RUN mkdir -p public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000 || exit 1

# Start the application
CMD ["npm", "run", "start"]
