# Vendored bytecode

## `durin-L1Resolver.deployable.txt`

Durin's `L1Resolver` — the L1 contract that answers ENS queries by CCIP-reading
an L2 registry. This file is the deployment bytecode **with the original
constructor arguments stripped**, so we can deploy our own instance with our own
`(url, signer, owner)`.

Provenance, so this can be audited rather than trusted:

1. The deployed instance on Sepolia at
   `0x8A968aB9eb8C084FBC44c531058Fc9ef945c3D61` is verified on Sourcify with
   `exact_match` (compiler `0.8.20+commit.a1b79de6`, 11 sources).
2. The runtime bytecode from Sourcify was compared against the on-chain code at
   that address and is byte-identical:
   `cast code 0x8A968... --rpc-url <sepolia> | cast keccak`
   → `0x86c8a2314f032abc4a410eb00384ca5b54dc46aa7fe879181a98eeb970a9287d`
3. The creation bytecode ends with `abi.encode(string,address,address)` for the
   values the live contract reports (`url()` = `https://gateway.durin.dev/v1/{sender}/{data}`,
   `signer()` = `0x1E0B906b…`, `owner()` = `0xE997d9b7…`). Those 192 bytes were
   removed to produce this file.

We deploy this contract rather than writing our own, per the project rule about
not writing core contracts. We deploy our own *instance* because the gateway URL
and signer are baked in at construction, and using someone else's instance means
depending on someone else's gateway and signing key (decision D11).

To verify a deployment made from this file, compare the runtime code hash of the
new address against the hash above: identical bytes mean the same implementation.
