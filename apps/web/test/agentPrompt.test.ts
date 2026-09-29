import { describe, expect, it } from 'vitest';
import {
  AGENT_PROMPT_ZH,
  ASK_TXT,
  MCP_CONFIG_JSON,
  MCP_URL,
  SITE_URL,
} from '../lib/agentPrompt.js';

const TOOL_NAMES = ['check_name', 'request_name', 'get_status', 'draft_card', 'get_profile'];

describe('the prompt a person pastes', () => {
  it('names every tool the MCP server actually registers', () => {
    for (const tool of TOOL_NAMES) expect(AGENT_PROMPT_ZH).toContain(tool);
  });

  it('tells the AI that the owner signs, and that nothing is registered yet', () => {
    expect(AGENT_PROMPT_ZH).toContain('必须由主人本人签名');
    expect(AGENT_PROMPT_ZH).toContain('不要说你已经注册好了');
    expect(AGENT_PROMPT_ZH).toContain('15 分钟');
  });

  it('does not let the AI fill in what it does not know', () => {
    expect(AGENT_PROMPT_ZH).toContain('缺字段就说缺字段');
  });

  it('names the current broken case instead of letting the AI retry forever', () => {
    expect(AGENT_PROMPT_ZH).toContain('issuer wallet is not configured');
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
    expect(ASK_TXT).toContain('0x0ca717398428bcae7fae24e656e8444ecd9ba5a5');
    expect(ASK_TXT).toContain(`${SITE_URL}/.well-known/musename.json`);
  });

  it('matches the live registry address in the deployment record', async () => {
    const { readFileSync } = await import('node:fs');
    const deployments = JSON.parse(
      readFileSync(new URL('../../../deployments/robinhood.json', import.meta.url), 'utf8'),
    ) as { l2Registry: { address: string } };
    expect(ASK_TXT.toLowerCase()).toContain(deployments.l2Registry.address.toLowerCase());
  });
});
