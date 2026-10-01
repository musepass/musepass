import Link from 'next/link';
import { DocsLede, StatusTag } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Economics',
  description:
    'What MusePass charges today, what it refuses to sell, where the money goes, and what a token would and would not be for. No promises about value.',
};

export const revalidate = 300;

/**
 * The public version of the internal financial model (2026-10-01). Every
 * sentence here has to survive two checks: the claims scan (nothing gated
 * leaks) and the honesty rule (a project that sells verifiability publishes
 * what its money is). What this page must never do is promise value — the
 * "no income, no returns, no rankings" rule applies to ourselves first.
 */
export default async function EconomicsPage() {
  const config = await fetchConfig();
  const onSale = config.features.premiumPurchase && config.payment;
  const tiers = [...config.pricing.premiumTiers].sort((a, b) => a.minUnits - b.minUnits);

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">Economics</h1>
            <DocsLede
              status="live"
              lede="What money exists here today, what cannot be bought at any price, and what a protocol token would be for if it ever exists. This page promises nothing about the value of anything."
            />

            <h2 className="h3">Revenue that exists today</h2>
            <p>
              MusePass charges for exactly two things right now, both paid in{' '}
              {config.pricing.currency} on {config.chain.name}:
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>A four-character name</td>
                  <td className="mono">
                    ${tiers.find((tier) => tier.minUnits === 4)?.priceUsd ?? 5}
                  </td>
                  <td>{onSale ? 'Live — a wallet with no invitation can still buy one' : 'Not switched on yet'}</td>
                </tr>
                <tr>
                  <td>A second long name (5+ characters), past the free one</td>
                  <td className="mono">${config.payment?.additionalNameUsd ?? 1}</td>
                  <td>{onSale ? 'Live' : 'Not switched on yet'}</td>
                </tr>
              </tbody>
            </table>
            <p>
              The buyer pays the treasury directly — an ERC-20 transfer the API verifies on chain
              before the project sponsors the registration — so the money never passes through an
              order book, a custodian, or our private keys. The first long name per wallet stays
              free by invitation, and we pay the gas for invited wallets. The full price ladder and
              every cap are on the <Link href="/docs/concepts/pricing">pricing page</Link>, and the
              live numbers — including the zeroes — are at <Link href="/numbers">/numbers</Link>.
            </p>

            <h2 className="h3">Priced, deliberately not sold</h2>
            <p>
              One-, two- and three-character names have approved prices in configuration (
              {tiers
                .filter((tier) => tier.minUnits <= 3)
                .sort((a, b) => b.minUnits - a.minUnits)
                .map((tier) => `${tier.minUnits} = $${tier.priceUsd}`)
                .join(', ·')}
              ) and stay with the project until four-character sales have a track record. Record
              certification is priced at ${config.pricing.certificationMonthlyUsd}/month and exists
              only when the record contract is deployed, which it is not.
            </p>

            <h2 className="h3">What money cannot buy here</h2>
            <ul>
              <li>
                Seats, stamps, scores and reputation are never sold. The only thing a payment gets
                you is the name itself.
              </li>
              <li>
                The 1,000 genesis covers are earned — by being early and publishing a card — not
                minted for a price.
              </li>
              <li>
                <StatusTag kind="design" /> The 1,000 genesis notary seats, when they exist, will be
                applied for, examined, and bonded. Nobody can buy one.
              </li>
            </ul>

            <h2 className="h3">Where the money goes</h2>
            <p>
              Today, all revenue lands in a receive-only treasury address on{' '}
              {config.chain.name}. It pays for sponsored registrations and operations; what is left
              accumulates. The honest caveats: the treasury key is a single operational key until it
              moves to a multisig (published on the <Link href="/trust">trust page</Link>, not
              hidden), and name revenue is seed money, not a business model — it proves real usage
              and pays the gas bill. The intended long-term revenue is service fees (escrow around
              1% when the vault exists, certification, queries), all priced in stablecoin.
            </p>

            <h2 className="h3">
              A protocol token, if ever <StatusTag kind="design" />
            </h2>
            <p>
              There is no token today, no sale, no pre-sale, and nothing to buy that might go up.
              If one is ever launched, this is the whole design, and every part of it is a limit
              rather than a promise:
            </p>
            <ul>
              <li>
                The one hard use would be notary deposits — a locked stake that is slashed for bad
                verification, which is a job requirement, not an investment.
              </li>
              <li>
                Season rewards can never exceed the reward pool balance, and there is no other
                emission. Supply can only be issued below the cap, never above it.
              </li>
              <li>
                Protocol income would buy and burn (30%), rather than pay holders. Real money —
                deposits, escrow, payments — stays in stablecoin and never runs through the token.
              </li>
              <li>
                It launches last, after escrow has real orders and verdicts exist on chain, or it
                does not launch.
              </li>
            </ul>

            <h2 className="h3">The rules we hold ourselves to</h2>
            <ul>
              <li>No promise of income, returns or rankings — including implied ones.</li>
              <li>Anything that touches significant money waits for an external audit.</li>
              <li>
                Every number on this page is either live from{' '}
                <a className="record-link" href={`${config.siteUrl}/v1/config`}>
                  /v1/config
                </a>{' '}
                or says plainly that it is not running yet.
              </li>
            </ul>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/concepts/pricing">
                Prices and caps
              </Link>
              <Link className="btn" href="/trust">
                Who can do what
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
