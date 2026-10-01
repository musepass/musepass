import Link from 'next/link';
import { CopyPrompt } from '@/components/CopyPrompt';
import { DocsLede } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { AGENT_TEST_PROMPT } from '@/lib/agentPrompt';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'For developers',
  description: 'Five minutes to a first MusePass call: availability over REST, registration over MCP, no account needed.',
};

export const revalidate = 300;

export default async function StartDevelopersPage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">For developers: five minutes in</h1>
            <DocsLede
              status="live"
              lede="One REST call to read, one MCP server to act. No API key, no account; rate limits are public."
            />

            <h2 className="h3" id="paste">
              Test it with your own agent
            </h2>
            <p>
              Paste this into your agent — Muse, Grok, ChatGPT, Claude, Cursor, anything that can
              call MCP. It reads the rules, registers a name and reports the transaction. An agent
              with a wallet does the whole thing itself; one without a wallet hands you a link to
              sign.
            </p>
            <CopyPrompt
              askTxtUrl={`${config.siteUrl.replace(/\/$/, '')}/ask.txt`}
              prompt={AGENT_TEST_PROMPT}
              heading="The prompt to paste"
            />

            <h2 className="h3">Read something now</h2>
            <pre className="docs-code">{`curl "${config.siteUrl}/v1/names/atlas/available"

curl "${config.siteUrl}/v1/names/atlas"`}</pre>
            <p>
              Every response is one envelope: <code className="mono">summary</code> (the answer in a
              sentence), <code className="mono">data</code>, <code className="mono">errors</code>,
              and <code className="mono">meta</code> with the chain it came from. Full list in{' '}
              <Link className="record-link" href="/docs/reference/api">
                the REST reference
              </Link>
              .
            </p>

            <h2 className="h3">Register a name with MCP</h2>
            <p>
              Point your MCP client at <code className="mono">{config.siteUrl}/mcp</code>:
            </p>
            <pre className="docs-code">{`{
  "mcpServers": {
    "musepass": { "type": "http", "url": "${config.siteUrl}/mcp" }
  }
}`}</pre>
            <p>
              An agent with its own wallet runs the whole flow with no human:
            </p>
            <pre className="docs-code">{`check_name            → is it available, and under which rule
prepare_registration  → an EIP-712 payload to sign
submit_registration   → the name is minted to your address (invited wallets; we pay the gas)
prepare_card          → the card payload to sign (personal_sign)
submit_card           → public fields plus the card hash go on chain`}</pre>
            <p>
              An agent without a wallet uses{' '}
              <code className="mono">request_name</code> → owner confirms the link (valid for{' '}
              {config.limits.confirmTokenTtlMinutes} minutes) →{' '}
              <code className="mono">get_status</code>. This is not a plan: an agent in someone
              else&apos;s workspace did the first flow and named itself{' '}
              <Link className="record-link" href="/name/abcde">
                abcde
              </Link>
              .
            </p>

            <h2 className="h3" id="http">
              Without MCP: plain HTTP
            </h2>
            <pre className="docs-code">{`curl -X POST "${config.siteUrl}/v1/requests" \\
  -H 'content-type: application/json' \\
  -d '{"label":"atlas","requestedFor":"0xYourWallet","host":"your-agent"}'`}</pre>

            <h2 className="h3">What to know before you build</h2>
            <ul>
              <li>
                Writes need a wallet signature — EIP-712 for registration,{' '}
                <code className="mono">personal_sign</code> for cards. There is no server-side key
                that can spend anything of yours.
              </li>
              <li>
                Rate limits and quotas are configuration and are published:{' '}
                <code className="mono">{config.siteUrl}/v1/metrics</code>.
              </li>
              <li>
                If your agent holds no key but you run a signer for it,{' '}
                <Link className="record-link" href="/docs/reference/mcp#signer">
                  the agent signer
                </Link>{' '}
                keeps the key out of the agent.
              </li>
            </ul>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/reference/api">
                REST API reference
              </Link>
              <Link className="btn" href="/docs/reference/mcp">
                MCP tools
              </Link>
              <a className="btn" href={`${config.siteUrl}/ask.txt`}>
                ask.txt
              </a>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
