import { serve } from '@hono/node-server';
import { loadConfig } from '@musename/core';

import { createHttpApi } from './api-client.js';
import { createMcpApp } from './app.js';

const config = loadConfig();
const apiBaseUrl = process.env.MUSENAME_API_URL ?? 'http://localhost:3001';
const api = createHttpApi({ baseUrl: apiBaseUrl });

const override = Number(process.env.MUSENAME_MCP_RATE_LIMIT_PER_HOUR ?? '');
const { app } = createMcpApp({
  api,
  config,
  ...(Number.isFinite(override) && override > 0 ? { limitPerHour: override } : {}),
});

const port = Number(process.env.MCP_PORT ?? 3002);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${config.brand.productName} MCP listening on http://localhost:${info.port}/mcp`);
  console.log(`  health : http://localhost:${info.port}/healthz`);
  console.log(`  api    : ${apiBaseUrl}`);
  console.log(`  limit  : ${config.limits.rateLimits.mcpRequestsPerHourPerHost} tool calls per hour per caller`);
});
