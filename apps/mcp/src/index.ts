import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { loadConfig } from '@musename/core';

import { createHttpApi } from './api-client.js';
import { createServer } from './server.js';

const config = loadConfig();
const apiBaseUrl = process.env.MUSENAME_API_URL ?? 'http://localhost:3001';
const api = createHttpApi({ baseUrl: apiBaseUrl });

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
    exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
  }),
);

app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    product: config.brand.productName,
    rootName: config.brand.rootName,
    api: apiBaseUrl,
  }),
);

// Stateless streamable HTTP: a fresh server and transport per request. Nothing
// is kept in memory between calls, which is what we want for a tool server
// whose state lives in the API and the chain.
app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createServer(api, config);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

const port = Number(process.env.MCP_PORT ?? 3002);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${config.brand.productName} MCP listening on http://localhost:${info.port}/mcp`);
  console.log(`  health : http://localhost:${info.port}/healthz`);
  console.log(`  api    : ${apiBaseUrl}`);
});
