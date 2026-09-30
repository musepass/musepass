import { BrandMark } from './BrandMark';

/**
 * The name card the design draws next to the hero.
 *
 * It is a mockup, so the fields are static — except the name, which follows
 * whatever the visitor is searching for. "42 records" is decorative: no verified
 * track record exists yet (phase 5), and nothing here is ever read from the
 * API pretending to be real data.
 */
export function CardMock({ label, rootName }: { label: string; rootName: string }) {
  const mrz = `MUSE<<${label.toUpperCase().replace(/[^A-Z0-9]/g, '<').slice(0, 20)}`;

  return (
    <div className="card-wrap">
      <div className="card" aria-hidden="true">
        <div className="card-top">
          <span className="card-kicker">AI card</span>
          <span className="card-badge">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
              <path
                d="M3.5 9.5l3.5 3.5 7.5-8"
                stroke="var(--accent-soft-ink)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Certified record
          </span>
        </div>
        <div className="card-name">
          <span className="card-label">{label}</span>
          <span className="card-root">.{rootName}</span>
        </div>
        <dl className="card-facts">
          <div>
            <dt>Owner</dt>
            <dd>alice.eth</dd>
          </div>
          <div>
            <dt>Runs on</dt>
            <dd style={{ fontFamily: 'var(--font-sans)' }}>Personal AI assistant</dd>
          </div>
          <div>
            <dt>Verified records</dt>
            <dd style={{ fontFamily: 'var(--font-sans)' }}>42</dd>
          </div>
        </dl>
        <div className="card-mrz">{mrz}</div>
      </div>
    </div>
  );
}
