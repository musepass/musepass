import type { Address } from 'viem';
import type { ChainReader, MusenameDeps } from './deps.js';
import type { Logger } from './observability.js';

/**
 * Chain is the source of truth; the database is an index.
 *
 * This walks the names we have indexed, asks the chain who owns each one, and
 * repairs the row when they disagree. It never writes to the chain — a
 * disagreement means our index is wrong, not the registry.
 *
 * What it deliberately does not do: discover names that exist on chain but are
 * missing from the index. That needs event indexing (watching
 * `SubnodeCreated`), which is a different piece of work; pretending otherwise
 * would make this look more complete than it is. See docs/status.md.
 */

export interface ReconcileIssue {
  normalized: string;
  kind: 'owner-changed' | 'missing-on-chain' | 'unreadable';
  detail: string;
}

export interface ReconcileResult {
  checked: number;
  /** Rows whose owner address differed from the chain and were corrected. */
  repaired: number;
  issues: ReconcileIssue[];
}

export interface ReconcileOptions {
  names: MusenameDeps['names'];
  chain: ChainReader;
  logger?: Logger;
  /** Calls the chain this many at a time, to be gentle with the RPC. */
  concurrency?: number;
  /** Cap for one run, so a first run against a big index stays predictable. */
  limit?: number;
}

async function inBatches<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(run));
  }
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { names, chain } = options;
  const logger = options.logger;
  const concurrency = options.concurrency ?? 4;

  const all = await names.listAll();
  const rows = options.limit ? all.slice(0, options.limit) : all;
  const result: ReconcileResult = { checked: 0, repaired: 0, issues: [] };

  await inBatches(rows, concurrency, async (row) => {
    result.checked += 1;
    let chainOwner: Address | null;
    try {
      chainOwner = await chain.getOwner(row.normalized);
    } catch (error) {
      result.issues.push({
        normalized: row.normalized,
        kind: 'unreadable',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!chainOwner) {
      // The L2 registry has no burn and no admin transfer, so a name we issued
      // having no owner means the index is pointing at something that is not
      // there. Report it rather than quietly deleting the row.
      result.issues.push({
        normalized: row.normalized,
        kind: 'missing-on-chain',
        detail: `indexed as owned by ${row.ownerAddress}, chain says nobody owns it`,
      });
      logger?.log('error', 'reconcile: indexed name has no on-chain owner', {
        normalized: row.normalized,
        indexedOwner: row.ownerAddress,
      });
      return;
    }

    if (chainOwner.toLowerCase() === row.ownerAddress.toLowerCase()) return;

    // Chain wins. Re-index under the new owner.
    await names.updateOwner(row.normalized, chainOwner);
    result.repaired += 1;
    result.issues.push({
      normalized: row.normalized,
      kind: 'owner-changed',
      detail: `${row.ownerAddress} -> ${chainOwner}`,
    });
    logger?.log('warn', 'reconcile: repaired an owner mismatch', {
      normalized: row.normalized,
      from: row.ownerAddress,
      to: chainOwner,
    });
  });

  logger?.log('info', 'reconcile finished', {
    checked: result.checked,
    repaired: result.repaired,
    issues: result.issues.length,
  });
  return result;
}
