# syntax=docker/dockerfile:1

# --- deps: install all dependencies (incl. dev, needed to build/migrate) ---
FROM node:22-alpine AS deps
WORKDIR /app
# .npmrc maps the Font Awesome scopes to the private registry and reads the auth
# token from FONTAWESOME_PACKAGE_TOKEN. The token is mounted as a BuildKit secret
# for this RUN only, so it never persists in an image layer (verify with
# `docker history`). Build needs BuildKit (the `# syntax` line above enables it);
# compose passes the secret via the top-level `secrets:` block.
# The npm cache is a BuildKit cache mount, kept between builds on the same
# machine, so a lockfile change only downloads the packages that changed. That
# matters for the Font Awesome kit: it's ~166 MB and its registry bills by
# bandwidth. `docker builder prune` clears the cache; the next build refills it.
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=fa_token \
    --mount=type=cache,target=/root/.npm,sharing=locked \
    FONTAWESOME_PACKAGE_TOKEN="$(cat /run/secrets/fa_token)" npm ci --prefer-offline

# --- builder: compile the Next.js standalone bundle ---
# This stage retains the full source + deps, so it doubles as the "migrator"
# image (it has drizzle-kit and the schema available).
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner: minimal runtime image serving the standalone output ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
