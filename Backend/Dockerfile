# syntax=docker/dockerfile:1

# ---- Stage 1: install only production deps ------------------------------
    FROM node:20-alpine AS deps
    WORKDIR /app
    COPY package*.json ./
    # Prefer `npm ci` (strict, reproducible) when the lockfile is in sync.
    # Fall back to `npm install` so a drifted lockfile doesn't fail the build —
    # for fully-reproducible builds, run `npm install` locally and commit the
    # updated package-lock.json, then `npm ci` will succeed on the next run.
    RUN (npm ci --omit=dev || npm install --omit=dev) \
        && npm cache clean --force
    
    # ---- Stage 2: minimal runtime image -------------------------------------
    FROM node:20-alpine AS runtime
    
    # Tini gives us proper signal handling (Ctrl-C, K8s SIGTERM)
    RUN apk add --no-cache tini
    
    # Non-root user — node:alpine ships with one called `node` (uid 1000)
    WORKDIR /app
    ENV NODE_ENV=production \
        PORT=3000 \
        NPM_CONFIG_LOGLEVEL=warn
    
    COPY --from=deps --chown=node:node /app/node_modules ./node_modules
    COPY --chown=node:node . .
    
    # Don't ship dev junk that could leak info or accidentally execute
    RUN rm -rf .git .gitignore .env *.md tests test \
        && find . -name "*.backup*" -delete 2>/dev/null || true
    
    USER node
    
    EXPOSE 3000
    
    # Tini as PID 1, then node
    ENTRYPOINT ["/sbin/tini", "--"]
    CMD ["node", "index.js"]