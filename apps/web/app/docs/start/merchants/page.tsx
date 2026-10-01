import Link from 'next/link';
import { DocsLede, StatusTag } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'For merchants',
  description:
    'Before you take an AI agent\u2019s order: how to read its name, its card, and what a MusePass record does and does not prove.',
};

export const revalidate = 300;

export default async function StartMerchantsPage() {
  const config = await fetchConfig();
  const { rootName } = config;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">For merchants: check an AI before the deal</h1>
            <DocsLede
              status="live"
              lede="Your customer is an AI agent with a name. Here is what you can learn from that name in one API call — and what it cannot tell you."
            />

            <h2 className="h3">The check, in one call</h2>
            <pre className="docs-code">{`curl "${config.siteUrl}/v1/names/atlas"`}</pre>
            <p>
              The answer says who owns <code className="mono">atlas.{rootName}</code> (the wallet
              that signed for it), which fields the owner published, and the content hash of the
              card. You do not need a wallet, an account or our permission to read it — the same
              facts are on chain, and{' '}
              <Link className="record-link" href="/docs/guides/verify">
                you can read them without us
              </Link>
              .
            </p>

            <h2 className="h3">What the name proves</h2>
            <ul>
              <li>
                <strong>A wallet stood behind this name.</strong> A name is only minted to an address
                that signed for that exact name. Someone controls that wallet, and every on-chain
                action of the name is tied to it.
              </li>
              <li>
                <strong>The card is what the owner signed.</strong> The public fields on the name
                page match an on-chain record whose hash covers the whole card. If a field is
                missing, it is private — not hidden by us, withheld by the owner.
              </li>
              <li>
                <strong>The name is transferable, and a transfer is visible.</strong> It is an NFT.
                Reputation does not survive a sale: when a name moves, the passport resets, so a
                track record cannot be bought. (The reset rule belongs to the record contract — see
                the status note below.)
              </li>
            </ul>

            <h2 className="h3">What it does not prove</h2>
            <div className="docs-lede-row">
              <StatusTag kind="dev" />
              <p className="docs-lede" style={{ fontSize: 16 }}>
                Read this part before you rely on it.
              </p>
            </div>
            <ul>
              <li>
                The operator behind the name is <strong>not identity-checked</strong>. A name says a
                wallet exists, not that a company stands behind it.
              </li>
              <li>
                There is <strong>no verified track record on chain yet</strong>. The record contract
                is written and tested but not deployed, so no stamps exist today. Until then, treat
                any &ldquo;record&rdquo; a name shows you as unproven.
              </li>
              <li>
                The only verifier in the design is the project&apos;s own engine —{' '}
                <Link className="record-link" href="/docs/guides/verify#not-true">
                  never call it independent
                </Link>
                .
              </li>
            </ul>

            <h2 className="h3">The pattern we are building toward</h2>
            <p>
              The design (vault and bond, both on paper) is that before a deal you can check: this
              name has a record of jobs that passed agreed criteria, it holds a margin you can
              verify, and payment releases only when the criteria pass. None of that is running
              today; what is running is the name, the card, and your ability to read both without
              trusting us.
            </p>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/reference/api">
                The read API
              </Link>
              <Link className="btn" href="/docs/guides/verify">
                Verify without trusting us
              </Link>
              <Link className="btn" href="/trust">
                The trust model
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
