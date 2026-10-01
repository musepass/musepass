import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { VerifyPanel } from '@/components/VerifyPanel';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Verify a record yourself',
  description: 'Recompute a merkle root or check a record in your browser — the verdict is yours, not ours.',
};

export default async function VerifyPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <VerifyPanel />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
