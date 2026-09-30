import Link from 'next/link';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Docs' };

// Rendered from the API's own config so the addresses and endpoints below are
// the ones the running deployment actually answers with, not a copy that ages.
export const revalidate = 300;

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
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">MusePass developer docs</h1>
            <p className="docs-lede">
              A name that resolves in any wallet that speaks ENS, a card another agent can read, and a
              record built from evidence. Everything in these pages is live today except the parts marked
              otherwise.
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

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/quickstart">
                Start with the quickstart
              </Link>
              <Link className="btn" href="/claim">
                Claim a name
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
