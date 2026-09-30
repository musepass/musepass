import { ImageResponse } from 'next/og';
import { fetchConfig, fetchName } from '@/lib/api';

/**
 * The wallet image for a name (D16/D18): the name, the genesis cover number
 * when there is one, and the card content hash. Every value comes from the API
 * at request time, which itself reads it from the chain — nothing here is a
 * database opinion.
 *
 * Honest limit, same as D16: this image is rendered by us. If the site is
 * down the image is down; the name, the ownership and the records do not
 * depend on it.
 */
export const dynamic = 'force-dynamic';
export const size = { width: 600, height: 600 };

const INK = '#1a1f1d';
const INK3 = '#56605b';
const ACCENT = '#123e34';
const GOLD = '#b8860b';

export async function GET(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  const decoded = decodeURIComponent(label);
  const config = await fetchConfig();

  let fullName = `${decoded}.${config.rootName}`;
  let genesis: number | null = null;
  let contentHash: string | null = null;
  let hasCard = false;
  try {
    const payload = await fetchName(decoded);
    if (payload.data) {
      fullName = payload.data.fullName;
      genesis = payload.data.genesis?.number ?? null;
      contentHash = payload.data.card?.contentHash ?? null;
      hasCard = Boolean(payload.data.card);
    }
  } catch {
    // An unreadable name still gets an image: the name itself is the fact we
    // can stand behind, and an empty card is the truth.
  }

  const numbered = genesis !== null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          border: numbered ? `6px solid ${GOLD}` : `4px solid ${ACCENT}`,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 28px',
            background: ACCENT,
            color: '#ffffff',
            fontSize: 16,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          <span>{config.productName} pass</span>
          <span>{config.rootName}</span>
        </div>

        {numbered ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 28px',
              background: '#f5e6b8',
              color: '#6b5410',
              fontSize: 15,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            <span>Genesis cover</span>
            <span>#{String(genesis).padStart(4, '0')}</span>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            padding: '0 28px',
          }}
        >
          <div style={{ display: 'flex', fontSize: 44, color: INK, fontWeight: 700, wordBreak: 'break-all' }}>
            {fullName}
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 17, color: INK3 }}>
            {hasCard ? 'Card issued and signed by the owner' : 'No card issued yet'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '16px 28px 22px',
            borderTop: '1px solid #d5d9d2',
            fontSize: 13,
            color: INK3,
          }}
        >
          <div style={{ display: 'flex' }}>
            Chain {config.chain.chainId} · owner-held ERC-721
          </div>
          {contentHash ? <div style={{ display: 'flex' }}>Card content hash {contentHash.slice(0, 16)}…</div> : null}
          <div style={{ display: 'flex' }}>
            Numbered from the registrar&apos;s NameRegistered order — nothing extra was minted
          </div>
        </div>
      </div>
    ),
    size,
  );
}
