import Link from 'next/link';
import { CardMock } from '@/components/CardMock';
import { CopyPrompt } from '@/components/CopyPrompt';
import { HeroSection } from '@/components/HeroSection';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

// The landing page is prerendered, but brand strings and prices come from the
// API, so refresh it periodically instead of at every request.
export const revalidate = 300;

export default async function HomePage() {
  const config = await fetchConfig();
  const { rootName } = config;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <HeroSection config={config} />

        {/* ------------------------------------------------------- proof
            Everything in this strip is checkable in one click, and each cell
            names the transaction that backs it. A product that sells
            verifiability cannot open with adjectives; it opens with the four
            things that already work while the visitor is reading. */}
        <section className="section" id="proof">
          <h2 className="h2" style={{ maxWidth: '20em' }}>
            Not a mock-up. Four things work while you read this.
          </h2>
          <div className="pricing-grid">
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
              <span className="pricing-name">The card is on chain, not on our server</span>
              <span className="pricing-amount mono">ERC-8004</span>
              <span className="pricing-note">
                The owner signs the card and it is written into the name&apos;s own record. Private
                fields stay private — only the name and the address are public until a switch is turned
                on.{' '}
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
              <span className="pricing-name">It keeps working if we disappear</span>
              <span className="pricing-amount mono">no vendor lock-in</span>
              <span className="pricing-note">
                The name is an ERC-721 in your wallet on a public chain, and the resolution path is ENS
                plus a deployed resolver. Nothing here needs our server to stay up for the name to remain
                yours.
              </span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ how it works */}
        <section className="how" id="how">
          <div className="chat">
            <div className="bubble-me">Register a name for yourself. Call it xiaoming.</div>
            <div className="bubble-ai">
              <span>
                <span className="mono">
                  xiaoming.{rootName}
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
          </div>

          <div className="how-copy">
            <h2 className="h2">
              One sentence
              <br />
              in your AI.
            </h2>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div>
                  <div className="step-title">You say one sentence</div>
                  <div className="step-body">
                    Works with Muse, Grok, Claude, OpenClaw — any AI that can use tools.
                  </div>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div>
                  <div className="step-title">The AI checks the name and starts it</div>
                  <div className="step-body">If the name is taken, it offers a few alternatives.</div>
                </div>
              </li>
              <li className="step">
                <span className="step-num step-num-accent">3</span>
                <div>
                  <div className="step-title">You sign, and only then it counts</div>
                  <div className="step-body">
                    The AI can only prepare. Transferring, selling or changing the payout address always
                    needs your own signature.
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------- three things */}
        <section className="section">
          <h2 className="h2" style={{ maxWidth: '16em' }}>
            One name, three things attached.
          </h2>
          <div className="three-grid">
            <div className="three-item">
              <span className="three-title">Name</span>
              <p className="body-2">
                Built on ENS, so wallets, exchanges and apps already recognise it. It is an asset in your
                wallet, and only your wallet can move it. What the platform can and cannot do is written
                down in the{' '}
                <Link className="record-link" href="/trust">
                  trust model
                </Link>
                .
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">Card</span>
              <p className="body-2">
                Written to the ERC-8004 standard so another AI can read it directly: who it is, what it
                does, how to reach it. You decide what is public; by default, only the name.
              </p>
            </div>
            <div className="three-item three-item-accent">
              <span className="three-title three-title-accent">Track record</span>
              <p className="body-2">
                What it has delivered, and how well. Every entry carries evidence anyone can check
                independently. It is how another AI decides whether to work with it.
              </p>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- record */}
        <section className="record" id="record">
          <div className="record-head">
            <h2 className="h2">A track record holds only what can be proven.</h2>
            <p>
              No self-assessment, and no “they said it went well”. The acceptance criteria are registered
              and anchored before the work starts and cannot be changed afterwards; the result and the
              evidence digest are anchored together, so anyone can check them offline. (The record
              contract is not deployed yet — see the{' '}
              <Link className="record-link" href="/trust">
                trust model
              </Link>
              .)
            </p>
          </div>
          <ol className="record-steps">
            {[
              ['Register the criteria', 'Before any work, write down what counts as done'],
              ['Deliver', 'The AI, or its owner, does the work'],
              ['Submit evidence', 'Deliverables, payment records, the other side’s confirmation'],
              [
                'Verify',
                'Judged against the registered criteria, with a signed receipt (today the verifier is the project's own engine, not yet a third party)',
              ],
              ['Anchor it', 'The digest goes on chain, so it can be checked offline'],
            ].map(([title, body], index) => (
              <li className="record-step" key={title}>
                <span className="record-num">{index + 1}</span>
                <span className="record-title">{title}</span>
                <span className="record-body">{body}</span>
              </li>
            ))}
          </ol>
          <div className="record-sample">
            <div>
              <div className="record-sample-label">What one record looks like</div>
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
          </div>
        </section>

        {/* ---------------------------------------------------- pricing */}
        <section className="section" id="pricing">
          <h2 className="h2">Names are free. Reputation is what costs.</h2>
          <div className="pricing-grid">
            <div className="pricing-cell">
              <span className="pricing-name">Name</span>
              <span className="pricing-amount">Free</span>
              <span className="pricing-note">
                {config.pricing.freeMinUnits} characters or more (a CJK character counts as two). We pay
                the gas. {config.limits.freeNamesPerWallet} per wallet.
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
                  ? 'Buy one and it is fully yours, transferable.'
                  : 'Not on sale yet — free names are what is open.'}
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">Teams and platforms</span>
              <span className="pricing-amount">Contact us</span>
              <span className="pricing-note">
                Issue names to your AIs in bulk and show their records in one place.
              </span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- prompt */}
        <section className="section" id="prompt">
          <h2 className="h2" style={{ maxWidth: '18em' }}>
            No URL to remember: paste this into your AI.
          </h2>
          <p className="body-2" style={{ maxWidth: '46em' }}>
            Works with Muse, ChatGPT, Claude, Cursor — anything that can connect to MCP or make HTTP
            requests. Once pasted, it reads the full rules from <span className="mono">/ask.txt</span>,
            checks the name, starts the registration, and hands the confirmation link back to you. Claiming
            a name always needs your own signature.
          </p>
          <div className="panel" style={{ marginTop: 18 }}>
            <CopyPrompt askTxtUrl={`${config.siteUrl.replace(/\/$/, '')}/ask.txt`} />
          </div>
        </section>

        {/* -------------------------------------------------------- faq */}
        <section className="faq" id="faq">
          {[
            [
              'Who owns the name?',
              `You do. It is an asset in your wallet. Even if ${config.productName} shuts down, the name is still yours and still works.`,
            ],
            [
              'Can my AI move my name on its own?',
              'No. It can start a registration and draft a card; registering, transferring, selling or changing the payout address all need your own signature.',
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
        </section>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
