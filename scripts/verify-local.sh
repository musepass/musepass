#!/usr/bin/env bash
#
# One command that proves the phase 1 claim path works end to end:
#   normalize -> sign -> on chain digest agreement -> mint -> ownership check.
#
# Requires: foundry (anvil, forge, cast), node, python3, and a built @musename/core.
#
#   ./scripts/verify-local.sh [label]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MUSENAME_LOCAL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
DEV_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEV_KEY_1_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
LABEL="${1:-aguang}"
ANVIL_PID=""

cleanup() {
  if [[ -n "$ANVIL_PID" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> building @musename/core"
(cd "$ROOT_DIR" && pnpm --filter @musename/core build >/dev/null)

echo "==> starting anvil on port ${PORT}"
anvil --port "$PORT" --silent >"$ROOT_DIR/.anvil.log" 2>&1 &
ANVIL_PID=$!

for _ in $(seq 1 40); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
cast chain-id --rpc-url "$RPC" >/dev/null

echo "==> deploying the local stack"
(
  cd "$ROOT_DIR/contracts"
  MUSENAME_REGISTRAR_OWNER="$DEV_ADDRESS" \
    forge script script/DeployLocalStack.s.sol --rpc-url "$RPC" --broadcast >/dev/null
)

BROADCAST="$ROOT_DIR/contracts/broadcast/DeployLocalStack.s.sol/31337/run-latest.json"
read -r REGISTRY REGISTRAR < <(python3 - "$BROADCAST" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
addresses = {}
for tx in data["transactions"]:
    name = tx.get("contractName")
    if name:
        addresses.setdefault(name, tx["contractAddress"])
print(addresses["LocalL2Registry"], addresses["MuseNameRegistrar"])
PY
)

echo "==> registry    ${REGISTRY}"
echo "==> registrar   ${REGISTRAR}"
echo "==> beneficiary ${DEV_KEY_1_ADDRESS}"

echo "==> running the claim"
node "$ROOT_DIR/scripts/local-claim-e2e.mjs" \
  --rpc "$RPC" \
  --registry "$REGISTRY" \
  --registrar "$REGISTRAR" \
  --label "$LABEL"

echo "==> phase 1 claim path verified"
