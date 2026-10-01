#!/usr/bin/env node
/**
 * Browser smoke test for the two wallet paths on the live site:
 *
 *   1. X sign-in — opens the Privy modal and screenshots it (the X OAuth step
 *      itself needs a human's X account, so it stops there).
 *   2. Injected wallet — a mock window.ethereum backed by a deterministic key
 *      signs a REAL claim end to end: connect → switch to 4663 → EIP-712
 *      signature → API → sponsored on-chain registration. Costs one claim of
 *      sponsor gas, same as the tst1–tst3 names did.
 *
 * Usage: node scripts/e2e-wallet-login-smoke.mjs [https://musepass.xyz]
 *
 * Chrome is spawned via `arch -arm64` (see memory: the x64 slice under Rosetta
 * stalls module loads) and driven over --remote-debugging-pipe, because Chrome
 * 153 headless ignores --remote-debugging-port entirely.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Wallet } = require('ethers');

const SITE = process.argv[2] ?? 'https://musepass.xyz';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A fresh key per run: the claim is gas-sponsored, so the owner is just
// whoever signs — no need for a fixed test account.
const wallet = new Wallet(Wallet.createRandom().privateKey);
const OWNER = wallet.address;
const LABEL = `qa${String(Date.now()).slice(-5)}`; // 7 chars → free tier

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------- CDP plumbing */
class CDP {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.sessions = new Set();
    this.buffer = '';
  }
  attach(child) {
    this.writable = child.stdio[3];
    this.readable = child.stdio[4];
    this.readable.setEncoding('utf8');
    this.readable.on('data', (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf('\0')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== undefined && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        } else {
          this.event?.(message);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.writable.write(JSON.stringify(payload) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const cdp = new CDP();
const consoleErrors = [];

async function evaluate(sessionId, expression) {
  const out = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (out.exceptionDetails) {
    throw new Error(`page eval failed: ${out.exceptionDetails.text} ${
      out.exceptionDetails.exception?.description ?? ''
    }`);
  }
  return out.result.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newTab(url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  cdp.event = (message) => {
    if (message.sessionId !== sessionId || message.method !== 'Runtime.consoleAPICalled') return;
    if (message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(4000); // load + hydration
  return sessionId;
}

async function screenshot(sessionId, path) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(path, Buffer.from(data, 'base64'));
}

/* ------------------------------------------------------------ mock provider */
const MOCK_ETHEREUM = `(() => {
  const ADDR = '${OWNER}';
  let chainId = '0x1'; // deliberately wrong, to exercise the switch step
  const listeners = {};
  window.__E2E_ADDR = ADDR;
  window.ethereum = {
    isMetaMask: true,
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; return null; }
      if (method === 'wallet_addEthereumChain') { chainId = '0x123f'; return null; }
      if (method === 'eth_signTypedData_v4') {
        window.__E2E_TYPED_DATA = params[1];
        return new Promise((resolve) => { window.__E2E_RESOLVE = resolve; });
      }
      throw new Error('e2e mock: unsupported ' + method);
    },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
  };
})();`;

/* --------------------------------------------------------------------- main */
const chrome = spawn(
  'arch',
  [
    '-arm64', CHROME,
    '--headless=new',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
cdp.attach(chrome);
await sleep(2000);

let failures = 0;
try {
  /* 1 — the claim page offers both entry points, and the Privy modal opens. */
  const tabX = await newTab(`${SITE}/claim`);
  const texts = await evaluate(
    tabX,
    `Array.from(document.querySelectorAll('button, a.btn')).map((el) => el.textContent.trim())`,
  );
  check('claim page shows "Continue with X"', texts.some((t) => /Continue with X/.test(t)));
  check('claim page shows "Connect wallet"', texts.some((t) => /Connect wallet/.test(t)));

  await evaluate(
    tabX,
    `Array.from(document.querySelectorAll('button')).find((b) => /Continue with X/.test(b.textContent))?.click(); true`,
  );
  await sleep(5000); // the Privy iframe takes a moment
  await screenshot(tabX, '/tmp/mp-e2e-x-modal.png');
  const modalFrame = await evaluate(
    tabX,
    `Boolean(document.querySelector('iframe[src*="privy"]'))`,
  );
  check('Privy modal opened', modalFrame);

  /* 2 — injected wallet, end to end. */
  const tabW = await newTab(`${SITE}/claim`);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_ETHEREUM }, tabW);
  await cdp.send('Page.navigate', { url: `${SITE}/claim` }, tabW);
  await sleep(4000);

  await evaluate(
    tabW,
    `Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Connect wallet')?.click(); true`,
  );
  await sleep(1500);
  const shown = await evaluate(tabW, `document.querySelector('.header button')?.textContent ?? ''`);
  check('injected wallet connected', shown.includes(OWNER.slice(0, 6)), `header shows "${shown.trim()}"`);

  const typeLabel = `(function () {
    const input = document.getElementById('claim-name');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, '${LABEL}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.search-button')?.click();
    return true;
  })()`;
  await evaluate(tabW, typeLabel);
  await sleep(2500);
  const status = await evaluate(tabW, `document.querySelector('.status')?.textContent ?? ''`);
  check('availability says free', /available, free/i.test(status), status.trim().slice(0, 80));

  await evaluate(
    tabW,
    `Array.from(document.querySelectorAll('button.btn-primary')).pop()?.click(); true`,
  );

  // The mock parked the typed data on window; sign it with ethers out here.
  let signed = false;
  for (let i = 0; i < 40 && !signed; i += 1) {
    await sleep(300);
    const raw = await evaluate(tabW, `window.__E2E_TYPED_DATA ?? null`);
    if (!raw) continue;
    const typed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // ethers wants the primary type only; the wallet hands over EIP712Domain too.
    const { EIP712Domain: _domain, ...types } = typed.types;
    const signature = await wallet.signTypedData(
      {
        name: typed.domain.name,
        version: typed.domain.version,
        chainId: Number(typed.domain.chainId),
        verifyingContract: typed.domain.verifyingContract,
      },
      types,
      {
        label: typed.message.label,
        owner: typed.message.owner,
        deadline: BigInt(typed.message.deadline),
      },
    );
    await evaluate(tabW, `window.__E2E_RESOLVE(${JSON.stringify(signature)}); true`);
    signed = true;
  }
  check('EIP-712 signature requested and answered', signed);

  let done = false;
  let pageText = '';
  for (let i = 0; i < 30 && !done; i += 1) {
    await sleep(1000);
    pageText = await evaluate(tabW, `document.body.innerText`);
    done = /is yours now|already yours/.test(pageText);
  }
  await screenshot(tabW, '/tmp/mp-e2e-claim-done.png');
  check('claim completed on chain', done, done ? `${LABEL}.musepass.eth` : pageText.slice(0, 120));

  /* 3 — the API knows the name. */
  const list = await fetch(`${SITE}/v1/names?owner=${OWNER}`).then((r) => r.json());
  const found = ((list.data ?? {}).names ?? []).some((n) => n.label === LABEL);
  check('API lists the new name for the owner', found);
} catch (error) {
  check('script ran to the end', false, error.message);
}

failures = results.filter((r) => !r.ok).length;
if (consoleErrors.length) {
  console.log('\nconsole errors (page):');
  for (const line of consoleErrors.slice(0, 10)) console.log(`  ${line.slice(0, 200)}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
console.log(`label used: ${LABEL} · screenshots: /tmp/mp-e2e-x-modal.png /tmp/mp-e2e-claim-done.png`);
chrome.kill();
process.exit(failures ? 1 : 0);
