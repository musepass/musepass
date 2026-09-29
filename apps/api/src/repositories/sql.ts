import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The smallest database surface the repositories need.
 *
 * Both `pg` (a real server) and PGlite (Postgres in WebAssembly, used by the
 * tests) satisfy it, so the repository code and the tests run against the same
 * SQL rather than against a hand written fake.
 */
export interface Sql {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the schema lives depends on how this code is running: from `src` under
 * tsx, from `dist` after tsc, or from a single bundled `api.mjs` sitting next to
 * a `sql/` directory. Guessing one layout and failing on the others is how a
 * deployment ends up unable to start, so all three are tried and the env var
 * wins over all of them.
 */
export function schemaCandidates(): string[] {
  return [
    process.env.MUSENAME_SCHEMA_FILE ?? '',
    resolve(here, '..', '..', 'sql', '001_init.sql'),
    resolve(here, 'sql', '001_init.sql'),
  ].filter((candidate) => candidate.length > 0);
}

export function readSchemaSql(candidates: string[] = schemaCandidates()): string {
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    `cannot find the schema file (tried ${candidates.join(', ')}); set MUSENAME_SCHEMA_FILE to its path`,
  );
}

/**
 * Applies the schema. `CREATE TABLE IF NOT EXISTS` everywhere makes this
 * idempotent, so it doubles as the migration step for a fresh database and as a
 * no-op on every boot.
 */
export async function migrate(sql: Sql): Promise<void> {
  const schema = readSchemaSql();
  // Split on statement boundaries. The file has no dollar-quoted bodies, so a
  // plain split is safe, and comment lines are stripped from every chunk rather
  // than used to skip it — the file opens with comments, so skipping would
  // silently drop the first table.
  const statements = schema
    .split(/;\s*$/m)
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await sql.query(statement);
  }
}
