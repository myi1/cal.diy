#!/bin/bash
# Build the REMAX Hub Cal.diy images on the Windows box (WSL distro "caldiy-builder") and push them to GHCR.
# Same tags and build args as .github/workflows/remaxhub-images.yml, but on 28 local cores with a warm
# Docker layer cache, so a rebuild after a small change takes minutes rather than ~20.
#
# Usage (as root in the distro):  caldiy-build.sh [commit-ish]   default: origin/remaxhub
#                                 caldiy-build.sh <commit> web    only the web image (or: api)
# From the Mac Studio:            ssh win "wsl -d caldiy-builder -u root -- /root/caldiy-build.sh <sha>"
#                                 NO_PUSH=1 caldiy-build.sh origin/<branch>   build and keep locally only
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

pids=()
[ "$ONLY" = api ] || { build caldiy-web ./Dockerfile "${WEB_ARGS[@]}" & pids+=($!); }
[ "$ONLY" = web ] || { build caldiy-api ./apps/api/v2/Dockerfile & pids+=($!); }
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" = 1 ]; then
  echo "$(date -u +%FT%TZ) FAILED $TAG: see /root/build-caldiy-web.log and /root/build-caldiy-api.log" | tee -a "$LOG"
  exit 1
fi
# Keep the cache from growing without bound (~100 GB is plenty for both images).
docker builder prune -f --keep-storage 100GB >/dev/null 2>&1 || true
echo "$(date -u +%FT%TZ) done $TAG" | tee -a "$LOG"
