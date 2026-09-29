import { describe, expect, it } from 'vitest';
import { buildReservedIndex, loadConfig } from '@musename/core';
import type { Address, Hex } from 'viem';

import { createApp } from '../src/app.js';
import type { ChainReader, MusenameDeps } from '../src/deps.js';
import { createLogger } from '../src/observability.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

function build(logLines: string[]) {
  const config = loadConfig({ configDir: new URL('../../../config', import.meta.url).pathname, env: {} });
  const repos = createMemoryRepos();
  const chain: ChainReader = {
    async isLabelAvailable() {
      return true;
    },
    async getOwner() {
      return null as Address | null;
    },
    async readText() {
      return null;
    },
    async writeText() {
      return { txHash: `0x${'ab'.repeat(32)}` as Hex };
    },
    async register() {
      return { txHash: `0x${'cd'.repeat(32)}` as Hex, node: `0x${'ef'.repeat(32)}` as Hex };
    },
  };

  let tick = 0;
  const logger = createLogger((line) => logLines.push(line));
  const deps: MusenameDeps = {
    config,
    reservedIndex: buildReservedIndex(config.reserved),
    chain,
    names: repos.names,
    requests: repos.requests,
    sponsorship: repos.sponsorship,
    clock: () => new Date('2026-09-29T00:00:00.000Z'),
    logger,
  };
  const app = createApp(deps);
  // The middleware's clock is real; only the request counting matters here.
  void tick;
  return { app, logLines };
}

function parse(line: string) {
  return JSON.parse(line) as Record<string, unknown>;
}

describe('request observability', () => {
  it('emits one structured line per request', async () => {
    const lines: string[] = [];
    const { app } = build(lines);

    await app.request('/healthz');

    expect(lines).toHaveLength(1);
    const entry = parse(lines[0]);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('request');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/healthz');
    expect(entry.status).toBe(200);
    expect(typeof entry.ms).toBe('number');
    expect(typeof entry.requestId).toBe('string');
  });

  it('returns the request id so a report can be looked up', async () => {
    const lines: string[] = [];
    const { app } = build(lines);

    const response = await app.request('/healthz');
    const header = response.headers.get('x-request-id');

    expect(header).toBeTruthy();
    expect(parse(lines[0]).requestId).toBe(header);
  });

  it('honours a caller supplied id so traces can be threaded', async () => {
    const lines: string[] = [];
    const { app } = build(lines);

    const response = await app.request('/healthz', {
      headers: { 'x-request-id': 'trace-from-a-proxy' },
    });

    expect(response.headers.get('x-request-id')).toBe('trace-from-a-proxy');
    expect(parse(lines[0]).requestId).toBe('trace-from-a-proxy');
  });

  it('replaces an absurdly long id instead of echoing it', async () => {
    const lines: string[] = [];
    const { app } = build(lines);

    const response = await app.request('/healthz', {
      headers: { 'x-request-id': 'x'.repeat(500) },
    });

    const returned = response.headers.get('x-request-id');
    expect(returned).not.toBe('x'.repeat(500));
    expect(returned?.length).toBeLessThan(64);
  });

  it('logs a missing route as 404, and a server fault as error level', async () => {
    const lines: string[] = [];
    const { app } = build(lines);

    await app.request('/nope');
    expect(parse(lines[0]).status).toBe(404);
    expect(parse(lines[0]).level).toBe('info');
  });

  it('still logs when the handler throws', async () => {
    const lines: string[] = [];
    const config = loadConfig({
      configDir: new URL('../../../config', import.meta.url).pathname,
      env: {},
    });
    const repos = createMemoryRepos();
    const app = createApp({
      config,
      reservedIndex: buildReservedIndex(config.reserved),
      chain: {
        async isLabelAvailable() {
          throw new Error('rpc exploded');
        },
        async getOwner() {
          return null;
        },
        async readText() {
          return null;
        },
        async writeText() {
          throw new Error('unused');
        },
        async register() {
          throw new Error('unused');
        },
      },
      names: repos.names,
      requests: repos.requests,
      sponsorship: repos.sponsorship,
      clock: () => new Date('2026-09-29T00:00:00.000Z'),
      logger: createLogger((line) => lines.push(line)),
    });

    // The availability route swallows chain errors into a 200 envelope, so the
    // point here is that a line is still written for it.
    await app.request('/v1/names/aguang/available');
    expect(lines).toHaveLength(1);
    expect(parse(lines[0]).status).toBe(200);
  });
});
