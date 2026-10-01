#!/usr/bin/env node
/**
 * Export every name the registry knows, with a hash anyone can compare.
 *
 *   node scripts/name-snapshot.mjs                 # print, and write to snapshots/
 *   node scripts/name-snapshot.mjs --json          # machine readable
 *   node scripts/name-snapshot.mjs --out /tmp/x    # somewhere else
 *
 * Why: `docs/trust-model.md` says the chain is the source of truth, but the
 * names only exist there. If the RPC or the chain disappears, nobody can prove
 * what the list was. So once a day this writes `names.json` and
 * `names.sha256`; publishing the hash (a tweet, a DNS TXT record, a commit) is
 * what makes yesterday's list checkable today.
 *
 * The list is read from the chain, not from our database:
 *   1. walk back through the registrar's history in chunks until the events
 *      stop appearing (this chain's block numbers are far apart and its public
 *      RPC refuses historical `eth_getCode`, so a binary search is not an
 *      option; the walk says exactly where it stopped),
 *   2. read the NameRegistered events it found,
 *   3. for each event, re-read the registry to confirm the name still belongs
 *      to the same owner — an event is a claim, the registry is the truth.
 *
 * Names minted by some later registrar would not appear here. The script says
 * so in the output (`coverage`) rather than pretending the list is complete,
 * and `security-power-inventory.mjs` is what watches for a second registrar.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbiItem,
  toEventSelector,
} from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const asJson = process.argv.includes('--json');
const outIndex = process.argv.indexOf('--out');
const outDir = resolve(outIndex === -1 ? resolve(repoRoot, 'snapshots') : process.argv[outIndex + 1]);
const rpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';

// Addresses come from config/chains.json, the same file the API serves, so this
// script cannot keep snapshotting a registry the product stopped writing to —
// which is what it did after the 2026-09-30 rename to musepass.eth.
const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));
const brand = JSON.parse(readFileSync(resolve(repoRoot, 'config/brand.json'), 'utf8'));
const CHAIN_ID = chains.l2.chainId;
const REGISTRY = getAddress(chains.l2.l2Registry);
const REGISTRAR = getAddress(chains.l2.registrar);
const ROOT_NAME = brand.rootName;
const PREVIOUS_ROOT = chains.l2.previousRoot ?? null;

const NAME_REGISTERED = parseAbiItem(
  'event NameRegistered(bytes32 indexed node, string label, address indexed owner)',
);
const OWNER_ABI = [
  parseAbiItem('function owner(bytes32 node) view returns (address)'),
  parseAbiItem('function text(bytes32 node, string key) view returns (string)'),
];

// The real on-chain key is `musename.card` (CARD_TEXT_KEY in packages/core):
// frozen from the MuseName era, part of every signed card payload.
const CARD_KEY = 'musename.card';

const client = createPublicClient({ transport: http(rpcUrl) });


function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

const CHUNK = 1_000_000n;
const MAX_CHUNKS = Number(process.env.MUSENAME_SNAPSHOT_MAX_CHUNKS ?? 150);
const EMPTY_CHUNKS_TO_STOP = 3;

async function fetchLogs(fromBlock, toBlock) {
  try {
    return await client.getLogs({ address: REGISTRAR, event: NAME_REGISTERED, fromBlock, toBlock });
  } catch {
    // Some endpoints dislike the ABI form; the topic filter is the same query.
    return await client.getLogs({
      address: REGISTRAR,
      topics: [toEventSelector(NAME_REGISTERED)],
      fromBlock,
      toBlock,
    });
  }
}

const head = await client.getBlockNumber();
let toBlock = head;
let fromBlock = toBlock - CHUNK + 1n > 0n ? toBlock - CHUNK + 1n : 0n;
const logs = [];
let chunks = 0;
let emptyChunks = 0;
while (chunks < MAX_CHUNKS && toBlock >= 0n) {
  chunks += 1;
  const found = await fetchLogs(fromBlock, toBlock);
  if (found.length === 0) {
    emptyChunks += 1;
    if (emptyChunks >= EMPTY_CHUNKS_TO_STOP) break;
  } else {
    emptyChunks = 0;
    logs.push(...found);
  }
  if (fromBlock === 0n) break;
  toBlock = fromBlock - 1n;
  fromBlock = toBlock - CHUNK + 1n > 0n ? toBlock - CHUNK + 1n : 0n;
}

const earliestLogBlock = logs.length > 0 ? logs.reduce((min, log) => (log.blockNumber < min ? log.blockNumber : min), logs[0].blockNumber) : null;

const names = [];
for (const log of logs) {
  const decoded = (() => {
    try {
      return decodeEventLog({ abi: [NAME_REGISTERED], data: log.data, topics: log.topics });
    } catch {
      return null;
    }
  })();
  if (!decoded) continue;
  const { node, label, owner } = decoded.args;

  // The event is the claim; the registry is the truth. If they disagree, the
  // name moved after minting and the current owner is the one that counts.
  const currentOwner = await client.readContract({
    address: REGISTRY,
    abi: OWNER_ABI,
    functionName: 'owner',
    args: [node],
  });
  const card = await client
    .readContract({ address: REGISTRY, abi: OWNER_ABI, functionName: 'text', args: [node, CARD_KEY] })
    .catch(() => '');

  names.push({
    name: `${label}.${ROOT_NAME}`,
    label,
    node,
    ownerAtMint: getAddress(owner),
    ownerNow: currentOwner === '0x0000000000000000000000000000000000000000' ? null : getAddress(currentOwner),
    mintedInBlock: Number(log.blockNumber),
    mintTx: log.transactionHash,
    hasCard: card.length > 0,
    cardBytes: card.length,
  });
}

names.sort((a, b) => a.name.localeCompare(b.name));

const snapshot = {
  $comment:
    'Read from the chain, not from our database. Compare sha256(names.json) with the published hash. See docs/trust-model.md.',
  generatedAt: new Date().toISOString(),
  chainId: CHAIN_ID,
  rpc: rpcUrl,
  scan: {
    lastBlock: Number(head),
    chunkBlocks: Number(CHUNK),
    chunksScanned: chunks,
    emptyChunksAtStop: emptyChunks,
    earliestEventBlock: earliestLogBlock === null ? null : Number(earliestLogBlock),
    howToRead:
      'Events were read newest-first in chunks. The scan stopped after this many consecutive chunks with no events, so a name minted before that point would be missed — and the count is printed instead of assumed.',
  },
  registry: REGISTRY,
  registrar: REGISTRAR,
  rootName: ROOT_NAME,
  previousRoot: PREVIOUS_ROOT,
  coverage:
    'Names minted through this registrar. A name created by a different registrar would not appear; security-power-inventory.mjs is what watches for one. Names minted under the earlier root (previousRoot above) are in that registry, not this one.',
  count: names.length,
  names,
};

// Pretty-printed with a stable key order, because the hash is the product.
const body = `${JSON.stringify(snapshot, null, 2)}\n`;
const digest = sha256(body);

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const jsonPath = resolve(outDir, `names-${stamp}.json`);
const hashPath = resolve(outDir, `names-${stamp}.sha256`);
writeFileSync(jsonPath, body);
writeFileSync(hashPath, `${digest}  names-${stamp}.json\n`);

if (asJson) {
  console.log(JSON.stringify({ ...snapshot, sha256: digest, written: [jsonPath, hashPath] }, null, 2));
} else {
  console.log(`name snapshot · chain ${CHAIN_ID}`);
  console.log(`  registrar ${REGISTRAR}`);
  console.log(`  scanned ${chunks} chunk(s) of ${CHUNK} blocks back from ${head}`);
  console.log(`  earliest event block: ${earliestLogBlock ?? 'none'}`);
  console.log(`  names: ${names.length}`);
  for (const entry of names) {
    const moved = entry.ownerNow && entry.ownerNow !== entry.ownerAtMint ? ' (owner changed since mint)' : '';
    console.log(
      `    ${entry.name.padEnd(28)} ${entry.ownerNow ?? 'burned'}${entry.hasCard ? ' · card' : ''}${moved}`,
    );
  }
  console.log('');
  console.log(`  wrote ${jsonPath}`);
  console.log(`  wrote ${hashPath}`);
  console.log(`  sha256 ${digest}`);
  console.log('');
  console.log('  publish this hash (tweet, DNS TXT, commit message) so yesterday can be checked.');
}
