#!/usr/bin/env bash
#
# Build the site and ship it to the box that serves it.
#
#   ./scripts/deploy-web.sh          # code and copy changes (a couple of MB shipped)
#   ./scripts/deploy-web.sh --full   # after changing dependencies
#
# The site is a Next.js standalone bundle, so the deploy is a tarball rather
# than a checkout on the server: build locally, unpack over the live directory,
# restart.
#
# The default ships `apps/web` plus the static chunks that standalone does not
# include. The traced `node_modules` beside it is 60 MB and almost never
# changes, while the link to this box has been measured in tens of kilobytes per
# second, so sending it on every deploy turns a two minute job into a twenty
# minute one. `--full` sends it, and only a real dependency change needs that.
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
FULL=""
[ "${1:-}" = "--full" ] && FULL="yes"

SSH=(ssh -o ConnectTimeout=15 -i "$SSH_KEY" "$HOST")
SCP=(scp -o ConnectTimeout=15 -i "$SSH_KEY")

echo "== build"
cd "$ROOT_DIR"
pnpm --filter @musename/web build

echo "== stage"
STAGE="$(mktemp -d)"
TARBALL="$STAGE/musepass-web.tgz"
BUNDLE="$STAGE/bundle"
mkdir -p "$BUNDLE/apps"

if [ -n "$FULL" ]; then
  # Whole standalone tree: mirrors the live directory layout, node_modules and all.
  cp -R apps/web/.next/standalone/. "$BUNDLE"
else
  cp -R apps/web/.next/standalone/apps/web "$BUNDLE/apps/web"
fi

# Static chunks are served by the app itself and are not copied into standalone.
mkdir -p "$BUNDLE/apps/web/.next"
cp -R apps/web/.next/static "$BUNDLE/apps/web/.next/static"

# COPYFILE_DISABLE: without it, macOS tar writes an AppleDouble `._file` beside
# every real file. The live directory still carries a set from an earlier deploy.
COPYFILE_DISABLE=1 tar -C "$BUNDLE" -czf "$TARBALL" .
echo "   $(du -h "$TARBALL" | cut -f1) tarball${FULL:+ (full, including node_modules)}"

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
