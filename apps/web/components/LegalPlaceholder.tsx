import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import type { PublicConfig } from '@/lib/api';

/**
 * Honest placeholder for pages that must exist before launch but are not
 * written yet. Saying "not written" is better than shipping invented legal
 * text or an empty page.
 */
export function LegalPlaceholder({
  config,
  title,
  body,
}: {
  config: PublicConfig;
  title: string;
  body: string;
}) {
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">{title}</h1>
          <div className="notice notice-warn">{body}</div>
          <p className="body-2">
            Questions go to{' '}
            <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.
          </p>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
