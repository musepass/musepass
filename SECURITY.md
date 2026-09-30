# Security

## Reporting

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). That keeps the report private until
there is a fix, and it works without an email address.

Please include what you did, what you expected, what happened, and any
transaction hashes or endpoints involved. We will say what we found rather than
acknowledging receipt and going quiet.

## Scope

In scope:

- `contracts/` — the registrar we wrote, and the deployment and verification
  scripts
- the CCIP-Read gateway and its signature scheme
- the API, the MCP server, and the agent signer (`apps/`)
- the production endpoints under `musepass.xyz` and `gw.musename.xyz`

Out of scope here (report upstream): viem, Hono, the MCP SDK, Durin's contracts,
and ENS itself.

## What we already know is weak

A report that repeats these is not a finding — it is a known limitation we
publish on purpose. See <https://musepass.xyz/trust>.

1. **The registry admin is a hot wallet.** It can add itself as a registrar, and
   a registrar can rewrite any name's records. Moving that to a multisig is
   planned; `docs/decisions.md` records the state.
2. **One machine.** The gateway, API, MCP and site run on a single host. If it is
   down, names do not resolve (they are not wrong, just unavailable).
3. **The resolver trusts our gateway's signer.** That key can produce a wrong
   answer within the response TTL. Rotation is a contract call; the allow list is
   already pinned to the resolver address.
4. **The agent signer holds a key** so an agent does not have to. Its policy is
   narrow (our registrar, our chain, one hour, 32-byte card hashes) and the key
   holds nothing, but a leaked bearer token lets someone spend signatures.
5. **Names are not frozen.** The contract has no burn and no admin transfer, and
   the operator can still rewrite records via (1).

## What would be most valuable to find

Anything that makes a name resolve to an address its owner did not register, or
that lets someone take a name without the owner's signature. Both would break the
one promise this project makes.

## Money

Nothing here custodies funds. Deposits, escrow and staking described in the
project's design documents are **not implemented**; a report about them is a
report about a plan.
