#!/bin/sh
# remaxhub: start-up for the slim (Next.js standalone) web image. Same steps as start.sh, without the
# full workspace: migrations with the Prisma CLI in /tools, the app-store seed as a bundled JS file.
set -e

# Replace the statically built BUILT_NEXT_PUBLIC_WEBAPP_URL with run-time NEXT_PUBLIC_WEBAPP_URL
# (skipped when they're the same, as they are for book.remaxhub.ae).
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"

scripts/wait-for-it.sh "${DATABASE_HOST}" -- echo "database is up"
/tools/node_modules/.bin/prisma migrate deploy --schema /calcom/packages/prisma/schema.prisma
node scripts/seed-app-store.cjs

cd apps/web
HOSTNAME=0.0.0.0 PORT="${PORT:-3000}" exec node server.js
