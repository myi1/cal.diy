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

EXPOSE 80

CMD [ "yarn", "workspace", "@calcom/api-v2", "start:prod"]
