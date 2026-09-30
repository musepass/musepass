import Link from 'next/link';
import { CardEditor } from '@/components/CardEditor';
import { PrimaryNameCard } from '@/components/PrimaryNameCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ApiError, fetchConfig, fetchName, type NameData } from '@/lib/api';
import { buildProfileJsonLd, serializeJsonLd } from '@/lib/profileJsonLd';

export async function generateMetadata({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  const config = await fetchConfig();
  return { title: `${decodeURIComponent(label)}.${config.rootName}` };
}

export default async function NamePage({ params }: { params: Promise<{ label: string }> }) {
  const [{ label }, config] = await Promise.all([params, fetchConfig()]);
  const decoded = decodeURIComponent(label);

  let data: NameData | null = null;
  let unavailable = false;
  try {
    const payload = await fetchName(decoded);
    data = payload.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      data = null;
    } else {
      unavailable = true;
    }
  }

  if (unavailable) {
    return (
      <div className="page">
        <div className="container">
          <SiteHeader config={config} expectedChainIds={[config.chain.chainId, 1]} />
          <main className="narrow">
            <h1 className="h2">{decoded}</h1>
            <div className="notice notice-warn">
              The chain could not be read for this name just now. Refresh in a moment — we do not guess.
            </div>
          </main>
          <SiteFooter config={config} />
        </div>
      </div>
    );
  }

  if (data === null) {
    // A 404 is a real answer: nobody owns this name.
    return (
      <div className="page">
        <div className="container">
          <SiteHeader config={config} />
          <main className="narrow">
            <h1 className="h2">
              <span className="mono">{decoded}</span>.{config.rootName}
            </h1>
            <div className="notice notice-info">This name has not been registered.</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" href={`/claim?label=${encodeURIComponent(decoded)}`}>
                Connect a wallet to claim it
              </Link>
              <Link className="btn" href="/">
                Back to the home page
              </Link>
            </div>
          </main>
          <SiteFooter config={config} />
        </div>
      </div>
    );
  }

  const explorer = config.chain.explorer;
  // Structured data for crawlers and other machines. It is built from the same
  // published card the page renders, so nothing private can leak into it.
  const jsonLd = serializeJsonLd(buildProfileJsonLd(data, config));

  return (
    <div className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">
            <span className="mono">{decoded}</span>.{config.rootName}
          </h1>

          <div className="panel">
            <dl className="kv">
              <dt>Owner</dt>
              <dd className="mono-break">
                {data.owner && explorer ? (
                  <a href={`${explorer}/address/${data.owner}`} target="_blank" rel="noreferrer">
                    {data.owner}
                  </a>
                ) : (
                  (data.owner ?? '—')
                )}
              </dd>
              {data.index ? (
                <>
                  <dt>Registered</dt>
                  <dd>{new Date(data.index.registeredAt).toISOString().slice(0, 10)}</dd>
                  <dt>Registered via</dt>
                  <dd>{data.index.registeredVia === 'mcp' ? 'one sentence to an AI' : 'the website'}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              Card
            </h2>
            {data.card ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {data.card.description ? (
                  <p className="body-2" style={{ fontSize: 16 }}>
                    {data.card.description}
                  </p>
                ) : null}

                <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                  {data.card.host ? (
                    <>
                      <dt>Runs on</dt>
                      <dd>{data.card.host}</dd>
                    </>
                  ) : null}
                  {data.card.owner ? (
                    <>
                      <dt>Owner</dt>
                      <dd>{data.card.owner}</dd>
                    </>
                  ) : null}
                  {data.card.contact ? (
                    <>
                      <dt>Contact</dt>
                      <dd>{data.card.contact}</dd>
                    </>
                  ) : null}
                  {data.card.payoutAddress ? (
                    <>
                      <dt>Payout</dt>
                      <dd className="mono-break">{data.card.payoutAddress}</dd>
                    </>
                  ) : null}
                </dl>

                {data.card.services?.length ? (
                  <div>
                    <div className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
                      What it does / how to reach it
                    </div>
                    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {data.card.services.map((service) => (
                        <li key={`${service.name}-${service.endpoint}`} style={{ fontSize: 15 }}>
                          <span className="mono">{service.name}</span>
                          {' · '}
                          <a className="mono-break" href={service.endpoint} target="_blank" rel="noreferrer">
                            {service.endpoint}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {data.card.contentHash ? (
                  <p className="record-sample-label" style={{ margin: 0, color: 'var(--ink-3)' }}>
                    Content hash <span className="mono-break">{data.card.contentHash}</span>
                    <br />
                    The record lives in an ENS text record on chain (key{' '}
                    <span className="mono">musename.card</span>), so anyone can fetch it and recompute this
                    hash for themselves.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="notice notice-info">
                No card has been published. Cards follow the ERC-8004 standard; the owner decides which
                fields to make public, one at a time, and by default only the name and the address are.
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              Track record
            </h2>
            {data.trackRecord ? (
              <pre className="mono-break">{JSON.stringify(data.trackRecord, null, 2)}</pre>
            ) : (
              <div className="notice notice-info">
                No track record yet. A record only holds what evidence can prove, and the criteria are
                registered before the work starts and cannot be changed afterwards.
                {config.features.trackRecord ? '' : ' (Certified records are not open yet.)'}
              </div>
            )}
          </div>

          <CardEditor
            config={config}
            label={decoded}
            fullName={data.fullName}
            ownerAddress={data.owner ?? ''}
            published={data.card}
          />

          <PrimaryNameCard fullName={data.fullName} ownerAddress={data.owner ?? ''} />

          <Link className="btn" href="/">
            Back to the home page
          </Link>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
