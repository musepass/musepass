#!/usr/bin/env node
// another project-adjacent, same project: name registry power inventory + escalation alarm.
//
//   node scripts/security-power-inventory.mjs            # human readable
//   node scripts/security-power-inventory.mjs --json     # for a monitor
//   MUSENAME_ALERT_WEBHOOK=https://… node scripts/security-power-inventory.mjs --watch
//
// WHY THIS EXISTS
//
// An outside review, verified on chain on 2026-09-29, found that the registry's owner
// is the operating hot wallet, and that the owner can call `addRegistrar` on itself
// (confirmed: the call does not revert). A registrar can rewrite any name's address and
// text. So the sentence "if the hot wallet is stolen, an attacker can only pay gas" is
// not true, and the review asked for either ownership to move to a multisig, or the
// escalation to stop being invisible.
//
// The owner stays where it is (a deliberate decision, 2026-09-29). This script is the
// other half of that decision: with the power left in place, the least we can do is
// DETECT the moment it is used. `registrars(hotWallet)` flipping to true is the alarm —
// it is exactly what an attacker would do first, and nothing legitimate needs it.
//
// Exit codes: 0 = every invariant holds · 1 = something escalated · 2 = could not check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const asJson = process.argv.includes("--json");
const watch = process.argv.includes("--watch");
const webhook = process.env.MUSENAME_ALERT_WEBHOOK || "";

// Selectors, computed rather than guessed.
const SEL = {
  owner: "0x8da5cb5b",
  registrars: "0x89aeca76", // registrars(address)
  addRegistrar: "0xaf92a693", // addRegistrar(address)
  signer: "0x238ac933",
};

const pad = (address) => address.slice(2).toLowerCase().padStart(64, "0");
const toAddress = (result) => (result && result !== "0x" ? `0x${result.slice(26)}` : null);
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function loadConfig() {
  const chains = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "chains.json"), "utf8"));
  const deploymentPath = path.join(ROOT, "deployments", "robinhood.json");
  const deployment = fs.existsSync(deploymentPath)
    ? JSON.parse(fs.readFileSync(deploymentPath, "utf8"))
    : {};
  return { chains, deployment };
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} → ${body.error.message}`);
  return body.result;
}

const call = (url, to, data, from) =>
  rpc(url, "eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]).catch((e) => ({ error: e.message }));

// A 39-character address is not an address. The deployment record had one (a missing
// character in the L1 resolver address), which is exactly the kind of typo that makes a
// security check silently check nothing.
function assertAddress(label, value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return `${label} is not a 40-hex address: ${String(value)} (got ${String(value).replace(/^0x/, "").length} hex chars)`;
  }
  return null;
}

async function inventory() {
  const { chains, deployment } = loadConfig();
  const findings = [];
  const problems = [];

  const l2 = chains?.l2 ?? {};
  const l1 = chains?.l1 ?? {};
  const hotWallet = deployment?.admin ?? null;

  for (const [label, value] of [
    ["config.chains.l2.l2Registry", l2.l2Registry],
    ["config.chains.l2.registrar", l2.registrar],
    ["deployment.admin (the hot wallet)", hotWallet],
  ]) {
    const bad = assertAddress(label, value);
    if (bad) problems.push(bad);
  }
  if (problems.length) return { problems, findings };

  // ── L2 registry: who owns it, and can that owner escalate? ──────────────────
  if (l2.l2Registry && l2.rpcDefault) {
    const owner = toAddress(await call(l2.rpcDefault, l2.l2Registry, SEL.owner));
    const hotIsRegistrar = toAddress(await call(l2.rpcDefault, l2.l2Registry, SEL.registrars + pad(hotWallet)));
    const contractIsRegistrar = toAddress(await call(l2.rpcDefault, l2.l2Registry, SEL.registrars + pad(l2.registrar)));

    findings.push({ power: "L2 registry owner", holder: owner, chain: l2.chainId, address: l2.l2Registry });
    findings.push({ power: "L2 registrar: the issuer contract", holder: contractIsRegistrar === "0x0000000000000000000000000000000000000001" ? l2.registrar : null, chain: l2.chainId });
    findings.push({ power: "L2 registrar: the hot wallet (should be nobody)", holder: hotIsRegistrar, chain: l2.chainId });

    // The alarm. A registrar can rewrite any name; nothing legitimate grants this.
    if (hotIsRegistrar && hotIsRegistrar !== "0x0000000000000000000000000000000000000000") {
      problems.push("ESCALATION: the hot wallet is a registrar — it can rewrite any name's address and text right now");
    }
    if (!same(owner, hotWallet)) {
      problems.push(`the registry owner changed: expected the known hot wallet, found ${owner} — verify before trusting any of this`);
    }
    // Prove the escalation path is open, so the accepted risk stays a measured fact
    // rather than an assumption. Reverts once ownership moves — and then this line
    // should be upgraded to a hard requirement.
    const escalation = await call(l2.rpcDefault, l2.l2Registry, SEL.addRegistrar + pad(hotWallet), hotWallet);
    const canEscalate = !(escalation && escalation.error);
    findings.push({
      power: "hot wallet can grant itself registrar rights (addRegistrar does not revert)",
      holder: canEscalate ? hotWallet : null,
      chain: l2.chainId,
    });
    if (canEscalate) {
      problems.push(
        "ACCEPTED RISK, CONFIRMED BY SIMULATION: the hot wallet can call addRegistrar on itself. " +
        "Ownership has not been moved to a multisig, so this is detection-only. Do not publish any " +
        "claim that a stolen hot wallet 'can only pay gas'."
      );
    }
  }

  // ── L1 resolver on mainnet: owner and signer ────────────────────────────────
  const resolver = deployment?.l1Resolver?.deployVerifiedOnChain
    ? deployment.l1Resolver.deployVerifiedOnChain
    : null;
  const resolverAddress = deployment?.l1Resolver?.address;
  const badResolver = assertAddress("deployment.l1Resolver.address", resolverAddress);
  if (badResolver) problems.push(badResolver);

  if (!badResolver) {
    // The mainnet RPC is chosen from the l1 section; public endpoints for a quick check.
    const mainnetRpc = process.env.MAINNET_RPC_URL || "https://ethereum.publicnode.com";
    const owner = toAddress(await call(mainnetRpc, resolverAddress, SEL.owner));
    const signer = toAddress(await call(mainnetRpc, resolverAddress, SEL.signer));
    findings.push({ power: "L1 resolver owner", holder: owner, chain: 1, address: resolverAddress });
    findings.push({ power: "L1 resolver signer (what the gateway signs with)", holder: signer, chain: 1 });
    if (!same(owner, hotWallet)) {
      problems.push(`the L1 resolver owner is not the known hot wallet (found ${owner}) — confirm who holds it`);
    }
    if (signer && !same(signer, resolver?.signer)) {
      problems.push(`the L1 resolver signer changed: record says ${resolver?.signer}, chain says ${signer}`);
    }
  }

  return { problems, findings, hotWallet, chain: l2.chainId };
}

async function alert(text) {
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `musename power check: ${text}` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function once() {
  let result;
  try {
    result = await inventory();
  } catch (error) {
    if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }));
    else console.error(`power-inventory: could not check — ${error.message}`);
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: result.problems.length === 0, ...result }, null, 2));
  } else {
    console.log("name registry — who holds what (checked on chain)\n");
    for (const f of result.findings) {
      const holder = f.holder ? String(f.holder) : "(nobody)";
      console.log(`  ${String(f.power).padEnd(62)} ${holder}`);
      if (f.address) console.log(`  ${" ".repeat(62)} ${f.address} (chain ${f.chain})`);
    }
    console.log("");
    if (result.problems.length === 0) console.log("no escalations, no drift.");
    else for (const p of result.problems) console.log(`  ⚠ ${p}`);
  }

  const escalated = result.problems.some((p) => p.startsWith("ESCALATION"));
  if (escalated) await alert(result.problems.find((p) => p.startsWith("ESCALATION")));
  process.exit(escalated ? 1 : 0);
}

if (watch) {
  const everyMs = Number(process.env.MUSENAME_CHECK_MS || 60_000);
  console.log(`power-inventory: watching every ${Math.round(everyMs / 1000)}s${webhook ? " (webhook set)" : " (no webhook — printing only)"}`);
  for (;;) {
    try {
      const result = await inventory();
      const escalated = result.problems.find((p) => p.startsWith("ESCALATION"));
      if (escalated) {
        console.error(`⚠ ${escalated}`);
        await alert(escalated);
      } else {
        console.log(new Date().toISOString(), "ok — hot wallet is not a registrar");
      }
    } catch (error) {
      console.error(new Date().toISOString(), `could not check: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
} else {
  await once();
}
