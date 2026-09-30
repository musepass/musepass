#!/usr/bin/env bash
#
# Move the product onto its own domain: musepass.xyz.
#
#   ./scripts/cutover-domain.sh          # check the DNS and print the plan
#   ./scripts/cutover-domain.sh --apply  # do it
#
# The order cannot change. `config/brand.json` is what every confirmation link
# is built from, so flipping it before the domain answers would hand people
# links that go nowhere: DNS, then the vhost, then the certificate, then the
# config, then the site bundle, which has the domain compiled into it.
#
# What must NOT move: `gw.musename.xyz`. That hostname is baked into the
# constructor arguments of the resolver deployed on Ethereum mainnet, so every
# existing name would stop resolving if it went away.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${MUSEPASS_HOST:-root@server address withheld}"
SSH_KEY="${MUSEPASS_SSH_KEY:-$HOME/.ssh/musename_deploy}"
NEW_DOMAIN="${MUSEPASS_DOMAIN:-musepass.xyz}"
OLD_DOMAIN="${MUSEPASS_OLD_DOMAIN:-musename.xyz}"
EXPECTED_IP="${MUSEPASS_EXPECTED_IP:-server address withheld}"
APPLY=""
[ "${1:-}" = "--apply" ] && APPLY="yes"

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

echo "== 1. DNS"
for name in "$NEW_DOMAIN" "www.$NEW_DOMAIN"; do
  addresses="$(dns_a "$name" || true)"
  if [ -z "$addresses" ]; then
    echo "   $name: not delegated yet"
  else
    echo "   $name: $addresses"
  fi
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

Add these two records in Porkbun → $NEW_DOMAIN → DNS Records, then run this
again. HTTP-01 certificates need the domain to point here first:

  Type A   Host @     Answer $EXPECTED_IP
  Type A   Host www   Answer $EXPECTED_IP

EOF
  exit 1
fi

echo "   both names point at $EXPECTED_IP"

if [ -z "$APPLY" ]; then
  cat <<EOF

DNS is ready. The next run does four things, in this order:

  2. install deploy/nginx/musepass.xyz.conf, nginx -t, reload
  3. certbot --nginx -d $NEW_DOMAIN -d www.$NEW_DOMAIN --redirect
  4. point config/brand.json (and the two web constants) at https://$NEW_DOMAIN,
     push the config to the api, mcp and signer units, restart them
  5. rebuild and ship the site bundle, then run the health report

Re-run with --apply when that is what you want.
EOF
  exit 0
fi

echo "== 2. vhost"
"${SCP[@]}" "$ROOT_DIR/deploy/nginx/$NEW_DOMAIN.conf" "$HOST:/etc/nginx/conf.d/"
"${SSH[@]}" 'nginx -t && systemctl reload nginx'

echo "== 3. certificate"
"${SSH[@]}" "certbot --nginx -d $NEW_DOMAIN -d www.$NEW_DOMAIN --redirect --non-interactive"

echo "== verify the new domain answers before anything points at it"
tls_days="$("${SSH[@]}" "openssl s_client -servername $NEW_DOMAIN -connect $NEW_DOMAIN:443 </dev/null 2>/dev/null | openssl x509 -noout -enddate" || true)"
echo "   $NEW_DOMAIN certificate: ${tls_days:-could not read}"
curl -fsS -o /dev/null -w "   https://$NEW_DOMAIN/ → HTTP %{http_code}\n" "https://$NEW_DOMAIN/"
curl -fsS -o /dev/null -w "   https://$NEW_DOMAIN/v1/config → HTTP %{http_code}\n" "https://$NEW_DOMAIN/v1/config"

echo "== 4. config"
cd "$ROOT_DIR"
for file in config/brand.json apps/web/lib/agentPrompt.ts apps/web/lib/api.ts; do
  perl -pi -e "s{\Qhttps://$OLD_DOMAIN\E}{https://$NEW_DOMAIN}g" "$file"
done
grep -n "siteUrl" config/brand.json | head -2
for unit in musename-api musename-mcp musename-signer; do
  "${SCP[@]}" config/brand.json config/chains.json "$HOST:/srv/$unit/config/"
done
"${SSH[@]}" 'systemctl restart musename-api musename-mcp musename-signer && sleep 2 && systemctl is-active musename-api musename-mcp musename-signer'

echo "== 5. site bundle"
"$ROOT_DIR/scripts/deploy-web.sh"

echo "== 6. the project's own gates"
pnpm check

cat <<EOF

Done. Remaining, on purpose:

  - the old domain still answers, and must: names registered under the earlier
    root and every link already handed out point at it
  - update the docs that quote the old domain, and commit
  - the $NEW_DOMAIN certificate renews through the timer certbot installed

EOF
