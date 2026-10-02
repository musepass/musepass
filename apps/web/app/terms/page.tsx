import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Terms',
  description: 'The terms that apply when you claim a name or publish a card — written to match what the code does.',
};
export const revalidate = 3600;

/**
 * Real terms, same rule as the privacy page: every paragraph describes what the
 * code actually does today, and names the limit or config key it comes from.
 */
export default async function TermsPage() {
  const config = await fetchConfig();

  const section = (title: string, children: React.ReactNode) => (
    <>
      <h2 className="h3">{title}</h2>
      <div className="body-2">{children}</div>
    </>
  );

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Terms</h1>
          <p className="body-2">
            Short version: we issue names on a public chain, you hold them in your own wallet, the
            first long name is free for every wallet within published caps, short names need an
            invitation or a purchase, and we cannot undo a transaction for anyone. Last updated
            2026-10-02.
          </p>

          {section(
            'What we provide',
            <p>
              {config.productName} issues subnames of <span className="mono">{config.rootName}</span> as
              ERC-721 tokens on {config.chain.name} (chainId {config.chain.chainId}), and lets a name&apos;s
              owner publish an ERC-8004 card to the name&apos;s on-chain record. Everything else —
              certified records, the vault, the bond — is not built yet and is not offered here.
            </p>,
          )}

          {section(
            'Names and sponsorship',
            <p>
              Every wallet may claim one name of five characters or more, free, with the
              registration gas paid by the platform. An invitation — written to a wallet address
              or an X account — is what unlocks a 3–4 character short name instead, one name per
              invitation. Issuance runs within
              caps that are published as they apply ({config.siteUrl.replace(/\/$/, '')}/numbers);
              when a cap is reached, issuance pauses rather than silently continuing. Sponsorship of
              gas is a present decision, not a permanent promise — if it changes, this page changes
              first, and never retroactively.
            </p>,
          )}

          {section(
            'Paid items',
            <p>
              Short names are priced by length and certified records at{' '}
              {config.pricing.certificationMonthlyUsd} {config.pricing.currency}/month. Neither is
              purchasable today: the payment flow is not built, and no price has ever been charged.
              Nothing here takes payment, so nothing here can bill you.
            </p>,
          )}

          {section(
            'Your wallet, your responsibility',
            <p>
              A name is held by whichever wallet signed for it. We do not custody keys, we cannot
              recover a lost key, and we cannot move, freeze or reverse a name we issued. If the key
              is lost, the name is lost; that is what ownership on a public chain means.
            </p>,
          )}

          {section(
            'What you publish',
            <p>
              The card you sign is your statement. Only the fields you mark public are written on
              chain — see the{' '}
              <a href={`https://${config.siteUrl.replace(/^https?:\/\//, '')}/privacy`}>privacy page</a>{' '}
              for exactly what is stored where. You are responsible for the truth of what you
              publish; impersonation and fraud are grounds for refusal of service.
            </p>,
          )}

          {section(
            'Refusal and limits',
            <p>
              Reserved names (brands, platform and system names) are refused outright. Requests are
              rate limited per wallet and per IP, and issuance has daily and total caps. We may
              refuse service to a wallet or host for abuse — spam, scripted mass claiming,
              impersonation — and say so through the API&apos;s error, not silently.
            </p>,
          )}

          {section(
            'No reversal, no refund of the chain',
            <p>
              On-chain actions are final for us too. We cannot unwind a registration, edit a
              published record, or reverse a transfer. Where we paid gas in error we can refund that
              gas, and nothing more.
            </p>,
          )}

          {section(
            'Changes',
            <p>
              This page describes today&apos;s product. If a feature opens that changes these terms,
              the page changes before the feature does. Write to{' '}
              <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a> with questions.
            </p>,
          )}

          <p className="body-2" style={{ opacity: 0.75 }}>
            {config.legalDisclaimer.en}
          </p>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
