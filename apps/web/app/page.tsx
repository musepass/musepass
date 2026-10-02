import Link from 'next/link';
import { CardMock } from '@/components/CardMock';
import { CountUp } from '@/components/CountUp';
import { HeroSection } from '@/components/HeroSection';
import { Reveal } from '@/components/Reveal';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig, fetchMetrics } from '@/lib/api';

// The landing page is prerendered, but brand strings and prices come from the
// API, so refresh it periodically instead of at every request.
export const revalidate = 300;

export default async function HomePage() {
  const config = await fetchConfig();
  // Read from the chain, through the API, at render time. If the API cannot be
  // reached the bar is simply absent — a number that might be stale is worse
  // than no number on a page that is arguing everything here is checkable.
  const metrics = await fetchMetrics().catch(() => null);
  const chainNumbers = metrics?.data?.chain ?? null;
  const { rootName } = config;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <HeroSection config={config} />

        {chainNumbers && typeof chainNumbers.names === 'number' && chainNumbers.names > 0 ? (
          <div className="numbers-bar" aria-label="Live numbers">
            <span className="numbers-item">
              <strong>
                <CountUp value={chainNumbers.names} />
              </strong>{' '}
              names minted on chain
            </span>
            <span className="numbers-item">
              <strong>
                <CountUp value={chainNumbers.owners ?? chainNumbers.names} />
              </strong>{' '}
              owners
            </span>
            <span className="numbers-item">
              <strong>every one</strong> resolves on Ethereum mainnet — the root&apos;s resolver
              carries all subnames
            </span>
            <span className="numbers-item numbers-note">
              read from the registrar&apos;s events, not from our database —{' '}
              <Link href="/numbers">see the numbers page</Link>
            </span>
          </div>
        ) : null}

        {/* ------------------------------------------------------- problem
            The reason this exists at all. A name service answers a question the
            chain cannot: who is behind this address, and have they delivered
            before. Without it, the counterparty sees a hex string and guesses. */}
        <section className="section" id="problem">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '22em' }}>
              The other side of the transaction is also an AI.
            </h2>
            <p className="body-2" style={{ maxWidth: '44em' }}>
              Your AI will hire people, buy things and collect payments. What it meets is often another
              agent at another address. All either side sees is a hex string: no name, no history, no
              one responsible. MusePass is what an AI carries so it does not have to be guessed at.
            </p>
          </Reveal>
        </section>

        {/* -------------------------------------------------- what you get
            One passport, three things inside. The status tags are the honesty
            mechanism: what is live, what is in development, what is only being
            designed. Nothing on this row may say more than that. */}
        <section className="section" id="passport">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '16em' }}>
              One passport, three things inside.
            </h2>
          </Reveal>
          <Reveal stagger className="three-grid">
            <div className="three-item three-item-accent">
              <span className="tag tag-live">Live</span>
              <span className="three-title three-title-accent">Pass</span>
              <p className="body-2">
                The name and the card. A name built on ENS, so wallets, exchanges and apps already
                recognise it, held as an asset in your wallet. The card is written to the ERC-8004
                standard so another AI can read it directly: who this is, what it does, how to reach
                it — you decide what is public, and by default only the name is.{' '}
                <span className="tag" style={{ marginBottom: 0 }}>
                  Stamps: in development
                </span>
              </p>
            </div>
            <div className="three-item">
              <span className="tag">In design</span>
              <span className="three-title">Vault</span>
              <p className="body-2">
                An account the name can hold: payments that sit until the work is verified, then
                move. Not built yet — it appears here because it is what the pass is for.
              </p>
            </div>
            <div className="three-item">
              <span className="tag">In design</span>
              <span className="three-title">Bond</span>
              <p className="body-2">
                A guarantee a service provider can post, so a stranger&apos;s AI can take its promise
                seriously. Not built yet either.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------ use cases
            Three situations the product is actually for. One sentence each on
            what MusePass contributes — no scenario may claim a feature that is
            not live (the vault and the bond stay out of these sentences). */}
        <section className="section" id="use-cases">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '18em' }}>
              Three situations it is for.
            </h2>
          </Reveal>
          <Reveal stagger className="three-grid">
            <div className="three-item">
              <span className="three-title">Hiring a service</span>
              <p className="body-2">
                You ask your AI to book a photographer. MusePass lets it prefer the one whose card
                and track record it can actually check — not the one that shouted loudest.
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">Taking an AI&apos;s order</span>
              <p className="body-2">
                An order arrives from a wallet you have never seen. Look up the name: who owns it,
                what it has delivered, whether the record is certified. MusePass turns a hex string
                into a decision you can defend.
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">One AI hiring another</span>
              <p className="body-2">
                Two agents that have never met, closing a deal between themselves. MusePass is how
                each reads the other&apos;s card and record before the work starts, with no platform
                in the middle.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------ how it works */}
        <section className="how" id="how">
          <Reveal stagger className="chat">
            <div className="bubble-me">Register a name for yourself. Call it atlas.</div>
            <div className="bubble-ai">
              <span>
                <span className="mono">
                  atlas.{rootName}
                </span>{' '}
                is available. I need you to confirm it — the link is good for{' '}
                {config.limits.confirmTokenTtlMinutes} minutes.
              </span>
              <Link className="bubble-cta" href={`/claim?label=${config.exampleLabel}`}>
                Open the confirmation page
              </Link>
            </div>
            <div className="bubble-me">Confirmed.</div>
            <div className="bubble-ai">
              Registered. I also drafted a card for you — take a look before it goes public.
            </div>
          </Reveal>

          <div className="how-copy">
            <Reveal>
              <h2 className="h2">
                Two ways
                <br />
                to claim it.
              </h2>
            </Reveal>
            <Reveal as="ol" stagger className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div>
                  <div className="step-title">In your AI: one sentence</div>
                  <div className="step-body">
                    Works with Muse, Grok, Claude, OpenClaw — any AI that can use tools. It reads{' '}
                    <span className="mono">/ask.txt</span>, checks the name and starts it.
                  </div>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div>
                  <div className="step-title">On the web: one form</div>
                  <div className="step-body">
                    No AI at hand?{' '}
                    <Link className="record-link" href="/claim">
                      Claim it on this site
                    </Link>{' '}
                    — connect a wallet, pick a name. The first name is free for every wallet, and we pay the gas.
                  </div>
                </div>
              </li>
              <li className="step">
                <span className="step-num step-num-accent">3</span>
                <div>
                  <div className="step-title">Then one signature makes it real</div>
                  <div className="step-body">
                    Two paths: an AI with its own wallet signs for itself and holds the name; an AI
                    without one hands you a confirmation link, and registering, transferring or changing
                    the payout address needs your signature.
                  </div>
                </div>
              </li>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- proof
            Everything in this strip is checkable in one click, and each cell
            names the transaction that backs it. A product that sells
            verifiability cannot argue with adjectives; it shows the things
            that already work while the visitor is reading. */}
        <section className="section" id="proof">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '20em' }}>
              Not a mock-up. Four things work while you read this.
            </h2>
          </Reveal>
          <Reveal stagger className="pricing-grid">
            <div className="pricing-cell pricing-cell-featured">
              <span className="pricing-name pricing-name-accent">Resolves in your wallet</span>
              <span className="pricing-amount mono">peter.{rootName}</span>
              <span className="pricing-note">
                Paste that into any wallet or block explorer that speaks ENS and it returns an address.
                It is not read from our database.{' '}
                <Link href="/name/peter">Open the name page</Link>.
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">An AI claimed one by itself</span>
              <span className="pricing-amount mono">abcde</span>
              <span className="pricing-note">
                An agent in someone else&apos;s workspace found the endpoint, signed the registration with
                its own wallet and named itself. No human signed anything; the platform paid the gas.{' '}
                <a
                  href="https://robinhoodchain.blockscout.com/tx/0xd8916b6476e18daeab1dce3775eaa3390bb58a8a4339beb9482b0fbede1f7d86"
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction
                </a>
                .
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">The card is on chain, signed by its owner</span>
              <span className="pricing-amount mono">ERC-8004</span>
              <span className="pricing-note">
                The owner signs the card and it is written into the name&apos;s own record. Fields the
                owner keeps private are never written on chain — the chain copy carries the public
                fields and the card&apos;s hash.{' '}
                <a
                  href="https://robinhoodchain.blockscout.com/tx/0xa804185a6ecf7b0f00884f602600ecba42c7f413e8244b2ed11717ddb02b6316"
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction
                </a>
                .
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">Ownership does not depend on us; resolution does</span>
              <span className="pricing-amount mono">no vendor lock-in on the name</span>
              <span className="pricing-note">
                The name is an ERC-721 in your wallet on a public chain — ownership cannot be taken
                back. Wallet resolution runs through our gateway today: if we went away, the name
                stayed yours, though wallets would stop resolving it until the gateway returned.{' '}
                <Link href="/trust">The trust model says both halves out loud</Link>.
              </span>
            </div>
          </Reveal>
        </section>

        {/* ----------------------------------------------------- record */}
        <section className="record" id="record">
          <Reveal className="record-head">
            <h2 className="h2">A track record holds only what can be proven.</h2>
            <p>
              No self-assessment, and no “they said it went well”. The design: the acceptance criteria
              are registered before the work starts, and the result and the evidence digest are
              anchored together, so anyone can check them offline and nothing can be quietly edited
              after the fact. (The record contract is not deployed yet — see the{' '}
              <Link className="record-link" href="/trust">
                trust model
              </Link>
              .)
            </p>
          </Reveal>
          <Reveal as="ol" stagger className="record-steps">
            {[
              ['Register the criteria', 'Before any work, write down what counts as done'],
              ['Deliver', 'The AI, or its owner, does the work'],
              ['Submit evidence', 'Deliverables, payment records, the other side’s confirmation'],
              [
                'Verify',
                'Judged against the registered criteria, with a signed receipt (today the verifier is our own engine, not yet a third party)',
              ],
              ['Anchor it', 'The digest goes on chain, so it can be checked offline'],
            ].map(([title, body], index) => (
              <li className="record-step" key={title}>
                <span className="record-num">{index + 1}</span>
                <span className="record-title">{title}</span>
                <span className="record-body">{body}</span>
              </li>
            ))}
          </Reveal>
          <Reveal className="record-sample">
            <div>
              <div className="record-sample-label">What one record will look like — example</div>
              <div className="record-sample-claim">Deliver 20 wedding photos within 48 hours</div>
            </div>
            <div className="record-sample-right">
              <span className="pill-pass">Passed</span>
              {config.features.trackRecord ? (
                <Link className="record-link" href={`/name/${config.exampleLabel}`}>
                  See a full profile
                </Link>
              ) : (
                <span className="record-link" style={{ opacity: 0.7 }}>
                  Certified records are not open yet
                </span>
              )}
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------- pricing */}
        <section className="section" id="pricing">
          <Reveal>
            <h2 className="h2">The first name is free. Trust is earned.</h2>
          </Reveal>
          <Reveal stagger className="pricing-grid">
            <div className="pricing-cell">
              <span className="pricing-name">Name</span>
              <span className="pricing-amount">Free</span>
              <span className="pricing-note">
                Every wallet, once — a name of {config.pricing.freeMinUnits} characters or more (a
                CJK character counts as two), and we pay the gas.{' '}
                {config.limits.freeNamesPerWallet} per wallet.
              </span>
            </div>
            <div className="pricing-cell pricing-cell-featured">
              <span className="pricing-name pricing-name-accent">Certified record</span>
              <span className="pricing-amount">
                {config.pricing.certificationMonthlyUsd}{' '}
                <span className="pricing-unit">{config.pricing.currency} / month</span>
              </span>
              <span className="pricing-note">
                The record is verified and carries a certification badge. Stop renewing and the badge comes
                off; the records you already have stay.
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">Short names</span>
              <span className="pricing-amount">
                {config.pricing.premiumTiers.length > 0
                  ? `$${Math.min(...config.pricing.premiumTiers.map((tier) => tier.priceUsd))} – $${Math.max(
                      ...config.pricing.premiumTiers.map((tier) => tier.priceUsd),
                    )}`
                  : 'Priced by length'}
              </span>
              <span className="pricing-note">
                Priced by length, because that is what makes a name worth remembering:{' '}
                {[...config.pricing.premiumTiers]
                  .sort((a, b) => b.minUnits - a.minUnits)
                  .map(
                    (tier) =>
                      `${tier.minUnits}${tier.minUnits === 1 ? ' character' : ' characters'} $${tier.priceUsd}`,
                  )
                  .join(' · ')}
                . A CJK character counts as two.{' '}
                {config.features.premiumPurchase
                  ? 'Buy one and it is fully yours, transferable — or take a 3–4 character name free with an invitation.'
                  : 'Invitations are how short names are issued.'}
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">Teams and platforms</span>
              <span className="pricing-amount">Contact us</span>
              <span className="pricing-note">
                Issue names to your AIs in bulk and show their records in one place.
              </span>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------- trust
            One line here; the long lists live on their own pages. A visitor who
            wants the weaknesses knows exactly where to look, and a visitor who
            does not is not asked to read them twice. */}
        <section className="section" id="trust-line">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '18em' }}>
              We publish what we cannot do yet.
            </h2>
            <p className="body-2" style={{ maxWidth: '44em' }}>
            What is not true today is written down while it is still not true:{' '}
            <Link className="record-link" href="/trust">
              the trust model
            </Link>{' '}
            says who can do what, and{' '}
            <Link className="record-link" href="/numbers">
              the numbers page
            </Link>{' '}
            publishes the public numbers, including the zeroes.
          </p>
          </Reveal>
        </section>

        {/* --------------------------------------------------- developers
            Entry points only. The paste block itself moved to the developer
            docs so this page stays readable for the people it is written for. */}
        <section className="section" id="developers">
          <Reveal>
            <h2 className="h2" style={{ maxWidth: '18em' }}>
              Building with agents?
            </h2>
            <p className="body-2" style={{ marginBottom: 20 }}>
            The documentation is organised by who is reading — people, agents, merchants,
            developers:{' '}
            <Link className="record-link" href="/docs">
              /docs
            </Link>
            .
          </p>
          </Reveal>
          <Reveal stagger className="three-grid">
            <div className="three-item">
              <span className="three-title">MCP</span>
              <p className="body-2">
                Nine tools, streamable HTTP, no key:{' '}
                <Link className="record-link" href="/docs/reference/mcp">
                  /docs/reference/mcp
                </Link>
                .
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">REST</span>
              <p className="body-2">
                Plain HTTPS endpoints with one envelope:{' '}
                <Link className="record-link" href="/docs/reference/api">
                  /docs/reference/api
                </Link>
                .
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">For the AI itself</span>
              <p className="body-2">
                <Link className="record-link" href="/ask.txt">
                  /ask.txt
                </Link>{' '}
                — the rules in plain text an agent reads on its own, and{' '}
                <Link className="record-link" href="/docs/start/developers">
                  the paste block in the docs
                </Link>
                .
              </p>
            </div>
          </Reveal>
        </section>

        {/* -------------------------------------------------------- faq */}
        <section id="faq">
          <Reveal stagger className="faq">
            {[
            [
              'Who owns the name?',
              `You do. It is an asset in your wallet: even if ${config.productName} shuts down, ownership stays with you and cannot be taken back. Wallet resolution runs through our gateway — if the gateway went down, the name would still be yours but wallets would stop resolving it until it returned. The trust model page keeps this honest.`,
            ],
            [
              'Can my AI move my name on its own?',
              'If the AI holds its own wallet, yes — it signs for itself and moves what it owns. If you hold the name, no: registering, transferring, selling or changing the payout address needs your signature.',
            ],
            [
              'Can a track record be faked?',
              'The record layer is still in design: the contract is written and tested but not deployed, so there are no real records yet. Once it is live, an entry only gets in with evidence judged against criteria registered before the work started; verdicts are passed, failed, or cannot be proven, and anyone can check them offline.',
            ],
            [
              'Is this related to Meta?',
              config.legalDisclaimer.en.replaceAll(config.productName, config.productName),
            ],
          ].map(([question, answer]) => (
            <div className="faq-item" key={question}>
              <h3 className="faq-q">{question}</h3>
              <p className="faq-a">{answer}</p>
            </div>
          ))}
          </Reveal>
        </section>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
