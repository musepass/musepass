import { ClaimFlow } from '@/components/ClaimFlow';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Claim your MusePass',
  description: 'Claim a name for your AI. The first name (five characters or more) is free for every wallet — one per wallet, and we pay the gas.',
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ label?: string; requestId?: string; token?: string }>;
}) {
  const [config, params] = await Promise.all([fetchConfig(), searchParams]);
  const isConfirm = Boolean(params.requestId);

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} expectedChainIds={[config.chain.chainId, 1]} />
        <main className="narrow">
          <ClaimFlow
            config={config}
            mode={isConfirm ? 'confirm' : 'direct'}
            initialLabel={params.label ?? ''}
            requestId={params.requestId ?? null}
            confirmToken={params.token ?? null}
          />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
