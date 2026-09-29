/**
 * The limit the config has promised since phase 1 (`mcpRequestsPerHourPerHost`)
 * and that nothing enforced until now.
 *
 * Two buckets, both have to pass:
 *
 *   per caller address   real, but coarse — everyone behind one NAT shares it
 *   per host header      `x-musename-host`, what the AI client says it is
 *
 * A caller can lie about the second, which is why the first exists: rotating a
 * header hands you a fresh host bucket but not a fresh address bucket, so the
 * ceiling still holds. When hosts start authenticating we can trust the header
 * and drop the address bucket; until then this is the honest version.
 */
export interface RateDecision {
  allowed: boolean;
  /** Seconds until the bucket refills. */
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export const HOUR_MS = 60 * 60 * 1000;

export function createRateLimiter(options: { limitPerHour: number; now?: () => number }) {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? (() => Date.now());

  function check(key: string): RateDecision {
    const current = now();
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= current ? { count: 0, resetAt: current + HOUR_MS } : existing;
    bucket.count += 1;
    buckets.set(key, bucket);
    const used = bucket.count;
    return {
      allowed: used <= options.limitPerHour,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
      limit: options.limitPerHour,
      remaining: Math.max(0, options.limitPerHour - used),
      resetAt: bucket.resetAt,
    };
  }

  return {
    check,
    /** Which buckets a request spends from. Both have to allow it. */
    keys(headers: Headers, fallbackAddress: string): string[] {
      const host = (headers.get('x-musename-host') ?? '').trim().toLowerCase().slice(0, 64);
      const forwarded = (headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim();
      const address = forwarded || headers.get('x-real-ip') || fallbackAddress || 'unknown';
      return host ? [`ip:${address}`, `host:${host}`] : [`ip:${address}`];
    },
    size: () => buckets.size,
  };
}

export const RATE_LIMIT_MESSAGE = 'rate limit exceeded; slow down and retry later';
