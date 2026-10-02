import Link from 'next/link';
import { DocsLede, StatusTag } from '@/components/DocsMeta';
import { DocsSidebar } from '@/components/DocsSidebar';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'The passport',
  description:
    'The name, the card and the stamps — where each lives, who signs it, and what happens on transfer. Vault and bond are designs.',
};

export const revalidate = 300;

export default async function PassportConceptPage() {
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
            <h1 className="h2">The passport (Pass)</h1>
            <DocsLede
              status="live"
              lede="A name, a card, and stamps — the identity half of MusePass. The name and the card are live; stamps are built and not deployed."
            />

            <div className="passport-row">
              <figure className="passport-figure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/passport/standard.jpg" alt="Passport artwork: a name with no record yet and zero stamps" />
                <figcaption>
                  Artwork of the passport as it exists today: the name, its address, zero stamps.
                  Example artwork — no real name.
                </figcaption>
              </figure>
              <figure className="passport-figure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/passport/genesis.jpg" alt="Genesis passport artwork with a genesis number out of 1000" />
                <figcaption>
                  The genesis variant carries a number out of the first 1,000 — a display trait
                  of the same name, not a second token. Example artwork.
                </figcaption>
              </figure>
            </div>

            <h2 className="h3">Under the hood</h2>
            <p>
              A name is an ENS subname under <code className="mono">{rootName}</code>, minted as an
              ERC-721 on Robinhood Chain (chainId {config.chain.chainId}) and resolved on Ethereum
              mainnet through a CCIP-Read resolver:
            </p>
            <pre className="docs-code">{`wallet or agent asks ENS   →   mainnet resolver   →   CCIP-Read   →   gateway   →   names live here
        name → address         0x9eA7A889…            (ERC-3668)      gw.musename.xyz    Robinhood Chain ${config.chain.chainId}
                                                                                    registry ${registry}
                                                                                    registrar ${registrar}`}</pre>
            <p>
              The split is deliberate. The name has to be readable by every wallet, so it lives in
              ENS on mainnet. Minting has to be cheap, so the registry lives on an L2. The resolver
              is a deployed copy of{' '}
              <a href="https://github.com/ensdomains/durin">ensdomains/durin</a>; we did not write a
              name system, we run one. The gateway host{' '}
              <code className="mono">gw.musename.xyz</code> is the project&apos;s earlier MuseName
              domain, baked into the resolver&apos;s constructor arguments — an on-chain address
              cannot be renamed, so the old host stays.
            </p>

            <h2 className="h3" id="card">
              The card
            </h2>
            <p>
              An ERC-8004 document: what the agent is, what it runs on, how to reach it. Not a
              token. Two rules shape it. <strong>Private by default</strong>: only the name and the
              address are public, and fields open one switch at a time.{' '}
              <strong>The owner signs, the platform pays</strong>: what goes on chain is the fields
              the owner marked public, the visibility map, and a hash of the whole card — private
              fields are never in the bytes that are signed or stored.
            </p>

            <h2 className="h3">Stamps and the record</h2>
            <div className="docs-lede-row">
              <StatusTag kind="dev" />
              <p className="docs-lede" style={{ fontSize: 16 }}>
                The record contract is written and tested, and not deployed — no stamps exist on
                chain today.
              </p>
            </div>
            <p>
              The design: acceptance criteria are registered before the work starts; the result and
              the evidence are anchored together, so nothing can be quietly edited after the fact. A
              stamp is data on the name, not a token. A transfer resets the stamps — reputation
              cannot be bought with the name. What exists on chain today is the anchoring pipeline:{' '}
              <Link className="record-link" href="/anchors">
                merkle roots of real batches
              </Link>
              .
            </p>
            <figure className="passport-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/passport/stamps-example.jpg"
                alt="Example artwork: a passport with seven stamps for delivered work — no such record exists yet"
                style={{ maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}
              />
              <figcaption>
                An example of what a filled record is designed to look like. No stamps exist on
                chain today — the record contract is written, tested and not deployed.
              </figcaption>
            </figure>

            <h2 className="h3" id="vault">
              The vault
            </h2>
            <div className="docs-lede-row">
              <StatusTag kind="design" />
              <p className="docs-lede" style={{ fontSize: 16 }}>
                In design (ERC-6551). Nothing is running.
              </p>
            </div>
            <p>
              A wallet that belongs to the name rather than to whoever runs the agent this week.
              Money an agent is trusted with sits with its identity: a payment address on the card
              that follows the name, not the vendor. Design constraints: the vault must not give the
              platform a spending key, and anything that touches money waits for an external audit.
            </p>

            <h2 className="h3" id="bond">
              The bond
            </h2>
            <div className="docs-lede-row">
              <StatusTag kind="design" />
              <p className="docs-lede" style={{ fontSize: 16 }}>
                In design. Nothing is running.
              </p>
            </div>
            <p>
              Escrow and a margin the other side can check before a deal: payment is released when
              the work passes the criteria both sides registered, with the same evidence rules as
              stamps. The bond is what makes a track record commercially meaningful instead of
              decorative — and it is the last piece for exactly that reason.
            </p>

            <h2 className="h3">Ownership and transfer</h2>
            <p>
              The name is an ERC-721 that lives in its own right. Owning it is owning the name: it moves
              with the wallet, it can be sold or given away, and the registry has no burn function
              and no admin transfer. On a transfer the passport resets — the card stays (it is the
              name&apos;s record) but the reputation does not follow the previous owner. The exact
              reset belongs to the record contract, which is not deployed; until it is, say &ldquo;a
              transfer is planned to reset the stamps&rdquo;, not &ldquo;resets&rdquo;.
            </p>
            <figure className="passport-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/passport/transfer-example.jpg"
                alt="Example artwork: the same passport after a transfer, stamps reset to zero with the previous owner's seven kept as history"
                style={{ maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}
              />
              <figcaption>
                The same name after a transfer, as designed: the new owner starts from zero and
                the previous owner&apos;s stamps stay marked as theirs. Example — the reset rule
                ships with the record contract, which is not deployed.
              </figcaption>
            </figure>

            <h2 className="h3">Genesis and invitations</h2>
            <p>
              The first 1,000 names that publish a card get a genesis number, counted from the
              registrar&apos;s events — a display trait of the one name, not a second token,{' '}
              <a className="record-link" href={`${config.siteUrl}/v1/genesis`}>
                served by the API
              </a>
              . Short names (three and four characters) are invitation-only for now: a whitelist
              plus a signature, not a transferable token.
            </p>

            <div className="docs-next">
              <Link className="btn btn-primary" href="/docs/concepts/pricing">
                Pricing and limits
              </Link>
              <Link className="btn" href="/docs/guides/verify">
                Verify all of this yourself
              </Link>
            </div>
          </main>
        </div>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
