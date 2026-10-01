#!/usr/bin/env bash
#
# Move the product onto its own domain: musepass.xyz.
#
#   ./scripts/cutover-domain.sh                     # check the DNS and print the plan
#   ./scripts/cutover-domain.sh --apply             # do all of it
#   ./scripts/cutover-domain.sh --apply --from config   # resume after a step failed
#
# The order cannot change. `config/brand.json` is what every confirmation link is
# built from, so flipping it before the domain answers would hand people links
# that go nowhere: DNS, then the vhost, then the certificate, then the config,
# then the site bundle, which has the domain compiled into it.
#
# What must NOT move: `gw.musename.xyz`. That hostname is baked into the
# constructor arguments of the resolver deployed on Ethereum mainnet, so every
# existing name would stop resolving if it went away.
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
NEW_DOMAIN="${MUSEPASS_DOMAIN:-musepass.xyz}"
OLD_DOMAIN="${MUSEPASS_OLD_DOMAIN:-musename.xyz}"
EXPECTED_IP="${MUSEPASS_EXPECTED_IP:-}"
if [ -z "$EXPECTED_IP" ] && [ -f "$ROOT_DIR/.secrets/host" ]; then
  # .secrets/host holds "user@1.2.3.4"; the DNS check wants the address.
  EXPECTED_IP="$(sed 's/.*@//' "$ROOT_DIR/.secrets/host")"
fi
if [ -z "$EXPECTED_IP" ]; then
  echo "error: no expected server address. Set MUSEPASS_EXPECTED_IP or put it in .secrets/host (gitignored)." >&2
  exit 1
fi

APPLY=""
FROM=""
FORCE_VHOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY="yes" ;;
    --from) shift; FROM="${1:-}" ;;
    --force-vhost) FORCE_VHOST="yes" ;;
  esac
  shift
done

STEPS=(dns vhost cert config web check)
SKIP_BEFORE=0
if [ -n "$FROM" ]; then
  found=""
  for i in "${!STEPS[@]}"; do
    if [ "${STEPS[$i]}" = "$FROM" ]; then SKIP_BEFORE="$i"; found="yes"; fi
  done
  if [ -z "$found" ]; then
    echo "--from wants one of: ${STEPS[*]}" >&2
    exit 2
  fi
fi

should_run() {
  local index=""
  for i in "${!STEPS[@]}"; do
    if [ "${STEPS[$i]}" = "$1" ]; then index="$i"; fi
  done
  [ "$index" -ge "$SKIP_BEFORE" ]
}

SSH=(ssh -o ConnectTimeout=15 -i "$SSH_KEY" "$HOST")
SCP=(scp -o ConnectTimeout=15 -i "$SSH_KEY")

# Port 53 is unusable on some networks (a local resolver answers everything),
# so resolve over HTTPS, which is what a wallet's client does anyway.
dns_a() {
  curl -fsS "https://dns.google/resolve?name=$1&type=A" | python3 -c '
import json, sys
body = json.load(sys.stdin)
print(" ".join(a["data"] for a in body.get("Answer", []) if a.get("type") == 1))
'
}

if should_run dns; then
  echo "== 1. DNS"
  for name in "$NEW_DOMAIN" "www.$NEW_DOMAIN"; do
    addresses="$(dns_a "$name" || true)"
    echo "   $name: ${addresses:-not delegated yet}"
  done

  missing=""
  for name in "$NEW_DOMAIN" "www.$NEW_DOMAIN"; do
    case " $(dns_a "$name" || true) " in
      *" $EXPECTED_IP "*) ;;
      *) missing="$missing $name" ;;
    esac
  done

  if [ -n "$missing" ]; then
    cat <<EOF

DNS is not ready:$missing

Add these two records in the registrar's DNS panel for $NEW_DOMAIN, then run
this again. HTTP-01 certificates need the domain to point here first:

  Type A   Host @     Answer $EXPECTED_IP
  Type A   Host www   Answer $EXPECTED_IP

EOF
    exit 1
  fi
  echo "   both names point at $EXPECTED_IP"
fi

if [ -z "$APPLY" ]; then
  cat <<EOF

DNS is ready. The next run does four things, in this order:

  2. install deploy/nginx/$NEW_DOMAIN.conf if it is not there, nginx -t, reload
  3. certbot --nginx -d $NEW_DOMAIN -d www.$NEW_DOMAIN --redirect
  4. point config/brand.json (and the two web constants) at https://$NEW_DOMAIN,
     push the config to the api, mcp and signer units, restart them
  5. rebuild and ship the site bundle, then run the health report

Re-run with --apply when that is what you want. A run that failed halfway can be
resumed with --from <step>: ${STEPS[*]}
EOF
  exit 0
fi

if should_run vhost; then
  echo "== 2. vhost"
  # Certbot rewrites this file to add the TLS block, so copying the template over
  # a file that already exists would silently turn HTTPS off.
  if "${SSH[@]}" "test -f /etc/nginx/conf.d/$NEW_DOMAIN.conf" && [ -z "$FORCE_VHOST" ]; then
    echo "   already installed — leaving it alone (--force-vhost to overwrite)"
  else
    "${SCP[@]}" "$ROOT_DIR/deploy/nginx/$NEW_DOMAIN.conf" "$HOST:/etc/nginx/conf.d/"
    "${SSH[@]}" 'nginx -t && systemctl reload nginx'
  fi
fi

if should_run cert; then
  echo "== 3. certificate"
  "${SSH[@]}" "certbot --nginx -d $NEW_DOMAIN -d www.$NEW_DOMAIN --redirect --non-interactive"
fi

echo "== verify the new domain answers"
curl -fsS -o /dev/null -w "   https://$NEW_DOMAIN/ → HTTP %{http_code}\n" "https://$NEW_DOMAIN/"
curl -fsS -o /dev/null -w "   https://$NEW_DOMAIN/v1/config → HTTP %{http_code}\n" "https://$NEW_DOMAIN/v1/config"

if should_run config; then
  echo "== 4. config"
  cd "$ROOT_DIR"
  for file in config/brand.json apps/web/lib/agentPrompt.ts apps/web/lib/api.ts; do
    # LC_ALL=C: this perl refuses to start under a C.UTF-8 locale that macOS does
    # not ship, and it dies mid-loop without touching the files.
    LC_ALL=C perl -pi -e "s{\Qhttps://$OLD_DOMAIN\E}{https://$NEW_DOMAIN}g" "$file"
  done
  grep -n '"siteUrl"' config/brand.json | head -2
  for unit in musename-api musename-mcp musename-signer; do
    "${SCP[@]}" config/brand.json config/chains.json "$HOST:/srv/$unit/config/"
  done
  "${SSH[@]}" 'systemctl restart musename-api musename-mcp musename-signer && sleep 2 && systemctl is-active musename-api musename-mcp musename-signer'
fi

if should_run web; then
  echo "== 5. site bundle"
  "$ROOT_DIR/scripts/deploy-web.sh"
fi

if should_run check; then
  echo "== 6. the project's own gates"
  cd "$ROOT_DIR"
  pnpm check
fi

cat <<EOF

Done. Remaining, on purpose:

  - the old domain still answers, and must: names registered under the earlier
    root and every link already handed out point at it
  - update the docs that quote the old domain, and commit
  - the certificate renews through the timer certbot installed

EOF
