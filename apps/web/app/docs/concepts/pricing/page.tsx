import Link from 'next/link';
import { DocsLede, StatusTag } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig, fetchMetrics } from '@/lib/api';

export const metadata = {
  title: 'Pricing and limits',
  description:
    'Names are issued by invitation; for invited wallets the first name is free. Four-character names and additional names have approved prices. Every cap is published.',
};

export const revalidate = 300;

export default async function PricingConceptPage() {
  const [config, metrics] = await Promise.all([
    fetchConfig(),
    fetchMetrics().catch(() => null),
  ]);
  const tiers = [...config.pricing.premiumTiers].sort((a, b) => b.minUnits - a.minUnits);
  const budget = metrics?.data?.budget ?? null;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">Pricing and limits</h1>
            <DocsLede
              status="live"
              lede="Names are issued by invitation, one per wallet, and for invited wallets we pay the gas. Four-character names and additional long names have approved prices. The caps are published live."
            />

            <h2 className="h3">Invited names</h2>
            <ul>
              <li>
                One invitation, written to a wallet address or an X account, covers one name —
                including a 3–4 character short name. A wallet without an invitation is refused on
                the free rail, at any length.
              </li>
              <li>
                Registration is sponsored for invited wallets: the project pays the gas, your wallet
                pays nothing.
              </li>
              <li>
                Labels: no emoji, no leading or trailing hyphen, no mixed confusable scripts — the
                availability endpoint says which rule rejected a name, and &ldquo;taken&rdquo; is
                not an error.
              </li>
            </ul>

            <h2 className="h3">Short and additional names: the price ladder</h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Length</th>
                  <th>Approved price</th>
                  <th>Status today</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td>
                      {tier.minUnits} character{tier.minUnits === 1 ? '' : 's'}
                    </td>
                    <td>${tier.priceUsd}</td>
                    <td>
                      {tier.minUnits <= 2
                        ? 'held by the project, not for sale'
                        : tier.sellable
                          ? `on sale for ${config.pricing.currency}, or free for invited wallets`
                          : 'invitation-only, free'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {config.features.premiumPurchase && config.payment ? (
                <>
                  A four-character name is ${tiers.find((tier) => tier.minUnits === 4)?.priceUsd ?? 5}{' '}
                  {config.payment.currency}, paid on {config.chain.name} to the project treasury;
                  the registration itself is still sponsored. A second long name beyond the free
                  one is ${config.payment.additionalNameUsd ?? 1}. One payment buys exactly one
                  name, and names of 1–3 characters stay with the project.
                </>
              ) : (
                <>
                  The payment rail is built but not switched on: today three- and four-character
                  names go to invited wallets only, one- and two-character names are held by the
                  project, and nobody has been charged anything.
                </>
              )}
            </p>
            <h2 className="h3">The caps, live</h2>
            <p>
              Sponsored registration is capped so a leak is a fender-bender, not a firehose. These
              numbers come from{' '}
              <a className="record-link" href={`${config.siteUrl}/v1/metrics`}>
                /v1/metrics
              </a>{' '}
              at render time — a pause is visible rather than mysterious:
            </p>
            {budget ? (
              <table className="docs-table">
                <tbody>
                  <tr>
                    <td>Names issued (hard cap)</td>
                    <td className="mono">{budget.freeNamesTotalCap.toLocaleString('en-US')}</td>
                  </tr>
                  <tr>
                    <td>Platform-sponsored per day</td>
                    <td className="mono">{budget.platformPerDay}</td>
                  </tr>
                  <tr>
                    <td>Sponsored so far, all time</td>
                    <td className="mono">{budget.sponsoredLifetime}</td>
                  </tr>
                  <tr>
                    <td>USD ceiling on sponsorship in total</td>
                    <td className="mono">${budget.totalCapUsd}</td>
                  </tr>
                  <tr>
                    <td>Confirmation links expire after</td>
                    <td className="mono">{config.limits.confirmTokenTtlMinutes} minutes</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p>
                The metrics endpoint could not be read while this page was rendered — read{' '}
                <code className="mono">/v1/metrics</code> directly for the caps.
              </p>
            )}

            <h2 className="h3">What is planned, not priced in</h2>
            <div className="docs-lede-row">
              <StatusTag kind="planned" />
              <p className="docs-lede" style={{ fontSize: 16 }}>
                Numbers with no way to pay them yet.
              </p>
            </div>
            <ul>
              <li>
                Record certification: ${config.pricing.certificationMonthlyUsd}/month — the record
                contract is not deployed, so nothing can be certified yet.
              </li>
            </ul>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/claim">
                Claim a name
              </Link>
              <a className="btn" href={`${config.siteUrl}/v1/metrics`}>
                The live numbers
              </a>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
