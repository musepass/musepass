import { describe, expect, it } from 'vitest';
import { buildReservedIndex, checkReserved, reservedCount } from '../src/reserved.js';
import { testConfig, testReservedIndex } from './helpers.js';

const config = testConfig();
const index = testReservedIndex(config);

describe('reserved list', () => {
  it('loads every category from config', () => {
    expect(Object.keys(config.reserved.categories).sort()).toEqual([
      'brand',
      'platform',
      'public_figure',
      'sensitive',
      'system',
    ]);
    expect(reservedCount(index)).toBeGreaterThan(50);
  });

  it('flags system words exactly', () => {
    expect(checkReserved('admin', index, config.reserved)?.category).toBe('system');
    expect(checkReserved('support', index, config.reserved)?.category).toBe('system');
    expect(checkReserved('official', index, config.reserved)?.category).toBe('system');
  });

  it('flags system words through a prefix pattern', () => {
    const hit = checkReserved('admin123', index, config.reserved);
    expect(hit?.category).toBe('system');
    expect(hit?.matched).toBe('admin*');
  });

  it('flags platform names', () => {
    expect(checkReserved('meta', index, config.reserved)?.category).toBe('platform');
    expect(checkReserved('muse', index, config.reserved)?.category).toBe('system');
    expect(checkReserved('namestone', index, config.reserved)?.category).toBe('platform');
  });

  it('flags our own brand and brand variants', () => {
    expect(checkReserved('musename', index, config.reserved)?.category).toBe('brand');
    const variant = checkReserved('musename2026', index, config.reserved);
    expect(variant?.reserved).toBe(true);
    expect(variant?.category).toBe('brand');
  });

  it('flags digit-substituted brand spoofs via the folded pass', () => {
    const hit = checkReserved('g00gle', index, config.reserved);
    expect(hit?.category).toBe('platform');
    expect(hit?.matched).toBe('google');
    expect(hit?.note).toContain('confusable');
  });

  it('flags ambiguous digit spoofs of system words', () => {
    const hit = checkReserved('adm1n', index, config.reserved);
    expect(hit?.category).toBe('system');
    expect(hit?.matched).toBe('admin');
  });

  it('flags letter-pair spoofs via the folded pass', () => {
    const hit = checkReserved('rneta', index, config.reserved);
    expect(hit?.category).toBe('platform');
  });

  it('lets an ordinary name through', () => {
    expect(checkReserved('aguang', index, config.reserved)).toBeNull();
    expect(checkReserved('阿光', index, config.reserved)).toBeNull();
    expect(checkReserved('photo-studio', index, config.reserved)).toBeNull();
  });

  it('reports the appeal channel so a rejection can be actionable', () => {
    const hit = checkReserved('admin', index, config.reserved);
    expect(hit?.appealable).toBe(true);
    expect(hit?.appealChannel).toBe(config.reserved.appeal?.channel);
  });

  it('handles an empty reserved config without crashing', () => {
    const empty = buildReservedIndex({ version: 1, categories: {} });
    expect(checkReserved('anything', empty)).toBeNull();
    expect(reservedCount(empty)).toBe(0);
  });
});
