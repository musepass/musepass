import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { MusenameConfig } from '@musename/core';

import { createRateLimiter, RATE_LIMIT_MESSAGE } from './rateLimit.js';
import { createServer } from './server.js';
import type { MusenameApi } from './tools.js';

export interface McpAppOptions {
  api: MusenameApi;
  config: MusenameConfig;
  /** Overrides the configured per-hour limit; used by tests and by ops. */
  limitPerHour?: number;
  now?: () => number;
}

export function createMcpApp({ api, config, limitPerHour, now }: McpAppOptions) {
  const limit = limitPerHour ?? config.limits.rateLimits.mcpRequestsPerHourPerHost;
  const limiter = createRateLimiter({ limitPerHour: limit, ...(now ? { now } : {}) });
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version', 'x-musename-host'],
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version', 'retry-after'],
    }),
  );

  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      product: config.brand.productName,
      rootName: config.brand.rootName,
      rateLimitPerHour: limit,
    }),
  );

  // Stateless streamable HTTP: a fresh server and transport per request. Nothing
  // is kept in memory between calls, which is what we want for a tool server
  // whose state lives in the API and the chain.
  app.all('/mcp', async (c) => {
    const decisions = limiter
      .keys(c.req.raw.headers, c.req.header('x-real-ip') ?? 'unknown')
      .map((key) => limiter.check(key));
    const blocked = decisions.find((decision) => !decision.allowed);
    if (blocked) {
      // A JSON-RPC error body, not an HTML page: an MCP client has to be able to
      // read why it was refused. 429 plus Retry-After so a well-behaved client
      // backs off on its own.
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: RATE_LIMIT_MESSAGE,
            data: { retryAfterSeconds: blocked.retryAfterSeconds, limit: blocked.limit },
          },
        },
        429,
        { 'retry-after': String(blocked.retryAfterSeconds) },
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createServer(api, config);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return { app, limiter };
}
