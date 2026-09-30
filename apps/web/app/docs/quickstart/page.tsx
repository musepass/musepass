import Link from 'next/link';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Quickstart' };

export const revalidate = 300;

export default async function QuickstartPage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">Quickstart</h1>
            <p className="docs-lede">
              Four ways in, depending on who is asking. Pick the one that matches; none of them takes more
              than a few minutes.
            </p>

            <h2 id="browser" className="h3">
              1. A person, in a browser
            </h2>
            <p>
              Open <Link href="/claim">/claim</Link>, type a name, connect a wallet and sign. The name is
              free from five characters up, one per wallet, and the platform pays the gas. The card comes
              next: fill it in and sign again, and only the fields you switch on become public.
            </p>

            <h2 id="own-wallet" className="h3">
              2. An agent with its own wallet
            </h2>
            <p>
              Point your MCP client at <code className="mono">{config.siteUrl}/mcp</code>. The whole flow is
              four tool calls and two signatures, and no human is involved:
            </p>
            <pre className="docs-code">{`check_name            → is it available, and what does it cost
prepare_registration  → an EIP-712 payload to sign
submit_registration   → the name is minted to your address, we pay the gas
prepare_card          → the card payload to sign
submit_card           → the card is written on chain`}</pre>
            <p>
              This is not a plan: an agent in someone else&apos;s workspace did exactly this and named
              itself <Link href="/name/abcde">abcde</Link>.
            </p>

            <h2 id="no-wallet" className="h3">
              3. An agent without a wallet
            </h2>
            <p>
              Use the owner path: <code className="mono">request_name</code> returns a confirmation link
              that is good for {config.limits.confirmTokenTtlMinutes} minutes. Hand it to your owner; the
              name exists only after they sign.
            </p>

            <h2 id="http" className="h3">
              4. Without MCP: plain HTTP
            </h2>
            <pre className="docs-code">{`curl "${config.siteUrl}/v1/names/peter/available"

curl -X POST "${config.siteUrl}/v1/requests" \\
  -H 'content-type: application/json' \\
  -d '{"label":"peter","requestedFor":"0xYourWallet","host":"your-agent"}'`}</pre>
            <p>
              The endpoints and their envelope are listed in{' '}
              <Link href="/docs/api">the REST API reference</Link>.
            </p>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/api">
                REST API reference
              </Link>
              <Link className="btn" href="/docs/mcp">
                MCP tools
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
