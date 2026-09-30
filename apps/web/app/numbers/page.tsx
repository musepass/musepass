import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ApiError, fetchConfig, fetchInvitations, fetchMetrics, type InvitationsData, type MetricsData } from '@/lib/api';

export const metadata = { title: 'Numbers' };
/**
 * Rendered per request, not prerendered.
 *
 * `revalidate` would bake whatever the build machine could reach into the first
 * HTML — and the build machine is the developer laptop, where the API is not
 * running. The first deploy of this page served "cannot reach the name service"
 * as a static page, which is exactly the kind of failure that looks like a
 * product problem instead of a deployment one. The API already caches the chain
 * read for five minutes, so a live render costs nothing extra.
 */
export const dynamic = 'force-dynamic';

/**
 * The API answers with a stable id and a machine-readable reason. This page
 * rewrites the known ids into the plainest sentence we can stand behind; an
 * unknown id still renders with whatever the API sent, rather than vanishing.
 */
const GAP_COPY: Record<string, { title: string; why: string }> = {
  queries_by_others: {
    title: 'Who besides us has looked anything up',
    why: 'API and MCP calls are not counted per caller yet. Our own test runs would inflate the number, so we would rather report nothing than report that.',
  },
  records: {
    title: 'Records and verdicts',
    why: 'The record registry is written and tested but not deployed, so there is nothing on chain to read.',
  },
  external_verifier_records: {
    title: 'Records issued by a verifier outside our team',
    why: 'The only verifier today is our own engine (the project's own engine). Calling that independent verification would be false.',
  },
  unique_users: {
    title: 'Distinct users',
    why: 'A name maps to a wallet address, and one person can hold several. Counting addresses as people would be a guess.',
  },
};

/**
 * The public numbers.
 *
 * Two rules this page follows, both borrowed from the API it renders:
 *
 *   1. The count of names comes from the chain and says so; the index numbers are
 *      labelled as index numbers, because a memory index is emptied by a restart
 *      and would otherwise look like a fact about the world.
 *   2. What cannot be measured yet is printed too, with the reason. A dashboard
 *      that only shows what flatters it is a brochure.
 *
 * An empty page would be a poor look and a good signal: if the numbers are not
 * worth showing, the honest response is to build something people use, not to
 * hide the page.
 */
export default async function NumbersPage() {
  const config = await fetchConfig();
  let metrics: MetricsData | null = null;
  let invitations: InvitationsData | null = null;
  let error: string | null = null;
  try {
    metrics = (await fetchMetrics()).data;
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'The numbers could not be read. Try again shortly.';
  }
  try {
    invitations = (await fetchInvitations()).data;
  } catch {
    // The invitation section simply does not render; the rest of the page is
    // still true without it.
  }

  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="body-2" style={{ margin: 0 }}>
        {label}
      </span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Numbers</h1>
          <p className="body-2">
            This page only carries things you can check. The name count comes from the chain&apos;s own
            events, so anyone can count it themselves; index numbers say where they come from; and what
            cannot be measured yet is listed below with the reason, rather than left out.
          </p>

          {error || !metrics ? (
            <div className="notice notice-warn">
              {error ?? 'The numbers could not be read. Try again shortly.'}
            </div>
          ) : (
            <>
              <h2 className="faq-q" style={{ fontSize: 18 }}>
                Names
              </h2>
              {row(
                'Registered on chain (from the NameRegistered event)',
                metrics.chain.names === null ? 'chain not readable right now' : metrics.chain.names,
              )}
              {row('Distinct holder addresses on chain', metrics.chain.owners)}
              {row(
                'Rows in the index',
                `${metrics.index.names} (${metrics.index.kind === 'memory' ? 'in-memory index' : 'database index'})`,
              )}
              {row('Of those, cards published', metrics.namesWithCard)}

              {metrics.index.warning ? (
                <p className="body-2" style={{ fontSize: 14, opacity: 0.75 }}>
                  Note: the index lives{' '}
                  {metrics.index.kind === 'memory' ? 'in memory, and a restart empties it' : 'in the database'},
                  so the index numbers above only say what this process has seen. They are not a statement
                  about the chain — the chain is the complete record.
                </p>
              ) : null}

              <p className="body-2" style={{ fontSize: 14 }}>
                Check it yourself: read the registrar&apos;s <span className="mono">NameRegistered</span>{' '}
                events, or run <span className="mono">pnpm snapshot:names</span> in this repository.
              </p>

              {invitations ? (
                <>
                  <h2 className="faq-q" style={{ fontSize: 18, marginTop: 24 }}>
                    Invitations{invitations.campaign ? ` (${invitations.campaign})` : ''}
                  </h2>
                  <p className="body-2" style={{ fontSize: 14 }}>
                    Short names (3–4 characters) are invitation only. This is the ledger of that
                    campaign — counts only: which wallets and accounts were invited is not published,
                    on purpose.
                  </p>
                  {row('Invitations issued', invitations.issued)}
                  {row('Spent on a short name', invitations.claimed)}
                  {row('Still open', invitations.remaining)}
                  {invitations.rule ? (
                    <p className="body-2" style={{ fontSize: 14, opacity: 0.75 }}>
                      The invitation covers a name of {invitations.rule.min}–{invitations.rule.max}{' '}
                      display units, one name per invitation. The spend count comes from the{' '}
                      {invitations.claimsSource === 'postgres' ? 'database' : 'in-memory'} ledger
                      {invitations.claimsSource === 'memory'
                        ? ', so a restart of the service can undercount it until the database is attached'
                        : ''}
                      .
                    </p>
                  ) : null}
                </>
              ) : null}

              <h2 className="faq-q" style={{ fontSize: 18, marginTop: 24 }}>
                Not measurable yet
              </h2>
              <ul className="body-2" style={{ paddingLeft: 18 }}>
                {metrics.notMeasured.map((entry) => (
                  <li key={entry.id} style={{ marginBottom: 8 }}>
                    <strong>{GAP_COPY[entry.id]?.title ?? entry.metric}</strong>:{' '}
                    {GAP_COPY[entry.id]?.why ?? entry.why}
                  </li>
                ))}
              </ul>

              <p className="body-2" style={{ fontSize: 14 }}>
                For who can do what, and the risks, see the{' '}
                <Link className="record-link" href="/trust">
                  trust model
                </Link>
                . For what a batch of numbers can and cannot be made to say, see{' '}
                <Link className="record-link" href="/anchors">
                  anchored batches
                </Link>
                .
              </p>
            </>
          )}
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
