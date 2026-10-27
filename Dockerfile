FROM node:22-alpine
RUN apk add --no-cache openssl && corepack enable

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm exec prisma generate && pnpm run build && pnpm prune --prod

# Migrations run as the owner role (MIGRATION_DATABASE_URL); the server
# connects as the runtime role (DATABASE_URL).
CMD ["pnpm", "run", "docker-start"]
