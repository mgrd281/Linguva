# Linguva: one image for the web app and the background worker
# (docs/RAILWAY_STAGING.md). Built in stages so the image that runs holds
# only production dependencies and the build output: no dev dependencies,
# no package store, no tests or docs. Runs as the unprivileged `node` user.
#
#   web:     react-router-serve ./build/server/index.js   (default command)
#   worker:  node build/worker/index.js
#   migrate: node scripts/migrate.mjs   (pre-deploy, owner role)

FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# Everything needed to build.
FROM base AS build
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm exec prisma generate && pnpm run build

# Production dependencies only, with the generated Prisma client.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod && pnpm exec prisma generate

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY prisma ./prisma
COPY scripts/migrate.mjs ./scripts/migrate.mjs
USER node
EXPOSE 3000
CMD ["react-router-serve", "./build/server/index.js"]
