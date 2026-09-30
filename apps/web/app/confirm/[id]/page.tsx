import { ClaimFlow } from '@/components/ClaimFlow';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'Confirm a registration' };

/**
 * The page an AI hands to its owner: `/confirm/<requestId>?token=...`
 * It is the same flow as /claim, in confirm mode, so there is one implementation.
 */
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; label?: string }>;
}) {
  const [config, route, query] = await Promise.all([fetchConfig(), params, searchParams]);

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} expectedChainIds={[config.chain.chainId, 1]} />
        <main className="narrow">
          <ClaimFlow
            config={config}
            mode="confirm"
            initialLabel={query.label ?? ''}
            requestId={route.id}
            confirmToken={query.token ?? null}
          />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
