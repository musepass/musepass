#!/usr/bin/env node
/**
 * One command that answers "is the thing that is supposed to work still
 * working?", from outside, the way a stranger would check it.
 *
 *   node scripts/health-report.mjs            # human readable
 *   node scripts/health-report.mjs --json     # for a monitor or a webhook
 *
 * Exit code 0 when every hard check passes, 1 otherwise, so a cron job can
 * alert on the exit code even before there is anywhere to send an alert.
 *
 * What it deliberately does not check: anything that needs a private key or
 * shell access to the host. If a check cannot be made from the outside, it is
 * not in here pretending to be one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect as tlsConnect } from 'node:tls';

import { createPublicClient, http, namehash, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { getEnsAddress } from 'viem/ens';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
// Paths are overridable so the same bundle can run from the server, where the
// repository is not checked out.
const configDir = process.env.MUSENAME_CONFIG_DIR ?? resolve(repoRoot, 'config');
const anchorsFile =
  process.env.MUSENAME_ANCHORS_FILE ?? resolve(repoRoot, 'deployments/receipt-anchors.json');
const chains = JSON.parse(readFileSync(resolve(configDir, 'chains.json'), 'utf8'));
// The canonical site is whatever config says it is. Hardcoding it here meant a
// domain change left the monitor watching the domain the product used to be on,
// which reports "all good" while the new one is broken.
const brand = JSON.parse(readFileSync(resolve(configDir, 'brand.json'), 'utf8'));

// The canary for "a name really resolves in a wallet". It has to be a name that
// exists under the root the product uses today: the previous canary was minted
// under the earlier root, so it reported a failure while resolution was working
// — the worst kind of monitor, one that lies in the direction of alarm fatigue.
const NAME = 'peter.musepass.eth';
const EXPECTED_ADDRESS = '0x2d319F9159e11ab729DFD510023E07e2C609BeF4';
const RESOLVER = '0x9eA7A8896a68717e587BC1EE17B6b0B80EEeb443';
const SPONSOR = '0x66F499e8F0A92e44A0F9c59a305E73a12b5684e7';
const MIN_SPONSOR_ETH = 0.0002;
const MAX_ANCHOR_AGE_DAYS = 2;

const checks = [];
const record = (name, ok, detail, hard = true) => {
  checks.push({ name, ok, detail, hard });
  const mark = ok ? 'ok  ' : hard ? 'FAIL' : 'warn';
  console.log(`${mark} ${name.padEnd(38)} ${detail}`);
};

async function httpStatus(url, init) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    return { status: response.status, ms: Date.now() - started, body: response };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error.message ?? error) };
  }
}

function tlsDaysLeft(host) {
  return new Promise((done) => {
    const socket = tlsConnect({ host, port: 443, servername: host, timeout: 10000 }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const expires = new Date(certificate.valid_to).getTime();
      done(Number.isNaN(expires) ? null : Math.round((expires - Date.now()) / 86_400_000));
    });
    socket.on('error', () => done(null));
    socket.on('timeout', () => {
      socket.destroy();
      done(null);
    });
  });
}

// The gateway host is not config: it is baked into the L1 resolver's constructor
// arguments and cannot move without redeploying the resolver.
const GATEWAY = 'https://gw.musename.xyz';
const SITE = String(brand.siteUrl).replace(/\/$/, '');

// 1. The public surfaces answer.
for (const [label, url] of [
  ['gateway healthz', `${GATEWAY}/healthz`],
  ['site home', `${SITE}/`],
  ['api config', `${SITE}/v1/config`],
  ['verify page', `${SITE}/verify`],
]) {
  const result = await httpStatus(url);
  record(label, result.status === 200, result.status === 200 ? `${result.ms}ms` : `HTTP ${result.status} ${result.error ?? ''}`);
}

// 2. The gateway still speaks for the right chain and signer.
{
  const result = await httpStatus(`${GATEWAY}/healthz`);
  const body = result.body ? await result.body.json().catch(() => null) : null;
  const signerOk = body?.signer?.toLowerCase() === '0x47f471f726ee612cc769bc0b03f5482fa2ae1f1e';
  record('gateway signer', signerOk, body?.signer ?? 'no body');
  const allowed = body?.allowedSenders ?? [];
  record(
    'gateway allow list is pinned',
    allowed.length > 0 && allowed.length <= 3,
    allowed.join(', ') || 'empty — signs for any resolver',
    false,
  );
}

// 3. MCP answers a real initialize over HTTPS.
{
  const result = await httpStatus(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'health-report', version: '1' } },
    }),
  });
  record('mcp initialize', result.status === 200, `HTTP ${result.status}`);
}

// 4. Certificates are not about to expire.
for (const host of [new URL(SITE).host, 'gw.musename.xyz']) {
  const days = await tlsDaysLeft(host);
  record(`tls ${host}`, days !== null && days > 21, days === null ? 'could not read' : `${days} days left`, days !== null && days < 0);
}

// 5. The product's actual promise: the name resolves, through the right resolver.
{
  const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
  const ens = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
  const abi = parseAbi([
    'function resolver(bytes32) view returns (address)',
    'function l2Registry(bytes32) view returns (uint64, address)',
  ]);
  const node = namehash('musepass.eth');
  let resolved = false;
  try {
    const resolver = await client.readContract({ address: ens, abi, functionName: 'resolver', args: [node] });
    record('root resolver is ours', resolver.toLowerCase() === RESOLVER.toLowerCase(), resolver);
    const [chainId, registry] = await client.readContract({
      address: RESOLVER,
      abi,
      functionName: 'l2Registry',
      args: [node],
    });
    record(
      'resolver points at the L2 registry',
      Number(chainId) === chains.l2.chainId && registry.toLowerCase() === chains.l2.l2Registry.toLowerCase(),
      `${chainId} ${registry}`,
    );
    // A public mainnet node occasionally takes longer than the timeout while it
    // walks the CCIP-Read round trip. On a 5-minute cadence that would report a
    // failure for nothing, so one retry is allowed — and the detail says so,
    // which keeps a genuinely slow path visible instead of silently green.
    let address;
    let retried = false;
    try {
      address = await getEnsAddress(client, { name: NAME });
    } catch {
      retried = true;
      address = await getEnsAddress(client, { name: NAME });
    }
    record(
      'name resolves',
      address?.toLowerCase() === EXPECTED_ADDRESS.toLowerCase(),
      retried ? `${address ?? 'null'} (slow: second attempt)` : address ?? 'null',
    );
    resolved = true;
  } catch (error) {
    if (!resolved) {
      record('resolution path', false, (error.shortMessage ?? error.message ?? '').split('\n')[0].slice(0, 60));
    }
  }
}

// 6. The sponsorship wallet can still pay for registrations.
for (const [label, rpc, chain] of [
  ['sponsor balance (robinhood)', chains.l2.rpcDefault, chains.l2.chainId],
  ['sponsor balance (mainnet)', 'https://ethereum-rpc.publicnode.com', 1],
]) {
  try {
    const client = createPublicClient({
      chain: { id: chain, name: label, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } },
      transport: http(rpc),
    });
    const balance = Number(await client.getBalance({ address: SPONSOR })) / 1e18;
    const enough = chain === chains.l2.chainId ? balance > MIN_SPONSOR_ETH : true;
    record(label, enough, `${balance.toFixed(6)} ETH`, chain === chains.l2.chainId);
  } catch (error) {
    record(label, false, String(error.message ?? error).slice(0, 50), chain === chains.l2.chainId);
  }
}

// 7. Anchoring has not silently stopped.
{
  const ledger = JSON.parse(readFileSync(anchorsFile, 'utf8'));
  const latest = ledger.at(-1);
  const ageDays = latest ? (Date.now() / 1000 - latest.anchoredAt) / 86_400 : Infinity;
  record(
    'latest receipt anchor',
    Number.isFinite(ageDays),
    latest ? `${Math.floor(ageDays)} days old, ${latest.count} records` : 'none',
    // Not hard yet: anchoring is manual until there are receipts to anchor.
    ageDays > MAX_ANCHOR_AGE_DAYS,
  );
}

const failures = checks.filter((check) => !check.ok && check.hard);

/**
 * Run every five minutes without becoming noise.
 *
 * `--state-file <path>` remembers the previous verdict, so the report announces
 * only *changes*: a service goes down, or comes back. That is what makes a
 * 5-minute cadence useful instead of 288 journal lines a day, and it is also
 * what a webhook wants — one message per incident, not one per check.
 */
const stateIndex = process.argv.indexOf('--state-file');
const statePath = stateIndex === -1 ? null : process.argv[stateIndex + 1];
const verdict = failures.length === 0 ? 'ok' : `failing:${failures.map((check) => check.name).join(',')}`;
let previous = null;
if (statePath) {
  try {
    previous = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    previous = null;
  }
}
const changed = statePath !== null && previous?.verdict !== verdict;
if (statePath) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify({ verdict, checkedAt: new Date().toISOString(), previous: previous?.verdict ?? null }, null, 2)}\n`,
    );
  } catch (error) {
    console.log(`could not write the state file: ${String(error.message ?? error).slice(0, 60)}`);
  }
  console.log(
    changed
      ? `state changed: ${previous?.verdict ?? '(first run)'} -> ${verdict}`
      : `state unchanged: ${verdict}`,
  );
}

// If a webhook is configured, that is where a failing report goes — and only when
// the verdict changes, so a long outage sends one message and the recovery sends
// another. Without a webhook the exit code and the journal entry are all there is,
// which is why the runbook says to wire one up.
//
// Two payload shapes, because the two things people actually use differ: a
// generic webhook (Slack, Feishu, anything taking {"text": ...}) and Telegram,
// whose Bot API wants {"chat_id", "text"} at a URL that already carries the bot
// token. Guessing wrong sends a message nobody sees and reports success, so the
// shape is chosen from the URL.
const webhook = process.env.MUSENAME_ALERT_WEBHOOK;
const shouldAlert =
  failures.length > 0
    ? statePath
      ? changed
      : true
    : statePath !== null && changed && previous?.verdict?.startsWith('failing');

async function sendAlert(text) {
  if (!webhook) return false;
  const telegram = /api\.telegram\.org\/bot[^/]+\/sendMessage/.test(webhook);
  const body = telegram
    ? {
        chat_id:
          process.env.MUSENAME_ALERT_TELEGRAM_CHAT_ID ??
          new URL(webhook).searchParams.get('chat_id') ??
          '',
        text,
        disable_web_page_preview: true,
      }
    : { text, checks };
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const detail = await response.text().catch(() => '');
    if (!response.ok) {
      console.log(`the alert endpoint answered ${response.status}: ${detail.slice(0, 160)}`);
      return false;
    }
    console.log('alert sent to the configured webhook');
    return true;
  } catch (error) {
    console.log(`could not reach the alert webhook: ${String(error.message ?? error).slice(0, 80)}`);
    return false;
  }
}

if (shouldAlert) {
  await sendAlert(
    failures.length > 0
      ? `MusePass health: ${failures.length} failing — ${failures.map((check) => check.name).join(', ')}`
      : `MusePass health: recovered (was ${previous?.verdict})`,
  );
}

// `--test-alert` proves the wiring instead of assuming it: whoever set the webhook
// up should watch a message arrive, and a wrong payload shape fails here rather
// than silently during an outage.
if (process.argv.includes('--test-alert')) {
  const sent = await sendAlert(
    `MusePass health check: test alert. ${checks.length - failures.length}/${checks.length} checks passing.`,
  );
  if (!sent) {
    console.error('test alert NOT delivered (no webhook set, or the endpoint refused it)');
    process.exit(1);
  }
  console.log('test alert delivered');
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks, failures: failures.length }, null, 2));
}
console.log('');
console.log(`${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length > 0) console.log(`failing: ${failures.map((check) => check.name).join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
