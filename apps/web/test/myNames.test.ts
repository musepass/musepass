/**
 * The "my names" list is a chain read, not an account feature — anybody can ask
 * the same question about any address. These tests pin the two things that would
 * make it lie: the query it builds, and what it shows when the answer is empty.
 */
import { describe, expect, it, vi } from 'vitest';

import { fetchOwnedNames } from '../lib/api';

const envelope = (data: unknown) => ({
  summary: { zh: '(unused)', en: 'ok' },
  data,
  errors: [],
  meta: { asOf: 'now', chain: 'robinhood', chainId: 4663, verified: true, root: 'musename.eth' },
});

describe('fetchOwnedNames', () => {
  it('asks the API for the names of one address', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify(
          envelope({ owner: '0xAbC', count: 1, names: [{ label: 'peter', fullName: 'peter.musename.eth' }], rootName: 'musename.eth' }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const payload = await fetchOwnedNames('0xAbC', { fetchImpl });
    expect(calls[0]).toContain('/v1/names?owner=0xAbC');
    expect(payload.data.count).toBe(1);
    expect(payload.data.names[0]?.fullName).toBe('peter.musename.eth');
  });

  it('surfaces an empty list as an empty list, not an error', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(envelope({ owner: '0x0', count: 0, names: [], rootName: 'musename.eth' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const payload = await fetchOwnedNames('0x0', { fetchImpl });
    expect(payload.data.names).toEqual([]);
  });
});
