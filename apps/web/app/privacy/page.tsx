import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Privacy',
  description: 'What MusePass stores, what goes on chain, and what never does.',
};
export const revalidate = 3600;

/**
 * The real policy. Written before the giveaway opens, and kept to what the
 * code actually does — each paragraph names the table or record it describes.
 */
export default async function PrivacyPage() {
  const config = await fetchConfig();

  const section = (title: string, children: React.ReactNode) => (
    <>
      <h2 className="h3">{title}</h2>
      <div className="body-2">{children}</div>
    </>
  );

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Privacy</h1>
          <p className="body-2">
            Short version: we keep the working records a name service needs, we publish nothing about
            you that the chain does not already publish, and the private fields of your card never
            leave your hands. Last updated 2026-10-01.
          </p>

          {section(
            'What is on chain (public, permanent)',
            <p>
              A registered name and its owning wallet address are on a public blockchain by
              construction — that is the product. When you publish a card, what gets written to the
              name&apos;s text record is <strong>only the fields you marked public</strong>, plus a
              hash of the whole card. Fields you keep private are not in the transaction, not in the
              record, and not in the bytes you sign. Records published before 2026-10-01 contained
              the whole card as the owner submitted it; those cannot be deleted, and that format is
              not used any more.
            </p>,
          )}

          {section(
            'What we store on our server',
            <ul style={{ paddingLeft: 18 }}>
              <li>
                The name index: label, owner address, transaction hash, registration date — the same
                facts the chain already publishes.
              </li>
              <li>
                The sponsorship ledger: which wallet&apos;s registration gas we paid, and the
                transaction hash, so the free-name budget can be counted and published.
              </li>
              <li>
                Registration requests: the label, an expiry, a hashed confirmation token, and the
                requesting host — deleted or expired after{' '}
                {config.limits.confirmTokenTtlMinutes} minutes of life.
              </li>
              <li>
                Invitation spend records: the wallet address, the label it took, the transaction
                hash. Counts are published; the list of who was invited is not.
              </li>
              <li>
                Card version metadata: the content hash and your visibility choices. The private
                contents of cards are not stored.
              </li>
            </ul>,
          )}

          {section(
            'What we do not do',
            <ul style={{ paddingLeft: 18 }}>
              <li>No accounts, no passwords, no email collection.</li>
              <li>
                No third-party analytics, advertising or tracking scripts are loaded by this site.
              </li>
              <li>
                We do not sell, rent or &ldquo;share&rdquo; anything — there is nothing to share
                beyond the public chain records above.
              </li>
            </ul>,
          )}

          {section(
            'Server logs',
            <p>
              The site and API keep standard request logs (IP address, path, timestamp) and use them
              for rate limiting and abuse prevention. Rate-limit counters live in memory and reset
              when the service restarts.
            </p>,
          )}

          {section(
            'Deletion',
            <p>
              On-chain records cannot be deleted by anyone, including us. Our working records
              (index, logs, requests) are operational data tied to public chain events; write to us
              at <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a> with questions
              or removal requests and we will say plainly what is and is not possible.
            </p>,
          )}

          <p className="body-2" style={{ opacity: 0.75 }}>
            This page describes today&apos;s product. If a feature is added that changes what is
            collected, this page changes with it before the feature opens.
          </p>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
