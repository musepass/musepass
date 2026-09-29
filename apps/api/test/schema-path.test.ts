import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSchemaSql, schemaCandidates } from '../src/repositories/sql.js';

describe('schema file resolution', () => {
  it('finds the schema in the repository layout', () => {
    expect(readSchemaSql()).toMatch(/create table if not exists names/i);
  });

  it('tries the bundled layout as well, for a single-file deployment', () => {
    const candidates = schemaCandidates();
    expect(candidates.some((candidate) => candidate.endsWith('001_init.sql'))).toBe(true);
    // The bundle runs next to a sql/ directory on the server; that path is one of
    // the candidates, which is why the deployment does not need to export an env var.
    expect(candidates.some((candidate) => /sql[/\\]001_init\.sql$/.test(candidate))).toBe(true);
  });

  it('explains itself when it cannot find the schema instead of throwing ENOENT', () => {
    expect(() => readSchemaSql(['/definitely/not/here/001_init.sql'])).toThrow(/MUSENAME_SCHEMA_FILE/);
  });

  it('prefers an explicit path when one is given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'musename-schema-'));
    const file = join(dir, 'custom.sql');
    writeFileSync(file, 'SELECT 1;\n');
    expect(readSchemaSql([file])).toBe('SELECT 1;\n');
  });
});
