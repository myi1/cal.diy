#!/bin/bash
# Smoke-test locally built images before pushing: scratch Postgres + Redis, then the web image (migrations,
# app-store seed, server) and the API image. Usage: caldiy-smoke.sh sha-<10 chars>
set -uo pipefail
TAG=${1:?tag}; N=caldiy-smoke; OWNER=myi1
PGURL=postgresql://calcom:smoke@${N}-pg:5432/calcom
common=(--network "$N" -e NODE_ENV=production -e "DATABASE_URL=$PGURL" -e "DATABASE_DIRECT_URL=$PGURL"
  -e NEXTAUTH_SECRET=smoke-secret -e CALENDSO_ENCRYPTION_KEY=abcdefghijklmnopqrstuvwxyz012345
  -e NEXT_PUBLIC_WEBAPP_URL=https://book.remaxhub.ae -e "REDIS_URL=redis://${N}-redis:6379")
cleanup() { docker rm -f ${N}-web ${N}-api ${N}-pg ${N}-redis >/dev/null 2>&1; docker network rm $N >/dev/null 2>&1; }
cleanup; docker network create $N >/dev/null
docker run -d --name ${N}-pg --network $N -e POSTGRES_USER=calcom -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=calcom postgres:16-alpine >/dev/null
docker run -d --name ${N}-redis --network $N redis:7-alpine >/dev/null
for _ in $(seq 60); do docker exec ${N}-pg pg_isready -U calcom -d calcom >/dev/null 2>&1 && break; sleep 1; done
fail=0; ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; fail=1; }

start=$SECONDS
docker run -d --name ${N}-web "${common[@]}" -e DATABASE_HOST=${N}-pg:5432 -e REMAXHUB_ENABLED_APPS=zohocalendar \
  -p 13000:3000 ghcr.io/$OWNER/caldiy-web:$TAG >/dev/null
code=000
for _ in $(seq 120); do code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:13000/auth/login); [ "$code" = 200 ] && break; sleep 2; done
[ "$code" = 200 ] && ok "web /auth/login 200 after $((SECONDS-start))s" || { bad "web /auth/login $code"; docker logs ${N}-web 2>&1 | tail -25; }
q() { docker exec ${N}-pg psql -U calcom -d calcom -tAc "$1"; }
m=$(q 'select count(*) from _prisma_migrations where finished_at is not null'); [ "${m:-0}" -gt 500 ] && ok "migrations applied: $m" || bad "migrations: $m"
a=$(q 'select count(*) from "App"'); e=$(q 'select string_agg(slug, $$,$$) from "App" where enabled'); [ "${a:-0}" -gt 50 ] && ok "seed: $a apps, enabled: ${e:-none}" || bad "seed: $a apps"
for path in /apps/zohocalendar /api/auth/providers /emails/remax-hub-logo.png; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:13000$path"); [ "$c" = 200 ] && ok "web $path 200" || bad "web $path $c"
done

start=$SECONDS
docker run -d --name ${N}-api "${common[@]}" -e API_PORT=80 -e API_URL=http://localhost -e WEB_APP_URL=https://book.remaxhub.ae \
  -e DATABASE_READ_URL=$PGURL -e DATABASE_WRITE_URL=$PGURL -e JWT_SECRET=smoke -e API_KEY_PREFIX=cal_ -e REWRITE_API_V2_PREFIX=1 \
  -e STRIPE_API_KEY=sk_unused -e STRIPE_WEBHOOK_SECRET=whsec_unused -e LOG_LEVEL=warn -p 13080:80 ghcr.io/$OWNER/caldiy-api:$TAG >/dev/null
code=000
for _ in $(seq 90); do code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:13080/health); [ "$code" = 200 ] && break; sleep 2; done
[ "$code" = 200 ] && ok "api /health 200 after $((SECONDS-start))s" || { bad "api /health $code"; docker logs ${N}-api 2>&1 | tail -25; }
c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:13080/v2/timezones); [ "$c" = 200 ] && ok "api /v2/timezones 200" || bad "api /v2/timezones $c"
c=$(curl -s -o /dev/null -w '%{http_code}' -H 'cal-api-version: 2024-09-04' "http://localhost:13080/v2/slots?eventTypeId=999&start=2026-10-05&end=2026-10-05"); [ "$c" = 404 ] || [ "$c" = 400 ] && ok "api /v2/slots answers ($c for a missing event type)" || bad "api /v2/slots $c"

for i in web api; do echo "size $i: $(docker image inspect -f '{{.Size}}' ghcr.io/$OWNER/caldiy-$i:$TAG | numfmt --to=iec)"; done
cleanup
[ $fail = 0 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
