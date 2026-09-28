import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type MusenameConfig } from '../src/config.js';
import { buildReservedIndex, type ReservedIndex } from '../src/reserved.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The real repository config, never a fixture copy, so tests fail if config breaks. */
export const CONFIG_DIR = resolve(here, '../../../config');

export function testConfig(env: Record<string, string | undefined> = {}): MusenameConfig {
  return loadConfig({ configDir: CONFIG_DIR, env });
}

export function testReservedIndex(config: MusenameConfig = testConfig()): ReservedIndex {
  return buildReservedIndex(config.reserved);
}
