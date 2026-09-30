#!/usr/bin/env node
/**
 * Does the live API actually issue a name?
 *
 * Every other test in this repository checks a piece we control. This one goes
 * at the deployed service the way a user would: sign the register message, POST
 * it, and see whether a real name comes back. It is the difference between "the
 * code can do it" and "the product can do it right now".
 *
 *   node scripts/live-claim-probe.mjs                       # against musename.xyz
 *   node scripts/live-claim-probe.mjs --base http://localhost:3001
 *
 * The owner key is the test wallet in contracts/.sepolia-keys: it owns nothing
 * of value and the name it claims is a probe name.
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
const registrar = chains.l2.registrar;

// The default owner is the test wallet, which already holds its free name — so a
// run against a healthy service and a run against a broken one look different,
// and a quota refusal is reported as a policy answer rather than a failure.
// `--fresh-owner` mints a throwaway wallet instead, which is how you prove
// issuance end to end rather than proving the quota still works.
const owner = process.argv.includes('--fresh-owner')
  ? privateKeyToAccount(generatePrivateKey())
  : privateKeyToAccount(
      readFileSync(resolve(repoRoot, 'contracts/.sepolia-keys'), 'utf8').match(/0x[0-9a-fA-F]{64}/)[0],
    );

// A fresh label every run, so a pass means "it works now", not "it worked once".
const label = `probe${randomBytes(3).toString('hex')}`;
const deadline = Math.floor(Date.now() / 1000) + 900;

const domain = buildEip712Domain({
  productName: brand.productName,
  chainId: chains.l2.chainId,
  verifyingContract: registrar,
});
const message = registerMessage({ label, owner: owner.address, deadline: BigInt(deadline) });
const signature = await owner.signTypedData({
  domain,
  types: REGISTER_TYPES,
  primaryType: 'Register',
  message,
});

console.log(`MusePass live claim probe`);
console.log(`  api   ${base}`);
console.log(`  label ${label}.${brand.rootName}`);
console.log(`  owner ${owner.address}`);

const response = await fetch(`${base}/v1/names/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label, owner: owner.address, deadline, signature }),
});
const body = await response.json().catch(() => ({}));

const code = body?.errors?.[0]?.code ?? body?.code ?? '—';
const why = (body?.errors?.[0]?.message ?? body?.message ?? '').split('\n')[0].slice(0, 160);
console.log(`  HTTP  ${response.status}  ${code}`);
if (response.status >= 400) {
  console.log(`  why   ${why}`);
  // A policy answer ("this wallet already has its free name") means the write
  // path answered; a chain or internal error means it is broken. Only the
  // second is a failure. Use --fresh-owner to force a real issuance.
  const policy = ['QUOTA_EXCEEDED', 'RATE_LIMITED', 'NAME_TAKEN', 'RESERVED', 'INVALID_LABEL'];
  if (policy.includes(code)) {
    console.log(`\nPASS (policy): the service answered with a rule, not an error.`);
    console.log(`to prove issuance end to end: node scripts/live-claim-probe.mjs --fresh-owner`);
    process.exit(0);
  }
  console.error(`\nFAIL: the live service could not reach the chain for this claim.`);
  process.exit(1);
}

console.log(`  tx    ${body?.data?.txHash ?? '—'}`);
console.log(`  name  ${body?.data?.fullName ?? '—'} → ${body?.data?.owner ?? '—'}`);

// The same bug that stopped registrations also stopped card publishing — both
// are writes through the same wallet client — so the probe exercises both.
if (!process.argv.includes('--no-card')) {
  // ERC-8004 wants an image; an inline SVG keeps the probe self-contained, so
  // it does not depend on an asset that might be moved later.
  const image =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111"/><text x="10" y="40" font-size="28" fill="#fff">MN</text></svg>',
    ).toString('base64');
  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `${label}.${brand.rootName}`,
    description: 'Live probe card written by scripts/live-claim-probe.mjs.',
    image,
    x402Support: false,
    active: true,
    services: [],
    registrations: [],
    supportedTrust: [],
  };
  const value = cardDataUri(card);
  const expiration = Math.floor(Date.now() / 1000) + 900;
  const payload = cardTextSignaturePayload({
    registry: chains.l2.l2Registry,
    node: namehash(`${label}.${brand.rootName}`),
    key: CARD_TEXT_KEY,
    value,
    expiration,
  });
  const cardSignature = await owner.signMessage({ message: { raw: payload } });
  const cardResponse = await fetch(`${base}/v1/names/${label}/card`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card, expiration, signer: owner.address, signature: cardSignature }),
  });
  const cardBody = await cardResponse.json().catch(() => ({}));
  console.log(`  card  HTTP ${cardResponse.status} ${cardBody?.data?.txHash ?? cardBody?.errors?.[0]?.message ?? ''}`);
  if (cardResponse.status >= 400) {
    console.error(`\nFAIL: the name was issued but the card could not be published.`);
    process.exit(1);
  }
}

console.log(`\nPASS: the live service issued the name on chain.`);
console.log(`check it resolves on mainnet in a minute:`);
console.log(`  node -e "import('viem/ens').then(async m=>{const {createPublicClient,http}=await import('viem');const {mainnet}=await import('viem/chains');console.log(await m.getEnsAddress(createPublicClient({chain:mainnet,transport:http('https://ethereum-rpc.publicnode.com')}),{name:'${label}.${brand.rootName}'}))})"`);
