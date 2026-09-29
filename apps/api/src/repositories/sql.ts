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

export function readSchemaSql(): string {
  return readFileSync(resolve(here, '..', '..', 'sql', '001_init.sql'), 'utf8');
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
