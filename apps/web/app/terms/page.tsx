import { LegalPlaceholder } from '@/components/LegalPlaceholder';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '服务条款' };
export const revalidate = 3600;

export default async function TermsPage() {
  const config = await fetchConfig();
  return (
    <LegalPlaceholder
      config={config}
      title="服务条款"
      body="服务条款还没有定稿，上线前必须由项目方补齐。在它定稿之前，我们不会声称用户已经接受了任何条款。"
    />
  );
}
