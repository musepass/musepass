import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Trust model' };
export const revalidate = 3600;

/**
 * The page a buyer reads before believing anything else on the site.
 *
 * Everything here is copied from `docs/trust-model.md` and is kept honest by
 * `scripts/check-public-claims.mjs`: while the registry admin is a hot wallet,
 * the claim we are not allowed to make is listed here, as a denial, on purpose.
 */
export default async function TrustPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Trust model: who can do what</h1>
          <p className="body-2">
            This page puts the weaknesses in writing. The owner&apos;s wallet decides who owns a name. The
            platform pays for gas and issues names — and it holds one permission we would rather not
            have: the registry admin is an operational hot wallet, it can add itself to the registrar
            list, and a registrar can rewrite any name&apos;s address records.
          </p>

          <h2 className="h3">1. True today</h2>
          <ul className="body-2">
            <li>
              Ownership follows the owner&apos;s signature: the registrar requires a signature from the
              beneficiary, and a signed label cannot be swapped for another name or another person. The
              platform pays the gas and does not get the name.
            </li>
            <li>
              The registry has no burn and no admin transfer, and the platform has no call that takes a
              name back or moves it.
            </li>
            <li>
              Resolution works on real mainnet (<code className="mono">xiaoming.{config.rootName}</code>{' '}
              resolves to the owner&apos;s address), and when its RPC fails the gateway returns an error
              rather than signing an empty answer.
            </li>
          </ul>

          <h2 className="h3">2. False today, which is why we do not write it</h2>
          {/* claims-allow-block: name-not-modifiable — this section lists the claims we do NOT make */}
          {/* claims-allow-block: platform-cannot-modify — same reason */}
          {/* claims-allow-block: record-not-modifiable — same reason */}
          {/* claims-allow-block: independent-verifier — same reason: the sentence says we do not claim it */}
          <ul className="body-2">
            <li>
              <strong>&ldquo;The platform cannot change your name.&rdquo;</strong> Measured on chain on
              2026-09-29: the registry admin is the operational hot wallet{' '}
              <code className="mono">0x66F499e8…</code>, it can call{' '}
              <code className="mono">addRegistrar</code> to add itself (the call does not revert), and a
              registrar can rewrite any name&apos;s address and text records. Until that permission is
              moved, the sentence does not hold.
            </li>
            <li>
              <strong>&ldquo;Independently verified.&rdquo;</strong> The only verifier today is our own
              the project's own engine engine, from the same team. We do not say independent.
            </li>
            <li>
              <strong>&ldquo;Records cannot be changed.&rdquo;</strong> The append-only record contract is
              not deployed. What exists on chain is one zero-value self-transfer with a digest root in its
              calldata (see{' '}
              <Link className="record-link" href="/anchors">
                anchored batches
              </Link>
              ).
            </li>
          </ul>
          {/* claims-allow-end: * */}

          <h2 className="h3">3. What we do about that permission</h2>
          <p className="body-2">
            Rather than move the admin permission to a multisig right now, the project made misuse
            detectable: anyone can run{' '}
            <code className="mono">node scripts/security-power-inventory.mjs</code>, which reads chain
            state and exits 1 the moment the hot wallet becomes a registrar. That is the attacker&apos;s
            first step, and normal operation never needs it, so the alarm has no false positives — the
            price is that it can only tell you after that first step, not stop it.
          </p>

          <h2 className="h3">4. When that permission goes away</h2>
          <p className="body-2">
            When the registry admin, the registrar owner and the resolver owner are moved to a hardware
            wallet or a multisig with an outside signer, and the hot wallet is left with the gas-paying
            role alone, we will publish the transaction hashes. Then the first item in section 2 comes off
            this page. Until then it stays.
          </p>

          <p className="body-2" style={{ opacity: 0.75 }}>
            There is no on-call rota and no SLA. This is a single-machine project; the sentence is here so
            nobody assumes otherwise.
          </p>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
