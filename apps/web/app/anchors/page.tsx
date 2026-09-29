import { AnchorList } from '@/components/AnchorList';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '已锚定的批次' };

export default async function AnchorsPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">已锚定在链上的批次</h1>
          <p className="body-2">
            每一行是「一批记录的摘要」写成的一个默克尔根，根本身在链上交易里（点交易哈希能看到），
            记录留在这里。下面的按钮会在这台机器上重新算一遍，你不用信我们说的对不对。
          </p>
          <AnchorList />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
