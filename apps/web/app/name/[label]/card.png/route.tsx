import { ImageResponse } from 'next/og';
import { fetchConfig, fetchName } from '@/lib/api';

/**
 * The wallet image for a name (D16/D18), drawn to the passport template: a
 * dark-green card with an emblem header, the name in monospace, STATUS/STAMPS
 * rows, a stamps tray and an MRZ-style footer. Names with a genesis cover get
 * the gold GENESIS PASSPORT treatment. Every value comes from the API at
 * request time, which itself reads it from the chain — nothing here is a
 * database opinion. STAMPS is always 0 until the records contract exists.
 *
 * Honest limit, same as D16: this image is rendered by us. If the site is
 * down the image is down; the name, the ownership and the records do not
 * depend on it.
 */
export const dynamic = 'force-dynamic';
export const size = { width: 1000, height: 1000 };

// Palette from the template artwork.
const CANVAS = '#0b1512';
const CARD_TOP = '#1a4634';
const CARD_BOTTOM = '#123227';
const CARD_EDGE = '#2a4a3c';
const CREAM = '#f0e6c8'; // the name
const GOLD_SOFT = '#d4c48a'; // ".musepass.eth"
const GOLD = '#c9a84c'; // genesis accents
const TAN = '#e8d9a0'; // emblem + "AI PASSPORT"
const LABEL = '#c9b87a'; // STATUS / STAMPS labels
const RULE = '#3a5a48';
const TRAY_EDGE = '#2e5040';
const TRAY_TEXT = '#6e8a7a';
const MRZ = '#9fb39a';

/**
 * Satori ships a sans default only; the template's monospace needs a real
 * font file. Fetched once per process. If the fetch fails the card degrades
 * to the default sans rather than erroring — the values on it stay true.
 */
let monoFontsPromise: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 }[]> | null =
  null;

function loadMonoFonts() {
  monoFontsPromise ??= (async () => {
    const fetchFont = async (weight: 400 | 700) => {
      const response = await fetch(
        `https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-${weight}-normal.ttf`,
      );
      if (!response.ok) throw new Error(`font ${weight} -> ${response.status}`);
      return { name: 'JetBrains Mono', data: await response.arrayBuffer(), weight };
    };
    const fonts = await Promise.all([fetchFont(400), fetchFont(700)]);
    return fonts;
  })().catch(() => {
    // Degrade once, then retry on the next render rather than caching failure.
    monoFontsPromise = null;
    return [];
  });
  return monoFontsPromise;
}

const MRZ_WIDTH = 44;

/** `MP<NOVA<<MUSEPASS<ETH<<<…` — label uppercased, `<` as filler, fixed width. */
function mrzLines(label: string, genesis: number | null): [string, string] {
  const head = `MP<${label.toUpperCase()}<<MUSEPASS<ETH`.replace(/[^A-Z0-9<]/g, '');
  const line1 = (head + '<'.repeat(MRZ_WIDTH)).slice(0, MRZ_WIDTH);
  const serial = `${genesis === null ? 'P' : 'G'}${String(genesis ?? 0).padStart(4, '0')}`;
  const line2 = (serial + '<'.repeat(MRZ_WIDTH)).slice(0, MRZ_WIDTH);
  return [line1, line2];
}

/** The template's name size, stepped down so long labels still fit the card. */
function nameSize(label: string): number {
  if (label.length <= 7) return 96;
  if (label.length <= 10) return 78;
  if (label.length <= 14) return 62;
  if (label.length <= 20) return 48;
  return 38;
}

/**
 * The name facts the card needs (genesis number, card published). The API
 * answers from the chain, which can take seconds warm and much longer cold,
 * so the first fetch gets a long leash and successes are memoised briefly —
 * OpenSea and wallets re-fetch this image often and must not pay the chain
 * round trip every time. Failures are never cached.
 */
type NameFacts = { genesis: number | null; hasCard: boolean; ok: boolean };

const FACTS_TTL_MS = 120_000;
const factsCache = new Map<string, { expires: number; promise: Promise<NameFacts> }>();

function nameFacts(label: string): Promise<NameFacts> {
  const hit = factsCache.get(label);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const entry = {
    expires: Date.now() + FACTS_TTL_MS,
    promise: fetchName(label, { timeoutMs: 25_000 })
      .then((payload) => ({
        genesis: payload.data?.genesis?.number ?? null,
        hasCard: Boolean(payload.data?.card),
        ok: true,
      }))
      .catch(() => {
        // An unreadable name still gets an image: the name itself is the
        // fact we can stand behind, and an empty card is the truth. Next
        // render retries rather than serving the fallback for two minutes.
        factsCache.delete(label);
        return { genesis: null, hasCard: false, ok: false } satisfies NameFacts;
      }),
  };
  factsCache.set(label, entry);
  return entry.promise;
}

export async function GET(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  const decoded = decodeURIComponent(label);
  const config = await fetchConfig();

  const facts = await nameFacts(decoded);
  const genesis = facts.genesis;
  const hasCard = facts.hasCard;

  const numbered = genesis !== null;
  const serial = numbered ? String(genesis!).padStart(4, '0') : null;
  const [mrz1, mrz2] = mrzLines(decoded, genesis);
  const mono = 'JetBrains Mono, monospace';
  const status = hasCard ? 'Card published' : 'No record yet';
  const accent = numbered ? GOLD : TAN;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: CANVAS,
          padding: 60,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: `linear-gradient(180deg, ${CARD_TOP} 0%, ${CARD_BOTTOM} 100%)`,
            border: `${numbered ? '3px' : '2px'} solid ${numbered ? GOLD : CARD_EDGE}`,
            borderRadius: 36,
            padding: '56px 72px 48px',
            boxSizing: 'border-box',
          }}
        >
          {/* Header: emblem + wordmark left, tier right. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 6,
                  width: 68,
                  height: 48,
                  border: `3px solid ${TAN}`,
                  borderRadius: 14,
                  padding: '0 14px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', width: 32, height: 4, background: TAN }} />
                <div style={{ display: 'flex', width: 20, height: 4, background: TAN }} />
              </div>
              <div
                style={{
                  display: 'flex',
                  marginLeft: 20,
                  fontSize: 40,
                  fontWeight: 700,
                  color: '#ffffff',
                }}
              >
                {config.productName}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontFamily: mono,
                  fontSize: numbered ? 24 : 26,
                  fontWeight: 700,
                  color: accent,
                  letterSpacing: 4,
                }}
              >
                {numbered ? 'GENESIS PASSPORT' : 'AI PASSPORT'}
              </div>
              {serial !== null ? (
                <div
                  style={{
                    display: 'flex',
                    fontFamily: mono,
                    fontSize: 20,
                    color: GOLD_SOFT,
                    letterSpacing: 2,
                  }}
                >
                  {`No. ${serial} / 1000`}
                </div>
              ) : null}
            </div>
          </div>

          {/* Name. */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 64 }}>
            <div
              style={{
                display: 'flex',
                fontFamily: mono,
                fontWeight: 700,
                fontSize: nameSize(decoded),
                color: CREAM,
                lineHeight: 1.05,
                wordBreak: 'break-all',
              }}
            >
              {decoded.toLowerCase()}
            </div>
            <div
              style={{
                display: 'flex',
                fontFamily: mono,
                fontSize: 44,
                color: numbered ? GOLD : GOLD_SOFT,
                marginTop: 10,
              }}
            >
              {`.${config.rootName}`}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              width: '100%',
              height: 2,
              background: numbered ? 'rgba(201,168,76,0.6)' : RULE,
              marginTop: 40,
            }}
          />

          {/* Fields + genesis seal. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              marginTop: 44,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginRight: serial !== null ? 24 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 56 }}>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: mono,
                    fontSize: 22,
                    color: LABEL,
                    letterSpacing: 3,
                    width: 190,
                  }}
                >
                  STATUS
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 32,
                    fontWeight: 700,
                    color: '#ffffff',
                  }}
                >
                  {status}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 56 }}>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: mono,
                    fontSize: 22,
                    color: LABEL,
                    letterSpacing: 3,
                    width: 190,
                  }}
                >
                  STAMPS
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 32,
                    fontWeight: 700,
                    color: '#ffffff',
                  }}
                >
                  0
                </div>
              </div>
            </div>

            {serial !== null ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  width: 190,
                  height: 190,
                  border: `4px solid ${GOLD}`,
                  borderRadius: '50%',
                  marginRight: 16,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: mono,
                    fontSize: 24,
                    fontWeight: 700,
                    color: GOLD,
                    letterSpacing: 3,
                  }}
                >
                  GENESIS
                </div>
                <div style={{ display: 'flex', fontFamily: mono, fontSize: 22, color: GOLD_SOFT }}>
                  {`#${serial}`}
                </div>
              </div>
            ) : null}
          </div>

          {/* Stamps tray. */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              width: '100%',
              marginTop: 40,
              border: `2px dashed ${numbered ? 'rgba(201,168,76,0.45)' : TRAY_EDGE}`,
              borderRadius: 28,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                color: TRAY_TEXT,
                textAlign: 'center',
                padding: '0 40px',
              }}
            >
              Stamps appear here, one for each verified job
            </div>
          </div>

          {/* MRZ footer. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 40,
              // 44 mono glyphs at 24px + 1px tracking ≈ 678px, inside the
              // 736px of card content width — the MRZ must not clip.
              fontFamily: mono,
              fontSize: 24,
              color: numbered ? GOLD_SOFT : MRZ,
              letterSpacing: 1,
              lineHeight: 1.6,
              whiteSpace: 'pre',
            }}
          >
            <div style={{ display: 'flex' }}>{mrz1}</div>
            <div style={{ display: 'flex' }}>{mrz2}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: await loadMonoFonts(),
      headers: { 'cache-control': 'public, max-age=300, s-maxage=3600, swr=60' },
    },
  );
}
