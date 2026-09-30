import { describe, expect, it } from 'vitest';
import {
  AGENT_PROMPT,
  ASK_TXT,
  L2_REGISTRY_ADDRESS,
  MCP_CONFIG_JSON,
  MCP_URL,
  SITE_URL,
} from '../lib/agentPrompt.js';

const TOOL_NAMES = [
  'check_name',
  'request_name',
  'get_status',
  'draft_card',
  'get_profile',
  'prepare_registration',
  'submit_registration',
  'prepare_card',
  'submit_card',
];

describe('the prompt a person pastes', () => {
  it('names the tools that path needs, and points at the file with the rest', () => {
    // The paste block is short on purpose: a task, not a spec. The catalogue
    // lives in /ask.txt, which is where an agent reads it from.
    for (const tool of ['check_name', 'prepare_registration', 'submit_registration', 'request_name', 'get_status']) {
      expect(AGENT_PROMPT).toContain(tool);
    }
    expect(AGENT_PROMPT).toContain('/ask.txt');
  });

  it('tells the AI that the owner signs, and that nothing is registered yet', () => {
    expect(AGENT_PROMPT).toContain('must be signed by the owner');
    expect(AGENT_PROMPT).toContain('Do not say the name is registered');
    expect(AGENT_PROMPT).toContain('15 minutes');
  });

  it('does not let the AI fill in what it does not know', () => {
    expect(AGENT_PROMPT).toContain('If something is missing, say it is missing');
  });

  it('names the current broken case instead of letting the AI retry forever', () => {
    expect(AGENT_PROMPT).toContain('issuer wallet is not configured');
  });

  it('carries the whole catalogue in the file an agent reads', () => {
    for (const tool of TOOL_NAMES) expect(ASK_TXT).toContain(tool);
  });
});

describe('the file an AI reads itself', () => {
  it('is plain text with the MCP endpoint and all five tools', () => {
    for (const tool of TOOL_NAMES) expect(ASK_TXT).toContain(tool);
    expect(ASK_TXT).toContain(MCP_URL);
    expect(ASK_TXT).toContain(`${SITE_URL}/v1/names/<name>/available`);
  });

  it('carries a client config that parses as JSON', () => {
    const parsed = JSON.parse(MCP_CONFIG_JSON) as { mcpServers: Record<string, { url: string }> };
    expect(parsed.mcpServers.musename.url).toBe(MCP_URL);
    expect(ASK_TXT).toContain(MCP_CONFIG_JSON);
  });

  it('says what is not true yet, in the file an agent will quote', () => {
    expect(ASK_TXT).toContain('no record contract in production');
    expect(ASK_TXT).toContain('Never call it independent');
    expect(ASK_TXT).toContain('registry admin is a hot wallet');
  });

  it('keeps the three verdicts apart', () => {
    expect(ASK_TXT).toContain('"Unproven" is not a pass');
  });

  it('tells the agent how to check us without trusting us', () => {
    expect(ASK_TXT).toContain('HOW TO CHECK US WITHOUT TRUSTING US');
    expect(ASK_TXT).toContain(L2_REGISTRY_ADDRESS);
    expect(ASK_TXT).toContain(`${SITE_URL}/.well-known/musename.json`);
  });

  it('matches the live registry address in the deployment record', async () => {
    const { readFileSync } = await import('node:fs');
    // config/chains.json is what the API serves and what the front end falls
    // back to; deployments/*.json are historical records, so comparing against
    // those would let /ask.txt name a registry the running product no longer
    // writes to — which is exactly what happened during the 2026-09-30 rename.
    const chains = JSON.parse(
      readFileSync(new URL('../../../config/chains.json', import.meta.url), 'utf8'),
    ) as { l2: { l2Registry: string } };
    expect(L2_REGISTRY_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(L2_REGISTRY_ADDRESS.toLowerCase()).toBe(chains.l2.l2Registry.toLowerCase());
    expect(ASK_TXT.toLowerCase()).toContain(chains.l2.l2Registry.toLowerCase());
  });
});
