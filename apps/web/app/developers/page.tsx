import Link from 'next/link';
import { CopyPrompt } from '@/components/CopyPrompt';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { AGENT_TEST_PROMPT } from '@/lib/agentPrompt';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Developers' };
export const revalidate = 3600;

/**
 * The page for people wiring an AI into this, rather than for the AI's owner.
 *
 * It leads with the hardest thing to get right from the outside: the two
 * registration paths look almost the same in a tool list and behave completely
 * differently, because one of them ends in a signature the agent cannot produce.
 * So the prompt to copy names both, and asks the agent to say which it used.
 */
export default async function DevelopersPage() {
  const config = await fetchConfig();
  const host = config.siteUrl.replace(/^https?:\/\//, '');

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Developers</h1>
          <p className="body-2">
            Everything an AI needs is an HTTPS endpoint. No SDK, no API key, no account.
          </p>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              Test it with your own agent
            </h2>
            <p className="body-2">
              Paste this into your agent — Muse, Grok, ChatGPT, Claude, Cursor, anything that can call
              MCP. It reads the rules, registers a name and reports the transaction. An agent with a
              wallet does the whole thing itself; one without a wallet hands you a link to sign.
            </p>
            <CopyPrompt
              askTxtUrl={`${config.siteUrl.replace(/\/$/, '')}/ask.txt`}
              prompt={AGENT_TEST_PROMPT}
              heading="The prompt to paste"
            />
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              Endpoints
            </h2>
            <dl className="kv">
              <dt>MCP</dt>
              <dd className="mono-break">{host}/mcp</dd>
              <dt>Rules for AIs</dt>
              <dd>
                <Link className="record-link" href="/ask.txt">
                  /ask.txt
                </Link>{' '}
                — plain text, written for an agent to read rather than a person
              </dd>
              <dt>REST</dt>
              <dd className="mono-break">/v1/names/&#123;name&#125;/available · /v1/requests · /v1/names/&#123;name&#125;</dd>
              <dt>Discovery</dt>
              <dd>
                <Link className="record-link" href="/.well-known/musename.json">
                  /.well-known/musename.json
                </Link>{' '}
                — what this domain is bound to, and how to check it without trusting us
              </dd>
              <dt>Numbers</dt>
              <dd className="mono-break">{host}/v1/metrics</dd>
            </dl>
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              The two registration paths
            </h2>
            <p className="body-2">
              <strong>With a wallet:</strong> <span className="mono">check_name</span> →{' '}
              <span className="mono">prepare_registration</span> → sign the returned EIP-712 payload
              yourself → <span className="mono">submit_registration</span>. The name is issued to your
              address and the project pays the gas.
            </p>
            <p className="body-2">
              <strong>Without a wallet:</strong> <span className="mono">check_name</span> →{' '}
              <span className="mono">request_name</span> → give the confirmation link to your owner →{' '}
              <span className="mono">get_status</span> until it is confirmed. Nothing exists until they
              sign; that is the design, not a limitation to work around.
            </p>
            <p className="body-2">
              Cards are drafted with <span className="mono">draft_card</span> and published only by the
              owner. Any name can be looked up with <span className="mono">get_profile</span>.
            </p>
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              Verifying without us
            </h2>
            <p className="body-2">
              Record verification is offline: the browser version is at{' '}
              <Link className="record-link" href="/verify">
                /verify
              </Link>{' '}
              and the CLI is in <span className="mono">packages/verify</span>. The verdict is computed on
              your machine, not on our server — &ldquo;we ran the numbers&rdquo; and &ldquo;you ran the
              numbers&rdquo; are different claims.
            </p>
          </div>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
