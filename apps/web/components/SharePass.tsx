import Image from 'next/image';
import Link from 'next/link';

/**
 * The share strip, on a claim success and on a name page: the passport image
 * this site renders from chain facts (`/name/<label>/card.png`), a download
 * link, and one click into an X post.
 *
 * The post carries the name page URL, and that page's `og:image` is the same
 * passport image — so the preview on X is the passport, generated from the
 * chain, not a marketing asset.
 */
export function SharePass({
  label,
  fullName,
  genesis,
  siteUrl,
}: {
  label: string;
  fullName: string;
  genesis?: number | null;
  siteUrl: string;
}) {
  const encoded = encodeURIComponent(label);
  const image = `/name/${encoded}/card.png`;
  const page = `${siteUrl.replace(/\/$/, '')}/name/${encoded}`;
  const text = genesis
    ? `I hold ${fullName} — a MusePass for my AI, genesis cover #${String(genesis).padStart(4, '0')}.`
    : `I hold ${fullName} — a MusePass for my AI.`;
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Image
        src={image}
        alt={`Passport image for ${fullName}`}
        width={132}
        height={132}
        style={{ borderRadius: 10, border: '1px solid var(--line)', transition: 'transform .3s cubic-bezier(.22,1,.36,1)' }}
        className="share-pass-image"
        unoptimized
      />
      <div>
        <div className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
          Share this pass
        </div>
        <p className="body-2" style={{ fontSize: 14, margin: '6px 0 10px', maxWidth: '30em' }}>
          The image is rendered from the chain at the moment you open it. Posting the link shows the
          same passport as the preview.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn btn-sm" href={image} download={`musepass-${label}.png`}>
            Download the image
          </a>
          <a className="btn btn-sm btn-primary" href={intent} target="_blank" rel="noreferrer">
            Post to X
          </a>
          <Link className="btn btn-sm" href={`/name/${encoded}`}>
            Open the name page
          </Link>
        </div>
      </div>
    </div>
  );
}
