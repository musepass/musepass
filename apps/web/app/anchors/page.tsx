import { AnchorList } from '@/components/AnchorList';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = {
  title: 'Anchored batches',
  description: 'Every anchored record batch: the merkle root, the count, the transaction — and the button that recomputes it locally.',
};

export default async function AnchorsPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">Batches anchored on chain</h1>
          <p className="body-2">
            Each row is one merkle root over a batch of records. The root itself is in the
            transaction on chain — click the hash and read it. The records stay here, and the button
            below recomputes the root on your own machine so you do not have to take our word for it.
            Every batch shown today is a{' '}
            <strong>test batch</strong>: it anchors events that really happened, produced while the
            anchoring pipeline was being proven. It counts as a test of the mechanism, not as the
            start of the production record — the first production batch will say so.
          </p>
          <AnchorList />
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
