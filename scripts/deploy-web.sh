#!/usr/bin/env bash
#
# Build the site and ship it to the box that serves it.
#
#   ./scripts/deploy-web.sh
#
# The site is a Next.js standalone bundle, so the deploy is a tarball rather
# than a checkout on the server: build locally, copy `.next/standalone` plus the
# static chunks it does not include, unpack over the live directory, restart.
#
# The previous `.next` is moved aside instead of deleted, so rolling back is a
# rename rather than a rebuild. Two generations are kept.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${MUSEPASS_HOST:-root@server address withheld}"
SSH_KEY="${MUSEPASS_SSH_KEY:-$HOME/.ssh/musename_deploy}"
LIVE_DIR="${MUSEPASS_WEB_DIR:-/srv/musename-web-live}"
SERVICE="${MUSEPASS_WEB_SERVICE:-musename-web}"

SSH=(ssh -o ConnectTimeout=15 -i "$SSH_KEY" "$HOST")
SCP=(scp -o ConnectTimeout=15 -i "$SSH_KEY")

echo "== build"
cd "$ROOT_DIR"
pnpm --filter @musename/web build

echo "== stage"
STAGE="$(mktemp -d)"
TARBALL="$STAGE/musepass-web.tgz"
# `standalone/` mirrors the repo layout at the live directory root.
cp -R apps/web/.next/standalone/. "$STAGE/bundle"
# Static chunks are served by the app itself and are not copied into standalone.
mkdir -p "$STAGE/bundle/apps/web/.next"
cp -R apps/web/.next/static "$STAGE/bundle/apps/web/.next/static"
tar -C "$STAGE/bundle" -czf "$TARBALL" .
echo "   $(du -h "$TARBALL" | cut -f1) tarball"

echo "== ship"
"${SCP[@]}" "$TARBALL" "$HOST:/tmp/musepass-web.tgz"

echo "== install and restart"
"${SSH[@]}" LIVE_DIR="$LIVE_DIR" SERVICE="$SERVICE" 'bash -s' <<'REMOTE'
set -euo pipefail
stamp="$(date +%Y%m%d-%H%M%S)"
cd "$LIVE_DIR"
if [ -d apps/web/.next ]; then
  mv apps/web/.next "apps/web/.next.prev-$stamp"
fi
tar -xzf /tmp/musepass-web.tgz -C "$LIVE_DIR"
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  systemctl is-active --quiet "$SERVICE" && break
  sleep 0.5
done
systemctl is-active "$SERVICE"

# Keep the current bundle and one previous one.
kept=0
for dir in $(ls -1dt "$LIVE_DIR"/apps/web/.next.prev-* 2>/dev/null); do
  case "$dir" in
    "$LIVE_DIR"/apps/web/.next.prev-*) ;;
    *) continue ;;
  esac
  kept=$((kept + 1))
  if [ "$kept" -gt 2 ]; then rm -rf "$dir"; fi
done
REMOTE

echo "== verify"
node "$ROOT_DIR/scripts/health-report.mjs" | tail -20

echo
echo "deployed. If the site looks wrong, the previous bundle is at"
echo "  $LIVE_DIR/apps/web/.next.prev-<timestamp>"
