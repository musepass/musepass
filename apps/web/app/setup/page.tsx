import { SetupFlow } from '@/components/SetupFlow';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '启动名字解析' };
export const dynamic = 'force-dynamic';

/**
 * A page for exactly one person, run exactly once: the owner of the root name.
 *
 * It is linked from the developer page rather than the main navigation, because
 * every visitor except the owner has nothing to do here.
 */
export default async function SetupPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} expectedChainId={1} />
        <main className="narrow">
          <SetupFlow config={config} />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
