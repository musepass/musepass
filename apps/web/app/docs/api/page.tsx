import Link from 'next/link';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'REST API' };

export const revalidate = 300;

export default async function ApiPage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">REST API</h1>
            <p className="docs-lede">
              Base URL <code className="mono">{config.siteUrl}/v1</code>. Every answer uses the same
              envelope: <code className="mono">summary</code> for a sentence you can show a person,{' '}
              <code className="mono">data</code> for the structure, <code className="mono">errors</code>{' '}
              for machine-readable reasons, <code className="mono">meta.verified</code> to know whether the
              chain was actually read.
            </p>

            <table className="docs-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/config</code>
                  </td>
                  <td>Brand, chain, addresses, price ladder. Everything the front end renders comes from here.</td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/names/:name/available</code>
                  </td>
                  <td>
                    Availability, policy result, and the price if it is a short name. Reads the registry,
                    so it cannot say yes about a name that exists. Add{' '}
                    <code>?owner=0x…</code> to also learn whether that wallet is invited to take a short
                    name.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/names/:name</code>
                  </td>
                  <td>
                    Owner, card (public fields only), track record, and the genesis cover number when the
                    name has one.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/names?owner=0x…</code>
                  </td>
                  <td>Every name a wallet holds, read from the registrar&apos;s events.</td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/names/:name/card/versions</code>
                  </td>
                  <td>Every published version of a card, with its content hash.</td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">PUT</span>
                  </td>
                  <td>
                    <code>/names/:name/card</code>
                  </td>
                  <td>
                    Publish a card. Requires the owner&apos;s signature; the platform pays the gas.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">POST</span>
                  </td>
                  <td>
                    <code>/requests</code>
                  </td>
                  <td>
                    Start a registration and get a confirmation link for the owner. Nothing is minted
                    here.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/requests/:id</code>
                  </td>
                  <td>Whether the owner has signed yet, and the transaction if they have.</td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">POST</span>
                  </td>
                  <td>
                    <code>/names/claim</code>
                  </td>
                  <td>
                    Finish a registration with an EIP-712 signature. This is the call the self-signing
                    agent path uses.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/invitations</code>
                  </td>
                  <td>
                    How many invitations exist and how many are spent. Counts only — the API never
                    publishes which wallets or handles are invited.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/genesis</code>
                  </td>
                  <td>
                    The genesis cover list: the first 1,000 names that published a card, in registration
                    order. A derived view of chain events, not a mint.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/metrics</code>
                  </td>
                  <td>On-chain counts, and an explicit list of what it cannot measure yet.</td>
                </tr>
              </tbody>
            </table>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/mcp">
                MCP tools
              </Link>
              <Link className="btn" href="/docs/quickstart#http">
                Plain HTTP examples
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
