import { fetchConfig, fetchName } from '@/lib/api';

/**
 * ERC-721 metadata for the name NFTs (the L2 registry itself is the ERC-721;
 * its tokenURI is `baseURI + tokenId`, where tokenId is the name's node).
 * OpenSea and any wallet that renders the token read this endpoint.
 *
 * The image is the project's own renderer (`/name/<label>/card.png`), which
 * draws the name, the genesis number and the card hash — all read from the
 * chain at request time. Same honest limit as the card: if the site is down
 * the image is down; ownership never depends on it.
 */
export const dynamic = 'force-dynamic';

// Same public RPC the client already uses for chain switching (lib/wallet.ts).
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const REGISTRY = '0x4b959e1fb5567caa7fe21d0d2a7f870af705b792';
// names(bytes32)
const NAMES_SELECTOR = '0x20c38e2b';

/** tokenId (decimal or hex string) → 32-byte node hex, or null if not a node. */
function parseNodeId(tokenId: string): `0x${string}` | null {
  try {
    const value = tokenId.startsWith('0x') ? BigInt(tokenId) : BigInt(tokenId);
    if (value < 0n || value >= 1n << 256n) return null;
    return `0x${value.toString(16).padStart(64, '0')}`;
  } catch {
    return null;
  }
}

/** Decode the registry's DNS wire format (`len label len label …`). */
function decodeWireName(bytes: `0x${string}`): string | null {
  const hex = bytes.startsWith('0x') ? bytes.slice(2) : bytes;
  const labels: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const length = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(length) || length === 0) break; // terminating root byte, if present
    if (i + 2 + length * 2 > hex.length) return null;
    const label = hex
      .slice(i + 2, i + 2 + length * 2)
      .match(/.{2}/g)!
      .map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join('');
    labels.push(label);
    i += length * 2;
  }
  return labels.length > 0 ? labels.join('.') : null;
}

/**
 * Unwrap the ABI encoding of a `bytes` return: 32-byte offset, 32-byte length,
 * then the data. (A raw `eth_call` does not decode for you the way `cast` does.)
 */
function unwrapAbiBytes(result: `0x${string}`): `0x${string}` | null {
  const hex = result.slice(2);
  if (hex.length < 128) return null;
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${hex.slice(64, 128)}`)) * 2;
  if (offset !== 64 || Number.isNaN(length) || 128 + length > hex.length) return null;
  return `0x${hex.slice(128, 128 + length)}`;
}

async function readRegistryName(node: `0x${string}`): Promise<string | null> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: REGISTRY, data: `${NAMES_SELECTOR}${node.slice(2)}` }, 'latest'],
      }),
      // A metadata endpoint should not hang a wallet's render.
      signal: AbortSignal.timeout(5000),
    });
    const payload = (await response.json()) as { result?: string };
    if (!payload.result || payload.result === '0x') return null;
    const wire = unwrapAbiBytes(payload.result as `0x${string}`);
    if (!wire) return null;
    return decodeWireName(wire);
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const node = parseNodeId(tokenId);
  if (!node) return new Response('not a token id', { status: 400 });

  const fullName = await readRegistryName(node);
  if (!fullName) return new Response('no such token', { status: 404 });
  const label = fullName.split('.')[0];

  const config = await fetchConfig();
  const site = config.siteUrl.replace(/\/$/, '');

  // Optional enrichment; the name alone is enough for the metadata to be honest.
  let genesis: number | null = null;
  let hasCard = false;
  try {
    const payload = await fetchName(label);
    genesis = payload.data?.genesis?.number ?? null;
    hasCard = Boolean(payload.data?.card);
  } catch {
    // The registry is the source of truth; the API being briefly unreachable
    // must not 404 a token that exists.
  }

  const attributes: { trait_type: string; value: string | number | boolean }[] = [
    { trait_type: 'Characters', value: label.length },
    { trait_type: 'Card published', value: hasCard },
  ];
  if (genesis !== null) attributes.unshift({ trait_type: 'Genesis number', value: genesis });

  return Response.json(
    {
      name: fullName,
      description:
        'A MusePass name: an ENS subname that resolves on Ethereum mainnet and is held in the owner\u2019s own wallet. The image is rendered from the name\u2019s on-chain record.',
      external_url: `${site}/name/${encodeURIComponent(label)}`,
      image: `${site}/name/${encodeURIComponent(label)}/card.png`,
      attributes,
    },
    { headers: { 'cache-control': 'public, max-age=60, s-maxage=300, swr=60' } },
  );
}
