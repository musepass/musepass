import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, apiBaseUrl, checkAvailability, fetchConfig, FALLBACK_CONFIG, submitClaim } from '../lib/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const envelopeBody = {
  summary: { zh: '(unused)', en: 'available' },
  data: { label: 'aguang', fullName: 'aguang.musepass.eth', available: true },
  errors: [],
  meta: { asOf: 'now', chain: 'base', chainId: 8453, verified: true, root: 'musepass.eth' },
};

describe('api client', () => {
  it('parses the shared envelope', async () => {
    const payload = await checkAvailability('aguang', {
      fetchImpl: (async () => jsonResponse(envelopeBody)) as unknown as typeof fetch,
    });
    expect(payload.data.available).toBe(true);
    expect(payload.summary.en).toBe('available');
  });

  it('url-encodes the name', async () => {
    let called = '';
    await checkAvailability('a-guang-photography', {
      fetchImpl: (async (url: string) => {
        called = url;
        return jsonResponse(envelopeBody);
      }) as unknown as typeof fetch,
    });
    expect(called).toContain(encodeURIComponent('a-guang-photography'));
  });

  it('keeps a business failure as data, not as an exception', async () => {
    const payload = await checkAvailability('admin', {
      fetchImpl: (async () =>
        jsonResponse(
          {
            summary: { zh: '(unused)', en: 'reserved' },
            data: { label: 'admin', available: false },
            errors: [{ code: 'RESERVED_NAME', message: 'reserved' }],
            meta: { asOf: 'now', chain: 'base', chainId: 8453, verified: true, root: 'musepass.eth' },
          },
          409,
        )) as unknown as typeof fetch,
    });
    expect(payload.errors[0].code).toBe('RESERVED_NAME');
  });

  it('throws a readable error for an unparsable body', async () => {
    await expect(
      checkAvailability('aguang', {
        fetchImpl: (async () => new Response('not json', { status: 502 })) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('throws a readable error when the network is down', async () => {
    await expect(
      checkAvailability('aguang', {
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('surfaces the HTTP status when there is no envelope', async () => {
    await expect(
      submitClaim(
        { label: 'a', owner: '0x0', deadline: 1, signature: '0x' },
        {
          fetchImpl: (async () =>
            jsonResponse({ summary: { zh: '(unused)', en: 'oops' } }, 500)) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500 });
  });

  it('falls back to a usable config so the landing page still renders', async () => {
    const config = await fetchConfig({
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(config).toEqual(FALLBACK_CONFIG);
    expect(config.rootName).toBe('musepass.eth');
  });

  it('prefers the real config when the API answers', async () => {
    const config = await fetchConfig({
      fetchImpl: (async () =>
        jsonResponse({
          ...envelopeBody,
          data: { ...FALLBACK_CONFIG, productName: 'VeriName', rootName: 'veriname.eth' },
        })) as unknown as typeof fetch,
    });
    expect(config.productName).toBe('VeriName');
    expect(config.rootName).toBe('veriname.eth');
  });
});

/**
 * Where the site sends its requests. The first version baked an absolute
 * gateway hostname into the browser bundle, so when that DNS record briefly
 * disappeared the pages still loaded while every button failed.
 */
describe('apiBaseUrl', () => {
  const original = process.env.MUSENAME_API_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.MUSENAME_API_URL;
    else process.env.MUSENAME_API_URL = original;
    delete (globalThis as { window?: unknown }).window;
  });

  it('uses the origin the page was served from, in the browser', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(apiBaseUrl()).toBe('');
  });

  it('talks to the API directly from the server', () => {
    process.env.MUSENAME_API_URL = 'http://127.0.0.1:8801/';
    expect(apiBaseUrl()).toBe('http://127.0.0.1:8801');
  });
});
