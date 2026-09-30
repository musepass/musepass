import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Docs' };

// Rendered from the API's own config so the addresses and endpoints below are
// the ones the running deployment actually answers with, not a copy that ages.
export const revalidate = 300;

const SECTIONS: Array<{ group: string; items: Array<{ href: string; label: string }> }> = [
  {
    group: 'Start',
    items: [
      { href: '#overview', label: 'What this is' },
      { href: '#quickstart', label: 'Quickstart' },
      { href: '#concepts', label: 'Concepts' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { href: '#api', label: 'REST API' },
      { href: '#mcp', label: 'MCP tools' },
      { href: '#signer', label: 'Agent signer' },
    ],
  },
  {
    group: 'Trust',
    items: [
      { href: '#verify', label: 'Verify us yourself' },
      { href: '#rules', label: 'Rules and limits' },
      { href: '#not-true', label: 'Not true yet' },
    ],
  },
];

export default async function DocsPage() {
  const config = await fetchConfig();
  const { rootName } = config;
  const registry = config.l2Registry ?? '0x…';
  const registrar = config.registrar ?? '0x…';

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <aside className="docs-side">
            {SECTIONS.map((section) => (
              <div key={section.group}>
                <span className="docs-side-title">{section.group}</span>
                <nav className="docs-nav" aria-label={section.group}>
                  {section.items.map((item) => (
                    <a key={item.href} href={item.href}>
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            ))}
            <span className="docs-side-title">Elsewhere</span>
            <nav className="docs-nav" aria-label="Elsewhere">
              <Link href="/name/peter">A real name page</Link>
              <Link href="/verify">Verify a record</Link>
              <a href="https://github.com/musepass/musepass">Source</a>
            </nav>
          </aside>

          <main className="docs-main">
            <h1 className="h2">MusePass developer docs</h1>
            <p className="docs-lede">
              A name that resolves in any wallet that speaks ENS, a card another agent can read, and a
              record built from evidence. Everything on this page is live today except the parts marked
              otherwise at the bottom.
            </p>

            <h2 id="overview" className="h3">
              What this is
            </h2>
            <p>
              MusePass is a naming and identity layer for AI agents. A name is an ENS subname under{' '}
              <code className="mono">{rootName}</code>, minted as an ERC-721 on Robinhood Chain (chainId{' '}
              {config.chain.chainId}) and resolved on Ethereum mainnet through a CCIP-Read resolver. The
              card is written to the name&apos;s own on-chain record by the owner&apos;s signature.
            </p>
            <pre className="docs-code">{`wallet or agent asks ENS   →   mainnet resolver   →   CCIP-Read   →   gateway   →   names live here
        name → address         0x9eA7A889…            (ERC-3668)      gw.musename.xyz    Robinhood Chain ${config.chain.chainId}
                                                                                    registry ${registry}
                                                                                    registrar ${registrar}`}</pre>
            <p>
              The split is deliberate. The name has to be readable by every wallet, so it lives in ENS on
              mainnet. Minting has to be cheap, so the registry lives on an L2. The resolver is a deployed
              copy of <a href="https://github.com/ensdomains/durin">ensdomains/durin</a>; we did not write a
              name system, we run one.
            </p>

            <h2 id="quickstart" className="h3">
              Quickstart
            </h2>
            <h3 className="body-1">1. A person, in a browser</h3>
            <p>
              Open <Link href="/claim">/claim</Link>, type a name, connect a wallet and sign. The name is
              free from five characters up, one per wallet, and the platform pays the gas. The card comes
              next: fill it in and sign again, and only the fields you switch on become public.
            </p>

            <h3 className="body-1">2. An agent with its own wallet</h3>
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

            <h3 className="body-1">3. An agent without a wallet</h3>
            <p>
              Use the owner path: <code className="mono">request_name</code> returns a confirmation link
              that is good for {config.limits.confirmTokenTtlMinutes} minutes. Hand it to your owner; the
              name exists only after they sign.
            </p>

            <h3 className="body-1">4. Without MCP: plain HTTP</h3>
            <pre className="docs-code">{`curl "${config.siteUrl}/v1/names/peter/available"

curl -X POST "${config.siteUrl}/v1/requests" \\
  -H 'content-type: application/json' \\
  -d '{"label":"peter","requestedFor":"0xYourWallet","host":"your-agent"}'`}</pre>

            <h2 id="concepts" className="h3">
              Concepts
            </h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Thing</th>
                  <th>What it is</th>
                  <th>Where it lives</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Name</strong>
                  </td>
                  <td>
                    An ERC-721. Owning it is owning the name; it moves with the wallet and works without
                    us. This is the only token the project issues.
                  </td>
                  <td>
                    registry <code className="mono">{registry}</code> on chain {config.chain.chainId}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Card</strong>
                  </td>
                  <td>
                    An ERC-8004 document: what the agent is, what it runs on, how to reach it. Not a
                    token. Private by default — only the name and the address are public until the owner
                    switches a field on.
                  </td>
                  <td>
                    the name&apos;s text record, signed by the owner
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Stamps</strong>
                  </td>
                  <td>
                    One per job that passes verification. Not tokens either — data on the name. A transfer
                    resets them, which is the point: reputation cannot be bought.
                  </td>
                  <td>
                    the record contract (written, tested, <strong>not deployed</strong>)
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Anchor</strong>
                  </td>
                  <td>
                    A merkle root of a day&apos;s records, written into a transaction so a later change
                    would be visible.
                  </td>
                  <td>
                    chain {config.chain.chainId}, see <Link href="/anchors">anchored batches</Link>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Primary name</strong>
                  </td>
                  <td>
                    The reverse record that makes a wallet show a name instead of a hex address. The owner
                    sets it, on mainnet, with their own transaction.
                  </td>
                  <td>addr.reverse on Ethereum mainnet</td>
                </tr>
              </tbody>
            </table>

            <h2 id="api" className="h3">
              REST API
            </h2>
            <p>
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
                    so it cannot say yes about a name that exists.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-badge">GET</span>
                  </td>
                  <td>
                    <code>/names/:name</code>
                  </td>
                  <td>Owner, card (public fields only) and track record.</td>
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
                    <code>/metrics</code>
                  </td>
                  <td>On-chain counts, and an explicit list of what it cannot measure yet.</td>
                </tr>
              </tbody>
            </table>

            <h2 id="mcp" className="h3">
              MCP tools
            </h2>
            <p>
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

            <h2 id="verify" className="h3">
              Verify us yourself
            </h2>
            <p>Nothing below needs our API, our server or our permission.</p>
            <pre className="docs-code">{`# who owns a name: read the registry, not our answer
cast call ${registry} 'owner(bytes32)(address)' <node> --rpc-url https://rpc.mainnet.chain.robinhood.com

# that a card is the card: read the text record, recompute the hash, compare
cast call ${registry} 'text(bytes32,string)(string)' <node> "erc8004:card" --rpc-url …

# that a batch of records existed at a point in time
node packages/verify/dist/cli.js --anchor-data <tx input> --records <records.json>

# the whole local path, on a throwaway chain, with no keys and no testnet money
pnpm verify:local`}</pre>
            <p>
              Or in a browser: <Link href="/verify">verify a record</Link>, plus the public numbers at{' '}
              <Link href="/numbers">/numbers</Link>.
            </p>

            <h2 id="rules" className="h3">
              Rules and limits
            </h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Free names</td>
                  <td>
                    {config.pricing.freeMinUnits} display units or more (a CJK character counts as two),{' '}
                    {config.limits.freeNamesPerWallet} per wallet. We pay the gas.
                  </td>
                </tr>
                <tr>
                  <td>Short names</td>
                  <td>
                    Priced by length:{' '}
                    {[...config.pricing.premiumTiers]
                      .sort((a, b) => b.minUnits - a.minUnits)
                      .map((tier) => `${tier.minUnits} $${tier.priceUsd}`)
                      .join(' · ')}
                    .{' '}
                    {config.features.premiumPurchase
                      ? 'On sale.'
                      : 'Not on sale yet, and there is no purchase endpoint to call.'}
                  </td>
                </tr>
                <tr>
                  <td>Reserved names</td>
                  <td>
                    Brand, platform, public-figure and system names are refused outright, including the
                    digit-substitution lookalikes. A reserved name cannot be bought either.
                  </td>
                </tr>
                <tr>
                  <td>Confirmation links</td>
                  <td>{config.limits.confirmTokenTtlMinutes} minutes, single use.</td>
                </tr>
                <tr>
                  <td>Rate limits</td>
                  <td>Applied per caller on the MCP endpoint; the API answers 429 with a retry hint.</td>
                </tr>
              </tbody>
            </table>

            <h2 id="not-true" className="h3">
              Not true yet
            </h2>
            <p>
              A project that sells verifiability should be the first to publish what it cannot do. The
              build fails if this list is contradicted by a more confident sentence elsewhere.
            </p>
            {/* claims-allow-block: name-not-modifiable — these rows exist to deny the claims they quote */}
            {/* claims-allow-block: independent-verifier — same reason */}
            {/* claims-allow-block: record-not-modifiable — same reason */}
            {/* claims-allow-block: external-audit — same reason */}
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Claim we do not make</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>&ldquo;Nobody can change your name.&rdquo;</td>
                  <td>
                    The registry admin is an operational key, and it can add a registrar. Moving that
                    permission to a multisig has been decided and not done; until then a watchdog reports
                    the moment the power is used.
                  </td>
                </tr>
                <tr>
                  <td>&ldquo;Independently verified.&rdquo;</td>
                  <td>The only verifier today is our own engine, from the same team.</td>
                </tr>
                <tr>
                  <td>&ldquo;Records cannot be altered.&rdquo;</td>
                  <td>
                    The append-only record contract is written and tested and not deployed. What is on
                    chain today is an anchor: a merkle root inside a transaction.
                  </td>
                </tr>
                <tr>
                  <td>&ldquo;Audited.&rdquo;</td>
                  <td>No external audit has been done. Anything that touches money waits for one.</td>
                </tr>
              </tbody>
            </table>
            {/* claims-allow-end: * */}

            <div className="docs-next">
              <Link className="btn btn-primary" href="/claim">
                Claim a name
              </Link>
              <Link className="btn" href="/name/abcde">
                See a name an agent claimed
              </Link>
              <a className="btn" href={`${config.siteUrl}/ask.txt`}>
                Read ask.txt
              </a>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
