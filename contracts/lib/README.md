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

### Verifying a new deployment

The runtime code is **not** identical on every chain: the constructor looks up
`namewrapper.eth` live and stores it as an `immutable`, which is baked into the
runtime bytes. On Sepolia the hash above matches the reference instance; on
mainnet a deployment of this exact bytecode hashes to something else, and that
is correct rather than suspicious.

So compare these instead, which is what `scripts/l1-resolver.mjs` does:

1. the deployed code has the expected size (7411 bytes on chains whose ENS
   answers as Sepolia's does, 7412 where the NameWrapper address pushes one
   extra byte),
2. `url()`, `signer()` and `owner()` report exactly the values that were passed
   to the constructor,
3. `nameWrapper()` equals whatever ENS resolves `namewrapper.eth` to on that
   chain — which can only be true if the code is this contract,
4. deploying the same bytecode twice produces byte-identical runtime code.

Picking the resolver's address: deployments here use CREATE2 through the
well-known deployment proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) with a
zero salt, so the address is fixed by the init code alone and is known before
anyone pays for anything. The init code is this file plus
`abi.encode(string url, address signer, address owner)`.
