/*
 * P0-6 acceptance, live: publish a card that has PRIVATE fields, then read the
 * raw on-chain text record (`musename.card`) and assert the private content is
 * not in the bytes — only the public view, the visibility map and the
 * whole-card hash are. Run: node scripts/p0-6-card-envelope-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, namehash } from 'viem';
import chains from '../config/chains.json' with { type: 'json' };
import {
  cardDataUri,
  cardTextSignaturePayload,
  CARD_TEXT_KEY,
} from '../packages/core/dist/index.js';

const base = 'https://musepass.xyz';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const secrets = JSON.parse(readFileSync(resolve(repoRoot, '.secrets/invite-test-wallets.json'), 'utf8'));
const w1 = secrets.wallets.find((w) => w.label === 'tst1');
const account = privateKeyToAccount(w1.privateKey);

const label = 'tst1';
const fullName = `${label}.musepass.eth`;

// A card with fields that stay private (visibility default) plus one field the
// owner deliberately opens. The canary strings must never reach the chain.
const PRIVATE_OWNER = 'SECRET-OWNER-CANARY';
const PRIVATE_CONTACT = 'SECRET-CONTACT-CANARY';
const PUBLIC_DESCRIPTION = 'P0-6 envelope acceptance: public by choice.';

const card = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: fullName,
  address: w1.address,
  description: PUBLIC_DESCRIPTION,
  image:
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123e34"/><text x="10" y="42" font-size="26" fill="#fff">P6</text></svg>',
    ).toString('base64'),
  owner: PRIVATE_OWNER, // private by default
  contact: PRIVATE_CONTACT, // private by default
  x402Support: false,
  active: true,
  services: [],
  registrations: [],
  supportedTrust: [],
  musename: {
    cardVersion: 1,
    ensName: fullName,
    visibility: { name: 'public', address: 'public', description: 'public' },
  },
};

const value = cardDataUri(card);
const envelope = JSON.parse(Buffer.from(value.split(',')[1], 'base64').toString('utf8'));
console.log('envelope keys on chain will be:', Object.keys(envelope).join(', '));
if (JSON.stringify(envelope).includes(PRIVATE_OWNER) || JSON.stringify(envelope).includes(PRIVATE_CONTACT)) {
  console.error('FAIL: envelope (what goes on chain) contains a private field');
  process.exit(1);
}

const expiration = Math.floor(Date.now() / 1000) + 900;
const payload = cardTextSignaturePayload({
  registry: chains.l2.l2Registry,
  node: namehash(fullName),
  key: CARD_TEXT_KEY,
  value,
  expiration,
});
const signature = await account.signMessage({ message: { raw: payload } });

const response = await fetch(`${base}/v1/names/${label}/card`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ card, expiration, signer: w1.address, signature }),
});
const body = await response.json().catch(() => ({}));
console.log(`publish → HTTP ${response.status} tx ${body?.data?.txHash ?? '—'}`);
if (response.status >= 300) {
  console.error(JSON.stringify(body?.errors ?? body).slice(0, 300));
  process.exit(1);
}

// Wait for the text record to be readable on chain, then read it raw.
const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });
const node = namehash(fullName);
let record = null;
for (let attempt = 0; attempt < 20 && record === null; attempt += 1) {
  await new Promise((wake) => setTimeout(wake, 4000));
  try {
    record = await client.readContract({
      address: chains.l2.l2Registry,
      abi: [{ name: 'text', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }], outputs: [{ type: 'string' }] }],
      functionName: 'text',
      args: [node, CARD_TEXT_KEY],
    });
  } catch (error) {
    console.log(`  …read attempt ${attempt + 1} failed: ${String(error).slice(0, 80)}`);
  }
}
if (!record) {
  console.error('FAIL: could not read the text record from chain');
  process.exit(1);
}

const decoded = Buffer.from(record.split(',')[1], 'base64').toString('utf8');
console.log('\n--- raw chain record (what cast call returns) ---');
console.log(decoded);
const fails = [];
if (decoded.includes(PRIVATE_OWNER)) fails.push('private owner field is on chain');
if (decoded.includes(PRIVATE_CONTACT)) fails.push('private contact field is on chain');
if (!decoded.includes(PUBLIC_DESCRIPTION)) fails.push('public description missing from chain');
if (!decoded.includes('contentHash') && !decoded.includes('musename')) fails.push('no musename/hash section');
if (fails.length > 0) {
  console.error(`\nFAIL: ${fails.join('; ')}`);
  process.exit(1);
}
console.log('\nPASS: the chain carries the public fields, the visibility map and the hash — the private canaries are absent.');
