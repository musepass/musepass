import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'MCP tools' };

export const revalidate = 300;

export default async function McpPage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">MCP tools</h1>
            <p className="docs-lede">
              Endpoint <code className="mono">{config.siteUrl}/mcp</code>, streamable HTTP. Nine tools,
              three paths through them:
            </p>

            <table className="docs-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Path</th>
                  <th>What it returns</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>check_name</code>
                  </td>
                  <td>read</td>
                  <td>Availability, policy, price, and alternatives when the name is taken.</td>
                </tr>
                <tr>
                  <td>
                    <code>get_profile</code>
                  </td>
                  <td>read</td>
                  <td>Owner, public card fields and track record for any name.</td>
                </tr>
                <tr>
                  <td>
                    <code>draft_card</code>
                  </td>
                  <td>read</td>
                  <td>A validated ERC-8004 draft, unpublished. Never claims to have published.</td>
                </tr>
                <tr>
                  <td>
                    <code>request_name</code> → <code>get_status</code>
                  </td>
                  <td>no wallet</td>
                  <td>
                    A confirmation link for the owner, then its state. The honest path for an agent that
                    holds no key.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>prepare_registration</code> → <code>submit_registration</code>
                  </td>
                  <td>own wallet</td>
                  <td>
                    The EIP-712 payload, then the mint. The agent signs for itself; the platform pays the
                    gas.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>prepare_card</code> → <code>submit_card</code>
                  </td>
                  <td>own wallet</td>
                  <td>The card payload, then the on-chain write.</td>
                </tr>
              </tbody>
            </table>
            <p>
              A plain-text version of the rules, written for an AI to read directly:{' '}
              <a href={`${config.siteUrl}/ask.txt`}>{config.siteUrl}/ask.txt</a>.
            </p>

            <h2 id="signer" className="h3">
              Agent signer
            </h2>
            <p>
              For an agent that has no wallet at all, <code className="mono">{config.siteUrl}/signer/mcp</code>{' '}
              provides three tools — <code className="mono">wallet_address</code>,{' '}
              <code className="mono">sign_registration</code>, <code className="mono">sign_card</code> — behind
              a bearer token. The key lives on our server and never reaches the agent. The policy refuses
              anything but our registrar, our chain, deadlines more than an hour out, and 32-byte card
              hashes.
            </p>
            <p className="body-2">
              What this costs you in trust: for these three calls you are trusting our signer to sign the
              right thing. The blast radius is bounded — the key holds almost nothing, the registration gas
              is paid by the platform, and the policy refuses every request that is not our registrar, on
              our chain, with a deadline inside the hour.
            </p>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
