#!/usr/bin/env bash
# Checks a built Linguva image the way staging runs it (docs/RAILWAY_STAGING.md):
# migrations as the owner role, the web app and the worker in staging mode
# against a fresh database, then the smoke checks (pnpm ops:smoke).
# Needs PostgreSQL with the local roles (scripts/db/init-roles.sql) and Redis
# on localhost. Throwaway secrets only; nothing leaves the machine.
#
#   scripts/ci/image-check.sh linguva:ci
set -euo pipefail
IMAGE=${1:?image tag}
PORT=${IMAGE_CHECK_PORT:-3999}
DB=linguva_imagecheck
ENV_FILE=$(mktemp)
trap 'docker rm -f lv-check-web lv-check-worker >/dev/null 2>&1 || true; rm -f "$ENV_FILE"' EXIT

cat > "$ENV_FILE" <<VARS
NODE_ENV=production
LINGUVA_STAGE=staging
TRANSLATION_PROVIDER=mock
ALLOWED_SHOPS=linguva-test-lab.myshopify.com
DATABASE_URL=postgresql://linguva_app:linguva_app_dev@localhost:5432/$DB
REDIS_URL=redis://localhost:6379/9
TOKEN_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)
SHOPIFY_API_KEY=image-check
SHOPIFY_API_SECRET=$(openssl rand -hex 24)
SHOPIFY_APP_URL=http://localhost:$PORT
SCOPES=read_products,read_content,read_online_store_pages,read_translations,write_translations,read_locales,write_locales
PORT=$PORT
VARS

echo "▸ Migrations (owner role, pre-deploy command)"
docker run --rm --network host -e MIGRATION_DATABASE_URL="postgresql://linguva_owner:linguva_owner_dev@localhost:5432/$DB" "$IMAGE" node scripts/migrate.mjs | tail -1

echo "▸ Web and worker in staging mode"
docker run -d --name lv-check-web --network host --env-file "$ENV_FILE" "$IMAGE" >/dev/null
docker run -d --name lv-check-worker --network host --env-file "$ENV_FILE" -e LOG_SERVICE=linguva-worker "$IMAGE" node build/worker/index.js >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/healthz")" = 200 ] && break
  sleep 1
done
if ! docker logs lv-check-worker 2>&1 | grep -q '"worker started"'; then
  sleep 5
  docker logs lv-check-worker 2>&1 | grep -q '"worker started"' || { docker logs lv-check-worker; echo "✗ worker didn't start"; exit 1; }
fi
echo "✓ worker started (mock provider)"
docker exec lv-check-web whoami | grep -qx node && echo "✓ runs as the unprivileged node user"

echo "▸ Smoke checks"
node build/ops/smoke.js --url "http://localhost:$PORT" --refused-shop karinex.myshopify.com
