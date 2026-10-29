#!/usr/bin/env bash
# Checks a built Linguva image the way Railway runs it (docs/RAILWAY_STAGING.md):
# migrations as the owner role; the web app and the worker in staging mode
# against a fresh database, then the smoke checks (pnpm ops:smoke); and the
# web app in production mode, which runs the worker itself (§8b): it starts,
# survives a killed worker and stops cleanly.
# Needs PostgreSQL with the local roles (scripts/db/init-roles.sql) and Redis
# on localhost. Throwaway secrets only; nothing leaves the machine.
#
#   scripts/ci/image-check.sh linguva:ci
set -euo pipefail
IMAGE=${1:?image tag}
PORT=${IMAGE_CHECK_PORT:-3999}
DB=linguva_imagecheck
ENV_FILE=$(mktemp)
PROD_PORT=$((PORT - 1))
trap 'docker rm -f lv-check-web lv-check-worker lv-check-embedded >/dev/null 2>&1 || true; rm -f "$ENV_FILE"' EXIT

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

# True when the container's log contains the text. Reads the whole log: with
# grep -q, grep stops at the first match, docker logs then dies of SIGPIPE
# writing the rest, and pipefail fails the check although the text is there.
logged() { [ "$(docker logs "$1" 2>&1 | grep -cF -- "$2")" -gt 0 ]; }

echo "▸ Web and worker in staging mode"
docker run -d --name lv-check-web --network host --env-file "$ENV_FILE" "$IMAGE" >/dev/null
docker run -d --name lv-check-worker --network host --env-file "$ENV_FILE" -e LOG_SERVICE=linguva-worker "$IMAGE" node build/worker/index.js >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/healthz")" = 200 ] && break
  sleep 1
done
if ! logged lv-check-worker '"worker started"'; then
  sleep 5
  logged lv-check-worker '"worker started"' || { docker logs lv-check-worker; echo "✗ worker didn't start"; exit 1; }
fi
echo "✓ worker started (mock provider)"
docker exec lv-check-web whoami | grep -qx node && echo "✓ runs as the unprivileged node user"

echo "▸ Smoke checks"
node build/ops/smoke.js --url "http://localhost:$PORT" --refused-shop karinex.myshopify.com
# Staging has its own worker service: the web process runs none.
logged lv-check-web '"embedded worker off"' || { docker logs lv-check-web; echo "✗ staging web didn't report its worker off"; exit 1; }
if logged lv-check-web '"worker started"'; then docker logs lv-check-web; echo "✗ staging web started a worker"; exit 1; fi
echo "✓ staging web runs no worker of its own"

echo "▸ Production mode: the web process runs the worker (no worker service)"
# Its own Redis database, so the staging worker's heartbeat can't answer for it.
docker run -d --name lv-check-embedded --network host --env-file "$ENV_FILE" \
  -e LINGUVA_STAGE=production -e LINGUVA_PRODUCTION_APPROVED=yes -e TRANSLATION_PROVIDER=deepl -e ALLOWED_SHOPS= \
  -e PORT="$PROD_PORT" -e SHOPIFY_APP_URL="http://localhost:$PROD_PORT" -e REDIS_URL=redis://localhost:6379/10 \
  "$IMAGE" >/dev/null
started() { docker logs lv-check-embedded 2>&1 | grep '"worker started"' | grep -c '"mode":"embedded"' || true; }
for _ in $(seq 1 40); do [ "$(started)" -ge 1 ] && break; sleep 1; done
[ "$(started)" -ge 1 ] || { docker logs lv-check-embedded; echo "✗ embedded worker didn't start"; exit 1; }
[ "$(docker logs lv-check-embedded 2>&1 | grep -F '"worker started"' | grep -cF '"provider":"none"')" -ge 1 ] || { echo "✗ unexpected provider"; exit 1; }
echo "✓ embedded worker started (no provider key)"
node build/ops/smoke.js --url "http://localhost:$PROD_PORT" --expect-worker

docker exec lv-check-embedded pkill -KILL -f build/worker/index.js
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PROD_PORT/healthz")" = 200 ] || { echo "✗ web went down with the worker"; exit 1; }
for _ in $(seq 1 20); do [ "$(started)" -ge 2 ] && break; sleep 1; done
[ "$(started)" -ge 2 ] || { docker logs lv-check-embedded; echo "✗ killed worker wasn't restarted"; exit 1; }
logged lv-check-embedded '"embedded worker exited"' || { echo "✗ worker exit not logged"; exit 1; }
echo "✓ a killed worker is restarted; the web kept serving"

docker stop -t 40 lv-check-embedded >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' lv-check-embedded)" = 0 ] || { docker logs lv-check-embedded; echo "✗ unclean stop"; exit 1; }
logged lv-check-embedded '"worker shutting down"' || { echo "✗ worker wasn't stopped by the web process"; exit 1; }
echo "✓ stops cleanly (exit 0), the worker first"
