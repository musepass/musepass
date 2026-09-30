#!/usr/bin/env node
/**
 * Can an AI agent buy a name by itself?
 *
 * This drives the live MCP endpoint the way a bot with its own wallet would:
 * prepare_registration for the exact EIP-712 payload, sign it, submit the
 * signature, then check on mainnet that the name really resolves to that wallet.
 *
 * It is the test for the claim "an agent can do this without a human". The owner
 * is a fresh wallet created for the run, because the point is that the signer is
 * the owner — no owner, no name.
 *
 *   node scripts/agent-purchase-probe.mjs                 # against musename.xyz
 *   node scripts/agent-purchase-probe.mjs --base http://localhost:3001
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getEnsAddress } from 'viem/ens';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const mcpUrl = arg('mcp', 'https://musepass.xyz/mcp');
const label = arg('label', `agent${randomBytes(3).toString('hex')}`);
const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));

/** Minimal MCP client: the protocol is JSON-RPC over HTTP, nothing more. */
async function callMcp(payload) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const match = text.match(/data: (\{.*\})/s);
  const body = JSON.parse(match ? match[1] : text);
  if (body.error) throw new Error(`MCP error: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function callTool(name, args) {
  const result = await callMcp({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1000),
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const text = result.content[0].text;
  const json = text.match(/```json\n([\s\S]*?)\n```/);
  return { text, data: json ? JSON.parse(json[1]) : {} };
}

await callMcp({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-purchase-probe', version: '1' } },
});

// The agent's own wallet. Nobody signs for it; that is the whole point.
const agent = privateKeyToAccount(generatePrivateKey());
console.log('MusePass agent purchase probe');
console.log(`  mcp    ${mcpUrl}`);
console.log(`  name   ${label}.${chains.l2.name === 'robinhood' ? 'musepass.eth' : 'musepass.eth'}`);
console.log(`  wallet ${agent.address}  (fresh, owned by "the agent")`);

const prepared = await callTool('prepare_registration', { name: label, ownerAddress: agent.address });
const typedData = prepared.data.typedData;
if (!typedData) {
  console.error('FAIL: prepare_registration returned no typed data');
  console.error(prepared.text.slice(0, 400));
  process.exit(1);
}

const signature = await agent.signTypedData({
  domain: typedData.domain,
  types: typedData.types,
  primaryType: 'Register',
  message: {
    label: typedData.message.label,
    owner: typedData.message.owner,
    deadline: BigInt(typedData.message.deadline),
  },
});

const submitted = await callTool('submit_registration', {
  label: prepared.data.label,
  owner: prepared.data.owner,
  deadline: prepared.data.deadline,
  signature,
});

if (submitted.data.txHash) {
  console.log(`  tx     ${submitted.data.txHash}`);
} else {
  console.error('FAIL: the name was not issued');
  console.error(submitted.text.slice(0, 600));
  process.exit(1);
}

// The agent owns the name now, so it can also publish its own card. That is the
// rest of "acts on its own account": until this worked, every card needed a human
// on a web page.
const preparedCard = await callTool('prepare_card', {
  name: label,
  description: `An autonomous agent that registered itself to test MusePass.`,
  host: 'agent-purchase-probe',
});
if (!preparedCard.data.payloadToSign) {
  console.error('FAIL: prepare_card returned no payload');
  console.error(preparedCard.text.slice(0, 400));
  process.exit(1);
}
const cardSignature = await agent.signMessage({
  message: { raw: preparedCard.data.payloadToSign },
});
const submittedCard = await callTool('submit_card', {
  label,
  card: preparedCard.data.card,
  expiration: preparedCard.data.expiration,
  signer: agent.address,
  signature: cardSignature,
});
console.log(`  card   ${submittedCard.data.txHash ?? 'FAILED'}`);
if (!submittedCard.data.txHash) {
  console.error(submittedCard.text.slice(0, 600));
  process.exit(1);
}

// And the half that matters: does a wallet find it?
const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
const resolved = await getEnsAddress(client, { name: `${label}.musepass.eth` });
const ok = resolved?.toLowerCase() === agent.address.toLowerCase();
console.log(`  mainnet ${resolved ?? 'nothing'}`);
console.log(ok ? '\nPASS: an agent with a wallet bought a name by itself.' : '\nFAIL: it resolved to the wrong address.');
process.exit(ok ? 0 : 1);
