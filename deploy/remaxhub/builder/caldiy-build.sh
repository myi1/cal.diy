#!/bin/bash
# Build the REMAX Hub Cal.diy images on the Windows box (WSL distro "caldiy-builder") and push them to GHCR.
# Same tags and build args as .github/workflows/remaxhub-images.yml, but on 28 local cores with a warm
# Docker layer cache, so a rebuild after a small change takes minutes rather than ~20.
#
# Usage (as root in the distro):  caldiy-build.sh [commit-ish]   default: origin/remaxhub
#                                 caldiy-build.sh <commit> web    only the web image (or: api)
# From the Mac Studio:            ssh win "wsl -d caldiy-builder -u root -- /root/caldiy-build.sh <sha>"
#                                 NO_PUSH=1 caldiy-build.sh origin/<branch>   build and keep locally only
#                                 FORCE=1 caldiy-build.sh                     rebuild both even if unchanged
# Only a build of origin/remaxhub moves the :remaxhub tag.
# Needs: gh logged in as root with write:packages (gh auth login -h github.com -s write:packages).
set -euo pipefail

REPO=/root/cal.diy
REF="${1:-origin/remaxhub}"
ONLY="${2:-}"
OWNER=myi1
LOG=/root/caldiy-build.log

[ -d "$REPO/.git" ] || git clone -q https://github.com/$OWNER/cal.diy.git "$REPO"
cd "$REPO"
git fetch -q origin
git checkout -q --detach "$REF"
SHA=$(git rev-parse HEAD)
TAG="sha-${SHA:0:10}"
echo "$(date -u +%FT%TZ) building $TAG ($(git log -1 --format=%s))" | tee -a "$LOG"

[ "${NO_PUSH:-}" = 1 ] || gh auth token | docker login ghcr.io -u "$OWNER" --password-stdin >/dev/null
MOVE_TAG=""; [ "$(git rev-parse origin/remaxhub)" = "$SHA" ] && MOVE_TAG=1

# Hub-owned schedule ids baked into the web image. Unset HUB_MANAGED_SCHEDULE_IDS keeps the last pushed list
# (a routine build must not silently manage nothing); set it to the empty string to turn the feature off.
# A changed list rebuilds web even when no file changed.
MANAGED_FILE=${MANAGED_FILE:-/root/caldiy-last-managed-ids}
LAST_MANAGED=$(cat "$MANAGED_FILE" 2>/dev/null || true)
MANAGED_IDS="${HUB_MANAGED_SCHEDULE_IDS-$LAST_MANAGED}"
echo "$(date -u +%FT%TZ) managed schedule ids for this build: '${MANAGED_IDS}' (last pushed: '${LAST_MANAGED}')" | tee -a "$LOG"
WEB_ARGS=(
  --build-arg NEXT_PUBLIC_WEBAPP_URL=https://book.remaxhub.ae
  --build-arg NEXT_PUBLIC_API_V2_URL=https://book-api.remaxhub.ae/api/v2
  --build-arg NEXT_PUBLIC_LICENSE_CONSENT=agree
  --build-arg NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL=https://remaxhub.ae/privacy-policy
  --build-arg CALCOM_TELEMETRY_DISABLED=1
  --build-arg NEXT_PUBLIC_DISABLE_SIGNUP=true
  --build-arg "NEXT_PUBLIC_APP_NAME=REMAX Hub"
  --build-arg "NEXT_PUBLIC_COMPANY_NAME=REMAX Hub"
  --build-arg NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS=hub@remax.ae
  --build-arg NEXT_PUBLIC_WEBSITE_URL=https://remaxhub.ae
  # Hub-owned schedule ids (comma-separated), empty = none. Set in the environment of the build:
  #   HUB_MANAGED_SCHEDULE_IDS=3,14 caldiy-build.sh <commit> web
  --build-arg "NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS=$MANAGED_IDS"
)
LABELS=(--label "org.opencontainers.image.source=https://github.com/$OWNER/cal.diy" --label "org.opencontainers.image.revision=$SHA")

build() { # name dockerfile [args...]
  local name=$1 file=$2; shift 2
  local img="ghcr.io/$OWNER/$name"
  local start=$SECONDS
  local tags=(-t "$img:$TAG"); [ -n "$MOVE_TAG" ] && tags+=(-t "$img:remaxhub")
  DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -f "$file" "${LABELS[@]}" "$@" \
    "${tags[@]}" . > "/root/build-$name.log" 2>&1
  local built=$((SECONDS - start))
  if [ "${NO_PUSH:-}" = 1 ]; then
    echo "$(date -u +%FT%TZ) $name:$TAG built in ${built}s (not pushed), $(docker image inspect -f '{{.Size}}' "$img:$TAG" | numfmt --to=iec)" | tee -a "$LOG"
    return
  fi
  docker push -q "$img:$TAG" >/dev/null
  [ -z "$MOVE_TAG" ] || docker push -q "$img:remaxhub" >/dev/null
  echo "$(date -u +%FT%TZ) $name:$TAG built in ${built}s, pushed in $((SECONDS - start - built))s" | tee -a "$LOG"
}

# Only rebuild an image whose inputs changed since the last pushed build; otherwise give the last pushed
# image the new tag, so web and api always share one tag for the deploy.
LAST_FILE=/root/caldiy-last-pushed-sha
LAST=$(cat "$LAST_FILE" 2>/dev/null || true)
SHARED=(yarn.lock package.json .yarnrc.yml .yarn turbo.json i18n.json packages)
changed() { # image -> exit 0 if it must be rebuilt
  [ -n "${FORCE:-}" ] || [ -z "$LAST" ] || [ "${NO_PUSH:-}" = 1 ] && return 0
  git cat-file -e "$LAST^{commit}" 2>/dev/null || return 0
  if [ "$1" = web ] && [ "$MANAGED_IDS" != "$LAST_MANAGED" ]; then return 0; fi
  if [ "$1" = web ]; then set -- "${SHARED[@]}" Dockerfile apps/web scripts
  else set -- "${SHARED[@]}" apps/api/v2; fi
  ! git diff --quiet "$LAST" "$SHA" -- "$@"
}
retag() { # name
  docker buildx imagetools create -t "ghcr.io/$OWNER/$1:$TAG" "ghcr.io/$OWNER/$1:sha-${LAST:0:10}" >/dev/null
  [ -z "$MOVE_TAG" ] || docker buildx imagetools create -t "ghcr.io/$OWNER/$1:remaxhub" "ghcr.io/$OWNER/$1:$TAG" >/dev/null
  echo "$(date -u +%FT%TZ) $1:$TAG unchanged since sha-${LAST:0:10}, re-tagged" | tee -a "$LOG"
}

pids=()
if [ "$ONLY" != api ]; then
  if changed web; then build caldiy-web ./Dockerfile "${WEB_ARGS[@]}" & pids+=($!); else retag caldiy-web; fi
fi
if [ "$ONLY" != web ]; then
  if changed api; then build caldiy-api ./apps/api/v2/Dockerfile & pids+=($!); else retag caldiy-api; fi
fi
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" = 1 ]; then
  echo "$(date -u +%FT%TZ) FAILED $TAG: see /root/build-caldiy-web.log and /root/build-caldiy-api.log" | tee -a "$LOG"
  exit 1
fi
# Keep the cache from growing without bound (~100 GB is plenty for both images).
docker builder prune -f --keep-storage 100GB >/dev/null 2>&1 || true
[ "${NO_PUSH:-}" = 1 ] || [ -n "$ONLY" ] || echo "$SHA" > "$LAST_FILE"
[ "${NO_PUSH:-}" = 1 ] || [ "$ONLY" = api ] || echo "$MANAGED_IDS" > "$MANAGED_FILE"
echo "$(date -u +%FT%TZ) done $TAG" | tee -a "$LOG"
