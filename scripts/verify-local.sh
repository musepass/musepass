#!/usr/bin/env bash
#
# One command that proves the phase 1-3 wiring on a throwaway local chain:
#
#   chain   : real registrar deployed, real signature, real mint
#   api     : availability, request creation, claim
#   mcp     : an AI client connects over streamable HTTP and calls the tools
#   web     : the real pages render against the same API
#
# Requires: foundry (anvil, forge, cast), node, python3, pnpm.
#
#   ./scripts/verify-local.sh [label]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANVIL_PORT="${MUSENAME_ANVIL_PORT:-8545}"
API_PORT="${MUSENAME_API_PORT:-3101}"
MCP_PORT="${MUSENAME_MCP_PORT:-3102}"
WEB_PORT="${MUSENAME_WEB_PORT:-3103}"
RPC="http://127.0.0.1:${ANVIL_PORT}"
DEV_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEV_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
LABEL="${1:-aguang}"
# The claim in step 1 mints LABEL, so the MCP smoke in step 3 asks for a
# different one — otherwise it would be testing the "already taken" path.
SMOKE_LABEL="${LABEL}x"

ANVIL_PID=""
API_PID=""
MCP_PID=""
WEB_PID=""

cleanup() {
  for pid in "$WEB_PID" "$MCP_PID" "$API_PID" "$ANVIL_PID"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

echo "==> building workspaces"
(cd "$ROOT_DIR" && pnpm build >/dev/null)

echo "==> starting anvil on port ${ANVIL_PORT}"
anvil --port "$ANVIL_PORT" --silent >"$ROOT_DIR/.anvil.log" 2>&1 &
ANVIL_PID=$!

for _ in $(seq 1 40); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
cast chain-id --rpc-url "$RPC" >/dev/null

echo "==> deploying the local stack"
(
  cd "$ROOT_DIR/contracts"
  MUSENAME_LOCAL_KEY="$DEV_KEY" \
    forge script script/DeployLocalStack.s.sol --rpc-url "$RPC" --broadcast 2>&1 \
    | grep -vE "WARN|^$" >/dev/null
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

echo "    registry  ${REGISTRY}"
echo "    registrar ${REGISTRAR}"

echo "==> [1/3] chain: sign off chain, mint on chain"
node "$ROOT_DIR/scripts/claim-e2e.mjs" \
  --rpc "$RPC" \
  --registry "$REGISTRY" \
  --registrar "$REGISTRAR" \
  --label "$LABEL" \
  | sed 's/^/    /'

echo "==> [2/3] api: availability and registration requests"
(
  cd "$ROOT_DIR/apps/api"
  MUSENAME_L2_CHAIN_ID=31337 \
  MUSENAME_RPC_URL="$RPC" \
  MUSENAME_L2_REGISTRY="$REGISTRY" \
  MUSENAME_REGISTRAR="$REGISTRAR" \
  MUSENAME_ISSUER_KEY="$DEV_KEY" \
  PORT="$API_PORT" \
    node dist/index.js >"$ROOT_DIR/.api.log" 2>&1 &
  echo $! >"$ROOT_DIR/.api.pid"
)
API_PID="$(cat "$ROOT_DIR/.api.pid")"

echo "==> [3/3] mcp: an AI client over streamable HTTP"
(
  cd "$ROOT_DIR/apps/mcp"
  MCP_PORT="$MCP_PORT" \
  MUSENAME_API_URL="http://127.0.0.1:${API_PORT}" \
    node dist/index.js >"$ROOT_DIR/.mcp.log" 2>&1 &
  echo $! >"$ROOT_DIR/.mcp.pid"
)
MCP_PID="$(cat "$ROOT_DIR/.mcp.pid")"

echo "==> [4/4] web: the real pages against the same API"
(
  cd "$ROOT_DIR/apps/web"
  MUSENAME_API_URL="http://127.0.0.1:${API_PORT}" \
    node node_modules/next/dist/bin/next start -p "$WEB_PORT" >"$ROOT_DIR/.web.log" 2>&1 &
  echo $! >"$ROOT_DIR/.web.pid"
)
WEB_PID="$(cat "$ROOT_DIR/.web.pid")"

for _ in $(seq 1 60); do
  api_ok=0
  mcp_ok=0
  web_ok=0
  curl -sf "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1 && api_ok=1
  curl -sf "http://127.0.0.1:${MCP_PORT}/healthz" >/dev/null 2>&1 && mcp_ok=1
  curl -sf "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 && web_ok=1
  if [[ "$api_ok" == "1" && "$mcp_ok" == "1" && "$web_ok" == "1" ]]; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then echo "api died:"; tail -20 "$ROOT_DIR/.api.log"; exit 1; fi
  if ! kill -0 "$MCP_PID" 2>/dev/null; then echo "mcp died:"; tail -20 "$ROOT_DIR/.mcp.log"; exit 1; fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then echo "web died:"; tail -20 "$ROOT_DIR/.web.log"; exit 1; fi
  sleep 0.25
done

curl -sf "http://127.0.0.1:${API_PORT}/healthz" >/dev/null || { echo "api never became healthy"; tail -20 "$ROOT_DIR/.api.log"; exit 1; }
curl -sf "http://127.0.0.1:${MCP_PORT}/healthz" >/dev/null || { echo "mcp never became healthy"; tail -20 "$ROOT_DIR/.mcp.log"; exit 1; }
curl -sf "http://127.0.0.1:${WEB_PORT}/" >/dev/null || { echo "web never became healthy"; tail -20 "$ROOT_DIR/.web.log"; exit 1; }

echo "    web pages:"
python3 - "$WEB_PORT" "$SMOKE_LABEL" <<'PY'
import sys
import urllib.request

port, label = sys.argv[1], sys.argv[2]


def get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=20) as response:
        return response.status, response.read().decode("utf-8")


checks = []

status, html = get("/")
checks.append(("homepage renders", status == 200 and "给你的 AI" in html))
checks.append(("hero search box present", 'id="name-search"' in html))
checks.append(("brand renders from config", "MuseName" in html))
checks.append(("Meta disclaimer present", "与 Meta" in html))

status, html = get("/claim?label=" + label)
checks.append(("claim page renders", status == 200 and "领取一个名字" in html))

status, html = get("/name/" + label)
checks.append(("name page handles an unregistered name", status == 200 and "还没有被注册" in html))

status, html = get("/developers")
checks.append(("developer page lists the MCP tools", status == 200 and "check_name" in html))

failed = False
for name, ok in checks:
    print(f"      {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        failed = True
sys.exit(1 if failed else 0)
PY

echo "    api /v1/config:"
curl -sf "http://127.0.0.1:${API_PORT}/v1/config" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)['data']
print('      product   ', data['productName'])
print('      rootName  ', data['rootName'])
print('      registrar ', data['registrar'])
print('      features  ', data['features'])
"

MUSENAME_SMOKE_NAME="$SMOKE_LABEL" \
  node "$ROOT_DIR/apps/mcp/scripts/smoke.mjs" "http://127.0.0.1:${MCP_PORT}/mcp" \
  | sed 's/^/    /'

echo "==> phase 1-3 local wiring verified"
