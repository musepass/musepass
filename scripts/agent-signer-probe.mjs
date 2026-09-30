#!/usr/bin/env node
/**
 * Can an agent with no key of its own buy a name and publish a card?
 *
 * Two MCP servers, exactly as a cloud bot would use them: the MusePass server for
 * everything public, and the signer for the two things that need a signature. The
 * probe holds the signer's bearer token and never sees a private key — which is
 * the point, because the alternative is pasting a key into a chat.
 *
 *   node scripts/agent-signer-probe.mjs
 *   node scripts/agent-signer-probe.mjs --token <token> --label myname
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { getEnsAddress } from 'viem/ens';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const mcpUrl = arg('mcp', 'https://musename.xyz/mcp');
const signerUrl = arg('signer', 'https://musename.xyz/signer/mcp');
const token = arg('token', readFileSync(resolve(repoRoot, '.secrets/signer-token.txt'), 'utf8').trim());
const label = arg('label', `signer${randomBytes(3).toString('hex')}`);

async function mcp(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (response.status === 401) throw new Error(`${url} rejected the token`);
  const match = text.match(/data: (\{.*\})/s);
  const body = JSON.parse(match ? match[1] : text);
  if (body.error) throw new Error(`${url}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function callTool(url, name, args, headers = {}) {
  const result = await mcp(
    url,
    {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10000),
      method: 'tools/call',
      params: { name, arguments: args },
    },
    headers,
  );
  const text = result.content[0].text;
  // The MusePass server answers in prose with a fenced JSON block; the signer
  // answers in plain JSON because its only reader is a program. Accept both.
  const fenced = text.match(/```json\n([\s\S]*?)\n```/);
  if (fenced) return { text, data: JSON.parse(fenced[1]) };
  try {
    return { text, data: JSON.parse(text) };
  } catch {
    return { text, data: {} };
  }
}

const init = (name) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } },
});

const signerHeaders = { authorization: `Bearer ${token}` };
await mcp(mcpUrl, init('agent-signer-probe'));
await mcp(signerUrl, init('agent-signer-probe-signer'), signerHeaders);

console.log('MusePass agent + signer probe');
console.log(`  mcp     ${mcpUrl}`);
console.log(`  signer  ${signerUrl}`);

// 1. The agent asks the signer for an address. It never sees a key.
const wallet = await callTool(signerUrl, 'wallet_address', {}, signerHeaders);
const ownerAddress = wallet.data.address;
console.log(`  wallet  ${ownerAddress}   (from the signer)`);
console.log(`  name    ${label}.musepass.eth`);

// 2. Availability, then the exact payload to sign.
const available = await callTool(mcpUrl, 'check_name', { name: label });
if (available.data.available === false) {
  console.error(`FAIL: ${label} is not available`);
  console.error(available.text.slice(0, 300));
  process.exit(1);
}

const prepared = await callTool(mcpUrl, 'prepare_registration', { name: label, ownerAddress });
if (!prepared.data.typedData) {
  console.error('FAIL: prepare_registration returned no typed data');
  console.error(prepared.text.slice(0, 400));
  process.exit(1);
}

// 3. The signer signs it. The policy checks the chain, the contract and the deadline.
const signed = await callTool(signerUrl, 'sign_registration', { typedData: prepared.data.typedData }, signerHeaders);
if (!signed.data.signature) {
  console.error('FAIL: the signer refused');
  console.error(JSON.stringify(signed.data));
  process.exit(1);
}

// 4. Back to MusePass with the signature.
const claimed = await callTool(mcpUrl, 'submit_registration', {
  label: prepared.data.label,
  owner: prepared.data.owner,
  deadline: prepared.data.deadline,
  signature: signed.data.signature,
});
console.log(`  register ${claimed.data.txHash ?? 'FAILED'}`);
if (!claimed.data.txHash) {
  console.error(claimed.text.slice(0, 500));
  process.exit(1);
}

// 5. The same pair, for the card.
const preparedCard = await callTool(mcpUrl, 'prepare_card', {
  name: label,
  description: 'An agent that registered itself through a signer it does not own.',
  host: 'agent-signer-probe',
});
if (!preparedCard.data.payloadToSign) {
  console.error('FAIL: prepare_card returned no payload');
  console.error(preparedCard.text.slice(0, 400));
  process.exit(1);
}
const signedCard = await callTool(signerUrl, 'sign_card', { payloadToSign: preparedCard.data.payloadToSign }, signerHeaders);
if (!signedCard.data.signature) {
  console.error('FAIL: the signer refused the card');
  console.error(JSON.stringify(signedCard.data));
  process.exit(1);
}
const publishedCard = await callTool(mcpUrl, 'submit_card', {
  label,
  card: preparedCard.data.card,
  expiration: preparedCard.data.expiration,
  signer: ownerAddress,
  signature: signedCard.data.signature,
});
console.log(`  card    ${publishedCard.data.txHash ?? 'FAILED'}`);

// 6. What a wallet would see.
const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
const resolved = await getEnsAddress(client, { name: `${label}.musepass.eth` });
const ok = resolved?.toLowerCase() === ownerAddress.toLowerCase();
console.log(`  mainnet ${resolved ?? 'nothing'}`);
console.log(
  ok
    ? '\nPASS: an agent with no key registered a name and published its card.'
    : '\nFAIL: it resolved to the wrong address.',
);
process.exit(ok ? 0 : 1);
