# remaxhub: only the dependency manifests, so the yarn install layer below is reused until a package.json
# or yarn.lock actually changes (upstream copied all sources first, reinstalling on every commit).
FROM --platform=$BUILDPLATFORM node:22 AS manifests
WORKDIR /src
COPY apps/web ./apps/web
COPY apps/api/v2 ./apps/api/v2
COPY packages ./packages
RUN mkdir -p /out && find apps packages -name package.json -not -path "*/node_modules/*" \
    | while read -r f; do mkdir -p "/out/$(dirname "$f")" && cp "$f" "/out/$f"; done

FROM --platform=$BUILDPLATFORM node:22 AS builder

WORKDIR /calcom

## If we want to read any ENV variable from .env file, we need to first accept and pass it as an argument to the Dockerfile
ARG NEXT_PUBLIC_LICENSE_CONSENT
ARG NEXT_PUBLIC_WEBSITE_TERMS_URL
ARG NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL
# remaxhub: NEXT_PUBLIC_* are inlined at build time (client and server bundles), so they must be build args
ARG NEXT_PUBLIC_DISABLE_SIGNUP
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS
ARG NEXT_PUBLIC_WEBSITE_URL
ARG CALCOM_TELEMETRY_DISABLED
ARG DATABASE_URL
ARG NEXTAUTH_SECRET=secret
ARG CALENDSO_ENCRYPTION_KEY=secret
ARG MAX_OLD_SPACE_SIZE=6144
ARG NEXT_PUBLIC_API_V2_URL
ARG CSP_POLICY

## We need these variables as required by Next.js build to create rewrites
ARG NEXT_PUBLIC_SINGLE_ORG_SLUG
ARG ORGANIZATIONS_ENABLED

ENV NEXT_PUBLIC_WEBAPP_URL=http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER \
  NEXT_PUBLIC_API_V2_URL=$NEXT_PUBLIC_API_V2_URL \
  NEXT_PUBLIC_LICENSE_CONSENT=$NEXT_PUBLIC_LICENSE_CONSENT \
  NEXT_PUBLIC_WEBSITE_TERMS_URL=$NEXT_PUBLIC_WEBSITE_TERMS_URL \
  NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL=$NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL \
  NEXT_PUBLIC_DISABLE_SIGNUP=$NEXT_PUBLIC_DISABLE_SIGNUP \
  NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
  NEXT_PUBLIC_COMPANY_NAME=$NEXT_PUBLIC_COMPANY_NAME \
  NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS=$NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS \
  NEXT_PUBLIC_WEBSITE_URL=$NEXT_PUBLIC_WEBSITE_URL \
  CALCOM_TELEMETRY_DISABLED=$CALCOM_TELEMETRY_DISABLED \
  DATABASE_URL=$DATABASE_URL \
  DATABASE_DIRECT_URL=$DATABASE_URL \
  NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
  CALENDSO_ENCRYPTION_KEY=${CALENDSO_ENCRYPTION_KEY} \
  NEXT_PUBLIC_SINGLE_ORG_SLUG=$NEXT_PUBLIC_SINGLE_ORG_SLUG \
  ORGANIZATIONS_ENABLED=$ORGANIZATIONS_ENABLED \
  NODE_OPTIONS=--max-old-space-size=${MAX_OLD_SPACE_SIZE} \
  BUILD_STANDALONE=true \
  CSP_POLICY=$CSP_POLICY

COPY package.json yarn.lock .yarnrc.yml playwright.config.ts turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY --from=manifests /out/ ./

# The root postinstall builds workspace packages from source, which isn't copied yet: run it after.
RUN yarn config set httpTimeout 1200000
RUN --mount=type=cache,id=caldiy-yarn,target=/calcom/.yarn/cache \
    node -e "const f='package.json',p=require('./'+f);delete p.scripts.postinstall;require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
    && HUSKY=0 yarn install

COPY package.json ./
COPY apps/web ./apps/web
COPY apps/api/v2 ./apps/api/v2
COPY packages ./packages
RUN HUSKY=0 yarn turbo run post-install
# Build and make embed servable from web/public/embed folder
RUN yarn workspace @calcom/trpc run build
RUN yarn --cwd packages/embeds/embed-core workspace @calcom/embed-core run build
RUN yarn --cwd apps/web workspace @calcom/web run copy-app-store-static
# The Next.js build cache survives between builds (cache mount), so small changes rebuild faster.
RUN --mount=type=cache,id=caldiy-next,target=/calcom/apps/web/.next/cache \
    yarn --cwd apps/web workspace @calcom/web run build
RUN rm -rf node_modules/.cache .yarn/cache

FROM node:22 AS builder-two

WORKDIR /calcom
ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000

ENV NODE_ENV=production

COPY package.json .yarnrc.yml turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY --from=builder /calcom/yarn.lock ./yarn.lock
COPY --from=builder /calcom/node_modules ./node_modules
COPY --from=builder /calcom/packages ./packages
COPY --from=builder /calcom/apps/web ./apps/web
COPY --from=builder /calcom/packages/prisma/schema.prisma ./prisma/schema.prisma
COPY scripts scripts
RUN chmod +x scripts/*

# Save value used during this build stage. If NEXT_PUBLIC_WEBAPP_URL and BUILT_NEXT_PUBLIC_WEBAPP_URL differ at
# run-time, then start.sh will find/replace static values again.
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

RUN scripts/replace-placeholder.sh http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER ${NEXT_PUBLIC_WEBAPP_URL}

# remaxhub: tools the slim runtime needs at start-up besides the Next.js server: the Prisma CLI for
# migrations, and the app-store seed bundled into one JS file (upstream ran it with ts-node on sources).
FROM builder-two AS tools
RUN node_modules/.bin/esbuild scripts/seed-app-store.ts --bundle --platform=node --target=node22 --format=cjs \
      --outfile=/out/seed-app-store.cjs --external:@prisma/client --external:pg-native --log-level=warning
RUN mkdir -p /tools && cd /tools && echo '{"private":true}' > package.json \
    && npm install --omit=dev --no-audit --no-fund --loglevel=error \
       "prisma@$(node -p "require('/calcom/node_modules/prisma/package.json').version")"

# remaxhub: slim runtime. Next.js standalone output (server + only the dependencies it traced) instead of
# the whole workspace with every dev dependency (~7 GB -> well under 1 GB).
FROM node:22-slim AS runner

WORKDIR /calcom

RUN apt-get update && apt-get install -y --no-install-recommends netcat-openbsd wget ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder-two /calcom/apps/web/.next/standalone ./
COPY --from=builder-two /calcom/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder-two /calcom/apps/web/public ./apps/web/public
COPY --from=builder-two /calcom/packages/prisma/schema.prisma ./packages/prisma/schema.prisma
COPY --from=builder-two /calcom/packages/prisma/migrations ./packages/prisma/migrations
COPY --from=tools /tools /tools
COPY --from=tools /out/seed-app-store.cjs ./scripts/seed-app-store.cjs
COPY scripts/wait-for-it.sh scripts/replace-placeholder.sh scripts/start-standalone.sh ./scripts/
RUN chmod +x scripts/*.sh

ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=30s --retries=5 \
  CMD wget --spider http://localhost:3000 || exit 1

CMD ["/calcom/scripts/start-standalone.sh"]
