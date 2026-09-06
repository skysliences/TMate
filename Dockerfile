FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:web

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 PUBLIC_DIR=/app/www
COPY --from=dependencies --chown=node:node /app/package*.json ./
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/www ./www
COPY --chown=node:node server ./server
COPY --chown=node:node deploy/pair-device.mjs ./deploy/pair-device.mjs
COPY --chown=node:node deploy/smoke.mjs ./deploy/smoke.mjs
COPY --chown=node:node scripts/check-config.mjs ./scripts/check-config.mjs
RUN install -d -o node -g node -m 700 /app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
