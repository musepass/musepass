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
HOST="${MUSEPASS_HOST:-$(cat "$(dirname "$0")/../.secrets/host" 2>/dev/null || true)}"
if [ -z "$HOST" ]; then
  echo "error: no deploy host. Set MUSEPASS_HOST or put it in .secrets/host (gitignored)." >&2
  exit 1
fi
SSH_KEY="${MUSEPASS_SSH_KEY:-$(cat "$ROOT_DIR/.secrets/ssh_key" 2>/dev/null || true)}"
if [ -z "$SSH_KEY" ]; then
  echo "error: no SSH key path. Set MUSEPASS_SSH_KEY or put one in .secrets/ssh_key (gitignored)." >&2
  exit 1
fi
LIVE_DIR="${MUSEPASS_WEB_DIR:-/srv/musename-web-live}"
SERVICE="${MUSEPASS_WEB_SERVICE:-musename-web}"
FULL=""
[ "${1:-}" = "--full" ] && FULL="yes"

SSH=(ssh -o ConnectTimeout=15 -i "$SSH_KEY" "$HOST")
SCP=(scp -o ConnectTimeout=15 -i "$SSH_KEY")

echo "== build"
cd "$ROOT_DIR"
# Prerendered pages are rendered once, here, and the build machine has no API on
# localhost — so anything the page reads from the API (the live counts, the price
# ladder) silently falls back to the offline defaults and ships that way. Point
# the build at the running deployment instead; if it is unreachable the same
# fallbacks apply, and the page degrades rather than fails.
MUSENAME_API_URL="${MUSEPASS_API_URL:-https://musepass.xyz}" pnpm --filter @musename/web build

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
# The report exits non-zero for the checks that are open on purpose (the root
# name's two signatures, for one). The deploy itself is what this script owns, so
# a failing report is printed rather than treated as a failed deploy.
set +e
node "$ROOT_DIR/scripts/health-report.mjs" | tail -20
health="${PIPESTATUS[0]:-0}"
set -e
if [ "$health" != "0" ]; then
  echo
  echo "health report exited $health — open items are listed above; the deploy itself succeeded."
fi

echo
echo "deployed. If the site looks wrong, the previous bundle is at"
echo "  $LIVE_DIR/apps/web/.next.prev-<timestamp>"
