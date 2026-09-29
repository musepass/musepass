import { describe, expect, it } from 'vitest';
import {
  extractSecretCandidates,
  findNetworkLeaks,
  findSecretLeaks,
  isTestPath,
  scanForLeaks,
  violationsOnly,
} from '../src/hygiene.js';

const PRIVATE_KEY = `0x${'ab'.repeat(32)}`;

describe('hygiene scan', () => {
  it('finds the internal address a log leaked', () => {
    const leaks = findNetworkLeaks('.web.log', '- Network:       http://192.168.1.77:3103');
    expect(leaks).toHaveLength(1);
    expect(leaks[0].kind).toBe('private-ipv4');
    expect(leaks[0].value).toBe('192.168.1.77');
    expect(leaks[0].benign).toBe(false);
  });

  it('leaves the loopback we use on purpose alone', () => {
    const leaks = findNetworkLeaks('scripts/verify-local.sh', 'curl http://127.0.0.1:8801/healthz');
    expect(leaks).toHaveLength(0);
  });

  it('drops a match whose octets cannot exist', () => {
    expect(findNetworkLeaks('docs/x.md', 'build 192.168.999.1')).toHaveLength(0);
  });

  it('finds the other private ranges and machine-local hostnames', () => {
    const leaks = findNetworkLeaks('docs/x.md', 'a 10.0.0.5 b 172.16.4.4 c box.internal d host.local');
    expect(leaks.map((leak) => leak.value)).toEqual([
      '10.0.0.5',
      '172.16.4.4',
      'box.internal',
      'host.local',
    ]);
  });

  it('does not mistake a version number or a package name for an address', () => {
    const leaks = findNetworkLeaks('pnpm-lock.yaml', 'ip-address@10.7.2:\n  engines: node >=11.0.0');
    expect(leaks).toHaveLength(0);
  });

  it('flags an operator home path but not inside a test fixture', () => {
    expect(findNetworkLeaks('docs/x.md', 'see /Users/operator/Documents/x')).toHaveLength(1);
    expect(findNetworkLeaks('apps/mcp/test/rateLimit.test.ts', 'const p = "/Users/x/y"')).toHaveLength(0);
  });

  it('treats a fake address in a test as benign, and still reports it', () => {
    const leaks = findNetworkLeaks('apps/mcp/test/rateLimit.test.ts', "'x-forwarded-for': '9.9.9.9, 10.0.0.1'");
    expect(leaks).toHaveLength(1);
    expect(leaks[0].benign).toBe(true);
    expect(violationsOnly(leaks)).toHaveLength(0);
    expect(isTestPath('apps/mcp/test/rateLimit.test.ts')).toBe(true);
  });

  it('reads a private key out of a secrets file', () => {
    const candidates = extractSecretCandidates([`deployer=${PRIVATE_KEY}\n`]);
    expect(candidates).toEqual([PRIVATE_KEY]);
  });

  it('does not treat a published transaction hash as a secret', () => {
    const candidates = extractSecretCandidates([`tx=${'cd'.repeat(32)}\n`]);
    expect(candidates).toHaveLength(0);
  });

  it('reads an api-shaped credential of any alphabet', () => {
    const token = 'dyn_OynojbmUBHxubRoRJvtFFFHxPPxmx8Acx9cHSGim3jDUjxdIUG4w4gj2';
    expect(extractSecretCandidates([`DYNAMIC_AUTH_TOKEN=${token}`])).toEqual([token]);
  });

  it('catches a key that was pasted into a tracked file', () => {
    const leaks = findSecretLeaks('apps/api/src/deps.ts', `const key = '${PRIVATE_KEY}';`, [PRIVATE_KEY]);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].kind).toBe('secret');
    expect(leaks[0].text).not.toContain(PRIVATE_KEY);
    expect(leaks[0].value).toContain('0xabab');
  });

  it('combines both halves in one pass', () => {
    const leaks = scanForLeaks('README.md', `see ${PRIVATE_KEY} at 10.1.2.3`, [PRIVATE_KEY]);
    expect(leaks.map((leak) => leak.kind).sort()).toEqual(['private-ipv4', 'secret']);
  });
});
