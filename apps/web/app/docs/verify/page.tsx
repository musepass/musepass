import Link from 'next/link';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Verify' };

export const revalidate = 300;

export default async function VerifyPage() {
  const config = await fetchConfig();
  const registry = config.l2Registry ?? '0x…';

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />

        <div className="docs-layout">
          <DocsSidebar />

          <main className="docs-main">
            <h1 className="h2">Verify us yourself</h1>
            <p className="docs-lede">Nothing below needs our API, our server or our permission.</p>

            <h2 id="verify" className="h3">
              The chain is the answer
            </h2>
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
                      : 'Not on sale yet, and there is no purchase endpoint to call.'}{' '}
                    Invited wallets can still take a 3–4 character name free — the counts are public at{' '}
                    <Link href="/numbers">/numbers</Link>, the list of who is invited is not.
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
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
