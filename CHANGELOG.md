# Changelog

Newest first. Dates are when the work landed, not when it was planned. Where a
claim matters, the transaction hash or endpoint that backs it is named, because a
changelog that cannot be checked is marketing.

## 2026-09-30

- **An agent with no key can complete the whole flow.** Two new MCP tools
  (`prepare_card`, `submit_card`) finish what `prepare_registration` and
  `submit_registration` started, and `apps/signer` gives an agent a wallet without
  giving it a key — three tools, a bearer token, and a policy that refuses
  anything but our registrar, our chain, deadlines within the hour, and 32-byte
  card hashes. Proven with a bot that holds no key:
  `signer4a8987.musename.eth`, register tx `0xaf554042…`, card tx `0x9c105eeb…`.
- **The agent path became the first-class one.** The confirmation page now says
  which AI asked, for whom, and when the link expires, and hands the owner one
  line to paste back into the chat. `get_status` answers with the next step
  instead of a status code, and `request_name` stopped printing the same URL
  twice.
- **"My names" (`/my`)** lists what a connected wallet holds, read from the
  registrar's events via `GET /v1/names?owner=`. Before this, the only way back to
  a claimed name was to remember its label.
- **The site is English-only, and that is now a build step**
  (`scripts/check-web-english.mjs`). The config's Chinese fields are stripped
  before they reach the browser, so the payload contains none either.
- **Developer page** carries a prompt to paste into an agent, and names both
  registration paths explicitly, because from a tool list they look identical and
  behave nothing alike.
- **Alerting can be a Telegram bot** (`--test-alert` proves the wiring), and the
  health report no longer repeats itself while an outage continues.
- Fixed a production-only bug that made every write fail while every read worked:
  the API matched the configured chain against viem's built-in list and fell back
  to Base Sepolia, so transactions went out with the wrong chain id. Registration
  and card publishing were impossible on the live service until this landed.

## 2026-09-29

- **The name resolves on mainnet.** L1 resolver deployed at
  `0x9Ea7A889…` (tx `0xa7911098…`), the owner registered the L2 registry
  (`0x9c92b019…`) and pointed the name at it (`0x10b852ab…`).
  `getEnsAddress("xiaoming.musename.eth")` returns the owner's address.
- **Cards publish on chain** — `setTextWithSignature` works after the signature
  validator was deployed at the address Durin hardcodes (`0x164af34f…`), by
  replaying the verified bytecode through a deterministic deployment proxy.
- **`packages/verify`**: ERC-8412 offline verification, pinned to the draft commit
  `ff9fbc7e`, passing that project's own 23 conformance vectors.
- **The first anchored batch**: 2 records, merkle root in a zero-value
  transaction (`0xad4c4d97…`), verifiable from the chain's calldata alone.
- **MCP rate limiting**, verified live: call 120 passes, call 121 is refused.
- **`musename.xyz` and `gw.musename.xyz`** live with TLS; the whole project moved
  from Base to Robinhood Chain.
