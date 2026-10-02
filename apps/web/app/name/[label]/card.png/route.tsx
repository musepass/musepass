import { ImageResponse } from 'next/og';
import fs from 'node:fs';
import path from 'node:path';
import { fetchConfig, fetchName } from '@/lib/api';

/**
 * The wallet image for a name (D16/D18): a passport, drawn after the template
 * artwork — dark-green stock, guilloché rings, a globe emblem, STATUS / STAMPS
 * / CHAIN rows, a stamps tray and an MRZ-style footer. Names with a genesis
 * cover get the gold GENESIS PASSPORT treatment. Every value comes from the
 * API at request time, which itself reads it from the chain — nothing here is
 * a database opinion. STAMPS is always 0 until the records contract exists.
 *
 * Honest limit, same as D16: this image is rendered by us. If the site is
 * down the image is down; the name, the ownership and the records do not
 * depend on it.
 */
export const dynamic = 'force-dynamic';
export const size = { width: 1000, height: 1000 };

// Palette from the template artwork.
const CANVAS = '#080f0c';
const CREAM = '#f2edda'; // the name
const GOLD = '#c9a227'; // the one accent gold
const GOLD_PALE = '#d8c584'; // the one muted gold
const TAN = '#e8d9a0'; // emblem + "AI PASSPORT"
const FIELD_LABEL = '#b9a86e';
const MUTED = '#7d9384';
const MRZ = '#a3b39a';

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

/**
 * Satori ships a sans default only; the template's monospace needs a real
 * font file. The TTFs ship with the site in public/fonts and are read from
 * disk (no runtime network dependency); the CDN fetch is only a fallback for
 * environments where the files are missing. Failures never cache.
 */
const monoFontsPromise = (async () => {
  const weights: Array<'400' | '700'> = ['400', '700'];
  const loaded: { name: string; data: ArrayBuffer; weight: 400 | 700 }[] = [];

  const readLocalFont = async (weight: '400' | '700'): Promise<ArrayBuffer | null> => {
    try {
      const buffer = await fs.promises.readFile(
        path.join(process.cwd(), 'public', 'fonts', `jetbrains-mono-${weight}.ttf`),
      );
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    } catch {
      return null;
    }
  };

  for (const weight of weights) {
    let data = await readLocalFont(weight);
    if (!data) {
      try {
        const response = await fetch(
          `https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-${weight}-normal.ttf`,
        );
        if (response.ok) data = await response.arrayBuffer();
      } catch {
        data = null;
      }
    }
    if (data) {
      loaded.push({
        name: 'JetBrains Mono',
        data,
        weight: weight === '400' ? 400 : 700,
      });
    }
  }
  // Satori errors on an empty font list; one face is enough to render.
  return loaded.length > 0
    ? loaded
    : [
        {
          name: 'JetBrains Mono',
          data: (await readLocalFont('400'))!,
          weight: 400 as const,
        },
      ];
})();

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
  if (label.length <= 7) return 104;
  if (label.length <= 10) return 84;
  if (label.length <= 14) return 66;
  if (label.length <= 20) return 50;
  return 40;
}

/** Passport guilloché: nested rings, faint, placed behind the content. */
function Rings({
  size,
  gap,
  color,
  style,
}: {
  size: number;
  gap: number;
  color: string;
  style: Record<string, string | number>;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: size,
        height: size,
        border: `1.5px solid ${color}`,
        borderRadius: '50%',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: size - gap * 2,
          height: size - gap * 2,
          border: `1.5px solid ${color}`,
          borderRadius: '50%',
        }}
      />
    </div>
  );
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
  const gold = numbered ? GOLD : '#9a8a52'; // on the standard card gold is quieter

  const rows: Array<[string, string]> = [
    ['STATUS', status],
    ['STAMPS', '0'],
    ['CHAIN ID', `${config.chain.chainId}`],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: CANVAS,
          padding: 56,
          boxSizing: 'border-box',
        }}
      >
        {/* The card. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background:
              'linear-gradient(158deg, #21523d 0%, #16382a 46%, #102b20 100%)',
            border: `1.5px solid ${numbered ? GOLD : '#2e4d3d'}`,
            borderRadius: 40,
            padding: '52px 72px 48px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            boxShadow: '0 24px 70px rgba(0, 0, 0, 0.55)',
          }}
        >
          {/* Decorations, painted first so the content sits above them. */}

          {/* Sheen across the upper face of the stock. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 460,
              display: 'flex',
              backgroundImage:
                'linear-gradient(118deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 30%, rgba(255,255,255,0) 55%)',
            }}
          />

          {/* Guilloché rings, top right and bottom left. The third ring that
              used to sit bottom-right collided optically with the genesis
              seal; two rings read as texture, three as noise. */}
          <Rings size={420} gap={26} color="rgba(201,162,39,0.10)" style={{ top: -150, right: -130 }} />
          <Rings size={300} gap={22} color="rgba(163,179,154,0.09)" style={{ bottom: -110, left: -120 }} />

          {/* Genesis double frame; the standard card keeps a plain hairline
              so the gold frame reads as the upgrade, not as the only frame. */}
          {numbered ? (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                right: 12,
                bottom: 12,
                display: 'flex',
                border: '1px solid rgba(201,162,39,0.45)',
                borderRadius: 28,
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                right: 12,
                bottom: 12,
                display: 'flex',
                border: '1px solid rgba(163,179,154,0.18)',
                borderRadius: 28,
              }}
            />
          )}

          {/* Vignette at the foot of the card. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              backgroundImage:
                'linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.22) 100%)',
            }}
          />

          {/* Content. */}

          {/* Header: globe emblem + wordmark left, tier right. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* Globe: ring, meridian, two parallels. */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: 74,
                  height: 74,
                  border: `3px solid ${TAN}`,
                  borderRadius: '50%',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    height: 3,
                    background: TAN,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 16,
                    left: 8,
                    right: 8,
                    display: 'flex',
                    height: 3,
                    background: TAN,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    width: 26,
                    height: 26,
                    border: `3px solid ${TAN}`,
                    borderRadius: '50%',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 42,
                    fontWeight: 700,
                    color: '#ffffff',
                    letterSpacing: -0.5,
                  }}
                >
                  {config.productName}
                </div>
                <div
                  style={{
                    display: 'flex',
                    marginTop: 4,
                    fontFamily: mono,
                    fontSize: 17,
                    color: MUTED,
                    letterSpacing: 4,
                  }}
                >
                  AI NAME REGISTRY
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  border: `1.5px solid ${numbered ? GOLD : '#3d5c4b'}`,
                  borderRadius: 999,
                  padding: '10px 22px',
                  fontFamily: mono,
                  fontSize: 20,
                  fontWeight: 700,
                  color: numbered ? GOLD : TAN,
                  letterSpacing: 4,
                }}
              >
                {numbered ? 'GENESIS' : 'AI PASSPORT'}
              </div>
              {serial !== null ? (
                <div
                  style={{
                    display: 'flex',
                    fontFamily: mono,
                    fontSize: 19,
                    color: GOLD_PALE,
                    letterSpacing: 3,
                  }}
                >
                  {`No. ${serial} / 1000`}
                </div>
              ) : null}
            </div>
          </div>

          {/* Name. */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36 }}>
            <div
              style={{
                display: 'flex',
                fontFamily: mono,
                fontWeight: 700,
                fontSize: nameSize(decoded),
                color: CREAM,
                lineHeight: 1.04,
                letterSpacing: -2,
                wordBreak: 'break-all',
              }}
            >
              {decoded.toLowerCase()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, gap: 18 }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: mono,
                  fontSize: 38,
                  color: numbered ? GOLD : GOLD_PALE,
                }}
              >
                {`.${config.rootName}`}
              </div>
              <div style={{ display: 'flex', flex: 1, height: 1.5, background: `${gold}55` }} />
              <div
                style={{
                  display: 'flex',
                  width: 14,
                  height: 14,
                  background: gold,
                  transform: 'rotate(45deg)',
                }}
              />
            </div>
          </div>

          {/* Fields + genesis seal. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              marginTop: 36,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 22,
                marginRight: 36,
              }}
            >
              {rows.map(([key, value]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 48 }}>
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: mono,
                      fontSize: 19,
                      color: FIELD_LABEL,
                      letterSpacing: 4,
                      width: 170,
                    }}
                  >
                    {key}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: mono,
                      fontSize: 26,
                      fontWeight: 700,
                      color: '#ffffff',
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {serial !== null ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 6,
                  width: 176,
                  height: 176,
                  border: `3px dashed ${GOLD}`,
                  borderRadius: '50%',
                  marginRight: 12,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    width: 150,
                    height: 150,
                    border: `1.5px solid rgba(201,162,39,0.5)`,
                    borderRadius: '50%',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: mono,
                      fontSize: 21,
                      fontWeight: 700,
                      color: GOLD,
                      letterSpacing: 3,
                    }}
                  >
                    GENESIS
                  </div>
                  <div style={{ display: 'flex', fontFamily: mono, fontSize: 20, color: GOLD_PALE }}>
                    {`#${serial}`}
                  </div>
                </div>
              </div>
            ) : (
              /* Ghost seal: the standard edition keeps the seal's place in
                 the composition as a faint empty ring, so the layout does
                 not lean left and the gold seal reads as the upgrade. */
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: 176,
                  height: 176,
                  border: '1.5px dashed rgba(163,179,154,0.30)',
                  borderRadius: '50%',
                  marginRight: 12,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 150,
                    height: 150,
                    border: '1px solid rgba(163,179,154,0.20)',
                    borderRadius: '50%',
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      background: 'rgba(154,138,82,0.45)',
                      transform: 'rotate(45deg)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Stamps tray. The label gets its own row and each ghost stamp
              an equal flex column, so the row distributes evenly and nothing
              can collide regardless of tray height. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              width: '100%',
              marginTop: 32,
              border: `1.5px dashed ${numbered ? 'rgba(201,162,39,0.4)' : 'rgba(125,147,132,0.4)'}`,
              borderRadius: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                padding: '18px 26px 0',
                fontFamily: mono,
                fontSize: 16,
                color: MUTED,
                letterSpacing: 4,
              }}
            >
              VERIFIED JOBS
            </div>
            <div style={{ display: 'flex', flex: 1, width: '100%', paddingBottom: 12 }}>
              {/* Ghost stamps: the empty tray shows faint stamp outlines —
                  an intentional motif, not filler copy. */}
              {[
                { outer: 72, inner: 44 },
                { outer: 60, inner: 38 },
                { outer: 66, inner: 40 },
              ].map(({ outer, inner }) => (
                <div
                  key={outer}
                  style={{
                    display: 'flex',
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      width: outer,
                      height: outer,
                      border: '1.5px dashed rgba(163,179,154,0.35)',
                      borderRadius: '50%',
                    }}
                  >
                    <div
                      style={{
                        width: inner,
                        height: inner,
                        border: '1px solid rgba(163,179,154,0.22)',
                        borderRadius: '50%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* MRZ strip. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 32,
              paddingTop: 20,
              borderTop: `1px solid ${numbered ? 'rgba(201,162,39,0.35)' : 'rgba(163,179,154,0.25)'}`,
              // 44 mono glyphs at 24px + 1px tracking ≈ 678px, inside the
              // 736px of card content width — the MRZ must not clip.
              fontFamily: mono,
              fontSize: 24,
              color: numbered ? GOLD_PALE : MRZ,
              letterSpacing: 1,
              lineHeight: 1.5,
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
      fonts: await monoFontsPromise,
      headers: { 'cache-control': 'public, max-age=300, s-maxage=3600, swr=60' },
    },
  );
}
