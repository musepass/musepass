#!/usr/bin/env bash
#
# Copy config/ to every unit that reads it, and restart what needs it.
#
#   ./scripts/push-config.sh
#   ./scripts/push-config.sh --no-restart
#
# Why this exists as a script: the units read their own copy of config from
# /srv/<unit>/config, not from this repository. Editing config here changes
# nothing on the server until it is pushed, and the failure is silent — the API
# keeps serving the old prices and the site keeps rendering them. That has
# already cost two debugging sessions, one of them blamed on the wrong file.
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
UNITS=(musename-api musename-mcp musename-signer musename-health)
RESTART=(musename-api musename-mcp musename-signer)

RESTART_AFTER="yes"
[ "${1:-}" = "--no-restart" ] && RESTART_AFTER=""

cd "$ROOT_DIR"

echo "== push config"
for unit in "${UNITS[@]}"; do
  scp -o ConnectTimeout=15 -i "$SSH_KEY" config/*.json "$HOST:/srv/$unit/config/" 2>&1 | grep -v '^$' || true
  echo "   $unit"
done

# receipts-genesis.json and the anchor file are deployment records, not config;
# the health unit reads its own copies of brand, chains and anchors.
scp -o ConnectTimeout=15 -i "$SSH_KEY" deployments/receipt-anchors.json \
  "$HOST:/srv/musename-health/anchors.json" >/dev/null 2>&1 || {
  echo "   warning: could not push the anchor ledger (health will fall back to the committed one)" >&2
}

if [ -n "$RESTART_AFTER" ]; then
  echo "== restart"
  ssh -o ConnectTimeout=15 -i "$SSH_KEY" "$HOST" \
    "systemctl restart ${RESTART[*]} && sleep 2 && systemctl is-active ${RESTART[*]}"
fi

echo "== verify what the API now answers"
curl -s https://musepass.xyz/v1/config | python3 -c '
import json, sys

data = json.load(sys.stdin)["data"]
pricing = data["pricing"]
rows = ["%s-%s: $%s" % (t["minUnits"], t["maxUnits"], t["priceUsd"]) for t in pricing["premiumTiers"]]
print("   root      " + data["rootName"])
print("   site      " + data["siteUrl"])
print("   free from %s units" % pricing["freeMinUnits"])
print("   tiers     " + (", ".join(rows) if rows else "none"))
'
