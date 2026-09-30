<div align="center">
  <img src="launch-kit/assets/musepass-x-banner.png" width="820" alt="MusePass — a passport and an account for every AI agent">
  <h1>MusePass</h1>
  <p><strong>A passport and an account for every AI agent.</strong></p>
  <p>A name that resolves in any wallet · a card another agent can read · a record anyone can check</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4f46e5?style=flat-square" alt="MIT license"></a>
    <a href="https://musepass.xyz"><img src="https://img.shields.io/badge/live-musepass.xyz-10b981?style=flat-square" alt="Live site"></a>
    <a href="#what-works-today"><img src="https://img.shields.io/badge/resolves-Ethereum%20mainnet-38bdf8?style=flat-square" alt="Resolves on mainnet"></a>
    <a href="#what-works-today"><img src="https://img.shields.io/badge/names-Robinhood%20Chain%204663-38bdf8?style=flat-square" alt="Robinhood Chain"></a>
    <a href="#the-card"><img src="https://img.shields.io/badge/card-ERC--8004-000000?style=flat-square" alt="ERC-8004 card"></a>
    <a href="packages/verify/README.md"><img src="https://img.shields.io/badge/verifier-offline-0ea5e9?style=flat-square" alt="Offline verifier"></a>
    <a href="https://x.com/musepass"><img src="https://img.shields.io/badge/X-%40musepass-000000?style=flat-square" alt="MusePass on X"></a>
    <a href="https://github.com/musepass/musepass/actions/workflows/ci.yml"><img src="https://github.com/musepass/musepass/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  </p>
</div>

> **Live today:** a name that resolves in a real wallet, and a card the owner publishes
> on chain with their own signature. **Design, not shipped:** the vault, the bond, the
> stamps and the notary seats. **One NFT exists — the name.** Nothing here is audited,
> and nothing here holds customer money.

Agents can already pay, hire and be paid. What they cannot do is say who they are, or
prove what they did, in a form the other side can check without trusting a platform.

An address has no name, no history and nobody accountable behind it. MusePass gives an
agent a name that resolves anywhere ENS is spoken, a card that describes what it does,
and a record built from evidence rather than from our word.

```text
wallet or agent asks ENS          mainnet resolver            our gateway          names live here
───────────────────────────▶  0x9eA7A889…  ──CCIP-Read──▶  gw.musename.xyz  ──▶  Robinhood Chain 4663
      name → address                 (ours)                 (ERC-3668)            registry + registrar
```

The resolution path deliberately crosses two chains: the name is ENS on Ethereum
mainnet, so every wallet can read it, while the registry that mints it lives on an L2
where a registration costs cents. The L1 resolver is a deployed copy of
[`ensdomains/durin`](https://github.com/ensdomains/durin) — we did not write a name
system, we run one.

---

## What works today — checked 2026-09-30

Everything below was read from the chain or from the live service on that date. Open the
explorers and check it rather than taking this file's word for it.

| What | Where it is | Check it |
| --- | --- | --- |
| **A name resolves on Ethereum mainnet** | `abced.musename.eth` → `0x022Ce19a…85b7`, through the resolver below | [`pnpm l1:resolver`](scripts/l1-resolver.mjs) · registration tx [`0x44553d06…`](https://robinhoodchain.blockscout.com/tx/0x44553d06f720d01bb015a50d2d2a58535a347e49bd550ce89bce159048d95352) |
| **Our L1 resolver is deployed** | `0x9eA7A8896a68717e587BC1EE17B6b0B80EEeb443` — Durin's bytecode, our gateway URL and our signing key | deploy tx [`0xa7911098…`](https://etherscan.io/tx/0xa7911098244ea330923bd540ae3c3ffb18bd5c331ac74f6c2b97f72fbe0bcf0d) |
| **Names are minted on Robinhood Chain** | registry `0x4b959e1Fb5567cAa7FE21D0D2a7F870Af705B792` · registrar `0xb1e8A90E5a9b1C8E69242BC70d928789D89c02b7` | registrar tx [`0xe01cd3b2…`](https://robinhoodchain.blockscout.com/tx/0xe01cd3b2fad0be96b89b249b790390d91eedecdc530360415802bb5f2e1fe231) |
| **The registration needs the owner's signature, not the platform's** | the registrar only accepts an EIP-712 payload signed by the address that will own the name | `pnpm verify:local` proves it on a throwaway chain, digest against contract |
| **A card is published on chain** | an ERC-8004 text record, signed by the owner, private by default | `pnpm --filter @musename/api test` · package [`@musename/core`](packages/core) |
| **Records are anchored** | Robinhood Chain, block `75420865`, 2 records under one merkle root | tx [`0xad4c4d97…`](https://robinhoodchain.blockscout.com/tx/0xad4c4d9749329274a62f7b4a2744ab66c4cec62822c7e6f6ad3630ebd00429eb) |
| **An AI can register by itself** | MCP over HTTPS, plus a self-signing path for agents that hold their own key | [MCP server](apps/mcp) · [`pnpm agent:probe`](scripts/agent-purchase-probe.mjs) |

`musepass.eth` is registered on mainnet and is being pointed at this deployment. Names
resolve today under the earlier root; the root above resolves as soon as its two
one-time transactions are signed by the name's owner.

## What is deliberately not claimed yet

A project that sells credibility has to be the first to say what it cannot do. These are
on the [trust page](https://musepass.xyz/trust) as well, and `pnpm claims:check` fails
the build if any published sentence outruns its evidence.

<!-- claims-allow-block: name-not-modifiable — the sentence in quotes is the claim we refuse to make -->
<!-- claims-allow-block: independent-verifier — same: the row exists to deny it -->

| Not true today | Why it is written down |
| --- | --- |
| "The platform cannot change your name." | The registry admin is an operational key, and it can add a registrar. A watchdog ([`scripts/security-power-inventory.mjs`](scripts/security-power-inventory.mjs)) reports the moment that happens; moving the permission to a multisig is the fix, and it has not been done. |
| "Independently verified." | The only verifier today is our own engine, from the same team. |
| "Records cannot be changed." | The append-only record contract is written and tested, and is **not deployed**. What exists on chain is one zero-value self-transfer carrying a merkle root. |
| "Audited." | No external audit has been done. Anything that touches money waits for one. |
<!-- claims-allow-end: * -->

## One NFT

There is one kind of token in this project: the name, an ERC-721 that lives in its
owner's wallet. Everything else people might call an NFT is not one.

| Thing | What it actually is |
| --- | --- |
| Name | The ERC-721. One per name, free from five characters up |
| Card | An on-chain record, not a token |
| Passport stamps | Data on the name, not tokens |
| Genesis cover | A planned trait on the first 1,000 names, not a second collection, and not built |
| Invitation to claim a name | Planned as a whitelist plus a signature, not as a transferable token |
| Notary seat | Planned, capped at 1,000, not issued |

So there is no second collection, no invitation token and no seat sale. If something
claims to be one of those and it is not in this repository, it is not ours.

## Check it yourself

No testnet money and no private key are needed for any of these.

```bash
pnpm install

pnpm check            # typecheck · 492 tests · 65 contract tests · claim gates · English-only web
pnpm verify:local     # deploys the contracts on a throwaway chain and walks the whole path:
                      # sign off chain → mint on chain → API → MCP tools → the real pages
pnpm l1:resolver      # reads the deployed resolver on mainnet and says what it points at
pnpm verify:vectors   # runs our verifier against the ERC-8412 draft's own consistency vectors
pnpm wallet:compat    # 17 machine checks: ENS resolution through viem and ethers across 4 RPCs
pnpm health           # 15 checks against the live service, from outside
pnpm claims:check     # every published sentence against the gate it depends on
pnpm snapshot:names   # exports every name from the chain with a sha256 anyone can compare
```

`pnpm verify:local` is the one to run first: it asserts that the EIP-712 digest computed
off chain is byte-for-byte the digest the contract accepts, that the name is minted to
the **signer** and never to the address paying the gas, and that both address records
(ENSIP-11 and mainnet coinType) are written.

## The card

A card follows ERC-8004 and answers three questions about an agent: what it is, what it
runs on, and how to reach it. Two rules shape it.

- **Private by default.** Only the name and the address are public. Fields become public
  one switch at a time, and the owner signs the result.
- **The owner signs, the platform pays.** Publishing is one signature; we cover the gas
  and never hold the name.

## Repository map

```
contracts/          Foundry: the registrar that mints names, and the record contract
packages/core/      Normalisation, confusable detection, reserved names, pricing, cards
packages/verify/    Offline record verifier — one command, no dependencies on us
apps/gateway/       CCIP-Read gateway: ERC-3668 responses, signing, metrics
apps/api/           Public read API, registration backend, confirmation links
apps/mcp/           MCP server: nine tools, so an AI can register and publish by itself
apps/web/           The site: landing, claim, name pages, verify, anchors, developers
config/             Brand, chain addresses, pricing, limits, reserved names — no code changes
scripts/            One command per promise: local end to end, health, snapshots, probes
```

The npm scope inside the monorepo is `@musename/*`; the product is MusePass. It is a
leftover from the rename and is deliberate, because the on-chain identifiers that must
never change (the resolver's gateway hostname, the ENS text key `musename.card`, the
record digest tag) use the same name.

## Configuration

Nothing about the brand, the chain or the price list is hardcoded:

| File | What it holds |
| --- | --- |
| `config/brand.json` | Product name, root name, canonical domain, support address |
| `config/chains.json` | Chain ids, registry and registrar addresses, the previous deployment |
| `config/pricing.json` | Free tier, premium tiers, certification fee |
| `config/limits.json` | Free allowance, sponsorship caps, label rules, rate limits |
| `config/reserved-names.json` | Reserved brand, platform, public-figure and system names |

## Documentation

The deeper documents are written in Chinese; the code, the site and the interfaces are
in English. Start from these:

- [Review package](docs/review/README.md) — the state of the project for an outside
  reviewer, including the fifteen questions we want to be judged on
- [Trust model](docs/trust-model.md) — who can do what, and what is not true yet
- [Technical verification report](docs/tech-verification-report.md) — what was checked
  about Durin, ERC-8004, ERC-8412 and ENSIP-15, and what had to change
- [Decisions](docs/decisions.md) — every product boundary that was decided, with reasons
- [Gateway runbook](docs/runbook-gateway.md) — protocol, deployment, three failure plans
- [Status](docs/status.md) — what is left, on one page
- [CHANGELOG](CHANGELOG.md) — each entry carries a transaction hash or an endpoint, not
  the word "done"

## Security

Report a vulnerability through GitHub's private channel (**Security → Report a
vulnerability**); see [SECURITY.md](SECURITY.md). That file also lists the weaknesses we
already know about, so reporting those again is not a finding.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Three rules are not negotiable: **do not invent
data**, `pnpm claims:check` must pass, and **the site is English only** (the build
enforces it). Core contracts are not rewritten here — the registry, the resolver and the
signature validator are Durin's published bytecode. The one contract we wrote mints
names, holds no funds and has no upgrade path.

## Licence and independence

Code is MIT ([LICENSE](LICENSE)); vendored third-party parts keep their own licences,
listed in [NOTICE](NOTICE).

MusePass is an independent project. It is not affiliated with, endorsed by, or sponsored
by Meta Platforms, Inc. or any of its products.
