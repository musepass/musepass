import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { VerifyPanel } from '@/components/VerifyPanel';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '自己验证一条履历' };

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
