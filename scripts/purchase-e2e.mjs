#!/usr/bin/env node
/**
 * Can a wallet actually buy a name?
 *
 * Dry mode (default) drives every step of the purchase rail except the real
 * transfer: quote, EIP-712 signature, submit. The payment hash it submits is
 * one no chain has ever seen, so the run ends at the exact boundary the
 * product cares about — the API must answer PAYMENT_NOT_FOUND and register
 * nothing. A bad signature must be refused before the payment is even looked
 * at. Together those prove the rail is wired without spending anyone's money.
 *
 *   node scripts/purchase-e2e.mjs                    # against musepass.xyz
 *   node scripts/purchase-e2e.mjs --base http://localhost:3001
 *
 * Live mode spends real USDG on Robinhood Chain and is how a deployment is
 * signed off (the txHash pair it prints is the claims evidence for the
 * paidPurchase gate). The buyer wallet needs USDG; gas for the register is
 * paid by the project, not by the buyer.
 *
 *   node scripts/purchase-e2e.mjs --live \
 *     --buyer-key 0x…      # or MUSENAME_E2E_BUYER_KEY
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { REGISTER_TYPES, normalizeLabel } from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const base = arg('base', 'https://musepass.xyz').replace(/\/$/, '');
const live = process.argv.includes('--live');
const buyerKey = arg('buyer-key', process.env.MUSENAME_E2E_BUYER_KEY);
// 4 characters by default, so the quote is priced (tier-4) rather than 409-ing
// into the free-first path a 5+ character name would take.
const rawLabel = arg('label', `by${randomBytes(1).toString('hex')}`);

const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));

async function api(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function post(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

console.log('MusePass purchase e2e');
console.log(`  api    ${base}`);
console.log(`  mode   ${live ? 'LIVE (spends real USDG)' : 'dry (no money moves)'}`);
if (!live) {
  // A key nobody funds: the signature is real, the payment is imaginary.
  // viem local accounts are fine for signing; the address just never pays.
  process.exit(await dry());
}
process.exit(await runLive());

async function checkConfig() {
  const { status, body } = await api('/v1/config');
  const payment = body.data?.payment ?? null;
  const enabled = body.data?.features?.premiumPurchase === true;
  console.log(`  config premiumPurchase=${enabled} payment=${payment ? payment.currency : 'hidden'}`);
  if (status !== 200) throw new Error(`config answered ${status}`);
  return { enabled, payment };
}

async function quoteFor(label, owner) {
  const { status, body } = await post('/v1/names/purchase/quote', { label, owner });
  const code = body.errors?.[0]?.code;
  if (status === 503 && code === 'PURCHASE_NOT_ENABLED') {
    console.error('\nSKIP: purchase is not enabled on this deployment.');
    process.exit(2);
  }
  if (status !== 201) {
    console.error(`FAIL: quote answered ${status} ${code ?? ''}`, JSON.stringify(body.errors ?? body).slice(0, 400));
    process.exit(1);
  }
  const quote = body.data;
  console.log(`  quote  ${quote.label} = ${quote.priceUsd} ${quote.currency} (${quote.amountBaseUnits} base units)`);
  console.log(`         pay ${quote.token} → treasury ${quote.treasury}, expires ${quote.expiresAt}`);
  return quote;
}

function typedData(quote, deadline) {
  return {
    domain: quote.registerTypedDataHint.domain,
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message: { label: quote.label, owner: quote.payer, deadline: BigInt(deadline) },
  };
}

/** Dry run: everything except a payment the chain has seen. */
async function dry() {
  const { enabled } = await checkConfig();
  if (!enabled) {
    console.error('\nSKIP: purchase is not enabled on this deployment.');
    return 2;
  }

  // A throwaway key signs for real; its address owns nothing and pays nothing.
  const throwaway = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
  const { normalized } = normalizeLabel(rawLabel);
  console.log(`  name   ${normalized} (buyer ${throwaway.address}, unfunded)`);

  const quote = await quoteFor(normalized, throwaway.address);
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  const data = typedData(quote, deadline);
  const signature = await throwaway.signTypedData(data);

  // 1. A signature over the wrong label must be refused before payment.
  const badData = { ...data, message: { ...data.message, label: `x${data.message.label.slice(1)}` } };
  const badSignature = await throwaway.signTypedData(badData);
  const bad = await post('/v1/names/purchase', {
    label: quote.label,
    owner: quote.payer,
    deadline,
    signature: badSignature,
    quoteId: quote.quoteId,
    paymentTxHash: `0x${randomBytes(32).toString('hex')}`,
  });
  if (bad.status !== 401) {
    console.error(`\nFAIL: a bad signature must be refused with 401, got ${bad.status}.`);
    return 1;
  }
  console.log('  sign   bad signature refused (401) before any payment lookup');

  // 2. A payment no chain has seen must be retryable, and nothing registered.
  const unseen = `0x${randomBytes(32).toString('hex')}`;
  const submit = await post('/v1/names/purchase', {
    label: quote.label,
    owner: quote.payer,
    deadline,
    signature,
    quoteId: quote.quoteId,
    paymentTxHash: unseen,
  });
  const code = submit.body.errors?.[0]?.code;
  if (submit.status !== 409 || code !== 'PAYMENT_NOT_FOUND') {
    console.error(`\nFAIL: expected 409 PAYMENT_NOT_FOUND, got ${submit.status} ${code}.`);
    return 1;
  }
  console.log('  pay    unseen payment refused as retryable (409 PAYMENT_NOT_FOUND)');

  // 3. Nothing was registered by all that: the name is still unclaimed, and
  //    the availability endpoint offers it for purchase to this wallet (the
  //    free rail would still refuse it — that is D17, not a bug).
  const registered = await api(`/v1/names/${normalized}`);
  const offer = await api(`/v1/names/${normalized}/available?owner=${throwaway.address}`);
  const purchase = offer.body.data?.purchase;
  if (registered.status !== 404 || purchase?.kind !== 'tier-4') {
    console.error(`\nFAIL: expected an unregistered name and a tier-4 offer, got status ${registered.status}, purchase ${JSON.stringify(purchase)}.`);
    return 1;
  }
  console.log(`  check  still unregistered; availability offers tier-4 at $${purchase.priceUsd}`);
  console.log('\nPASS: quote, signature and payment boundaries all hold; no money moved.');
  console.log('      Run with --live to complete a real purchase.');
  return 0;
}

/** Live run: real USDG transfer, then the real submit. */
async function runLive() {
  if (!buyerKey || !/^0x[0-9a-f]{64}$/i.test(buyerKey)) {
    console.error('\nFAIL: --live needs --buyer-key (or MUSENAME_E2E_BUYER_KEY) holding USDG.');
    return 1;
  }
  const { enabled, payment } = await checkConfig();
  if (!enabled || !payment) {
    console.error('\nFAIL: purchase is not enabled on this deployment.');
    return 1;
  }

  const buyer = privateKeyToAccount(buyerKey);
  const { normalized } = normalizeLabel(rawLabel);
  console.log(`  name   ${normalized} (buyer ${buyer.address})`);

  const quote = await quoteFor(normalized, buyer.address);

  const chain = {
    id: chains.l2.chainId,
    name: chains.l2.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [chains.l2.rpcDefault] } },
  };
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account: buyer, chain, transport: http() });

  const balance = await publicClient.readContract({
    address: payment.token,
    abi: [
      { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'who', type: 'address' }], outputs: [{ type: 'uint256' }] },
    ],
    functionName: 'balanceOf',
    args: [buyer.address],
  });
  if (balance < BigInt(quote.amountBaseUnits)) {
    console.error(`\nFAIL: buyer holds ${balance} base units, the name costs ${quote.amountBaseUnits}.`);
    console.error(`       Send ${payment.currency} to ${buyer.address} on ${chain.name} and retry.`);
    return 1;
  }
  console.log(`  funds  ${balance} base units of ${payment.currency}`);

  console.log('  pay    sending transfer…');
  const paymentHash = await walletClient.writeContract({
    address: payment.token,
    abi: [
      { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
    ],
    functionName: 'transfer',
    args: [payment.treasury, BigInt(quote.amountBaseUnits)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: paymentHash });
  if (receipt.status !== 'success') {
    console.error(`\nFAIL: payment ${paymentHash} reverted.`);
    return 1;
  }
  console.log(`  pay    ${paymentHash} (block ${receipt.blockNumber})`);

  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  const signature = await buyer.signTypedData(typedData(quote, deadline));
  const submit = await post('/v1/names/purchase', {
    label: quote.label,
    owner: quote.payer,
    deadline,
    signature,
    quoteId: quote.quoteId,
    paymentTxHash: paymentHash,
  });
  const data = submit.body.data;
  if (submit.status !== 201 || !data?.fullName) {
    console.error(`\nFAIL: submit answered ${submit.status}`, JSON.stringify(submit.body.errors ?? submit.body).slice(0, 600));
    console.error('       The payment is at the treasury; if the quote expired, that is the refund path.');
    return 1;
  }

  console.log(`  name   ${data.fullName} → ${data.owner}`);
  console.log(`  tx     ${data.txHash}`);
  console.log('\nPASS: a real purchase completed.');
  console.log('Evidence for the paidPurchase claims gate:');
  console.log(`  payment  ${paymentHash}`);
  console.log(`  register ${data.txHash}`);
  return 0;
}
