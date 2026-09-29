import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Structured logs and request ids.
 *
 * One JSON object per line so a log collector can index it, and a request id
 * that appears both in the response and in every line for that request — the
 * two things that turn "the API returned an error" into a lookup.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  write: (line: string) => void = (line) => console.log(line),
  base: Record<string, unknown> = {},
): Logger {
  return {
    log(level, message, fields = {}) {
      write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          msg: message,
          ...base,
          ...fields,
        }),
      );
    },
  };
}

export interface RequestLogRecord {
  requestId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

/**
 * Assigns a request id (honouring one from the caller, so a proxy or a test can
 * thread it through), exposes it on the response, and emits one line per
 * request. `now` is injectable so tests do not depend on wall clock behaviour.
 */
export function requestObservability(
  logger: Logger,
  options: { now?: () => number; newId?: () => string } = {},
): MiddlewareHandler {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => randomUUID());

  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : newId();
    const startedAt = now();

    // The client gets the id back in a header; every log line for this request
    // carries the same one, which is what makes a report actionable.
    c.header('x-request-id', requestId);

    try {
      await next();
    } finally {
      const record: RequestLogRecord = {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: now() - startedAt,
      };
      // 5xx is worth waking someone up for; everything else is informational.
      logger.log(record.status >= 500 ? 'error' : 'info', 'request', { ...record });
    }
  };
}
