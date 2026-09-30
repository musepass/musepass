# Contributing

Thanks for looking. This repository has opinions, and they are written down, so
the fastest way to get a change accepted is to agree with them or argue with them
explicitly.

## Getting it running

```bash
pnpm install
pnpm check            # typecheck, 553 tests, contract tests, public-claims check, English-only check
pnpm verify:local     # a local chain, API, MCP and site, end to end
```

Node 20+, pnpm, and Foundry (`forge`) for `contracts/`.

## The rules a change has to keep

These are not style preferences; the build fails without them.

1. **No invented data.** If a number, address or verdict cannot be read, say so.
   There is no fixture that pretends to be production, and no placeholder that
   looks real.
2. **`pnpm claims:check` must pass.** Every public sentence is mapped to a
   capability gate in `config/claims-gates.json`. Opening a gate needs evidence
   (a transaction hash or a measured result). Softening a claim to satisfy the
   checker is the wrong direction.
3. **`pnpm web:english` must pass.** The website is English-only, including the
   data embedded in rendered pages.
4. **We do not write core contracts.** The registry, resolver and validator are
   Durin's, deployed byte-for-byte. The registrar (no funds, no upgrade path) is
   the one exception, and it must not grow.
5. **A signature belongs to a person or their agent.** Nothing that moves,
   rewrites or spends on someone's behalf may skip an owner signature.
6. **Verification happens offline.** Anything that claims a record is real must
   be checkable without calling our server.

## Pull requests

- One change per pull request, with the reasoning in the description. The commit
  messages in this repository explain *why*; matching that is the standard.
- New behaviour needs a test that would fail without it. A test that only asserts
  what the code already does is not a test.
- If a change touches a public sentence, the claim gate is part of the change.
- If a change touches a contract, say what it does with money (usually: nothing)
  and what the audit story is.

## Reporting bugs and asking for features

Use the issue templates. For anything security-related, follow `SECURITY.md`
instead — not the public tracker.
