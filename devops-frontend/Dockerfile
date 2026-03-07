FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json ./
RUN npm install
COPY next.config.js tsconfig.json next-env.d.ts ./
COPY pages ./pages
COPY components ./components
COPY context ./context
COPY lib ./lib
COPY styles ./styles
COPY public ./public
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# hadolint ignore=DL3018
RUN apk --no-cache add wget
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/next.config.js ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3002 || exit 1
CMD ["npm", "run", "start"]
