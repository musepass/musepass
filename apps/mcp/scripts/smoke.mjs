#!/usr/bin/env node
/**
 * Drives the running MCP server over streamable HTTP, exactly the way an AI
 * client would: connect, list tools, then call them with natural arguments.
 *
 *   node apps/mcp/scripts/smoke.mjs [mcpUrl]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpUrl = process.argv[2] ?? process.env.MUSENAME_MCP_URL ?? 'http://localhost:3002/mcp';
const name = process.env.MUSENAME_SMOKE_NAME ?? 'aguang';

const client = new Client({ name: 'musename-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

const textOf = (result) =>
  (result.content ?? []).map((item) => item.text ?? '').join('\n');

await client.connect(transport);

const { tools } = await client.listTools();
console.log(`connected to ${mcpUrl}`);
console.log(`tools: ${tools.map((tool) => tool.name).join(', ')}`);

const checks = [];

const availability = await client.callTool({
  name: 'check_name',
  arguments: { name },
});
const availabilityText = textOf(availability);
console.log('\n--- check_name ---');
console.log(availabilityText);
checks.push(['check_name led with a plain sentence', availabilityText.includes('。') || availabilityText.includes('.')]);
checks.push(['check_name says the name is available', availabilityText.includes('"available": true')]);

const request = await client.callTool({
  name: 'request_name',
  arguments: { name, ownerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', host: 'smoke-test' },
});
const requestText = textOf(request);
console.log('\n--- request_name ---');
console.log(requestText);
checks.push(['request_name returned a confirm link', /\/confirm\/[0-9a-f-]{36}\?token=/.test(requestText)]);
checks.push(['request_name told the AI to hand the link over', requestText.includes('交给主人')]);
checks.push(['request_name did not claim the name was minted', !requestText.includes('"alreadyRegistered": true')]);

const draft = await client.callTool({
  name: 'draft_card',
  arguments: {
    name,
    description: '婚礼与风光摄影，接受档期咨询',
    image: 'ipfs://bafyimage',
    services: [{ name: 'web', endpoint: `https://${name}.musename.xyz` }],
    host: 'smoke-test',
  },
});
const draftText = textOf(draft);
console.log('\n--- draft_card ---');
console.log(draftText);
checks.push(['draft_card is a draft', draftText.includes('"draft": true')]);
checks.push(['draft_card is not published', draftText.includes('"published": false')]);

const profile = await client.callTool({ name: 'get_profile', arguments: { name } });
const profileText = textOf(profile);
console.log('\n--- get_profile ---');
console.log(profileText);
checks.push(['get_profile did not invent a card', profileText.includes('"card": null')]);

console.log('\nresults:');
let failed = false;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed = true;
}

await client.close();

if (failed) {
  console.error('\nMCP smoke test failed.');
  process.exit(1);
}
console.log('\nMCP smoke test passed.');
