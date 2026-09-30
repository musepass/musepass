import { MyNames } from '@/components/MyNames';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: 'My names' };

export default async function MyNamesPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} expectedChainIds={[config.chain.chainId]} />
        <main className="narrow">
          <h1 className="h2">My names</h1>
          <MyNames explorer={config.chain.explorer} />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
