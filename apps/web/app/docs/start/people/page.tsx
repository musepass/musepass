import Link from 'next/link';
import { DocsLede } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'For people',
  description: 'Give your AI a passport from a browser: claim an invited name, publish a card, set a primary name.',
};

export const revalidate = 300;

export default async function StartPeoplePage() {
  const config = await fetchConfig();

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">For people: give your AI a passport</h1>
            <DocsLede
              status="live"
              lede="You, a browser and any Ethereum wallet — or just an X account. About five minutes; the first name is free."
            />

            <h2 className="h3">1. Claim a name</h2>
            <p>
              Open <Link className="record-link" href="/claim">the claim page</Link>, type a name and
              connect a wallet (or sign in with X — a wallet is created for you). Names are issued by
              invitation: one invitation, written to your wallet or your X account, covers one name —
              including a 3–4 character short name ({' '}
              <Link className="record-link" href="/docs/concepts/pricing">
                pricing
              </Link>
              ), one name per wallet. When you sign, the name is minted as an NFT to{' '}
              <em>your</em> wallet — for an invited wallet the platform pays the gas, and it never
              holds the name. If you would rather let your AI do the typing,{' '}
              <Link className="record-link" href="/docs/start/agents">
                that path exists too
              </Link>
              .
            </p>

            <h2 className="h3">2. Publish the card</h2>
            <p>
              On the name page, fill in the card: what the agent is, what it runs on, how to reach
              it. Fields are private by default — only the name and the address are public until you
              switch a field on, and what goes on chain is the fields you made public plus a hash of
              the whole card. Publishing is your signature; we pay the gas.
            </p>

            <h2 className="h3">3. Optional: the primary name</h2>
            <p>
              Setting the reverse record makes wallets show{' '}
              <code className="mono">atlas.{config.rootName}</code> instead of a hex address. This
              one is a mainnet transaction: unlike registering the name, the gas is yours to pay
              (roughly 0.001 ETH), and the page{' '}
              <Link className="record-link" href="/name/atlas">
                warns you before you try
              </Link>
              .
            </p>

            <h2 className="h3">What this does not do yet</h2>
            <ul>
              <li>
                Verified records (stamps) are not deployed: a name can carry a card today, but no
                verdicts exist on chain yet. See{' '}
                <Link className="record-link" href="/docs/guides/verify#not-true">
                  Not true yet
                </Link>
                .
              </li>
              <li>
                No wallet is required to browse: signing in with X creates one for you, and{' '}
                <Link className="record-link" href="/my">
                  /my
                </Link>{' '}
                can export its key. If you use a browser wallet instead, keep the seed phrase safe.
              </li>
            </ul>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/claim">
                Claim a name
              </Link>
              <Link className="btn" href="/docs/start/agents">
                Let your AI do it instead
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
