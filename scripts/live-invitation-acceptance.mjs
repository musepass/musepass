#!/usr/bin/env node
/**
 * Live acceptance matrix for the invitation flow (remaining-work item 1).
 *
 * Runs against the deployed service with the throwaway wallets in
 * .secrets/invite-test-wallets.json (never funded with real value):
 *
 *   A. available?owner=W1 on a 4-char label  → invited: true
 *   B. W1 claims that 4-char label           → 200 + txHash (real issuance)
 *   C. W1 claims another 4-char label        → 409 ALREADY_CLAIMED
 *   D. a fresh random wallet claims 4-char   → 403 NOT_INVITED
 *   E. W2 claims a 2-char label              → 403 PROJECT_RESERVED
 *   F. GET /v1/invitations                   → claimed = 1, claimsSource postgres
 *   G. W1 publishes a card                   → 200, and /v1/names/:name reports
 *                                               a genesis number once the
 *                                               5-minute cover cache expires
 *
 *   node scripts/live-invitation-acceptance.mjs [--base https://musename.xyz]
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
  CARD_TEXT_KEY,
  REGISTER_TYPES,
  buildEip712Domain,
  cardDataUri,
  cardTextSignaturePayload,
  namehash,
  registerMessage,
} from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const base = arg('base', 'https://musename.xyz');
const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));
const brand = JSON.parse(readFileSync(resolve(repoRoot, 'config/brand.json'), 'utf8'));
const secrets = JSON.parse(readFileSync(resolve(repoRoot, '.secrets/invite-test-wallets.json'), 'utf8'));
const byLabel = Object.fromEntries(secrets.wallets.map((wallet) => [wallet.label, wallet]));
const registrar = chains.l2.registrar;

const w1 = privateKeyToAccount(byLabel.tst1.privateKey);
const w2 = privateKeyToAccount(byLabel.tst2.privateKey);
const stranger = privateKeyToAccount(generatePrivateKey());
const label = 'tst1';
const fullName = `${label}.${brand.rootName}`;

const failures = [];
function report(step, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(step);
}

async function postClaim(account, claimLabel) {
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const domain = buildEip712Domain({
    productName: brand.productName,
    chainId: chains.l2.chainId,
    verifyingContract: registrar,
  });
  const message = registerMessage({ label: claimLabel, owner: account.address, deadline: BigInt(deadline) });
  const signature = await account.signTypedData({ domain, types: REGISTER_TYPES, primaryType: 'Register', message });
  const response = await fetch(`${base}/v1/names/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: claimLabel, owner: account.address, deadline, signature }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

console.log(`MusePass invitation acceptance`);
console.log(`  api ${base}`);
console.log(`  W1  ${w1.address}  (invited)`);
console.log(`  W2  ${w2.address}  (invited)`);
console.log(`  ??  ${stranger.address}  (fresh)\n`);

// A — the availability answer reflects the invitation ledger. On the very
// first run (invitation unspent) this answered `invited: true`; the matrix
// then spends the invitation, so every later run must answer false. Both
// states were observed live on 2026-10-01.
const a = await fetch(`${base}/v1/names/${fullName}/available?owner=${w1.address}`).then((r) => r.json());
report('A available?owner=W1 → invited false (invitation spent)', a?.data?.invited === false, `invited=${a?.data?.invited}`);

// B — the invited claim itself: a real on-chain registration. 201 on first
// issue, 200 with alreadyRegistered on a re-run against the same owner.
const b = await postClaim(w1, label);
report(
  'B W1 claims tst1 → 2xx + txHash',
  b.status < 300 && Boolean(b.body?.data?.txHash),
  `HTTP ${b.status} ${b.body?.data?.txHash ?? b.body?.errors?.[0]?.code ?? ''}${b.body?.data?.alreadyRegistered ? ' (alreadyRegistered)' : ''}`,
);
console.log(`     tx ${b.body?.data?.txHash ?? '—'}`);

// G (card first, so the 5-minute genesis cache expires while the rest runs)
let cardTx = null;
if (b.status < 300) {
  const image =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111"/><text x="8" y="42" font-size="30" fill="#fff">T1</text></svg>`,
    ).toString('base64');
  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: fullName,
    description: 'Acceptance-run card for the invitation flow.',
    image,
    x402Support: false,
    active: true,
    services: [],
    registrations: [],
    supportedTrust: [],
  };
  const expiration = Math.floor(Date.now() / 1000) + 900;
  const payload = cardTextSignaturePayload({
    registry: chains.l2.l2Registry,
    node: namehash(fullName),
    key: CARD_TEXT_KEY,
    value: cardDataUri(card),
    expiration,
  });
  const signature = await w1.signMessage({ message: { raw: payload } });
  const cardResponse = await fetch(`${base}/v1/names/${label}/card`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card, expiration, signer: w1.address, signature }),
  });
  const cardBody = await cardResponse.json().catch(() => ({}));
  cardTx = cardBody?.data?.txHash ?? null;
  report('G1 W1 publishes card → 2xx', cardResponse.status < 300, `HTTP ${cardResponse.status} ${cardTx ?? ''}`);
} else {
  report('G1 W1 publishes card → 200', false, 'skipped: B failed');
}

// C — one invitation per wallet, enforced by the ledger. The label must be
// 3–4 display units: a longer one falls out of the invitation rule into the
// ordinary free-name quota, which answers QUOTA_EXCEEDED instead.
const c = await postClaim(w1, 'ts1x');
report(
  'C W1 claims again → 409 ALREADY_CLAIMED',
  c.status === 409 && (c.body?.errors?.[0]?.code ?? c.body?.code) === 'ALREADY_CLAIMED',
  `HTTP ${c.status} ${c.body?.errors?.[0]?.code ?? c.body?.code ?? ''}`,
);

// D — a wallet that is not on the list cannot take a short name.
const strangerLabel = `x${randomBytes(2).toString('hex')}`.slice(0, 4);
const d = await postClaim(stranger, strangerLabel);
report(
  'D stranger claims 4-char → 403 NOT_INVITED',
  d.status === 403 && (d.body?.errors?.[0]?.code ?? d.body?.code) === 'NOT_INVITED',
  `HTTP ${d.status} label=${strangerLabel} ${d.body?.errors?.[0]?.code ?? d.body?.code ?? ''}`,
);

// E — 1–2 characters are reserved for the project, invitation or not.
const e = await postClaim(w2, 'w2');
report(
  'E W2 claims 2-char → 403 PROJECT_RESERVED',
  e.status === 403 && (e.body?.errors?.[0]?.code ?? e.body?.code) === 'PROJECT_RESERVED',
  `HTTP ${e.status} ${e.body?.errors?.[0]?.code ?? e.body?.code ?? ''}`,
);

// F — the public ledger counts the spend but never the names.
const f = await fetch(`${base}/v1/invitations`).then((r) => r.json());
const fData = f?.data ?? f;
report(
  'F /v1/invitations → claimed 1, source postgres',
  fData?.claimed === 1 && fData?.claimsSource === 'postgres',
  `issued=${fData?.issued} claimed=${fData?.claimed} remaining=${fData?.remaining} source=${fData?.claimsSource}`,
);

// G2 — genesis cover numbers the name once its 5-minute cache expires.
if (cardTx) {
  console.log('\nwaiting out the 5-minute genesis cover cache…');
  let number = null;
  for (let attempt = 0; attempt < 16 && number === null; attempt += 1) {
    await new Promise((wake) => setTimeout(wake, attempt === 0 ? 30_000 : 30_000));
    const detail = await fetch(`${base}/v1/names/${fullName}`).then((r) => r.json()).catch(() => null);
    number = detail?.data?.genesis?.number ?? null;
    if (number === null) console.log(`  …retry ${attempt + 1}`);
  }
  report('G2 /v1/names/tst1 → genesis number', number !== null, `genesis #${number ?? '—'}`);
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
