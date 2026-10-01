import Link from 'next/link';
import { DocsLede } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'For AI agents',
  description:
    'The human-readable version of ask.txt: how an AI registers a MusePass name for its owner, or for itself, and the rules it must not break.',
};

export const revalidate = 300;

export default async function StartAgentsPage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">For AI agents</h1>
            <DocsLede
              status="live"
              lede="Everything on this page is also in ask.txt — plain text you can read yourself, at the link below. This page is the same rules for humans."
            />

            <p>
              The canonical text is{' '}
              <a className="record-link" href={`${config.siteUrl}/ask.txt`}>
                {config.siteUrl}/ask.txt
              </a>
              . If the two ever disagree, ask.txt wins. Read it before calling any tool.
            </p>

            <h2 className="h3">Two paths, decided by who signs</h2>
            <p>
              <strong>You have your own wallet:</strong> you are the owner. Call{' '}
              <code className="mono">check_name</code>, then{' '}
              <code className="mono">prepare_registration</code> for the EIP-712 payload, sign it
              with your key, and <code className="mono">submit_registration</code>. The name is
              issued to your address. Names are issued by invitation: if your wallet holds one, the
              project pays the gas and there is no human step; if it does not, the submit is
              refused with <code className="mono">NOT_INVITED</code> and nothing is created — report
              that to your owner instead of retrying.
            </p>
            <p>
              <strong>You have no wallet:</strong> call <code className="mono">check_name</code>,
              then <code className="mono">request_name</code>, and hand your owner the confirmation
              link it returns — good for {config.limits.confirmTokenTtlMinutes} minutes. Nothing is
              registered until they sign. Poll <code className="mono">get_status</code>; their word
              alone is not the answer.
            </p>

            <h2 className="h3">The rules that are the product</h2>
            <ul>
              <li>Someone signs, and it is the owner of the name — you, or the human who owns you.</li>
              <li>Never sign anything you did not read; the payload from prepare_registration is the only one the registrar accepts.</li>
              <li>Report exactly what the tools returned. A missing field stays missing; never fill a gap with a plausible value.</li>
              <li>Do not promise income, returns or rankings.</li>
              <li>
                Keep the three outcomes apart: pass, fail, unproven. &ldquo;Unproven&rdquo; is not a
                pass.
              </li>
              <li>Never ask anyone to paste a private key or seed phrase into a chat, and refuse one if offered.</li>
            </ul>

            <h2 className="h3">The tools</h2>
            <p>
              Nine MCP tools at{' '}
              <code className="mono">{config.siteUrl}/mcp</code> (streamable HTTP), documented in{' '}
              <Link className="record-link" href="/docs/reference/mcp">
                the MCP reference
              </Link>
              . If your client has no MCP, the read-only half is plain REST — see{' '}
              <Link className="record-link" href="/docs/reference/api">
                the REST reference
              </Link>
              .
            </p>

            <div className="docs-next">
              <a className="btn btn-primary" href={`${config.siteUrl}/ask.txt`}>
                Read ask.txt
              </a>
              <Link className="btn" href="/docs/reference/mcp">
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
