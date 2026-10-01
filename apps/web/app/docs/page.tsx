import Link from 'next/link';
import { DocsLede, StatusTag } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'What is MusePass',
  description:
    'A passport and an account for AI agents: a name any wallet can read, a card another agent can read, and a record built from evidence — what is live and what is design.',
};

// Rendered from the API's own config so the addresses below are the ones the
// running deployment actually answers with, not a copy that ages.
export const revalidate = 300;

export default async function DocsPage() {
  const config = await fetchConfig();
  const { rootName } = config;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">What is MusePass</h1>
            <DocsLede
              status="live"
              lede="A passport and an account for an AI agent: a name that resolves in any wallet, a card that says what it does, and a record built from evidence. The name and the card are live; the account parts are design."
            />

            <p>
              Agents can already pay, hire and be paid. What they cannot do is say who they are, or
              prove what they did, in a form the other side can check without trusting a platform.
              An address has no name, no history and nobody accountable behind it. MusePass gives an
              agent a passport with three things in it:
            </p>

            <div className="three-grid">
              <div className="three-item">
                <StatusTag kind="live" />
                <strong>Pass</strong>
                <p>
                  A name — an ENS subname under <code className="mono">{rootName}</code>, minted as
                  an ERC-721 in the owner&apos;s wallet — plus an ERC-8004 card the owner publishes
                  field by field. Live today, including the part where an AI registers itself.
                </p>
                <Link className="record-link" href="/docs/concepts/passport">
                  The passport →
                </Link>
              </div>
              <div className="three-item">
                <StatusTag kind="design" />
                <strong>Vault</strong>
                <p>
                  A wallet that belongs to the name rather than to whoever happens to run the agent
                  (ERC-6551). Money an agent is trusted with sits with its identity, not with a
                  vendor. In design.
                </p>
                <Link className="record-link" href="/docs/concepts/passport#vault">
                  The design →
                </Link>
              </div>
              <div className="three-item">
                <StatusTag kind="design" />
                <strong>Bond</strong>
                <p>
                  Escrow and a margin the other side can check before a deal: payment released when
                  the work passes the criteria both sides agreed to. In design; nothing that touches
                  money ships before an external audit.
                </p>
                <Link className="record-link" href="/docs/concepts/passport#bond">
                  The design →
                </Link>
              </div>
            </div>

            <h2 className="h3" id="where-to-start">
              Where to start
            </h2>
            <p>Pick the entrance that matches who is reading:</p>
            <ul>
              <li>
                <Link className="record-link" href="/docs/start/people">
                  For people
                </Link>{' '}
                — give your AI a passport in a browser. Names are issued by invitation.
              </li>
              <li>
                <Link className="record-link" href="/docs/start/agents">
                  For AI agents
                </Link>{' '}
                — the rules you follow to register a name for your owner (or for yourself).
              </li>
              <li>
                <Link className="record-link" href="/docs/start/merchants">
                  For merchants
                </Link>{' '}
                — check an AI before you take its order.
              </li>
              <li>
                <Link className="record-link" href="/docs/start/developers">
                  For developers
                </Link>{' '}
                — five minutes to a first API or MCP call.
              </li>
            </ul>

            <h2 className="h3">What is live, in one table</h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Thing</th>
                  <th>Status</th>
                  <th>Check it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Name</td>
                  <td>Live — an ERC-721 on chain {config.chain.chainId}, resolved on mainnet</td>
                  <td>
                    <Link className="record-link" href="/docs/guides/verify">
                      verify it yourself
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td>Card</td>
                  <td>Live — public fields and a hash on chain, private fields never written</td>
                  <td>
                    <Link className="record-link" href="/docs/concepts/passport#card">
                      how it works
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td>Self-registration by an AI</td>
                  <td>Live — MCP, two signing paths</td>
                  <td>
                    <Link className="record-link" href="/docs/reference/mcp">
                      MCP tools
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td>Verified records (stamps)</td>
                  <td>In development — contract written and tested, not deployed</td>
                  <td>
                    <Link className="record-link" href="/docs/guides/verify#not-true">
                      not true yet
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td>Vault and bond</td>
                  <td>In design</td>
                  <td>
                    <Link className="record-link" href="/docs/concepts/passport#vault">
                      the designs
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/start/people">
                Claim your first name
              </Link>
              <Link className="btn" href="/docs/concepts/passport">
                How the passport works
              </Link>
              <Link className="btn" href="/docs/concepts/pricing">
                Pricing and limits
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
