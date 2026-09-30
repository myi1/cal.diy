# remaxhub: only the dependency manifests first, so the yarn install layer is reused until a package.json
# or yarn.lock changes (upstream copied the whole repo first, reinstalling on every commit).
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /out && find . -name package.json -not -path "*/node_modules/*" \
    | while read -r f; do mkdir -p "/out/$(dirname "$f")" && cp "$f" "/out/$f"; done

FROM node:22-alpine AS build

ARG DATABASE_DIRECT_URL
ARG DATABASE_URL

WORKDIR /calcom

RUN set -eux;
RUN if [ -e /usr/lib/libssl.so.3 ] && [ ! -e /lib/libssl.so.3 ]; then ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3; fi

ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV DATABASE_DIRECT_URL=${DATABASE_DIRECT_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV USE_POOL="true"

COPY --from=manifests /out/ ./
COPY yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
# The root postinstall builds workspace packages from source, which isn't copied yet: run it after.
RUN --mount=type=cache,id=caldiy-yarn-alpine,target=/calcom/.yarn/cache \
    node -e "const f='package.json',p=require('./'+f);delete p.scripts.postinstall;require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
    && HUSKY=0 yarn install

COPY . .
RUN HUSKY=0 yarn turbo run post-install
RUN yarn workspace @calcom/api-v2 run generate-schemas
RUN yarn workspace @calcom/api-v2 run build:docker
RUN yarn workspace @calcom/api-v2 run build

# remaxhub: copy only what the compiled API actually loads, traced from its entry point with the file
# tracer Next.js ships (the same technique as Next's standalone output). "Production dependencies" misses
# modules that platform-libraries leaves external but only lists as dev dependencies.
FROM build AS traced
RUN node -e ' \
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft"); \
  const fs = require("fs"), path = require("path"); \
  (async () => { \
    const entry = "/calcom/apps/api/v2/dist/apps/api/v2/src/main.js"; \
    const { fileList, warnings } = await nodeFileTrace([entry], { base: "/calcom", processCwd: "/calcom/apps/api/v2" }); \
    for (const f of fileList) { \
      const src = path.join("/calcom", f), dst = path.join("/out", f); \
      fs.mkdirSync(path.dirname(dst), { recursive: true }); \
      const st = fs.lstatSync(src); \
      if (st.isSymbolicLink()) { if (!fs.existsSync(dst)) fs.symlinkSync(fs.readlinkSync(src), dst); } \
      else if (st.isFile()) fs.copyFileSync(src, dst); \
    } \
    console.log("traced files:", fileList.size); \
  })().catch((e) => { console.error(e); process.exit(1); });'
# Loaded by dynamic path at run time, so the tracer can't see them.
RUN mkdir -p /out/packages/i18n && cp -r /calcom/packages/i18n/locales /out/packages/i18n/locales

# remaxhub: slim runtime: only the traced files.
FROM node:22-alpine AS runtime
RUN if [ -e /usr/lib/libssl.so.3 ] && [ ! -e /lib/libssl.so.3 ]; then ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3; fi
WORKDIR /calcom
ENV NODE_ENV="production" \
    USE_POOL="true"
COPY --from=traced /out/ ./
WORKDIR /calcom/apps/api/v2

EXPOSE 80

CMD [ "node", "./dist/apps/api/v2/src/main.js" ]
