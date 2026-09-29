/**
 * The public MCP endpoint is the one surface a stranger can hammer without a
 * wallet, so the limit has to actually hold — and it has to be the limit in
 * config, not a number somebody typed into the code.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { loadConfig } from '@musename/core';

import { createMcpApp } from '../src/app.js';
import { createRateLimiter, HOUR_MS } from '../src/rateLimit.js';
import type { MusenameApi, ToolResult } from '../src/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(resolve(here, '../../../config'));

const ok = (summary: ToolResult['summary'], data: Record<string, unknown>): ToolResult => ({
  summary,
  data,
  errors: [],
});

const api: MusenameApi = {
  async checkName(name) {
    return ok({ zh: '可以。', en: 'available' }, { label: name, available: true });
  },
  async createRequest({ label }) {
    return ok({ zh: '准备好了。', en: 'ready' }, { requestId: 'req-1', label, confirmUrl: 'https://x/y' });
  },
  async getRequest(id) {
    return ok({ zh: '等待中。', en: 'pending' }, { requestId: id, status: 'pending' });
  },
  async getProfile(name) {
    return ok({ zh: '有名片。', en: 'profile' }, { name, owner: '0xabc', card: null, trackRecord: null });
  },
};

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};

describe('the limiter itself', () => {
  it('allows up to the limit and refuses the next one', () => {
    const limiter = createRateLimiter({ limitPerHour: 3, now: () => 0 });
    expect([1, 2, 3].map(() => limiter.check('ip:1.2.3.4').allowed)).toEqual([true, true, true]);
    const fourth = limiter.check('ip:1.2.3.4');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBe(HOUR_MS / 1000);
  });

  it('keeps one caller out of another caller’s bucket', () => {
    const limiter = createRateLimiter({ limitPerHour: 1, now: () => 0 });
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(true);
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(false);
    expect(limiter.check('ip:2.2.2.2').allowed).toBe(true);
  });

  it('refills after the hour', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limitPerHour: 1, now: () => clock });
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(true);
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(false);
    clock = HOUR_MS + 1;
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(true);
  });

  it('buckets by address and by declared host, and only the address cannot be spoofed', () => {
    const limiter = createRateLimiter({ limitPerHour: 10, now: () => 0 });
    const headers = new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'x-musename-host': 'Claude' });
    expect(limiter.keys(headers, '127.0.0.1')).toEqual(['ip:9.9.9.9', 'host:claude']);
    expect(limiter.keys(new Headers(), '127.0.0.1')).toEqual(['ip:127.0.0.1']);
  });
});

describe('the MCP endpoint', () => {
  it('serves a tool call while under the limit', async () => {
    const { app } = createMcpApp({ api, config, limitPerHour: 5, now: () => 0 });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initialize),
    });
    expect(response.status).toBe(200);
  });

  it('answers 429 with a JSON-RPC error once the limit is spent', async () => {
    const { app } = createMcpApp({ api, config, limitPerHour: 2, now: () => 0 });
    const call = () =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-for': '8.8.8.8',
        },
        body: JSON.stringify(initialize),
      });

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const refused = await call();
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: { code: number; message: string; data: { retryAfterSeconds: number } } };
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toContain('rate limit');
    expect(body.error.data.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.headers.get('retry-after')).toBeTruthy();
  });

  it('does not let a spoofed host header buy a caller more requests', async () => {
    const { app } = createMcpApp({ api, config, limitPerHour: 1, now: () => 0 });
    const call = (host: string) =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-for': '7.7.7.7',
          'x-musename-host': host,
        },
        body: JSON.stringify(initialize),
      });

    expect((await call('claude')).status).toBe(200);
    // A different host name, same address: refused, because the address bucket
    // is already spent. This is the whole reason there are two buckets.
    expect((await call('grok')).status).toBe(429);
  });

  it('reports the limit it enforces', async () => {
    const { app } = createMcpApp({ api, config, limitPerHour: 7 });
    const body = (await (await app.request('/healthz')).json()) as { rateLimitPerHour: number };
    expect(body.rateLimitPerHour).toBe(7);
  });

  it('uses the configured limit when nobody overrides it', async () => {
    // Reading it from config, not from a constant in the code, is the point:
    // rule 6 says limits live in config, and the config file says 120.
    const { app } = createMcpApp({ api, config });
    const body = (await (await app.request('/healthz')).json()) as { rateLimitPerHour: number };
    expect(body.rateLimitPerHour).toBe(config.limits.rateLimits.mcpRequestsPerHourPerHost);
    expect(body.rateLimitPerHour).toBe(120);
  });
});
